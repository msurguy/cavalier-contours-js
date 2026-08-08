/**
 * Internal module for the polyline parallel offset algorithm.
 *
 * Port of `polyline/internal/pline_offset.rs`. This module constructs
 * `PlineViewData`/`PlineView` and `Polyline` values at runtime, so `plineSourceBase.ts` must not
 * import it directly (see `plineOffsetRegistry.ts` for how the `parallelOffset` trait methods are
 * wired without forming a runtime circular import).
 *
 * Rust `BTreeMap<usize, Vec<Vector2>>` lookups become `Map<number, Vector2[]>` iterated via
 * `sortedKeys`, `ControlFlow` visitors become boolean-returning visitors (`false` = break), and
 * the Rust `*_with_stack` spatial index queries map to the plain `visitQuery` method (the JS
 * port of the spatial index reuses one internal stack), so the Rust `query_stack` parameters are
 * dropped.
 */
import { debugAssert, sortedKeys, type VisitResult } from "../../core/controlFlow.js";
import { circleCircleIntr } from "../../core/circleCircleIntersect.js";
import { FUZZY_EPSILON, fuzzyEqEps, fuzzyLt } from "../../core/fuzzy.js";
import { lineCircleIntr } from "../../core/lineCircleIntersect.js";
import { lineLineIntr } from "../../core/lineLineIntersect.js";
import {
  angle,
  bulgeFromAngle,
  deltaAngle,
  deltaAngleSigned,
  distSquared,
  pointFromParametric,
  pointWithinArcSweep,
} from "../../core/mathUtils.js";
import type { Vector2 } from "../../core/vector2.js";
import {
  type StaticAabb2dIndex,
  StaticAabb2dIndexBuilder,
} from "../../index2d/staticAabb2dIndex.js";
import {
  segArcRadiusAndCenter,
  segClosestPoint,
  segFastApproxBoundingBox,
  segMidpoint,
} from "../plineSeg.js";
import { plineSegIntr } from "../plineSegIntersect.js";
import type { PlineSourceBase, PlineSourceMutBase } from "../plineSourceBase.js";
import { defaultPlineOffsetOptions, type PlineOffsetOptions } from "../plineTypes.js";
import { PlineVertex } from "../plineVertex.js";
import { PlineViewData } from "../plineView.js";
import { Polyline } from "../polyline.js";
import { allSelfIntersectsAsBasic, findIntersects } from "./plineIntersects.js";
import { registerParallelOffsetImpl } from "./plineOffsetRegistry.js";

/** Port of Rust `Option::unwrap` on values that are invalid to be absent. */
function unwrap<T>(value: T | null, msg: string): T {
  if (value === null) {
    throw new Error(msg);
  }
  return value;
}

/** A raw offset segment representing line or arc that has been parallel offset. */
export interface RawPlineOffsetSeg {
  v1: PlineVertex;
  v2: PlineVertex;
  origV2Pos: Vector2;
  collapsedArc: boolean;
}

/** Create all the raw parallel offset segments of a polyline using the `offset` value given. */
export function createUntrimmedRawOffsetSegs(
  polyline: PlineSourceBase,
  offset: number,
): RawPlineOffsetSeg[] {
  const processLineSeg = (v1: PlineVertex, v2: PlineVertex): RawPlineOffsetSeg => {
    const lineV = v2.pos().sub(v1.pos());
    const offsetV = lineV.safeUnitPerp().scale(offset);
    return {
      v1: PlineVertex.fromVector2(v1.pos().add(offsetV), 0.0),
      v2: PlineVertex.fromVector2(v2.pos().add(offsetV), 0.0),
      origV2Pos: v2.pos(),
      collapsedArc: false,
    };
  };

  const processArcSeg = (v1: PlineVertex, v2: PlineVertex): RawPlineOffsetSeg => {
    const [arcRadius, arcCenter] = segArcRadiusAndCenter(v1, v2);
    const offs = v1.bulgeIsNeg() ? offset : -offset;
    const radiusAfterOffset = arcRadius + offs;
    const v1ToCenter = v1.pos().sub(arcCenter).safeNormalize();
    const v2ToCenter = v2.pos().sub(arcCenter).safeNormalize();

    let newV1Bulge: number;
    let collapsedArc: boolean;
    if (fuzzyLt(radiusAfterOffset, 0.0)) {
      // collapsed arc, offset arc start and end points towards arc center and turn into line
      // handles case where offset vertexes are equal and simplifies path for clipping
      // algorithm
      newV1Bulge = 0.0;
      collapsedArc = true;
    } else {
      newV1Bulge = v1.bulge;
      collapsedArc = false;
    }

    return {
      v1: PlineVertex.fromVector2(v1ToCenter.scale(offs).add(v1.pos()), newV1Bulge),
      v2: PlineVertex.fromVector2(v2ToCenter.scale(offs).add(v2.pos()), v2.bulge),
      origV2Pos: v2.pos(),
      collapsedArc,
    };
  };

  const result: RawPlineOffsetSeg[] = [];
  for (const [v1, v2] of polyline.iterSegments()) {
    if (v1.bulgeIsZero()) {
      result.push(processLineSeg(v1, v2));
    } else {
      result.push(processArcSeg(v1, v2));
    }
  }

  return result;
}

/**
 * Test if parametric value `t` represents a false intersect or not. False intersect is defined as
 * requiring the segment to be extended to actually intersect.
 */
function isFalseIntersect(t: number): boolean {
  return t < 0.0 || t > 1.0;
}

/** Compute the bulge for connecting two raw offset segments. */
function bulgeForConnection(
  arcCenter: Vector2,
  startPoint: Vector2,
  endPoint: Vector2,
  isCcw: boolean,
): number {
  const a1 = angle(arcCenter, startPoint);
  const a2 = angle(arcCenter, endPoint);
  return bulgeFromAngle(deltaAngleSigned(a1, a2, !isCcw));
}

/**
 * Connect two raw offset segments by joining them with an arc and push the vertexes to the
 * `result` output parameter.
 */
function connectUsingArc(
  s1: RawPlineOffsetSeg,
  s2: RawPlineOffsetSeg,
  connectionArcsCcw: boolean,
  result: PlineSourceMutBase,
  posEqualEps: number,
): void {
  const arcCenter = s1.origV2Pos;
  const sp = s1.v2.pos();
  const ep = s2.v1.pos();
  const bulge = bulgeForConnection(arcCenter, sp, ep, connectionArcsCcw);
  result.addOrReplace(sp.x, sp.y, bulge, posEqualEps);
  result.addOrReplace(ep.x, ep.y, s2.v1.bulge, posEqualEps);
}

