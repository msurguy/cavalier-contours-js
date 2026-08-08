/**
 * Internal module for finding polyline intersects.
 *
 * Port of `polyline/internal/pline_intersects.rs` (except `OverlappingSlice` and
 * `sortAndJoinOverlappingIntersects` which live in `./overlappingSlices.ts` — they construct
 * `PlineViewData`/`PlineView` values at runtime and importing `plineView.ts` from this module
 * would form a runtime circular import back into `plineSourceBase.ts`, which imports this
 * module to implement its intersect methods).
 *
 * Rust `ControlFlow`-returning functions return `boolean` = "ran to completion without break"
 * and visitors return `false` to break (see `src/core/controlFlow.ts`).
 */
import type { VisitResult } from "../../core/controlFlow.js";
import { fuzzyEq } from "../../core/fuzzy.js";
import type { Vector2 } from "../../core/vector2.js";
import type { StaticAabb2dIndex } from "../../index2d/staticAabb2dIndex.js";
import { segFastApproxBoundingBox } from "../plineSeg.js";
import { plineSegIntr } from "../plineSegIntersect.js";
import type { PlineSourceBase } from "../plineSourceBase.js";
import {
  defaultFindIntersectsOptions,
  emptyPlineIntersectsCollection,
  type FindIntersectsOptions,
  type PlineBasicIntersect,
  type PlineIntersectVisitContext,
  type PlineIntersectVisitor,
  type PlineIntersectsCollection,
  type TwoPlinesIntersectVisitor,
} from "../plineTypes.js";

/**
 * Visits all local self intersects of the polyline. Local self intersects are defined as between
 * two polyline segments that share a vertex.
 *
 * Returns `true` if the visitor ran to completion, `false` if the visitor returned `false` to
 * break (Rust `C: ControlFlow` return).
 */
export function visitLocalSelfIntersects(
  polyline: PlineSourceBase,
  visitor: PlineIntersectVisitor,
  posEqualEps: number,
): boolean {
  const vc = polyline.vertexCount;
  if (vc < 2) {
    return true;
  }

  if (vc === 2) {
    if (polyline.isClosed) {
      // check if entirely overlaps self
      if (fuzzyEq(polyline.at(0).bulge, -polyline.at(1).bulge)) {
        // overlapping
        return (
          visitor({
            kind: "overlapping",
            startIndex1: 0,
            startIndex2: 1,
            point1: polyline.at(0).pos(),
            point2: polyline.at(1).pos(),
          }) !== false
        );
      }
    }
    return true;
  }

  const visitIndexes = (i: number, j: number, k: number): boolean => {
    const v1 = polyline.at(i);
    const v2 = polyline.at(j);
    const v3 = polyline.at(k);

    // testing for intersection between v1->v2 and v2->v3 segments
    if (v1.pos().fuzzyEqEps(v2.pos(), posEqualEps)) {
      // singularity
      if (
        visitor({
          kind: "overlapping",
          startIndex1: i,
          startIndex2: j,
          point1: v1.pos(),
          point2: v2.pos(),
        }) === false
      ) {
        return false;
      }
    } else {
      const intr = plineSegIntr(v1, v2, v2, v3, posEqualEps);
      switch (intr.kind) {
        case "noIntersect":
          break;
        case "tangentIntersect":
        case "oneIntersect": {
          if (!intr.point.fuzzyEqEps(v2.pos(), posEqualEps)) {
            if (
              visitor({ kind: "basic", startIndex1: i, startIndex2: j, point: intr.point }) ===
              false
            ) {
              return false;
            }
          }
          break;
        }
        case "twoIntersects": {
          if (!intr.point1.fuzzyEqEps(v2.pos(), posEqualEps)) {
            if (
              visitor({ kind: "basic", startIndex1: i, startIndex2: j, point: intr.point1 }) ===
              false
            ) {
              return false;
            }
          }

          if (!intr.point2.fuzzyEqEps(v2.pos(), posEqualEps)) {
            // NOTE: redundant call kept to transliterate the Rust source exactly (the Rust code
            // makes this call with the result unused)
            plineSegIntr(v1, v2, v2, v3, posEqualEps);
            if (
              visitor({ kind: "basic", startIndex1: i, startIndex2: j, point: intr.point2 }) ===
              false
            ) {
              return false;
            }
          }
          break;
        }
        case "overlappingLines":
        case "overlappingArcs": {
          if (
            visitor({
              kind: "overlapping",
              startIndex1: i,
              startIndex2: j,
              point1: intr.point1,
              point2: intr.point2,
            }) === false
          ) {
            return false;
          }
          break;
        }
      }
    }

    return true;
  };

  for (let i = 2; i < vc; i += 1) {
    if (!visitIndexes(i - 2, i - 1, i)) {
      return false;
    }
  }

  if (polyline.isClosed) {
    // we tested for intersect between segments at indexes 0->1, 1->2 and everything up to and
    // including (count-3)->(count-2), (count-2)->(count-1), polyline is closed so now test
    // [(count-2)->(count-1), (count-1)->0] and [(count-1)->0, 0->1]
    if (!visitIndexes(vc - 2, vc - 1, 0)) {
      return false;
    }
    if (!visitIndexes(vc - 1, 0, 1)) {
      return false;
    }
  }
  return true;
}

