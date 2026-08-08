/**
 * Internal module for the polyline containment function.
 *
 * Port of `polyline/internal/pline_contains.rs`.
 */
import type { Vector2 } from "../../core/vector2.js";
import type { StaticAabb2dIndex } from "../../index2d/staticAabb2dIndex.js";
import type { PlineSourceBase } from "../plineSourceBase.js";
import {
  defaultPlineContainsOptions,
  type PlineContainsOptions,
  type PlineContainsResult,
} from "../plineTypes.js";
import { scanForIntersect } from "./plineIntersects.js";

/**
 * Determine if pline1 contains pline2.
 *
 * Note that overlapping segments are considered intersections by this function.
 *
 * Caution: Polylines with self-intersections may generate unexpected results.
 * Use `scanForSelfIntersect()` to find and reject self-intersecting polylines
 * if this is a possibility for your input data.
 */
export function polylineContains(
  pline1: PlineSourceBase,
  pline2: PlineSourceBase,
  options: PlineContainsOptions,
): PlineContainsResult {
  if (pline1.vertexCount < 2 || !pline1.isClosed || pline2.vertexCount < 2 || !pline2.isClosed) {
    return "invalidInput";
  }
  const defaults = defaultPlineContainsOptions();
  const posEqualEps = options.posEqualEps ?? defaults.posEqualEps;
  let pline1AabbIndex: StaticAabb2dIndex;
  if (options.pline1AabbIndex !== undefined && options.pline1AabbIndex !== null) {
    pline1AabbIndex = options.pline1AabbIndex;
  } else {
    pline1AabbIndex = pline1.createApproxAabbIndex();
  }

  // helper functions to test if point is inside pline1 and pline2
  const pointInPline1 = (point: Vector2): boolean => pline1.windingNumber(point) !== 0;
  const pointInPline2 = (point: Vector2): boolean => pline2.windingNumber(point) !== 0;

  // helper functions (assuming no intersects between pline1 and pline2)
  const isPline1InPline2 = (): boolean => pointInPline2(pline1.at(0).pos());
  const isPline2InPline1 = (): boolean => pointInPline1(pline2.at(0).pos());

  if (
    scanForIntersect(pline1, pline2, {
      pline1AabbIndex,
      posEqualEps,
    })
  ) {
    return "intersected";
  } else if (isPline2InPline1()) {
    return "pline2InsidePline1";
  } else if (isPline1InPline2()) {
    return "pline1InsidePline2";
  } else {
    return "disjoint";
  }
}
