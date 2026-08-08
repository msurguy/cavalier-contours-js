/**
 * Core polyline "trait" methods.
 *
 * Port of `polyline/traits.rs`. The Rust traits `PlineSource` and `PlineSourceMut` become the
 * abstract classes `PlineSourceBase` and `PlineSourceMutBase` — Rust default trait methods are
 * implemented concretely on the base classes and required trait methods become abstract members.
 * The Rust associated type `OutputPolyline` is always the concrete `Polyline` type (type-only
 * import; runtime construction goes through the protected abstract `createOutputWithCapacity`/
 * `createOutputFromVertexes` factory methods implemented by subclasses to avoid a runtime
 * circular import).
 *
 * The Rust `PlineCreation` trait maps to static methods on `Polyline` (see `polyline.ts`).
 */
import { debugAssert } from "../core/controlFlow.js";
import { FUZZY_EPSILON, fuzzyEqEps, fuzzyEqZeroEps, fuzzyLt } from "../core/fuzzy.js";
import {
  angle,
  angleFromBulge,
  bulgeFromAngle,
  deltaAngle,
  distSquared,
  isLeft,
  isLeftOrEqual,
  pointOnCircle,
} from "../core/mathUtils.js";
import type { Vector2 } from "../core/vector2.js";
import {
  type AABB,
  type StaticAabb2dIndex,
  StaticAabb2dIndexBuilder,
} from "../index2d/staticAabb2dIndex.js";
import {
  findIntersects as findIntersectsInternal,
  visitGlobalSelfIntersects,
  visitIntersects as visitIntersectsInternal,
  visitLocalSelfIntersects,
} from "./internal/plineIntersects.js";
import { getPolylineBooleanImpl } from "./internal/booleanDispatch.js";
import { polylineContains } from "./internal/plineContains.js";
import { invokeParallelOffset } from "./internal/plineOffsetRegistry.js";
import {
  arcSegBoundingBox,
  segArcRadiusAndCenter,
  segBoundingBox,
  segClosestPoint,
  segFastApproxBoundingBox,
  segLength,
  segSplitAtPoint,
} from "./plineSeg.js";
import {
  type BooleanOp,
  type BooleanResult,
  type ClosestPointResult,
  defaultPlineOffsetOptions,
  defaultPlineSelfIntersectOptions,
  type FindIntersectsOptions,
  type FindPointAtPathLengthResult,
  type PlineBooleanOptions,
  type PlineContainsOptions,
  type PlineContainsResult,
  type PlineIntersectsCollection,
  type PlineIntersectVisitor,
  type PlineOffsetOptions,
  type PlineOrientation,
  type PlineSelfIntersectOptions,
  type TwoPlinesIntersectVisitor,
} from "./plineTypes.js";
import { PlineVertex } from "./plineVertex.js";
import type { Polyline } from "./polyline.js";

/** Port of Rust `Option::unwrap` on values that are invalid to be absent. */
function unwrap<T>(value: T | null, msg: string): T {
  if (value === null) {
    throw new Error(msg);
  }
  return value;
}

/**
 * Cases used while processing/considering to discard the middle vertex `v2` in
 * `PlineSourceBase.removeRedundant` (Rust local enum `RemoveRedundantCase`).
 */
type RemoveRedundantCase =
  /** Include the vertex in the result. */
  | { kind: "includeVertex" }
  /** Discard the current vertex. */
  | { kind: "discardVertex" }
  /** Discard the current vertex and update the previous vertex bulge with the value computed. */
  | { kind: "updateV1BulgeForArc"; bulge: number };

/**
 * Abstract class representing a readonly source of polyline data. This class has all the methods
 * and operations that can be performed on a readonly polyline.
 *
 * A polyline is a sequence of vertexes and a bool indicating whether the polyline is closed (last
 * vertex forms segment with first vertex) or open (no segment between last and first vertex).
 * Polylines can represent complex 2D shapes including straight line segments and circular arc
 * segments defined by bulge values. For related classes see `PlineSourceMutBase` and the
 * `Polyline` creation statics.
 *
 * Each vertex has a 2d xy position and bulge value. The bulge value determines the curvature of
 * the segment from this vertex to the next:
 * - A bulge of 0.0 creates a straight line segment
 * - A positive bulge creates a counter-clockwise arc
 * - A negative bulge creates a clockwise arc
 * - The magnitude of the bulge determines the arc's curvature
 *
 * See `PlineVertex` for more information about vertex structure and bulge calculations.
 */
export abstract class PlineSourceBase {
  /** Total number of vertexes. */
  abstract readonly vertexCount: number;

  /** Whether the polyline is closed (true) or open (false). */
  abstract readonly isClosed: boolean;

  /**
   * User data values associated with the polyline.
   *
   * User data values are integers that can be associated with polylines for storing custom
   * application-specific data (Rust `u64` values on `Polyline::userdata`). Mirrors the Rust
   * `get_userdata_values` accessor as a plain array property.
   */
  abstract readonly userdata: number[];

  /** Get the vertex at given `index` position. Returns `null` if `index` out of bounds. */
  abstract get(index: number): PlineVertex | null;

  /**
   * Same as `get` but throws if `index` is out of bounds.
   *
   * @throws Error if `index` is out of bounds.
   */
  abstract at(index: number): PlineVertex;

  /**
   * Construct a new empty output `Polyline` with `capacity` given (Rust
   * `Self::OutputPolyline::with_capacity`). Implemented by subclasses so this module never
   * imports `polyline.ts` at runtime (avoids a circular import).
   */
  protected abstract createOutputWithCapacity(capacity: number, isClosed: boolean): Polyline;

  /**
   * Construct a new output `Polyline` from the vertexes given (Rust
   * `Self::OutputPolyline::from_iter`). Implemented by subclasses so this module never imports
   * `polyline.ts` at runtime (avoids a circular import).
   */
  protected abstract createOutputFromVertexes(
    vertexes: Iterable<PlineVertex>,
    isClosed: boolean,
  ): Polyline;

  /**
   * Returns the number of user data values stored with this polyline.
   *
   * User data values are integers that can be associated with polylines for storing custom
   * application-specific data.
   */
  getUserdataCount(): number {
    return this.userdata.length;
  }

  /**
   * Returns all user data values stored with this polyline.
   *
   * User data values are integers that can be associated with polylines for storing custom
   * application-specific data. (Rust returns an iterator of copied values; the JS port returns
   * the live array as readonly.)
   */
  getUserdataValues(): readonly number[] {
    return this.userdata;
  }

  /** Return iterator to iterate over all the polyline segments. */
  *iterSegments(): IterableIterator<[PlineVertex, PlineVertex]> {
    // mirrors Rust `SegmentIter`
    const vc = this.vertexCount;
    if (vc < 2) {
      return;
    }

    for (let pos = 0; pos < vc - 1; pos += 1) {
      yield [this.at(pos), this.at(pos + 1)];
    }

    if (this.isClosed) {
      yield [this.at(vc - 1), this.at(0)];
    }
  }

