/**
 * Scene 3 — Shape Offset. Multi-polyline shape (outer boundary + holes) offset
 * with hole/island relationships maintained. Data from the Rust demo's
 * multi_pline_offset_scene.
 */
import type { AABB, Polyline, Shape } from "cavalier-contours-js";
import { COLORS } from "../colors";
import { drawVertexHandles, strokePline } from "../render";
import type { View } from "../view";
import { mergeAabb } from "../view";
import { computeShapeOffsetStack } from "./compute";
import { shapeSceneDefaults } from "./data";
import {
  fmt,
  fmtMs,
  hitTestVertexes,
  type DragHandle,
  type Scene,
  type SceneEnv,
} from "./types";
import { checkbox, controlGroup, legend, slider } from "../ui";

export class ShapeScene implements Scene {
  readonly id = "shape";
  readonly title = "Shape Offset";
  readonly blurb =
    "A shape of one outer boundary + four holes offset as a unit — holes shrink and collapse as the offset marches inward. Drag any handle to reshape.";

  private plines: Polyline[] = shapeSceneDefaults();
  private offset = 4.0;
  private repeatCount = 25;
  private showVertexes = true;
  private offsetShapes: Shape[] = [];

  constructor(private env: SceneEnv) {}

  buildControls(root: HTMLElement): void {
    const params = controlGroup(root, "parameters");
    slider(params, {
      label: "offset distance",
      min: -30,
      max: 30,
      step: 0.25,
      value: this.offset,
      format: (v) => v.toFixed(2),
      onInput: (v) => {
        this.offset = v;
        this.env.requestRecompute();
      },
    });
    slider(params, {
      label: "repeat offsets",
      min: 1,
      max: 80,
      step: 1,
      value: this.repeatCount,
      format: (v) => v.toFixed(0),
      onInput: (v) => {
        this.repeatCount = v;
        this.env.requestRecompute();
      },
    });
    checkbox(params, "show vertexes", this.showVertexes, (v) => {
      this.showVertexes = v;
      this.env.requestRender();
    });

    const key = controlGroup(root, "key");
    legend(key, [
      [COLORS.src, "input shape (boundary + holes)"],
      [COLORS.offset, "offset boundaries (ccw)"],
      [COLORS.reversed, "offset holes (cw)"],
    ]);
  }

  recompute(): void {
    const t0 = performance.now();
    const { offsetShapes } = computeShapeOffsetStack(this.plines, this.offset, this.repeatCount);
    this.offsetShapes = offsetShapes;
    const elapsed = performance.now() - t0;

    let loops = 0;
    let vtx = 0;
    let length = 0;
    for (const shape of offsetShapes) {
      for (const ip of [...shape.ccwPlines, ...shape.cwPlines]) {
        loops++;
        vtx += ip.polyline.vertexCount;
        length += ip.polyline.pathLength();
      }
    }
    const inputVtx = this.plines.reduce((n, p) => n + p.vertexCount, 0);
    this.env.setStats([
      { label: "input plines", value: `1 + ${this.plines.length - 1} holes` },
      { label: "input vertexes", value: String(inputVtx) },
      { label: "offset generations", value: String(this.offsetShapes.length) },
      { label: "result loops", value: String(loops) },
      { label: "result vertexes", value: String(vtx) },
      { label: "Σ path length", value: fmt(length) },
      { label: "compute", value: fmtMs(elapsed) },
    ]);
  }

  draw(ctx: CanvasRenderingContext2D, view: View): void {
    for (const pline of this.plines) {
      strokePline(ctx, view, pline, { color: COLORS.src, widthPx: 2 });
    }
    for (const shape of this.offsetShapes) {
      for (const ip of shape.ccwPlines) {
        strokePline(ctx, view, ip.polyline, { color: COLORS.offset, widthPx: 1.25 });
      }
      for (const ip of shape.cwPlines) {
        strokePline(ctx, view, ip.polyline, { color: COLORS.reversed, widthPx: 1.25 });
      }
    }
    if (this.showVertexes) {
      drawVertexHandles(ctx, view, this.plines, COLORS.vertex);
    }
  }

  extents(): AABB | null {
    let box: AABB | null = null;
    for (const pline of this.plines) box = mergeAabb(box, pline.extents());
    // outward offsets extend beyond the inputs
    for (const shape of this.offsetShapes) {
      for (const ip of [...shape.ccwPlines, ...shape.cwPlines]) {
        box = mergeAabb(box, ip.polyline.extents());
      }
    }
    return box;
  }

  hitTest(sx: number, sy: number, view: View): DragHandle | null {
    return hitTestVertexes(this.plines, sx, sy, view, this.env);
  }
}
