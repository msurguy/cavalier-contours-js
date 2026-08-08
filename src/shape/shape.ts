/**
 * Shape algorithms module — multipolyline (shape) parallel offset.
 *
 * Port of `shape_algorithms/mod.rs`. This module is a leaf of the dependency graph (nothing in
 * `src/` imports it except the package entry `src/index.ts`), so it can import `plineView.ts`,
 * `polyline.ts`, and `internal/plineOffset.ts` directly without the runtime circular import
 * hazard documented in `plineOffsetRegistry.ts`/`booleanDispatch.ts`. Note importing
 * `internal/plineOffset.ts` here also registers the `parallelOffset` implementation used by
 * `PlineSourceBase.parallelOffsetOpt`.
 *
 * Rust `BTreeMap<usize, Vec<usize>>` becomes `Map<number, number[]>` (only point lookups are
 * performed, no ordered iteration), `BTreeSet<(usize, usize)>` becomes `Set<number>` with the
 * pair `(i, j)` encoded as `i * n + j` (`n` = total offset loop count, both `i` and `j` are
 * `< n`), and the Rust `*_with_stack` spatial index queries map to the plain `query`/
 * `visitQuery` methods (the JS port of the spatial index reuses one internal stack), so the
 * Rust `query_stack` parameters are dropped.
 */
import { debugAssert } from "../core/controlFlow.js";
import { distSquared } from "../core/mathUtils.js";
import type { Vector2 } from "../core/vector2.js";
import {
  type StaticAabb2dIndex,
  StaticAabb2dIndexBuilder,
} from "../index2d/staticAabb2dIndex.js";
import { pointValidForOffset } from "../polyline/internal/plineOffset.js";
import { segMidpoint } from "../polyline/plineSeg.js";
import type {
  FindIntersectsOptions,
  PlineBasicIntersect,
  PlineOffsetOptions,
} from "../polyline/plineTypes.js";
import { PlineViewData } from "../polyline/plineView.js";
import { Polyline } from "../polyline/polyline.js";

/** Port of Rust `Option::unwrap`/`expect` on values that are invalid to be absent. */
function unwrap<T>(value: T | null, msg: string): T {
  if (value === null) {
    throw new Error(msg);
  }
  return value;
}

/**
 * An offset polyline with spatial indexing and parent loop tracking.
 *
 * This structure represents a single offset result from a parent polyline, containing
 * both the generated offset polyline with its spatial index and a reference to which
 * original input polyline it was derived from.
 *
 * # Public Visibility
 *
 * This struct is made public for visualization and testing purposes, allowing
 * intermediate offset results to be inspected during algorithm execution.
 */
export interface OffsetLoop {
  /** Index of the parent loop in the original input shape */
  parentLoopIdx: number;
  /** The offset polyline with its spatial index for fast intersection queries */
  indexedPline: IndexedPolyline;
}

/** Rust `impl Default for OffsetLoop` (`parent_loop_idx: 0`, empty indexed polyline). */
export function defaultOffsetLoop(): OffsetLoop {
  return {
    parentLoopIdx: 0,
    indexedPline: new IndexedPolyline(new Polyline()),
  };
}

/**
 * A polyline with an associated spatial index for efficient geometric queries.
 *
 * This structure combines a polyline with a spatial index (AABB tree) that enables
 * fast intersection testing, nearest neighbor queries, and other spatial operations.
 * The spatial index is automatically built from the polyline's segment bounding boxes.
 *
 * # Public Visibility
 *
 * This struct is made public for visualization and testing purposes, allowing
 * access to both the polyline geometry and its spatial acceleration structure.
 */
export class IndexedPolyline {
  /** The polyline geometry */
  polyline: Polyline;
  /** Spatial index built from the polyline's segment bounding boxes */
  spatialIndex: StaticAabb2dIndex;

  constructor(polyline: Polyline) {
    const spatialIndex = polyline.createApproxAabbIndex();
    this.polyline = polyline;
    this.spatialIndex = spatialIndex;
  }

