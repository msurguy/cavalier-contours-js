/**
 * A small built-in sample so the SVG Studio scene is demoable with no upload.
 * Deliberately mixes primitives that stress the import pipeline:
 *   - an outer blob made of cubic béziers (curve flattening),
 *   - a <circle> and a <rect> (shape → path via svg-path-commander),
 *   - a <polygon>,
 *   - a nested <g transform> (CTM handling).
 */
export const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200">
  <path d="M50 24 C24 24 20 48 20 74 L20 132 C20 166 42 178 74 178
           L168 178 C202 178 222 156 222 124 L222 62 C222 32 200 22 168 24
           C140 26 132 44 120 44 C104 44 92 22 50 24 Z" />
  <circle cx="120" cy="104" r="34" />
  <polygon points="120,84 138,120 102,120" />
  <g transform="translate(58 150) rotate(-12)">
    <rect x="-16" y="-10" width="32" height="20" rx="4" />
  </g>
</svg>`;