  /** Return iterator to iterate over all the polyline vertexes. */
  *iterVertexes(): IterableIterator<PlineVertex> {
    // mirrors Rust `VertexIter`
    const end = this.vertexCount;
    for (let pos = 0; pos < end; pos += 1) {
      yield this.at(pos);
    }
  }

  /** Returns true if vertex count is 0. */
  isEmpty(): boolean {
    return this.vertexCount === 0;
  }

  /**
   * Fuzzy compare with another polyline using `eps` epsilon value for fuzzy comparison of
   * vertexes.
   */
  fuzzyEqEps(other: PlineSourceBase, eps: number): boolean {
    if (this.isClosed !== other.isClosed || this.vertexCount !== other.vertexCount) {
      return false;
    }

    const vc = this.vertexCount;
    for (let i = 0; i < vc; i += 1) {
      if (!this.at(i).fuzzyEqEps(other.at(i), eps)) {
        return false;
      }
    }

    return true;
  }

  /** Same as `fuzzyEqEps` but uses default `FUZZY_EPSILON`. */
  fuzzyEq(other: PlineSourceBase): boolean {
    return this.fuzzyEqEps(other, FUZZY_EPSILON);
  }

  /** Get the last vertex of the polyline or `null` if polyline is empty. */
  last(): PlineVertex | null {
    return this.get(this.vertexCount - 1);
  }

  /** Total number of segments in the polyline. */
  segmentCount(): number {
    const vc = this.vertexCount;
    if (vc < 2) {
      return 0;
    } else if (this.isClosed) {
      return vc;
    } else {
      return vc - 1;
    }
  }

  /**
   * Iterate through all the polyline segment vertex positional indexes.
   *
   * Segments are represented by polyline vertex pairs, for each vertex there is an associated
   * positional index in the polyline, this method iterates through those positional indexes as
   * segment pairs starting at (0, 1) and ending at (n-2, n-1) if open polyline or (n-1, 0) if
   * closed polyline where n is the number of vertexes.
   */
  *iterSegmentIndexes(): IterableIterator<[number, number]> {
    // mirrors Rust `PlineSegIndexIterator`
    const vertexCount = this.vertexCount;
    const isClosed = this.isClosed;
    const remaining = vertexCount < 2 ? 0 : isClosed ? vertexCount : vertexCount - 1;

    for (let pos = 0; pos < remaining; pos += 1) {
      if (pos === remaining - 1 && isClosed) {
        yield [pos, 0];
      } else {
        yield [pos, pos + 1];
      }
    }
  }

  /**
   * Returns the next wrapping vertex index for the polyline.
   *
   * This method treats the polyline as circular, so after the last vertex index,
   * it wraps around to index 0. This is useful for traversing polylines in a
   * circular manner regardless of whether they are closed or open.
   *
   * If `i + 1 >= this.vertexCount` then 0 is returned, otherwise `i + 1` is returned.
   */
  nextWrappingIndex(i: number): number {
    const next = i + 1;
    if (next >= this.vertexCount) {
      return 0;
    } else {
      return next;
    }
  }

  /**
   * Returns the previous wrapping vertex index for the polyline.
   *
   * This method treats the polyline as circular, so before the first vertex index (0),
   * it wraps around to the last vertex index. This is useful for traversing polylines
   * in a circular manner regardless of whether they are closed or open.
   *
   * If `i === 0` then `this.vertexCount - 1` is returned, otherwise `i - 1` is returned.
   */
  prevWrappingIndex(i: number): number {
    if (i === 0) {
      return this.vertexCount - 1;
    } else {
      return i - 1;
    }
  }

  /**
   * Returns the forward wrapping distance between two vertex indexes.
   *
   * Assumes `startIndex` is valid, debug asserts `startIndex < this.vertexCount`.
   */
  fwdWrappingDist(startIndex: number, endIndex: number): number {
    const vc = this.vertexCount;

    debugAssert(startIndex < vc, "start_index is out of polyline range bounds");

    if (startIndex <= endIndex) {
      return endIndex - startIndex;
    } else {
      return vc - startIndex + endIndex;
    }
  }

  /**
   * Returns the vertex index after applying `offset` to `startIndex` in a wrapping manner.
   *
   * Assumes `startIndex` is valid, debug asserts `startIndex < this.vertexCount`.
   * Assumes `offset` does not wrap multiple times, debug asserts `offset <= this.vertexCount`.
   */
  fwdWrappingIndex(startIndex: number, offset: number): number {
    const vc = this.vertexCount;

    debugAssert(startIndex < vc, "start_index is out of polyline range bounds");

    debugAssert(offset <= vc, "offset wraps multiple times");

    const sum = startIndex + offset;
    if (sum < vc) {
      return sum;
    } else {
      return sum - vc;
    }
  }

  /**
   * Compute the XY extents of the polyline.
   *
   * Returns `null` if polyline has less than 2 vertexes.
   */
  extents(): AABB | null {
    if (this.segmentCount() === 0) {
      return null;
    }

    const firstV = this.at(0);
    const result: AABB = { minX: firstV.x, minY: firstV.y, maxX: firstV.x, maxY: firstV.y };

    const vc = this.vertexCount;
    const segCount = this.segmentCount();
    for (let i = 0; i < segCount; i += 1) {
      const v1 = this.at(i);
      const v2 = this.at(i === vc - 1 ? 0 : i + 1);
      if (v1.bulgeIsZero()) {
        // line segment, just look at end of line point (result seeded with first point)
        if (v2.x < result.minX) {
          result.minX = v2.x;
        } else if (v2.x > result.maxX) {
          result.maxX = v2.x;
        }

        if (v2.y < result.minY) {
          result.minY = v2.y;
        } else if (v2.y > result.maxY) {
          result.maxY = v2.y;
        }

        continue;
      }
      // else arc segment
      const arcExtents = arcSegBoundingBox(v1, v2);

      result.minX = Math.min(result.minX, arcExtents.minX);
      result.minY = Math.min(result.minY, arcExtents.minY);
      result.maxX = Math.max(result.maxX, arcExtents.maxX);
      result.maxY = Math.max(result.maxY, arcExtents.maxY);
    }

    return result;
  }

  /** Returns the total path length of the polyline. */
  pathLength(): number {
    let acc = 0.0;
    const vc = this.vertexCount;
    const segCount = this.segmentCount();
    for (let i = 0; i < segCount; i += 1) {
      const v1 = this.at(i);
      const v2 = this.at(i === vc - 1 ? 0 : i + 1);
      acc = acc + segLength(v1, v2);
    }
    return acc;
  }

