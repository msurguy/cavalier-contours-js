# cavalier-contours-js

[![npm version](https://img.shields.io/npm/v/cavalier-contours-js.svg)](https://www.npmjs.com/package/cavalier-contours-js)
[![license](https://img.shields.io/npm/l/cavalier-contours-js.svg)](#license)

Pure TypeScript/JavaScript port of the [cavalier_contours](https://github.com/jbuckmccready/cavalier_contours)
Rust library — 2D polyline offsetting and boolean operations with **arc segment (bulge) support**.
No Rust, no WASM: plain ES modules that run in any modern browser, web worker, or Node.

**▶ [Live interactive demo](https://msurguy.github.io/cavalier-contours-js/)**

Ported 1:1 from the Rust source (v0.7.0) and validated by the complete translated Rust test
suite (232 tests). License: MIT OR Apache-2.0, same as the original. The bundled spatial index
is a port of [static_aabb2d_index](https://github.com/jbuckmccready/static_aabb2d_index)
(itself derived from [flatbush](https://github.com/mourner/flatbush)).

## Features

- **Parallel offset** of open and closed polylines, including self-intersecting ones
- **Boolean operations**: union (`"or"`), intersection (`"and"`), difference (`"not"`), `"xor"`
- **Shape offset**: multi-polyline shapes with holes/islands, offset while maintaining hole relationships
- Queries: signed area, path length, extents, winding number, closest point, containment,
  self-intersects, find-intersects
- Arc segments are first-class via the *bulge* representation (bulge = tan(θ/4); 1 = half circle)
- Zero runtime dependencies; plain ESM + TypeScript declarations (~74 kB unminified, ~20 kB gzipped)

## Install

```sh
npm install cavalier-contours-js
```

ESM-only. Works in modern Node (≥18), bundlers, and directly in the browser — `dist/` uses
fully-specified relative imports, so you can serve it and `import` it from a
`<script type="module">` or an ES-module worker without a bundler.

## Quick start

```ts
import { Polyline, plineClosed, plineOpen, Shape } from "cavalier-contours-js";

// Rounded slot: two lines + two half-circle arcs (bulge = 1)
const slot = plineClosed([
  [0, 0, 0],   // x, y, bulge
  [10, 0, 1],
  [10, 5, 0],
  [0, 5, 1],
]);

slot.area();                        // signed area (CCW positive)
slot.pathLength();
slot.extents();                     // { minX, minY, maxX, maxY } | null
slot.windingNumber({ x: 5, y: 2.5 });

// Parallel offset — positive offsets a CCW polyline inward; returns 0..n polylines
const inward: Polyline[] = slot.parallelOffset(1.0);
const outward = slot.parallelOffset(-1.0);

// Boolean operations
const rect = plineClosed([[5, -2, 0], [15, -2, 0], [15, 7, 0], [5, 7, 0]]);
const union = slot.boolean(rect, "or");     // "or" | "and" | "not" | "xor"
for (const { pline } of union.posPlines) {
  // resulting positive-space polylines
}
union.negPlines;                             // holes in the result, if any

// Multi-polyline shape (outline + holes), offset keeping island relationships
const outer = plineClosed([[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0]]); // CCW
const hole  = plineClosed([[30, 30, 0], [30, 70, 0], [70, 70, 0], [70, 30, 0]]); // CW
const shape = Shape.fromPlines([outer, hole]);
const offset = shape.parallelOffset(5);
offset.ccwPlines.forEach(p => render(p.polyline)); // outlines
offset.cwPlines.forEach(p => render(p.polyline));  // holes
```

### Building polylines imperatively

```ts
const pl = new Polyline({ isClosed: true });
pl.add(0, 0, 0);
pl.add(10, 0, 0.5);
```

### Web worker transfer

`Polyline.toFlatArrays()` returns `{ x, y, bulge }` as `Float64Array`s (transferable);
reconstruct with `Polyline.fromFlatArrays(x, y, bulge, isClosed)`.

### Options

Every algorithm takes an optional options object mirroring the Rust API, e.g.:

```ts
slot.parallelOffset(1.0, { handleSelfIntersects: true, posEqualEps: 1e-5 });
slot.boolean(rect, "or", { posEqualEps: 1e-5 });
shape.parallelOffset(5, { offsetDistEps: 1e-4, sliceJoinEps: 1e-4 });
```

## Notes on the port

- Numeric type is `number` (f64) — identical IEEE-754 arithmetic to the Rust f64 implementation;
  transcendental functions may differ in final ULPs, absorbed by the library's fuzzy epsilons.
- `userdata` values are `number[]` (the Rust API uses `u64`; values above 2^53 lose precision).
- Rust `Option<T>` maps to `T | null`.

## Contributing

```sh
git clone https://github.com/msurguy/cavalier-contours-js.git
cd cavalier-contours-js
npm install        # also builds dist/ via the prepare script
npm test           # Vitest — ports of the entire Rust test suite (232 tests)
npm run typecheck
npm run build
```

There is also an interactive demo in [`demo/`](demo/) (`cd demo && npm install && npm run dev`).

## Releasing

Releases are published to npm automatically via [GitHub Actions](.github/workflows/release.yml)
using npm **Trusted Publishing** (OIDC) — no `NPM_TOKEN` secret is stored anywhere, and every
release carries a [provenance](https://docs.npmjs.com/generating-provenance-statements)
attestation.

To cut a release:

```sh
npm version patch          # or minor / major — bumps package.json, commits, and tags
git push origin main --tags
gh release create vX.Y.Z --generate-notes
```

Publishing a **GitHub Release** triggers the workflow, which typechecks, runs the full test
suite, builds, and runs `npm publish --provenance`. Watch it with
`gh run watch` — a green ✓ appears next to the new version on npm.

The demo redeploys to [GitHub Pages](.github/workflows/pages.yml) on every push to `main`.

## License

Licensed under either of

- MIT license ([LICENSE-MIT](LICENSE-MIT))
- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))

at your option — the same dual license as the original `cavalier_contours` Rust crate.
