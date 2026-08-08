import { debugAssert } from "./controlFlow.js";
import { FUZZY_EPSILON, fuzzyEq, fuzzyEqZeroEps } from "./fuzzy.js";
import { Vector2 } from "./vector2.js";

/** Tau constant (`2 * PI`), Rust `T::tau()`. */
export const TAU = 2.0 * Math.PI;

/**
 * Returns the (min, max) values from `v1` and `v2`.
 *
 * # Examples
 *
 * ```ts
 * const [minVal, maxVal] = minMax(8, 4);
 * // minVal === 4
 * // maxVal === 8
 * ```
 */
export function minMax(v1: number, v2: number): [number, number] {
  if (v1 < v2) {
    return [v1, v2];
  } else {
    return [v2, v1];
  }
}

/**
 * Normalize radians to be between `0` and `2PI`, e.g. `-PI/4` becomes `7PI/4` and `5PI` becomes
 * `PI`.
 *
 * # Examples
 *
 * ```ts
 * normalizeRadians(5.0 * Math.PI); // fuzzy equals Math.PI
 * normalizeRadians(-Math.PI / 4.0); // fuzzy equals 7.0 * Math.PI / 4.0
 * // anything between 0 and 2PI inclusive is left unchanged
 * normalizeRadians(0.0); // fuzzy equals 0.0
 * normalizeRadians(Math.PI); // fuzzy equals Math.PI
 * normalizeRadians(2.0 * Math.PI); // fuzzy equals 2.0 * Math.PI
 * ```
 */
export function normalizeRadians(angle: number): number {
  if (angle >= 0.0 && angle <= TAU) {
    return angle;
  }

  return angle - Math.floor(angle / TAU) * TAU;
}

/**
 * Returns the smaller difference between two angles.
 *
 * Result is negative if `normalizeRadians(angle2 - angle1) > PI`. See `normalizeRadians` for
 * more information.
 *
 * # Examples
 *
 * ```ts
 * deltaAngle(5.0 * Math.PI, 5.0 * Math.PI); // fuzzy equals 0.0
 * // note here the return is positive in both cases (since there is PI difference)
 * deltaAngle(4.0 * Math.PI, 5.0 * Math.PI); // fuzzy equals Math.PI
 * deltaAngle(5.0 * Math.PI, 4.0 * Math.PI); // fuzzy equals Math.PI
 * // these cases show when the order can change the sign
 * deltaAngle(0.5 * Math.PI, 0.25 * Math.PI); // fuzzy equals -0.25 * Math.PI
 * deltaAngle(0.25 * Math.PI, 0.5 * Math.PI); // fuzzy equals 0.25 * Math.PI
 * ```
 */
export function deltaAngle(angle1: number, angle2: number): number {
  let diff = normalizeRadians(angle2 - angle1);
  if (diff > Math.PI) {
    diff = diff - TAU;
  }

  return diff;
}

/**
 * Returns the smaller difference between two angles and applies the sign given.
 *
 * This function is similar to `deltaAngle` but always returns a negative result if `negative` is
 * true or a positive result if `negative` is false. This is useful for ensuring a particular
 * polarity for edge cases, e.g. if `angle1` is 0 and `angle2` is PI then the delta angle could be
 * be considered positive or negative (`deltaAngle` always returns positive).
 */
export function deltaAngleSigned(angle1: number, angle2: number, negative: boolean): number {
  const diff = deltaAngle(angle1, angle2);
  return negative ? -Math.abs(diff) : Math.abs(diff);
}

