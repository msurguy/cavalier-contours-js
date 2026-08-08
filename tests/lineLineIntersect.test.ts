import { expect, test } from "vitest";
import { fuzzyEq } from "../src/core/fuzzy.js";
import { lineLineIntr, type LineLineIntr } from "../src/core/lineLineIntersect.js";
import { Vector2 } from "../src/core/vector2.js";

// Port of Rust `assert_case_eq!` macro — compares discriminated union cases with
// parametric values compared fuzzily.
function assertCaseEq(left: LineLineIntr, right: LineLineIntr): void {
  const matches =
    (left.kind === "noIntersect" && right.kind === "noIntersect") ||
    (left.kind === "trueIntersect" &&
      right.kind === "trueIntersect" &&
      fuzzyEq(left.seg1T, right.seg1T) &&
      fuzzyEq(left.seg2T, right.seg2T)) ||
    (left.kind === "falseIntersect" &&
      right.kind === "falseIntersect" &&
      fuzzyEq(left.seg1T, right.seg1T) &&
      fuzzyEq(left.seg2T, right.seg2T)) ||
    (left.kind === "overlapping" &&
      right.kind === "overlapping" &&
      fuzzyEq(left.seg2T0, right.seg2T0) &&
      fuzzyEq(left.seg2T1, right.seg2T1));

  if (!matches) {
    expect.fail(
      `intersect cases do not match: left: ${JSON.stringify(left)}, right: ${JSON.stringify(
        right,
      )}`,
    );
  }
}

const TEST_ROTATION_ANGLES: readonly number[] = [
  Math.PI / 8.0,
  Math.PI / 6.0,
  Math.PI / 4.0,
  Math.PI / 3.0,
  Math.PI / 2.0,
];

test("trueIntersect", () => {
  const u1 = new Vector2(-1.0, -1.0);
  const u2 = new Vector2(1.0, 1.0);
  const v1 = new Vector2(-1.0, 1.0);
  const v2 = new Vector2(1.0, -1.0);
  const result = lineLineIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, { kind: "trueIntersect", seg1T: 0.5, seg2T: 0.5 });
});

test("endPointStartPointTouchSameDirection", () => {
  const u1 = new Vector2(-1.0, -1.0);
  const u2 = new Vector2(1.0, 1.0);
  const v1 = new Vector2(1.0, 1.0);
  const v2 = new Vector2(2.0, 2.0);

  let result = lineLineIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, { kind: "trueIntersect", seg1T: 1.0, seg2T: 0.0 });

  // flip argument order
  result = lineLineIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, { kind: "trueIntersect", seg1T: 0.0, seg2T: 1.0 });

  // rotate v1->v2 should get same result
  for (const angle of TEST_ROTATION_ANGLES) {
    const v2Rotated = v2.rotateAbout(v1, angle);
    const result = lineLineIntr(u1, u2, v1, v2Rotated, 1e-5);
    assertCaseEq(result, { kind: "trueIntersect", seg1T: 1.0, seg2T: 0.0 });
  }
});

test("startPointsTouchOpposingDirection", () => {
  const u1 = new Vector2(0.0, 0.0);
  const u2 = new Vector2(1.0, 1.0);
  const v1 = new Vector2(0.0, 0.0);
  const v2 = new Vector2(-1.0, -1.0);

  let result = lineLineIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, { kind: "trueIntersect", seg1T: 0.0, seg2T: 0.0 });

  // flip argument order
  result = lineLineIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, { kind: "trueIntersect", seg1T: 0.0, seg2T: 0.0 });

  // rotate v1->v2 should get same result
  for (const angle of TEST_ROTATION_ANGLES) {
    const v2Rotated = v2.rotateAbout(v1, angle);
    const result = lineLineIntr(u1, u2, v1, v2Rotated, 1e-5);
    assertCaseEq(result, { kind: "trueIntersect", seg1T: 0.0, seg2T: 0.0 });
  }
});

test("falseIntersect", () => {
  const u1 = new Vector2(-1.0, -1.0);
  const u2 = new Vector2(-0.5, -0.5);
  const v1 = new Vector2(-1.0, 1.0);
  const v2 = new Vector2(1.0, -1.0);
  const result = lineLineIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, { kind: "falseIntersect", seg1T: 2.0, seg2T: 0.5 });
});

test("noIntersect", () => {
  const u1 = new Vector2(-1.0, -1.0);
  const u2 = new Vector2(1.0, 1.0);
  const v1 = new Vector2(0.0, 1.0);
  const v2 = new Vector2(1.0, 2.0);
  const result = lineLineIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, { kind: "noIntersect" });
});

test("noIntersectVertical", () => {
  const u1 = new Vector2(2.0, 0.0);
  const u2 = new Vector2(2.0, 1.0);
  const v1 = new Vector2(-1.0, -1.0);
  const v2 = new Vector2(-1.0, -2.0);
  const result = lineLineIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, { kind: "noIntersect" });
});

