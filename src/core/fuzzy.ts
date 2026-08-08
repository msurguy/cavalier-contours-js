/**
 * Fuzzy equality and ordering comparisons with floating point numbers.
 *
 * These functions provide comparisons of floating point values with a tolerance
 * (epsilon) to account for floating point precision issues. They are essential for
 * geometric computations where exact equality is rarely achievable due to
 * floating point arithmetic limitations.
 *
 * Ported from the Rust `FuzzyEq` and `FuzzyOrd` traits (`fuzzy_eq.rs`/`fuzzy_ord.rs`),
 * monomorphized to `number` (f64).
 */

/** The default epsilon value for fuzzy comparisons. */
export const FUZZY_EPSILON = 1e-8;

/**
 * Returns `true` if `a` is approximately equal to `b`, using
 * a provided epsilon value.
 */
export function fuzzyEqEps(a: number, b: number, fuzzyEpsilon: number): boolean {
  return Math.abs(a - b) < fuzzyEpsilon;
}

/**
 * Returns `true` if `a` is approximately equal to `b`, using
 * the default `FUZZY_EPSILON` value.
 */
export function fuzzyEq(a: number, b: number): boolean {
  return fuzzyEqEps(a, b, FUZZY_EPSILON);
}

/**
 * Returns `true` if `a` is approximately equal to zero, using
 * a provided epsilon value.
 */
export function fuzzyEqZeroEps(a: number, fuzzyEpsilon: number): boolean {
  return Math.abs(a) < fuzzyEpsilon;
}

/**
 * Returns `true` if `a` is approximately equal to zero, using
 * the default `FUZZY_EPSILON` value.
 */
export function fuzzyEqZero(a: number): boolean {
  return fuzzyEqZeroEps(a, FUZZY_EPSILON);
}

/**
 * Returns `true` if `a` is fuzzy greater than `b`, using the epsilon value given
 * (defaults to `FUZZY_EPSILON`).
 *
 * Mirrors Rust `FuzzyOrd::fuzzy_gt_eps`/`fuzzy_gt`: `a + fuzzyEpsilon > b`.
 * Note by construction this is inclusive of fuzzy equality (greater than or fuzzy equal).
 */
export function fuzzyGt(a: number, b: number, fuzzyEpsilon: number = FUZZY_EPSILON): boolean {
  return a + fuzzyEpsilon > b;
}

/**
 * Alias of `fuzzyGt` — the Rust `fuzzy_gt` comparison is already inclusive of fuzzy
 * equality (`a + fuzzyEpsilon > b`), so greater-than-or-equal is the same operation.
 */
export const fuzzyGte: typeof fuzzyGt = fuzzyGt;

/**
 * Returns `true` if `a` is fuzzy less than `b`, using the epsilon value given
 * (defaults to `FUZZY_EPSILON`).
 *
 * Mirrors Rust `FuzzyOrd::fuzzy_lt_eps`/`fuzzy_lt`: `a < b + fuzzyEpsilon`.
 * Note by construction this is inclusive of fuzzy equality (less than or fuzzy equal).
 */
export function fuzzyLt(a: number, b: number, fuzzyEpsilon: number = FUZZY_EPSILON): boolean {
  return a < b + fuzzyEpsilon;
}

/**
 * Alias of `fuzzyLt` — the Rust `fuzzy_lt` comparison is already inclusive of fuzzy
 * equality (`a < b + fuzzyEpsilon`), so less-than-or-equal is the same operation.
 */
export const fuzzyLte: typeof fuzzyLt = fuzzyLt;

/**
 * Test if `v` is in range between `min` and `max` with some epsilon for fuzzy comparing
 * (defaults to `FUZZY_EPSILON`).
 *
 * Mirrors Rust `FuzzyOrd::fuzzy_in_range_eps`/`fuzzy_in_range`
 * (`v.fuzzy_in_range_eps(min, max, eps)` → `fuzzyInRange(min, v, max, eps)`).
 */
export function fuzzyInRange(
  min: number,
  v: number,
  max: number,
  fuzzyEpsilon: number = FUZZY_EPSILON,
): boolean {
  return fuzzyGt(v, min, fuzzyEpsilon) && fuzzyLt(v, max, fuzzyEpsilon);
}
