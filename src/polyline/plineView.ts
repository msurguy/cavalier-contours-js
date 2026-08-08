/**
 * Polyline views (partial selections/subparts of a source polyline without copying).
 *
 * Port of `polyline/pline_view.rs`. `PlineViewData` is the canonical definition of the view data
 * shape used across the library (`plineTypes.ts` imports the type from here for
 * `BooleanPlineSlice`).
 */
import { debugAssert } from "../core/controlFlow.js";
import { fuzzyEqEps } from "../core/fuzzy.js";
import { distSquared } from "../core/mathUtils.js";
import type { Vector2 } from "../core/vector2.js";
import { segClosestPoint, segSplitAtPoint } from "./plineSeg.js";
import { PlineSourceBase } from "./plineSourceBase.js";
import { PlineVertex } from "./plineVertex.js";
import { Polyline } from "./polyline.js";

/**
 * A `PlineView` represents a partial selection or subpart of a source polyline without copying.
 * This structure holds a reference to a source polyline to access vertex data for iteration and
 * operations.
 *
 * See `PlineViewData` for how to create different types of views/selections.
 */
export class PlineView extends PlineSourceBase {
  /** Reference to the source polyline for this view. */
  readonly source: PlineSourceBase;
  /** View data used for indexing into the `source` polyline. */
  readonly data: PlineViewData;

  /** Create a new view with the given source and data. */
  constructor(source: PlineSourceBase, data: PlineViewData) {
    super();
    this.source = source;
    this.data = data;
  }

  /** Return the associated view data (Rust `detach` releases the borrow on the source). */
  detach(): PlineViewData {
    return this.data;
  }

  get userdata(): number[] {
    return this.source.userdata;
  }

  get vertexCount(): number {
    return this.data.vertexCount();
  }

  get isClosed(): boolean {
    return false;
  }

  get(index: number): PlineVertex | null {
    return this.data.getVertex(this.source, index);
  }

  at(index: number): PlineVertex {
    const v = this.data.getVertex(this.source, index);
    if (v === null) {
      throw new Error(
        `vertex index ${index} out of bounds (view has ${this.data.vertexCount()} vertexes)`,
      );
    }
    return v;
  }

  protected createOutputWithCapacity(capacity: number, isClosed: boolean): Polyline {
    return Polyline.withCapacity(capacity, isClosed);
  }

  protected createOutputFromVertexes(
    vertexes: Iterable<PlineVertex>,
    isClosed: boolean,
  ): Polyline {
    return Polyline.fromVertexes(vertexes, isClosed);
  }
}

/**
 * Structure to hold the minimum data required to create view as a partial selection over a source
 * polyline. This structure is detached from the source polyline unlike `PlineView`.
 *
 * A `PlineViewData` has all the information required to construct a complete polyline that
 * represents the contiguous subpart of a source polyline (which optionally may be inverted).
 *
 * `PlineViewData.view` is called to form an active view (using a reference to the source polyline
 * to then iterate over or perform operations on).
 */
export class PlineViewData {
  /** Source polyline start segment index. */
  startIndex: number;
  /** Wrapping offset from `startIndex` to reach the last segment index in the source polyline. */
  endIndexOffset: number;
  /**
   * First vertex of the view (positioned somewhere along the `startIndex` segment with bulge
   * and position updated).
   */
  updatedStart: PlineVertex;
  /** Updated bulge value to be used in the end index segment. */
  updatedEndBulge: number;
  /** Final end point of the view. */
  endPoint: Vector2;
  /**
   * Whether the view direction is inverted or not, note this just affects the way vertexes are
   * constructed from the source polyline, all properties stay oriented/defined the same.
   */
  invertedDirection: boolean;

  constructor(
    startIndex: number,
    endIndexOffset: number,
    updatedStart: PlineVertex,
    updatedEndBulge: number,
    endPoint: Vector2,
    invertedDirection: boolean,
  ) {
    this.startIndex = startIndex;
    this.endIndexOffset = endIndexOffset;
    this.updatedStart = updatedStart;
    this.updatedEndBulge = updatedEndBulge;
    this.endPoint = endPoint;
    this.invertedDirection = invertedDirection;
  }