  /**
   * Compute the closed signed area of the polyline.
   *
   * If `isClosed` is false (open polyline) then 0.0 is always returned.
   * The area is signed such that if the polyline direction is counter clockwise
   * then the area is positive, otherwise it is negative.
   */
  area(): number {
    if (!this.isClosed) {
      return 0.0;
    }

    // Implementation notes:
    // Using the shoelace formula (https://en.wikipedia.org/wiki/Shoelace_formula) modified to
    // support arcs defined by a bulge value. The shoelace formula returns a negative value for
    // clockwise oriented polygons and positive value for counter clockwise oriented polygons.
    // The area of each circular segment defined by arcs is then added if it is a counter
    // clockwise arc or subtracted if it is a clockwise arc. The area of the circular segments
    // are computed by finding the area of the arc sector minus the area of the triangle
    // defined by the chord and center of circle.
    // See https://en.wikipedia.org/wiki/Circular_segment
    let doubleTotalArea = 0.0;

    const vc = this.vertexCount;
    const segCount = this.segmentCount();
    for (let i = 0; i < segCount; i += 1) {
      const v1 = this.at(i);
      const v2 = this.at(i === vc - 1 ? 0 : i + 1);
      doubleTotalArea = doubleTotalArea + v1.x * v2.y - v1.y * v2.x;
      if (!v1.bulgeIsZero()) {
        // add arc segment area
        const b = Math.abs(v1.bulge);
        const sweepAngle = angleFromBulge(b);
        const triangleBase = v2.pos().sub(v1.pos()).length();
        const radius = triangleBase * ((b * b + 1.0) / (4.0 * b));
        const sagitta = (b * triangleBase) / 2.0;
        const triangleHeight = radius - sagitta;
        const doubleSectorArea = sweepAngle * radius * radius;
        const doubleTriangleArea = triangleBase * triangleHeight;
        let doubleArcArea = doubleSectorArea - doubleTriangleArea;
        if (v1.bulgeIsNeg()) {
          doubleArcArea = -doubleArcArea;
        }

        doubleTotalArea = doubleTotalArea + doubleArcArea;
      }
    }

    return doubleTotalArea / 2.0;
  }

  /**
   * Returns the orientation of the polyline.
   *
   * This method just uses the `area` function to determine directionality of a closed
   * polyline which may not yield a useful result if the polyline has self intersects.
   */
  orientation(): PlineOrientation {
    if (!this.isClosed) {
      return "open";
    }

    if (this.area() < 0.0) {
      return "clockwise";
    } else {
      return "counterClockwise";
    }
  }

  /**
   * Helper returning the first `n` vertexes of the polyline (mirrors Rust
   * `self.iter_vertexes().take(n)` — clamps `n` to the vertex count like `take`).
   */
  private firstVertexes(n: number): PlineVertex[] {
    const count = Math.min(n, this.vertexCount);
    const result: PlineVertex[] = [];
    for (let i = 0; i < count; i += 1) {
      result.push(this.at(i));
    }
    return result;
  }

  /**
   * Remove all repeat position vertexes from the polyline.
   *
   * Returns `null` to avoid allocation and copy in the case that no vertexes are removed.
   */
  removeRepeatPos(posEqualEps: number): Polyline | null {
    if (this.vertexCount < 2) {
      return null;
    }

    let result: Polyline | null = null;
    let prevPos = this.at(0).pos();
    const vc = this.vertexCount;
    for (let i = 1; i < vc; i += 1) {
      const v = this.at(i);
      const isRepeat = v.pos().fuzzyEqEps(prevPos, posEqualEps);

      if (isRepeat) {
        // repeat position just update bulge (remove vertex by not adding it to result)
        if (result === null) {
          result = this.createOutputFromVertexes(this.firstVertexes(i), this.isClosed);
        }
        const r = result;
        const last = unwrap(r.last(), "result polyline is never empty here");
        r.setLast(last.withBulge(v.bulge));
      } else {
        if (result !== null) {
          // not repeat position and result is initialized
          result.addVertex(v);
        }
        // else not repeat position and result is not initialized, do nothing

        // update previous position for next iteration
        prevPos = v.pos();
      }
    }

    // check if is_closed and last repeats position on first
    if (
      this.isClosed &&
      unwrap(this.last(), "polyline has at least 2 vertexes")
        .pos()
        .fuzzyEqEps(this.at(0).pos(), posEqualEps)
    ) {
      if (result === null) {
        result = this.createOutputFromVertexes(this.iterVertexes(), this.isClosed);
      }
      result.removeLast();
    }

    return result;
  }

