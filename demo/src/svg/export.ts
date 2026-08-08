/**
 * SVG export: serialize world-space result polylines back into a downloadable
 * SVG. Result arcs (offset produces rounded corners) are flattened to line
 * segments via `arcsToApproxLines`, so the emitted `d` is pure `M`/`L`/`Z` and
 * we never have to reason about SVG arc-sweep flags. Y is flipped back to the
 * SVG y-down convention (`svgY = -worldY`).
 *
 * `plineToSvgPath` is pure; the DOM-touching `downloadSvg` is browser-only.
 */
import type { AABB, Polyline } from "cavalier-contours-js";

export interface SvgLayer {
  plines: readonly Polyline[];
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  fillRule?: "evenodd" | "nonzero";
  opacity?: number;
}

function num(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

/** World (y-up) polyline → SVG path `d` (y flipped), arcs flattened to segments. */
export function plineToSvgPath(pline: Polyline, errDist: number): string {
  const approx = pline.arcsToApproxLines(errDist) ?? pline;
  const n = approx.vertexCount;
  if (n === 0) return "";
  let d = "";
  for (let i = 0; i < n; i++) {
    const v = approx.get(i)!;
    d += `${i === 0 ? "M" : "L"}${num(v.x)} ${num(-v.y)} `;
  }
  if (approx.isClosed) d += "Z";
  return d.trim();
}

/** Assemble a standalone SVG document string from styled layers over `worldBox`. */
export function buildSvg(layers: readonly SvgLayer[], worldBox: AABB, errDist: number): string {
  const w = worldBox.maxX - worldBox.minX;
  const h = worldBox.maxY - worldBox.minY;
  const margin = Math.max(w, h) * 0.04 + 1;
  // world bbox → SVG (y flip): world maxY becomes SVG minY.
  const vbX = worldBox.minX - margin;
  const vbY = -worldBox.maxY - margin;
  const vbW = w + margin * 2;
  const vbH = h + margin * 2;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(vbX)} ${num(vbY)} ${num(vbW)} ${num(vbH)}">`,
  ];
  for (const layer of layers) {
    const d = layer.plines
      .map((p) => plineToSvgPath(p, errDist))
      .filter(Boolean)
      .join(" ");
    if (!d) continue;
    const attrs: string[] = [`d="${d}"`, `fill="${layer.fill ?? "none"}"`];
    if (layer.fill && layer.fill !== "none") {
      attrs.push(`fill-rule="${layer.fillRule ?? "nonzero"}"`);
    }
    if (layer.stroke) {
      attrs.push(
        `stroke="${layer.stroke}"`,
        `stroke-width="${num(layer.strokeWidth ?? 1)}"`,
        `stroke-linejoin="round"`,
        `stroke-linecap="round"`,
      );
    }
    if (layer.opacity !== undefined && layer.opacity < 1) {
      attrs.push(`opacity="${num(layer.opacity)}"`);
    }
    parts.push(`  <path ${attrs.join(" ")}/>`);
  }
  parts.push(`</svg>`);
  return parts.join("\n");
}

/** Trigger a browser download of an SVG string. */
export function downloadSvg(svg: string, filename: string): void {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.toLowerCase().endsWith(".svg") ? filename : `${filename}.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
