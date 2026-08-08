// Public API barrel.
//
// The two bare imports below are REQUIRED side-effect imports: evaluating those modules
// registers the parallel-offset and boolean implementations into the dispatch registries
// used by PlineSourceBase (an indirection that breaks an otherwise-fatal ESM import cycle
// through plineView). package.json declares "sideEffects": true so bundlers never
// tree-shake the registration away (glob-based sideEffects arrays proved unreliable for
// symlinked file: dependencies under Vite/Rollup).
import "./polyline/internal/plineOffset.js";
import "./polyline/internal/plineBoolean.js";

export * from "./core/fuzzy.js";
export * from "./core/controlFlow.js";
export * from "./core/mathUtils.js";
export * from "./core/vector2.js";
export * from "./core/lineLineIntersect.js";
export * from "./core/lineCircleIntersect.js";
export * from "./core/circleCircleIntersect.js";
export * from "./index2d/staticAabb2dIndex.js";
export * from "./polyline/plineVertex.js";
export * from "./polyline/plineSeg.js";
export * from "./polyline/plineSegIntersect.js";
export * from "./polyline/plineTypes.js";
export * from "./polyline/plineSourceBase.js";
export * from "./polyline/polyline.js";
export * from "./polyline/plineView.js";
export * from "./polyline/construct.js";
// note: importing this module also registers the `parallelOffset` implementation used by
// `PlineSourceBase.parallelOffset`/`parallelOffsetOpt` (see `plineOffsetRegistry.ts`)
export * from "./polyline/internal/plineOffset.js";
// note: importing this module also registers the `polylineBoolean` implementation used by
// `PlineSourceBase.boolean`/`booleanOpt` (see `booleanDispatch.ts`)
export * from "./polyline/internal/plineBoolean.js";
export * from "./shape/shape.js";
