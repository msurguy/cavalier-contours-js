/**
 * Scene 5 — SVG Studio. Upload any SVG, pick which paths to operate on
 * (largest/outermost pre-selected), then apply a library effect (parallel
 * Offset or concentric Hatch) or a stylistic preset (Sticker outline-fill,
 * Rainbow per-path fill), and download the result as a clean SVG.
 */
import type { AABB, Polyline } from "cavalier-contours-js";
import { COLORS } from "../colors";
import { fillPlines, strokePline } from "../render";
import type { View } from "../view";
import { mergeAabb } from "../view";
import { computeHatch } from "./compute";
import { fmt, fmtMs, type DragHandle, type Scene, type SceneEnv } from "./types";
import {
  button,
  colorPicker,
  controlGroup,
  fileButton,
  legend,
  note,
  segmented,
  slider,
  virtualList,
  type VirtualListHandle,
} from "../ui";
import { importSvg, type ImportedPath } from "../svg/import";
import { buildSvg, downloadSvg, type SvgLayer } from "../svg/export";
import { SAMPLE_SVG } from "../svg/sample";

type Mode = "offset" | "hatch" | "sticker" | "rainbow";

interface RainbowFill {
  pline: Polyline;
  color: string;
}

export class SvgStudioScene implements Scene {
  readonly id = "svg";
  readonly title = "SVG Studio";
  readonly blurb =
    "Upload any SVG, choose which paths to work on (largest is picked for you), then offset, hatch-fill, or apply a Sticker / Rainbow preset — and download the result as SVG.";

  private imported: ImportedPath[] = [];
  private selected = new Set<string>();
  private mode: Mode = "offset";
  private lastSvgText: string | null = null;
  private docName = "shapes";
  private tolerance = 0.75;

  // parameters
  private offsetAmount = 3;
  private offsetRepeat = 1;
  private hatchSpacing = 1.4;
  private stickerAmount = 4;
  private stickerFill = "#ffffff";
  private rainbowStart = "#ff5d8f";
  private rainbowEnd = "#6fd7ff";
  private rainbowRings = 6;
  private rainbowOffset = 2.5;

  // computed results
  private offsetLoops: Polyline[] = [];
  private hatchLoops: Polyline[] = [];
  private stickerFills: Polyline[] = [];
  private rainbow: RainbowFill[] = [];

  private root: HTMLElement | null = null;
  private pathList: VirtualListHandle | null = null;

  constructor(private env: SceneEnv) {}

  // ------------------------------------------------------------------ controls

  buildControls(root: HTMLElement): void {
    this.root = root;

    const io = controlGroup(root, "source");
    fileButton(io, "Upload SVG", ".svg,image/svg+xml", (file) => void this.loadFile(file));
    button(io, "Load sample", () => this.loadSample());

    const paths = controlGroup(root, `paths (${this.imported.length})`);
    this.pathList = null;
    if (this.imported.length === 0) {
      note(paths, "Upload an SVG or load the sample to begin.");
    } else {
      const bar = document.createElement("div");
      bar.className = "path-actions";
      for (const [text, fn] of [
        ["all", () => this.selectAll()],
        ["largest", () => this.selectLargest()],
        ["none", () => this.selectNone()],
      ] as const) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.addEventListener("click", fn);
        bar.appendChild(b);
      }
      paths.appendChild(bar);

      // Windowed list: a big SVG can have hundreds/thousands of subpaths.
      this.pathList = virtualList(paths, {
        items: this.imported,
        rowHeight: 26,
        maxHeight: 220,
        renderRow: (p, _i, el) => this.renderPathRow(p, el),
      });
    }

    const effect = controlGroup(root, "effect");
    segmented<Mode>(
      effect,
      [
        { value: "offset", label: "Offset", hint: "Parallel offset outline(s)" },
        { value: "hatch", label: "Hatch", hint: "Concentric pen-plotter fill" },
        { value: "sticker", label: "Sticker", hint: "Outset silhouette, filled" },
        { value: "rainbow", label: "Rainbow", hint: "Per-path fill across a color range" },
      ],
      this.mode,
      (m) => {
        this.mode = m;
        this.rebuildControls();
        this.env.requestRecompute();
      },
    );