/** Parameters passed to segment join functions used to form raw offset polyline. */
interface JoinParams {
  /** If true then connection arcs should be counter clockwise, otherwise clockwise. */
  connectionArcsCcw: boolean;
  /** Epsilon to use for testing if positions are fuzzy equal. */
  posEqualEps: number;
}

/** Join two adjacent raw offset segments where both segments are lines. */
function lineLineJoin(
  s1: RawPlineOffsetSeg,
  s2: RawPlineOffsetSeg,
  params: JoinParams,
  result: PlineSourceMutBase,
): void {
  const connectionArcsCcw = params.connectionArcsCcw;
  const posEqualEps = params.posEqualEps;
  const v1 = s1.v1;
  const v2 = s1.v2;
  const u1 = s2.v1;
  const u2 = s2.v2;

  debugAssert(v1.bulgeIsZero() && u1.bulgeIsZero(), "both segments should be lines");

  if (s1.collapsedArc || s2.collapsedArc) {
    // connecting to/from collapsed arc, always connect using arc
    connectUsingArc(s1, s2, connectionArcsCcw, result, posEqualEps);
  } else {
    const intrResult = lineLineIntr(v1.pos(), v2.pos(), u1.pos(), u2.pos(), posEqualEps);
    switch (intrResult.kind) {
      case "noIntersect": {
        // parallel lines, join with half circle
        const sp = s1.v2.pos();
        const ep = s2.v1.pos();
        const bulge = connectionArcsCcw ? 1.0 : -1.0;
        result.addOrReplace(sp.x, sp.y, bulge, posEqualEps);
        result.addOrReplace(ep.x, ep.y, s2.v1.bulge, posEqualEps);
        break;
      }
      case "trueIntersect": {
        const intrPoint = pointFromParametric(v1.pos(), v2.pos(), intrResult.seg1T);
        result.addOrReplace(intrPoint.x, intrPoint.y, 0.0, posEqualEps);
        break;
      }
      case "overlapping": {
        result.addOrReplace(v2.x, v2.y, 0.0, posEqualEps);
        break;
      }
      case "falseIntersect": {
        if (intrResult.seg1T > 1.0 && isFalseIntersect(intrResult.seg2T)) {
          // extend and join the lines together using arc
          connectUsingArc(s1, s2, connectionArcsCcw, result, posEqualEps);
        } else {
          result.addOrReplace(v2.x, v2.y, 0.0, posEqualEps);
          result.addOrReplace(u1.x, u1.y, u1.bulge, posEqualEps);
        }
        break;
      }
    }
  }
}

/** Join two adjacent raw offset segments where the first segment is a line and the second is a arc. */
function lineArcJoin(
  s1: RawPlineOffsetSeg,
  s2: RawPlineOffsetSeg,
  params: JoinParams,
  result: PlineSourceMutBase,
): void {
  const connectionArcsCcw = params.connectionArcsCcw;
  const posEqualEps = params.posEqualEps;
  const v1 = s1.v1;
  const v2 = s1.v2;
  const u1 = s2.v1;
  const u2 = s2.v2;

  debugAssert(
    v1.bulgeIsZero() && !u1.bulgeIsZero(),
    "first segment should be line, second segment should be arc",
  );

  const [arcRadius, arcCenter] = segArcRadiusAndCenter(u1, u2);

  const processIntersect = (t: number, intersect: Vector2): void => {
    const trueLineIntr = !isFalseIntersect(t);
    const trueArcIntr = pointWithinArcSweep(
      arcCenter,
      u1.pos(),
      u2.pos(),
      u1.bulgeIsNeg(),
      intersect,
      posEqualEps,
    );

    if (trueLineIntr && trueArcIntr) {
      // trim at intersect
      const a = angle(arcCenter, intersect);
      const arcEndAngle = angle(arcCenter, u2.pos());
      const theta = deltaAngle(a, arcEndAngle);
      // ensure sign matches (may get flipped if intersect is at the very end of the arc,
      // in which case we do not want to update the bulge)
      if (theta > 0.0 === u1.bulgeIsPos()) {
        result.addOrReplace(intersect.x, intersect.y, bulgeFromAngle(theta), posEqualEps);
      } else {
        result.addOrReplace(intersect.x, intersect.y, u1.bulge, posEqualEps);
      }
      return;
    }

    if (t > 1.0 && !trueArcIntr) {
      connectUsingArc(s1, s2, connectionArcsCcw, result, posEqualEps);
      return;
    }

    if (s1.collapsedArc) {
      connectUsingArc(s1, s2, connectionArcsCcw, result, posEqualEps);
      return;
    }

    // connect using line
    result.addOrReplace(v2.x, v2.y, 0.0, posEqualEps);
    result.addOrReplaceVertex(u1, posEqualEps);
  };

  const intrResult = lineCircleIntr(v1.pos(), v2.pos(), arcRadius, arcCenter, posEqualEps);
  switch (intrResult.kind) {
    case "noIntersect": {
      connectUsingArc(s1, s2, connectionArcsCcw, result, posEqualEps);
      break;
    }
    case "tangentIntersect": {
      processIntersect(intrResult.t0, pointFromParametric(v1.pos(), v2.pos(), intrResult.t0));
      break;
    }
    case "twoIntersects": {
      // always use intersect closest to original point
      const intr1 = pointFromParametric(v1.pos(), v2.pos(), intrResult.t0);
      const dist1 = distSquared(intr1, s1.origV2Pos);
      const intr2 = pointFromParametric(v1.pos(), v2.pos(), intrResult.t1);
      const dist2 = distSquared(intr2, s1.origV2Pos);

      if (dist1 < dist2) {
        processIntersect(intrResult.t0, intr1);
      } else {
        processIntersect(intrResult.t1, intr2);
      }
      break;
    }
  }
}

