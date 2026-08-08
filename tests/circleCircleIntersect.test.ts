import { expect, test } from "vitest";
import { circleCircleIntr, type CircleCircleIntr } from "../src/core/circleCircleIntersect.js";
import { Vector2 } from "../src/core/vector2.js";

// Port of Rust `assert_case_eq!` macro — compares discriminated union cases with
// intersect points compared fuzzily.
function assertCaseEq(left: CircleCircleIntr, right: CircleCircleIntr): void {
  const matches =
    (left.kind === "noIntersect" && right.kind === "noIntersect") ||
    (left.kind === "tangentIntersect" &&
      right.kind === "tangentIntersect" &&
      left.point.fuzzyEq(right.point)) ||
    (left.kind === "twoIntersects" &&
      right.kind === "twoIntersects" &&
      left.point1.fuzzyEq(right.point1) &&
      left.point2.fuzzyEq(right.point2)) ||
    (left.kind === "overlapping" && right.kind === "overlapping");

  if (!matches) {
    expect.fail(
      `intersect cases do not match: left: ${JSON.stringify(left)}, right: ${JSON.stringify(
        right,
      )}`,
    );
  }
}

test("noIntersectOutside", () => {
  const r1 = 1.0;
  const c1 = new Vector2(-1.0, -1.0);
  const r2 = 0.5;
  const c2 = new Vector2(0.0, 5.0);
  const result = circleCircleIntr(r1, c1, r2, c2, 1e-5);
  assertCaseEq(result, { kind: "noIntersect" });
});

test("noIntersectInside", () => {
  const r1 = 5.0;
  const c1 = new Vector2(-1.0, -1.0);
  const r2 = 0.5;
  const c2 = new Vector2(1.0, 1.0);
  const result = circleCircleIntr(r1, c1, r2, c2, 1e-5);
  assertCaseEq(result, { kind: "noIntersect" });
});

test("tangentIntersectOutside", () => {
  const r1 = 1.0;
  const c1 = new Vector2(-1.0, 1.0);
  const r2 = 0.5;
  const c2 = new Vector2(0.5, 1.0);
  const result = circleCircleIntr(r1, c1, r2, c2, 1e-5);
  assertCaseEq(result, { kind: "tangentIntersect", point: new Vector2(0.0, 1.0) });
});

test("tangentIntersectInside", () => {
  const r1 = 3.0;
  const c1 = new Vector2(0.0, 1.0);
  const r2 = 4.0;
  const c2 = new Vector2(0.0, 0.0);
  const result = circleCircleIntr(r1, c1, r2, c2, 1e-5);
  assertCaseEq(result, { kind: "tangentIntersect", point: new Vector2(0.0, 4.0) });
});

test("twoIntersects", () => {
  const r1 = 3.0;
  const c1 = new Vector2(0.0, 1.0);
  const r2 = 4.0;
  const c2 = new Vector2(5.0, 5.0);
  const result = circleCircleIntr(r1, c1, r2, c2, 1e-5);
  const expectedPoint1 = new Vector2(2.945782625365772, 1.567771718292785);
  const expectedPoint2 = new Vector2(1.2005588380488623, 3.749301452438922);
  assertCaseEq(result, {
    kind: "twoIntersects",
    point1: expectedPoint1,
    point2: expectedPoint2,
  });
});

test("overlapping", () => {
  const r1 = 1.0;
  const c1 = new Vector2(-1.0, 1.0);
  const r2 = r1;
  const c2 = c1;
  const result = circleCircleIntr(r1, c1, r2, c2, 1e-5);
  assertCaseEq(result, { kind: "overlapping" });
});
