// Tests converted from the Rust doc-test examples and unit tests in `src/core/math/vector2.rs`.
import { expect, test } from "vitest";
import { vec2 } from "../src/core/vector2.js";

test("vec2", () => {
  const v = vec2(3.0, 4.0);
  expect(v.x).toBe(3.0);
  expect(v.y).toBe(4.0);
});

// Port of the Rust `ops` unit test (Rust reference/value operator overloads all collapse
// to the same `add`/`sub` methods in TS).
test("ops", () => {
  const v1 = vec2(4.0, 5.0);
  const v2 = vec2(1.0, 2.0);
  expect(v1.add(v2).fuzzyEq(vec2(5.0, 7.0))).toBe(true);
  expect(v1.sub(v2).fuzzyEq(vec2(3.0, 3.0))).toBe(true);
});