/** Join two adjacent raw offset segments where the first segment is a arc and the second is a line. */
function arcLineJoin(
  s1: RawPlineOffsetSeg,
  s2: RawPlineOffsetSeg,
  params: JoinParams,
  result: PlineSourceMutBase,
): void {
  const connectionArcsCcw = params.connectionArcsCcw;
  const posEqualEps = params.posEqualEps;
  const v1 = s1.v1;
  const v2 = s1.v2;
  const u1 = s2.v1;
  const u2 = s2.v2;

  debugAssert(
    !v1.bulgeIsZero() && u1.bulgeIsZero(),
    "first segment should be arc, second segment should be line",
  );

  const [arcRadius, arcCenter] = segArcRadiusAndCenter(v1, v2);

  const processIntersect = (t: number, intersect: Vector2): void => {
    const trueLineIntr = !isFalseIntersect(t);
    const trueArcIntr = pointWithinArcSweep(
      arcCenter,
      v1.pos(),
      v2.pos(),
      v1.bulgeIsNeg(),
      intersect,
      posEqualEps,
    );

    if (trueLineIntr && trueArcIntr) {
      const prevVertex = unwrap(result.last(), "result is not empty");
      if (!prevVertex.bulgeIsZero() && !prevVertex.pos().fuzzyEqEps(v2.pos(), posEqualEps)) {
        // modify previous bulge and trim at intersect
        const a = angle(arcCenter, intersect);
        const [, prevArcCenter] = segArcRadiusAndCenter(prevVertex, v2);
        const prevArcStartAngle = angle(prevArcCenter, prevVertex.pos());
        const updatedPrevTheta = deltaAngle(prevArcStartAngle, a);
        // ensure the sign matches (may get flipped if intersect is at the very end of the
        // arc, in which case we do not want to update the bulge)
        if (updatedPrevTheta > 0.0 === prevVertex.bulgeIsPos()) {
          const last = unwrap(result.last(), "result is not empty");
          result.setLast(last.withBulge(bulgeFromAngle(updatedPrevTheta)));
        }
      }

      result.addOrReplace(intersect.x, intersect.y, 0.0, posEqualEps);
      return;
    }

    connectUsingArc(s1, s2, connectionArcsCcw, result, posEqualEps);
  };

  const intrResult = lineCircleIntr(u1.pos(), u2.pos(), arcRadius, arcCenter, posEqualEps);
  switch (intrResult.kind) {
    case "noIntersect": {
      connectUsingArc(s1, s2, connectionArcsCcw, result, posEqualEps);
      break;
    }
    case "tangentIntersect": {
      processIntersect(intrResult.t0, pointFromParametric(u1.pos(), u2.pos(), intrResult.t0));
      break;
    }
    case "twoIntersects": {
      // always use intersect closest to original point
      const origPoint = s2.collapsedArc ? u1.pos() : s1.origV2Pos;
      const intr1 = pointFromParametric(u1.pos(), u2.pos(), intrResult.t0);
      const dist1 = distSquared(intr1, origPoint);
      const intr2 = pointFromParametric(u1.pos(), u2.pos(), intrResult.t1);
      const dist2 = distSquared(intr2, origPoint);

      if (dist1 < dist2) {
        processIntersect(intrResult.t0, intr1);
      } else {
        processIntersect(intrResult.t1, intr2);
      }
      break;
    }
  }
}

/** Join two adjacent raw offset segments where both segments are arcs. */
function arcArcJoin(
  s1: RawPlineOffsetSeg,
  s2: RawPlineOffsetSeg,
  params: JoinParams,
  result: PlineSourceMutBase,
): void {
  const connectionArcsCcw = params.connectionArcsCcw;
  const posEqualEps = params.posEqualEps;
  const v1 = s1.v1;
  const v2 = s1.v2;
  const u1 = s2.v1;
  const u2 = s2.v2;

  debugAssert(!v1.bulgeIsZero() && !u1.bulgeIsZero(), "both segments should be arcs");

  const [arc1Radius, arc1Center] = segArcRadiusAndCenter(v1, v2);
  const [arc2Radius, arc2Center] = segArcRadiusAndCenter(u1, u2);

  const bothArcsSweepPoint = (point: Vector2): boolean => {
    return (
      pointWithinArcSweep(arc1Center, v1.pos(), v2.pos(), v1.bulgeIsNeg(), point, posEqualEps) &&
      pointWithinArcSweep(arc2Center, u1.pos(), u2.pos(), u1.bulgeIsNeg(), point, posEqualEps)
    );
  };

  const processIntersect = (intersect: Vector2, trueIntersect: boolean): void => {
    if (!trueIntersect) {
      connectUsingArc(s1, s2, connectionArcsCcw, result, posEqualEps);
    } else {
      const prevVertex = unwrap(result.last(), "result is not empty");

      if (!prevVertex.bulgeIsZero() && !prevVertex.pos().fuzzyEqEps(v2.pos(), posEqualEps)) {
        // modify previous bulge and trim at intersect
        const a1 = angle(arc1Center, intersect);
        const [, prevArcCenter] = segArcRadiusAndCenter(prevVertex, v2);
        const prevArcStartAngle = angle(prevArcCenter, prevVertex.pos());
        const updatedPrevTheta = deltaAngle(prevArcStartAngle, a1);
        // ensure the sign matches (may get flipped if intersect is at the very end of the
        // arc, in which case we do not want to update the bulge)
        if (updatedPrevTheta > 0.0 === prevVertex.bulgeIsPos()) {
          const last = unwrap(result.last(), "result is not empty");
          result.setLast(last.withBulge(bulgeFromAngle(updatedPrevTheta)));
        }
      }

      // add the vertex at our current trim/join point
      const a2 = angle(arc2Center, intersect);
      const endAngle = angle(arc2Center, u2.pos());
      const theta = deltaAngle(a2, endAngle);

      // again ensure sign matches before updating bulge
      if (theta > 0.0 === u1.bulgeIsPos()) {
        result.addOrReplace(intersect.x, intersect.y, bulgeFromAngle(theta), posEqualEps);
      } else {
        result.addOrReplace(intersect.x, intersect.y, u1.bulge, posEqualEps);
      }
    }
  };

  const intrResult = circleCircleIntr(arc1Radius, arc1Center, arc2Radius, arc2Center, posEqualEps);
  switch (intrResult.kind) {
    case "noIntersect": {
      connectUsingArc(s1, s2, connectionArcsCcw, result, posEqualEps);
      break;
    }
    case "tangentIntersect": {
      processIntersect(intrResult.point, bothArcsSweepPoint(intrResult.point));
      break;
    }
    case "twoIntersects": {
      // always use intersect closest to original point
      const dist1 = distSquared(intrResult.point1, s1.origV2Pos);
      const dist2 = distSquared(intrResult.point2, s1.origV2Pos);
      if (fuzzyEqEps(dist1, dist2, posEqualEps)) {
        // catch case where both points are equal distance (occurs if input arcs connect at
        // tangent point), prioritize true intersect (eliminates intersect in raw offset
        // polyline that must be processed later and prevents false creation of segments if
        // using dual offset clipping)
        if (bothArcsSweepPoint(intrResult.point1)) {
          processIntersect(intrResult.point1, true);
        } else {
          processIntersect(intrResult.point2, bothArcsSweepPoint(intrResult.point2));
        }
      } else if (dist1 < dist2) {
        processIntersect(intrResult.point1, bothArcsSweepPoint(intrResult.point1));
      } else {
        processIntersect(intrResult.point2, bothArcsSweepPoint(intrResult.point2));
      }
      break;
    }
    case "overlapping": {
      // same arc radius and center, just add the vertex (nothing to trim/extend)
      result.addOrReplaceVertex(u1, posEqualEps);
      break;
    }
  }
}

