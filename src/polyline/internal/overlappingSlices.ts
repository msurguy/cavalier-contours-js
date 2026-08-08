/**
 * Internal module for joining overlapping polyline intersects into slices.
 *
 * Port of `OverlappingSlice` and `sort_and_join_overlapping_intersects` from
 * `polyline/internal/pline_intersects.rs`. These live in a separate module from
 * `plineIntersects.ts` because they construct `PlineViewData`/`PlineView` values at runtime —
 * importing `plineView.ts` from `plineIntersects.ts` would form a runtime circular import
 * (`plineSourceBase.ts` → `plineIntersects.ts` → `plineView.ts` → `plineSourceBase.ts`) that
 * breaks `class PlineView extends PlineSourceBase` at module evaluation time.
 */
import { debugAssert } from "../../core/controlFlow.js";
import { distSquared } from "../../core/mathUtils.js";
import { segSplitAtPoint, segTangentVector } from "../plineSeg.js";
import type { PlineSourceBase } from "../plineSourceBase.js";
import type { PlineOverlappingIntersect } from "../plineTypes.js";
import type { PlineVertex } from "../plineVertex.js";
import { PlineView, PlineViewData } from "../plineView.js";

/**
 * Represents an open polyline slice where there was overlap between polylines across one or more
 * segments.
 *
 * `source` polyline for `viewData` is always the second polyline.
 */
export class OverlappingSlice {
  /** Start vertex indexes of the slice according to the original polylines that overlapped. */
  startIndexes: [number, number];
  /** End vertex indexes of the slice according to the original polylines that overlapped. */
  endIndexes: [number, number];
  /** View data for the slice, source is always the second polyline. */
  viewData: PlineViewData;
  /** If true then overlapping slice forms a closed loop on itself, otherwise it does not. */
  isLoop: boolean;
  /** If true then the overlapping slice was formed by segments that have opposing directions. */
  opposingDirections: boolean;

  /** Rust `OverlappingSlice::new` (`endIntr` is `null` when the slice is created from a single
   * overlapping intersect). */
  constructor(
    pline1: PlineSourceBase,
    pline2: PlineSourceBase,
    startIntr: PlineOverlappingIntersect,
    endIntr: PlineOverlappingIntersect | null,
    posEqualEps: number,
  ) {
    const startV1 = pline1.at(startIntr.startIndex1);
    const startV2 = pline1.at(pline1.nextWrappingIndex(startIntr.startIndex1));
    const startU1 = pline2.at(startIntr.startIndex2);
    const startU2 = pline2.at(pline2.nextWrappingIndex(startIntr.startIndex2));
    // tangent vectors are either going same direction or opposite direction, just test dot
    // product sign to determine if going same direction
    const t1 = segTangentVector(startV1, startV2, startIntr.point1);
    const t2 = segTangentVector(startU1, startU2, startIntr.point1);
    const opposingDirections = t1.dot(t2) < 0.0;

    const startIndexes: [number, number] = [startIntr.startIndex1, startIntr.startIndex2];

    const createUpdatedStart = (): PlineVertex => {
      // create updated start by using point1 for position and determining bulge required
      // to form subsegment to point2
      const split1 = segSplitAtPoint(startU1, startU2, startIntr.point1, posEqualEps);
      const split2 = segSplitAtPoint(split1.splitVertex, startU2, startIntr.point2, posEqualEps);
      return split2.updatedStart;
    };

    if (endIntr === null) {
      // slice created from single overlapping intersect
      const updatedStart = createUpdatedStart();
      const updatedEndBulge = updatedStart.bulge;
      const endPoint = startIntr.point2;
      const endIndexOffset = 0;

      this.startIndexes = startIndexes;
      this.endIndexes = startIndexes;
      this.viewData = new PlineViewData(
        startIndexes[1],
        endIndexOffset,
        updatedStart,
        updatedEndBulge,
        endPoint,
        false,
      );
      this.isLoop = false;
      this.opposingDirections = opposingDirections;
    } else {
      // slice created from multiple intersects joined together end to start

      // check if endIntr forms closed loop back to startIntr
      if (endIntr.point2.fuzzyEqEps(startIntr.point1, posEqualEps)) {
        // slice forms closed loop
        this.startIndexes = startIndexes;
        this.endIndexes = startIndexes;
        this.viewData = new PlineViewData(
          startIndexes[1],
          pline2.vertexCount - 1,
          startU1,
          pline2.at(pline2.vertexCount - 1).bulge,
          endIntr.point2,
          false,
        );
        this.isLoop = true;
        this.opposingDirections = opposingDirections;
      } else {
        // slice does not form closed loop
        const endPoint = endIntr.point2;
        const endIndexes: [number, number] = [endIntr.startIndex1, endIntr.startIndex2];
        const endIndexOffset = pline2.fwdWrappingDist(startIndexes[1], endIntr.startIndex2);

        // check if all on one pline2 segment or not
        if (startIntr.startIndex2 === endIntr.startIndex2) {
          // slice is all on one pline2 segment
          // updatedStart positioned at startIntr.point1 and connects with endPoint
          // updatedEnd == updatedStart
          // endPoint positioned at endIntr.point2
          const split1 = segSplitAtPoint(startU1, startU2, startIntr.point1, posEqualEps);
          const split2 = segSplitAtPoint(split1.splitVertex, startU2, endIntr.point2, posEqualEps);
          const updatedStart = split2.updatedStart;

          const updatedEndBulge = updatedStart.bulge;

          this.startIndexes = startIndexes;
          this.endIndexes = endIndexes;
          this.viewData = new PlineViewData(
            startIndexes[1],
            endIndexOffset,
            updatedStart,
            updatedEndBulge,
            endPoint,
            false,
          );
          this.isLoop = false;
          this.opposingDirections = opposingDirections;
        } else {
          // slice is not on one pline2 segment
          // updatedStart positioned at startIntr.point1 and connects with startU2
          // updatedEnd positioned at endIntr.point1 and connects with endIntr.point2
          // endPoint positioned at endIntr.point2
          const split1 = segSplitAtPoint(startU1, startU2, startIntr.point1, posEqualEps);
          const updatedStart = split1.splitVertex;

          const endU1 = pline2.at(endIntr.startIndex2);
          const endU2 = pline2.at(pline2.nextWrappingIndex(endIntr.startIndex2));

          const endSplit1 = segSplitAtPoint(endU1, endU2, endIntr.point1, posEqualEps);
          const endSplit2 = segSplitAtPoint(
            endSplit1.splitVertex,
            endU2,
            endIntr.point2,
            posEqualEps,
          );
          const updatedEnd = endSplit2.updatedStart;

          this.startIndexes = startIndexes;
          this.endIndexes = endIndexes;
          this.viewData = new PlineViewData(
            startIndexes[1],
            endIndexOffset,
            updatedStart,
            updatedEnd.bulge,
            endPoint,
            false,
          );
          this.isLoop = false;
          this.opposingDirections = opposingDirections;
        }
      }
    }
  }

