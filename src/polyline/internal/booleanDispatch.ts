/**
 * Late-bound dispatch for the polyline boolean operation implementation.
 *
 * This module exists purely to avoid a runtime circular import (see the header of
 * `overlappingSlices.ts` for the module-cycle hazard established in M4):
 * `plineSourceBase.ts` needs to call `polylineBoolean` from its `boolean`/`booleanOpt`
 * methods, but `plineBoolean.ts` constructs `PlineViewData`/`PlineView` values at runtime and
 * therefore imports `plineView.ts` — and `class PlineView extends PlineSourceBase` requires
 * `plineSourceBase.ts` to be fully evaluated first. A direct
 * `plineSourceBase.ts` → `plineBoolean.ts` → `plineView.ts` → `plineSourceBase.ts` chain throws
 * `ReferenceError: Cannot access 'PlineSourceBase' before initialization` at module evaluation
 * time (verified empirically).
 *
 * Instead this module (which has type-only imports and no runtime dependencies) holds a mutable
 * binding that `plineBoolean.ts` assigns at its module evaluation time, keeping the runtime
 * import graph acyclic:
 * - `plineSourceBase.ts` → `booleanDispatch.ts` (no further imports)
 * - `plineBoolean.ts` → `plineView.ts`/`polyline.ts`/… and `booleanDispatch.ts` (registration)
 *
 * The package public entry (`src/index.ts`) re-exports `plineBoolean.ts` so importing the
 * package always performs the registration. Deep-importing `polyline.ts` alone without ever
 * importing `plineBoolean.ts` (or `index.ts`) leaves the boolean methods unregistered — calling
 * them then throws an informative error.
 */
import type { PlineSourceBase } from "../plineSourceBase.js";
import type { BooleanOp, BooleanResult, PlineBooleanOptions } from "../plineTypes.js";
import type { Polyline } from "../polyline.js";

/** Signature of `polylineBoolean` (port of Rust `polyline_boolean`). */
export type PolylineBooleanFn = (
  pline1: PlineSourceBase,
  pline2: PlineSourceBase,
  operation: BooleanOp,
  options: PlineBooleanOptions,
) => BooleanResult<Polyline>;

let polylineBooleanImpl: PolylineBooleanFn | null = null;

/** Called by `plineBoolean.ts` at module evaluation time to register the implementation. */
export function setPolylineBooleanImpl(impl: PolylineBooleanFn): void {
  polylineBooleanImpl = impl;
}

/** Get the registered `polylineBoolean` implementation (throws if not yet registered). */
export function getPolylineBooleanImpl(): PolylineBooleanFn {
  if (polylineBooleanImpl === null) {
    throw new Error(
      "polylineBoolean implementation not registered: import the package entry point " +
        '(src/index.ts) or "src/polyline/internal/plineBoolean" before calling boolean methods',
    );
  }
  return polylineBooleanImpl;
}