export function createRawOffsetPolyline(
  polyline: PlineSourceBase,
  offset: number,
  posEqualEps: number,
): Polyline {
  const vc = polyline.vertexCount;
  if (vc < 2) {
    return Polyline.empty();
  }

  const rawOffsetSegs = createUntrimmedRawOffsetSegs(polyline, offset);
  if (rawOffsetSegs.length === 0) {
    return Polyline.empty();
  }

  // detect single collapsed arc segment
  if (rawOffsetSegs.length === 1 && rawOffsetSegs[0].collapsedArc) {
    return Polyline.empty();
  }

  const connectionArcsCcw = offset < 0.0;
  const joinParams: JoinParams = {
    connectionArcsCcw,
    posEqualEps,
  };

  const joinSegPair = (s1: RawPlineOffsetSeg, s2: RawPlineOffsetSeg, result: Polyline): void => {
    const s1IsLine = s1.v1.bulgeIsZero();
    const s2IsLine = s2.v1.bulgeIsZero();
    if (s1IsLine && s2IsLine) {
      lineLineJoin(s1, s2, joinParams, result);
    } else if (s1IsLine && !s2IsLine) {
      lineArcJoin(s1, s2, joinParams, result);
    } else if (!s1IsLine && s2IsLine) {
      arcLineJoin(s1, s2, joinParams, result);
    } else {
      arcArcJoin(s1, s2, joinParams, result);
    }
  };

  const result = Polyline.withCapacity(vc, polyline.isClosed);

  // add the very first vertex
  result.addVertex(rawOffsetSegs[0].v1);

  // join first two segments and determine if first vertex was replaced (to know how to handle
  // last two segment joins for closed polyline)
  if (rawOffsetSegs.length >= 2) {
    joinSegPair(rawOffsetSegs[0], rawOffsetSegs[1], result);
  }

  const firstVertexReplaced = result.vertexCount === 1;

  for (let i = 1; i + 1 < rawOffsetSegs.length; i += 1) {
    joinSegPair(rawOffsetSegs[i], rawOffsetSegs[i + 1], result);
  }

  if (polyline.isClosed && result.vertexCount > 1) {
    // join closing segments at vertex indexes (n, 0) and (0, 1)
    const s1 = rawOffsetSegs[rawOffsetSegs.length - 1];
    const s2 = rawOffsetSegs[0];

    // temp polyline to capture results of joining (to avoid mutating result)
    const closingPartResult = Polyline.empty();
    closingPartResult.addVertex(unwrap(result.last(), "result is not empty"));
    joinSegPair(s1, s2, closingPartResult);

    // update last vertexes
    result.setLast(closingPartResult.at(0));
    for (let i = 1; i < closingPartResult.vertexCount; i += 1) {
      result.addVertex(closingPartResult.at(i));
    }

    // update first vertex (only if it has not already been updated/replaced)
    if (!firstVertexReplaced) {
      const updatedFirstPos = unwrap(closingPartResult.last(), "closing part is not empty").pos();
      if (result.at(0).bulgeIsZero()) {
        // just update position
        const b = result.at(0).bulge;
        result.set(0, updatedFirstPos.x, updatedFirstPos.y, b);
      } else if (result.vertexCount > 1) {
        // update position and bulge
        const [, arcCenter] = segArcRadiusAndCenter(result.at(0), result.at(1));
        const a1 = angle(arcCenter, updatedFirstPos);
        const a2 = angle(arcCenter, result.at(1).pos());
        const updatedTheta = deltaAngle(a1, a2);
        if (
          (updatedTheta < 0.0 && result.at(0).bulgeIsPos()) ||
          (updatedTheta > 0.0 && result.at(0).bulgeIsNeg())
        ) {
          // first vertex not valid, just update its position (it will be removed later)
          const b = result.at(0).bulge;
          result.set(0, updatedFirstPos.x, updatedFirstPos.y, b);
        } else {
          // update position and bulge
          result.set(0, updatedFirstPos.x, updatedFirstPos.y, bulgeFromAngle(updatedTheta));
        }
      }
    }

    // must do final singularity prune between last, first, and second vertex because after
    // joining segments (n, 0) and (0, 1) they may have been introduced
    if (result.vertexCount > 1) {
      if (
        result
          .at(0)
          .pos()
          .fuzzyEqEps(unwrap(result.last(), "result is not empty").pos(), posEqualEps)
      ) {
        result.removeLast();
      }

      if (result.vertexCount > 1 && result.at(0).pos().fuzzyEqEps(result.at(1).pos(), posEqualEps)) {
        result.remove(0);
      }
    }
  } else {
    // not closed polyline or less than 2 vertexes
    const lastRawOffsetVertex = rawOffsetSegs[rawOffsetSegs.length - 1].v2;
    result.addOrReplaceVertex(lastRawOffsetVertex, posEqualEps);
  }

  // if due to joining of segments we are left with only 1 vertex then return empty polyline
  if (result.vertexCount === 1) {
    result.clear();
  }

  return result;
}

export function pointValidForOffset(
  polyline: PlineSourceBase,
  offset: number,
  aabbIndex: StaticAabb2dIndex,
  point: Vector2,
  posEqualEps: number,
  offsetTol: number,
): boolean {
  const absOffset = Math.abs(offset) - offsetTol;
  const minDist = absOffset * absOffset;
  let pointValid = true;
  const visitor = (i: number): VisitResult => {
    const j = polyline.nextWrappingIndex(i);
    const closestPoint = segClosestPoint(polyline.at(i), polyline.at(j), point, posEqualEps);
    const dist = distSquared(closestPoint, point);
    pointValid = dist > minDist;
    // continue visiting if point is valid, break if not (Rust Control::Continue/Break)
    return pointValid;
  };

  aabbIndex.visitQuery(
    point.x - absOffset,
    point.y - absOffset,
    point.x + absOffset,
    point.y + absOffset,
    visitor,
  );
  return pointValid;
}

