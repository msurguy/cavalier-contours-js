/**
 * Convenience polyline constructors — equivalents of the Rust `pline_open!`/`pline_closed!`
 * (and `pline_open_userdata!`/`pline_closed_userdata!`) macros.
 *
 * ```ts
 * // Rust: pline_closed![(0.0, 0.0, 1.0), (1.0, 0.0, 1.0)]
 * const pline = plineClosed([
 *   [0.0, 0.0, 1.0],
 *   [1.0, 0.0, 1.0],
 * ]);
 * // Rust: pline_open_userdata![[4], (0.0, 0.0, 0.0), (1.0, 0.0, 0.0)]
 * const plineWithData = plineOpen(
 *   [
 *     [0.0, 0.0, 0.0],
 *     [1.0, 0.0, 0.0],
 *   ],
 *   { userdata: [4] },
 * );
 * ```
 */
import { Polyline } from "./polyline.js";

/** Options for the `plineOpen`/`plineClosed` convenience constructors. */
export interface PlineConstructOptions {
  /** User data values to set on the created polyline. */
  userdata?: readonly number[];
}

function plineFromTuples(
  vertexes: readonly (readonly [number, number, number])[],
  isClosed: boolean,
  options?: PlineConstructOptions,
): Polyline {
  const result = new Polyline({ isClosed });
  for (const [x, y, bulge] of vertexes) {
    result.add(x, y, bulge);
  }
  if (options?.userdata !== undefined) {
    result.setUserdataValues(options.userdata);
  }
  return result;
}

/**
 * Construct an open `Polyline` from `[x, y, bulge]` tuples (Rust `pline_open!` macro; pass
 * `{ userdata: [...] }` for `pline_open_userdata!`).
 */
export function plineOpen(
  vertexes: readonly (readonly [number, number, number])[],
  options?: PlineConstructOptions,
): Polyline {
  return plineFromTuples(vertexes, false, options);
}

/**
 * Construct a closed `Polyline` from `[x, y, bulge]` tuples (Rust `pline_closed!` macro; pass
 * `{ userdata: [...] }` for `pline_closed_userdata!`).
 */
export function plineClosed(
  vertexes: readonly (readonly [number, number, number])[],
  options?: PlineConstructOptions,
): Polyline {
  return plineFromTuples(vertexes, true, options);
}