  /**
   * Remove all redundant vertexes from the polyline.
   *
   * Redundant vertexes can arise with multiple vertexes on top of each other, along a straight
   * line, or forming a concentric arc with sweep angle less than or equal to PI.
   *
   * Returns `null` to avoid allocation and copy in the case that no vertexes are removed.
   */
  removeRedundant(posEqualEps: number): Polyline | null {
    const vc = this.vertexCount;
    if (vc < 2) {
      return null;
    }

    if (vc === 2) {
      const v1 = this.at(0);
      const v2 = this.at(1);
      if (v1.pos().fuzzyEqEps(v2.pos(), posEqualEps)) {
        const result = this.createOutputWithCapacity(1, this.isClosed);
        result.addVertex(v2); // take bulge from last vertex
        return result;
      }
      return null;
    }

    // helper to test if v1->v2->v3 are collinear and all going in the same direction
    const isCollinearSameDir = (
      v1: PlineVertex,
      v2: PlineVertex,
      v3: PlineVertex,
    ): boolean => {
      // check if v2 on top of v3 (considered collinear for the purposes of discarding v2)
      if (v2.pos().fuzzyEqEps(v3.pos(), posEqualEps)) {
        return true;
      }

      const collinear = fuzzyEqZeroEps(
        v1.x * (v2.y - v3.y) + v2.x * (v3.y - v1.y) + v3.x * (v1.y - v2.y),
        posEqualEps,
      );
      const sameDirection = v3.pos().sub(v2.pos()).dot(v2.pos().sub(v1.pos())) > -posEqualEps;

      return collinear && sameDirection;
    };

    let v1 = this.at(0);
    let v2 = this.at(1);

    // remove all repeat positions at the start
    let i = 2;
    while (v1.pos().fuzzyEqEps(v2.pos(), posEqualEps)) {
      v1 = v1.withBulge(v2.bulge);
      // check for reaching the end of polyline
      if (i >= vc) {
        break;
      }
      v2 = this.at(i);
      i += 1;
    }

    let result: Polyline | null;
    if (i === 2) {
      result = null;
    } else {
      const pl = this.createOutputWithCapacity(1, this.isClosed);
      pl.addVertex(v1);
      result = pl;
    }
    // if end is reached return polyline with the only vertex
    if (i >= vc) {
      return result;
    }

    let v1V2Arc: [number, Vector2] | null = null;
    let v1BulgeIsZero = v1.bulgeIsZero();
    let v2BulgeIsZero = v2.bulgeIsZero();
    let v1BulgeIsPos = v1.bulgeIsPos();
    let v2BulgeIsPos = v2.bulgeIsPos();

    const iterCount = this.isClosed ? vc - 1 : vc - 2;

    // loop through processing/considering to discard the middle vertex v2
    // (mirrors Rust `self.iter_vertexes().cycle().enumerate().skip(i).take(iter_count)`)
    for (let k = i; k < i + iterCount; k += 1) {
      const v3 = this.at(k % vc);

      let state: RemoveRedundantCase;
      if (v2.pos().fuzzyEqEps(v3.pos(), posEqualEps)) {
        // repeat position, just update bulge
        state = { kind: "discardVertex" };
      } else if (v1BulgeIsZero && v2BulgeIsZero) {
        // two line segments in a row, check if collinear
        const isFinalVertexForOpen = !this.isClosed && k === vc;
        if (!isFinalVertexForOpen && isCollinearSameDir(v1, v2, v3)) {
          state = { kind: "discardVertex" };
        } else {
          state = { kind: "includeVertex" };
        }
      } else if (
        !v1BulgeIsZero &&
        !v2BulgeIsZero &&
        v1BulgeIsPos === v2BulgeIsPos &&
        !v2.pos().fuzzyEqEps(v3.pos(), posEqualEps)
      ) {
        // two arc segments in a row with same orientation, check if v2 can be removed by
        // updating v1 bulge
        if (v1V2Arc === null) {
          v1V2Arc = segArcRadiusAndCenter(v1, v2);
        }
        const [arcRadius1, arcCenter1] = v1V2Arc;

        const [arcRadius2, arcCenter2] = segArcRadiusAndCenter(v2, v3);

        if (
          fuzzyEqEps(arcRadius1, arcRadius2, posEqualEps) &&
          arcCenter1.fuzzyEqEps(arcCenter2, posEqualEps)
        ) {
          const angle1 = angle(arcCenter1, v1.pos());
          const angle2 = angle(arcCenter1, v2.pos());
          const angle3 = angle(arcCenter1, v3.pos());
          const totalSweep =
            Math.abs(deltaAngle(angle1, angle2)) + Math.abs(deltaAngle(angle2, angle3));

          const avgRadius = (arcRadius1 + arcRadius2) / 2.0;

          // can only combine vertexes if total sweep will still be less than PI
          // multiplying by average radius for fuzzy compare to have numbers in scale
          // of epsilon
          if (fuzzyLt(avgRadius * totalSweep, avgRadius * Math.PI, posEqualEps)) {
            const bulge = v1BulgeIsPos ? bulgeFromAngle(totalSweep) : -bulgeFromAngle(totalSweep);
            state = { kind: "updateV1BulgeForArc", bulge };
          } else {
            state = { kind: "includeVertex" };
          }
        } else {
          state = { kind: "includeVertex" };
        }
      } else {
        state = { kind: "includeVertex" };
      }

      const copySelf = (): Polyline =>
        this.createOutputFromVertexes(this.firstVertexes(k - 1), this.isClosed);

      switch (state.kind) {
        case "includeVertex": {
          if (result !== null) {
            result.addVertex(v2);
          }
          v1 = v2;
          v2 = v3;
          v1V2Arc = null;
          v1BulgeIsZero = v2BulgeIsZero;
          v2BulgeIsZero = v3.bulgeIsZero();
          v1BulgeIsPos = v2BulgeIsPos;
          v2BulgeIsPos = v3.bulgeIsPos();
          break;
        }
        case "discardVertex": {
          if (result === null) {
            result = copySelf();
          }

          v2 = v3;
          v1V2Arc = null;
          v2BulgeIsZero = v3.bulgeIsZero();
          v2BulgeIsPos = v3.bulgeIsPos();
          break;
        }
        case "updateV1BulgeForArc": {
          if (result === null) {
            result = copySelf();
          }
          const p = result;
          const last = unwrap(p.last(), "result polyline is never empty here");
          p.setLast(last.withBulge(state.bulge));
          v1 = v1.withBulge(state.bulge);
          v2 = v3;
          v1BulgeIsZero = v2BulgeIsZero;
          v2BulgeIsZero = v3.bulgeIsZero();
          v1BulgeIsPos = v2BulgeIsPos;
          v2BulgeIsPos = v3.bulgeIsPos();
          break;
        }
      }
    }

    if (this.isClosed) {
      // handle wrap around middle vertex at start
      if (result !== null) {
        const pl = result;
        if (
          unwrap(pl.last(), "result polyline is never empty here")
            .pos()
            .fuzzyEqEps(pl.at(0).pos(), posEqualEps)
        ) {
          pl.removeLast();
        }
      } else {
        if (
          unwrap(this.last(), "polyline has at least 2 vertexes")
            .pos()
            .fuzzyEqEps(this.at(0).pos(), posEqualEps)
        ) {
          // last repeats position on first
          result = this.createOutputFromVertexes(this.iterVertexes(), this.isClosed);
          result.removeLast();
        }
      }

      // v1 => last
      // v2 => first
      // v3 => second
      const v3 = result !== null ? result.at(1) : this.at(1);
      if (v1BulgeIsZero && v2BulgeIsZero && isCollinearSameDir(v1, v2, v3)) {
        // first vertex is in middle of line
        if (result === null) {
          result = this.createOutputFromVertexes(this.iterVertexes(), this.isClosed);
        }
        const p = result;
        const last = p.removeLast();
        p.setVertex(0, last);
      } else if (
        !v1BulgeIsZero &&
        !v2BulgeIsZero &&
        v1BulgeIsPos === v2BulgeIsPos &&
        !v2.pos().fuzzyEqEps(v3.pos(), posEqualEps)
      ) {
        // check if arc can be simplified by removing first vertex
        if (v1V2Arc === null) {
          v1V2Arc = segArcRadiusAndCenter(v1, v2);
        }
        const [arcRadius1, arcCenter1] = v1V2Arc;

        const [arcRadius2, arcCenter2] = segArcRadiusAndCenter(v2, v3);

        if (
          fuzzyEqEps(arcRadius1, arcRadius2, posEqualEps) &&
          arcCenter1.fuzzyEqEps(arcCenter2, posEqualEps)
        ) {
          const angle1 = angle(arcCenter1, v1.pos());
          const angle2 = angle(arcCenter1, v2.pos());
          const angle3 = angle(arcCenter1, v3.pos());
          const totalSweep =
            Math.abs(deltaAngle(angle1, angle2)) + Math.abs(deltaAngle(angle2, angle3));

          const avgRadius = (arcRadius1 + arcRadius2) / 2.0;
          if (fuzzyLt(avgRadius * totalSweep, avgRadius * Math.PI, posEqualEps)) {
            const bulge = v1BulgeIsPos ? bulgeFromAngle(totalSweep) : -bulgeFromAngle(totalSweep);
            if (result === null) {
              result = this.createOutputFromVertexes(this.iterVertexes(), this.isClosed);
            }
            const p = result;
            const last = p.removeLast();
            p.setVertex(0, last.withBulge(bulge));
          }
        }
      }
    } else {
      // handle adding last vertex
      if (result !== null) {
        result.addOrReplaceVertex(
          unwrap(this.last(), "polyline has at least 2 vertexes"),
          posEqualEps,
        );
      } else {
        if (this.at(vc - 2).fuzzyEqEps(this.at(vc - 1), posEqualEps)) {
          result = this.createOutputFromVertexes(this.iterVertexes(), this.isClosed);
          result.removeLast();
        }
      }
    }

    return result;
  }

