/**
 * World ↔ screen transform, pan/zoom, drafting grid, and fit-to-content.
 *
 * World space is y-up (CAD convention); screen space is y-down CSS pixels.
 *   screenX = worldX * scale + ox
 *   screenY = -worldY * scale + oy
 */
import type { AABB } from "cavalier-contours-js";

const MIN_SCALE = 1e-4;
const MAX_SCALE = 1e6;

export class View {
  scale = 10;
  ox = 0;
  oy = 0;
  /** CSS pixel size of the canvas. */
  width = 0;
  height = 0;
  dpr = 1;

  toScreen(wx: number, wy: number): [number, number] {
    return [wx * this.scale + this.ox, -wy * this.scale + this.oy];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.ox) / this.scale, -(sy - this.oy) / this.scale];
  }

  /** Set the canvas transform to draw in world coordinates (y-up). */
  applyWorldTransform(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(
      this.dpr * this.scale,
      0,
      0,
      -this.dpr * this.scale,
      this.dpr * this.ox,
      this.dpr * this.oy,
    );
  }

  /** Set the canvas transform to draw in CSS pixel (screen) coordinates. */
  applyScreenTransform(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  panBy(dxPx: number, dyPx: number): void {
    this.ox += dxPx;
    this.oy += dyPx;
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    const applied = next / this.scale;
    this.ox = sx - (sx - this.ox) * applied;
    this.oy = sy - (sy - this.oy) * applied;
    this.scale = next;
  }

  fit(aabb: AABB, paddingPx = 70): void {
    const w = Math.max(aabb.maxX - aabb.minX, 1e-9);
    const h = Math.max(aabb.maxY - aabb.minY, 1e-9);
    const availW = Math.max(this.width - paddingPx * 2, 40);
    const availH = Math.max(this.height - paddingPx * 2, 40);
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(availW / w, availH / h)));
    const cx = (aabb.minX + aabb.maxX) / 2;
    const cy = (aabb.minY + aabb.maxY) / 2;
    this.ox = this.width / 2 - cx * this.scale;
    this.oy = this.height / 2 + cy * this.scale;
  }
}

/** Merge AABBs (null-tolerant). */
export function mergeAabb(a: AABB | null, b: AABB | null): AABB | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Choose a 1/2/5 · 10^n grid step so that step * scale ≈ targetPx. */
function niceStep(scale: number, targetPx: number): number {
  const raw = targetPx / scale;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / pow;
  const mult = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
  return mult * pow;
}

export interface GridColors {
  minor: string;
  major: string;
  axisX: string;
  axisY: string;
}

/** Draw blueprint grid + axes in screen space. */
export function drawGrid(ctx: CanvasRenderingContext2D, view: View, colors: GridColors): void {
  view.applyScreenTransform(ctx);
  const step = niceStep(view.scale, 34);
  const majorEvery = 5;

  const [wx0, wy1] = view.toWorld(0, 0);
  const [wx1, wy0] = view.toWorld(view.width, view.height);

  ctx.lineWidth = 1;

  const startX = Math.floor(wx0 / step) * step;
  const startY = Math.floor(wy0 / step) * step;

  // minor + major lines
  for (const major of [false, true]) {
    ctx.strokeStyle = major ? colors.major : colors.minor;
    ctx.beginPath();
    for (let x = startX, i = Math.round(startX / step); x <= wx1 + step; x += step, i++) {
      const isMajor = i % majorEvery === 0;
      if (isMajor !== major) continue;
      const [sx] = view.toScreen(x, 0);
      const px = Math.round(sx) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, view.height);
    }
    for (let y = startY, i = Math.round(startY / step); y <= wy1 + step; y += step, i++) {
      const isMajor = i % majorEvery === 0;
      if (isMajor !== major) continue;
      const [, sy] = view.toScreen(0, y);
      const py = Math.round(sy) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(view.width, py);
    }
    ctx.stroke();
  }

  // axes
  const [axS, ayS] = view.toScreen(0, 0);
  ctx.beginPath();
  ctx.strokeStyle = colors.axisY;
  ctx.moveTo(Math.round(axS) + 0.5, 0);
  ctx.lineTo(Math.round(axS) + 0.5, view.height);
  ctx.stroke();
  ctx.beginPath();
  ctx.strokeStyle = colors.axisX;
  ctx.moveTo(0, Math.round(ayS) + 0.5);
  ctx.lineTo(view.width, Math.round(ayS) + 0.5);
  ctx.stroke();
}