export function slicesFromRawOffset(
  originalPolyline: PlineSourceBase,
  rawOffsetPolyline: PlineSourceBase,
  origPolylineIndex: StaticAabb2dIndex,
  offset: number,
  options: PlineOffsetOptions,
): PlineViewData[] {
  debugAssert(
    rawOffsetPolyline.isClosed,
    "only supports closed polylines, use slices_from_dual_raw_offsets for open polylines",
  );

  const result: PlineViewData[] = [];
  if (rawOffsetPolyline.vertexCount < 2) {
    return result;
  }

  const defaults = defaultPlineOffsetOptions();
  const posEqualEps = options.posEqualEps ?? defaults.posEqualEps;
  const offsetDistEps = options.offsetDistEps ?? defaults.offsetDistEps;

  const rawOffsetIndex = rawOffsetPolyline.createApproxAabbIndex();
  const selfIntrs = allSelfIntersectsAsBasic(rawOffsetPolyline, rawOffsetIndex, false, posEqualEps);

  if (selfIntrs.length === 0) {
    // no self intersects, test point on polyline is valid
    if (
      !pointValidForOffset(
        originalPolyline,
        offset,
        origPolylineIndex,
        rawOffsetPolyline.at(0).pos(),
        posEqualEps,
        offsetDistEps,
      )
    ) {
      // not valid
      return result;
    }

    // is valid
    const slice = PlineViewData.fromEntirePline(rawOffsetPolyline);
    result.push(slice);
    return result;
  }

  // Rust uses a BTreeMap here (note: sorted iteration order is not required at this step)
  const intersectsLookup = new Map<number, Vector2[]>();

  const addToLookup = (startIndex: number, point: Vector2): void => {
    let list = intersectsLookup.get(startIndex);
    if (list === undefined) {
      list = [];
      intersectsLookup.set(startIndex, list);
    }
    list.push(point);
  };

  for (const si of selfIntrs) {
    addToLookup(si.startIndex1, si.point);
    addToLookup(si.startIndex2, si.point);
  }

  // sort intersects by distance from segment start vertex
  for (const [i, intrList] of intersectsLookup) {
    const startPos = rawOffsetPolyline.at(i).pos();
    intrList.sort((si1, si2) => {
      const dist1 = distSquared(si1, startPos);
      const dist2 = distSquared(si2, startPos);
      return dist1 < dist2 ? -1 : dist1 > dist2 ? 1 : 0;
    });
  }

  const intersectsOriginalPline = (v1: PlineVertex, v2: PlineVertex): boolean => {
    const approxBb = segFastApproxBoundingBox(v1, v2);
    let hasIntersect = false;
    const visitor = (i: number): VisitResult => {
      const j = originalPolyline.nextWrappingIndex(i);
      hasIntersect =
        plineSegIntr(v1, v2, originalPolyline.at(i), originalPolyline.at(j), posEqualEps).kind !==
        "noIntersect";
      // break if intersect found (Rust Control::Break/Continue)
      return !hasIntersect;
    };

    const fuzz = FUZZY_EPSILON;
    origPolylineIndex.visitQuery(
      approxBb.minX - fuzz,
      approxBb.minY - fuzz,
      approxBb.maxX + fuzz,
      approxBb.maxY + fuzz,
      visitor,
    );
    return hasIntersect;
  };

  const pointValidDist = (point: Vector2): boolean => {
    return pointValidForOffset(
      originalPolyline,
      offset,
      origPolylineIndex,
      point,
      posEqualEps,
      offsetDistEps,
    );
  };

  const sliceIsValid = (slice: PlineViewData): boolean => {
    if (slice.endIndexOffset === 0) {
      // slice all on one segment, test start, end, midpoint, and if it intersects the
      // original
      const v1 = slice.updatedStart;
      if (!pointValidDist(v1.pos())) {
        return false;
      }
      const v2 = PlineVertex.fromVector2(slice.endPoint, 0.0);
      if (!pointValidDist(v2.pos())) {
        return false;
      }
      const midpoint = segMidpoint(v1, v2);
      if (!pointValidDist(midpoint)) {
        return false;
      }

      return !intersectsOriginalPline(v1, v2);
    }

    // slice not all on one segment, start by checking midpoints of first and last segment of
    // the slice
    const startSegMidpoint = segMidpoint(
      slice.updatedStart,
      rawOffsetPolyline.at(rawOffsetPolyline.nextWrappingIndex(slice.startIndex)),
    );

    if (!pointValidDist(startSegMidpoint)) {
      return false;
    }

    const endIndex = rawOffsetPolyline.fwdWrappingIndex(slice.startIndex, slice.endIndexOffset);
    const endSegMidpoint = segMidpoint(
      rawOffsetPolyline.at(endIndex).withBulge(slice.updatedEndBulge),
      PlineVertex.fromVector2(slice.endPoint, 0.0),
    );

    if (!pointValidDist(endSegMidpoint)) {
      return false;
    }

    // test all segments
    for (const [v1, v2] of slice.view(rawOffsetPolyline).iterSegments()) {
      // test start point
      if (!pointValidDist(v1.pos())) {
        return false;
      }

      // test intersection with original polyline
      if (intersectsOriginalPline(v1, v2)) {
        return false;
      }
    }
    // check final end point (loop checks only start point and intersection)
    return pointValidDist(slice.endPoint);
  };

  const sortedLookupKeys = sortedKeys(intersectsLookup);
  for (const startIndex of sortedLookupKeys) {
    const intrList = intersectsLookup.get(startIndex)!;
    for (let w = 0; w + 1 < intrList.length; w += 1) {
      const intr1 = intrList[w];
      const intr2 = intrList[w + 1];
      const slice = PlineViewData.fromSlicePoints(
        rawOffsetPolyline,
        intr1,
        startIndex,
        intr2,
        startIndex,
        posEqualEps,
      );

      if (slice !== null && sliceIsValid(slice)) {
        result.push(slice);
      }
    }

    // build the slice between the last intersect in the intr_list and the next intersect found
    const nextIndex = rawOffsetPolyline.nextWrappingIndex(startIndex);

    // Rust `intersects_lookup.range(next_index..).next()` (first key >= next_index), else wrap
    // around polyline: `intersects_lookup.range(..=start_index).next().unwrap()` = smallest key
    // (smallest key is always <= start_index since start_index is itself a key)
    let foundIndex = sortedLookupKeys.find((k) => k >= nextIndex);
    if (foundIndex === undefined) {
      // wrap around polyline
      foundIndex = sortedLookupKeys[0];
    }
    const nextIntrList = intersectsLookup.get(foundIndex)!;

    const slice = PlineViewData.fromSlicePoints(
      rawOffsetPolyline,
      intrList[intrList.length - 1],
      startIndex,
      nextIntrList[0],
      foundIndex,
      posEqualEps,
    );

    if (slice !== null && sliceIsValid(slice)) {
      result.push(slice);
    }
  }

  return result;
}

