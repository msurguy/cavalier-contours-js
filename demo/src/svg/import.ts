/**
 * SVG import: turn an uploaded SVG document into world-space polylines the
 * library can offset/hatch. Every basic shape is converted to a `<path>` via
 * svg-path-commander, then each path is flattened to dense line segments using
 * native SVG geometry (`getTotalLength` / `getPointAtLength`), with each sample
 * mapped through the element's cumulative transform (`getCTM`). Curves become
 * bulge-0 vertexes — the library only handles lines + circular arcs.
 *
 * DOM-dependent (needs a live document): this module is browser-only.
 *
 * Coordinate note: SVG user space is y-down; the demo world is y-up. We negate y
 * on import so uploaded art appears upright (see `../view`). Export flips back.
 */
import SVGPathCommander from "svg-path-commander";
import { plineClosed, plineOpen, type AABB, type Polyline } from "cavalier-contours-js";

export interface ImportedPath {
  /** Stable id derived from enumeration order (same SVG → same ids). */
  id: string;
  label: string;
  pline: Polyline;
  bbox: AABB;
  closed: boolean;
  /** Bounding-box area, used to pick the largest/outermost path by default. */
  bboxArea: number;
}

export interface ImportOptions {
  /** Sampling step in SVG user units; smaller = finer flattening. */
  tolerance?: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const SHAPE_TAGS = ["rect", "circle", "ellipse", "line", "polyline", "polygon"] as const;
const MAX_SAMPLES = 4000;
const MIN_SAMPLES = 16;
const POS_EPS = 1e-4;

interface Pt {
  x: number;
  y: number;
}

interface SubPath {
  d: string;
  /** True when the subpath has an explicit `Z`; geometric closure is detected later. */
  closedHint: boolean;
}

/** Parse an SVG string into world-space polylines. Throws on unparseable SVG. */
export function importSvg(svgText: string, opts: ImportOptions = {}): ImportedPath[] {
  const tolerance = Math.max(0.02, opts.tolerance ?? 0.75);

  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.nodeName !== "svg") {
    throw new Error("could not parse SVG");
  }

  // Native geometry APIs require the element to live in a rendered document.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:absolute;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;";
  const svg = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
  host.appendChild(svg);
  document.body.appendChild(host);

  try {
    // Convert every basic shape into a <path> in-place (keeps transform + DOM position).
    for (const tag of SHAPE_TAGS) {
      for (const el of Array.from(svg.querySelectorAll(tag))) {
        try {
          SVGPathCommander.shapeToPath(
            el as unknown as Parameters<typeof SVGPathCommander.shapeToPath>[0],
            true,
            parsed,
          );
        } catch {
          /* leave unconvertible shapes out */
        }
      }
    }

    const out: ImportedPath[] = [];
    let idx = 0;
    for (const pathEl of Array.from(svg.querySelectorAll("path"))) {
      const d = pathEl.getAttribute("d");
      if (!d) continue;
      const ctm = pathEl.getCTM();
      for (const sub of splitSubpaths(d)) {
        const pts = flattenSubpath(svg, sub.d, tolerance, ctm);
        const pline = buildPline(pts, sub.closedHint);
        if (!pline) continue;
        const bbox = pline.extents();
        if (!bbox) continue;
        idx++;
        out.push({
          id: `p${idx}`,
          label: `path ${idx}`,
          pline,
          bbox,
          closed: pline.isClosed,
          bboxArea: (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY),
        });
      }
    }
    return out;
  } finally {
    host.remove();
  }
}

/** Split a path `d` into independent subpaths (one per `M`), noting `Z` closure. */
function splitSubpaths(d: string): SubPath[] {
  let norm: unknown[][];
  try {
    norm = SVGPathCommander.normalizePath(d) as unknown as unknown[][];
  } catch {
    return [];
  }
  const subs: SubPath[] = [];
  let cur: unknown[][] = [];
  let closedHint = false;
  const flush = () => {
    if (cur.length > 1) {
      try {
        subs.push({ d: SVGPathCommander.pathToString(cur as never), closedHint });
      } catch {
        /* skip malformed subpath */
      }
    }
    cur = [];
    closedHint = false;
  };
  for (const seg of norm) {
    const cmd = seg[0];
    if (cmd === "M" && cur.length) flush();
    if (cmd === "Z" || cmd === "z") {
      closedHint = true;
      cur.push(seg);
      continue;
    }
    cur.push(seg);
  }
  flush();
  return subs;
}

/** Evenly sample a single subpath along its length, mapping through `ctm`. */
function flattenSubpath(
  svg: SVGSVGElement,
  d: string,
  tolerance: number,
  ctm: DOMMatrix | null,
): Pt[] {
  const tmp = document.createElementNS(SVG_NS, "path");
  tmp.setAttribute("d", d);
  svg.appendChild(tmp);
  try {
    const len = tmp.getTotalLength();
    if (!(len > 0)) return [];
    const steps = Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, Math.ceil(len / tolerance)));
    const pts: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const p = tmp.getPointAtLength((len * i) / steps);
      pts.push(applyMatrix(ctm, p.x, p.y));
    }
    return pts;
  } catch {
    return [];
  } finally {
    tmp.remove();
  }
}

function applyMatrix(m: DOMMatrix | null, x: number, y: number): Pt {
  if (!m) return { x, y };
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/**
 * Build a world-space polyline (y negated) from sampled points; null if
 * degenerate. A subpath counts as closed when it carries an explicit `Z`
 * (`closedHint`) OR its first and last samples coincide — svg-path-commander
 * emits geometrically-closed circles/rects/ellipses without a trailing `Z`.
 */
function buildPline(pts: Pt[], closedHint: boolean): Polyline | null {
  const verts: [number, number, number][] = [];
  for (const p of pts) {
    const wy = -p.y; // SVG y-down → world y-up
    const last = verts[verts.length - 1];
    if (last && Math.hypot(last[0] - p.x, last[1] - wy) < POS_EPS) continue;
    verts.push([p.x, wy, 0]);
  }
  if (verts.length < 2) return null;

  const f = verts[0]!;
  const l = verts[verts.length - 1]!;
  const coincident = Math.hypot(f[0] - l[0], f[1] - l[1]) < POS_EPS;
  const closed = closedHint || coincident;
  if (closed && coincident) verts.pop(); // drop the duplicate closing vertex

  if (closed) {
    if (verts.length < 3) return null;
    const pl = plineClosed(verts);
    if (Math.abs(pl.area()) < 1e-6) return null;
    return pl;
  }
  return plineOpen(verts);
}