  /**
   * Rotates the vertexes in a closed polyline such that the first vertex's position is at
   * `point`. `startIndex` indicates which segment `point` lies on before rotation. This does
   * not change the shape of the polyline curve. `posEqualEps` is epsilon value used for
   * comparing the positions of points. `null` is returned if the polyline is not closed, the
   * polyline length is less than 2, or the `startIndex` is out of bounds.
   */
  rotateStart(startIndex: number, point: Vector2, posEqualEps: number): Polyline | null {
    const vc = this.vertexCount;
    if (!this.isClosed || vc < 2 || startIndex > vc - 1) {
      return null;
    }

    const wrappingVertexesStartingAt = (start: number): PlineVertex[] => {
      // mirrors Rust `iter_vertexes().skip(start).take(vc - start).chain(iter_vertexes().take(start))`
      const vertexes: PlineVertex[] = [];
      for (let j = start; j < vc; j += 1) {
        vertexes.push(this.at(j));
      }
      for (let j = 0; j < start; j += 1) {
        vertexes.push(this.at(j));
      }
      return vertexes;
    };

    const startV = this.at(startIndex);
    // Note: using with_capacity to ensure exact allocation required for the end result (avoids
    // over allocating and resize allocations)
    let result: Polyline;
    if (startV.pos().fuzzyEqEps(point, posEqualEps)) {
      // point lies on top of start index vertex
      const r = this.createOutputWithCapacity(vc, true);
      r.extendVertexes(wrappingVertexesStartingAt(startIndex));
      result = r;
    } else {
      // check if it's at the end of the segment, if it is then use that next index
      const nextIndex = this.nextWrappingIndex(startIndex);
      if (point.fuzzyEqEps(this.at(nextIndex).pos(), posEqualEps)) {
        const r = this.createOutputWithCapacity(vc, true);
        r.extendVertexes(wrappingVertexesStartingAt(nextIndex));
        result = r;
      } else {
        // must split at the point
        const r = this.createOutputWithCapacity(vc + 1, true);
        const split = segSplitAtPoint(this.at(startIndex), this.at(nextIndex), point, posEqualEps);
        r.addVertex(split.splitVertex);
        r.extendVertexes(wrappingVertexesStartingAt(nextIndex));
        r.setLast(split.updatedStart);
        result = r;
      }
    }

    return result;
  }

  /**
   * Creates a fast approximate spatial index of all the polyline segments.
   *
   * The starting vertex index position is used as the key to the segment bounding box in the
   * `StaticAabb2dIndex`. The bounding boxes are guaranteed to be no smaller than the actual
   * bounding box of the segment but may be larger, this is done for performance. If you want the
   * actual bounding box index use `createAabbIndex` instead.
   */
  createApproxAabbIndex(): StaticAabb2dIndex {
    const vc = this.vertexCount;
    if (vc < 2) {
      return new StaticAabb2dIndexBuilder(0).build();
    }

    const segCount = this.isClosed ? vc : vc - 1;

    const builder = new StaticAabb2dIndexBuilder(segCount);

    for (let i = 0; i < segCount; i += 1) {
      const v1 = this.at(i);
      const v2 = this.at(i === vc - 1 ? 0 : i + 1);
      const approxAabb = segFastApproxBoundingBox(v1, v2);
      builder.add(approxAabb.minX, approxAabb.minY, approxAabb.maxX, approxAabb.maxY);
    }

    return builder.build();
  }

  /**
   * Creates a spatial index of all the polyline segments.
   *
   * The starting vertex index position is used as the key to the segment bounding box in the
   * `StaticAabb2dIndex`. The bounding boxes are the actual bounding box of the segment, for
   * performance reasons you may want to use `createApproxAabbIndex`.
   */
  createAabbIndex(): StaticAabb2dIndex {
    const vc = this.vertexCount;
    if (vc < 2) {
      return new StaticAabb2dIndexBuilder(0).build();
    }

    const segCount = this.isClosed ? vc : vc - 1;

    const builder = new StaticAabb2dIndexBuilder(segCount);

    for (let i = 0; i < segCount; i += 1) {
      const v1 = this.at(i);
      const v2 = this.at(i === vc - 1 ? 0 : i + 1);
      const approxAabb = segBoundingBox(v1, v2);
      builder.add(approxAabb.minX, approxAabb.minY, approxAabb.maxX, approxAabb.maxY);
    }

    return builder.build();
  }

  /**
   * Find the closest segment point on a polyline to a `point` given.
   *
   * If the polyline is empty then `null` is returned.
   *
   * `posEqualEps` is epsilon value used for fuzzy float comparisons.
   */
  closestPoint(point: Vector2, posEqualEps: number): ClosestPointResult | null {
    if (this.isEmpty()) {
      return null;
    }

    const result: ClosestPointResult = {
      segStartIndex: 0,
      segPoint: this.at(0).pos(),
      distance: Number.MAX_VALUE,
    };

    if (this.vertexCount === 1) {
      result.distance = result.segPoint.sub(point).length();
      return result;
    }

    let distSquaredValue = Number.MAX_VALUE;

    const vc = this.vertexCount;
    const segCount = this.segmentCount();
    for (let i = 0; i < segCount; i += 1) {
      const j = i === vc - 1 ? 0 : i + 1;
      const v1 = this.at(i);
      const v2 = this.at(j);
      const cp = segClosestPoint(v1, v2, point, posEqualEps);
      const diffV = point.sub(cp);
      const dist2 = diffV.lengthSquared();
      if (dist2 < distSquaredValue) {
        result.segStartIndex = i;
        result.segPoint = cp;
        distSquaredValue = dist2;
      }
    }

    result.distance = Math.sqrt(distSquaredValue);

    return result;
  }