  /** Create a `PlineView` using the `source` polyline given. */
  view(source: PlineSourceBase): PlineView {
    debugAssert(
      this.validateForSource(source).kind === "isValid",
      "view data must be valid for source",
    );

    return new PlineView(source, this);
  }

  /**
   * Number of vertexes in the view (Rust private `vertex_count`; exposed for `PlineView`
   * internal use).
   */
  vertexCount(): number {
    return this.endIndexOffset + 2;
  }

  /**
   * Get vertex at given `index` position based on this view data and a `source`. Note this
   * method is intended for internal use — `PlineViewData.view` should be called to get a
   * `PlineView` to access the underlying data through the view.
   */
  getVertex(source: PlineSourceBase, index: number): PlineVertex | null {
    if (index < 0 || index >= this.vertexCount()) {
      return null;
    }

    if (this.invertedDirection) {
      // inverted direction example
      // |0123456789| <-- source
      // |----    ^-| <-- view selected range (start_index = 8, offset = 5)
      // index = 0 --> end_point on seg starting at 3, -updated_end_bulge
      // index = 1 --> vert 3 with negative bulge from vert 2
      // index = 2 --> vert 2 with negative bulge from vert 1
      // index = 3 --> vert 1 with negative bulge from vert 0
      // index = 4 --> vert 0 with negative bulge from vert 9
      // index = 5 (offset) --> vert 9 with negative updated start bulge
      // index = 6 (offset + 1) --> updated start with 0 bulge

      if (index === 0) {
        const v = PlineVertex.fromVector2(this.endPoint, -this.updatedEndBulge);
        return v;
      }

      if (index < this.endIndexOffset) {
        const bulgeI = source.fwdWrappingIndex(this.startIndex, this.endIndexOffset - index);
        const i = source.nextWrappingIndex(bulgeI);
        return source.at(i).withBulge(-source.at(bulgeI).bulge);
      }

      if (index === this.endIndexOffset) {
        const i = source.fwdWrappingIndex(this.startIndex, this.endIndexOffset - index + 1);

        const v = source.at(i);
        return v.withBulge(-this.updatedStart.bulge);
      }

      if (index === this.endIndexOffset + 1) {
        return this.updatedStart.withBulge(0.0);
      }
    } else {
      if (index === 0) {
        return this.updatedStart;
      }

      if (index < this.endIndexOffset) {
        const i = source.fwdWrappingIndex(this.startIndex, index);
        return source.at(i);
      }

      if (index === this.endIndexOffset) {
        const i = source.fwdWrappingIndex(this.startIndex, this.endIndexOffset);
        const v = source.at(i);
        return v.withBulge(this.updatedEndBulge);
      }

      if (index === this.endIndexOffset + 1) {
        return PlineVertex.fromVector2(this.endPoint, 0.0);
      }
    }

    return null;
  }

  /**
   * Create view data from source polyline that selects over a single segment.
   *
   * Returns `null` if `updatedStart` is on top of `endIntersect` (collapsed selection).
   */
  static createOnSingleSegment(
    source: PlineSourceBase,
    startIndex: number,
    updatedStart: PlineVertex,
    endIntersect: Vector2,
    posEqualEps: number,
  ): PlineViewData | null {
    if (updatedStart.pos().fuzzyEqEps(endIntersect, posEqualEps)) {
      return null;
    }
    const viewData = new PlineViewData(
      startIndex,
      0,
      updatedStart,
      updatedStart.bulge,
      endIntersect,
      false,
    );

    debugAssert(
      viewData.validateForSource(source).kind === "isValid",
      "view data must be valid for source",
    );

    return viewData;
  }

