// Tests converted from the Rust doc-test examples in `src/core/math/base_math.rs`.
import { expect, test } from "vitest";
import {
  angleIsBetweenEps,
  deltaAngle,
  isLeft,
  minMax,
  normalizeRadians,
  pointWithinArcSweep,
} from "../src/core/mathUtils.js";
import { Vector2 } from "../src/core/vector2.js";
import { expectFuzzyEq } from "./testUtils/fuzzyAssert.js";

test("minMax", () => {
  const [minVal, maxVal] = minMax(8, 4);
  expect(minVal).toBe(4);
  expect(maxVal).toBe(8);
});

test("normalizeRadians", () => {
  const PI = Math.PI;
  expectFuzzyEq(normalizeRadians(5.0 * PI), PI);
  expectFuzzyEq(normalizeRadians(-PI / 4.0), (7.0 * PI) / 4.0);
  // anything between 0 and 2PI inclusive is left unchanged
  expectFuzzyEq(normalizeRadians(0.0), 0.0);
  expectFuzzyEq(normalizeRadians(PI), PI);
  expectFuzzyEq(normalizeRadians(2.0 * PI), 2.0 * PI);
});

test("deltaAngle", () => {
  const PI = Math.PI;
  expectFuzzyEq(deltaAngle(5.0 * PI, 5.0 * PI), 0.0);
  // note here the return is positive in both cases (since there is PI difference)
  expectFuzzyEq(deltaAngle(4.0 * PI, 5.0 * PI), PI);
  expectFuzzyEq(deltaAngle(5.0 * PI, 4.0 * PI), PI);
  // these cases show when the order can change the sign
  expectFuzzyEq(deltaAngle(0.5 * PI, 0.25 * PI), -0.25 * PI);
  expectFuzzyEq(deltaAngle(0.25 * PI, 0.5 * PI), 0.25 * PI);
});

test("angleIsBetweenEps", () => {
  const PI = Math.PI;
  expect(angleIsBetweenEps(PI / 2.0, 0.0, PI, 1e-5)).toBe(true);
  expect(angleIsBetweenEps(0.0, 0.0, PI, 1e-5)).toBe(true);
  expect(angleIsBetweenEps(PI, 0.0, PI, 1e-5)).toBe(true);
  // note: always calculated as going counter clockwise
  // going from PI to PI / 2 counter clockwise sweeps 0.0
  expect(angleIsBetweenEps(0.0, PI, PI / 2.0, 1e-5)).toBe(true);
});

test("isLeft", () => {
  const p0 = new Vector2(1.0, 1.0);
  const p1 = new Vector2(2.0, 2.0);
  expect(isLeft(p0, p1, new Vector2(0.0, 1.0))).toBe(true);
  expect(isLeft(p0, p1, new Vector2(1.0, 0.0))).toBe(false);
});

test("pointWithinArcSweep", () => {
  // defining an arc that projects an angle region covering all of
  // quadrant I (x positive, y positive space)
  const arcCenter = new Vector2(0.0, 0.0);
  const arcStart = new Vector2(1.0, 0.0);
  const arcEnd = new Vector2(0.0, 1.0);
  expect(
    pointWithinArcSweep(arcCenter, arcStart, arcEnd, false, new Vector2(1.0, 1.0), 1e-5),
  ).toBe(true);
  // check is fuzzy inclusive
  expect(
    pointWithinArcSweep(arcCenter, arcStart, arcEnd, false, new Vector2(1.0, 0.0), 1e-5),
  ).toBe(true);
  expect(
    pointWithinArcSweep(arcCenter, arcStart, arcEnd, false, new Vector2(0.0, 1.0), 1e-5),
  ).toBe(true);
});