test("noIntersectHorizontal", () => {
  const u1 = new Vector2(-2.0, -1.0);
  const u2 = new Vector2(2.0, -1.0);
  const v1 = new Vector2(-1.0, 5.0);
  const v2 = new Vector2(1.0, 5.0);
  const result = lineLineIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, { kind: "noIntersect" });
});

test("overlappingIntersect", () => {
  const u1 = new Vector2(-1.0, -1.0);
  const u2 = new Vector2(1.0, 1.0);
  const v1 = new Vector2(0.0, 0.0);
  const v2 = new Vector2(0.5, 0.5);
  const result = lineLineIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, { kind: "overlapping", seg2T0: 0.0, seg2T1: 1.0 });
});

test("pointIntersect", () => {
  const u1 = new Vector2(-1.0, -1.0);
  const u2 = new Vector2(1.0, 1.0);
  const v1 = new Vector2(0.0, 0.0);
  const v2 = new Vector2(0.0, 0.0);
  let result = lineLineIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, { kind: "trueIntersect", seg1T: 0.5, seg2T: 0.0 });

  // flip arg order
  result = lineLineIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, { kind: "trueIntersect", seg1T: 0.0, seg2T: 0.5 });
});

test("pointIntersectVertical", () => {
  const u1 = new Vector2(0.0, -1.0);
  const u2 = new Vector2(0.0, 1.0);
  const v1 = new Vector2(0.0, 0.0);
  const v2 = new Vector2(0.0, 0.0);
  let result = lineLineIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, { kind: "trueIntersect", seg1T: 0.5, seg2T: 0.0 });

  // flip arg order
  result = lineLineIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, { kind: "trueIntersect", seg1T: 0.0, seg2T: 0.5 });
});

test("pointIntersectHorizontal", () => {
  const u1 = new Vector2(-1.0, 0.0);
  const u2 = new Vector2(1.0, 0.0);
  const v1 = new Vector2(0.0, 0.0);
  const v2 = new Vector2(0.0, 0.0);
  let result = lineLineIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, { kind: "trueIntersect", seg1T: 0.5, seg2T: 0.0 });

  // flip arg order
  result = lineLineIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, { kind: "trueIntersect", seg1T: 0.0, seg2T: 0.5 });
});

test("pointIntersectAtEnd", () => {
  const u1 = new Vector2(-1.0, -1.0);
  const u2 = new Vector2(1.0, 1.0);
  let v1 = u1;
  let v2 = u1;
  let result = lineLineIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, { kind: "trueIntersect", seg1T: 0.0, seg2T: 0.0 });

  // flip arg order
  result = lineLineIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, { kind: "trueIntersect", seg1T: 0.0, seg2T: 0.0 });

  // other end
  v1 = u2;
  v2 = u2;
  result = lineLineIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, { kind: "trueIntersect", seg1T: 1.0, seg2T: 0.0 });

  // flip arg order
  result = lineLineIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, { kind: "trueIntersect", seg1T: 0.0, seg2T: 1.0 });
});

test("entirelyOverlappingSameDirection", () => {
  const u1 = new Vector2(-1.0, -1.0);
  const u2 = new Vector2(1.0, 1.0);
  const v1 = u1;
  const v2 = u2;
  const result = lineLineIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, { kind: "overlapping", seg2T0: 0.0, seg2T1: 1.0 });

  // rotate both lines together
  for (const angle of TEST_ROTATION_ANGLES) {
    const u2Rotated = u2.rotateAbout(u1, angle);
    const v2Rotated = v2.rotateAbout(v1, angle);
    const result = lineLineIntr(u1, u2Rotated, v1, v2Rotated, 1e-5);
    assertCaseEq(result, { kind: "overlapping", seg2T0: 0.0, seg2T1: 1.0 });
  }
});

test("entirelyOverlappingOpposingDirection", () => {
  const u1 = new Vector2(-1.0, -1.0);
  const u2 = new Vector2(1.0, 1.0);
  const v1 = u2;
  const v2 = u1;
  let result = lineLineIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, { kind: "overlapping", seg2T0: 0.0, seg2T1: 1.0 });

  // flip arg order
  result = lineLineIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, { kind: "overlapping", seg2T0: 0.0, seg2T1: 1.0 });

  // rotate both lines together
  for (const angle of TEST_ROTATION_ANGLES) {
    const u2Rotated = u2.rotateAbout(u1, angle);
    const v1Rotated = v1.rotateAbout(v2, angle);
    const result = lineLineIntr(u1, u2Rotated, v1Rotated, v2, 1e-5);
    assertCaseEq(result, { kind: "overlapping", seg2T0: 0.0, seg2T1: 1.0 });
  }
});
