import { debugAssert } from "../core/controlFlow.js";
import {
  angle,
  angleIsWithinSweep,
  bulgeFromAngle,
  deltaAngle,
  deltaAngleSigned,
  distSquared,
  lineSegClosestPoint,
  midpoint,
  minMax,
  pointOnCircle,
  pointWithinArcSweep,
} from "../core/mathUtils.js";
import { Vector2 } from "../core/vector2.js";
import type { AABB } from "../index2d/staticAabb2dIndex.js";
import { PlineVertex } from "./plineVertex.js";

/**
 * Get the arc radius and center of an arc polyline segment defined by `v1` to `v2`.
 * Behavior undefined (may throw or return without error) if v1.bulge is zero.
 *
 * Returns `[arcRadius, arcCenter]`.
 *
 * # Examples
 *
 * ```ts
 * // arc half circle arc segment going from (0, 0) to (1, 0) counter clockwise
 * const v1 = new PlineVertex(0.0, 0.0, 1.0);
 * const v2 = new PlineVertex(1.0, 0.0, 0.0);
 * const [arcRadius, arcCenter] = segArcRadiusAndCenter(v1, v2);
 * // arcRadius fuzzy equals 0.5
 * // arcCenter fuzzy equals new Vector2(0.5, 0.0)
 * ```
 */
export function segArcRadiusAndCenter(v1: PlineVertex, v2: PlineVertex): [number, Vector2] {
  debugAssert(!v1.bulgeIsZero(), "v1 to v2 must be an arc");
  debugAssert(!v1.pos().fuzzyEq(v2.pos()), "v1 must not be on top of v2");

  // compute radius
  const absBulge = Math.abs(v1.bulge);
  const chordV = v2.pos().sub(v1.pos());
  const chordLen = chordV.length();
  const radius = (chordLen * (absBulge * absBulge + 1.0)) / (4.0 * absBulge);

  // compute center
  const s = (absBulge * chordLen) / 2.0;
  const m = radius - s;
  let offsX = (-m * chordV.y) / chordLen;
  let offsY = (m * chordV.x) / chordLen;
  if (v1.bulgeIsNeg()) {
    offsX = -offsX;
    offsY = -offsY;
  }

  const center = new Vector2(v1.x + chordV.x / 2.0 + offsX, v1.y + chordV.y / 2.0 + offsY);

  return [radius, center];
}

/** Result from splitting a segment using `segSplitAtPoint`. */
export interface SplitResult {
  /** Updated start vertex (has same position as start of segment but with updated bulge value). */
  updatedStart: PlineVertex;
  /**
   * Vertex at split point (position is equal to split point, bulge set to maintain same curve to
   * the next vertex).
   */
  splitVertex: PlineVertex;
}

/**
 * Splits a polyline segment defined by `v1` to `v2` at the `pointOnSeg` given. Assumes the
 * `pointOnSeg` lies on the segment.
 *
 * # Examples
 *
 * ```ts
 * // arc half circle arc segment going from (0, 0) to (1, 0) counter clockwise
 * const v1 = new PlineVertex(0.0, 0.0, 1.0);
 * const v2 = new PlineVertex(1.0, 0.0, 0.0);
 * const point = new Vector2(0.5, -0.5);
 * const { updatedStart, splitVertex } = segSplitAtPoint(v1, v2, point, 1e-5);
 * const quarterCircleBulge = Math.tan(Math.PI / 8.0);
 * // updatedStart fuzzy equals new PlineVertex(v1.x, v1.y, quarterCircleBulge)
 * // splitVertex fuzzy equals new PlineVertex(point.x, point.y, quarterCircleBulge)
 * ```
 */