  /** Create a `PlineView` of the slice using the `source` polyline given. */
  view(source: PlineSourceBase): PlineView {
    return new PlineView(source, this.viewData);
  }
}

/**
 * Sorts the overlapping `intersects` given according to `pline2` direction and vertex indexes
 * and returns all the overlapping `intersects` joined together into slices.
 *
 * This function assumes the intersects given follow the convention that `point1` is closest to the
 * pline2's segment start and `point2` is furthest from the start of pline2's segment start.
 */
export function sortAndJoinOverlappingIntersects(
  intersects: PlineOverlappingIntersect[],
  pline1: PlineSourceBase,
  pline2: PlineSourceBase,
  posEqualEps: number,
): OverlappingSlice[] {
  const result: OverlappingSlice[] = [];

  if (intersects.length === 0) {
    return result;
  }

  debugAssert(
    intersects.every((intr) => {
      const start = pline2.at(intr.startIndex2).pos();
      const dist1 = distSquared(start, intr.point1);
      const dist2 = distSquared(start, intr.point2);
      return dist1 <= dist2;
    }),
    "intersect point1 and point2 expected to be sorted according to pline2 direction!",
  );

  // sort the intersects according to pline2 direction (points within the intersects
  // are already sorted with point1 closer to start of the pline2 segment than point2)
  intersects.sort((intrA, intrB) => {
    if (intrA.startIndex2 !== intrB.startIndex2) {
      return intrA.startIndex2 - intrB.startIndex2;
    }
    // equal startIndex2 so sort by distance from start
    const start = pline2.at(intrA.startIndex2).pos();
    const dist1 = distSquared(start, intrA.point1);
    const dist2 = distSquared(start, intrB.point1);
    return dist1 < dist2 ? -1 : dist1 > dist2 ? 1 : 0;
  });

  let startIntr = intersects[0];
  let endIntr: PlineOverlappingIntersect | null = null;
  let currentEndPoint = startIntr.point2;

  // skip first intr (already processed by setting startIntr)
  for (let idx = 1; idx < intersects.length; idx += 1) {
    const intr = intersects[idx];
    // check if intr start point connects with endIntr end point
    if (!intr.point1.fuzzyEqEps(currentEndPoint, posEqualEps)) {
      // intr does not join with previous intr, cap off slice and add to result
      const slice = new OverlappingSlice(pline1, pline2, startIntr, endIntr, posEqualEps);
      result.push(slice);

      startIntr = intr;
      endIntr = null;
    } else {
      endIntr = intr;
    }

    currentEndPoint = intr.point2;
  }

  // cap off final slice and add to result
  const slice = new OverlappingSlice(pline1, pline2, startIntr, endIntr, posEqualEps);
  result.push(slice);

  if (result.length > 1) {
    // check if last overlapping slice connects with first
    const lastSliceEnd = result[result.length - 1].viewData.endPoint;
    const firstSliceBegin = result[0].viewData.updatedStart.pos();
    if (lastSliceEnd.fuzzyEqEps(firstSliceBegin, posEqualEps)) {
      // they do connect, join them together by updating the first slice and removing the last
      const lastSlice = result.pop() as OverlappingSlice;
      const firstSlice = result[0];
      firstSlice.startIndexes = lastSlice.startIndexes;
      firstSlice.viewData.updatedStart = lastSlice.viewData.updatedStart;
      firstSlice.viewData.endIndexOffset += lastSlice.viewData.endIndexOffset;

      if (lastSlice.viewData.endPoint.fuzzyEqEps(pline2.at(0).pos(), posEqualEps)) {
        // add one to offset to capture pline2[0] vertex (it is at point of connection)
        firstSlice.viewData.endIndexOffset += 1;
      }
    }
  }

  return result;
}
