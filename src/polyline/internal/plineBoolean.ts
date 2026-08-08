/**
 * Internal module for the polyline boolean operations.
 *
 * Port of `polyline/internal/pline_boolean.rs`. This module constructs
 * `PlineViewData`/`PlineView` values at runtime so it must not be imported (directly or
 * transitively) by `plineSourceBase.ts` (see the header of `overlappingSlices.ts` and
 * `booleanDispatch.ts` for the module-cycle hazard). `plineSourceBase.ts` reaches
 * `polylineBoolean` through the late-bound registration in `booleanDispatch.ts` performed at
 * the bottom of this module.
 *
 * The Rust `BooleanPlineSlice::from_open_pline_slice`/`from_overlapping` associated functions
 * (defined in `pline_types.rs`) live here as free functions since `BooleanPlineSlice` is a
 * plain interface in `plineTypes.ts`.
 */
import { debugAssert, sortedKeys } from "../../core/controlFlow.js";
import { distSquared } from "../../core/mathUtils.js";
import type { Vector2 } from "../../core/vector2.js";
import {
  type StaticAabb2dIndex,
  StaticAabb2dIndexBuilder,
} from "../../index2d/staticAabb2dIndex.js";
import { segMidpoint, segSplitAtPoint } from "../plineSeg.js";
import type { PlineSourceBase } from "../plineSourceBase.js";
import {
  type BooleanOp,
  type BooleanPlineSlice,
  type BooleanResult,
  type BooleanResultPline,
  booleanResultFromWholePlines,
  defaultPlineBooleanOptions,
  emptyBooleanResult,
  type PlineBasicIntersect,
  type PlineBooleanOptions,
  type PlineOrientation,
} from "../plineTypes.js";
import type { PlineVertex } from "../plineVertex.js";
import { PlineViewData } from "../plineView.js";
import { Polyline } from "../polyline.js";
import { setPolylineBooleanImpl } from "./booleanDispatch.js";
import { findIntersects } from "./plineIntersects.js";
import { type OverlappingSlice, sortAndJoinOverlappingIntersects } from "./overlappingSlices.js";

/**
 * Create a `BooleanPlineSlice` from open pline slice view data
 * (Rust `BooleanPlineSlice::from_open_pline_slice` in `pline_types.rs`).
 */
export function booleanPlineSliceFromOpenPlineSlice(
  data: PlineViewData,
  sourceIsPline1: boolean,
  inverted: boolean,
): BooleanPlineSlice {
  return {
    viewData: new PlineViewData(
      data.startIndex,
      data.endIndexOffset,
      data.updatedStart,
      data.updatedEndBulge,
      data.endPoint,
      inverted,
    ),
    sourceIsPline1,
    overlapping: false,
  };
}

/**
 * Create a `BooleanPlineSlice` from an `OverlappingSlice`
 * (Rust `BooleanPlineSlice::from_overlapping` in `pline_types.rs`).
 */
export function booleanPlineSliceFromOverlapping(
  source: PlineSourceBase,
  overlappingSlice: OverlappingSlice,
  inverted: boolean,
): BooleanPlineSlice {
  const result: BooleanPlineSlice = {
    viewData: new PlineViewData(
      overlappingSlice.startIndexes[1],
      overlappingSlice.viewData.endIndexOffset,
      overlappingSlice.viewData.updatedStart,
      overlappingSlice.viewData.updatedEndBulge,
      overlappingSlice.viewData.endPoint,
      inverted,
    ),
    sourceIsPline1: false,
    overlapping: true,
  };
  debugAssert(
    result.viewData.validateForSource(source).kind === "isValid",
    "boolean overlapping slice view data must be valid for source",
  );
  return result;
}

export class ProcessForBooleanResult {
  overlappingSlices: OverlappingSlice[];
  intersects: PlineBasicIntersect[];
  pline1Orientation: PlineOrientation;
  pline2Orientation: PlineOrientation;

  constructor(
    overlappingSlices: OverlappingSlice[],
    intersects: PlineBasicIntersect[],
    pline1Orientation: PlineOrientation,
    pline2Orientation: PlineOrientation,
  ) {
    this.overlappingSlices = overlappingSlices;
    this.intersects = intersects;
    this.pline1Orientation = pline1Orientation;
    this.pline2Orientation = pline2Orientation;
  }

  completelyOverlapping(): boolean {
    return this.overlappingSlices.length === 1 && this.overlappingSlices[0].isLoop;
  }

  opposingDirections(): boolean {
    return this.pline1Orientation !== this.pline2Orientation;
  }

  anyIntersects(): boolean {
    return this.intersects.length !== 0 || this.overlappingSlices.length !== 0;
  }
}