  parallelOffsetForShape(offset: number, options: ShapeOffsetOptions): Polyline[] {
    const shapeOpts = resolveShapeOffsetOptions(options);
    const opts: PlineOffsetOptions = {
      aabbIndex: this.spatialIndex,
      handleSelfIntersects: false,
      posEqualEps: shapeOpts.posEqualEps,
      sliceJoinEps: shapeOpts.sliceJoinEps,
      offsetDistEps: shapeOpts.offsetDistEps,
    };

    return this.polyline.parallelOffsetOpt(offset, opts);
  }
}

/** Struct to hold options parameters when performing shape offset. */
export interface ShapeOffsetOptions {
  /** Fuzzy comparison epsilon used for determining if two positions are equal. */
  posEqualEps?: number;
  /**
   * Fuzzy comparison epsilon used when testing distance of slices to original polyline for
   * validity.
   */
  offsetDistEps?: number;
  /**
   * Fuzzy comparison epsilon used for determining if two positions are equal when stitching
   * polyline slices together.
   */
  sliceJoinEps?: number;
}

/** Default values for `ShapeOffsetOptions` (Rust `ShapeOffsetOptions::new`/`Default`). */
export function defaultShapeOffsetOptions(): Required<ShapeOffsetOptions> {
  return {
    posEqualEps: 1e-5,
    offsetDistEps: 1e-4,
    sliceJoinEps: 1e-4,
  };
}

/** Fill in any missing `ShapeOffsetOptions` fields with the default values. */
export function resolveShapeOffsetOptions(
  options?: ShapeOffsetOptions,
): Required<ShapeOffsetOptions> {
  const defaults = defaultShapeOffsetOptions();
  return {
    posEqualEps: options?.posEqualEps ?? defaults.posEqualEps,
    offsetDistEps: options?.offsetDistEps ?? defaults.offsetDistEps,
    sliceJoinEps: options?.sliceJoinEps ?? defaults.sliceJoinEps,
  };
}

/**
 * A point where an offset loop should be divided during slice creation.
 *
 * This structure represents a specific location on a polyline where an intersection
 * occurs, defined by both the segment index and the exact position. These points
 * are used to divide offset loops into valid slices.
 */
interface DissectionPoint {
  /** Index of the polyline segment containing this point */
  segIdx: number;
  /** Exact 2D position of the dissection point */
  pos: Vector2;
}

/**
 * Shape represented by positive area counter clockwise polylines, `ccwPlines` and negative/hole
 * area clockwise polylines, `cwPlines`.
 */
export class Shape {
  /** Positive/filled area counter clockwise polylines. */
  ccwPlines: IndexedPolyline[];
  /** Negative/hole area clockwise polylines. */
  cwPlines: IndexedPolyline[];
  /**
   * Spatial index of all the polyline area bounding boxes, index positions correspond to in
   * order all the counter clockwise polylines followed by all the clockwise polylines. E.g., if
   * there is 1 `ccwPlines` and 2 `cwPlines` then index position 0 is the bounding box for the
   * ccw pline and index positions 1 and 2 correspond to the first and second cw plines.
   */
  plinesIndex: StaticAabb2dIndex;

  constructor(
    ccwPlines: IndexedPolyline[],
    cwPlines: IndexedPolyline[],
    plinesIndex: StaticAabb2dIndex,
  ) {
    this.ccwPlines = ccwPlines;
    this.cwPlines = cwPlines;
    this.plinesIndex = plinesIndex;
  }