export function segSplitAtPoint(
  v1: PlineVertex,
  v2: PlineVertex,
  pointOnSeg: Vector2,
  posEqualEps: number,
): SplitResult {
  if (v1.bulgeIsZero()) {
    // v1->v2 is a line segment, just use point as end point
    const updatedStart = v1;
    const splitVertex = new PlineVertex(pointOnSeg.x, pointOnSeg.y, 0.0);
    return {
      updatedStart,
      splitVertex,
    };
  }

  if (
    v1.pos().fuzzyEqEps(v2.pos(), posEqualEps) ||
    v1.pos().fuzzyEqEps(pointOnSeg, posEqualEps)
  ) {
    // v1 == v2 or v1 == point, updated_start is put on top of split_vertex
    const updatedStart = new PlineVertex(pointOnSeg.x, pointOnSeg.y, 0.0);
    const splitVertex = new PlineVertex(pointOnSeg.x, pointOnSeg.y, v1.bulge);
    return {
      updatedStart,
      splitVertex,
    };
  }

  if (v2.pos().fuzzyEqEps(pointOnSeg, posEqualEps)) {
    // point is at end point of segment
    const updatedStart = v1;
    const splitVertex = new PlineVertex(v2.x, v2.y, 0.0);
    return {
      updatedStart,
      splitVertex,
    };
  }

  const [, arcCenter] = segArcRadiusAndCenter(v1, v2);

  const pointPosAngle = angle(arcCenter, pointOnSeg);

  const arcStartAngle = angle(arcCenter, v1.pos());
  const theta1 = deltaAngleSigned(arcStartAngle, pointPosAngle, v1.bulgeIsNeg());
  const bulge1 = bulgeFromAngle(theta1);

  const arcEndAngle = angle(arcCenter, v2.pos());
  const theta2 = deltaAngleSigned(pointPosAngle, arcEndAngle, v1.bulgeIsNeg());
  const bulge2 = bulgeFromAngle(theta2);

  const updatedStart = new PlineVertex(v1.x, v1.y, bulge1);
  const splitVertex = new PlineVertex(pointOnSeg.x, pointOnSeg.y, bulge2);

  return {
    updatedStart,
    splitVertex,
  };
}

/**
 * Find the tangent direction vector (*NOT* normalized) on a polyline segment defined by `v1` to
 * `v2` at `pointOnSeg`.
 *
 * Note: The vector returned is just the direction vector, add the `pointOnSeg` position if
 * you need to offset from that position.
 *
 * # Examples
 *
 * ```ts
 * // counter clockwise half circle arc going from (2, 2) to (2, 4)
 * const v1 = new PlineVertex(2.0, 2.0, 1.0);
 * const v2 = new PlineVertex(4.0, 2.0, 0.0);
 * const midpoint = new Vector2(3.0, 1.0);
 * // segTangentVector(v1, v2, midpoint).normalize() fuzzy equals new Vector2(1.0, 0.0)
 * // segTangentVector(v1, v2, v1.pos()).normalize() fuzzy equals new Vector2(0.0, -1.0)
 * // segTangentVector(v1, v2, v2.pos()).normalize() fuzzy equals new Vector2(0.0, 1.0)
 * ```
 */
export function segTangentVector(
  v1: PlineVertex,
  v2: PlineVertex,
  pointOnSeg: Vector2,
): Vector2 {
  if (v1.bulgeIsZero()) {
    return v2.pos().sub(v1.pos());
  }

  const [, arcCenter] = segArcRadiusAndCenter(v1, v2);
  if (v1.bulgeIsPos()) {
    // ccw, rotate vector from center to point_on_seg 90 degrees
    return new Vector2(-(pointOnSeg.y - arcCenter.y), pointOnSeg.x - arcCenter.x);
  }

  // cw, rotate vector from center to point_on_seg -90 degrees
  return new Vector2(pointOnSeg.y - arcCenter.y, -(pointOnSeg.x - arcCenter.x));
}

/**
 * Find the closest point on a polyline segment defined by `v1` to `v2` to `point` given.
 * If there are multiple closest points then one is chosen (which is chosen is not defined).
 *
 * `epsilon` is used for fuzzy float comparisons.
 *
 * # Examples
 *
 * ```ts
 * // counter clockwise half circle arc going from (2, 2) to (2, 4)
 * const v1 = new PlineVertex(2.0, 2.0, 1.0);
 * const v2 = new PlineVertex(4.0, 2.0, 0.0);
 * // segClosestPoint(v1, v2, new Vector2(3.0, 0.0), 1e-5) fuzzy equals new Vector2(3.0, 1.0)
 * // segClosestPoint(v1, v2, new Vector2(3.0, 1.2), 1e-5) fuzzy equals new Vector2(3.0, 1.0)
 * // segClosestPoint(v1, v2, v1.pos(), 1e-5) fuzzy equals v1.pos()
 * // segClosestPoint(v1, v2, v2.pos(), 1e-5) fuzzy equals v2.pos()
 * ```
 */
