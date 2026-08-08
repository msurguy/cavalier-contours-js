/**
 * Pure, DOM-free compute functions for every scene. These are the exact code
 * paths the interactive scenes run on the main thread, kept importable from
 * Node so `scripts/sanity.mjs` can exercise them headlessly.
 */
import {
  Shape,
  createRawOffsetPolyline,
  createUntrimmedRawOffsetSegs,
  defaultPlineOffsetOptions,
  type BooleanOp,
  type BooleanResult,
  type PlineOffsetOptions,
  type Polyline,
  type RawPlineOffsetSeg,
} from "cavalier-contours-js";

// ---------------------------------------------------------------------------
// Scene 1 — polyline offset (port of build_offset in pline_offset_scene.rs)
// ---------------------------------------------------------------------------

export interface OffsetStackEntry {
  pline: Polyline;
  /** True when the offset loop kept the source polyline's orientation. */
  sameOrientation: boolean;
}

/**
 * Repeatedly parallel-offset `source`, mirroring the Rust demo: offsets whose
 * orientation flips relative to the source are collected but not offset again;
 * same-orientation results seed the next generation, until `maxOffsetCount`
 * generations were produced or everything collapsed.
 */
export function computeOffsetStack(
  source: Polyline,
  offset: number,
  maxOffsetCount: number,
  handleSelfIntersects: boolean,
): OffsetStackEntry[] {
  const options: PlineOffsetOptions = { handleSelfIntersects };
  const posEqualEps = defaultPlineOffsetOptions().posEqualEps;

  // sanitize input like the Rust demo (remove redundant vertexes)
  const pline = source.removeRedundant(posEqualEps) ?? source;
  const orientation = pline.orientation();

  let offsetPlines = pline.parallelOffsetOpt(offset, options);
  const all: OffsetStackEntry[] = [];

  for (let gen = 1; gen < maxOffsetCount; gen++) {
    const same: Polyline[] = [];
    const diff: Polyline[] = [];
    for (const pl of offsetPlines) {
      (pl.orientation() === orientation ? same : diff).push(pl);
    }
    offsetPlines = [];
    for (const pl of same) {
      offsetPlines.push(...pl.parallelOffsetOpt(offset, options));
    }
    for (const pl of same) all.push({ pline: pl, sameOrientation: true });
    for (const pl of diff) all.push({ pline: pl, sameOrientation: false });
    if (offsetPlines.length === 0) break;
  }
  for (const pl of offsetPlines) {
    all.push({ pline: pl, sameOrientation: pl.orientation() === orientation });
  }
  return all;
}

/** Raw (untrimmed, unstitched) offset polyline — the algorithm's intermediate. */
export function computeRawOffset(source: Polyline, offset: number): Polyline {
  return createRawOffsetPolyline(source, offset, defaultPlineOffsetOptions().posEqualEps);
}

/** Individual untrimmed raw offset segments — the very first algorithm stage. */
export function computeRawOffsetSegs(source: Polyline, offset: number): RawPlineOffsetSeg[] {
  return createUntrimmedRawOffsetSegs(source, offset);
}

// ---------------------------------------------------------------------------
// Scene 2 — boolean ops
// ---------------------------------------------------------------------------

export function computeBoolean(
  pline1: Polyline,
  pline2: Polyline,
  op: BooleanOp,
): BooleanResult<Polyline> {
  return pline1.boolean(pline2, op);
}

// ---------------------------------------------------------------------------
// Scene 3 — shape (multi polyline) offset
// (port of build_scene_state in multi_pline_offset_scene.rs)
// ---------------------------------------------------------------------------

export interface ShapeOffsetStack {
  shape: Shape;
  offsetShapes: Shape[];
}

export function computeShapeOffsetStack(
  plines: readonly Polyline[],
  offset: number,
  maxOffsetCount: number,
): ShapeOffsetStack {
  const shape = Shape.fromPlines(plines.map((p) => p.clone()));
  const offsetShapes: Shape[] = [];
  if (maxOffsetCount < 1) return { shape, offsetShapes };

  let curr = shape.parallelOffset(offset);
  while (curr.ccwPlines.length + curr.cwPlines.length > 0) {
    offsetShapes.push(curr);
    if (offsetShapes.length >= maxOffsetCount) break;
    curr = curr.parallelOffset(offset);
  }
  return { shape, offsetShapes };
}

// ---------------------------------------------------------------------------
// Scene 4 — concentric hatch fill (pen plotter use case)
// ---------------------------------------------------------------------------

export interface HatchResult {
  loops: Polyline[];
  totalLength: number;
  exhausted: boolean;
}

/**
 * Repeatedly inward-offset a closed outline at `spacing` (pen width) until the
 * geometry collapses, producing a concentric fill for pen plotting. A positive
 * offset moves left of the curve direction, so "inward" per-loop is `+spacing`
 * for CCW loops and `-spacing` for CW loops.
 */
export function computeHatch(outline: Polyline, spacing: number, maxLoops = 4000): HatchResult {
  const posEqualEps = defaultPlineOffsetOptions().posEqualEps;
  const sanitized = outline.removeRedundant(posEqualEps) ?? outline;
  const loops: Polyline[] = [];
  let totalLength = 0;
  let frontier: Polyline[] = [sanitized];
  let exhausted = true;

  while (frontier.length > 0) {
    const next: Polyline[] = [];
    for (const pl of frontier) {
      const inward = pl.orientation() === "clockwise" ? -spacing : spacing;
      for (const res of pl.parallelOffset(inward)) {
        if (Math.abs(res.area()) > 1e-6) next.push(res);
      }
    }
    for (const pl of next) {
      loops.push(pl);
      totalLength += pl.pathLength();
    }
    if (loops.length >= maxLoops) {
      exhausted = false;
      break;
    }
    frontier = next;
  }
  return { loops, totalLength, exhausted };
}