/** Adds circle intersects to the intersect lookup via the `visitor` given. */
function visitCircleIntersects(
  pline: PlineSourceBase,
  circleCenter: Vector2,
  circleRadius: number,
  aabbIndex: StaticAabb2dIndex,
  visitor: (startIndex: number, intr: Vector2) => void,
  options: PlineOffsetOptions,
): void {
  const defaults = defaultPlineOffsetOptions();
  const posEqualEps = options.posEqualEps ?? defaults.posEqualEps;

  const isValidLineIntr = (t: number): boolean => {
    // skip false intersects and intersects at start of seg
    return !isFalseIntersect(t) && Math.abs(t) > posEqualEps;
  };

  const isValidArcIntr = (
    arcCenter: Vector2,
    arcStart: Vector2,
    arcEnd: Vector2,
    bulge: number,
    intr: Vector2,
  ): boolean => {
    // skip false intersects and intersects at start of seg
    return (
      !arcStart.fuzzyEqEps(intr, posEqualEps) &&
      pointWithinArcSweep(arcCenter, arcStart, arcEnd, bulge < 0.0, intr, posEqualEps)
    );
  };

  const queryResults = aabbIndex.query(
    circleCenter.x - circleRadius,
    circleCenter.y - circleRadius,
    circleCenter.x + circleRadius,
    circleCenter.y + circleRadius,
  );

  for (const startIndex of queryResults) {
    const v1 = pline.at(startIndex);
    const v2 = pline.at(pline.nextWrappingIndex(startIndex));
    if (v1.bulgeIsZero()) {
      const intrResult = lineCircleIntr(v1.pos(), v2.pos(), circleRadius, circleCenter, posEqualEps);
      switch (intrResult.kind) {
        case "noIntersect":
          break;
        case "tangentIntersect": {
          if (isValidLineIntr(intrResult.t0)) {
            visitor(startIndex, pointFromParametric(v1.pos(), v2.pos(), intrResult.t0));
          }
          break;
        }
        case "twoIntersects": {
          if (isValidLineIntr(intrResult.t0)) {
            visitor(startIndex, pointFromParametric(v1.pos(), v2.pos(), intrResult.t0));
          }
          if (isValidLineIntr(intrResult.t1)) {
            visitor(startIndex, pointFromParametric(v1.pos(), v2.pos(), intrResult.t1));
          }
          break;
        }
      }
    } else {
      const [arcRadius, arcCenter] = segArcRadiusAndCenter(v1, v2);
      const intrResult = circleCircleIntr(arcRadius, arcCenter, circleRadius, circleCenter, posEqualEps);
      switch (intrResult.kind) {
        case "noIntersect":
          break;
        case "tangentIntersect": {
          if (isValidArcIntr(arcCenter, v1.pos(), v2.pos(), v1.bulge, intrResult.point)) {
            visitor(startIndex, intrResult.point);
          }
          break;
        }
        case "twoIntersects": {
          if (isValidArcIntr(arcCenter, v1.pos(), v2.pos(), v1.bulge, intrResult.point1)) {
            visitor(startIndex, intrResult.point1);
          }
          if (isValidArcIntr(arcCenter, v1.pos(), v2.pos(), v1.bulge, intrResult.point2)) {
            visitor(startIndex, intrResult.point2);
          }
          break;
        }
        case "overlapping":
          break;
      }
    }
  }
}

