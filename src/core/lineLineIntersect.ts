import { fuzzyEqZeroEps, fuzzyGt, fuzzyInRange, fuzzyLt } from "./fuzzy.js";
import { parametricFromPoint } from "./mathUtils.js";
import type { Vector2 } from "./vector2.js";

/** Holds the result of finding the intersect between two line segments. */
export type LineLineIntr =
  /** No intersect, segments are parallel and not collinear. */
  | { kind: "noIntersect" }
  /** There is a true intersect between the line segments. */
  | {
      kind: "trueIntersect";
      /** Parametric value for intersect on first segment. */
      seg1T: number;
      /** Parametric value for intersect on second segment. */
      seg2T: number;
    }
  /** Segments overlap each other (are collinear) by some amount. */
  | {
      kind: "overlapping";
      /** Parametric value for start of coincidence along second segment. */
      seg2T0: number;
      /** Parametric value for end of coincidence along second segment. */
      seg2T1: number;
    }
  /** There is an intersect between the lines but one or both of the segments must be extended. */
  | {
      kind: "falseIntersect";
      /** Parametric value for intersect on first segment. */
      seg1T: number;
      /** Parametric value for intersect on second segment. */
      seg2T: number;
    };

/**
 * Finds the intersects between two lines segments.
 *
 * This function returns the parametric solution(s) using the general line segment equation
 * `P(t) = p0 + t * (p1 - p0)`. Where `t` then goes from 0 to 1. For `t < 0` or `t > 1` the result
 * is on the same line but not within the line segment.
 *
 * `epsilon` is used for fuzzy float comparisons.
 *
 * # Explanation on result cases `LineLineIntr`
 * ## `noIntersect`
 * Either of the following cases:
 * * Lines are (or almost, using `epsilon` to determine) parallel
 * * Both line segments are points and distinct from each other
 * * One line segment is a point and distinct from the other line segment
 *
 * ## `trueIntersect`
 * Either of the following cases:
 * * Line segments are not parallel and intersect at one point
 * * Both line segments are points and lie over each other (using `epsilon` for position compare)
 * * One line segment is a point and lies in other line segment (again using `epsilon`)
 *
 * ## `falseIntersect`
 * Either of the following cases:
 * * Line segments are not parallel and at least one must be extended to intersect (that is for
 *   `0 <= t <= 1` for both segments there is no intersect)
 *
 * ## `overlapping`
 * Either of the following cases:
 * * The lines are collinear and overlap, the segments may fully, partially or not overlap at all
 *   (determined by parametric t values returned)
 *
 * Line segments are defined by `v1->v2` and `u1->u2`.
 * Handles the cases where the lines may be parallel, collinear, or single points.
 */
export function lineLineIntr(
  v1: Vector2,
  v2: Vector2,
  u1: Vector2,
  u2: Vector2,
  epsilon: number,
): LineLineIntr {
  // This implementation works by processing the segments in parametric equation form and using
  // perpendicular products
  // http://geomalgorithms.com/a05-_intersect-1.html
  // http://mathworld.wolfram.com/PerpDotProduct.html

  const v = v2.sub(v1);
  const u = u2.sub(u1);
  const vPdotU = v.perpDot(u);
  const w = v1.sub(u1);

  const eps = epsilon;

  // segment lengths are used to scale parametric t value for fuzzy comparing
  // this ensures when comparing parametric values the epsilon value is applied with numbers at a
  // length/position scale, e.g., a difference in parametric t value of 0.1 represents a much
  // greater position difference for a segment with a length of 1,000,000 vs. a segment with a
  // length of 0.01, multiplying by the length first ensures that is accounted for to use with the
  // epsilon value
  const seg1Length = v2.sub(v1).length();
  const seg2Length = u2.sub(u1).length();

  // threshold check here to avoid almost parallel lines resulting in very distant intersection
  if (!fuzzyEqZeroEps(vPdotU, eps)) {
    // segments not parallel or collinear
    const seg1T = u.perpDot(w) / vPdotU;
    const seg2T = v.perpDot(w) / vPdotU;
    if (
      !fuzzyInRange(0.0, seg1T * seg1Length, seg1Length, eps) ||
      !fuzzyInRange(0.0, seg2T * seg2Length, seg2Length, eps)
    ) {
      return { kind: "falseIntersect", seg1T, seg2T };
    }
    return { kind: "trueIntersect", seg1T, seg2T };
  }

  // segments are parallel and possibly collinear
  const vPdotW = v.perpDot(w);
  const uPdotW = u.perpDot(w);

  // threshold check here, we consider almost parallel lines to be parallel
  if (!fuzzyEqZeroEps(vPdotW, eps) || !fuzzyEqZeroEps(uPdotW, eps)) {
    // parallel and not collinear so no intersect
    return { kind: "noIntersect" };
  }

  // either collinear or degenerate (segments are single points)
  const vIsPoint = v1.fuzzyEqEps(v2, eps);
  const uIsPoint = u1.fuzzyEqEps(u2, eps);

  if (vIsPoint && uIsPoint) {
    // both segments are points
    if (v1.fuzzyEqEps(u1, eps)) {
      // same point
      return { kind: "trueIntersect", seg1T: 0.0, seg2T: 0.0 };
    }
    // distinct points
    return { kind: "noIntersect" };
  }

  if (vIsPoint) {
    // v is point and u is not a point
    const seg2T = parametricFromPoint(u1, u2, v1, eps);
    if (fuzzyInRange(0.0, seg2T * seg2Length, seg2Length, eps)) {
      return { kind: "trueIntersect", seg1T: 0.0, seg2T };
    }

    return { kind: "noIntersect" };
  }

  if (uIsPoint) {
    // u is point and v is not a point
    const seg1T = parametricFromPoint(v1, v2, u1, eps);
    if (fuzzyInRange(0.0, seg1T * seg1Length, seg1Length, eps)) {
      return { kind: "trueIntersect", seg1T, seg2T: 0.0 };
    }

    return { kind: "noIntersect" };
  }

  // neither segment is a point, check if they overlap
  const w2 = v2.sub(u1);
  let seg2T0: number;
  let seg2T1: number;
  if (fuzzyEqZeroEps(u.x, eps)) {
    seg2T0 = w.y / u.y;
    seg2T1 = w2.y / u.y;
  } else {
    seg2T0 = w.x / u.x;
    seg2T1 = w2.x / u.x;
  }

  if (seg2T0 > seg2T1) {
    const temp = seg2T0;
    seg2T0 = seg2T1;
    seg2T1 = temp;
  }

  // using threshold check here to make intersect "sticky" to prefer considering it an intersect
  if (!fuzzyLt(seg2T0 * seg2Length, seg2Length, eps) || !fuzzyGt(seg2T1 * seg2Length, 0.0, eps)) {
    return { kind: "noIntersect" };
  }

  seg2T0 = Math.max(seg2T0, 0.0);
  seg2T1 = Math.min(seg2T1, 1.0);

  if (fuzzyEqZeroEps((seg2T1 - seg2T0) * seg2Length, eps)) {
    // intersect is a single point (segments line up end to end)
    // determine if seg1T is 0.0 or 1.0
    const seg1T =
      v1.fuzzyEqEps(u1, eps) || v1.fuzzyEqEps(u2, eps)
        ? // v1 touches which is start of seg1
          0.0
        : 1.0;

    return { kind: "trueIntersect", seg1T, seg2T: seg2T0 };
  }

  return { kind: "overlapping", seg2T0, seg2T1 };
}