    const params = controlGroup(root, "parameters");
    slider(params, {
      label: "flatten detail",
      min: 0.1,
      max: 6,
      step: 0.1,
      value: this.tolerance,
      // higher slider = finer detail, so invert to tolerance (smaller = finer)
      format: (v) => `${(6.1 - v).toFixed(1)}`,
      onInput: (v) => {
        this.tolerance = 6.1 - v;
        this.reimport();
        this.rebuildControls();
        this.env.requestRecompute();
      },
    });

    if (this.mode === "offset") {
      slider(params, {
        label: "offset (+ outward)",
        min: -20,
        max: 20,
        step: 0.1,
        value: this.offsetAmount,
        format: (v) => v.toFixed(1),
        onInput: (v) => {
          this.offsetAmount = v;
          this.env.requestRecompute();
        },
      });
      slider(params, {
        label: "repeat offsets",
        min: 1,
        max: 20,
        step: 1,
        value: this.offsetRepeat,
        format: (v) => v.toFixed(0),
        onInput: (v) => {
          this.offsetRepeat = v;
          this.env.requestRecompute();
        },
      });
    } else if (this.mode === "hatch") {
      slider(params, {
        label: "pen width / spacing",
        min: 0.2,
        max: 8,
        step: 0.05,
        value: this.hatchSpacing,
        format: (v) => v.toFixed(2),
        onInput: (v) => {
          this.hatchSpacing = v;
          this.env.requestRecompute();
        },
      });
    } else if (this.mode === "sticker") {
      slider(params, {
        label: "outline width",
        min: 0.5,
        max: 16,
        step: 0.1,
        value: this.stickerAmount,
        format: (v) => v.toFixed(1),
        onInput: (v) => {
          this.stickerAmount = v;
          this.env.requestRecompute();
        },
      });
      colorPicker(params, "fill color", this.stickerFill, (v) => {
        this.stickerFill = v;
        this.env.requestRender();
      });
    } else {
      slider(params, {
        label: "rings / layers",
        min: 1,
        max: 40,
        step: 1,
        value: this.rainbowRings,
        format: (v) => v.toFixed(0),
        onInput: (v) => {
          this.rainbowRings = v;
          this.env.requestRecompute();
        },
      });
      slider(params, {
        label: "ring offset",
        min: 0.5,
        max: 16,
        step: 0.5,
        value: this.rainbowOffset,
        format: (v) => v.toFixed(1),
        onInput: (v) => {
          this.rainbowOffset = v;
          this.env.requestRecompute();
        },
      });
      colorPicker(params, "range start", this.rainbowStart, (v) => {
        this.rainbowStart = v;
        this.env.requestRecompute();
      });
      colorPicker(params, "range end", this.rainbowEnd, (v) => {
        this.rainbowEnd = v;
        this.env.requestRecompute();
      });
    }

    const out = controlGroup(root, "export");
    button(out, "Download SVG", () => this.download());

