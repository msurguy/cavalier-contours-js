/**
 * Scene 1 — Polyline Offset. Port of the Rust demo's pline_offset_scene with
 * Offset / Raw Offset / Raw Offset Segments modes.
 */
import type { AABB, Polyline, RawPlineOffsetSeg } from "cavalier-contours-js";
import { COLORS } from "../colors";
import { drawRawOffsetSegs, drawVertexHandles, strokePline } from "../render";
import type { View } from "../view";
import { mergeAabb } from "../view";
import {
  computeOffsetStack,
  computeRawOffset,
  computeRawOffsetSegs,
  type OffsetStackEntry,
} from "./compute";
import { offsetSceneDefault } from "./data";
import {
  fmt,
  fmtMs,
  hitTestVertexes,
  type DragHandle,
  type Scene,
  type SceneEnv,
} from "./types";
import { checkbox, controlGroup, legend, segmented, slider } from "../ui";

type Mode = "offset" | "rawOffset" | "rawOffsetSegments";

export class OffsetScene implements Scene {
  readonly id = "offset";
  readonly title = "Polyline Offset";
  readonly blurb =
    "Parallel offset of a closed polyline with arc (bulge) segments. Raw modes expose the algorithm's intermediate stages. Drag the square handles to reshape.";

  private pline = offsetSceneDefault();
  private mode: Mode = "offset";
  private offset = 1.0;
  private repeatCount = 10;
  private handleSelfIntersects = true;
  private showVertexes = true;

  private stack: OffsetStackEntry[] = [];
  private rawOffsetPline: Polyline | null = null;
  private rawSegs: RawPlineOffsetSeg[] = [];

  constructor(private env: SceneEnv) {}

  buildControls(root: HTMLElement): void {
    const modeGroup = controlGroup(root, "algorithm stage");
    segmented<Mode>(
      modeGroup,
      [
        { value: "offset", label: "Offset", hint: "Final trimmed parallel offsets" },
        { value: "rawOffset", label: "Raw", hint: "Raw offset polyline before trimming" },
        { value: "rawOffsetSegments", label: "Raw Segs", hint: "Untrimmed raw offset segments" },
      ],
      this.mode,
      (m) => {
        this.mode = m;
        this.env.requestRecompute();
      },
    );

    const params = controlGroup(root, "parameters");
    slider(params, {
      label: "offset distance",
      min: -20,
      max: 20,
      step: 0.05,
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
      max: 60,
      step: 1,
      value: this.repeatCount,
      format: (v) => v.toFixed(0),
      onInput: (v) => {
        this.repeatCount = v;
        this.env.requestRecompute();
      },
    });
    checkbox(params, "handle self intersects", this.handleSelfIntersects, (v) => {
      this.handleSelfIntersects = v;
      this.env.requestRecompute();
    });
    checkbox(params, "show vertexes", this.showVertexes, (v) => {
      this.showVertexes = v;
      this.env.requestRender();
    });

    const key = controlGroup(root, "key");
    legend(key, [
      [COLORS.src, "input polyline"],
      [COLORS.offset, "offset (same orientation)"],
      [COLORS.reversed, "offset (orientation flipped)"],
      [COLORS.raw, "raw offset intermediate"],
      [COLORS.collapsed, "collapsed arc segment"],
    ]);
  }

  recompute(): void {
    const t0 = performance.now();
    if (this.mode === "offset") {
      this.stack = computeOffsetStack(
        this.pline,
        this.offset,
        this.repeatCount,
        this.handleSelfIntersects,
      );
      this.rawOffsetPline = null;
      this.rawSegs = [];
    } else if (this.mode === "rawOffset") {
      this.rawOffsetPline = computeRawOffset(this.pline, this.offset);
      this.stack = [];
      this.rawSegs = [];
    } else {
      this.rawSegs = computeRawOffsetSegs(this.pline, this.offset);
      this.stack = [];
      this.rawOffsetPline = null;
    }
    const elapsed = performance.now() - t0;

    if (this.mode === "offset") {
      let vtx = 0;
      let area = 0;
      let length = 0;
      for (const { pline } of this.stack) {
        vtx += pline.vertexCount;
        area += Math.abs(pline.area());
        length += pline.pathLength();
      }
      this.env.setStats([
        { label: "input vertexes", value: String(this.pline.vertexCount) },
        { label: "input area", value: fmt(this.pline.area()) },
        { label: "result loops", value: String(this.stack.length) },
        { label: "result vertexes", value: String(vtx) },
        { label: "Σ |result area|", value: fmt(area) },
        { label: "Σ path length", value: fmt(length) },
        { label: "compute", value: fmtMs(elapsed) },
      ]);
    } else if (this.mode === "rawOffset") {
      const raw = this.rawOffsetPline!;
      this.env.setStats([
        { label: "input vertexes", value: String(this.pline.vertexCount) },
        { label: "raw offset vertexes", value: String(raw.vertexCount) },
        { label: "raw path length", value: fmt(raw.vertexCount > 1 ? raw.pathLength() : 0) },
        { label: "compute", value: fmtMs(elapsed) },
      ]);
    } else {
      const collapsed = this.rawSegs.filter((s) => s.collapsedArc).length;
      this.env.setStats([
        { label: "input vertexes", value: String(this.pline.vertexCount) },
        { label: "raw segments", value: String(this.rawSegs.length) },
        { label: "collapsed arcs", value: String(collapsed) },
        { label: "compute", value: fmtMs(elapsed) },
      ]);
    }
  }

  draw(ctx: CanvasRenderingContext2D, view: View): void {
    strokePline(ctx, view, this.pline, { color: COLORS.src, widthPx: 2 });

    if (this.mode === "offset") {
      for (const { pline, sameOrientation } of this.stack) {
        strokePline(ctx, view, pline, {
          color: sameOrientation ? COLORS.offset : COLORS.reversed,
          widthPx: 1.5,
        });
      }
    } else if (this.mode === "rawOffset" && this.rawOffsetPline) {
      strokePline(ctx, view, this.rawOffsetPline, {
        color: COLORS.raw,
        widthPx: 1.5,
        dashPx: [7, 4],
      });
    } else if (this.mode === "rawOffsetSegments") {
      drawRawOffsetSegs(ctx, view, this.rawSegs, COLORS.raw, COLORS.collapsed);
    }

    if (this.showVertexes) {
      drawVertexHandles(ctx, view, [this.pline], COLORS.vertex);
    }
  }

  extents(): AABB | null {
    let box = this.pline.extents();
    for (const { pline } of this.stack) box = mergeAabb(box, pline.extents());
    if (this.rawOffsetPline && this.rawOffsetPline.vertexCount > 1) {
      box = mergeAabb(box, this.rawOffsetPline.extents());
    }
    return box;
  }

  hitTest(sx: number, sy: number, view: View): DragHandle | null {
    return hitTestVertexes([this.pline], sx, sy, view, this.env);
  }
}
