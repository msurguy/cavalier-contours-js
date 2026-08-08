/**
 * Headless sanity check for every scene's compute path. Run from demo/ (after
 * `npm install`):
 *
 *   node scripts/sanity.mjs
 *
 * The demo keeps all algorithm logic in pure, DOM-free TS modules
 * (src/scenes/compute.ts, src/scenes/data.ts, src/geom.ts) that only import
 * the library barrel. This script transpiles those modules on the fly (using
 * the TypeScript compiler from devDeps) and executes them in Node against the
 * built library, so exactly the code the browser runs is what gets checked.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transpileModule } from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");
const libEntry = pathToFileURL(
  join(here, "..", "node_modules", "cavalier-contours-js", "dist", "index.js"),
).href;

/** Transpile one of the demo's pure TS modules and import it as an ES module. */
async function importTs(relPath) {
  const tsSource = readFileSync(join(srcDir, relPath), "utf8");
  const js = transpileModule(tsSource, {
    compilerOptions: { target: "ES2022", module: "ESNext", verbatimModuleSyntax: false },
  }).outputText;
  // Data-URL modules may import absolute URLs; rewrite the bare specifier.
  const patched = js.replaceAll('"cavalier-contours-js"', JSON.stringify(libEntry));
  if (/from\s+["']\.{1,2}\//.test(patched)) {
    throw new Error(`${relPath} has local imports; pure compute modules must not`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(patched).toString("base64")}`);
}

const lib = await import(libEntry);
const compute = await importTs("scenes/compute.ts");
const data = await importTs("scenes/data.ts");
const geom = await importTs("geom.ts");

let failures = 0;
function check(name, fn) {
  const t0 = performance.now();
  try {
    const detail = fn();
    const ms = (performance.now() - t0).toFixed(2);
    console.log(`  ok  ${name}  (${ms} ms)${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}: ${err && err.stack ? err.stack : err}`);
  }
}

console.log("cavalier-contours-js demo — headless scene compute sanity\n");

// ---------------------------------------------------------------------------
console.log("scene 1: polyline offset");
const src = data.offsetSceneDefault();
for (const dist of [0.5, 1.0, 3.0, -1.0, -5.0, 25.0]) {
  check(`offset stack d=${dist} repeat=10`, () => {
    const stack = compute.computeOffsetStack(src, dist, 10, true);
    return `${stack.length} loops`;
  });
}
check("offset stack, handleSelfIntersects=false", () => {
  const stack = compute.computeOffsetStack(src, 1.0, 10, false);
  return `${stack.length} loops`;
});
for (const dist of [1.0, -2.0]) {
  check(`raw offset d=${dist}`, () => {
    const raw = compute.computeRawOffset(src, dist);
    return `${raw.vertexCount} vertexes`;
  });
  check(`raw offset segments d=${dist}`, () => {
    const segs = compute.computeRawOffsetSegs(src, dist);
    return `${segs.length} segs, ${segs.filter((s) => s.collapsedArc).length} collapsed`;
  });
}

// Arc rendering direction validation: flatten every arc with the *renderer's*
// exact sweep math (same start angle / signed sweep / anticlockwise flag fed
// to ctx.arc) and compare the resulting signed polygon area against the
// library's analytic pline.area(). A flipped arc direction would invert lobes
// and change both sign and magnitude.
check("arc direction: flattened area matches pline.area()", () => {
  const slot = lib.plineClosed([
    [0, 0, 0],
    [10, 0, 1],
    [10, 5, 0],
    [0, 5, 1],
  ]);
  const relErrs = [];
  const testPlines = [
    src,
    slot,
    ...compute.computeOffsetStack(src, 1.0, 4, true).map((e) => e.pline),
  ];
  for (const pl of testPlines) {
    const flatArea = geom.polygonArea(geom.flattenPline(pl, 0.02));
    const libArea = pl.area();
    if (Math.sign(flatArea) !== Math.sign(libArea)) {
      throw new Error(`area sign mismatch: flattened ${flatArea} vs library ${libArea}`);
    }
    const relErr = Math.abs(flatArea - libArea) / Math.max(1e-9, Math.abs(libArea));
    if (relErr > 5e-3) {
      throw new Error(`area magnitude mismatch: flattened ${flatArea} vs library ${libArea}`);
    }
    relErrs.push(relErr);
  }
  return `${testPlines.length} plines, max rel err ${Math.max(...relErrs).toExponential(2)}`;
});

// ---------------------------------------------------------------------------
console.log("\nscene 2: boolean ops");
const [pa, pb] = data.booleanSceneDefaults();
for (const op of ["or", "and", "not", "xor"]) {
  check(`boolean "${op}"`, () => {
    const res = compute.computeBoolean(pa, pb, op);
    return `${res.posPlines.length} pos / ${res.negPlines.length} neg (${res.resultInfo})`;
  });
}
check('boolean "or" after translating B (drag path)', () => {
  const b = pb.clone();
  b.translateMut(6, 3);
  const res = compute.computeBoolean(pa, b, "or");
  return `${res.posPlines.length} pos / ${res.negPlines.length} neg`;
});

// ---------------------------------------------------------------------------
console.log("\nscene 3: shape offset");
const shapePlines = data.shapeSceneDefaults();
for (const dist of [2.0, 4.0, 10.0, -5.0]) {
  check(`shape offset stack d=${dist} repeat=25`, () => {
    const { offsetShapes } = compute.computeShapeOffsetStack(shapePlines, dist, 25);
    const loops = offsetShapes.reduce((n, s) => n + s.ccwPlines.length + s.cwPlines.length, 0);
    return `${offsetShapes.length} generations, ${loops} loops`;
  });
}

// ---------------------------------------------------------------------------
console.log("\nscene 4: hatch fill");
const outline = data.hatchSceneDefault();
for (const spacing of [0.6, 2.0]) {
  check(`hatch spacing=${spacing} until exhaustion`, () => {
    const res = compute.computeHatch(outline, spacing);
    if (!res.exhausted) throw new Error("hit loop cap before exhaustion");
    return `${res.loops.length} loops, pen travel ${res.totalLength.toFixed(2)}`;
  });
}

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("all scene compute paths ran clean");
