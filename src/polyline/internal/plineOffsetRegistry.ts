/**
 * Late-binding registry connecting `PlineSourceBase.parallelOffset`/`parallelOffsetOpt` to the
 * implementation in `plineOffset.ts`.
 *
 * `plineOffset.ts` constructs `PlineViewData`/`PlineView`/`Polyline` values at runtime, so
 * `plineSourceBase.ts` cannot import it directly: `plineSourceBase.ts` → `plineOffset.ts` →
 * `plineView.ts` → `plineSourceBase.ts` would be a runtime circular import that breaks
 * `class PlineView extends PlineSourceBase` (temporal dead zone error) at module evaluation
 * time (same hazard documented in `overlappingSlices.ts`). Instead `plineSourceBase.ts`
 * imports this dependency-free module (all imports below are type-only and erased at runtime)
 * and `plineOffset.ts` registers its `parallelOffset` implementation when it is evaluated —
 * which happens whenever the package entry `src/index.ts` (which re-exports `plineOffset.ts`)
 * is imported.
 */
import type { PlineSourceBase } from "../plineSourceBase.js";
import type { PlineOffsetOptions } from "../plineTypes.js";
import type { Polyline } from "../polyline.js";

/** Signature of the `parallelOffset` implementation in `plineOffset.ts`. */
export type ParallelOffsetImpl = (
  polyline: PlineSourceBase,
  offset: number,
  options: PlineOffsetOptions,
) => Polyline[];

let parallelOffsetImpl: ParallelOffsetImpl | null = null;

/** Called by `plineOffset.ts` at module evaluation time to register its implementation. */
export function registerParallelOffsetImpl(impl: ParallelOffsetImpl): void {
  parallelOffsetImpl = impl;
}

/** Invoke the registered `parallelOffset` implementation (used by `plineSourceBase.ts`). */
export function invokeParallelOffset(
  polyline: PlineSourceBase,
  offset: number,
  options: PlineOffsetOptions,
): Polyline[] {
  if (parallelOffsetImpl === null) {
    throw new Error(
      "parallel offset implementation not registered: import the package entry ('src/index') " +
        "or 'src/polyline/internal/plineOffset' before calling parallelOffset",
    );
  }
  return parallelOffsetImpl(polyline, offset, options);
}