  /**
   * Calculate the winding number for a `point` relative to the polyline.
   *
   * The winding number calculates the number of turns/windings around a point that the polyline
   * path makes. For a closed polyline without self intersects there are only three
   * possibilities:
   *
   * * -1 (polyline winds around point clockwise)
   * * 0 (point is outside the polyline)
   * * 1 (polyline winds around the point counter clockwise).
   *
   * For a self intersecting closed polyline the winding number may be less than -1 (if the
   * polyline winds around the point more than once in the counter clockwise direction) or
   * greater than 1 (if the polyline winds around the point more than once in the clockwise
   * direction).
   *
   * This function always returns 0 if polyline `isClosed` is false.
   *
   * If the point lies directly on top of one of the polyline segments the result is not defined
   * (it may return any integer). To handle the case of the point lying directly on the polyline
   * `closestPoint` may be used to check if the distance from the point to the polyline is zero.
   */
  windingNumber(point: Vector2): number {
    if (!this.isClosed || this.vertexCount < 2) {
      return 0;
    }

    // Helper function for processing a line segment when computing the winding number.
    const processLineWinding = (v1: PlineVertex, v2: PlineVertex, pt: Vector2): number => {
      let result = 0;
      if (v1.y <= pt.y) {
        if (v2.y > pt.y && isLeft(v1.pos(), v2.pos(), pt)) {
          // left and upward crossing
          result += 1;
        }
      } else if (v2.y <= pt.y && !isLeft(v1.pos(), v2.pos(), pt)) {
        // right an downward crossing
        result -= 1;
      }

      return result;
    };

    // Helper function for processing an arc segment when computing the winding number.
    const processArcWinding = (v1: PlineVertex, v2: PlineVertex, pt: Vector2): number => {
      const isCcw = v1.bulgeIsPos();
      const pointIsLeft = isCcw
        ? isLeft(v1.pos(), v2.pos(), pt)
        : isLeftOrEqual(v1.pos(), v2.pos(), pt);

      const distToArcCenterLessThanRadius = (): boolean => {
        const [arcRadius, arcCenter] = segArcRadiusAndCenter(v1, v2);
        const dist2 = distSquared(arcCenter, pt);
        return dist2 < arcRadius * arcRadius;
      };

      let result = 0;

      if (v1.y <= pt.y) {
        if (v2.y > pt.y) {
          // upward crossing of arc chord
          if (isCcw) {
            if (pointIsLeft) {
              // counter clockwise arc left of chord
              result += 1;
            } else {
              // counter clockwise arc right of chord
              if (distToArcCenterLessThanRadius()) {
                result += 1;
              }
            }
          } else if (pointIsLeft) {
            // clockwise arc left of chord
            if (!distToArcCenterLessThanRadius()) {
              result += 1;
            }
            // else clockwise arc right of chord, no crossing
          }
        } else {
          // not crossing arc chord and chord is below, check if point is inside arc sector
          if (
            isCcw &&
            !pointIsLeft &&
            v2.x < pt.x &&
            pt.x < v1.x &&
            distToArcCenterLessThanRadius()
          ) {
            result += 1;
          } else if (
            !isCcw &&
            pointIsLeft &&
            v1.x < pt.x &&
            pt.x < v2.x &&
            distToArcCenterLessThanRadius()
          ) {
            result -= 1;
          }
        }
      } else if (v2.y <= pt.y) {
        // downward crossing of arc chord
        if (isCcw) {
          if (!pointIsLeft) {
            // counter clockwise arc right of chord
            if (!distToArcCenterLessThanRadius()) {
              result -= 1;
            }
          }
          // else counter clockwise arc left of chord, no crossing
        } else if (pointIsLeft) {
          // clockwise arc left of chord
          if (distToArcCenterLessThanRadius()) {
            result -= 1;
          }
        } else {
          // clockwise arc right of chord
          result -= 1;
        }
      } else {
        // not crossing arc chord and chord is above, check if point is inside arc sector
        if (
          isCcw &&
          !pointIsLeft &&
          v1.x < pt.x &&
          pt.x < v2.x &&
          distToArcCenterLessThanRadius()
        ) {
          result += 1;
        } else if (
          !isCcw &&
          pointIsLeft &&
          v2.x < pt.x &&
          pt.x < v1.x &&
          distToArcCenterLessThanRadius()
        ) {
          result -= 1;
        }
      }

      return result;
    };

    let winding = 0;

    const vc = this.vertexCount;
    const segCount = this.segmentCount();
    for (let i = 0; i < segCount; i += 1) {
      const v1 = this.at(i);
      const v2 = this.at(i === vc - 1 ? 0 : i + 1);
      if (v1.bulgeIsZero()) {
        winding += processLineWinding(v1, v2, point);
      } else {
        winding += processArcWinding(v1, v2, point);
      }
    }

    return winding;
  }

  /**
   * Returns a new polyline with all arc segments converted to line segments with some
   * `errorDistance` or `null` if the segment count fails to compute as a finite number
   * (Rust: `Self::Num` fails to cast to or from usize).
   *
   * `errorDistance` is the maximum distance from any line segment to the arc it is
   * approximating. Line segments are circumscribed by the arc (all line end points lie on the
   * arc path).
   */
  arcsToApproxLines(errorDistance: number): Polyline | null {
    const result = this.createOutputWithCapacity(0, this.isClosed);

    // catch case where polyline is empty since we may index into the last vertex later
    if (this.isEmpty()) {
      return result;
    }

    const absError = Math.abs(errorDistance);

    const vc = this.vertexCount;
    const segTotal = this.segmentCount();
    for (let s = 0; s < segTotal; s += 1) {
      const v1 = this.at(s);
      const v2 = this.at(s === vc - 1 ? 0 : s + 1);
      if (v1.bulgeIsZero()) {
        result.addVertex(v1);
        continue;
      }

      const [arcRadius, arcCenter] = segArcRadiusAndCenter(v1, v2);
      if (fuzzyLt(arcRadius, errorDistance)) {
        result.add(v1.x, v1.y, 0.0);
        continue;
      }

      const startAngle = angle(arcCenter, v1.pos());
      const endAngle = angle(arcCenter, v2.pos());
      const angleDiff = Math.abs(deltaAngle(startAngle, endAngle));

      const segSubAngle = 2.0 * Math.abs(Math.acos(1.0 - absError / arcRadius));
      const segCount = Math.ceil(angleDiff / segSubAngle);
      // create angle offset such that all lines have an equal part of the arc
      const segAngleOffset = v1.bulgeIsNeg() ? -angleDiff / segCount : angleDiff / segCount;

      // add start vertex
      result.add(v1.x, v1.y, 0.0);
      // Rust `seg_count.to_usize()?` (propagates `None` on failed cast)
      if (!Number.isFinite(segCount)) {
        return null;
      }
      const usizeCount = segCount;
      // add all vertex points along arc
      for (let i = 1; i < usizeCount; i += 1) {
        const anglePos = i;
        const vertexAngle = anglePos * segAngleOffset + startAngle;
        const pos = pointOnCircle(arcRadius, arcCenter, vertexAngle);
        result.add(pos.x, pos.y, 0.0);
      }
    }

    if (!this.isClosed) {
      // add the final missing vertex in the case that the polyline is not closed
      result.addVertex(unwrap(this.last(), "polyline is not empty here"));
    }

    return result;
  }

  /**
   * Visit self intersects of the polyline using default options.
   *
   * Returns `true` if the visitor ran to completion, `false` if the visitor returned `false`
   * to break.
   */
  visitSelfIntersects(visitor: PlineIntersectVisitor): boolean {
    return this.visitSelfIntersectsOpt(visitor, {});
  }