export function processForBoolean(
  pline1: PlineSourceBase,
  pline2: PlineSourceBase,
  pline1AabbIndex: StaticAabb2dIndex,
  posEqualEps: number,
): ProcessForBooleanResult {
  const intrs = findIntersects(pline1, pline2, {
    pline1AabbIndex,
    posEqualEps,
  });
  const overlappingSlices = sortAndJoinOverlappingIntersects(
    intrs.overlappingIntersects,
    pline1,
    pline2,
    posEqualEps,
  );

  const pline1Orientation = pline1.orientation();
  const pline2Orientation = pline2.orientation();

  return new ProcessForBooleanResult(
    overlappingSlices,
    intrs.basicIntersects,
    pline1Orientation,
    pline2Orientation,
  );
}

class SlicePoint {
  pos: Vector2;
  isStartOfOverlappingSlice: boolean;

  constructor(pos: Vector2, isStartOfOverlappingSlice: boolean) {
    this.pos = pos;
    this.isStartOfOverlappingSlice = isStartOfOverlappingSlice;
  }
}

/**
 * Slice the given pline at all of its intersects for boolean operations.
 *
 * If `useSecondIndex` is true then the second index of the intersect types is used to correspond
 * with pline, otherwise the first index is used. `pointOnSlicePred` is called on at least one
 * point from each slice, if it returns true then the slice is kept, otherwise it is discarded.
 * `outputSlices` is populated with open polylines that represent all the slices.
 */