    const key = controlGroup(root, "key");
    legend(key, this.legendFor(this.mode));
  }

  private legendFor(mode: Mode): [string, string][] {
    const base: [string, string] = [COLORS.src, "selected path"];
    const dim: [string, string] = [COLORS.srcDim, "unselected path"];
    if (mode === "offset") return [base, dim, [COLORS.offset, "offset result"]];
    if (mode === "hatch") return [base, dim, [COLORS.hatch, "concentric fill"]];
    if (mode === "sticker") return [[this.stickerFill, "sticker fill"], base];
    return [
      [this.rainbowStart, "range start"],
      [this.rainbowEnd, "range end"],
    ];
  }

  /** Render one windowed path row (recycled by the virtual list). */
  private renderPathRow(p: ImportedPath, el: HTMLElement): void {
    const w = Math.round(p.bbox.maxX - p.bbox.minX);
    const h = Math.round(p.bbox.maxY - p.bbox.minY);
    const label = document.createElement("label");
    label.className = "path-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.selected.has(p.id);
    input.addEventListener("change", () => {
      if (input.checked) this.selected.add(p.id);
      else this.selected.delete(p.id);
      this.env.requestRecompute();
    });
    const box = document.createElement("span");
    box.className = "check-box";
    const text = document.createElement("span");
    text.className = "path-row-label";
    text.textContent = `${p.label} · ${w}×${h}${p.closed ? "" : " · open"}`;
    label.append(input, box, text);
    el.appendChild(label);
  }

  private rebuildControls(): void {
    if (!this.root) return;
    this.root.replaceChildren();
    this.buildControls(this.root);
  }

  /** Sync visible checkboxes to the selection set without a full rebuild (keeps scroll). */
  private afterSelectionChange(): void {
    if (this.pathList) this.pathList.refresh();
    else this.rebuildControls();
    this.env.requestRecompute();
  }

  // -------------------------------------------------------------------- import

  private async loadFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      this.docName = file.name.replace(/\.svg$/i, "") || "shapes";
      this.setSvg(text);
    } catch {
      this.env.setWarning("could not read file");
    }
  }

  private loadSample(): void {
    this.docName = "sample";
    this.setSvg(SAMPLE_SVG);
  }

  /** Set a new SVG source: import, auto-select the largest path, refit. */
  private setSvg(text: string): void {
    this.lastSvgText = text;
    try {
      this.imported = importSvg(text, { tolerance: this.tolerance });
    } catch {
      this.imported = [];
      this.env.setWarning("could not parse SVG");
    }
    this.selected.clear();
    this.selectLargest(false);
    this.rebuildControls();
    this.env.requestRecompute();
    this.env.requestFit();
  }

  /** Re-flatten the current SVG at the current tolerance, preserving selection. */
  private reimport(): void {
    if (!this.lastSvgText) return;
    const prev = new Set(this.selected);
    try {
      this.imported = importSvg(this.lastSvgText, { tolerance: this.tolerance });
    } catch {
      return;
    }
    this.selected = new Set([...prev].filter((id) => this.imported.some((p) => p.id === id)));
  }

  private selectLargest(recompute = true): void {
    let best: ImportedPath | null = null;
    for (const p of this.imported) {
      if (!best || p.bboxArea > best.bboxArea) best = p;
    }
    this.selected.clear();
    if (best) this.selected.add(best.id);
    if (recompute) this.afterSelectionChange();
  }

  private selectAll(): void {
    this.selected = new Set(this.imported.map((p) => p.id));
    this.afterSelectionChange();
  }

  private selectNone(): void {
    this.selected.clear();
    this.afterSelectionChange();
  }

  private selectedPaths(): ImportedPath[] {
    return this.imported.filter((p) => this.selected.has(p.id));
  }

  // ------------------------------------------------------------------- compute

  recompute(): void {
    this.offsetLoops = [];
    this.hatchLoops = [];
    this.stickerFills = [];
    this.rainbow = [];

    const sel = this.selectedPaths();
    const t0 = performance.now();

    if (this.mode === "offset") {
      for (const p of sel) {
        if (!p.closed) continue;
        this.offsetLoops.push(...this.repeatedOffset(p.pline, this.offsetAmount, this.offsetRepeat));
      }
    } else if (this.mode === "hatch") {
      for (const p of sel) {
        if (!p.closed) continue;
        this.hatchLoops.push(...computeHatch(p.pline, this.hatchSpacing).loops);
      }
    } else if (this.mode === "sticker") {
      for (const p of sel) {
        if (!p.closed) continue;
        this.stickerFills.push(...this.repeatedOffset(p.pline, this.stickerAmount, 1));
      }
    } else {
      // Rainbow: for each selected path emit `rings` concentric offset layers,
      // then color the whole ordered set across the range. One path → concentric
      // bands; many paths → a gradient sweeping across everything.
      const rings = Math.max(1, Math.round(this.rainbowRings));
      const CAP = 5000;
      const entries: Polyline[] = [];
      for (const p of sel) {
        if (!p.closed) continue;
        for (const layer of this.concentricLayers(p.pline, rings, this.rainbowOffset)) {
          entries.push(layer);
          if (entries.length >= CAP) break;
        }
        if (entries.length >= CAP) break;
      }
      const total = entries.length;
      entries.forEach((pline, i) => {
        this.rainbow.push({
          pline,
          color: lerpHex(this.rainbowStart, this.rainbowEnd, total <= 1 ? 0 : i / (total - 1)),
        });
      });
    }

    const elapsed = performance.now() - t0;
    this.setStats(elapsed);
  }

  /**
   * Repeatedly parallel-offset a closed polyline. A positive `amount` grows
   * outward regardless of orientation: `+offset` moves left of the curve
   * direction (inward for CCW in y-up world), so outward = negate for CCW.
   */
  private repeatedOffset(pline: Polyline, amount: number, repeat: number): Polyline[] {
    if (amount === 0) return [];
    const signed = pline.orientation() === "counterClockwise" ? -amount : amount;
    const loops: Polyline[] = [];
    let frontier: Polyline[] = [pline];
    for (let r = 0; r < repeat; r++) {
      const next: Polyline[] = [];
      for (const f of frontier) {
        for (const res of f.parallelOffset(signed)) {
          if (Math.abs(res.area()) > 1e-6) next.push(res);
        }
      }
      if (next.length === 0) break;
      loops.push(...next);
      frontier = next;
    }
    return loops;
  }

  /**
   * Concentric layers of a closed polyline: the original plus up to `rings-1`
   * successive inward offsets at `spacing`, returned outermost-first so filling
   * them in order paints inner bands over outer ones.
   */
  private concentricLayers(pline: Polyline, rings: number, spacing: number): Polyline[] {
    const layers: Polyline[] = [pline];
    if (rings <= 1 || spacing <= 0) return layers;
    // +offset is inward for CCW in the y-up world (mirrors computeHatch).
    const inward = pline.orientation() === "clockwise" ? -spacing : spacing;
    let frontier: Polyline[] = [pline];
    while (layers.length < rings) {
      const next: Polyline[] = [];
      for (const f of frontier) {
        for (const res of f.parallelOffset(inward)) {
          if (Math.abs(res.area()) > 1e-6) next.push(res);
        }
      }
      if (next.length === 0) break;
      for (const pl of next) {
        if (layers.length < rings) layers.push(pl);
      }
      frontier = next;
    }
    return layers;
  }

  private setStats(elapsed: number): void {
    const rows = [
      { label: "paths in SVG", value: String(this.imported.length) },
      { label: "selected", value: String(this.selected.size) },
    ];
    let resultLoops = 0;
    let length = 0;
    if (this.mode === "offset") {
      resultLoops = this.offsetLoops.length;
      for (const p of this.offsetLoops) length += p.pathLength();
    } else if (this.mode === "hatch") {
      resultLoops = this.hatchLoops.length;
      for (const p of this.hatchLoops) length += p.pathLength();
    } else if (this.mode === "sticker") {
      resultLoops = this.stickerFills.length;
      for (const p of this.stickerFills) length += p.pathLength();
    } else {
      resultLoops = this.rainbow.length;
      for (const r of this.rainbow) length += r.pline.pathLength();
    }
    rows.push({ label: "result loops", value: String(resultLoops) });
    rows.push({ label: "Σ result length", value: fmt(length) });
    rows.push({ label: "compute", value: fmtMs(elapsed) });
    this.env.setStats(rows);
  }

  // ---------------------------------------------------------------------- draw

  draw(ctx: CanvasRenderingContext2D, view: View): void {
    const fillsFirst = this.mode === "sticker" || this.mode === "rainbow";
    if (fillsFirst) this.drawFills(ctx, view);
    this.drawBaseArt(ctx, view, fillsFirst);
    if (!fillsFirst) this.drawOverlay(ctx, view);
  }

  private drawFills(ctx: CanvasRenderingContext2D, view: View): void {
    if (this.mode === "sticker") {
      fillPlines(ctx, view, this.stickerFills, this.stickerFill, 1, "nonzero");
    } else {
      for (const { pline, color } of this.rainbow) {
        fillPlines(ctx, view, [pline], color, 1, "nonzero");
      }
    }
  }

  private drawBaseArt(ctx: CanvasRenderingContext2D, view: View, subdued: boolean): void {
    for (const p of this.imported) {
      const isSel = this.selected.has(p.id);
      strokePline(ctx, view, p.pline, {
        color: isSel ? COLORS.src : COLORS.srcDim,
        widthPx: subdued ? 1 : isSel ? 2 : 1.25,
        alpha: subdued ? 0.75 : 1,
      });
    }
  }

  private drawOverlay(ctx: CanvasRenderingContext2D, view: View): void {
    if (this.mode === "offset") {
      for (const loop of this.offsetLoops) {
        strokePline(ctx, view, loop, { color: COLORS.offset, widthPx: 1.5 });
      }
    } else if (this.mode === "hatch") {
      for (const loop of this.hatchLoops) {
        strokePline(ctx, view, loop, { color: COLORS.hatch, widthPx: 1.25, alpha: 0.9 });
      }
    }
  }

  // ------------------------------------------------------------------- extents

  extents(): AABB | null {
    let box: AABB | null = null;
    for (const p of this.imported) box = mergeAabb(box, p.bbox);
    for (const p of this.offsetLoops) box = mergeAabb(box, p.extents());
    for (const p of this.hatchLoops) box = mergeAabb(box, p.extents());
    for (const p of this.stickerFills) box = mergeAabb(box, p.extents());
    return box;
  }

  hitTest(_sx: number, _sy: number, _view: View): DragHandle | null {
    return null;
  }

  // -------------------------------------------------------------------- export

  private download(): void {
    const layers = this.exportLayers();
    const box = this.exportBox(layers);
    if (!box) {
      this.env.setWarning("nothing to export — select at least one path");
      return;
    }
    const diag = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
    const errDist = Math.max(diag * 0.0015, 1e-3);
    const svg = buildSvg(layers, box, errDist);
    downloadSvg(svg, `${this.docName}-${this.mode}`);
  }

  private exportLayers(): SvgLayer[] {
    const sel = this.selectedPaths();
    const selectedPlines = sel.map((p) => p.pline);
    if (this.mode === "offset") {
      return [
        { plines: selectedPlines, stroke: "#8a97a6", strokeWidth: 0.75 },
        { plines: this.offsetLoops, stroke: "#111418", strokeWidth: 1 },
      ];
    }
    if (this.mode === "hatch") {
      return [
        { plines: selectedPlines, stroke: "#111418", strokeWidth: 1 },
        { plines: this.hatchLoops, stroke: "#d9822b", strokeWidth: 0.6 },
      ];
    }
    if (this.mode === "sticker") {
      // Sticker silhouette FIRST = bottom of the paint order (under the art).
      return [
        { plines: this.stickerFills, fill: this.stickerFill, fillRule: "nonzero" },
        { plines: selectedPlines, stroke: "#111418", strokeWidth: 1 },
      ];
    }
    // rainbow: one filled layer per path, plus unselected outlines
    const rainbowLayers: SvgLayer[] = this.rainbow.map((r) => ({
      plines: [r.pline],
      fill: r.color,
      fillRule: "nonzero" as const,
    }));
    return rainbowLayers;
  }

  private exportBox(layers: readonly SvgLayer[]): AABB | null {
    let box: AABB | null = null;
    for (const layer of layers) {
      for (const p of layer.plines) box = mergeAabb(box, p.extents());
    }
    return box;
  }
}

// ---------------------------------------------------------------------------
// color helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
  const to2 = (v: number) => v.toString(16).padStart(2, "0");
  return `#${to2(mix(ar, br))}${to2(mix(ag, bg))}${to2(mix(ab, bb))}`;
}