  static fromPlines(plines: Iterable<Polyline>): Shape {
    const ccwPlines: IndexedPolyline[] = [];
    const cwPlines: IndexedPolyline[] = [];
    // skip empty polylines
    for (const pl of plines) {
      if (!(pl.vertexCount > 1)) {
        continue;
      }
      if (pl.orientation() === "counterClockwise") {
        ccwPlines.push(new IndexedPolyline(pl));
      } else {
        cwPlines.push(new IndexedPolyline(pl));
      }
    }

    let plinesIndex: StaticAabb2dIndex;
    {
      const b = new StaticAabb2dIndexBuilder(ccwPlines.length + cwPlines.length);

      const addAllBounds = (plineList: readonly IndexedPolyline[]): void => {
        for (const pline of plineList) {
          const bounds = unwrap(pline.spatialIndex.bounds(), "expect non-empty polyline");

          b.add(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
        }
      };

      addAllBounds(ccwPlines);
      addAllBounds(cwPlines);

      plinesIndex = b.build();
    }

    return new Shape(ccwPlines, cwPlines, plinesIndex);
  }

  /** Return an empty shape (0 polylines). */
  static empty(): Shape {
    return new Shape([], [], new StaticAabb2dIndexBuilder(0).build());
  }

  parallelOffset(offset: number, options?: ShapeOffsetOptions): Shape {
    const opts = resolveShapeOffsetOptions(options);
    const [ccwOffsetLoops, cwOffsetLoops, offsetLoopsIndex] = this.createOffsetLoopsWithIndex(
      offset,
      opts,
    );

    if (ccwOffsetLoops.length === 0 && cwOffsetLoops.length === 0) {
      return Shape.empty();
    }

    const slicePointSets = this.findIntersectsBetweenOffsetLoops(
      ccwOffsetLoops,
      cwOffsetLoops,
      offsetLoopsIndex,
      opts.posEqualEps,
    );

    const slicesData = this.createValidSlicesFromIntersects(
      ccwOffsetLoops,
      cwOffsetLoops,
      slicePointSets,
      offset,
      opts,
    );

    return this.stitchSlicesTogether(
      slicesData,
      ccwOffsetLoops,
      cwOffsetLoops,
      opts.posEqualEps,
      opts.sliceJoinEps,
    );
  }

  /**
   * **Step 1** of the multipolyline offset algorithm: Creates offset loops with spatial index.
   *
   * This method generates offset polylines for each input polyline in the shape and creates
   * a spatial index for efficient intersection queries. The offset loops are separated into
   * counter-clockwise (positive area) and clockwise (negative area) collections based on
   * their orientation after offsetting.
   *
   * # Returns
   *
   * A tuple containing:
   * - `OffsetLoop[]` - Counter-clockwise offset loops
   * - `OffsetLoop[]` - Clockwise offset loops
   * - `StaticAabb2dIndex` - Spatial index of all offset loop bounding boxes
   *
   * # Public Visibility
   *
   * This method is made public for visualization and testing purposes, allowing intermediate
   * results to be inspected during the offset algorithm execution.
   */
  createOffsetLoopsWithIndex(
    offset: number,
    options: ShapeOffsetOptions,
  ): [OffsetLoop[], OffsetLoop[], StaticAabb2dIndex] {
    const ccwOffsetLoops: OffsetLoop[] = [];
    const cwOffsetLoops: OffsetLoop[] = [];
    let parentIdx = 0;

    for (const pline of this.ccwPlines) {
      for (const offsetPline of pline.parallelOffsetForShape(offset, options)) {
        const area = offsetPline.area();
        // check if orientation inverted (due to collapse of very narrow or small input)
        // skip if inversion happened (ccw became cw while offsetting inward)
        if (offset > 0.0 && area < 0.0) {
          continue;
        }

        const offsetLoop: OffsetLoop = {
          parentLoopIdx: parentIdx,
          indexedPline: new IndexedPolyline(offsetPline),
        };

        if (area < 0.0) {
          cwOffsetLoops.push(offsetLoop);
        } else {
          ccwOffsetLoops.push(offsetLoop);
        }
      }
      parentIdx += 1;
    }

    for (const pline of this.cwPlines) {
      for (const offsetPline of pline.parallelOffsetForShape(offset, options)) {
        const area = offsetPline.area();
        // check if orientation inverted (due to collapse of very narrow or small input)
        // skip if inversion happened (cw became ccw while offsetting inward)
        if (offset < 0.0 && area > 0.0) {
          continue;
        }

        const offsetLoop: OffsetLoop = {
          parentLoopIdx: parentIdx,
          indexedPline: new IndexedPolyline(offsetPline),
        };

        if (area < 0.0) {
          cwOffsetLoops.push(offsetLoop);
        } else {
          ccwOffsetLoops.push(offsetLoop);
        }
      }
      parentIdx += 1;
    }

    let offsetLoopsIndex: StaticAabb2dIndex;
    {
      const b = new StaticAabb2dIndexBuilder(ccwOffsetLoops.length + cwOffsetLoops.length);

      const addAllBounds = (loops: readonly OffsetLoop[]): void => {
        for (const l of loops) {
          const bounds = unwrap(
            l.indexedPline.spatialIndex.bounds(),
            "expect non-empty polyline",
          );

          b.add(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
        }
      };

      addAllBounds(ccwOffsetLoops);
      addAllBounds(cwOffsetLoops);

      offsetLoopsIndex = b.build();
    }

    return [ccwOffsetLoops, cwOffsetLoops, offsetLoopsIndex];
  }

  /**
   * **Step 2** of the multipolyline offset algorithm: Finds intersections between offset loops.
   *
   * This method uses spatial indexing to efficiently find all intersection points between
   * the offset polylines generated in Step 1. It performs pairwise intersection tests only
   * on polylines whose bounding boxes overlap, avoiding expensive computations on
   * non-intersecting pairs. Both basic intersections and overlapping segments are detected
   * and converted into slice points for further processing.
   *
   * # Arguments
   *
   * * `ccwOffsetLoops` - Counter-clockwise offset loops from Step 1
   * * `cwOffsetLoops` - Clockwise offset loops from Step 1
   * * `offsetLoopsIndex` - Spatial index of offset loop bounding boxes from Step 1
   * * `posEqualEps` - Epsilon for position equality comparisons
   *
   * # Returns
   *
   * An array of `SlicePointSet` containing intersection data between pairs of offset loops.
   * Each set includes the loop indices and all intersection points between those loops.
   *
   * # Public Visibility
   *
   * This method is made public for visualization and testing purposes, allowing intersection
   * points to be displayed and the intersection detection logic to be independently tested.
   */
  findIntersectsBetweenOffsetLoops(
    ccwOffsetLoops: readonly OffsetLoop[],
    cwOffsetLoops: readonly OffsetLoop[],
    offsetLoopsIndex: StaticAabb2dIndex,
    posEqualEps: number,
  ): SlicePointSet[] {
    const offsetLoopCount = ccwOffsetLoops.length + cwOffsetLoops.length;
    const slicePointSets: SlicePointSet[] = [];
    // Rust `BTreeSet<(usize, usize)>` — pair `(i, j)` encoded as `i * offsetLoopCount + j`
    // (both `i` and `j` are always less than `offsetLoopCount`)
    const visitedLoopPairs = new Set<number>();

    for (let i = 0; i < offsetLoopCount; i += 1) {
      const loop1 = Shape.getLoop(i, ccwOffsetLoops, cwOffsetLoops);
      const spatialIdx1 = loop1.indexedPline.spatialIndex;
      const bounds = unwrap(spatialIdx1.bounds(), "expect non-empty polyline");
      const queryResults = offsetLoopsIndex.query(
        bounds.minX,
        bounds.minY,
        bounds.maxX,
        bounds.maxY,
      );

      for (const j of queryResults) {
        if (i === j) {
          // skip same index (no self intersects among the offset loops)
          continue;
        }

        if (visitedLoopPairs.has(j * offsetLoopCount + i)) {
          // skip reversed index order (would end up comparing the same loops in another
          // iteration)
          continue;
        }

        visitedLoopPairs.add(i * offsetLoopCount + j);

        const loop2 = Shape.getLoop(j, ccwOffsetLoops, cwOffsetLoops);

        const intrsOpts: FindIntersectsOptions = {
          pline1AabbIndex: spatialIdx1,
          posEqualEps,
        };

        const intersects = loop1.indexedPline.polyline.findIntersectsOpt(
          loop2.indexedPline.polyline,
          intrsOpts,
        );

        if (
          intersects.basicIntersects.length === 0 &&
          intersects.overlappingIntersects.length === 0
        ) {
          continue;
        }

        const slicePoints: PlineBasicIntersect[] = [];

        for (const intr of intersects.basicIntersects) {
          slicePoints.push(intr);
        }

        // add overlapping start and end points
        for (const overlapIntr of intersects.overlappingIntersects) {
          const startIndex1 = overlapIntr.startIndex1;
          const startIndex2 = overlapIntr.startIndex2;
          slicePoints.push({
            startIndex1,
            startIndex2,
            point: overlapIntr.point1,
          });
          slicePoints.push({
            startIndex1,
            startIndex2,
            point: overlapIntr.point2,
          });
        }

        const slicePointSet: SlicePointSet = {
          loopIdx1: i,
          loopIdx2: j,
          slicePoints,
        };

        slicePointSets.push(slicePointSet);
      }
    }

    return slicePointSets;
  }

  /**
   * **Step 3** of the multipolyline offset algorithm: Creates valid slices from intersection
   * points.
   *
   * This method processes the intersection points from Step 2 to create polyline slices that
   * represent valid portions of the offset geometry. Each offset loop is divided at
   * intersection points, and the resulting slices are validated to ensure they maintain the
   * correct distance from the original input polylines. Invalid slices (those that are too
   * close to other input polylines) are filtered out.
   *
   * The slices are represented as `PlineViewData` to avoid cloning the underlying polyline
   * data, providing memory-efficient access to polyline segments.
   *
   * # Arguments
   *
   * * `ccwOffsetLoops` - Counter-clockwise offset loops from Step 1
   * * `cwOffsetLoops` - Clockwise offset loops from Step 1
   * * `slicePointSets` - Intersection data from Step 2
   * * `offset` - The offset distance used for validation
   * * `options` - Offset options containing validation epsilons
   *
   * # Returns
   *
   * An array of `DissectedSlice` containing valid polyline slices that can be stitched
   * together to form the final offset result. This includes valid offset polylines that had
   * no intersection points (the entire polyline is preserved inside the `DissectedSlice`).
   *
   * # Public Visibility
   *
   * This method is made public for visualization and testing purposes, allowing individual
   * slices to be displayed and the slice validation logic to be independently tested.
   */
  createValidSlicesFromIntersects(
    ccwOffsetLoops: readonly OffsetLoop[],
    cwOffsetLoops: readonly OffsetLoop[],
    slicePointSets: readonly SlicePointSet[],
    offset: number,
    options: ShapeOffsetOptions,
  ): DissectedSlice[] {
    const offsetLoopCount = ccwOffsetLoops.length + cwOffsetLoops.length;
    const opts = resolveShapeOffsetOptions(options);
    const posEqualEps = opts.posEqualEps;
    const offsetDistEps = opts.offsetDistEps;

    const slicePointsLookup = new Map<number, number[]>();
    for (let setIdx = 0; setIdx < slicePointSets.length; setIdx += 1) {
      const set = slicePointSets[setIdx];
      let entry1 = slicePointsLookup.get(set.loopIdx1);
      if (entry1 === undefined) {
        entry1 = [];
        slicePointsLookup.set(set.loopIdx1, entry1);
      }
      entry1.push(setIdx);
      let entry2 = slicePointsLookup.get(set.loopIdx2);
      if (entry2 === undefined) {
        entry2 = [];
        slicePointsLookup.set(set.loopIdx2, entry2);
      }
      entry2.push(setIdx);
    }

    const sortedIntrs: DissectionPoint[] = [];
    const slicesData: DissectedSlice[] = [];

    const createSlice = (
      pt1: DissectionPoint,
      pt2: DissectionPoint,
      offsetLoop: Polyline,
    ): PlineViewData | null => {
      return PlineViewData.fromSlicePoints(
        offsetLoop,
        pt1.pos,
        pt1.segIdx,
        pt2.pos,
        pt2.segIdx,
        posEqualEps,
      );
    };

    const isSliceValid = (
      vData: PlineViewData,
      offsetLoop: Polyline,
      parentIdx: number,
    ): boolean => {
      const sliceView = vData.view(offsetLoop);
      // ideally we don't want a segment created by the intersection point as it may be very
      // short with the midpoint essentially on top of the intersection point which leads to
      // the slice being considered valid when it shouldn't be (distance from intersection
      // point to polyline is always equal to the offset distance)
      //
      // to help with this we first check if we can use a segment that is not created by the
      // intersection point (index not at start or end of the slice)
      // if that's not possible then we check all both segments midpoints of the slice

      const vertexCount = sliceView.vertexCount;
      let midpoint1: Vector2;
      let midpoint2: Vector2 | null;
      if (vertexCount > 3) {
        // if slice has more than 2 segments then we can use segment not created by
        // an intersection (arbitrarily picking segment from index 1 to index 2)
        midpoint1 = segMidpoint(sliceView.at(1), sliceView.at(2));
        midpoint2 = null;
      } else if (vertexCount === 3) {
        // if slice has exactly 3 points then we test both segment midpoints
        midpoint1 = segMidpoint(sliceView.at(0), sliceView.at(1));
        midpoint2 = segMidpoint(sliceView.at(1), sliceView.at(2));
      } else {
        // if slice has only 2 points then we can only use the midpoint of the segment
        midpoint1 = segMidpoint(sliceView.at(0), sliceView.at(1));
        midpoint2 = null;
      }

      // loop through input polylines and check if slice is too close (skipping parent
      // polyline since it's never too close)
      for (
        let inputLoopIdx = 0;
        inputLoopIdx < this.ccwPlines.length + this.cwPlines.length;
        inputLoopIdx += 1
      ) {
        if (inputLoopIdx === parentIdx) {
          continue;
        }

        const parentLoop =
          inputLoopIdx < this.ccwPlines.length
            ? this.ccwPlines[inputLoopIdx]
            : this.cwPlines[inputLoopIdx - this.ccwPlines.length];

        if (
          !pointValidForOffset(
            parentLoop.polyline,
            offset,
            parentLoop.spatialIndex,
            midpoint1,
            posEqualEps,
            offsetDistEps,
          )
        ) {
          return false;
        }

        if (
          midpoint2 !== null &&
          !pointValidForOffset(
            parentLoop.polyline,
            offset,
            parentLoop.spatialIndex,
            midpoint2,
            posEqualEps,
            offsetDistEps,
          )
        ) {
          return false;
        }
      }
      return true;
    };

    for (let loopIdx = 0; loopIdx < offsetLoopCount; loopIdx += 1) {
      sortedIntrs.length = 0;
      const currLoop = Shape.getLoop(loopIdx, ccwOffsetLoops, cwOffsetLoops);

      const slicePointSetIdxs = slicePointsLookup.get(loopIdx);
      if (slicePointSetIdxs !== undefined) {
        // gather all the intersects for the current loop
        for (const setIdx of slicePointSetIdxs) {
          const set = slicePointSets[setIdx];
          debugAssert(
            set.loopIdx1 === loopIdx || set.loopIdx2 === loopIdx,
            "loop index not in slice point set",
          );
          const loopIsFirstIndex = set.loopIdx1 === loopIdx;
          for (const intrPt of set.slicePoints) {
            const segIdx = loopIsFirstIndex ? intrPt.startIndex1 : intrPt.startIndex2;
            sortedIntrs.push({
              segIdx,
              pos: intrPt.point,
            });
          }
        }

        // sort the intersect points along direction of polyline
        sortedIntrs.sort((a, b) => {
          // sort by the segment index, then if both intersects on the same segment sort
          // by distance from start of segment
          if (a.segIdx !== b.segIdx) {
            return a.segIdx < b.segIdx ? -1 : 1;
          }
          const segStart = currLoop.indexedPline.polyline.at(a.segIdx).pos();
          const dist1 = distSquared(a.pos, segStart);
          const dist2 = distSquared(b.pos, segStart);
          return dist1 < dist2 ? -1 : dist1 > dist2 ? 1 : 0;
        });

        // construct valid slices to later be stitched together
        if (sortedIntrs.length === 1) {
          // treat whole loop as slice
          const vData = PlineViewData.fromEntirePline(currLoop.indexedPline.polyline);
          if (isSliceValid(vData, currLoop.indexedPline.polyline, currLoop.parentLoopIdx)) {
            slicesData.push({
              sourceIdx: loopIdx,
              vData,
            });
          }
        } else {
          // create slices from adjacent points
          for (let w = 0; w + 1 < sortedIntrs.length; w += 1) {
            const pt1 = sortedIntrs[w];
            const pt2 = sortedIntrs[w + 1];
            const vData = createSlice(pt1, pt2, currLoop.indexedPline.polyline);
            if (
              vData !== null &&
              isSliceValid(vData, currLoop.indexedPline.polyline, currLoop.parentLoopIdx)
            ) {
              slicesData.push({
                sourceIdx: loopIdx,
                vData,
              });
            }
          }

          // collect slice from last to start
          const pt1 = sortedIntrs[sortedIntrs.length - 1];
          const pt2 = sortedIntrs[0];
          const vData = createSlice(pt1, pt2, currLoop.indexedPline.polyline);
          if (
            vData !== null &&
            isSliceValid(vData, currLoop.indexedPline.polyline, currLoop.parentLoopIdx)
          ) {
            slicesData.push({
              sourceIdx: loopIdx,
              vData,
            });
          }
        }
      } else {
        // no intersects but still must test distance of one vertex position since it may be
        // inside another offset (completely eclipsed by island offset)
        const vData = PlineViewData.fromEntirePline(currLoop.indexedPline.polyline);
        if (isSliceValid(vData, currLoop.indexedPline.polyline, currLoop.parentLoopIdx)) {
          slicesData.push({
            sourceIdx: loopIdx,
            vData,
          });
        }
      }
    }

    return slicesData;
  }

  /**
   * **Step 4** of the multipolyline offset algorithm: Stitches slices together into final
   * shapes.
   *
   * This method takes the valid slices from Step 3 and connects them end-to-end to form
   * complete offset polylines. It uses spatial indexing to efficiently find adjacent slice
   * endpoints and stitches them together, handling both simple connections and complex
   * cases where multiple slices need to be joined.
   *
   * The method processes each unvisited slice, following the chain of connected slices until
   * a closed loop is formed or no more connections can be found. The resulting polylines
   * are then classified by orientation and returned as part of a complete `Shape`.
   *
   * # Arguments
   *
   * * `slicesData` - Valid slices from Step 3 (consumed by this method)
   * * `ccwOffsetLoops` - Counter-clockwise offset loops of the shape (for slice source lookup)
   * * `cwOffsetLoops` - Clockwise offset loops of the shape (for slice source lookup)
   * * `posEqualEps` - Epsilon for position equality when extending polylines
   * * `sliceJoinEps` - Epsilon for finding adjacent slice endpoints
   *
   * # Returns
   *
   * A complete `Shape` containing the final offset result with properly oriented polylines.
   *
   * # Public Visibility
   *
   * This method is made public for visualization and testing purposes, allowing the stitching
   * process to be observed and the final assembly logic to be independently tested.
   */
  stitchSlicesTogether(
    slicesData: readonly DissectedSlice[],
    ccwOffsetLoops: readonly OffsetLoop[],
    cwOffsetLoops: readonly OffsetLoop[],
    posEqualEps: number,
    sliceJoinEps: number,
  ): Shape {
    if (slicesData.length === 0) {
      return Shape.empty();
    }

    const ccwPlinesResult: IndexedPolyline[] = [];
    const cwPlinesResult: IndexedPolyline[] = [];

    let sliceStartsAabbIndex: StaticAabb2dIndex;
    {
      const builder = new StaticAabb2dIndexBuilder(slicesData.length);
      for (const slice of slicesData) {
        const startPoint = slice.vData.updatedStart.pos();
        builder.add(
          startPoint.x - sliceJoinEps,
          startPoint.y - sliceJoinEps,
          startPoint.x + sliceJoinEps,
          startPoint.y + sliceJoinEps,
        );
      }
      sliceStartsAabbIndex = builder.build();
    }

    const visitedSlicesIdxs: boolean[] = new Array(slicesData.length).fill(false);
    const queryResults: number[] = [];

    for (let sliceIdx = 0; sliceIdx < slicesData.length; sliceIdx += 1) {
      if (visitedSlicesIdxs[sliceIdx]) {
        continue;
      }
      visitedSlicesIdxs[sliceIdx] = true;

      let currentIndex = sliceIdx;
      let loopCount = 0;
      const maxLoopCount = slicesData.length;
      const currentPline = new Polyline();

      for (;;) {
        if (loopCount > maxLoopCount) {
          // prevent infinite loop
          throw new Error("loop_count exceeded max_loop_count while stitching slices together");
        }
        loopCount += 1;

        const currSlice = slicesData[currentIndex];
        const sourceLoop = Shape.getLoop(currSlice.sourceIdx, ccwOffsetLoops, cwOffsetLoops);
        const sliceView = currSlice.vData.view(sourceLoop.indexedPline.polyline);
        const sliceUserdataValues = sliceView.getUserdataValues();
        currentPline.extendRemoveRepeat(sliceView, posEqualEps);
        currentPline.addUserdataValues(sliceUserdataValues);

        queryResults.length = 0;
        const sliceEndPoint = currSlice.vData.endPoint;
        const aabbIndexVisitor = (i: number): void => {
          if (!visitedSlicesIdxs[i]) {
            queryResults.push(i);
          }
        };
        sliceStartsAabbIndex.visitQuery(
          sliceEndPoint.x - sliceJoinEps,
          sliceEndPoint.y - sliceJoinEps,
          sliceEndPoint.x + sliceJoinEps,
          sliceEndPoint.y + sliceJoinEps,
          aabbIndexVisitor,
        );

        if (queryResults.length === 0) {
          if (currentPline.vertexCount > 2) {
            currentPline.removeLast();
            currentPline.setIsClosed(true);
          }
          const isCcw = currentPline.orientation() === "counterClockwise";
          if (isCcw) {
            ccwPlinesResult.push(new IndexedPolyline(currentPline));
          } else {
            cwPlinesResult.push(new IndexedPolyline(currentPline));
          }
          break;
        }

        let foundIndex: number | null = null;
        for (const i of queryResults) {
          const slice = slicesData[i];
          if (slice.sourceIdx === currSlice.sourceIdx) {
            foundIndex = i;
            break;
          }
        }
        currentIndex = foundIndex ?? queryResults[0];

        visitedSlicesIdxs[currentIndex] = true;
      }
    }

    let plinesIndex: StaticAabb2dIndex;
    {
      const b = new StaticAabb2dIndexBuilder(ccwPlinesResult.length + cwPlinesResult.length);

      const addAllBounds = (plineList: readonly IndexedPolyline[]): void => {
        for (const pline of plineList) {
          const bounds = unwrap(pline.spatialIndex.bounds(), "expect non-empty polyline");

          b.add(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
        }
      };

      addAllBounds(ccwPlinesResult);
      addAllBounds(cwPlinesResult);

      plinesIndex = b.build();
    }

    return new Shape(ccwPlinesResult, cwPlinesResult, plinesIndex);
  }

  private static getLoop(
    i: number,
    s1: readonly OffsetLoop[],
    s2: readonly OffsetLoop[],
  ): OffsetLoop {
    if (i < s1.length) {
      return s1[i];
    }
    return s2[i - s1.length];
  }
}

/**
 * Intersection data between two offset loops.
 *
 * This structure contains all intersection points found between a pair of offset loops,
 * including both basic intersections and overlapping segment intersections. The data
 * is used to create slices by dividing the offset loops at these intersection points.
 *
 * # Public Visibility
 *
 * This struct is made public for visualization and testing purposes, allowing
 * intersection data to be inspected and displayed during algorithm execution.
 */
export interface SlicePointSet {
  /** Index of the first offset loop in the intersection pair */
  loopIdx1: number;
  /** Index of the second offset loop in the intersection pair */
  loopIdx2: number;
  /** All intersection points between the two loops */
  slicePoints: PlineBasicIntersect[];
}

/**
 * A validated slice of an offset polyline ready for stitching.
 *
 * This structure represents a portion of an offset loop that has been validated
 * to maintain the correct distance from the original input polylines. The slice
 * is represented as a view into the source polyline to avoid unnecessary copying.
 *
 * # Public Visibility
 *
 * This struct is made public for visualization and testing purposes, allowing
 * individual slices to be displayed before the final stitching step.
 */
export interface DissectedSlice {
  /** Index of the source offset loop this slice comes from */
  sourceIdx: number;
  /** View data defining the slice boundaries within the source polyline */
  vData: PlineViewData;
}
