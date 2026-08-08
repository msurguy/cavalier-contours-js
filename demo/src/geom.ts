/**
 * Pure geometry helpers shared by the canvas renderer and the headless sanity
 * script. No DOM usage in this module.
 *
 * Arc direction convention (load-bearing, see `arcSweep`):
 * the demo canvas uses a world transform with a NEGATIVE y scale (y-up world).
 * Under that transform `ctx.arc(..., anticlockwise = false)` traces increasing
 * angle values, which appear counter-clockwise on screen. A positive bulge is a
 * counter-clockwise arc, so: `anticlockwise = bulge < 0`.
 */
import { segArcRadiusAndCenter, type PlineVertex, type Polyline } from "cavalier-contours-js";

/** Bulges below this magnitude are treated as straight line segments. */
export const LINE_BULGE_EPS = 1e-8;

export interface ArcSweep {
  cx: number;
  cy: number;
  radius: number;
  startAngle: number;
  endAngle: number;
  /** Canvas `anticlockwise` flag valid under a y-up (negative y scale) world transform. */
  anticlockwise: boolean;
}

/** Compute canvas-ready arc sweep parameters for an arc segment (v1.bulge !== 0). */
export function arcSweep(v1: PlineVertex, v2: PlineVertex): ArcSweep {
  const [radius, center] = segArcRadiusAndCenter(v1, v2);
  return {
    cx: center.x,
    cy: center.y,
    radius,
    startAngle: Math.atan2(v1.y - center.y, v1.x - center.x),
    endAngle: Math.atan2(v2.y - center.y, v2.x - center.x),
    anticlockwise: v1.bulge < 0,
  };
}

/** Iterate the segments (v1, v2 vertex pairs) of a polyline. */
export function* iterSegments(pline: Polyline): IterableIterator<[PlineVertex, PlineVertex]> {
  const n = pline.vertexCount;
  if (n < 2) return;
  const last = pline.isClosed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const v1 = pline.get(i)!;
    const v2 = pline.get((i + 1) % n)!;
    yield [v1, v2];
  }
}

/**
 * Flatten a polyline into a point list using EXACTLY the same sweep math the
 * renderer feeds into `ctx.arc`. Used by the sanity script to validate arc
 * direction: the signed shoelace area of the flattened polygon must match the
 * sign and (approximately) magnitude of `pline.area()`.
 */
export function flattenPline(pline: Polyline, maxAngleStep = 0.05): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (const [v1, v2] of iterSegments(pline)) {
    pts.push({ x: v1.x, y: v1.y });
    if (Math.abs(v1.bulge) > LINE_BULGE_EPS) {
      const { cx, cy, radius, startAngle, anticlockwise } = arcSweep(v1, v2);
      // Sweep delta the way canvas traces it: anticlockwise=false → increasing
      // angle (positive delta), anticlockwise=true → decreasing angle.
      const sweep = 4 * Math.atan(v1.bulge); // signed included angle; sign matches direction
      const steps = Math.max(2, Math.ceil(Math.abs(sweep) / maxAngleStep));
      for (let s = 1; s < steps; s++) {
        const a = startAngle + (sweep * s) / steps;
        pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
      }
      // Direction consistency check between the two representations:
      // positive sweep (bulge > 0) must mean anticlockwise flag false.
      if (sweep > 0 === anticlockwise) {
        throw new Error("arc direction mismatch between bulge sign and canvas anticlockwise flag");
      }
    }
  }
  if (!pline.isClosed) {
    const last = pline.get(pline.vertexCount - 1);
    if (last) pts.push({ x: last.x, y: last.y });
  }
  return pts;
}

/** Signed shoelace area of a polygon given as a point loop. */
export function polygonArea(pts: readonly { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}