  /**
   * Create view data from source polyline and parameters.
   *
   * @throws Error if `traverseCount === 0` or indexes out of range for `source`. Use
   * `createOnSingleSegment` if view selects over only a single segment.
   */
  static create(
    source: PlineSourceBase,
    startIndex: number,
    endIntersect: Vector2,
    intersectIndex: number,
    updatedStart: PlineVertex,
    traverseCount: number,
    posEqualEps: number,
  ): PlineViewData {
    if (traverseCount === 0) {
      throw new Error(
        "traverse_count must be greater than 1, use different constructor if view is all on one segment",
      );
    }

    const currentVertex = source.at(intersectIndex);
    let endIndexOffset: number;
    let updatedEndBulge: number;
    if (endIntersect.fuzzyEqEps(currentVertex.pos(), posEqualEps)) {
      // intersect lies on top of vertex at start of segment
      const offset = traverseCount - 1;
      let bulge: number;
      if (offset !== 0) {
        bulge = source.at(source.prevWrappingIndex(intersectIndex)).bulge;
      } else {
        bulge = updatedStart.bulge;
      }
      endIndexOffset = offset;
      updatedEndBulge = bulge;
    } else {
      // trim bulge to intersect position
      const nextIndex = source.nextWrappingIndex(intersectIndex);
      const split = segSplitAtPoint(currentVertex, source.at(nextIndex), endIntersect, posEqualEps);
      endIndexOffset = traverseCount;
      updatedEndBulge = split.updatedStart.bulge;
    }

    const viewData = new PlineViewData(
      startIndex,
      endIndexOffset,
      updatedStart,
      updatedEndBulge,
      endIntersect,
      false,
    );

    debugAssert(
      viewData.validateForSource(source).kind === "isValid",
      "view data must be valid for source",
    );

    return viewData;
  }

  /**
   * Construct view representing an entire polyline. The view is always considered an open
   * polyline even if the source given is closed (but the view will geometrically follow the same
   * closed path).
   *
   * @throws Error if `source` has less than 2 vertexes or indexes out of range for `source`.
   */
  static fromEntirePline(source: PlineSourceBase): PlineViewData {
    const vc = source.vertexCount;
    if (!(vc >= 2)) {
      throw new Error("source must have at least 2 vertexes to form view data");
    }

    let viewData: PlineViewData;
    if (source.isClosed) {
      viewData = new PlineViewData(
        0,
        vc - 1,
        source.at(0),
        source.at(vc - 1).bulge, // Rust `source.last().unwrap().bulge` (vc >= 2 asserted above)
        source.at(0).pos(),
        false,
      );
    } else {
      viewData = new PlineViewData(
        0,
        vc - 2,
        source.at(0),
        source.at(vc - 2).bulge,
        source.at(vc - 1).pos(),
        false,
      );
    }

    debugAssert(
      viewData.validateForSource(source).kind === "isValid",
      "view data must be valid for source",
    );

    return viewData;
  }

  /**
   * Construct view which changes the start point of a polyline. If the polyline is open this
   * will trim the polyline up to the start point. If the polyline is closed then the entire
   * polyline path is retained with just the start point changed. Returns `null` if polyline is
   * open and start point equals the final vertex position for the polyline.
   *
   * @throws Error if `source` has less than 2 vertexes or `startIndex` out of range for
   * `source`.
   */
  static fromNewStart(
    source: PlineSourceBase,
    startPoint: Vector2,
    startIndex: number,
    posEqualEps: number,
  ): PlineViewData | null {
    // check if open polyline then just delegate to slice points method
    if (!source.isClosed) {
      const last = source.last();
      if (last === null) {
        return null;
      }
      return PlineViewData.fromSlicePoints(
        source,
        startPoint,
        startIndex,
        last.pos(),
        source.vertexCount - 1,
        posEqualEps,
      );
    }

    const vc = source.vertexCount;
    if (!(vc >= 2)) {
      throw new Error("source must have at least 2 vertexes to form view data");
    }

    // catch where start point is at very end of start index segment (and adjust forward)
    let adjustedStartIndex: number;
    {
      const nextIndex = source.nextWrappingIndex(startIndex);
      if (source.at(nextIndex).pos().fuzzyEqEps(startPoint, posEqualEps)) {
        adjustedStartIndex = nextIndex;
      } else {
        adjustedStartIndex = startIndex;
      }
    }

    const startV1 = source.at(adjustedStartIndex);
    const startV2 = source.at(source.nextWrappingIndex(adjustedStartIndex));
    const split = segSplitAtPoint(startV1, startV2, startPoint, posEqualEps);

    let endIndexOffset: number;
    let updatedEndBulge: number;
    if (startV1.pos().fuzzyEqEps(startPoint, posEqualEps)) {
      // start point on top of vertex, adjust index offset and do not use split bulge
      endIndexOffset = vc - 1;
      updatedEndBulge = source.at(source.prevWrappingIndex(adjustedStartIndex)).bulge;
    } else {
      endIndexOffset = vc;
      updatedEndBulge = split.updatedStart.bulge;
    }

    const viewData = new PlineViewData(
      adjustedStartIndex,
      endIndexOffset,
      split.splitVertex,
      updatedEndBulge,
      startPoint,
      false,
    );

    debugAssert(
      viewData.validateForSource(source).kind === "isValid",
      "view data must be valid for source",
    );

    return viewData;
  }

