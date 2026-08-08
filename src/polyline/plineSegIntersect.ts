import { circleCircleIntr } from "../core/circleCircleIntersect.js";
import { fuzzyEqEps, fuzzyEqZeroEps, fuzzyInRange } from "../core/fuzzy.js";
import { lineCircleIntr } from "../core/lineCircleIntersect.js";
import { lineLineIntr } from "../core/lineLineIntersect.js";
import {
  angle,
  angleFromBulge,
  angleIsWithinSweep,
  deltaAngle,
  distSquared,
  normalizeRadians,
  pointFromParametric,
  pointWithinArcSweep,
} from "../core/mathUtils.js";
import { Vector2 } from "../core/vector2.js";
import { segArcRadiusAndCenter } from "./plineSeg.js";
import { PlineVertex } from "./plineVertex.js";

/** Holds the result of finding the intersect between two polyline segments. */
export type PlineSegIntr =
  /** No intersects found. */
  | { kind: "noIntersect" }
  /** One tangent intersect point found. */
  | {
      kind: "tangentIntersect";
      /** Holds the tangent intersect point. */
      point: Vector2;
    }
  /** One non-tangent intersect point found. */
  | {
      kind: "oneIntersect";
      /** Holds the intersect point. */
      point: Vector2;
    }
  /** Simple case of two intersect points found. */
  | {
      kind: "twoIntersects";
      /** Holds the first intersect point (according to the second segment direction). */
      point1: Vector2;
      /** Holds the second intersect point (according to the second segment direction). */
      point2: Vector2;
    }
  /** Polyline segments are both lines and they overlap. */
  | {
      kind: "overlappingLines";
      /** Holds the start (according to the second segment direction) point of the line overlap. */
      point1: Vector2;
      /** Holds the end (according to the second segment direction) point of the line overlap. */
      point2: Vector2;
    }
  /** Polyline segments are both arcs and they overlap. */
  | {
      kind: "overlappingArcs";
      /** Holds the start (according to the second segment direction) point of the arc overlap. */
      point1: Vector2;
      /** Holds the end (according to the second segment direction) point of the arc overlap. */
      point2: Vector2;
    };

/**
 * Finds the intersects between two polyline segments.
 *
 * Segments are defined by `v1->v2` and `u1->u2`. `posEqualEps` is used for fuzzy float
 * comparisons.
 */
