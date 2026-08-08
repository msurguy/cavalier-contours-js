/**
 * Scene 4 — Hatch Fill. Practical pen-plotter use case: repeatedly
 * inward-offset a closed outline at pen-width spacing until the geometry
 * collapses, yielding a concentric fill.
 */
import type { AABB, Polyline } from "cavalier-contours-js";
import { COLORS } from "../colors";
import { drawVertexHandles, strokePline } from "../render";
import type { View } from "../view";
import { computeHatch } from "./compute";
import { hatchSceneDefault } from "./data";
import {
  fmt,
  fmtMs,
  hitTestVertexes,
  type DragHandle,
  type Scene,
  type SceneEnv,
} from "./types";
import { checkbox, controlGroup, legend, slider } from "../ui";

export class HatchScene implements Scene {
  readonly id = "hatch";
  readonly title = "Hatch Fill";
  readonly blurb =
    "Concentric fill for pen plotting: the outline is inward-offset at pen-width spacing until exhausted. Every amber loop is one pen pass. Drag handles to reshape.";

  private outline: Polyline = hatchSceneDefault();
  private spacing = 0.6;
  private showVertexes = true;
  private penWidthPreview = false;
  private loops: Polyline[] = [];
  private totalLength = 0;

  constructor(private env: SceneEnv) {}

  buildControls(root: HTMLElement): void {
    const params = controlGroup(root, "parameters");
    slider(params, {
      label: "pen width / spacing",
      min: 0.15,
      max: 4,
      step: 0.05,
      value: this.spacing,
      format: (v) => v.toFixed(2),
      onInput: (v) => {
        this.spacing = v;
        this.env.requestRecompute();
      },
    });
    checkbox(params, "preview pen stroke width", this.penWidthPreview, (v) => {
      this.penWidthPreview = v;
      this.env.requestRender();
    });
    checkbox(params, "show vertexes", this.showVertexes, (v) => {
      this.showVertexes = v;
      this.env.requestRender();
    });

    const key = controlGroup(root, "key");
    legend(key, [
      [COLORS.src, "outline (pen pass 0)"],
      [COLORS.hatch, "concentric fill passes"],
    ]);
  }

  recompute(): void {
    const t0 = performance.now();
    const result = computeHatch(this.outline, this.spacing);
    const elapsed = performance.now() - t0;
    this.loops = result.loops;
    this.totalLength = result.totalLength;

    const outlineLength = this.outline.pathLength();
    this.env.setStats([
      { label: "outline vertexes", value: String(this.outline.vertexCount) },
      { label: "fill loops", value: String(this.loops.length + 1) },
      { label: "outline length", value: fmt(outlineLength) },
      { label: "Σ pen travel", value: fmt(this.totalLength + outlineLength) },
      { label: "fill area", value: fmt(Math.abs(this.outline.area())) },
      { label: "compute", value: fmtMs(elapsed) },
    ]);
  }

  draw(ctx: CanvasRenderingContext2D, view: View): void {
    // pen-width strokes give a plotted-ink preview; hairline otherwise
    const penPx = this.penWidthPreview ? Math.max(1, this.spacing * view.scale) : 1.25;
    for (const loop of this.loops) {
      strokePline(ctx, view, loop, {
        color: COLORS.hatch,
        widthPx: penPx,
        alpha: this.penWidthPreview ? 0.55 : 0.9,
      });
    }
    strokePline(ctx, view, this.outline, { color: COLORS.src, widthPx: 2 });
    if (this.showVertexes) {
      drawVertexHandles(ctx, view, [this.outline], COLORS.vertex);
    }
  }

  extents(): AABB | null {
    return this.outline.extents();
  }

  hitTest(sx: number, sy: number, view: View): DragHandle | null {
    return hitTestVertexes([this.outline], sx, sy, view, this.env);
  }
}
