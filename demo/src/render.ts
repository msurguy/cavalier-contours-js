/**
 * Arc-aware canvas rendering for polylines. Paths are built in world
 * coordinates and stroked/filled under the view's world transform, with line
 * widths converted from pixels to world units.
 */
import type { Polyline, RawPlineOffsetSeg, PlineVertex } from "cavalier-contours-js";
import { LINE_BULGE_EPS, arcSweep, iterSegments } from "./geom";
import type { View } from "./view";

function segTo(path: Path2D, v1: PlineVertex, v2: PlineVertex): void {
  if (Math.abs(v1.bulge) < LINE_BULGE_EPS) {
    path.lineTo(v2.x, v2.y);
    return;
  }
  const { cx, cy, radius, startAngle, endAngle, anticlockwise } = arcSweep(v1, v2);
  path.arc(cx, cy, radius, startAngle, endAngle, anticlockwise);
}

/** Append a polyline as one subpath of `path` (world coordinates). */
export function addPlineToPath(path: Path2D, pline: Polyline): void {
  const n = pline.vertexCount;
  if (n === 0) return;
  const first = pline.get(0)!;
  path.moveTo(first.x, first.y);
  if (n === 1) return;
  for (const [v1, v2] of iterSegments(pline)) segTo(path, v1, v2);
  if (pline.isClosed) path.closePath();
}

export function plinePath(pline: Polyline): Path2D {
  const path = new Path2D();
  addPlineToPath(path, pline);
  return path;
}

export interface StrokeStyle {
  color: string;
  widthPx: number;
  dashPx?: number[];
  alpha?: number;
}

export function strokeWorldPath(
  ctx: CanvasRenderingContext2D,
  view: View,
  path: Path2D,
  style: StrokeStyle,
): void {
  view.applyWorldTransform(ctx);
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.widthPx / view.scale;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.setLineDash(style.dashPx ? style.dashPx.map((d) => d / view.scale) : []);
  ctx.stroke(path);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

export function strokePline(
  ctx: CanvasRenderingContext2D,
  view: View,
  pline: Polyline,
  style: StrokeStyle,
): void {
  strokeWorldPath(ctx, view, plinePath(pline), style);
}

/**
 * Fill a set of closed polylines as one even-odd compound path — holes (e.g.
 * boolean negPlines) are punched out automatically.
 */
export function fillPlines(
  ctx: CanvasRenderingContext2D,
  view: View,
  plines: readonly Polyline[],
  fillStyle: string,
  alpha = 1,
  rule: CanvasFillRule = "evenodd",
): void {
  if (plines.length === 0) return;
  const path = new Path2D();
  for (const pl of plines) addPlineToPath(path, pl);
  view.applyWorldTransform(ctx);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fillStyle;
  ctx.fill(path, rule);
  ctx.globalAlpha = 1;
}

/** Draw square drafting-style vertex handles (constant screen size). */
export function drawVertexHandles(
  ctx: CanvasRenderingContext2D,
  view: View,
  plines: readonly Polyline[],
  color: string,
  sizePx = 7,
): void {
  view.applyScreenTransform(ctx);
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = color;
  ctx.fillStyle = "rgba(8, 16, 26, 0.85)";
  const h = sizePx / 2;
  for (const pline of plines) {
    for (let i = 0; i < pline.vertexCount; i++) {
      const v = pline.get(i)!;
      const [sx, sy] = view.toScreen(v.x, v.y);
      ctx.beginPath();
      ctx.rect(sx - h, sy - h, sizePx, sizePx);
      ctx.fill();
      ctx.stroke();
    }
  }
}

/** Render untrimmed raw offset segments; collapsed arcs get the alert color. */
export function drawRawOffsetSegs(
  ctx: CanvasRenderingContext2D,
  view: View,
  segs: readonly RawPlineOffsetSeg[],
  color: string,
  collapsedColor: string,
): void {
  for (const seg of segs) {
    const path = new Path2D();
    path.moveTo(seg.v1.x, seg.v1.y);
    segTo(path, seg.v1, seg.v2);
    strokeWorldPath(ctx, view, path, {
      color: seg.collapsedArc ? collapsedColor : color,
      widthPx: 1.5,
      dashPx: seg.collapsedArc ? [5, 4] : undefined,
    });
  }
  // endpoint ticks in screen space
  view.applyScreenTransform(ctx);
  for (const seg of segs) {
    ctx.fillStyle = seg.collapsedArc ? collapsedColor : color;
    for (const v of [seg.v1, seg.v2]) {
      const [sx, sy] = view.toScreen(v.x, v.y);
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