/**
 * Visits all global self intersects of the polyline. Global self intersects are defined as between
 * two polyline segments that do not share a vertex.
 *
 * In the case of two intersects on one segment the intersects will be added as two
 * `PlineBasicIntersect` in the order of distance from the start of the second segment.
 *
 * In the case of an intersect at the very start of a polyline segment the vertex index of the
 * start of that segment is recorded (unless the polyline is open and the intersect is at the very
 * end of the polyline, then the second to last vertex index is used to maintain that it represents
 * the start of a polyline segment).
 *
 * Returns `true` if the visitor ran to completion, `false` if the visitor returned `false` to
 * break (Rust `C: ControlFlow` return).
 */
export function visitGlobalSelfIntersects(
  polyline: PlineSourceBase,
  aabbIndex: StaticAabb2dIndex,
  visitor: PlineIntersectVisitor,
  posEqualEps: number,
): boolean {
  const vc = polyline.vertexCount;

  if (vc < 3) {
    return true;
  }

  // Rust `HashSet<(usize, usize)>` of visited segment index pairs — encoded as `i * vc + hitI`
  // (both values are segment start vertex indexes and therefore < vc; vc * vc stays a safe
  // integer for any polyline with fewer than ~94.9 million vertexes)
  const visitedPairs = new Set<number>();

  // iterate all segment bounding boxes in the spatial index querying itself to test for self
  // intersects
  let broke = false; // Rust `cf` (captures visitor break out of the query visitor closure)
  const itemIndices = aabbIndex.itemIndices();
  const itemBoxes = aabbIndex.itemBoxes();
  for (let boxIndex = 0; boxIndex < itemIndices.length; boxIndex += 1) {
    const i = itemIndices[boxIndex];
    const aabb = itemBoxes[boxIndex];
    const j = polyline.nextWrappingIndex(i);
    const v1 = polyline.at(i);
    const v2 = polyline.at(j);
    const queryVisitor = (hitI: number): VisitResult => {
      const hitJ = polyline.nextWrappingIndex(hitI);
      // skip local segments
      if (i === hitI || i === hitJ || j === hitI || j === hitJ) {
        return true;
      }

      // skip already visited pairs (reverse index pair order for lookup to work, e.g. we
      // visit (1, 2) then (2, 1) and we only want to visit the segment pair once)
      if (visitedPairs.has(hitI * vc + i)) {
        return true;
      }

      // add pair being visited
      visitedPairs.add(i * vc + hitI);

      const u1 = polyline.at(hitI);
      const u2 = polyline.at(hitJ);
      const skipIntrAtEnd = (intr: Vector2): boolean => {
        // skip intersect if it is at end point of either pline segment since it will be
        // found again by another segment with the intersect at its start point (this is
        // true even for an open polyline since we're finding self intersects)
        return (
          v2.pos().fuzzyEqEps(intr, posEqualEps) && u2.pos().fuzzyEqEps(intr, posEqualEps)
        );
      };

      const intr = plineSegIntr(v1, v2, u1, u2, posEqualEps);
      switch (intr.kind) {
        case "noIntersect":
          break;
        case "tangentIntersect":
        case "oneIntersect": {
          if (!skipIntrAtEnd(intr.point)) {
            if (
              visitor({ kind: "basic", startIndex1: i, startIndex2: hitI, point: intr.point }) ===
              false
            ) {
              broke = true;
              return false;
            }
          }
          break;
        }
        case "twoIntersects": {
          if (!skipIntrAtEnd(intr.point1)) {
            if (
              visitor({ kind: "basic", startIndex1: i, startIndex2: hitI, point: intr.point1 }) ===
              false
            ) {
              broke = true;
              return false;
            }
          }

          if (!skipIntrAtEnd(intr.point2)) {
            if (
              visitor({ kind: "basic", startIndex1: i, startIndex2: hitI, point: intr.point2 }) ===
              false
            ) {
              broke = true;
              return false;
            }
          }
          break;
        }
        case "overlappingLines":
        case "overlappingArcs": {
          if (!skipIntrAtEnd(intr.point1)) {
            if (
              visitor({
                kind: "overlapping",
                startIndex1: i,
                startIndex2: hitI,
                point1: intr.point1,
                point2: intr.point2,
              }) === false
            ) {
              broke = true;
              return false;
            }
          }
          break;
        }
      }

      return true;
    };

    aabbIndex.visitQuery(
      aabb.minX - posEqualEps,
      aabb.minY - posEqualEps,
      aabb.maxX + posEqualEps,
      aabb.maxY + posEqualEps,
      queryVisitor,
    );

    if (broke) {
      break;
    }
  }

  return !broke;
}

