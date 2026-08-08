// Port of Rust `tests/test_pline_seg_intersect.rs`.
import { expect, test } from "vitest";
import { bulgeFromAngle } from "../src/core/mathUtils.js";
import { Vector2 } from "../src/core/vector2.js";
import { plineSegIntr, type PlineSegIntr } from "../src/polyline/plineSegIntersect.js";
import { PlineVertex } from "../src/polyline/plineVertex.js";

const FRAC_PI_2 = Math.PI / 2.0;

// Port of Rust `assert_case_eq!` macro — compares discriminated union cases with
// point values compared fuzzily.
function assertCaseEq(left: PlineSegIntr, right: PlineSegIntr): void {
  const matches =
    (left.kind === "noIntersect" && right.kind === "noIntersect") ||
    ((left.kind === "tangentIntersect" || left.kind === "oneIntersect") &&
      left.kind === right.kind &&
      left.point.fuzzyEq(right.point)) ||
    ((left.kind === "twoIntersects" ||
      left.kind === "overlappingLines" ||
      left.kind === "overlappingArcs") &&
      left.kind === right.kind &&
      left.point1.fuzzyEq(right.point1) &&
      left.point2.fuzzyEq(right.point2));

  if (!matches) {
    expect.fail(
      `intersect cases do not match: left: ${JSON.stringify(left)}, right: ${JSON.stringify(
        right,
      )}`,
    );
  }
}

test("arcLineNoIntersect", () => {
  const v1 = new PlineVertex(0.0, 0.0, 1.0);
  const v2 = new PlineVertex(2.0, 0.0, 0.0);
  const u1 = new PlineVertex(0.0, 1.0, 0.0);
  const u2 = new PlineVertex(2.0, 3.0, 0.0);
  const result = plineSegIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, { kind: "noIntersect" });
});

test("lineArcNoIntersect", () => {
  const v1 = new PlineVertex(0.0, 1.0, 0.0);
  const v2 = new PlineVertex(2.0, 3.0, 0.0);
  const u1 = new PlineVertex(0.0, 0.0, 1.0);
  const u2 = new PlineVertex(2.0, 0.0, 0.0);
  const result = plineSegIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, { kind: "noIntersect" });
});

test("overlappingLines", () => {
  const v1 = new PlineVertex(3.0, 3.0, 0.0);
  const v2 = new PlineVertex(1.0, 1.0, 0.0);
  const u1 = new PlineVertex(1.0, 1.0, 0.0);
  const u2 = new PlineVertex(2.0, 2.0, 0.0);
  const result = plineSegIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, {
    kind: "overlappingLines",
    point1: new Vector2(1.0, 1.0),
    point2: new Vector2(2.0, 2.0),
  });
});

test("overlappingLinesReverseDir", () => {
  const v1 = new PlineVertex(1.0, 1.0, 0.0);
  const v2 = new PlineVertex(3.0, 3.0, 0.0);
  const u1 = new PlineVertex(2.0, 2.0, 0.0);
  const u2 = new PlineVertex(1.0, 1.0, 0.0);
  const result = plineSegIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, {
    kind: "overlappingLines",
    point1: new Vector2(2.0, 2.0),
    point2: new Vector2(1.0, 1.0),
  });
});

test("overlappingSameArcs", () => {
  const v1 = new PlineVertex(1.0, 1.0, 1.0);
  const v2 = new PlineVertex(3.0, 3.0, 0.0);
  const u1 = new PlineVertex(1.0, 1.0, 1.0);
  const u2 = new PlineVertex(3.0, 3.0, 0.0);
  const result = plineSegIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, {
    kind: "overlappingArcs",
    point1: new Vector2(1.0, 1.0),
    point2: new Vector2(3.0, 3.0),
  });
});

test("overlappingSameArcsReverseDir", () => {
  const v1 = new PlineVertex(3.0, 3.0, -1.0);
  const v2 = new PlineVertex(1.0, 1.0, 0.0);
  const u1 = new PlineVertex(1.0, 1.0, 1.0);
  const u2 = new PlineVertex(3.0, 3.0, 0.0);
  const result = plineSegIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, {
    kind: "overlappingArcs",
    point1: new Vector2(1.0, 1.0),
    point2: new Vector2(3.0, 3.0),
  });
});

test("arcArcEndPointsTouch", () => {
  const v1 = new PlineVertex(3.0, 3.0, 1.0);
  const v2 = new PlineVertex(1.0, 1.0, 0.0);
  const u1 = new PlineVertex(1.0, 1.0, 1.0);
  const u2 = new PlineVertex(3.0, 3.0, 0.0);
  const result = plineSegIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, {
    kind: "twoIntersects",
    point1: new Vector2(1.0, 1.0),
    point2: new Vector2(3.0, 3.0),
  });
});