export function segClosestPoint(
  v1: PlineVertex,
  v2: PlineVertex,
  point: Vector2,
  epsilon: number,
): Vector2 {
  if (v1.bulgeIsZero()) {
    return lineSegClosestPoint(v1.pos(), v2.pos(), point);
  }

  const [arcRadius, arcCenter] = segArcRadiusAndCenter(v1, v2);
  if (point.fuzzyEqEps(arcCenter, epsilon)) {
    // avoid normalizing zero length vector (point is at center, just return start point)
    return v1.pos();
  }

  if (pointWithinArcSweep(arcCenter, v1.pos(), v2.pos(), v1.bulgeIsNeg(), point, epsilon)) {
    // closest point is on the arc
    const vToPoint = point.sub(arcCenter).normalize();
    return vToPoint.scale(arcRadius).add(arcCenter);
  }

  // closest point is one of the ends
  const dist1 = distSquared(v1.pos(), point);
  const dist2 = distSquared(v2.pos(), point);
  if (dist1 < dist2) {
    return v1.pos();
  }

  return v2.pos();
}

/**
 * Computes a fast approximate axis aligned bounding box of a polyline segment defined by `v1` to
 * `v2`.
 *
 * The bounding box may be larger than the true bounding box for the segment (but is never
 * smaller). For the true axis aligned bounding box use `segBoundingBox` but this function is
 * faster for arc segments.
 */
export function segFastApproxBoundingBox(v1: PlineVertex, v2: PlineVertex): AABB {
  if (v1.bulgeIsZero()) {
    // line segment
    const [minX, maxX] = minMax(v1.x, v2.x);
    const [minY, maxY] = minMax(v1.y, v2.y);
    return { minX, minY, maxX, maxY };
  }

  // For arcs we don't compute the actual extents which is slower, instead we create an approximate
  // bounding box from the rectangle formed by extending the chord by the sagitta, note this
  // approximate bounding box is always equal to or bigger than the true bounding box
  const b = v1.bulge;
  const offsX = (b * (v2.y - v1.y)) / 2.0;
  const offsY = (-b * (v2.x - v1.x)) / 2.0;

  const [ptXMin, ptXMax] = minMax(v1.x + offsX, v2.x + offsX);
  const [ptYMin, ptYMax] = minMax(v1.y + offsY, v2.y + offsY);

  const [endPointXMin, endPointXMax] = minMax(v1.x, v2.x);
  const [endPointYMin, endPointYMax] = minMax(v1.y, v2.y);

  const minX = Math.min(endPointXMin, ptXMin);
  const minY = Math.min(endPointYMin, ptYMin);
  const maxX = Math.max(endPointXMax, ptXMax);
  const maxY = Math.max(endPointYMax, ptYMax);

  return { minX, minY, maxX, maxY };
}

/**
 * Returns the arc segment bounding box. Assumes `v1` to `v2` is an arc.
 *
 * (Rust `pub(crate)` — exported for internal module use.)
 */
