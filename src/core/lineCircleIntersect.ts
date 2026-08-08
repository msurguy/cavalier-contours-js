import { fuzzyEqEps, fuzzyEqZero } from "./fuzzy.js";
import { minMax, parametricFromPoint } from "./mathUtils.js";
import { Vector2 } from "./vector2.js";

/** Holds the result of finding the intersect between a line segment and a circle. */
export type LineCircleIntr =
  /** No intersects found. */
  | { kind: "noIntersect" }
  /** One tangent intersect point found. */
  | {
      kind: "tangentIntersect";
      /** Holds the line segment parametric value for where the intersect point is. */
      t0: number;
    }
  /** Simple case of two intersect points found. */
  | {
      kind: "twoIntersects";
      /** Holds the line segment parametric value for where the first intersect point is. */
      t0: number;
      /** Holds the line segment parametric value for where the second intersect point is. */
      t1: number;
    };

/**
 * Finds the intersects between a line segment and a circle.
 *
 * This function returns the parametric solution(s) for the line segment equation
 * `P(t) = p0 + t * (p1 - p0)` for `t = 0` to `t = 1`. If `t < 0` or `t > 1` then intersect occurs
 * only when extending the segment out past the points `p0` and `p1` given.
 * If `t < 0` then the intersect is nearest to `p0`, if `t > 1.0` then the intersect is
 * nearest to `p1`. Intersects are "sticky" and "snap" to tangent points using fuzzy comparisons,
 * e.g. a segment very close to being tangent line will return a single intersect point.
 *
 * `epsilon` is used for fuzzy float comparisons.
 */
export function lineCircleIntr(
  p0: Vector2,
  p1: Vector2,
  radius: number,
  circleCenter: Vector2,
  epsilon: number,
): LineCircleIntr {
  // This function solves for t by solving for cartesian intersect points via geometric
  // equations with the circle centered at (0, 0). Using the line equation of the form
  // Ax + By + C = 0 (taken from p1 and p0 shifted to the origin) and comparing with the circle
  // radius. The x, y cartesian points are then converted to parametric t representation using
  // p0 and p1.

  // This approach was found to be more numerically stable than solving for t using the quadratic
  // equations.

  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const h = circleCenter.x;
  const k = circleCenter.y;

  const eps = epsilon;

  if (p0.fuzzyEqEps(p1, eps)) {
    // p0 == p1, test if point is on the circle, using average of the points x and y values for
    // fuzziness
    const xh = (p0.x + p1.x) / 2.0 - h;
    const yk = (p0.y + p1.y) / 2.0 - k;
    if (fuzzyEqEps(xh * xh + yk * yk, radius * radius, eps)) {
      return { kind: "tangentIntersect", t0: 0.0 };
    }

    return { kind: "noIntersect" };
  }

  const p0Shifted = p0.sub(circleCenter);
  const p1Shifted = p1.sub(circleCenter);

  // note: using Real number's defined epsilon for this check since it's just avoiding division by
  // too small a number, using the epsilon passed into this function causes unneeded loss of
  // precision (this branch is not directly determining the intersect result case returned)
  let a: number;
  let b: number;
  let c: number;
  if (fuzzyEqZero(dx)) {
    // vertical line, using average of point x values for fuzziness
    const xPos = (p1Shifted.x + p0Shifted.x) / 2.0;
    // x = x_pos
    // x - x_pos = 0

    // A = 1
    // B = 0
    // C = -x_pos
    a = 1.0;
    b = 0.0;
    c = -xPos;
  } else {
    // (y - y1) = m(x - x1)
    // y - y1 = mx - mx1
    // mx - y + y1 - mx1 = 0

    // A = -m
    // B = 1.0
    // C = -y1 + m*x1

    // m = (y1 - y0) / (x1 - x0)

    const m = dy / dx;
    a = m;
    b = -1.0;
    c = p1Shifted.y - m * p1Shifted.x;
  }

  const a2 = a * a;
  const b2 = b * b;
  const c2 = c * c;
  const r2 = radius * radius;
  const a2B2 = a2 + b2;

  // shortest distance from point on line to origin
  const shortestDist = Math.abs(c) / Math.sqrt(a2B2);

  if (shortestDist > radius + eps) {
    return { kind: "noIntersect" };
  }

  // adding h and k back to solution terms (shifting from origin back to real coordinates)
  const x0 = (-a * c) / a2B2 + h;
  const y0 = (-b * c) / a2B2 + k;

  if (fuzzyEqEps(shortestDist, radius, eps)) {
    const t = parametricFromPoint(p0, p1, new Vector2(x0, y0), eps);
    return { kind: "tangentIntersect", t0: t };
  }

  const d = r2 - c2 / a2B2;
  // taking abs to avoid NaN in case of very very small negative number as input to sqrt
  const mult = Math.sqrt(Math.abs(d / a2B2));

  const xSol1 = x0 + b * mult;
  const xSol2 = x0 - b * mult;
  const ySol1 = y0 - a * mult;
  const ySol2 = y0 + a * mult;
  const sol1 = parametricFromPoint(p0, p1, new Vector2(xSol1, ySol1), eps);
  const sol2 = parametricFromPoint(p0, p1, new Vector2(xSol2, ySol2), eps);
  const [t0, t1] = minMax(sol1, sol2);
  return { kind: "twoIntersects", t0, t1 };
}