  /**
   * Construct view that is contiguous between two points on a source polyline (start and end of
   * source polyline are trimmed).
   *
   * @throws Error if `source` has less than 2 vertexes or indexes out of range for `source`.
   */
  static fromSlicePoints(
    source: PlineSourceBase,
    startPoint: Vector2,
    startIndex: number,
    endPoint: Vector2,
    endIndex: number,
    posEqualEps: number,
  ): PlineViewData | null {
    debugAssert(
      startIndex <= endIndex || source.isClosed,
      "start index should be less than or equal to end index if polyline is open",
    );

    // catch if start_point is at end of first segment
    let adjustedStartIndex: number;
    let startPointAtSegEnd: boolean;
    {
      if (!source.isClosed && startIndex >= endIndex) {
        // not possible to wrap index forward
        adjustedStartIndex = startIndex;
        startPointAtSegEnd = false;
      } else {
        const nextIndex = source.nextWrappingIndex(startIndex);
        if (source.at(nextIndex).pos().fuzzyEqEps(startPoint, posEqualEps)) {
          adjustedStartIndex = nextIndex;
          startPointAtSegEnd = true;
        } else {
          adjustedStartIndex = startIndex;
          startPointAtSegEnd = false;
        }
      }
    }

    let traverseCount: number;
    {
      const indexDist = source.fwdWrappingDist(adjustedStartIndex, endIndex);
      if (
        indexDist === 0 &&
        source.isClosed &&
        !startPoint.fuzzyEqEps(endPoint, posEqualEps)
      ) {
        const segStart = source.at(adjustedStartIndex).pos();
        const dist1 = distSquared(segStart, startPoint);
        const dist2 = distSquared(segStart, endPoint);
        if (dist1 < dist2) {
          // not wrapping around polyline, on same segment
          traverseCount = 0;
        } else {
          // wrapping around polyline back to same segment
          traverseCount = source.vertexCount;
        }
      } else {
        traverseCount = indexDist;
      }
    }

    // compute updated start vertex
    let updatedStart: PlineVertex;
    {
      const startV1 = source.at(adjustedStartIndex);
      const startV2 = source.at(source.nextWrappingIndex(adjustedStartIndex));
      if (startPointAtSegEnd) {
        // start point on top of vertex no need to split using start_point
        if (traverseCount === 0) {
          // start and end point on same segment, split at end point
          const split = segSplitAtPoint(startV1, startV2, endPoint, posEqualEps);
          updatedStart = split.updatedStart;
        } else {
          updatedStart = startV1;
        }
      } else {
        // split at start point
        const startSplit = segSplitAtPoint(startV1, startV2, startPoint, posEqualEps);
        const updatedForStart = startSplit.splitVertex;
        if (traverseCount === 0) {
          // start and end point on same segment, split at end point
          const split = segSplitAtPoint(updatedForStart, startV2, endPoint, posEqualEps);
          updatedStart = split.updatedStart;
        } else {
          updatedStart = updatedForStart;
        }
      }
    }

    if (traverseCount === 0) {
      return PlineViewData.createOnSingleSegment(
        source,
        adjustedStartIndex,
        updatedStart,
        endPoint,
        posEqualEps,
      );
    } else if (
      traverseCount === 1 &&
      endPoint.fuzzyEqEps(source.at(endIndex).pos(), posEqualEps) &&
      updatedStart.pos().fuzzyEqEps(endPoint, posEqualEps)
    ) {
      return null;
    } else {
      return PlineViewData.create(
        source,
        adjustedStartIndex,
        endPoint,
        endIndex,
        updatedStart,
        traverseCount,
        posEqualEps,
      );
    }
  }