/**
 * Find all self intersects of a polyline. If `includeOverlapping` is `true` then overlapping
 * intersects are returned as two basic intersects, one at each end of the overlap. If
 * `includeOverlapping` is `false` then overlapping intersects are not returned.
 */
export function allSelfIntersectsAsBasic(
  polyline: PlineSourceBase,
  aabbIndex: StaticAabb2dIndex,
  includeOverlapping: boolean,
  posEqualEps: number,
): PlineBasicIntersect[] {
  const intrs: PlineBasicIntersect[] = [];

  const visitor: PlineIntersectVisitor = (intr) => {
    if (intr.kind === "basic") {
      intrs.push({ startIndex1: intr.startIndex1, startIndex2: intr.startIndex2, point: intr.point });
    } else {
      if (includeOverlapping) {
        intrs.push({
          startIndex1: intr.startIndex1,
          startIndex2: intr.startIndex2,
          point: intr.point1,
        });

        intrs.push({
          startIndex1: intr.startIndex1,
          startIndex2: intr.startIndex2,
          point: intr.point2,
        });
      }
    }
  };

  visitLocalSelfIntersects(polyline, visitor, posEqualEps);
  visitGlobalSelfIntersects(polyline, aabbIndex, visitor, posEqualEps);

  return intrs;
}

/**
 * Visit all intersections between two polylines.
 *
 * NOTE (mirrors the Rust source): a visitor break stops visiting query hits for the current
 * `pline2` segment only — iteration proceeds to the next `pline2` segment (the Rust function
 * returns `()` and does not propagate the break to the outer loop).
 */
export function visitIntersects(
  pline1: PlineSourceBase,
  pline2: PlineSourceBase,
  visitor: TwoPlinesIntersectVisitor,
  options: FindIntersectsOptions,
): void {
  if (pline1.vertexCount < 2 || pline2.vertexCount < 2) {
    return;
  }

  // extract option parameters
  const defaults = defaultFindIntersectsOptions();
  const posEqualEps = options.posEqualEps ?? defaults.posEqualEps;
  const pline1AabbIndex = options.pline1AabbIndex ?? pline1.createApproxAabbIndex();

  for (const [i2, j2] of pline2.iterSegmentIndexes()) {
    const pline2Context: PlineIntersectVisitContext = {
      vertexIndex: i2,
      v1: pline2.at(i2),
      v2: pline2.at(j2),
    };

    const queryVisitor = (i1: number): VisitResult => {
      const j1 = pline1.nextWrappingIndex(i1);

      const pline1Context: PlineIntersectVisitContext = {
        vertexIndex: i1,
        v1: pline1.at(i1),
        v2: pline1.at(j1),
      };

      if (
        visitor(
          plineSegIntr(
            pline1Context.v1,
            pline1Context.v2,
            pline2Context.v1,
            pline2Context.v2,
            posEqualEps,
          ),
          pline1Context,
          pline2Context,
        ) === false
      ) {
        return false;
      }
      return true;
    };

    const bb = segFastApproxBoundingBox(pline2Context.v1, pline2Context.v2);

    pline1AabbIndex.visitQuery(
      bb.minX - posEqualEps,
      bb.minY - posEqualEps,
      bb.maxX + posEqualEps,
      bb.maxY + posEqualEps,
      queryVisitor,
    );
  }
}

/**
 * Find all intersects between two polylines.
 *
 * In the case of overlapping intersects `point1` is always closest to the start of the second
 * segment (`startIndex2`) and `point2` furthest from the start of the second segment.
 *
 * In the case of two intersects on one segment the intersects will be added as two
 * `PlineBasicIntersect` in the order of distance from the start of the second segment.
 *
 * In the case of an intersect at the very start of a polyline segment the vertex index of the
 * start of that segment is recorded (unless the polyline is open and the intersect is at the very
 * end of the polyline, then the second to last vertex index is used to maintain that it represents
 * the start of a polyline segment).
 */