test("arcArcEndPointsTouchReverseDir", () => {
  const v1 = new PlineVertex(1.0, 1.0, -1.0);
  const v2 = new PlineVertex(3.0, 3.0, 0.0);
  const u1 = new PlineVertex(1.0, 1.0, 1.0);
  const u2 = new PlineVertex(3.0, 3.0, 0.0);
  let result = plineSegIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, {
    kind: "twoIntersects",
    point1: new Vector2(1.0, 1.0),
    point2: new Vector2(3.0, 3.0),
  });

  // reverse parameter order should yield the same result
  result = plineSegIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, {
    kind: "twoIntersects",
    point1: new Vector2(1.0, 1.0),
    point2: new Vector2(3.0, 3.0),
  });

  // changing direction of arc2 should yield the same result BUT point1/point2 ordered according to
  // second segment direction
  const u1b = new PlineVertex(3.0, 3.0, -1.0);
  const u2b = new PlineVertex(1.0, 1.0, 0.0);
  result = plineSegIntr(v1, v2, u1b, u2b, 1e-5);
  assertCaseEq(result, {
    kind: "twoIntersects",
    point1: new Vector2(3.0, 3.0),
    point2: new Vector2(1.0, 1.0),
  });
});

test("arc2WithinArc1Overlapping", () => {
  const v1 = new PlineVertex(1.0, 1.0, 1.0);
  const v2 = new PlineVertex(3.0, 1.0, 0.0);

  const bulge = bulgeFromAngle(FRAC_PI_2);
  const u1 = new PlineVertex(2.0, 0.0, bulge);
  const u2 = new PlineVertex(3.0, 1.0, 0.0);
  const result = plineSegIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, {
    kind: "overlappingArcs",
    point1: new Vector2(2.0, 0.0),
    point2: new Vector2(3.0, 1.0),
  });
});

test("arc1WithinArc2Overlapping", () => {
  const v1 = new PlineVertex(1.0, 1.0, 1.0);
  const v2 = new PlineVertex(3.0, 1.0, 0.0);

  const bulge = bulgeFromAngle(FRAC_PI_2);
  const u1 = new PlineVertex(2.0, 0.0, bulge);
  const u2 = new PlineVertex(3.0, 1.0, 0.0);
  const result = plineSegIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, {
    kind: "overlappingArcs",
    point1: new Vector2(2.0, 0.0),
    point2: new Vector2(3.0, 1.0),
  });
});

test("arc2WithinArc1OverlappingReverseDir", () => {
  const v1 = new PlineVertex(1.0, 1.0, 1.0);
  const v2 = new PlineVertex(3.0, 1.0, 0.0);

  const bulge = bulgeFromAngle(FRAC_PI_2);
  const u1 = new PlineVertex(3.0, 1.0, -bulge);
  const u2 = new PlineVertex(2.0, 0.0, 0.0);
  const result = plineSegIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, {
    kind: "overlappingArcs",
    point1: new Vector2(3.0, 1.0),
    point2: new Vector2(2.0, 0.0),
  });
});

test("arc1WithinArc2OverlappingReverseDir", () => {
  const v1 = new PlineVertex(1.0, 1.0, 1.0);
  const v2 = new PlineVertex(3.0, 1.0, 0.0);

  const bulge = bulgeFromAngle(FRAC_PI_2);
  const u1 = new PlineVertex(3.0, 1.0, -bulge);
  const u2 = new PlineVertex(2.0, 0.0, 0.0);
  const result = plineSegIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, {
    kind: "overlappingArcs",
    point1: new Vector2(2.0, 0.0),
    point2: new Vector2(3.0, 1.0),
  });
});

test("arcArcPartialOverlap", () => {
  const v1 = new PlineVertex(1.0, 1.0, 1.0);
  const v2 = new PlineVertex(3.0, 1.0, 0.0);

  const u1 = new PlineVertex(2.0, 0.0, 1.0);
  const u2 = new PlineVertex(2.0, 2.0, 0.0);
  const result = plineSegIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, {
    kind: "overlappingArcs",
    point1: new Vector2(2.0, 0.0),
    point2: new Vector2(3.0, 1.0),
  });
});

