import { fuzzyEqEps, fuzzyEqZeroEps, fuzzyGt, fuzzyLt } from "./fuzzy.js";
import { Vector2 } from "./vector2.js";

/** Holds the result of finding the intersect between two circles. */
export type CircleCircleIntr =
  /** No intersects found. */
  | { kind: "noIntersect" }
  /** One tangent intersect point found. */
  | {
      kind: "tangentIntersect";
      /** Holds the tangent intersect point. */
      point: Vector2;
    }
  /** Simple case of two intersect points found. */
  | {
      kind: "twoIntersects";
      /** Holds the first intersect point. */
      point1: Vector2;
      /** Holds the second intersect point. */
      point2: Vector2;
    }
  /** Circles overlap each other (same circle). */
  | { kind: "overlapping" };

/**
 * Finds the intersects between two circles defined by the radius and center.
 *
 * This function returns the geometric solution(s) for the intersection of two circles.
 * The result will hold `noIntersect`, if the circles are too far apart, `overlapping`
 * if the circles are similar in radii and center. In the other cases, the result will
 * hold either a `tangentIntersect` with a single intersection point or `twoIntersects`
 * with two intersection points.
 *
 * `epsilon` is used for fuzzy float comparisons.
 */
export function circleCircleIntr(
  radius1: number,
  center1: Vector2,
  radius2: number,
  center2: Vector2,
  epsilon: number,
): CircleCircleIntr {
  // Reference algorithm: http://paulbourke.net/geometry/circlesphere/

  const cv = center2.sub(center1);
  const d2 = cv.dot(cv);
  const d = Math.sqrt(d2);

  const eps = epsilon;

  if (fuzzyEqZeroEps(d, eps)) {
    // same center position
    if (fuzzyEqEps(radius1, radius2, eps)) {
      return { kind: "overlapping" };
    }
    return { kind: "noIntersect" };
  }

  // different center position
  if (!fuzzyLt(d, radius1 + radius2, eps) || !fuzzyGt(d, Math.abs(radius1 - radius2), eps)) {
    // distance relative to radii is too large or too small for intersects to occur
    return { kind: "noIntersect" };
  }

  const rad1Sq = radius1 * radius1;
  const a = (rad1Sq - radius2 * radius2 + d2) / (2.0 * d);
  const midpoint = center1.add(cv.scale(a / d));
  const diff = rad1Sq - a * a;

  if (diff < 0.0) {
    return { kind: "tangentIntersect", point: midpoint };
  }

  const h = Math.sqrt(diff);
  const hOverD = h / d;
  const xTerm = hOverD * cv.y;
  const yTerm = hOverD * cv.x;

  const pt1 = new Vector2(midpoint.x + xTerm, midpoint.y - yTerm);
  const pt2 = new Vector2(midpoint.x - xTerm, midpoint.y + yTerm);

  if (pt1.fuzzyEqEps(pt2, eps)) {
    return { kind: "tangentIntersect", point: pt1 };
  }

  return { kind: "twoIntersects", point1: pt1, point2: pt2 };
}
