import type { AABB, Polyline } from "cavalier-contours-js";
import type { View } from "../view";

export interface StatRow {
  label: string;
  value: string;
}

/** Callbacks the app shell provides to each scene. */
export interface SceneEnv {
  /** Schedule a canvas redraw (no recompute). */
  requestRender(): void;
  /** Recompute the scene's algorithm output (guarded), then redraw. */
  requestRecompute(): void;
  /** Fit the view to the active scene's extents (e.g. after loading new geometry). */
  requestFit(): void;
  setStats(rows: StatRow[]): void;
  setWarning(message: string | null): void;
}

/** Active pointer drag started by a scene hit test. */
export interface DragHandle {
  /** wx/wy: current pointer world position; dwx/dwy: world delta since last move. */
  move(wx: number, wy: number, dwx: number, dwy: number): void;
  end?(): void;
}

export interface Scene {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  buildControls(root: HTMLElement): void;
  /** Run the algorithm; called guarded by the shell. Must update stats. */
  recompute(): void;
  draw(ctx: CanvasRenderingContext2D, view: View): void;
  extents(): AABB | null;
  hitTest(sx: number, sy: number, view: View): DragHandle | null;
}

/** Pixel radius used for vertex handle hit testing. */
export const VERTEX_HIT_RADIUS_PX = 9;

/**
 * Shared vertex-handle hit test: returns a drag handle that moves the vertex
 * (preserving its bulge) and triggers a guarded recompute per move.
 */
export function hitTestVertexes(
  plines: readonly Polyline[],
  sx: number,
  sy: number,
  view: View,
  env: SceneEnv,
): DragHandle | null {
  for (const pline of plines) {
    for (let i = 0; i < pline.vertexCount; i++) {
      const v = pline.get(i)!;
      const [vx, vy] = view.toScreen(v.x, v.y);
      if (Math.abs(vx - sx) <= VERTEX_HIT_RADIUS_PX && Math.abs(vy - sy) <= VERTEX_HIT_RADIUS_PX) {
        const index = i;
        const target = pline;
        return {
          move(wx, wy) {
            const cur = target.get(index)!;
            target.set(index, wx, wy, cur.bulge);
            env.requestRecompute();
          },
        };
      }
    }
  }
  return null;
}

export function fmt(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}
