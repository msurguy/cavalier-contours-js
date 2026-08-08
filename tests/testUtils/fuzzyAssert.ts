import { expect } from "vitest";
import { FUZZY_EPSILON } from "../../src/core/fuzzy.js";
import type { Vector2 } from "../../src/core/vector2.js";
import type { PlineSourceBase } from "../../src/polyline/plineSourceBase.js";
import type { PlineVertex } from "../../src/polyline/plineVertex.js";

/**
 * Vitest equivalent of Rust `assert_fuzzy_eq!(actual, expected, eps?)` — fails with a rich
 * message showing both values, the epsilon used, and the difference.
 */
export function expectFuzzyEq(
  actual: number,
  expected: number,
  eps: number = FUZZY_EPSILON,
): void {
  if (!(Math.abs(actual - expected) < eps)) {
    expect.fail(
      `expected ${actual} to fuzzy equal ${expected} (eps: ${eps}, diff: ${Math.abs(
        actual - expected,
      )})`,
    );
  }
}

/** Rust `assert_fuzzy_eq!` on `Vector2` values. */
export function expectVector2FuzzyEq(
  actual: Vector2,
  expected: Vector2,
  eps: number = FUZZY_EPSILON,
): void {
  if (!actual.fuzzyEqEps(expected, eps)) {
    expect.fail(`expected ${actual} to fuzzy equal ${expected} (eps: ${eps})`);
  }
}

/** Rust `assert_fuzzy_eq!` on `PlineVertex` values. */
export function expectVertexFuzzyEq(
  actual: PlineVertex,
  expected: PlineVertex,
  eps: number = FUZZY_EPSILON,
): void {
  if (!actual.fuzzyEqEps(expected, eps)) {
    expect.fail(`expected ${actual} to fuzzy equal ${expected} (eps: ${eps})`);
  }
}

/** Rust `assert_fuzzy_eq!` on whole polylines (compares closedness, counts, and vertexes). */
export function expectPlineFuzzyEq(
  actual: PlineSourceBase,
  expected: PlineSourceBase,
  eps: number = FUZZY_EPSILON,
): void {
  if (!actual.fuzzyEqEps(expected, eps)) {
    const fmt = (p: PlineSourceBase): string =>
      `isClosed: ${p.isClosed}, vertexes: [${[...p.iterVertexes()].join(", ")}]`;
    expect.fail(`expected polyline {${fmt(actual)}} to fuzzy equal {${fmt(expected)}} (eps: ${eps})`);
  }
}

/** Rust `Option::expect` — unwraps a nullable value, failing the test with `msg` when `null`. */
export function expectSome<T>(value: T | null, msg: string): T {
  if (value === null) {
    throw new Error(msg);
  }
  return value;
}
