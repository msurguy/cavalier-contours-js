/**
 * Control flow inside visiting methods.
 *
 * The Rust `ControlFlow` trait provides a way to control iteration and visiting patterns
 * in spatial queries and other algorithms. It allows early termination of operations when
 * a desired condition is met.
 *
 * In this port a visitor returns `false` to break/stop iteration; any other value
 * (including `undefined`) continues. Internal visit functions return `boolean` =
 * "ran to completion without break". Where Rust breaks with a payload, capture it in a
 * closed-over local instead.
 */
export type VisitResult = boolean | void;

/**
 * Port of Rust `debug_assert!` — throws an `Error` with `msg` if `cond` is false.
 */
export function debugAssert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(msg);
  }
}

/**
 * Returns the keys of `map` sorted ascending.
 *
 * Used wherever Rust iterates a `BTreeMap<usize, V>` in key order (JS `Map` iterates in
 * insertion order, so we sort explicitly).
 */
export function sortedKeys<V>(map: Map<number, V>): number[] {
  return [...map.keys()].sort((a, b) => a - b);
}