test("arcArcPartialOverlapFlipped", () => {
  const v1 = new PlineVertex(1.0, 1.0, 1.0);
  const v2 = new PlineVertex(3.0, 1.0, 0.0);

  const u1 = new PlineVertex(2.0, 0.0, 1.0);
  const u2 = new PlineVertex(2.0, 2.0, 0.0);
  const result = plineSegIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, {
    kind: "overlappingArcs",
    point1: new Vector2(2.0, 0.0),
    point2: new Vector2(3.0, 1.0),
  });
});

test("arcArcPartialOverlapArc2ReverseDir", () => {
  const v1 = new PlineVertex(1.0, 1.0, 1.0);
  const v2 = new PlineVertex(3.0, 1.0, 0.0);

  const u1 = new PlineVertex(2.0, 2.0, -1.0);
  const u2 = new PlineVertex(2.0, 0.0, 0.0);
  const result = plineSegIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, {
    kind: "overlappingArcs",
    point1: new Vector2(3.0, 1.0),
    point2: new Vector2(2.0, 0.0),
  });
});

test("arcArcPartialOverlapArc2ReverseDirFlipped", () => {
  const v1 = new PlineVertex(1.0, 1.0, 1.0);
  const v2 = new PlineVertex(3.0, 1.0, 0.0);

  const u1 = new PlineVertex(2.0, 2.0, -1.0);
  const u2 = new PlineVertex(2.0, 0.0, 0.0);
  const result = plineSegIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, {
    kind: "overlappingArcs",
    point1: new Vector2(2.0, 0.0),
    point2: new Vector2(3.0, 1.0),
  });
});

test("arcArcPartialOverlapArc1ReverseDir", () => {
  const v1 = new PlineVertex(3.0, 1.0, -1.0);
  const v2 = new PlineVertex(1.0, 1.0, 0.0);

  const u1 = new PlineVertex(2.0, 0.0, 1.0);
  const u2 = new PlineVertex(2.0, 2.0, 0.0);
  const result = plineSegIntr(v1, v2, u1, u2, 1e-5);
  assertCaseEq(result, {
    kind: "overlappingArcs",
    point1: new Vector2(2.0, 0.0),
    point2: new Vector2(3.0, 1.0),
  });
});

test("arcArcPartialOverlapArc1ReverseDirFlipped", () => {
  const v1 = new PlineVertex(3.0, 1.0, -1.0);
  const v2 = new PlineVertex(1.0, 1.0, 0.0);

  const u1 = new PlineVertex(2.0, 0.0, 1.0);
  const u2 = new PlineVertex(2.0, 2.0, 0.0);
  const result = plineSegIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, {
    kind: "overlappingArcs",
    point1: new Vector2(3.0, 1.0),
    point2: new Vector2(2.0, 0.0),
  });
});

test("arcArcOppositeDirectionTouchAtEndsBug", () => {
  // This test case reproduces the bug where arcs have the same radius and center but opposite
  // directions and only touch at the end points.
  // The bug was that when same_direction_arcs = false, the code would return u1.pos()
  // as the intersection point, but after direction adjustment, u1.pos() is actually
  // the END of arc2, not the start. The actual intersection should be at u2.pos().
  //
  // Original issue that found it: https://github.com/jbuckmccready/cavalier_contours/issues/42

  // Arc1
  const v1 = new PlineVertex(-189.0, -196.91384910249, 0.553407781718062);
  const v2 = new PlineVertex(-170.999999999999, -225.631646989572, -0.553407781718061);

  // Arc2
  const u1 = new PlineVertex(-153.0, -196.91384910249, -0.553407781718061);
  const u2 = new PlineVertex(-171.0, -225.631646989571, -0.553407781718061);

  let result = plineSegIntr(v1, v2, u1, u2, 1e-5);

  // The arcs should intersect at u2.pos() (where arc1 and arc2 ends),
  // NOT at u1.pos() (which is ~34 units away from the actual intersection)
  assertCaseEq(result, {
    kind: "oneIntersect",
    point: new Vector2(-171.0, -225.631646989571), // u2.pos()
  });

  // reverse parameter order should yield the same result
  result = plineSegIntr(u1, u2, v1, v2, 1e-5);
  assertCaseEq(result, {
    kind: "oneIntersect",
    point: new Vector2(-171.0, -225.631646989571), // u2.pos()
  });

  // changing direction of arc2 should yield the same result
  const u1b = new PlineVertex(-171.0, -225.631646989571, 0.553407781718062);
  const u2b = new PlineVertex(-153.0, -196.91384910249, -0.553407781718061);
  result = plineSegIntr(v1, v2, u1b, u2b, 1e-5);
  assertCaseEq(result, {
    kind: "oneIntersect",
    point: new Vector2(-171.0, -225.631646989571),
  });
});