/**
 * Tests if `testAngle` is between a `startAngle` and `endAngle`.
 *
 * Test assumes counter clockwise `startAngle` to `endAngle`, and is inclusive using `epsilon`.
 * See `angleIsBetween` function to use default fuzzy epsilon.
 *
 * # Examples
 *
 * ```ts
 * angleIsBetweenEps(Math.PI / 2.0, 0.0, Math.PI, 1e-5); // true
 * angleIsBetweenEps(0.0, 0.0, Math.PI, 1e-5); // true
 * angleIsBetweenEps(Math.PI, 0.0, Math.PI, 1e-5); // true
 * // note: always calculated as going counter clockwise
 * // going from PI to PI / 2 counter clockwise sweeps 0.0
 * angleIsBetweenEps(0.0, Math.PI, Math.PI / 2.0, 1e-5); // true
 * ```
 */
export function angleIsBetweenEps(
  testAngle: number,
  startAngle: number,
  endAngle: number,
  epsilon: number,
): boolean {
  const endSweep = normalizeRadians(endAngle - startAngle);
  const midSweep = normalizeRadians(testAngle - startAngle);

  return midSweep < endSweep + epsilon;
}

/**
 * Same as `angleIsBetweenEps` using default epsilon.
 *
 * Default epsilon is `FUZZY_EPSILON`.
 */
export function angleIsBetween(testAngle: number, startAngle: number, endAngle: number): boolean {
  return angleIsBetweenEps(testAngle, startAngle, endAngle, FUZZY_EPSILON);
}

/**
 * Tests if `testAngle` is within the `sweepAngle` starting at `startAngle`.
 *
 * If `sweepAngle` is positive then sweep is counter clockwise, otherwise it is clockwise.
 * `epsilon` controls the fuzzy inclusion.
 */
export function angleIsWithinSweepEps(
  testAngle: number,
  startAngle: number,
  sweepAngle: number,
  epsilon: number,
): boolean {
  const endAngle = startAngle + sweepAngle;
  if (sweepAngle < 0.0) {
    return angleIsBetweenEps(testAngle, endAngle, startAngle, epsilon);
  }

  return angleIsBetweenEps(testAngle, startAngle, endAngle, epsilon);
}

/**
 * Same as `angleIsWithinSweepEps` using default epsilon.
 *
 * Default epsilon is `FUZZY_EPSILON`.
 */
export function angleIsWithinSweep(
  testAngle: number,
  startAngle: number,
  sweepAngle: number,
): boolean {
  return angleIsWithinSweepEps(testAngle, startAngle, sweepAngle, FUZZY_EPSILON);
}

/**
 * Returns the solutions to the quadratic equation.
 *
 * Quadratic equation is `-b +/- sqrt(b * b - 4 * a * c) / (2 * a)`.
 * With the `sqrtDiscriminant` defined as `sqrt(b * b - 4 * a * c)`.
 *
 * The purpose of this function is to minimize error in the process of finding solutions
 * to the quadratic equation.
 */
export function quadraticSolutions(
  a: number,
  b: number,
  c: number,
  sqrtDiscriminant: number,
): [number, number] {
  debugAssert(
    fuzzyEq(Math.sqrt(b * b - 4.0 * a * c), sqrtDiscriminant),
    "discriminant is not valid",
  );
  // Avoids loss in precision due to taking the difference of two floating point values that are
  // very near each other in value.
  // https://math.stackexchange.com/questions/311382/solving-a-quadratic-equation-with-precision-when-using-floating-point-variables
  const denom = 2.0 * a;
  const sol1 = b < 0.0 ? (-b + sqrtDiscriminant) / denom : (-b - sqrtDiscriminant) / denom;

  const sol2 = c / a / sol1;

  return [sol1, sol2];
}

/** Distance squared between the points `p0` and `p1`. */
export function distSquared(p0: Vector2, p1: Vector2): number {
  const d = p0.sub(p1);
  return d.dot(d);
}

/** Angle of the direction vector described by `p0` to `p1`. */
export function angle(p0: Vector2, p1: Vector2): number {
  return Math.atan2(p1.y - p0.y, p1.x - p0.x);
}

/** Midpoint of a line segment defined by `p0` to `p1`. */
export function midpoint(p0: Vector2, p1: Vector2): Vector2 {
  return new Vector2((p0.x + p1.x) / 2.0, (p0.y + p1.y) / 2.0);
}