export function sliceAtIntersects(
  pline: PlineSourceBase,
  booleanInfo: ProcessForBooleanResult,
  useSecondIndex: boolean,
  pointOnSlicePred: (point: Vector2) => boolean,
  outputSlices: BooleanPlineSlice[],
  posEqualEps: number,
): void {
  const intersectsLookup = new Map<number, SlicePoint[]>();

  // helper to get or create lookup entry (Rust `entry(...).or_default()`)
  const lookupEntry = (key: number): SlicePoint[] => {
    let list = intersectsLookup.get(key);
    if (list === undefined) {
      list = [];
      intersectsLookup.set(key, list);
    }
    return list;
  };

  // helper function to adjust overlapping slice start point and endpoint indexes for lookup
  // (Rust closure takes `&mut usize` indexes, ported to return the adjusted pair)
  const adjustSpEpIndexes = (
    spIdx: number,
    sp: Vector2,
    epIdx: number,
    ep: Vector2,
  ): [number, number] => {
    // checking if positioned at end of segment in which case the point should use the next
    // index to match convention used for intersects
    const spIdxNext = pline.nextWrappingIndex(spIdx);
    if (sp.fuzzyEqEps(pline.at(spIdxNext).pos(), posEqualEps)) {
      spIdx = spIdxNext;
    }
    const epIdxNext = pline.nextWrappingIndex(epIdx);
    if (ep.fuzzyEqEps(pline.at(epIdxNext).pos(), posEqualEps)) {
      epIdx = epIdxNext;
    }
    return [spIdx, epIdx];
  };

  if (useSecondIndex) {
    // using startIndex2 from intersects
    for (const intr of booleanInfo.intersects) {
      lookupEntry(intr.startIndex2).push(new SlicePoint(intr.point, false));
    }

    for (const overlappingSlice of booleanInfo.overlappingSlices) {
      const sp = overlappingSlice.viewData.updatedStart.pos();
      const ep = overlappingSlice.viewData.endPoint;
      let spIdx = overlappingSlice.startIndexes[1];
      let epIdx = overlappingSlice.endIndexes[1];
      [spIdx, epIdx] = adjustSpEpIndexes(spIdx, sp, epIdx, ep);

      lookupEntry(spIdx).push(new SlicePoint(sp, true));
      lookupEntry(epIdx).push(new SlicePoint(ep, false));
    }
  } else {
    // use startIndex1 from intersects
    for (const intr of booleanInfo.intersects) {
      lookupEntry(intr.startIndex1).push(new SlicePoint(intr.point, false));
    }

    for (const overlappingSlice of booleanInfo.overlappingSlices) {
      const sp = overlappingSlice.viewData.updatedStart.pos();
      const ep = overlappingSlice.viewData.endPoint;
      let spIdx = overlappingSlice.startIndexes[0];
      let epIdx = overlappingSlice.endIndexes[0];
      [spIdx, epIdx] = adjustSpEpIndexes(spIdx, sp, epIdx, ep);

      // overlapping slices are always constructed following the direction of pline2 so if
      // pline1 has opposing direction then sp becomes slice end point and ep becomes slice
      // start point
      const spIsSliceStart = !overlappingSlice.opposingDirections;
      lookupEntry(spIdx).push(new SlicePoint(sp, spIsSliceStart));
      lookupEntry(epIdx).push(new SlicePoint(ep, !spIsSliceStart));
    }
  }

  // sort intersects by distance from segment start vertex
  for (const i of sortedKeys(intersectsLookup)) {
    const intrList = intersectsLookup.get(i) as SlicePoint[];
    const startPos = pline.at(i).pos();
    intrList.sort((intr1, intr2) => {
      const dist1 = distSquared(intr1.pos, startPos);
      const dist2 = distSquared(intr2.pos, startPos);
      return dist1 < dist2 ? -1 : dist1 > dist2 ? 1 : 0;
    });
  }

  for (const startIndex of sortedKeys(intersectsLookup)) {
    const intrsList = intersectsLookup.get(startIndex) as SlicePoint[];
    const nextIndex = pline.nextWrappingIndex(startIndex);
    const startVertex = pline.at(startIndex);
    const endVertex = pline.at(nextIndex);

    if (intrsList.length !== 1) {
      // build all the slices between the N intersects in intr_list (N > 1), skipping the
      // first slice (to be processed at the end)
      const firstSplit = segSplitAtPoint(startVertex, endVertex, intrsList[0].pos, posEqualEps);
      let prevVertex = firstSplit.splitVertex;
      for (let i = 1; i < intrsList.length; i += 1) {
        const split = segSplitAtPoint(prevVertex, endVertex, intrsList[i].pos, posEqualEps);
        // update prevVertex for next loop iteration
        prevVertex = split.splitVertex;

        if (intrsList[i - 1].isStartOfOverlappingSlice) {
          // skip overlapping slices
          continue;
        }

        if (split.updatedStart.pos().fuzzyEqEps(split.splitVertex.pos(), posEqualEps)) {
          // slice end points overlap each other, skip slice
          continue;
        }

        const midpoint = segMidpoint(split.updatedStart, split.splitVertex);
        if (!pointOnSlicePred(midpoint)) {
          // failed predicate, skip slice
          continue;
        }

        const opl = PlineViewData.createOnSingleSegment(
          pline,
          startIndex,
          split.updatedStart,
          split.splitVertex.pos(),
          posEqualEps,
        );

        if (opl !== null) {
          outputSlices.push(booleanPlineSliceFromOpenPlineSlice(opl, !useSecondIndex, false));
        }
      }
    }

    const lastIntr = intrsList[intrsList.length - 1];

    if (lastIntr.isStartOfOverlappingSlice) {
      // skip overlapping slices
      continue;
    }

    // build the slice between the last intersect in the intr_list and the next intersect found

    const sliceStartVertex = ((): PlineVertex => {
      const sliceStartPoint = lastIntr.pos;
      const split = segSplitAtPoint(startVertex, endVertex, sliceStartPoint, posEqualEps);
      return split.splitVertex;
    })();

    let index = nextIndex;
    let loopCount = 0;
    const maxLoopCount = pline.vertexCount;
    for (;;) {
      if (loopCount > maxLoopCount) {
        // prevent infinite loop
        throw new Error(
          "loop_count exceeded max_loop_count while creating slices from intersects",
        );
      }
      loopCount += 1;

      // check if segment that starts at current vertex just added to slice has an intersect
      const nextIntrList = intersectsLookup.get(index);
      if (nextIntrList !== undefined) {
        // there is an intersect, slice is done
        const intersectPoint = nextIntrList[0].pos;

        const slice = booleanPlineSliceFromOpenPlineSlice(
          PlineViewData.create(
            pline,
            startIndex,
            intersectPoint,
            index,
            sliceStartVertex,
            loopCount,
            posEqualEps,
          ),
          !useSecondIndex,
          false,
        );

        const midpoint = segMidpoint(
          slice.viewData.updatedStart,
          pline.at(pline.nextWrappingIndex(slice.viewData.startIndex)),
        );
        if (pointOnSlicePred(midpoint)) {
          outputSlices.push(slice);
        }

        break;
      }
      // else there is not an intersect, increment index and continue
      index = pline.nextWrappingIndex(index);
    }
  }
}

/**
 * Holds all the slices after pruning them for the boolean operation performed. These slices can
 * then be stitched together to form the final result.
 */
export interface PrunedSlices {
  /**
   * Remaining slices to be stitched together.
   *
   * This array holds all the slices ordered according to their source and type: first block is
   * pline1 non-overlapping slices, next block starting at `startOfPline2Slices` index
   * position is non-overlapping slices from pline2, next block starting at
   * `startOfPline1OverlappingSlices` is pline1 overlapping slices,
   * and finally the last block starting at `startOfPline2OverlappingSlices` holds pline2
   * overlapping slices.
   */
  slicesRemaining: BooleanPlineSlice[];
  startOfPline2Slices: number;
  startOfPline1OverlappingSlices: number;
  startOfPline2OverlappingSlices: number;
}