  /** Epsilon value to be used by `validateForSource`. */
  static readonly VALIDATION_EPS = 1e-5;

  /**
   * Epsilon value to be used by `validateForSource` when testing if positions are fuzzy equal.
   */
  static readonly VALIDATION_POINT_ON_SEG_EPS = 1e-3;

  /**
   * Function mostly used for debugging and asserts, checks that this slice's properties are
   * valid for the source polyline provided.
   */
  validateForSource(source: PlineSourceBase): ViewDataValidation {
    if (source.vertexCount < 2) {
      return { kind: "sourceHasNoSegments" };
    }

    if (this.endIndexOffset > source.vertexCount) {
      return {
        kind: "offsetOutOfRange",
        offset: this.endIndexOffset,
        sourceLength: source.vertexCount,
      };
    }

    const validationEps = PlineViewData.VALIDATION_EPS;

    const pointIsOnSegment = (segIndex: number, point: Vector2): boolean => {
      const onSegEps = PlineViewData.VALIDATION_POINT_ON_SEG_EPS;
      const v1 = source.at(segIndex);
      const v2 = source.at(source.nextWrappingIndex(segIndex));
      if (point.fuzzyEqEps(v1.pos(), onSegEps) || point.fuzzyEqEps(v2.pos(), onSegEps)) {
        return true;
      }
      const closestPoint = segClosestPoint(v1, v2, point, validationEps);
      return closestPoint.fuzzyEqEps(point, onSegEps);
    };
    // check that updated start lies on the source polyline according to start index segment
    if (!pointIsOnSegment(this.startIndex, this.updatedStart.pos())) {
      return { kind: "updatedStartNotOnSegment", startPoint: this.updatedStart.pos() };
    }

    // check that end point lies on the source polyline according to end index segment
    const endIndex = source.fwdWrappingIndex(this.startIndex, this.endIndexOffset);
    if (!pointIsOnSegment(endIndex, this.endPoint)) {
      return { kind: "endPointNotOnSegment", endPoint: this.endPoint };
    }

    // end point should never lie directly on top of end index segment start
    if (this.endPoint.fuzzyEqEps(source.at(endIndex).pos(), validationEps)) {
      return {
        kind: "endPointOnFinalOffsetVertex",
        endPoint: this.endPoint,
        finalOffsetVertex: source.at(endIndex),
      };
    }

    if (this.endIndexOffset === 0) {
      // end point on start index segment, check that updated bulge matches updated start
      // bulge
      if (!fuzzyEqEps(this.updatedEndBulge, this.updatedStart.bulge, validationEps)) {
        return {
          kind: "updatedBulgeDoesNotMatch",
          updatedBulge: this.updatedEndBulge,
          expected: this.updatedStart.bulge,
        };
      }
    }

    return { kind: "isValid" };
  }
}

/** Discriminated union used for view data validation debugging and asserting. */
export type ViewDataValidation =
  | { kind: "sourceHasNoSegments" }
  | { kind: "offsetOutOfRange"; offset: number; sourceLength: number }
  | { kind: "updatedStartNotOnSegment"; startPoint: Vector2 }
  | { kind: "endPointNotOnSegment"; endPoint: Vector2 }
  | { kind: "endPointOnFinalOffsetVertex"; endPoint: Vector2; finalOffsetVertex: PlineVertex }
  | { kind: "updatedBulgeDoesNotMatch"; updatedBulge: number; expected: number }
  | { kind: "isValid" };
