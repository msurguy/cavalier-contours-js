// Tests converted from the Rust doc-test examples in `src/core/traits/fuzzy_eq.rs` and
// `src/core/traits/fuzzy_ord.rs`.
import { expect, test } from "vitest";
import { fuzzyEq, fuzzyInRange, fuzzyLt } from "../src/core/fuzzy.js";

test("fuzzyEq", () => {
  const a = 0.1 + 0.2;
  const b = 0.3;

  // Direct comparison would fail due to floating point precision
  expect(a).not.toBe(b);

  // Fuzzy comparison succeeds
  expect(fuzzyEq(a, b)).toBe(true);
});

test("fuzzyLt", () => {
  const a = 0.1 + 0.2;
  const b = 0.3;

  // Due to floating point precision, a is actually slightly greater than b
  expect(a <= b).toBe(false);

  // But fuzzy comparison considers them equal
  expect(fuzzyLt(a, b)).toBe(true);
});

test("fuzzyInRange", () => {
  expect(fuzzyInRange(1.0, 0.99, 2.0, 0.05)).toBe(true);
  expect(fuzzyInRange(1.0, 1.5, 2.0, 1e-5)).toBe(true);
  expect(fuzzyInRange(1.0, 2.0, 2.0, 1e-5)).toBe(true);
});