/**
 * Prunes slices from polylines based on the specified boolean operation.
 *
 * This function slices both polylines at their intersection points and filters the resulting
 * slices based on the boolean operation's requirements. For example:
 * - **OR**: Keeps slices that are outside the other polyline
 * - **AND**: Keeps slices that are inside the other polyline
 * - **NOT**: Keeps pline1 slices outside pline2, and pline2 slices inside pline1
 * - **XOR**: Same as NOT (first pass only - XOR requires two passes, see `pruneSlicesImpl`)
 *
 * The resulting slices are organized into categories:
 * 1. Non-overlapping slices from pline1
 * 2. Non-overlapping slices from pline2
 * 3. Overlapping slices from pline1
 * 4. Overlapping slices from pline2
 *
 * These categorized slices can then be stitched together to form the final boolean result.
 *
 * This function is made public for visualization and testing purposes.
 */
export function pruneSlices(
  pline1: PlineSourceBase,
  pline2: PlineSourceBase,
  booleanInfo: ProcessForBooleanResult,
  operation: BooleanOp,
  posEqualEps: number,
): PrunedSlices {
  return pruneSlicesImpl(pline1, pline2, booleanInfo, operation, false, posEqualEps);
}

// Internal implementation that supports XOR second pass logic
function pruneSlicesImpl(
  pline1: PlineSourceBase,
  pline2: PlineSourceBase,
  booleanInfo: ProcessForBooleanResult,
  operation: BooleanOp,
  xorSecondPass: boolean,
  posEqualEps: number,
): PrunedSlices {
  const slicesRemaining: BooleanPlineSlice[] = [];

  const pointInPline1 = (pt: Vector2): boolean => pline1.windingNumber(pt) !== 0;
  const pointInPline2 = (pt: Vector2): boolean => pline2.windingNumber(pt) !== 0;

  // slice pline1
  if (xorSecondPass) {
    // For XOR second pass: pline2 NOT pline1
    sliceAtIntersects(pline1, booleanInfo, false, pointInPline2, slicesRemaining, posEqualEps);
  } else {
    switch (operation) {
      case "or":
        sliceAtIntersects(
          pline1,
          booleanInfo,
          false,
          (pt: Vector2) => !pointInPline2(pt),
          slicesRemaining,
          posEqualEps,
        );
        break;
      case "and":
        sliceAtIntersects(
          pline1,
          booleanInfo,
          false,
          pointInPline2,
          slicesRemaining,
          posEqualEps,
        );
        break;
      case "not":
      case "xor":
        sliceAtIntersects(
          pline1,
          booleanInfo,
          false,
          (pt: Vector2) => !pointInPline2(pt),
          slicesRemaining,
          posEqualEps,
        );
        break;
    }
  }

  const startOfPline2Slices = slicesRemaining.length;

  // slice pline2
  if (xorSecondPass) {
    // For XOR second pass: pline2 NOT pline1
    sliceAtIntersects(
      pline2,
      booleanInfo,
      true,
      (pt: Vector2) => !pointInPline1(pt),
      slicesRemaining,
      posEqualEps,
    );
  } else {
    switch (operation) {
      case "or":
      case "xor":
        sliceAtIntersects(
          pline2,
          booleanInfo,
          true,
          (pt: Vector2) => !pointInPline1(pt),
          slicesRemaining,
          posEqualEps,
        );
        break;
      case "and":
      case "not":
        sliceAtIntersects(pline2, booleanInfo, true, pointInPline1, slicesRemaining, posEqualEps);
        break;
    }
  }

  const startOfPline1OverlappingSlices = slicesRemaining.length;

  // add pline1 overlapping slices
  for (const s of booleanInfo.overlappingSlices) {
    slicesRemaining.push(booleanPlineSliceFromOverlapping(pline2, s, s.opposingDirections));
  }

  const startOfPline2OverlappingSlices = slicesRemaining.length;

  // add pline2 overlapping slices (note they are already oriented with same direction as pline2)
  for (const s of booleanInfo.overlappingSlices) {
    slicesRemaining.push(booleanPlineSliceFromOverlapping(pline2, s, false));
  }

  // Determine setOpposingDirection based on operation
  let setOpposingDirection: boolean;
  switch (operation) {
    case "or":
    case "and":
      setOpposingDirection = false;
      break;
    case "not":
    case "xor":
      setOpposingDirection = true;
      break;
  }

  if (setOpposingDirection !== booleanInfo.opposingDirections()) {
    // invert pline1 directions to match request to set opposing direction
    for (let i = 0; i < startOfPline2Slices; i += 1) {
      slicesRemaining[i].viewData.invertedDirection = true;
    }
  }

  return {
    slicesRemaining,
    startOfPline2Slices,
    startOfPline1OverlappingSlices,
    startOfPline2OverlappingSlices,
  };
}

