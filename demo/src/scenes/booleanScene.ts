/**
 * Scene 2 — Boolean Ops. Two overlapping arc-heavy polylines; the second is
 * draggable as a whole (grab anywhere on its path) so the boolean result
 * updates live. Data from the Rust demo's pline_boolean_scene.
 */
import { Vector2, type AABB, type BooleanOp, type BooleanResult, type Polyline } from "cavalier-contours-js";
import { COLORS } from "../colors";
import { drawVertexHandles, fillPlines, strokePline } from "../render";
import type { View } from "../view";
import { mergeAabb } from "../view";
import { computeBoolean } from "./compute";
import { booleanSceneDefaults } from "./data";
import {
  fmt,
  fmtMs,
  hitTestVertexes,
  type DragHandle,
  type Scene,
  type SceneEnv,
} from "./types";
import { checkbox, controlGroup, legend, segmented } from "../ui";

const PATH_HIT_TOLERANCE_PX = 8;

export class BooleanScene implements Scene {
  readonly id = "boolean";
  readonly title = "Boolean Ops";
  readonly blurb =
    "Union / intersection / difference / XOR between two closed polylines with arcs. Drag the green polyline anywhere on its path to slide it; drag handles to reshape.";

  private plineA: Polyline;
  private plineB: Polyline;
  private op: BooleanOp = "or";
  private showVertexes = true;
  private result: BooleanResult<Polyline> | null = null;

  constructor(private env: SceneEnv) {
    [this.plineA, this.plineB] = booleanSceneDefaults();
  }

  buildControls(root: HTMLElement): void {
    const opGroup = controlGroup(root, "operation");
    segmented<BooleanOp>(
      opGroup,
      [
        { value: "or", label: "Union", hint: 'boolean "or"' },
        { value: "and", label: "Intersect", hint: 'boolean "and"' },
        { value: "not", label: "Diff", hint: 'boolean "not" (A − B)' },
        { value: "xor", label: "XOR", hint: 'boolean "xor"' },
      ],
      this.op,
      (op) => {
        this.op = op;
        this.env.requestRecompute();
      },
    );

    const display = controlGroup(root, "display");
    checkbox(display, "show vertexes", this.showVertexes, (v) => {
      this.showVertexes = v;
      this.env.requestRender();
    });

    const key = controlGroup(root, "key");
    legend(key, [
      [COLORS.src, "input A"],
      [COLORS.plineB, "input B (draggable)"],
      [COLORS.resultPos, "result boundary"],
      [COLORS.resultNeg, "result hole"],
    ]);
  }

  recompute(): void {
    const t0 = performance.now();
    this.result = computeBoolean(this.plineA, this.plineB, this.op);
    const elapsed = performance.now() - t0;

    const res = this.result;
    let area = 0;
    let vtx = 0;
    for (const { pline } of res.posPlines) {
      area += Math.abs(pline.area());
      vtx += pline.vertexCount;
    }
    for (const { pline } of res.negPlines) {
      area -= Math.abs(pline.area());
      vtx += pline.vertexCount;
    }
    this.env.setStats([
      { label: "input vertexes", value: `${this.plineA.vertexCount} + ${this.plineB.vertexCount}` },
      { label: "result info", value: res.resultInfo },
      { label: "pos plines", value: String(res.posPlines.length) },
      { label: "neg plines (holes)", value: String(res.negPlines.length) },
      { label: "result vertexes", value: String(vtx) },
      { label: "net area", value: fmt(area) },
      { label: "compute", value: fmtMs(elapsed) },
    ]);
  }

  draw(ctx: CanvasRenderingContext2D, view: View): void {
    // dimmed inputs
    strokePline(ctx, view, this.plineA, { color: COLORS.srcDim, widthPx: 1.5 });
    strokePline(ctx, view, this.plineB, { color: COLORS.plineBDim, widthPx: 1.5 });

    if (this.result) {
      const all = [
        ...this.result.posPlines.map((r) => r.pline),
        ...this.result.negPlines.map((r) => r.pline),
      ];
      fillPlines(ctx, view, all, COLORS.resultFill);
      for (const { pline } of this.result.posPlines) {
        strokePline(ctx, view, pline, { color: COLORS.resultPos, widthPx: 2 });
      }
      for (const { pline } of this.result.negPlines) {
        strokePline(ctx, view, pline, { color: COLORS.resultNeg, widthPx: 2, dashPx: [6, 4] });
      }
    }

    if (this.showVertexes) {
      drawVertexHandles(ctx, view, [this.plineA], COLORS.src);
      drawVertexHandles(ctx, view, [this.plineB], COLORS.plineB);
    }
  }

  extents(): AABB | null {
    return mergeAabb(this.plineA.extents(), this.plineB.extents());
  }

  hitTest(sx: number, sy: number, view: View): DragHandle | null {
    // vertex handles take priority
    const vertexHit = this.showVertexes
      ? hitTestVertexes([this.plineA, this.plineB], sx, sy, view, this.env)
      : null;
    if (vertexHit) return vertexHit;

    // whole-polyline drag: hit anywhere on pline B's path
    const [wx, wy] = view.toWorld(sx, sy);
    const closest = this.plineB.closestPoint(new Vector2(wx, wy), 1e-5);
    if (closest && closest.distance * view.scale <= PATH_HIT_TOLERANCE_PX) {
      return {
        move: (_wx, _wy, dwx, dwy) => {
          this.plineB.translateMut(dwx, dwy);
          this.env.requestRecompute();
        },
      };
    }
    return null;
  }
}