export function findIntersects(
  pline1: PlineSourceBase,
  pline2: PlineSourceBase,
  options: FindIntersectsOptions,
): PlineIntersectsCollection {
  const result = emptyPlineIntersectsCollection();
  if (pline1.vertexCount < 2 || pline2.vertexCount < 2) {
    return result;
  }

  // extract option parameters
  const defaults = defaultFindIntersectsOptions();
  const posEqualEps = options.posEqualEps ?? defaults.posEqualEps;

  // hash sets used to keep track of possible duplicate intersects being recorded due to
  // overlapping segments
  const possibleDuplicates1 = new Set<number>();
  const possibleDuplicates2 = new Set<number>();

  // last polyline segment starting indexes for open polylines (used to check when skipping
  // intersects at end points of polyline segments)
  const open1LastIdx = pline1.vertexCount - 2;
  const open2LastIdx = pline2.vertexCount - 2;

  const visitor: TwoPlinesIntersectVisitor = (intersect, pline1Context, pline2Context) => {
    const i1 = pline1Context.vertexIndex;
    const i2 = pline2Context.vertexIndex;

    const skipIntrAtEnd = (intr: Vector2): boolean => {
      // skip intersect at end point of pline segment since it will be found again by the
      // segment with it as its start point (unless the polyline is open and we're looking
      // at the very end point of the polyline, then include the intersect)
      return (
        (pline1Context.v2.pos().fuzzyEqEps(intr, posEqualEps) &&
          (pline1.isClosed || i1 !== open1LastIdx)) ||
        (pline2Context.v2.pos().fuzzyEqEps(intr, posEqualEps) &&
          (pline2.isClosed || i2 !== open2LastIdx))
      );
    };

    switch (intersect.kind) {
      case "noIntersect":
        break;
      case "tangentIntersect":
      case "oneIntersect": {
        if (!skipIntrAtEnd(intersect.point)) {
          result.basicIntersects.push({
            startIndex1: i1,
            startIndex2: i2,
            point: intersect.point,
          });
        }
        break;
      }
      case "twoIntersects": {
        if (!skipIntrAtEnd(intersect.point1)) {
          result.basicIntersects.push({
            startIndex1: i1,
            startIndex2: i2,
            point: intersect.point1,
          });
        }
        if (!skipIntrAtEnd(intersect.point2)) {
          result.basicIntersects.push({
            startIndex1: i1,
            startIndex2: i2,
            point: intersect.point2,
          });
        }
        break;
      }
      case "overlappingLines":
      case "overlappingArcs": {
        result.overlappingIntersects.push({
          startIndex1: i1,
          startIndex2: i2,
          point1: intersect.point1,
          point2: intersect.point2,
        });

        if (
          pline1Context.v2.pos().fuzzyEqEps(intersect.point1, posEqualEps) ||
          pline1Context.v2.pos().fuzzyEqEps(intersect.point2, posEqualEps)
        ) {
          possibleDuplicates1.add(pline1.nextWrappingIndex(i1));
        }
        if (
          pline2Context.v2.pos().fuzzyEqEps(intersect.point1, posEqualEps) ||
          pline2Context.v2.pos().fuzzyEqEps(intersect.point2, posEqualEps)
        ) {
          possibleDuplicates2.add(pline2.nextWrappingIndex(i2));
        }
        break;
      }
    }
  };

  visitIntersects(pline1, pline2, visitor, options);

  if (possibleDuplicates1.size === 0 && possibleDuplicates2.size === 0) {
    return result;
  }

  // remove any duplicate points caused by end point intersects + overlapping
  const finalBasicIntrs: PlineBasicIntersect[] = [];

  for (const intr of result.basicIntersects) {
    if (possibleDuplicates1.has(intr.startIndex1)) {
      const startPt1 = pline1.at(intr.startIndex1).pos();
      if (intr.point.fuzzyEqEps(startPt1, posEqualEps)) {
        // skip including the intersect
        continue;
      }
    }

    if (possibleDuplicates2.has(intr.startIndex2)) {
      const startPt2 = pline2.at(intr.startIndex2).pos();
      if (intr.point.fuzzyEqEps(startPt2, posEqualEps)) {
        // skip including the intersect
        continue;
      }
    }

    finalBasicIntrs.push(intr);
  }

  result.basicIntersects = finalBasicIntrs;
  return result;
}

/**
 * Find if two polylines have any intersections.
 *
 * Any overlapping segments will be treated as an intersection and cause
 * `scanForIntersect()` to return true.
 */
export function scanForIntersect(
  pline1: PlineSourceBase,
  pline2: PlineSourceBase,
  options: FindIntersectsOptions,
): boolean {
  let foundIntersect = false;

  const visitor: TwoPlinesIntersectVisitor = (intersect) => {
    switch (intersect.kind) {
      case "noIntersect":
        return true;
      case "tangentIntersect":
      case "oneIntersect":
      case "twoIntersects":
      case "overlappingLines":
      case "overlappingArcs": {
        foundIntersect = true;
        return false;
      }
    }
  };

  visitIntersects(pline1, pline2, visitor, options);

  return foundIntersect;
}