  /**
   * Visit self intersects of the polyline using options provided.
   *
   * Returns `true` if the visitor ran to completion, `false` if the visitor returned `false`
   * to break.
   */
  visitSelfIntersectsOpt(
    visitor: PlineIntersectVisitor,
    options: PlineSelfIntersectOptions,
  ): boolean {
    if (this.vertexCount < 2) {
      return true;
    }

    const defaults = defaultPlineSelfIntersectOptions();
    const posEqualEps = options.posEqualEps ?? defaults.posEqualEps;
    const include = options.include ?? defaults.include;

    if (include === "local") {
      // local intersects only
      return visitLocalSelfIntersects(this, visitor, posEqualEps);
    }

    const index = options.aabbIndex ?? this.createApproxAabbIndex();

    if (include === "global") {
      // global intersects only
      return visitGlobalSelfIntersects(this, index, visitor, posEqualEps);
    }

    // else all intersects
    if (!visitLocalSelfIntersects(this, visitor, posEqualEps)) {
      return false;
    }

    return visitGlobalSelfIntersects(this, index, visitor, posEqualEps);
  }

  /** Visit all intersects between two polylines using default options. */
  visitIntersects(other: PlineSourceBase, visitor: TwoPlinesIntersectVisitor): void {
    this.visitIntersectsOpt(other, visitor, {});
  }

  /** Visit all intersects between two polylines using the options provided. */
  visitIntersectsOpt(
    other: PlineSourceBase,
    visitor: TwoPlinesIntersectVisitor,
    options: FindIntersectsOptions,
  ): void {
    visitIntersectsInternal(this, other, visitor, options);
  }

  /**
   * Scan for self intersects using default options.
   * Returns true on the first one found; false if there are none.
   */
  scanForSelfIntersect(): boolean {
    return this.scanForSelfIntersectOpt({});
  }

  /**
   * Scan for self intersects using options provided.
   * Returns true on the first one found; false if there are none.
   */
  scanForSelfIntersectOpt(options: PlineSelfIntersectOptions): boolean {
    let foundIntersects = false;
    this.visitSelfIntersectsOpt(() => {
      foundIntersects = true;
      // stop visiting on first intersect found (Rust `Control::Break(())`)
      return false;
    }, options);
    return foundIntersects;
  }

  /** Find all intersects between two polylines using default options. */
  findIntersects(other: PlineSourceBase): PlineIntersectsCollection {
    return this.findIntersectsOpt(other, {});
  }

  /** Find all intersects between two polylines using the options provided. */
  findIntersectsOpt(
    other: PlineSourceBase,
    options: FindIntersectsOptions,
  ): PlineIntersectsCollection {
    return findIntersectsInternal(this, other, options);
  }

  /**
   * Compute the parallel offset polylines of the polyline using default options.
   *
   * `offset` determines what offset polylines are generated, if it is positive then the
   * direction of the offset is to the left of the polyline segment tangent vectors otherwise it
   * is to the right.
   */
  parallelOffset(offset: number): Polyline[] {
    return this.parallelOffsetOpt(offset, defaultPlineOffsetOptions());
  }

  /**
   * Compute the parallel offset polylines of the polyline with options given.
   *
   * `offset` determines what offset polylines are generated, if it is positive then the
   * direction of the offset is to the left of the polyline segment tangent vectors otherwise it
   * is to the right.
   *
   * `options` is a struct that holds optional parameters. See `PlineOffsetOptions` for specific
   * parameters.
   */
  parallelOffsetOpt(offset: number, options: PlineOffsetOptions): Polyline[] {
    return invokeParallelOffset(this, offset, options);
  }

  /**
   * Perform a boolean `operation` between this polyline and another using default options.
   *
   * See `booleanOpt` for more information.
   */
  boolean(other: PlineSourceBase, operation: BooleanOp): BooleanResult<Polyline> {
    return this.booleanOpt(other, operation, {});
  }

  /**
   * Perform a boolean `operation` between this polyline and another with options provided.
   *
   * Returns the boolean result polylines and their associated slices that were stitched together
   * end to end to form them. For the result `pline1` refers to `this`, and `pline2` refers to
   * `other`.
   */
  booleanOpt(
    other: PlineSourceBase,
    operation: BooleanOp,
    options: PlineBooleanOptions,
  ): BooleanResult<Polyline> {
    return getPolylineBooleanImpl()(this, other, operation, options);
  }

  /**
   * Determine if this polyline fully contains another using default options.
   *
   * Caution: Polylines with self-intersections may generate unexpected results.
   * Use `scanForSelfIntersect()` to find and reject self-intersecting polylines
   * if this is a possibility for your input data.
   */
  contains(other: PlineSourceBase): PlineContainsResult {
    return this.containsOpt(other, {});
  }

  /**
   * Determine if this polyline fully contains another with options provided.
   *
   * Caution: Polylines with self-intersections may generate unexpected results.
   * Use `scanForSelfIntersect()` to find and reject self-intersecting polylines
   * if this is a possibility for your input data.
   */
  containsOpt(other: PlineSourceBase, options: PlineContainsOptions): PlineContainsResult {
    return polylineContains(this, other, options);
  }

  /**
   * Find the segment index and point on the polyline corresponding to the path length given.
   *
   * Returns `{ ok: true, segIndex: 0, point: firstVertexPosition }` if `targetPathLength` is
   * negative.
   *
   * Returns `{ ok: true, segIndex, point }` if `targetPathLength` is less than or equal to the
   * polyline's total path length. Where `segIndex` is the index of the segment the point lies
   * on, e.g. if point is on the second segment of the polyline then `segIndex = 1`.
   *
   * Returns `{ ok: false, pathLength: totalPathLength }` if `targetPathLength` is greater than
   * total path length of the polyline.
   */
  findPointAtPathLength(targetPathLength: number): FindPointAtPathLengthResult {
    if (targetPathLength <= 0.0) {
      return { ok: true, segIndex: 0, point: this.at(0).pos() };
    }

    let accLength = 0.0;
    const vc = this.vertexCount;
    const segCount = this.segmentCount();
    for (let i = 0; i < segCount; i += 1) {
      const v1 = this.at(i);
      const v2 = this.at(i === vc - 1 ? 0 : i + 1);
      const segLen = segLength(v1, v2);
      const sumLen = accLength + segLen;
      if (sumLen < targetPathLength) {
        accLength = sumLen;
        continue;
      }

      // parametric value (from 0 to 1) along the segment where the point lies
      const t = (targetPathLength - accLength) / segLen;

      if (v1.bulgeIsZero()) {
        // line segment
        const pt = v1.pos().add(v2.pos().sub(v1.pos()).scale(t));
        return { ok: true, segIndex: i, point: pt };
      } else {
        // arc segment
        const [radius, center] = segArcRadiusAndCenter(v1, v2);
        const startAngle = angle(center, v1.pos());
        const totalSweepAngle = angleFromBulge(v1.bulge);
        const targetAngle = startAngle + totalSweepAngle * t;

        const pt = pointOnCircle(radius, center, targetAngle);
        return { ok: true, segIndex: i, point: pt };
      }
    }

    return { ok: false, pathLength: accLength };
  }
}