export interface StitchSelector {
  select(currentSliceIdx: number, availableIdx: readonly number[]): number | null;
}

export class OrAndStitchSelector implements StitchSelector {
  private readonly startOfPline2Slices: number;
  private readonly startOfPline1OverlappingSlices: number;
  private readonly startOfPline2OverlappingSlices: number;

  constructor(
    startOfPline2Slices: number,
    startOfPline1OverlappingSlices: number,
    startOfPline2OverlappingSlices: number,
  ) {
    this.startOfPline2Slices = startOfPline2Slices;
    this.startOfPline1OverlappingSlices = startOfPline1OverlappingSlices;
    this.startOfPline2OverlappingSlices = startOfPline2OverlappingSlices;
  }

  static fromPrunedSlices(prunedSlices: PrunedSlices): OrAndStitchSelector {
    return new OrAndStitchSelector(
      prunedSlices.startOfPline2Slices,
      prunedSlices.startOfPline1OverlappingSlices,
      prunedSlices.startOfPline2OverlappingSlices,
    );
  }

  select(currentSliceIdx: number, availableIdx: readonly number[]): number | null {
    const isPline1Idx =
      currentSliceIdx < this.startOfPline2Slices ||
      (currentSliceIdx >= this.startOfPline1OverlappingSlices &&
        currentSliceIdx < this.startOfPline2OverlappingSlices);

    if (isPline1Idx) {
      // attempt to stitch to non-overlapping pline2 slice
      let found = availableIdx.find(
        (i) => i >= this.startOfPline2Slices && i < this.startOfPline1OverlappingSlices,
      );
      if (found === undefined) {
        // attempt to stitch to non-overlapping pline1 slice
        found = availableIdx.find((i) => i < this.startOfPline2Slices);
      }
      if (found === undefined) {
        // just use first available
        return availableIdx[0];
      }
      return found;
    }
    // attempt to stitch to non-overlapping pline1 slice
    let found = availableIdx.find((i) => i < this.startOfPline2Slices);
    if (found === undefined) {
      // attempt to stitch to non-overlapping pline2 slice
      found = availableIdx.find(
        (i) => i >= this.startOfPline2Slices && i < this.startOfPline1OverlappingSlices,
      );
    }
    if (found === undefined) {
      // just use first available
      return availableIdx[0];
    }
    return found;
  }
}

export class NotXorStitchSelector implements StitchSelector {
  private readonly startOfPline2Slices: number;
  private readonly startOfPline1OverlappingSlices: number;
  private readonly startOfPline2OverlappingSlices: number;

  constructor(
    startOfPline2Slices: number,
    startOfPline1OverlappingSlices: number,
    startOfPline2OverlappingSlices: number,
  ) {
    this.startOfPline2Slices = startOfPline2Slices;
    this.startOfPline1OverlappingSlices = startOfPline1OverlappingSlices;
    this.startOfPline2OverlappingSlices = startOfPline2OverlappingSlices;
  }

  static fromPrunedSlices(prunedSlices: PrunedSlices): NotXorStitchSelector {
    return new NotXorStitchSelector(
      prunedSlices.startOfPline2Slices,
      prunedSlices.startOfPline1OverlappingSlices,
      prunedSlices.startOfPline2OverlappingSlices,
    );
  }

  private idxForPline1Slice(availableIdx: readonly number[]): number | null {
    const found = availableIdx.find((i) => i < this.startOfPline2Slices);
    return found === undefined ? null : found;
  }

  private idxForPline2Slice(availableIdx: readonly number[]): number | null {
    const found = availableIdx.find(
      (i) => i >= this.startOfPline2Slices && i < this.startOfPline1OverlappingSlices,
    );
    return found === undefined ? null : found;
  }

  select(currentSliceIdx: number, availableIdx: readonly number[]): number | null {
    if (currentSliceIdx >= this.startOfPline1OverlappingSlices) {
      // current slice is overlapping
      if (currentSliceIdx < this.startOfPline2OverlappingSlices) {
        // current overlapping slice is from pline1
        // attempt to stitch to slice from pline2 then to
        // pline1 and if both fail then return null (stitching overlapping to overlapping is
        // never valid)
        return this.idxForPline2Slice(availableIdx) ?? this.idxForPline1Slice(availableIdx);
      }
      // else current overlapping slice is from pline2
      // attempt to stitch to slice from pline1 then to slice from pline2 and if both fail
      // then return null (stitching overlapping to overlapping is never valid)
      return this.idxForPline1Slice(availableIdx) ?? this.idxForPline2Slice(availableIdx);
    }

    // else current slice is not overlapping
    if (currentSliceIdx < this.startOfPline2Slices) {
      // current slice is from pline1, attempt to stitch to slice from pline2 and if not
      // possible then just return first available
      return this.idxForPline2Slice(availableIdx) ?? availableIdx[0];
    }

    // else current slice is from pline2, attempt to stitch to slice from pline1 and if not
    // possible then just return first available
    return this.idxForPline1Slice(availableIdx) ?? availableIdx[0];
  }
}

