import { expect, test } from "vitest";
import { fuzzyEq } from "../src/core/fuzzy.js";
import { lineCircleIntr, type LineCircleIntr } from "../src/core/lineCircleIntersect.js";
import { Vector2 } from "../src/core/vector2.js";

// Port of Rust `assert_case_eq!` macro — compares discriminated union cases with
// parametric values compared fuzzily.
function assertCaseEq(left: LineCircleIntr, right: LineCircleIntr): void {
  const matches =
    (left.kind === "noIntersect" && right.kind === "noIntersect") ||
    (left.kind === "tangentIntersect" &&
      right.kind === "tangentIntersect" &&
      fuzzyEq(left.t0, right.t0)) ||
    (left.kind === "twoIntersects" &&
      right.kind === "twoIntersects" &&
      fuzzyEq(left.t0, right.t0) &&
      fuzzyEq(left.t1, right.t1));

  if (!matches) {
    expect.fail(
      `intersect cases do not match: left: ${JSON.stringify(left)}, right: ${JSON.stringify(
        right,
      )}`,
    );
  }
}

test("noIntersect", () => {
  const p0 = new Vector2(-1.0, -1.0);
  const p1 = new Vector2(1.0, 1.0);
  const circleCenter = new Vector2(0.0, 5.0);
  const radius = 0.5;
  const result = lineCircleIntr(p0, p1, radius, circleCenter, 1e-5);
  assertCaseEq(result, { kind: "noIntersect" });
});

test("noIntersectVertical", () => {
  const p0 = new Vector2(0.0, -1.0);
  const p1 = new Vector2(0.0, 1.0);
  const circleCenter = new Vector2(2.0, 0.0);
  const radius = 0.5;
  const result = lineCircleIntr(p0, p1, radius, circleCenter, 1e-5);
  assertCaseEq(result, { kind: "noIntersect" });
});

test("noIntersectHorizontal", () => {
  const p0 = new Vector2(1.0, 1.0);
  const p1 = new Vector2(3.0, 1.0);
  const circleCenter = new Vector2(2.0, -2.0);
  const radius = 0.5;
  const result = lineCircleIntr(p0, p1, radius, circleCenter, 1e-5);
  assertCaseEq(result, { kind: "noIntersect" });
});

test("twoIntersectsTrue", () => {
  const p0 = new Vector2(-1.0, -1.0);
  const p1 = new Vector2(1.0, 1.0);
  // placing edge of circle at (0, 0)
  const radius = 0.5;
  const offset = Math.sqrt((radius * radius) / 2.0);
  const circleCenter = new Vector2(offset, offset);
  const expectedT1IntrPointX = 2.0 * offset;
  const expectedT1 = (expectedT1IntrPointX - p0.x) / (p1.x - p0.x);
  const result = lineCircleIntr(p0, p1, radius, circleCenter, 1e-5);
  assertCaseEq(result, { kind: "twoIntersects", t0: 0.5, t1: expectedT1 });
});

test("twoIntersectsSegInsideVertical", () => {
  const p0 = new Vector2(0.0, -1.0);
  const p1 = new Vector2(0.0, 1.0);
  const circleCenter = new Vector2(0.0, 0.0);
  const radius = 1.0;
  const result = lineCircleIntr(p0, p1, radius, circleCenter, 1e-5);
  assertCaseEq(result, { kind: "twoIntersects", t0: 0.0, t1: 1.0 });
});

test("twoIntersectsSegInsideHorizontal", () => {
  const p0 = new Vector2(-1.0, 0.0);
  const p1 = new Vector2(1.0, 0.0);
  const circleCenter = new Vector2(0.0, 0.0);
  const radius = 1.0;
  const result = lineCircleIntr(p0, p1, radius, circleCenter, 1e-5);
  assertCaseEq(result, { kind: "twoIntersects", t0: 0.0, t1: 1.0 });
});

test("twoIntersectsSegTouching", () => {
  const p0 = new Vector2(0.0, -1.0);
  const p1 = new Vector2(0.0, 1.0);
  const circleCenter = new Vector2(0.0, 0.0);
  const radius = 1.0;
  const result = lineCircleIntr(p0, p1, radius, circleCenter, 1e-5);
  assertCaseEq(result, { kind: "twoIntersects", t0: 0.0, t1: 1.0 });
});

test("tangentIntersectVertical", () => {
  const p0 = new Vector2(0.0, -1.0);
  const p1 = new Vector2(0.0, 1.0);
  const circleCenter = new Vector2(1.0, 0.0);
  const radius = 1.0;
  const result = lineCircleIntr(p0, p1, radius, circleCenter, 1e-5);
  assertCaseEq(result, { kind: "tangentIntersect", t0: 0.5 });
});

test("tangentIntersectHorizontal", () => {
  const p0 = new Vector2(-1.0, 0.0);
  const p1 = new Vector2(1.0, 0.0);
  const circleCenter = new Vector2(0.0, -1.0);
  const radius = 1.0;
  const result = lineCircleIntr(p0, p1, radius, circleCenter, 1e-5);
  assertCaseEq(result, { kind: "tangentIntersect", t0: 0.5 });
});

test("tangentAtStartPoint", () => {
  // this is a case that previously failed due to numeric stability issues
  const p0 = new Vector2(161.29, 113.665);
  const p1 = new Vector2(167.64, 113.665);
  const circleCenter = new Vector2(161.29, 114.30000000000001);
  const radius = 0.634999999999998;
  const result = lineCircleIntr(p0, p1, radius, circleCenter, 1e-5);
  assertCaseEq(result, { kind: "tangentIntersect", t0: 0.0 });
});