/** Returns the point on the circle with `radius`, `center`, and polar `angle` in radians given. */
export function pointOnCircle(radius: number, center: Vector2, angle: number): Vector2 {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  return new Vector2(center.x + radius * c, center.y + radius * s);
}

/** Returns the point on the line segment going from `p0` to `p1` at parametric value `t`. */
export function pointFromParametric(p0: Vector2, p1: Vector2, t: number): Vector2 {
  return p0.add(p1.sub(p0).scale(t));
}

/**
 * Returns the parametric value on the line segment going from `p0` to `p1` at the `point` given.
 *
 * Note this function assumes the `point` is on the line and properly handles the cases of vertical
 * and horizontal lines by using the component with the largest difference in the calculation.
 */
export function parametricFromPoint(
  p0: Vector2,
  p1: Vector2,
  point: Vector2,
  epsilon: number,
): number {
  const xDiff = p1.x - p0.x;
  const yDiff = p1.y - p0.y;

  debugAssert(
    fuzzyEqZeroEps(
      (xDiff * (p0.y - point.y) - (p0.x - point.x) * yDiff) /
        Math.sqrt(xDiff * xDiff + yDiff * yDiff),
      epsilon,
    ),
    "point does not lie on the line defined by p0 to p1 (based on distance)",
  );

  // use larger diff component for calculation to avoid problems with vertical/horizontal lines
  // where component diff is zero and to avoid adding error in calculation caused by small
  // denominator
  if (Math.abs(xDiff) < Math.abs(yDiff)) {
    // use y component
    return (point.y - p0.y) / yDiff;
  } else {
    // use x component
    return (point.x - p0.x) / xDiff;
  }
}

/** Returns the closest point on the line segment from `p0` to `p1` to the `point` given. */
export function lineSegClosestPoint(p0: Vector2, p1: Vector2, point: Vector2): Vector2 {
  // Dot product used to find angles
  // See: http://geomalgorithms.com/a02-_lines.html
  const v = p1.sub(p0);
  const w = point.sub(p0);
  const c1 = w.dot(v);
  if (c1 < FUZZY_EPSILON) {
    return p0;
  }

  const c2 = v.lengthSquared();
  if (c2 < c1 + FUZZY_EPSILON) {
    return p1;
  }

  const b = c1 / c2;
  return p0.add(v.scale(b));
}

/** Helper function to avoid repeating code for isLeft and isRight checks. */
function perpDotTestValue(p0: Vector2, p1: Vector2, point: Vector2): number {
  return (p1.x - p0.x) * (point.y - p0.y) - (p1.y - p0.y) * (point.x - p0.x);
}

/**
 * Returns true if `point` is left of a direction vector.
 *
 * Direction vector is defined as `p1 - p0`.
 *
 * # Examples
 *
 * ```ts
 * const p0 = new Vector2(1.0, 1.0);
 * const p1 = new Vector2(2.0, 2.0);
 * isLeft(p0, p1, new Vector2(0.0, 1.0)); // true
 * isLeft(p0, p1, new Vector2(1.0, 0.0)); // false
 * ```
 */
export function isLeft(p0: Vector2, p1: Vector2, point: Vector2): boolean {
  return perpDotTestValue(p0, p1, point) > 0.0;
}

/** Same as `isLeft` but uses <= operator rather than < for boundary inclusion. */
export function isLeftOrEqual(p0: Vector2, p1: Vector2, point: Vector2): boolean {
  return perpDotTestValue(p0, p1, point) >= 0.0;
}

/**
 * Returns true if `point` is left of a direction vector with fuzzy inclusion.
 *
 * Returns true if point is left or fuzzy coincident with the
 * direction vector defined by `p1 - p0`.
 *
 * `epsilon` controls the fuzzy compare.
 */