export function plineSegIntr(
  v1: PlineVertex,
  v2: PlineVertex,
  u1: PlineVertex,
  u2: PlineVertex,
  posEqualEps: number,
): PlineSegIntr {
  const vIsLine = v1.bulgeIsZero();
  const uIsLine = u1.bulgeIsZero();

  if (vIsLine && uIsLine) {
    const intrResult = lineLineIntr(v1.pos(), v2.pos(), u1.pos(), u2.pos(), posEqualEps);
    switch (intrResult.kind) {
      case "noIntersect":
      case "falseIntersect":
        return { kind: "noIntersect" };
      case "trueIntersect":
        return {
          kind: "oneIntersect",
          point: pointFromParametric(v1.pos(), v2.pos(), intrResult.seg1T),
        };
      case "overlapping":
        return {
          kind: "overlappingLines",
          point1: pointFromParametric(u1.pos(), u2.pos(), intrResult.seg2T0),
          point2: pointFromParametric(u1.pos(), u2.pos(), intrResult.seg2T1),
        };
    }
  }

  const processLineArcIntr = (
    p0: Vector2,
    p1: Vector2,
    a1: PlineVertex,
    a2: PlineVertex,
  ): PlineSegIntr => {
    const [arcRadius, arcCenter] = segArcRadiusAndCenter(a1, a2);

    const pointLiesOnArc = (pt: Vector2): boolean => {
      return (
        pointWithinArcSweep(arcCenter, a1.pos(), a2.pos(), a1.bulgeIsNeg(), pt, posEqualEps) &&
        fuzzyEqEps(Math.sqrt(distSquared(pt, arcCenter)), arcRadius, posEqualEps)
      );
    };

    // line segment length used for scaling parametric t value for fuzzy comparing
    const lineLength = p1.sub(p0).length();

    const pointInSweep = (t: number): Vector2 | null => {
      if (!fuzzyInRange(0.0, t * lineLength, lineLength, posEqualEps)) {
        return null;
      }

      const p = pointFromParametric(p0, p1, t);
      const withinSweep = pointWithinArcSweep(
        arcCenter,
        a1.pos(),
        a2.pos(),
        a1.bulgeIsNeg(),
        p,
        posEqualEps,
      );
      return withinSweep ? p : null;
    };

    // Note if intersect is detected we check if the line segment starts or ends on the arc
    // segment and if so then use that end point as the intersect point.
    // Why: this avoids inconsistencies between segment intersects where a line may "overlap" an
    // arc according to the fuzzy epsilon values (e.g., imagine the arc has a large radius and
    // the line has two intersects but is almost tangent to the arc), in such a case the
    // line-circle intersect function will return two solutions, one on either side of the end
    // point, but the end point is an equally valid solution according to the fuzzy epsilon and
    // ensures consistency with other intersects. E.g., if the end of the line segment is the
    // start of an arc that overlaps with another arc then we want the overlap intersect end
    // points to agree with the intersect returned from this function, to ensure this
    // consistency we use the end point when valid to do so (end points are "sticky").
    const intrResult = lineCircleIntr(p0, p1, arcRadius, arcCenter, posEqualEps);
    switch (intrResult.kind) {
      case "noIntersect":
        return { kind: "noIntersect" };
      case "tangentIntersect": {
        // check if either end point lies on the arc and substitute intersect point with end
        // point if so
        if (pointLiesOnArc(p0)) {
          return { kind: "tangentIntersect", point: p0 };
        } else if (pointLiesOnArc(p1)) {
          return { kind: "tangentIntersect", point: p1 };
        } else {
          const point = pointInSweep(intrResult.t0);
          if (point !== null) {
            return { kind: "tangentIntersect", point };
          } else {
            return { kind: "noIntersect" };
          }
        }
      }
      case "twoIntersects": {
        const t0Point = pointInSweep(intrResult.t0);
        const t1Point = pointInSweep(intrResult.t1);
        if (t0Point === null && t1Point === null) {
          return { kind: "noIntersect" };
        }
        if (t0Point === null || t1Point === null) {
          const point = (t0Point === null ? t1Point : t0Point) as Vector2;
          // check if either end point lies on arc and substitute intersect point with
          // end point if so
          if (pointLiesOnArc(p0)) {
            return { kind: "oneIntersect", point: p0 };
          } else if (pointLiesOnArc(p1)) {
            return { kind: "oneIntersect", point: p1 };
          } else {
            return { kind: "oneIntersect", point };
          }
        }

        // check if either end point lies on arc and substitute intersect point with
        // end point if so (using distance check to determine which to substitute)
        let point1 = t0Point;
        let point2 = t1Point;
        const p0LiesOnArc = pointLiesOnArc(p0);
        const p1LiesOnArc = pointLiesOnArc(p1);
        if (p0LiesOnArc && p1LiesOnArc) {
          if (distSquared(p0, point1) < distSquared(p0, point2)) {
            // substitute point1 with p0, point2 with p1
            point1 = p0;
            point2 = p1;
          } else {
            // substitute point1 with p1, point2 with p0
            point1 = p1;
            point2 = p0;
          }
        } else if (p0LiesOnArc) {
          if (distSquared(p0, point1) < distSquared(p0, point2)) {
            // substitute point1 with p0
            point1 = p0;
          } else {
            // substitute point2 with p0
            point2 = p0;
          }
        } else if (p1LiesOnArc) {
          if (distSquared(p1, point1) < distSquared(p1, point2)) {
            // substitute point1 with p1
            point1 = p1;
          } else {
            // substitute point2 with p1
            point2 = p1;
          }
        } else {
          // no substitutions
        }

        // return points ordered according to second segment direction
        if (uIsLine || distSquared(point1, a1.pos()) < distSquared(point2, a1.pos())) {
          return { kind: "twoIntersects", point1, point2 };
        } else {
          return { kind: "twoIntersects", point1: point2, point2: point1 };
        }
      }
    }
  };

  if (vIsLine) {
    // v is line, u is arc
    return processLineArcIntr(v1.pos(), v2.pos(), u1, u2);
  }

  if (uIsLine) {
    // u is line, v is arc
    return processLineArcIntr(u1.pos(), u2.pos(), v1, v2);
  }

  // both v and u are arcs
  const [arc1Radius, arc1Center] = segArcRadiusAndCenter(v1, v2);
  const [arc2Radius, arc2Center] = segArcRadiusAndCenter(u1, u2);

  const startAndSweepAngle = (sp: Vector2, center: Vector2, bulge: number): [number, number] => {
    const startAngle = normalizeRadians(angle(center, sp));
    const sweepAngle = angleFromBulge(bulge);
    return [startAngle, sweepAngle];
  };

  // helper function to test if both arcs sweep a point
  const bothArcsSweepPoint = (pt: Vector2): boolean => {
    return (
      pointWithinArcSweep(arc1Center, v1.pos(), v2.pos(), v1.bulgeIsNeg(), pt, posEqualEps) &&
      pointWithinArcSweep(arc2Center, u1.pos(), u2.pos(), u1.bulgeIsNeg(), pt, posEqualEps)
    );
  };

  // helper function to test if a point lies on arc1 segment
  const pointLiesOnArc1 = (pt: Vector2): boolean => {
    return (
      pointWithinArcSweep(arc1Center, v1.pos(), v2.pos(), v1.bulgeIsNeg(), pt, posEqualEps) &&
      fuzzyEqEps(Math.sqrt(distSquared(pt, arc1Center)), arc1Radius, posEqualEps)
    );
  };

  // helper function to test if a point lies on arc2 segment
  const pointLiesOnArc2 = (pt: Vector2): boolean => {
    return (
      pointWithinArcSweep(arc2Center, u1.pos(), u2.pos(), u1.bulgeIsNeg(), pt, posEqualEps) &&
      fuzzyEqEps(Math.sqrt(distSquared(pt, arc2Center)), arc2Radius, posEqualEps)
    );
  };

  const intrResult = circleCircleIntr(arc1Radius, arc1Center, arc2Radius, arc2Center, posEqualEps);

  switch (intrResult.kind) {
    case "noIntersect":
      return { kind: "noIntersect" };
    case "tangentIntersect": {
      // first check if end points lie on arcs and substitute with end point if so to be
      // consistent with stickiness to end points done in other cases (e.g., line-arc
      // intersect)
      if (pointLiesOnArc1(u1.pos())) {
        return { kind: "tangentIntersect", point: u1.pos() };
      } else if (pointLiesOnArc1(u2.pos())) {
        return { kind: "tangentIntersect", point: u2.pos() };
      } else if (pointLiesOnArc2(v1.pos())) {
        return { kind: "tangentIntersect", point: v1.pos() };
      } else if (pointLiesOnArc2(v2.pos())) {
        return { kind: "tangentIntersect", point: v2.pos() };
      } else if (bothArcsSweepPoint(intrResult.point)) {
        return { kind: "tangentIntersect", point: intrResult.point };
      } else {
        return { kind: "noIntersect" };
      }
    }
    case "twoIntersects": {
      const point1 = intrResult.point1;
      const point2 = intrResult.point2;
      // determine if end points lie on arcs and substitute with end points if so to be
      // consistent with stickiness to end points done in other cases (e.g., line-arc
      // intersect)
      const endPointIntrs: (Vector2 | null)[] = [null, null];
      // helper function to collect end point intersects
      const tryAddEndPointIntr = (intr: Vector2): void => {
        for (let slot = 0; slot < endPointIntrs.length; slot += 1) {
          const pt = endPointIntrs[slot];
          if (pt !== null) {
            if (pt.fuzzyEqEps(intr, posEqualEps)) {
              // duplicate point, skip it (end point from both arcs touch)
              break;
            }
          } else {
            // insert the end point as intersect
            endPointIntrs[slot] = intr;
            break;
          }
        }
      };

      if (pointLiesOnArc1(u1.pos())) {
        tryAddEndPointIntr(u1.pos());
      }

      if (pointLiesOnArc1(u2.pos())) {
        tryAddEndPointIntr(u2.pos());
      }

      if (pointLiesOnArc2(v1.pos())) {
        tryAddEndPointIntr(v1.pos());
      }

      if (pointLiesOnArc2(v2.pos())) {
        tryAddEndPointIntr(v2.pos());
      }

      const endPtIntr1 = endPointIntrs[0];
      const endPtIntr2 = endPointIntrs[1];

      const pt1InSweep = bothArcsSweepPoint(point1);
      const pt2InSweep = bothArcsSweepPoint(point2);
      if (pt1InSweep && pt2InSweep) {
        if (endPtIntr1 === null && endPtIntr2 === null) {
          return { kind: "twoIntersects", point1, point2 };
        } else if (endPtIntr1 === null || endPtIntr2 === null) {
          const endPt = (endPtIntr1 === null ? endPtIntr2 : endPtIntr1) as Vector2;
          if (distSquared(endPt, point1) < distSquared(endPt, point2)) {
            return { kind: "twoIntersects", point1: endPt, point2 };
          } else {
            return { kind: "twoIntersects", point1, point2: endPt };
          }
        } else {
          if (distSquared(endPtIntr1, point1) < distSquared(endPtIntr2, point1)) {
            return { kind: "twoIntersects", point1: endPtIntr1, point2: endPtIntr2 };
          } else {
            return { kind: "twoIntersects", point1: endPtIntr2, point2: endPtIntr1 };
          }
        }
      } else if (pt1InSweep) {
        if (endPtIntr1 === null && endPtIntr2 === null) {
          return { kind: "oneIntersect", point: point1 };
        } else if (endPtIntr1 === null || endPtIntr2 === null) {
          const endPt = (endPtIntr1 === null ? endPtIntr2 : endPtIntr1) as Vector2;
          return { kind: "oneIntersect", point: endPt };
        } else {
          return { kind: "twoIntersects", point1: endPtIntr1, point2: endPtIntr2 };
        }
      } else if (pt2InSweep) {
        if (endPtIntr1 === null && endPtIntr2 === null) {
          return { kind: "oneIntersect", point: point2 };
        } else if (endPtIntr1 === null || endPtIntr2 === null) {
          const endPt = (endPtIntr1 === null ? endPtIntr2 : endPtIntr1) as Vector2;
          return { kind: "oneIntersect", point: endPt };
        } else {
          return { kind: "twoIntersects", point1: endPtIntr1, point2: endPtIntr2 };
        }
      } else {
        if (endPtIntr1 === null && endPtIntr2 === null) {
          return { kind: "noIntersect" };
        } else if (endPtIntr1 === null || endPtIntr2 === null) {
          const endPt = (endPtIntr1 === null ? endPtIntr2 : endPtIntr1) as Vector2;
          return { kind: "oneIntersect", point: endPt };
        } else {
          return { kind: "twoIntersects", point1: endPtIntr1, point2: endPtIntr2 };
        }
      }
    }
    case "overlapping": {
      // determine if arcs overlap along their sweep
      const sameDirectionArcs = v1.bulgeIsNeg() === u1.bulgeIsNeg();
      const [arc1Start, arc1Sweep] = startAndSweepAngle(v1.pos(), arc1Center, v1.bulge);
      // we have the arc sweeps go the same direction to simplify checks
      let arc2Start: number;
      let arc2Sweep: number;
      if (sameDirectionArcs) {
        [arc2Start, arc2Sweep] = startAndSweepAngle(u1.pos(), arc2Center, u1.bulge);
      } else {
        [arc2Start, arc2Sweep] = startAndSweepAngle(u2.pos(), arc2Center, -u1.bulge);
      }

      const arc1End = arc1Start + arc1Sweep;
      const arc2End = arc2Start + arc2Sweep;
      // using average radius for fuzzy compare (arc radii are fuzzy equal, this is to produce
      // best fuzzy overlap approximation)
      const avgRadius = (arc1Radius + arc2Radius) / 2.0;

      // check if only end points touch (because we made arc sweeps go same direction we
      // only have to test the delta angle between the start and end)

      // note: for fuzzy compare using arc length (radius * angle) rather than just the sweep
      // angle so that the epsilon value is used in the context of the arc size/scale
      const arc1StartTouchesArc2End = fuzzyEqZeroEps(
        avgRadius * deltaAngle(arc1Start, arc2End),
        posEqualEps,
      );
      const arc2StartTouchesArc1End = fuzzyEqZeroEps(
        avgRadius * deltaAngle(arc2Start, arc1End),
        posEqualEps,
      );

      if (arc1StartTouchesArc2End && arc2StartTouchesArc1End) {
        // two half circle arcs with end points touching
        // note: point1 and point2 are returned in order according to second segment
        // (u1->u2) direction
        return { kind: "twoIntersects", point1: u1.pos(), point2: u2.pos() };
      } else if (arc1StartTouchesArc2End) {
        // only touch at start of arc1
        return { kind: "oneIntersect", point: v1.pos() };
      } else if (arc2StartTouchesArc1End) {
        // only touch at start of arc2
        // NOTE: have to check and adjust for the direction flip done above to have
        // matching direction
        const point = sameDirectionArcs ? u1.pos() : u2.pos();
        return { kind: "oneIntersect", point };
      } else {
        // not just the end points touch, determine how the arcs overlap
        const arc2StartsInArc1 = angleIsWithinSweep(arc2Start, arc1Start, arc1Sweep);
        const arc2EndsInArc1 = angleIsWithinSweep(arc2End, arc1Start, arc1Sweep);
        if (arc2StartsInArc1 && arc2EndsInArc1) {
          // arc2 is fully overlapped by arc1
          return { kind: "overlappingArcs", point1: u1.pos(), point2: u2.pos() };
        } else if (arc2StartsInArc1) {
          // check if direction reversed to ensure the correct points are used
          // note: point1 and point2 are returned in order according to second segment
          // (u1->u2) direction
          if (sameDirectionArcs) {
            return { kind: "overlappingArcs", point1: u1.pos(), point2: v2.pos() };
          } else {
            return { kind: "overlappingArcs", point1: v2.pos(), point2: u2.pos() };
          }
        } else if (arc2EndsInArc1) {
          // check if direction reversed to ensure the correct points are used
          // note: point1 and point2 are returned in order according to second segment
          // (u1->u2) direction
          if (sameDirectionArcs) {
            return { kind: "overlappingArcs", point1: v1.pos(), point2: u2.pos() };
          } else {
            return { kind: "overlappingArcs", point1: u1.pos(), point2: v1.pos() };
          }
        } else {
          const arc1StartsInArc2 = angleIsWithinSweep(arc1Start, arc2Start, arc2Sweep);
          if (arc1StartsInArc2) {
            // arc1 is fully overlapped by arc2
            // note: point1 and point2 are returned in order according to second
            // segment (u1->u2) direction
            if (sameDirectionArcs) {
              return { kind: "overlappingArcs", point1: v1.pos(), point2: v2.pos() };
            } else {
              return { kind: "overlappingArcs", point1: v2.pos(), point2: v1.pos() };
            }
          } else {
            return { kind: "noIntersect" };
          }
        }
      }
    }
  }
}