export function arcSegBoundingBox(v1: PlineVertex, v2: PlineVertex): AABB {
  debugAssert(!v1.bulgeIsZero(), "expected arc");

  if (v1.pos().fuzzyEq(v2.pos())) {
    return { minX: v1.x, minY: v1.y, maxX: v1.x, maxY: v1.y };
  }

  const [arcRadius, arcCenter] = segArcRadiusAndCenter(v1, v2);
  const startAngle = angle(arcCenter, v1.pos());
  const endAngle = angle(arcCenter, v2.pos());
  const sweepAngle = deltaAngleSigned(startAngle, endAngle, v1.bulgeIsNeg());

  const crossesAngle = (angle: number): boolean =>
    angleIsWithinSweep(angle, startAngle, sweepAngle);

  let minX: number;
  if (crossesAngle(Math.PI)) {
    // crosses PI
    minX = arcCenter.x - arcRadius;
  } else {
    minX = Math.min(v1.x, v2.x);
  }

  let minY: number;
  if (crossesAngle(1.5 * Math.PI)) {
    // crosses 3PI/2
    minY = arcCenter.y - arcRadius;
  } else {
    minY = Math.min(v1.y, v2.y);
  }

  let maxX: number;
  if (crossesAngle(0.0)) {
    // crosses 2PI
    maxX = arcCenter.x + arcRadius;
  } else {
    maxX = Math.max(v1.x, v2.x);
  }

  let maxY: number;
  if (crossesAngle(0.5 * Math.PI)) {
    // crosses PI/2
    maxY = arcCenter.y + arcRadius;
  } else {
    maxY = Math.max(v1.y, v2.y);
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Computes the axis aligned bounding box of a polyline segment defined by `v1` to `v2`.
 *
 * This function is quite a bit slower than `segFastApproxBoundingBox` when given an arc.
 */
export function segBoundingBox(v1: PlineVertex, v2: PlineVertex): AABB {
  if (v1.bulgeIsZero()) {
    // line segment
    const [minX, maxX] = minMax(v1.x, v2.x);
    const [minY, maxY] = minMax(v1.y, v2.y);
    return { minX, minY, maxX, maxY };
  } else {
    return arcSegBoundingBox(v1, v2);
  }
}

/**
 * Calculate the path length of the polyline segment defined by `v1` to `v2`.
 *
 * # Examples
 *
 * ```ts
 * // counter clockwise half circle arc going from (2, 2) to (2, 4)
 * // arc radius = 1 so length should be PI
 * const v1 = new PlineVertex(2.0, 2.0, 1.0);
 * const v2 = new PlineVertex(4.0, 2.0, 0.0);
 * // segLength(v1, v2) fuzzy equals Math.PI
 * ```
 *
 * Also works with line segments.
 *
 * ```ts
 * // line segment going from (2, 2) to (4, 4)
 * const v1 = new PlineVertex(2.0, 2.0, 0.0);
 * const v2 = new PlineVertex(4.0, 4.0, 0.0);
 * // segLength(v1, v2) fuzzy equals 2.0 * Math.sqrt(2.0)
 * ```
 */
export function segLength(v1: PlineVertex, v2: PlineVertex): number {
  if (v1.fuzzyEq(v2)) {
    return 0.0;
  }

  if (v1.bulgeIsZero()) {
    return Math.sqrt(distSquared(v1.pos(), v2.pos()));
  }

  const [arcRadius, arcCenter] = segArcRadiusAndCenter(v1, v2);
  const startAngle = angle(arcCenter, v1.pos());
  const endAngle = angle(arcCenter, v2.pos());
  return arcRadius * Math.abs(deltaAngle(startAngle, endAngle));
}

/**
 * Find the midpoint for the polyline segment defined by `v1` to `v2`.
 *
 * # Examples
 *
 * ```ts
 * // counter clockwise half circle arc going from (2, 2) to (2, 4)
 * const v1 = new PlineVertex(2.0, 2.0, 1.0);
 * const v2 = new PlineVertex(4.0, 2.0, 0.0);
 * // segMidpoint(v1, v2) fuzzy equals new Vector2(3.0, 1.0)
 * ```
 *
 * Also works with line segments.
 *
 * ```ts
 * // line segment going from (2, 2) to (4, 4)
 * const v1 = new PlineVertex(2.0, 2.0, 0.0);
 * const v2 = new PlineVertex(4.0, 4.0, 0.0);
 * // segMidpoint(v1, v2) fuzzy equals new Vector2(3.0, 3.0)
 * ```
 */
export function segMidpoint(v1: PlineVertex, v2: PlineVertex): Vector2 {
  if (v1.bulgeIsZero()) {
    return midpoint(v1.pos(), v2.pos());
  }

  const [arcRadius, arcCenter] = segArcRadiusAndCenter(v1, v2);
  const angle1 = angle(arcCenter, v1.pos());
  const angle2 = angle(arcCenter, v2.pos());
  const angleOffset = deltaAngleSigned(angle1, angle2, v1.bulgeIsNeg()) / 2.0;
  const midAngle = angle1 + angleOffset;
  return pointOnCircle(arcRadius, arcCenter, midAngle);
}