export function slicesFromDualRawOffsets(
  originalPolyline: PlineSourceBase,
  rawOffsetPolyline: PlineSourceBase,
  dualRawOffsetPolyline: PlineSourceBase,
  origPolylineIndex: StaticAabb2dIndex,
  offset: number,
  options: PlineOffsetOptions,
): PlineViewData[] {
  const result: PlineViewData[] = [];
  if (rawOffsetPolyline.vertexCount < 2) {
    return result;
  }

  const defaults = defaultPlineOffsetOptions();
  const posEqualEps = options.posEqualEps ?? defaults.posEqualEps;
  const offsetDistEps = options.offsetDistEps ?? defaults.offsetDistEps;

  const rawOffsetIndex = rawOffsetPolyline.createApproxAabbIndex();

  const selfIntrs = allSelfIntersectsAsBasic(rawOffsetPolyline, rawOffsetIndex, false, posEqualEps);

  const dualIntrs = findIntersects(rawOffsetPolyline, dualRawOffsetPolyline, {
    pline1AabbIndex: rawOffsetIndex,
    posEqualEps: posEqualEps,
  });

  // Rust uses a BTreeMap since we want to construct the slices in vertex index order and we do
  // so by looping through all intersects (required later when slices are stitched together,
  // because slices may not all form closed loops/polylines so must go in order of indexes to
  // ensure longest stitched results are formed)
  const intersectsLookup = new Map<number, Vector2[]>();

  // helper function to add intersects to the lookup
  const addIntr = (startIndex: number, intr: Vector2): void => {
    let list = intersectsLookup.get(startIndex);
    if (list === undefined) {
      list = [];
      intersectsLookup.set(startIndex, list);
    }
    list.push(intr);
  };

  if (!originalPolyline.isClosed) {
    // add intersects between circles generated at original open polyline end points and raw
    // offset polyline
    const circleRadius = Math.abs(offset);
    visitCircleIntersects(
      rawOffsetPolyline,
      originalPolyline.at(0).pos(),
      circleRadius,
      rawOffsetIndex,
      addIntr,
      options,
    );
    visitCircleIntersects(
      rawOffsetPolyline,
      unwrap(originalPolyline.last(), "polyline is not empty").pos(),
      circleRadius,
      rawOffsetIndex,
      addIntr,
      options,
    );
  }

  // add all self intersects
  for (const si of selfIntrs) {
    addIntr(si.startIndex1, si.point);
    addIntr(si.startIndex2, si.point);
  }

  // only add intersects with start_index1 from dual intersects (corresponds to the the raw offset
  // polyline)
  for (const intr of dualIntrs.basicIntersects) {
    addIntr(intr.startIndex1, intr.point);
  }
  // Note not adding any overlapping intersects (they can only arise due to collapsing regions)

  if (intersectsLookup.size === 0) {
    // test a point on raw offset polyline
    if (
      !pointValidForOffset(
        originalPolyline,
        offset,
        origPolylineIndex,
        rawOffsetPolyline.at(0).pos(),
        posEqualEps,
        offsetDistEps,
      )
    ) {
      return result;
    }

    // is valid
    const slice = PlineViewData.fromEntirePline(rawOffsetPolyline);
    result.push(slice);
    return result;
  }

  // sort intersects by distance from segment start vertex
  for (const [i, intrList] of intersectsLookup) {
    const startPos = rawOffsetPolyline.at(i).pos();
    intrList.sort((si1, si2) => {
      const dist1 = distSquared(si1, startPos);
      const dist2 = distSquared(si2, startPos);
      return dist1 < dist2 ? -1 : dist1 > dist2 ? 1 : 0;
    });
  }

  const intersectsOriginalPline = (v1: PlineVertex, v2: PlineVertex): boolean => {
    const approxBb = segFastApproxBoundingBox(v1, v2);
    let hasIntersect = false;
    const visitor = (i: number): VisitResult => {
      const j = originalPolyline.nextWrappingIndex(i);
      hasIntersect =
        plineSegIntr(v1, v2, originalPolyline.at(i), originalPolyline.at(j), posEqualEps).kind !==
        "noIntersect";
      // break if intersect found (Rust Control::Break/Continue)
      return !hasIntersect;
    };

    const fuzz = FUZZY_EPSILON;
    origPolylineIndex.visitQuery(
      approxBb.minX - fuzz,
      approxBb.minY - fuzz,
      approxBb.maxX + fuzz,
      approxBb.maxY + fuzz,
      visitor,
    );
    return hasIntersect;
  };

  const pointValidDist = (point: Vector2): boolean => {
    return pointValidForOffset(
      originalPolyline,
      offset,
      origPolylineIndex,
      point,
      posEqualEps,
      offsetDistEps,
    );
  };

  const sliceIsValid = (slice: PlineViewData): boolean => {
    if (slice.endIndexOffset === 0) {
      // slice all on one segment, test start, end, midpoint, and if it intersects the
      // original
      const v1 = slice.updatedStart;
      if (!pointValidDist(v1.pos())) {
        return false;
      }
      const v2 = PlineVertex.fromVector2(slice.endPoint, 0.0);
      if (!pointValidDist(v2.pos())) {
        return false;
      }
      const midpoint = segMidpoint(v1, v2);
      if (!pointValidDist(midpoint)) {
        return false;
      }

      return !intersectsOriginalPline(v1, v2);
    }

    // slice not all on one segment, start by checking midpoints of first and last segment of
    // the slice
    const startSegMidpoint = segMidpoint(
      slice.updatedStart,
      rawOffsetPolyline.at(rawOffsetPolyline.nextWrappingIndex(slice.startIndex)),
    );

    if (!pointValidDist(startSegMidpoint)) {
      return false;
    }

    const endIndex = rawOffsetPolyline.fwdWrappingIndex(slice.startIndex, slice.endIndexOffset);
    const endSegMidpoint = segMidpoint(
      rawOffsetPolyline.at(endIndex).withBulge(slice.updatedEndBulge),
      PlineVertex.fromVector2(slice.endPoint, 0.0),
    );

    if (!pointValidDist(endSegMidpoint)) {
      return false;
    }

    // test all segments
    for (const [v1, v2] of slice.view(rawOffsetPolyline).iterSegments()) {
      // test start point
      if (!pointValidDist(v1.pos())) {
        return false;
      }

      // test intersection with original polyline
      if (intersectsOriginalPline(v1, v2)) {
        return false;
      }
    }
    // check final end point (loop checks only start point and intersection)
    return pointValidDist(slice.endPoint);
  };

  const sortedLookupKeys = sortedKeys(intersectsLookup);

  if (!originalPolyline.isClosed) {
    // build first slice that ends at the first intersect since we will not wrap back to
    // capture it as in the case of a closed polyline
    const intrIdx = sortedLookupKeys[0];
    const intrList = intersectsLookup.get(intrIdx)!;
    const intr = intrList[0];
    const slice = PlineViewData.fromSlicePoints(
      rawOffsetPolyline,
      rawOffsetPolyline.at(0).pos(),
      0,
      intr,
      intrIdx,
      posEqualEps,
    );

    if (slice !== null && sliceIsValid(slice)) {
      result.push(slice);
    }
  }

  for (const startIndex of sortedLookupKeys) {
    const intrList = intersectsLookup.get(startIndex)!;
    for (let w = 0; w + 1 < intrList.length; w += 1) {
      const intr1 = intrList[w];
      const intr2 = intrList[w + 1];
      const slice = PlineViewData.fromSlicePoints(
        rawOffsetPolyline,
        intr1,
        startIndex,
        intr2,
        startIndex,
        posEqualEps,
      );

      if (slice !== null && sliceIsValid(slice)) {
        result.push(slice);
      }
    }

    // build the slice between the last intersect in the intr_list and the next intersect found
    const nextIndex = rawOffsetPolyline.nextWrappingIndex(startIndex);

    // Rust `intersects_lookup.range(next_index..).next()` (first key >= next_index)
    let foundIndex = sortedLookupKeys.find((k) => k >= nextIndex);
    if (foundIndex === undefined) {
      if (originalPolyline.isClosed) {
        // wrap around polyline (Rust `range(..=start_index).next().unwrap()` = smallest key,
        // smallest key is always <= start_index since start_index is itself a key)
        foundIndex = sortedLookupKeys[0];
      } else {
        // open polyline and didn't find next intersect, we're done
        const slice = PlineViewData.fromSlicePoints(
          rawOffsetPolyline,
          intrList[intrList.length - 1],
          startIndex,
          unwrap(rawOffsetPolyline.last(), "polyline is not empty").pos(),
          rawOffsetPolyline.vertexCount - 1,
          posEqualEps,
        );
        if (slice !== null && sliceIsValid(slice)) {
          result.push(slice);
        }
        return result;
      }
    }
    const nextIntrList = intersectsLookup.get(foundIndex)!;

    const slice = PlineViewData.fromSlicePoints(
      rawOffsetPolyline,
      intrList[intrList.length - 1],
      startIndex,
      nextIntrList[0],
      foundIndex,
      posEqualEps,
    );

    if (slice !== null && sliceIsValid(slice)) {
      result.push(slice);
    }
  }

  return result;
}