/**
 * Stitches open polyline slices together into closed polylines. The open polylines must be
 * ordered/agree on direction (every start point connects with an end point). `stitchSelector` is
 * used to determine priority of stitching in the case multiple possibilities exist.
 */
export function stitchSlicesIntoClosedPolylines(
  slices: readonly BooleanPlineSlice[],
  sourcePline1: PlineSourceBase,
  sourcePline2: PlineSourceBase,
  stitchSelector: StitchSelector,
  posEqualEps: number,
  collapsedAreaEps: number | null,
): BooleanResultPline<Polyline>[] {
  const result: BooleanResultPline<Polyline>[] = [];
  if (slices.length === 0) {
    return result;
  }

  // load all the slice start points into spatial index
  const aabbIndex = ((): StaticAabb2dIndex => {
    const builder = new StaticAabb2dIndexBuilder(slices.length);

    for (const slice of slices) {
      const pt = slice.viewData.invertedDirection
        ? slice.viewData.endPoint
        : slice.viewData.updatedStart.pos();
      builder.add(pt.x, pt.y, pt.x, pt.y);
    }

    return builder.build();
  })();

  const visitedSliceIdx: boolean[] = new Array(slices.length).fill(false);

  const closePline = (pline: Polyline, subslices: BooleanPlineSlice[]): void => {
    // sanity assert (start should connect back with end)
    debugAssert(
      pline
        .at(0)
        .pos()
        .fuzzyEqEps((pline.last() as PlineVertex).pos(), posEqualEps),
      "start should connect back with end",
    );

    if (pline.vertexCount < 3) {
      // skip slice in case of just two vertexes on top of each other
      return;
    }
    pline.removeLast();
    pline.setIsClosed(true);
    if (collapsedAreaEps !== null && Math.abs(pline.area()) < collapsedAreaEps) {
      // skip slice with area less than collapsedAreaEps
      return;
    }
    result.push({ pline, subslices });
  };

  const queryResults: number[] = [];

  const sliceToPline = (s: BooleanPlineSlice): Polyline => {
    if (s.sourceIsPline1) {
      return Polyline.createFromRemoveRepeat(s.viewData.view(sourcePline1), posEqualEps);
    }
    return Polyline.createFromRemoveRepeat(s.viewData.view(sourcePline2), posEqualEps);
  };

  const stitchSliceOnto = (s: BooleanPlineSlice, target: Polyline): void => {
    if (s.sourceIsPline1) {
      target.extendRemoveRepeat(s.viewData.view(sourcePline1), posEqualEps);
    } else {
      target.extendRemoveRepeat(s.viewData.view(sourcePline2), posEqualEps);
    }
  };

  // loop through all slice indexes
  for (let i = 0; i < slices.length; i += 1) {
    if (visitedSliceIdx[i]) {
      continue;
    }
    visitedSliceIdx[i] = true;

    const s = slices[i];
    const currentPline: Polyline = sliceToPline(s);
    const subslices: BooleanPlineSlice[] = [s];

    const beginningSliceIdx = i;
    let currentSliceIdx = i;
    let loopCount = 0;
    const maxLoopCount = slices.length;
    for (;;) {
      if (loopCount > maxLoopCount) {
        // prevent infinite loop
        throw new Error(
          "loop_count exceeded max_loop_count while creating closed polylines from slices",
        );
      }
      loopCount += 1;

      queryResults.length = 0;
      const queryVisitor = (idx: number): void => {
        // skip already visited
        if (idx === beginningSliceIdx || !visitedSliceIdx[idx]) {
          queryResults.push(idx);
        }
      };

      const ep = (currentPline.last() as PlineVertex).pos();
      aabbIndex.visitQuery(
        ep.x - posEqualEps,
        ep.y - posEqualEps,
        ep.x + posEqualEps,
        ep.y + posEqualEps,
        queryVisitor,
      );

      if (queryResults.length === 0) {
        // may arrive here due to epsilon/thresholds around overlapping segments,
        // discard the pline
        break;
      }

      const connectedSliceIdx = stitchSelector.select(currentSliceIdx, queryResults);
      if (connectedSliceIdx === null) {
        // discard current polyline
        break;
      } else if (connectedSliceIdx === beginningSliceIdx) {
        // connected back to beginning, close pline and add to result
        closePline(currentPline, subslices);
        break;
      } else {
        const connectedSlice = slices[connectedSliceIdx];
        currentPline.removeLast();
        stitchSliceOnto(connectedSlice, currentPline);
        visitedSliceIdx[connectedSliceIdx] = true;
        subslices.push(connectedSlice);

        // continue stitching slices to current pline, using last stitched index to find
        // next
        currentSliceIdx = connectedSliceIdx;
      }
    }
  }

  const compositeUserdata: number[] = [];
  for (const v of sourcePline1.getUserdataValues()) {
    compositeUserdata.push(v);
  }
  for (const v of sourcePline2.getUserdataValues()) {
    compositeUserdata.push(v);
  }

  for (const resultItem of result) {
    resultItem.pline.setUserdataValues(compositeUserdata);
  }

  return result;
}