/**
 * Abstract class representing a mutable source of polyline data. This class has all the methods
 * and operations that can be performed on a mutable polyline.
 *
 * Port of the Rust `PlineSourceMut` trait (see `PlineSourceBase` for the readonly methods).
 */
export abstract class PlineSourceMutBase extends PlineSourceBase {
  /** Set the vertex data at the given `index` position of the polyline. */
  abstract setVertex(index: number, vertex: PlineVertex): void;

  /** Insert a new vertex into the polyline at the given `index` position. */
  abstract insertVertex(index: number, vertex: PlineVertex): void;

  /** Remove vertex at the given `index` position and return it. */
  abstract remove(index: number): PlineVertex;

  /** Clear all vertexes of the polyline. */
  abstract clear(): void;

  /** Add a vertex to the end of the polyline. */
  abstract addVertex(vertex: PlineVertex): void;

  /** Append all vertexes from an iterable to the end of this polyline. */
  abstract extendVertexes(vertexes: Iterable<PlineVertex>): void;

  /** Reserves capacity for at least `additional` more vertexes (no-op for JS arrays). */
  abstract reserve(additional: number): void;

  /** Set whether the polyline is closed (`isClosed = true`) or open (`isClosed = false`). */
  abstract setIsClosed(isClosed: boolean): void;

  /**
   * Clears all existing user data values and replaces them with the provided values.
   *
   * User data values are integers that can be associated with polylines for storing custom
   * application-specific data.
   */
  setUserdataValues(values: Iterable<number>): void {
    const newValues = Array.from(values);
    const userdata = this.userdata;
    userdata.length = 0;
    for (const v of newValues) {
      userdata.push(v);
    }
  }

  /**
   * Appends additional user data values to the existing user data storage.
   *
   * User data values are integers that can be associated with polylines for storing custom
   * application-specific data.
   */
  addUserdataValues(values: Iterable<number>): void {
    const userdata = this.userdata;
    for (const v of values) {
      userdata.push(v);
    }
  }

  /**
   * Same as `setVertex` but accepts each component of the vertex rather than a vertex
   * structure.
   */
  set(index: number, x: number, y: number, bulge: number): void {
    this.setVertex(index, new PlineVertex(x, y, bulge));
  }

  /**
   * Set the last vertex of the polyline.
   *
   * @throws Error if polyline is empty.
   */
  setLast(vertex: PlineVertex): void {
    this.setVertex(this.vertexCount - 1, vertex);
  }

  /**
   * Same as `insertVertex` but accepts each component of the vertex rather than a vertex
   * structure.
   */
  insert(index: number, x: number, y: number, bulge: number): void {
    this.insertVertex(index, new PlineVertex(x, y, bulge));
  }

  /**
   * Remove the last vertex from the polyline and return it.
   *
   * @throws Error if polyline is empty.
   */
  removeLast(): PlineVertex {
    return this.remove(this.vertexCount - 1);
  }

  /**
   * Same as `addVertex` but accepts each component of the vertex rather than a vertex
   * structure.
   */
  add(x: number, y: number, bulge: number): void {
    this.addVertex(new PlineVertex(x, y, bulge));
  }

  /**
   * Same as `addVertex` but accepts each component as elements in an array,
   * 0 = x, 1 = y, 2 = bulge.
   */
  addFromArray(data: readonly [number, number, number]): void {
    this.add(data[0], data[1], data[2]);
  }

  /** Copy all vertexes from `other` to the end of this polyline. */
  extend(other: PlineSourceBase): void {
    this.extendVertexes(other.iterVertexes());
  }

  /**
   * Same as `extend` but removes any consecutive repeat position vertexes in the
   * process of copying (using `posEqualEps` for compare).
   */
  extendRemoveRepeat(other: PlineSourceBase, posEqualEps: number): void {
    this.reserve(other.vertexCount);
    for (const v of other.iterVertexes()) {
      this.addOrReplaceVertex(v, posEqualEps);
    }
  }

  /**
   * Add a vertex if it's position is not fuzzy equal to the last vertex in the polyline.
   *
   * If the vertex position is fuzzy equal then just update the bulge of the last vertex with
   * the bulge given.
   */
  addOrReplaceVertex(vertex: PlineVertex, posEqualEps: number): void {
    const vc = this.vertexCount;
    if (vc === 0) {
      this.addVertex(vertex);
      return;
    }

    const last = this.at(vc - 1);
    if (last.pos().fuzzyEqEps(vertex.pos(), posEqualEps)) {
      this.setVertex(vc - 1, last.withBulge(vertex.bulge));
      return;
    }

    this.addVertex(vertex);
  }

  /**
   * Same as `addOrReplaceVertex` but accepts each component of the vertex rather than a vertex
   * structure.
   */
  addOrReplace(x: number, y: number, bulge: number, posEqualEps: number): void {
    this.addOrReplaceVertex(new PlineVertex(x, y, bulge), posEqualEps);
  }

  /** Uniformly scale the polyline (mutably) in the xy plane by `scaleFactor`. */
  scaleMut(scaleFactor: number): void {
    for (let i = 0; i < this.vertexCount; i += 1) {
      const v = this.at(i);
      this.set(i, scaleFactor * v.x, scaleFactor * v.y, v.bulge);
    }
  }

  /** Translate the polyline (mutably) by some `x` offset and `y` offset. */
  translateMut(x: number, y: number): void {
    for (let i = 0; i < this.vertexCount; i += 1) {
      const v = this.at(i);
      this.set(i, v.x + x, v.y + y, v.bulge);
    }
  }

  /**
   * Invert/reverse the direction of the polyline in place (mutably).
   *
   * This method works by simply reversing the order of the vertexes, shifting by 1 position all
   * the vertexes, and inverting the sign of all the bulge values. E.g. after reversing the
   * vertex the bulge at index 0 becomes negative bulge at index 1. The end result for a closed
   * polyline is the direction will be changed from clockwise to counter clockwise or vice versa.
   */
  invertDirectionMut(): void {
    const vc = this.vertexCount;
    if (vc < 2) {
      return;
    }

    let start = 0;
    let end = vc - 1;
    while (start < end) {
      const s = this.at(start);
      const e = this.at(end);
      this.setVertex(start, e);
      this.setVertex(end, s);
      start += 1;
      end -= 1;
    }

    const firstBulge = this.at(0).bulge;
    for (let i = 1; i < vc; i += 1) {
      const b = -this.at(i).bulge;
      this.setVertex(i - 1, this.at(i - 1).withBulge(b));
    }

    if (this.isClosed) {
      this.setVertex(vc - 1, this.at(vc - 1).withBulge(-firstBulge));
    }
  }
}