export function stitchSlicesTogether(
  rawOffsetPline: PlineSourceBase,
  slices: readonly PlineViewData[],
  isClosed: boolean,
  origMaxIndex: number,
  options: PlineOffsetOptions,
): Polyline[] {
  const result: Polyline[] = [];
  if (slices.length === 0) {
    return result;
  }

  const defaults = defaultPlineOffsetOptions();
  const joinEps = options.sliceJoinEps ?? defaults.sliceJoinEps;
  const posEqualEps = options.posEqualEps ?? defaults.posEqualEps;

  if (slices.length === 1) {
    // Use join_eps for removing repeat vertices to be consistent with how slice connections
    // are detected (prevents tiny segments at slice boundaries)
    const pline = Polyline.createFromRemoveRepeat(slices[0].view(rawOffsetPline), joinEps);

    if (
      isClosed &&
      pline.at(0).pos().fuzzyEqEps(unwrap(pline.last(), "pline is not empty").pos(), joinEps)
    ) {
      pline.setIsClosed(true);
      pline.removeLast();
    }

    result.push(pline);

    return result;
  }

  const builder = new StaticAabb2dIndexBuilder(slices.length);
  for (const slice of slices) {
    const startPoint = slice.updatedStart.pos();
    builder.add(
      startPoint.x - joinEps,
      startPoint.y - joinEps,
      startPoint.x + joinEps,
      startPoint.y + joinEps,
    );
  }
  const aabbIndex = builder.build();

  const visitedIndexes: boolean[] = new Array<boolean>(slices.length).fill(false);
  const queryResults: number[] = [];

  for (let i = 0; i < slices.length; i += 1) {
    if (visitedIndexes[i]) {
      continue;
    }

    visitedIndexes[i] = true;

    const currentPline = Polyline.empty();
    let currentIndex = i;
    const initialStartPoint = slices[i].updatedStart.pos();
    let loopCount = 0;
    const maxLoopCount = slices.length;
    for (;;) {
      if (loopCount > maxLoopCount) {
        // prevent infinite loop
        throw new Error("loop_count exceeded max_loop_count while stitching slices together");
      }
      loopCount += 1;

      // append current slice to current pline
      // Use join_eps for removing repeat vertices to be consistent with how slice connections
      // are detected (prevents tiny segments at slice boundaries)
      const currentSlice = slices[currentIndex];

      currentPline.extendRemoveRepeat(currentSlice.view(rawOffsetPline), joinEps);

      const currentLoopStartIndex = currentSlice.startIndex;
      const currentEndPoint = currentSlice.endPoint;

      queryResults.length = 0;
      const aabbIndexVisitor = (idx: number): VisitResult => {
        if (!visitedIndexes[idx]) {
          queryResults.push(idx);
        }
      };
      aabbIndex.visitQuery(
        currentEndPoint.x - joinEps,
        currentEndPoint.y - joinEps,
        currentEndPoint.x + joinEps,
        currentEndPoint.y + joinEps,
        aabbIndexVisitor,
      );

      const getIndexDist = (idx: number): number => {
        const slice = slices[idx];
        if (currentLoopStartIndex <= slice.startIndex) {
          return slice.startIndex - currentLoopStartIndex;
        }
        // forward wrapping distance (distance to end + distance to index)
        return origMaxIndex - currentLoopStartIndex + slice.startIndex;
      };

      const endConnectsToStart = (idx: number): boolean => {
        const endPoint = slices[idx].endPoint;
        return endPoint.fuzzyEqEps(initialStartPoint, posEqualEps);
      };

      queryResults.sort((a, b) => {
        // sort by index distance then by end of slice connecting to initial start
        // this ordering ensures overlapping slices are retained in stitching
        const distCmp = getIndexDist(a) - getIndexDist(b);
        if (distCmp !== 0) {
          return distCmp;
        }
        return Number(endConnectsToStart(a)) - Number(endConnectsToStart(b));
      });

      if (queryResults.length === 0) {
        // done stitching current polyline
        if (currentPline.vertexCount > 1) {
          const currentPlineSp = currentPline.at(0).pos();
          const currentPlineEp = unwrap(currentPline.last(), "pline is not empty").pos();
          // Use join_eps for consistency with slice connection detection
          if (isClosed && currentPlineSp.fuzzyEqEps(currentPlineEp, joinEps)) {
            currentPline.removeLast();
            currentPline.setIsClosed(true);
          }

          result.push(currentPline);
        }
        break;
      }

      // else continue stitching
      visitedIndexes[queryResults[0]] = true;
      currentPline.removeLast();
      currentIndex = queryResults[0];
    }
  }

  return result;
}

function parallelOffsetForSource(
  polyline: PlineSourceBase,
  offset: number,
  options: PlineOffsetOptions,
  allowExternalIndex: boolean,
): Polyline[] {
  const defaults = defaultPlineOffsetOptions();
  const posEqualEps = options.posEqualEps ?? defaults.posEqualEps;
  const handleSelfIntersects = options.handleSelfIntersects ?? defaults.handleSelfIntersects;
  const optionsAabbIndex = options.aabbIndex ?? defaults.aabbIndex;

  let index: StaticAabb2dIndex;
  if (allowExternalIndex) {
    if (optionsAabbIndex !== null) {
      index = optionsAabbIndex;
    } else {
      index = polyline.createApproxAabbIndex();
    }
  } else {
    index = polyline.createApproxAabbIndex();
  }

  const rawOffset = createRawOffsetPolyline(polyline, offset, posEqualEps);
  if (rawOffset.isEmpty()) {
    return [];
  } else if (polyline.isClosed && !handleSelfIntersects) {
    const slices = slicesFromRawOffset(polyline, rawOffset, index, offset, options);
    return stitchSlicesTogether(rawOffset, slices, true, rawOffset.vertexCount - 1, options);
  } else {
    const dualRawOffset = createRawOffsetPolyline(polyline, -offset, posEqualEps);
    const slices = slicesFromDualRawOffsets(
      polyline,
      rawOffset,
      dualRawOffset,
      index,
      offset,
      options,
    );

    return stitchSlicesTogether(rawOffset, slices, polyline.isClosed, rawOffset.vertexCount, options);
  }
}

export function parallelOffset(
  polyline: PlineSourceBase,
  offset: number,
  options: PlineOffsetOptions,
): Polyline[] {
  if (polyline.vertexCount < 2) {
    return [];
  }

  const defaults = defaultPlineOffsetOptions();
  const posEqualEps = options.posEqualEps ?? defaults.posEqualEps;

  // In release builds we still sanitize repeat positions to prevent unstable/degenerate segments.
  const cleaned = polyline.removeRepeatPos(posEqualEps);
  let result: Polyline[];
  if (cleaned !== null) {
    if (cleaned.vertexCount < 2) {
      result = [];
    } else {
      // user-provided aabb index is tied to the original polyline, rebuild for cleaned source
      result = parallelOffsetForSource(cleaned, offset, options, false);
    }
  } else {
    result = parallelOffsetForSource(polyline, offset, options, true);
  }

  debugAssert(
    result.every((p) => p.removeRepeatPos(posEqualEps) === null),
    "bug: result should never have repeat position vertexes",
  );

  for (const cursor of result) {
    cursor.setUserdataValues(polyline.getUserdataValues());
  }

  return result;
}

// register the implementation for `PlineSourceBase.parallelOffset`/`parallelOffsetOpt` (see
// `plineOffsetRegistry.ts` for why this indirection exists)
registerParallelOffsetImpl(parallelOffset);