export function isLeftOrCoincidentEps(
  p0: Vector2,
  p1: Vector2,
  point: Vector2,
  epsilon: number,
): boolean {
  debugAssert(epsilon > 0.0, "epsilon must be greater than zero");
  return perpDotTestValue(p0, p1, point) > -epsilon;
}

/**
 * Same as `isLeftOrCoincidentEps` using default epsilon.
 *
 * Default epsilon is `FUZZY_EPSILON`.
 */
export function isLeftOrCoincident(p0: Vector2, p1: Vector2, point: Vector2): boolean {
  return isLeftOrCoincidentEps(p0, p1, point, FUZZY_EPSILON);
}

/**
 * Returns true if `point` is right of a direction vector with fuzzy inclusion.
 *
 * Returns true if point is right or fuzzy coincident with the
 * direction vector defined by `p1 - p0`.
 *
 * `epsilon` controls the fuzzy compare.
 */
export function isRightOrCoincidentEps(
  p0: Vector2,
  p1: Vector2,
  point: Vector2,
  epsilon: number,
): boolean {
  debugAssert(epsilon > 0.0, "epsilon must be greater than zero");
  return perpDotTestValue(p0, p1, point) < epsilon;
}

/**
 * Same as `isRightOrCoincidentEps` using default epsilon.
 *
 * Default epsilon is `FUZZY_EPSILON`.
 */
export function isRightOrCoincident(p0: Vector2, p1: Vector2, point: Vector2): boolean {
  return isRightOrCoincidentEps(p0, p1, point, FUZZY_EPSILON);
}

/**
 * Test if a `point` is within a arc sweep angle region.
 *
 * Arc is defined by `center`, `arcStart`, `arcEnd`, and arc direction parameter `isClockwise`.
 * The angle region is defined as if the arc had infinite radius projected outward in a cone.
 *
 * `epsilon` is used for fuzzy comparing.
 *
 * # Examples
 * ```ts
 * // defining an arc that projects an angle region covering all of
 * // quadrant I (x positive, y positive space)
 * const arcCenter = new Vector2(0.0, 0.0);
 * const arcStart = new Vector2(1.0, 0.0);
 * const arcEnd = new Vector2(0.0, 1.0);
 * pointWithinArcSweep(arcCenter, arcStart, arcEnd, false, new Vector2(1.0, 1.0), 1e-5); // true
 * // check is fuzzy inclusive
 * pointWithinArcSweep(arcCenter, arcStart, arcEnd, false, new Vector2(1.0, 0.0), 1e-5); // true
 * pointWithinArcSweep(arcCenter, arcStart, arcEnd, false, new Vector2(0.0, 1.0), 1e-5); // true
 * ```
 */
export function pointWithinArcSweep(
  center: Vector2,
  arcStart: Vector2,
  arcEnd: Vector2,
  isClockwise: boolean,
  point: Vector2,
  epsilon: number,
): boolean {
  if (isClockwise) {
    return (
      isRightOrCoincidentEps(center, arcStart, point, epsilon) &&
      isLeftOrCoincidentEps(center, arcEnd, point, epsilon)
    );
  } else {
    return (
      isLeftOrCoincidentEps(center, arcStart, point, epsilon) &&
      isRightOrCoincidentEps(center, arcEnd, point, epsilon)
    );
  }
}

/**
 * Returns the bulge for the given arc `sweepAngle`.
 *
 * By definition `bulge = tan(arcSweepAngle / 4)`.
 * Note if `angle` is negative then bulge returned will be negative (clockwise arc).
 */
export function bulgeFromAngle(angle: number): number {
  return Math.tan(angle / 4.0);
}

/**
 * Returns the arc sweep angle for the given `bulge`.
 *
 * By definition `arcSweepAngle = 4 * atan(bulge)`.
 * Note if `bulge` is negative then angle returned will be negative (clockwise arc).
 */
export function angleFromBulge(bulge: number): number {
  return 4.0 * Math.atan(bulge);
}