/** Perform boolean operation between two polylines using parameters given. */
export function polylineBoolean(
  pline1: PlineSourceBase,
  pline2: PlineSourceBase,
  operation: BooleanOp,
  options: PlineBooleanOptions,
): BooleanResult<Polyline> {
  if (pline1.vertexCount < 2 || !pline1.isClosed || pline2.vertexCount < 2 || !pline2.isClosed) {
    return emptyBooleanResult("invalidInput");
  }

  const defaults = defaultPlineBooleanOptions();
  const optPosEqualEps = options.posEqualEps ?? defaults.posEqualEps;
  const pline1AabbIndex =
    options.pline1AabbIndex !== undefined && options.pline1AabbIndex !== null
      ? options.pline1AabbIndex
      : pline1.createApproxAabbIndex();

  const booleanInfo = processForBoolean(pline1, pline2, pline1AabbIndex, optPosEqualEps);

  // helper functions (assuming no intersects between pline1 and pline2)
  const isPline1InPline2 = (): boolean => pline2.windingNumber(pline1.at(0).pos()) !== 0;
  const isPline2InPline1 = (): boolean => pline1.windingNumber(pline2.at(0).pos()) !== 0;

  const posEqualEps = optPosEqualEps;
  const collapsedAreaEps =
    options.collapsedAreaEps !== undefined ? options.collapsedAreaEps : defaults.collapsedAreaEps;

  switch (operation) {
    case "or": {
      if (booleanInfo.completelyOverlapping()) {
        // pline1 completely overlapping pline2 just return pline2
        return booleanResultFromWholePlines([Polyline.createFrom(pline2)], [], "overlapping");
      } else if (!booleanInfo.anyIntersects()) {
        // no intersects, returning only one pline if one is inside other or both if they
        // are completely disjoint
        if (isPline1InPline2()) {
          return booleanResultFromWholePlines(
            [Polyline.createFrom(pline2)],
            [],
            "pline1InsidePline2",
          );
        } else if (isPline2InPline1()) {
          return booleanResultFromWholePlines(
            [Polyline.createFrom(pline1)],
            [],
            "pline2InsidePline1",
          );
        } else {
          return booleanResultFromWholePlines(
            [Polyline.createFrom(pline1), Polyline.createFrom(pline2)],
            [],
            "disjoint",
          );
        }
      } else {
        // keep all slices of pline1 that are not in pline2 and all slices of pline2 that
        // are not in pline1
        const prunedSlices = pruneSlices(pline1, pline2, booleanInfo, "or", posEqualEps);

        const stitchSelector = OrAndStitchSelector.fromPrunedSlices(prunedSlices);

        const remaining = stitchSlicesIntoClosedPolylines(
          prunedSlices.slicesRemaining,
          pline1,
          pline2,
          stitchSelector,
          posEqualEps,
          collapsedAreaEps,
        );

        const posPlines: BooleanResultPline<Polyline>[] = [];
        const negPlines: BooleanResultPline<Polyline>[] = [];

        for (const resultPline of remaining) {
          const orientation = resultPline.pline.orientation();
          if (orientation !== booleanInfo.pline2Orientation) {
            // orientation inverted from original, therefore it represents negative
            // space
            negPlines.push(resultPline);
          } else {
            // orientation stayed the same, therefore it represents positive space
            posPlines.push(resultPline);
          }
        }

        return { posPlines, negPlines, resultInfo: "intersected" };
      }
    }
    case "and": {
      if (booleanInfo.completelyOverlapping()) {
        // pline1 completely overlapping pline2 just return pline2
        return booleanResultFromWholePlines([Polyline.createFrom(pline2)], [], "overlapping");
      } else if (!booleanInfo.anyIntersects()) {
        // no intersects, returning only one pline if one is inside other or none if they
        // are completely disjoint
        if (isPline1InPline2()) {
          return booleanResultFromWholePlines(
            [Polyline.createFrom(pline1)],
            [],
            "pline1InsidePline2",
          );
        } else if (isPline2InPline1()) {
          return booleanResultFromWholePlines(
            [Polyline.createFrom(pline2)],
            [],
            "pline2InsidePline1",
          );
        } else {
          return emptyBooleanResult("disjoint");
        }
      } else {
        // keep all slices from pline1 that are in pline2 and all slices from pline2 that
        // are in pline1
        const prunedSlices = pruneSlices(pline1, pline2, booleanInfo, "and", posEqualEps);

        const stitchSelector = OrAndStitchSelector.fromPrunedSlices(prunedSlices);
        const posPlines = stitchSlicesIntoClosedPolylines(
          prunedSlices.slicesRemaining,
          pline1,
          pline2,
          stitchSelector,
          posEqualEps,
          collapsedAreaEps,
        );

        return { posPlines, negPlines: [], resultInfo: "intersected" };
      }
    }
    case "not": {
      if (booleanInfo.completelyOverlapping()) {
        // completely overlapping, nothing is left
        return emptyBooleanResult("overlapping");
      } else if (!booleanInfo.anyIntersects()) {
        if (isPline1InPline2()) {
          // everything is subtracted (nothing left)
          return emptyBooleanResult("pline1InsidePline2");
        } else if (isPline2InPline1()) {
          // negative space island created inside pline1
          return booleanResultFromWholePlines(
            [Polyline.createFrom(pline1)],
            [Polyline.createFrom(pline2)],
            "pline2InsidePline1",
          );
        } else {
          // disjoint
          return booleanResultFromWholePlines([Polyline.createFrom(pline1)], [], "disjoint");
        }
      } else {
        // keep all slices from pline1 that are not in pline2 and all slices on pline2 that
        // are in pline1
        const prunedSlices = pruneSlices(pline1, pline2, booleanInfo, "not", posEqualEps);

        const stitchSelector = NotXorStitchSelector.fromPrunedSlices(prunedSlices);

        const posPlines = stitchSlicesIntoClosedPolylines(
          prunedSlices.slicesRemaining,
          pline1,
          pline2,
          stitchSelector,
          posEqualEps,
          collapsedAreaEps,
        );

        return { posPlines, negPlines: [], resultInfo: "intersected" };
      }
    }
    case "xor": {
      if (booleanInfo.completelyOverlapping()) {
        return emptyBooleanResult("overlapping");
      } else if (!booleanInfo.anyIntersects()) {
        if (isPline1InPline2()) {
          return booleanResultFromWholePlines(
            [Polyline.createFrom(pline2)],
            [Polyline.createFrom(pline1)],
            "pline1InsidePline2",
          );
        } else if (isPline2InPline1()) {
          return booleanResultFromWholePlines(
            [Polyline.createFrom(pline1)],
            [Polyline.createFrom(pline2)],
            "pline2InsidePline1",
          );
        } else {
          // disjoint
          return booleanResultFromWholePlines(
            [Polyline.createFrom(pline1), Polyline.createFrom(pline2)],
            [],
            "disjoint",
          );
        }
      } else {
        // collect pline1 NOT pline2 results
        const prunedSlices1 = pruneSlices(pline1, pline2, booleanInfo, "not", posEqualEps);

        const stitchSelector1 = NotXorStitchSelector.fromPrunedSlices(prunedSlices1);
        const remaining1 = stitchSlicesIntoClosedPolylines(
          prunedSlices1.slicesRemaining,
          pline1,
          pline2,
          stitchSelector1,
          posEqualEps,
          collapsedAreaEps,
        );

        // collect pline2 NOT pline1 results
        const prunedSlices2 = pruneSlicesImpl(
          pline1,
          pline2,
          booleanInfo,
          "xor",
          true, // XOR second pass for pline2 NOT pline1
          posEqualEps,
        );

        const stitchSelector2 = NotXorStitchSelector.fromPrunedSlices(prunedSlices2);
        const remaining2 = stitchSlicesIntoClosedPolylines(
          prunedSlices2.slicesRemaining,
          pline1,
          pline2,
          stitchSelector2,
          posEqualEps,
          collapsedAreaEps,
        );

        for (const r of remaining2) {
          remaining1.push(r);
        }
        return { posPlines: remaining1, negPlines: [], resultInfo: "intersected" };
      }
    }
  }
}

// register the implementation for `PlineSourceBase.boolean`/`booleanOpt` (see module header and
// `booleanDispatch.ts` for why this indirection exists)
setPolylineBooleanImpl(polylineBoolean);
