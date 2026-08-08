// Port of the inline `#[cfg(test)]` modules in `polyline/internal/pline_intersects.rs`
// (local_self_intersect_tests, global_self_intersect_tests, find_intersects_tests, and
// sort_and_join_overlapping_intersects_tests) plus the doc-test examples on the
// `visit_self_intersects`/`scan_for_self_intersect` trait methods in `polyline/traits.rs`
// wired through `plineSourceBase.ts`.
import { describe, expect, test } from "vitest";
import { bulgeFromAngle, TAU } from "../src/core/mathUtils.js";
import { Vector2 } from "../src/core/vector2.js";
import type { StaticAabb2dIndex } from "../src/index2d/staticAabb2dIndex.js";
import { plineClosed, plineOpen } from "../src/polyline/construct.js";
import { sortAndJoinOverlappingIntersects } from "../src/polyline/internal/overlappingSlices.js";
import {
  findIntersects,
  scanForIntersect,
  visitGlobalSelfIntersects,
  visitLocalSelfIntersects,
} from "../src/polyline/internal/plineIntersects.js";
import type {
  PlineBasicIntersect,
  PlineIntersectVisitor,
  PlineIntersectsCollection,
  PlineOverlappingIntersect,
} from "../src/polyline/plineTypes.js";
import { PlineVertex } from "../src/polyline/plineVertex.js";
import { Polyline } from "../src/polyline/polyline.js";
import {
  expectFuzzyEq,
  expectSome,
  expectVector2FuzzyEq,
  expectVertexFuzzyEq,
} from "./testUtils/fuzzyAssert.js";

const FRAC_PI_2 = Math.PI / 2.0;

/** Collects visited intersects into a `PlineIntersectsCollection` (Rust test visitor closure). */
function collectingVisitor(): {
  intrs: PlineBasicIntersect[];
  overlappingIntrs: PlineOverlappingIntersect[];
  visitor: PlineIntersectVisitor;
} {
  const intrs: PlineBasicIntersect[] = [];
  const overlappingIntrs: PlineOverlappingIntersect[] = [];
  const visitor: PlineIntersectVisitor = (intr) => {
    if (intr.kind === "basic") {
      intrs.push(intr);
    } else {
      overlappingIntrs.push(intr);
    }
  };
  return { intrs, overlappingIntrs, visitor };
}

describe("local_self_intersect_tests", () => {
  function localSelfIntersects(
    polyline: Polyline,
    posEqualEps: number,
  ): PlineIntersectsCollection {
    const { intrs, overlappingIntrs, visitor } = collectingVisitor();

    visitLocalSelfIntersects(polyline, visitor, posEqualEps);

    return { basicIntersects: intrs, overlappingIntersects: overlappingIntrs };
  }

  test("empty_polyline", () => {
    const pline = new Polyline();
    const intrs = localSelfIntersects(pline, 1e-5);

    expect(intrs.basicIntersects.length).toBe(0);
    expect(intrs.overlappingIntersects.length).toBe(0);
  });

  test("single_vertex", () => {
    const pline = new Polyline();
    pline.add(0.0, 0.0, 1.0);
    const intrs = localSelfIntersects(pline, 1e-5);
    expect(intrs.basicIntersects.length).toBe(0);
    expect(intrs.overlappingIntersects.length).toBe(0);
  });

  test("circle_no_intersects", () => {
    const pline = plineClosed([
      [0.0, 0.0, 1.0],
      [2.0, 0.0, 1.0],
    ]);
    const intrs = localSelfIntersects(pline, 1e-5);
    expect(intrs.basicIntersects.length).toBe(0);
    expect(intrs.overlappingIntersects.length).toBe(0);
  });

  test("half_circle_overlapping_self", () => {
    const pline = plineClosed([
      [0.0, 0.0, 1.0],
      [2.0, 0.0, -1.0],
    ]);
    const intrs = localSelfIntersects(pline, 1e-5);
    expect(intrs.basicIntersects.length).toBe(0);
    expect(intrs.overlappingIntersects.length).toBe(1);
    expect(intrs.overlappingIntersects[0].startIndex1).toBe(0);
    expect(intrs.overlappingIntersects[0].startIndex2).toBe(1);
    expectVector2FuzzyEq(intrs.overlappingIntersects[0].point1, pline.at(0).pos());
    expectVector2FuzzyEq(intrs.overlappingIntersects[0].point2, pline.at(1).pos());
  });

  test("short_open_polyline_circle", () => {
    const pline = plineOpen([
      [0.0, 0.0, 1.0],
      [2.0, 0.0, 1.0],
      [0.0, 0.0, 0.0],
    ]);
    const intrs = localSelfIntersects(pline, 1e-5);
    expect(intrs.basicIntersects.length).toBe(1);
    expect(intrs.overlappingIntersects.length).toBe(0);
    expect(intrs.basicIntersects[0].startIndex1).toBe(0);
    expect(intrs.basicIntersects[0].startIndex2).toBe(1);
    expectVector2FuzzyEq(intrs.basicIntersects[0].point, pline.at(2).pos());
  });

  test("long_open_polyline_circle", () => {
    const pline = plineOpen([
      [0.0, 0.0, bulgeFromAngle(FRAC_PI_2)],
      [1.0, -1.0, bulgeFromAngle(FRAC_PI_2)],
      [2.0, 0.0, bulgeFromAngle(FRAC_PI_2)],
      [1.0, 1.0, bulgeFromAngle(FRAC_PI_2)],
      [0.0, 0.0, 0.0],
    ]);
    const intrs = localSelfIntersects(pline, 1e-5);
    expect(intrs.basicIntersects.length).toBe(0);
    expect(intrs.overlappingIntersects.length).toBe(0);
  });
});

describe("global_self_intersect_tests", () => {
  function globalSelfIntersects(
    polyline: Polyline,
    aabbIndex: StaticAabb2dIndex,
  ): PlineIntersectsCollection {
    const { intrs, overlappingIntrs, visitor } = collectingVisitor();

    visitGlobalSelfIntersects(polyline, aabbIndex, visitor, 1e-5);

    return { basicIntersects: intrs, overlappingIntersects: overlappingIntrs };
  }

  test("circle_no_intersects", () => {
    const pline = plineClosed([
      [0.0, 0.0, 1.0],
      [2.0, 0.0, 1.0],
    ]);
    const intrs = globalSelfIntersects(pline, pline.createApproxAabbIndex());
    expect(intrs.basicIntersects.length).toBe(0);
    expect(intrs.overlappingIntersects.length).toBe(0);

    const plineAsLines = expectSome(pline.arcsToApproxLines(1e-2), "expected approx lines");
    const intrs2 = globalSelfIntersects(plineAsLines, plineAsLines.createApproxAabbIndex());

    expect(intrs2.basicIntersects.length).toBe(0);
    expect(intrs2.overlappingIntersects.length).toBe(0);
  });

  test("half_circle_overlapping_self", () => {
    const pline = plineClosed([
      [0.0, 0.0, 1.0],
      [2.0, 0.0, -1.0],
    ]);
    const intrs = globalSelfIntersects(pline, pline.createApproxAabbIndex());
    expect(intrs.basicIntersects.length).toBe(0);
    expect(intrs.overlappingIntersects.length).toBe(0);
  });

  test("short_open_polyline_circle", () => {
    // does self intersect at end but is local self intersect
    const pline = plineOpen([
      [0.0, 0.0, 1.0],
      [2.0, 0.0, 1.0],
      [0.0, 0.0, 0.0],
    ]);
    const intrs = globalSelfIntersects(pline, pline.createApproxAabbIndex());
    expect(intrs.basicIntersects.length).toBe(0);
    expect(intrs.overlappingIntersects.length).toBe(0);

    // self intersect at end point is returned since not local self intersect
    const plineAsLines = expectSome(pline.arcsToApproxLines(1e-2), "expected approx lines");
    const intrs2 = globalSelfIntersects(plineAsLines, plineAsLines.createApproxAabbIndex());

    expect(intrs2.basicIntersects.length).toBe(1);
    expect(intrs2.overlappingIntersects.length).toBe(0);

    expect(intrs2.basicIntersects[0].startIndex1).toBe(0);
    expect(intrs2.basicIntersects[0].startIndex2).toBe(plineAsLines.vertexCount - 2);

    expectVector2FuzzyEq(intrs2.basicIntersects[0].point, new Vector2(0.0, 0.0));
  });

  test("long_open_polyline_circle", () => {
    const pline = plineOpen([
      [0.0, 0.0, bulgeFromAngle(FRAC_PI_2)],
      [1.0, -1.0, bulgeFromAngle(FRAC_PI_2)],
      [2.0, 0.0, bulgeFromAngle(FRAC_PI_2)],
      [1.0, 1.0, bulgeFromAngle(FRAC_PI_2)],
      [0.0, 0.0, 0.0],
    ]);
    const intrs = globalSelfIntersects(pline, pline.createApproxAabbIndex());
    expect(intrs.basicIntersects.length).toBe(1);
    expect(intrs.overlappingIntersects.length).toBe(0);
    expect(intrs.basicIntersects[0].startIndex1).toBe(0);
    expect(intrs.basicIntersects[0].startIndex2).toBe(3);
    expectVector2FuzzyEq(intrs.basicIntersects[0].point, pline.at(4).pos(), 1e-5);
  });
});

describe("find_intersects_tests", () => {
  test("open_polylines_end_touch_start", () => {
    // two open polylines end point touching start point
    const pline1 = plineOpen([
      [0.0, 0.0, 0.0],
      [1.0, 1.0, 0.0],
    ]);

    const pline2 = plineOpen([
      [-1.0, -1.0, 0.0],
      [0.0, 0.0, 0.0],
    ]);

    const intrs = findIntersects(pline1, pline2, {});

    expect(intrs.basicIntersects.length).toBe(1);
    expect(intrs.overlappingIntersects.length).toBe(0);
    expect(intrs.basicIntersects[0].startIndex1).toBe(0);
    expect(intrs.basicIntersects[0].startIndex2).toBe(0);
    expectVector2FuzzyEq(intrs.basicIntersects[0].point, new Vector2(0.0, 0.0));
  });

  test("open_polylines_end_touch_start_flipped", () => {
    const pline1 = plineOpen([
      [-1.0, -1.0, 0.0],
      [0.0, 0.0, 0.0],
    ]);

    const pline2 = plineOpen([
      [0.0, 0.0, 0.0],
      [1.0, 1.0, 0.0],
    ]);

    const intrs = findIntersects(pline1, pline2, {});

    expect(intrs.basicIntersects.length).toBe(1);
    expect(intrs.overlappingIntersects.length).toBe(0);
    expect(intrs.basicIntersects[0].startIndex1).toBe(0);
    expect(intrs.basicIntersects[0].startIndex2).toBe(0);
    expectVector2FuzzyEq(intrs.basicIntersects[0].point, new Vector2(0.0, 0.0));
  });

  test("open_polylines_start_points_touch", () => {
    // two open polylines start point touching start point
    const pline1 = plineOpen([
      [0.0, 0.0, 0.0],
      [1.0, 1.0, 0.0],
    ]);

    const pline2 = plineOpen([
      [0.0, 0.0, 0.0],
      [-1.0, -1.0, 0.0],
    ]);

    const intrs = findIntersects(pline1, pline2, {});

    expect(intrs.basicIntersects.length).toBe(1);
    expect(intrs.overlappingIntersects.length).toBe(0);
    expect(intrs.basicIntersects[0].startIndex1).toBe(0);
    expect(intrs.basicIntersects[0].startIndex2).toBe(0);
    expectVector2FuzzyEq(intrs.basicIntersects[0].point, new Vector2(0.0, 0.0));
  });

  test("circles_touching", () => {
    // two closed circles touching
    const pline1 = plineClosed([
      [0.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
    ]);

    const pline2 = plineClosed([
      [1.0, 0.0, 1.0],
      [2.0, 0.0, 1.0],
    ]);

    const intrs = findIntersects(pline1, pline2, {});

    expect(intrs.basicIntersects.length).toBe(1);
    expect(intrs.overlappingIntersects.length).toBe(0);

    const intr = intrs.basicIntersects[0];
    expect(intr.startIndex1).toBe(1);
    expect(intr.startIndex2).toBe(0);
    expectVector2FuzzyEq(intrs.basicIntersects[0].point, new Vector2(1.0, 0.0));
  });

  test("circles_overlapping_same_direction", () => {
    const pline1 = plineClosed([
      [0.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
    ]);

    const pline2 = Polyline.createFrom(pline1);

    const intrs = findIntersects(pline1, pline2, {});

    expect(intrs.basicIntersects.length).toBe(0);
    expect(intrs.overlappingIntersects.length).toBe(2);

    // sort for retrieval for asserts
    intrs.overlappingIntersects.sort((a, b) => a.startIndex1 - b.startIndex1);

    const intr1 = intrs.overlappingIntersects[0];
    expect(intr1.startIndex1).toBe(0);
    expect(intr1.startIndex2).toBe(0);
    expectVector2FuzzyEq(intr1.point1, pline1.at(0).pos());
    expectVector2FuzzyEq(intr1.point2, pline1.at(1).pos());

    const intr2 = intrs.overlappingIntersects[1];
    expect(intr2.startIndex1).toBe(1);
    expect(intr2.startIndex2).toBe(1);
    expectVector2FuzzyEq(intr2.point1, pline1.at(1).pos());
    expectVector2FuzzyEq(intr2.point2, pline1.at(0).pos());
  });

  test("circles_overlapping_opposing_direction", () => {
    const pline1 = plineClosed([
      [0.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
    ]);

    const pline2 = plineClosed([
      [0.0, 0.0, -1.0],
      [1.0, 0.0, -1.0],
    ]);

    const intrs = findIntersects(pline1, pline2, {});

    expect(intrs.basicIntersects.length).toBe(0);
    expect(intrs.overlappingIntersects.length).toBe(2);

    // sort for retrieval for asserts
    intrs.overlappingIntersects.sort((a, b) => a.startIndex2 - b.startIndex2);

    const intr1 = intrs.overlappingIntersects[0];
    expect(intr1.startIndex1).toBe(1);
    expect(intr1.startIndex2).toBe(0);
    expectVector2FuzzyEq(intr1.point1, pline2.at(0).pos());
    expectVector2FuzzyEq(intr1.point2, pline2.at(1).pos());

    const intr2 = intrs.overlappingIntersects[1];
    expect(intr2.startIndex1).toBe(0);
    expect(intr2.startIndex2).toBe(1);
    expectVector2FuzzyEq(intr2.point1, pline2.at(1).pos());
    expectVector2FuzzyEq(intr2.point2, pline2.at(0).pos());
  });

  test("circles_overlapping_opposing_direction_flipped", () => {
    const pline1 = plineClosed([
      [0.0, 0.0, -1.0],
      [1.0, 0.0, -1.0],
    ]);

    const pline2 = plineClosed([
      [0.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
    ]);

    const intrs = findIntersects(pline1, pline2, {});

    expect(intrs.basicIntersects.length).toBe(0);
    expect(intrs.overlappingIntersects.length).toBe(2);

    // sort for retrieval for asserts
    intrs.overlappingIntersects.sort((a, b) => a.startIndex2 - b.startIndex2);

    const intr1 = intrs.overlappingIntersects[0];
    expect(intr1.startIndex1).toBe(1);
    expect(intr1.startIndex2).toBe(0);
    expectVector2FuzzyEq(intr1.point1, pline2.at(0).pos());
    expectVector2FuzzyEq(intr1.point2, pline2.at(1).pos());

    const intr2 = intrs.overlappingIntersects[1];
    expect(intr2.startIndex1).toBe(0);
    expect(intr2.startIndex2).toBe(1);
    expectVector2FuzzyEq(intr2.point1, pline2.at(1).pos());
    expectVector2FuzzyEq(intr2.point2, pline2.at(0).pos());
  });

  test("uses_pos_equal_eps", () => {
    // test that posEqualEps passed in options is used
    const eps = 1e-5;
    const pline1 = plineOpen([
      [0.5, 0.0, 0.0],
      [0.5, 1.0 - 0.99 * eps, 0.0],
    ]);

    const pline2 = plineOpen([
      [0.0, 1.0, 0.0],
      [1.0, 1.0, 0.0],
    ]);

    const opts = { posEqualEps: eps };

    const intrs = findIntersects(pline1, pline2, opts);
    expect(intrs.basicIntersects.length).toBe(1);
    expect(intrs.overlappingIntersects.length).toBe(0);
    const intr = intrs.basicIntersects[0];
    expectVector2FuzzyEq(intr.point, new Vector2(0.5, 1.0));
  });
});

describe("sort_and_join_overlapping_intersects_tests", () => {
  test("overlapping_circles_same_dir", () => {
    const pline1 = plineClosed([
      [0.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
    ]);

    const pline2 = plineClosed([
      [0.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
    ]);

    const intersects = findIntersects(pline1, pline2, {});

    const slices = sortAndJoinOverlappingIntersects(
      intersects.overlappingIntersects,
      pline1,
      pline2,
      1e-5,
    );

    expect(slices.length).toBe(1);
    const slicePline = Polyline.createFrom(slices[0].view(pline2));
    expect(slicePline.vertexCount).toBe(3);
    expectVertexFuzzyEq(slicePline.at(0), pline2.at(0));
    expectVertexFuzzyEq(slicePline.at(1), pline2.at(1));
    expectVertexFuzzyEq(slicePline.at(2), pline2.at(0).withBulge(0.0));

    expect(slices[0].startIndexes).toEqual([0, 0]);
    expect(slices[0].endIndexes).toEqual([0, 0]);
    expect(slices[0].opposingDirections).toBe(false);
  });

  test("overlapping_circles_same_dir_flipped_index", () => {
    const pline1 = plineClosed([
      [0.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
    ]);

    const pline2 = plineClosed([
      [1.0, 0.0, 1.0],
      [0.0, 0.0, 1.0],
    ]);

    const intersects = findIntersects(pline1, pline2, {});

    const slices = sortAndJoinOverlappingIntersects(
      intersects.overlappingIntersects,
      pline1,
      pline2,
      1e-5,
    );

    expect(slices.length).toBe(1);
    const slicePline = Polyline.createFrom(slices[0].view(pline2));
    expect(slicePline.vertexCount).toBe(3);
    expectVertexFuzzyEq(slicePline.at(0), pline2.at(0));
    expectVertexFuzzyEq(slicePline.at(1), pline2.at(1));
    expectVertexFuzzyEq(slicePline.at(2), pline2.at(0).withBulge(0.0));

    expect(slices[0].startIndexes).toEqual([1, 0]);
    expect(slices[0].endIndexes).toEqual([1, 0]);
    expect(slices[0].opposingDirections).toBe(false);
  });

  test("overlapping_circles_opposing_dir", () => {
    const pline1 = plineClosed([
      [0.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
    ]);

    const pline2 = plineClosed([
      [0.0, 0.0, -1.0],
      [1.0, 0.0, -1.0],
    ]);

    const intersects = findIntersects(pline1, pline2, {});

    const slices = sortAndJoinOverlappingIntersects(
      intersects.overlappingIntersects,
      pline1,
      pline2,
      1e-5,
    );

    expect(slices.length).toBe(1);
    const slicePline = Polyline.createFrom(slices[0].view(pline2));
    expect(slicePline.vertexCount).toBe(3);
    expectVertexFuzzyEq(slicePline.at(0), pline2.at(0));
    expectVertexFuzzyEq(slicePline.at(1), pline2.at(1));
    expectVertexFuzzyEq(slicePline.at(2), pline2.at(0).withBulge(0.0));

    expect(slices[0].startIndexes).toEqual([1, 0]);
    expect(slices[0].endIndexes).toEqual([1, 0]);
    expect(slices[0].opposingDirections).toBe(true);
  });

  test("overlapping_circles_perpendicular_vertexes", () => {
    const pline1 = plineClosed([
      [0.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
    ]);

    const pline2 = plineClosed([
      [0.5, -0.5, 1.0],
      [0.5, 0.5, 1.0],
    ]);

    const intersects = findIntersects(pline1, pline2, {});

    const slices = sortAndJoinOverlappingIntersects(
      intersects.overlappingIntersects,
      pline1,
      pline2,
      1e-5,
    );

    expect(slices.length).toBe(1);
    const slicePline = Polyline.createFrom(slices[0].view(pline2));
    expect(slicePline.vertexCount).toBe(3);
    expectVertexFuzzyEq(slicePline.at(0), pline2.at(0));
    expectVertexFuzzyEq(slicePline.at(1), pline2.at(1));
    expectVertexFuzzyEq(slicePline.at(2), pline2.at(0).withBulge(0.0));

    expect(slices[0].startIndexes).toEqual([0, 0]);
    expect(slices[0].endIndexes).toEqual([0, 0]);
    expect(slices[0].opposingDirections).toBe(false);
  });

  test("overlapping_arcs", () => {
    // full circle composed of 10 vertexes
    const maxAngle = TAU;
    const count = 10;
    const subAngle = (1.0 / count) * maxAngle;
    const bulge = bulgeFromAngle(subAngle);
    const radius = 1.0;

    const vertexes: PlineVertex[] = [];
    for (let i = 0; i < count; i += 1) {
      const angle = i * subAngle;
      vertexes.push(
        new PlineVertex(radius * Math.cos(angle), radius * Math.sin(angle), bulge),
      );
    }

    const pline1 = Polyline.fromVertexes(vertexes, true);

    // half circle composed of two vertexes
    const pline2 = plineOpen([
      [-radius, 0.0, 1.0],
      [radius, 0.0, 0.0],
    ]);

    const intersects = findIntersects(pline1, pline2, {});

    const slices = sortAndJoinOverlappingIntersects(
      intersects.overlappingIntersects,
      pline1,
      pline2,
      1e-5,
    );

    expect(slices.length).toBe(1);
    const slicePline = Polyline.createFrom(slices[0].view(pline2));
    expect(slicePline.vertexCount).toBe(2);
    expectVertexFuzzyEq(slicePline.at(0), pline2.at(0));
    expectVertexFuzzyEq(slicePline.at(1), pline2.at(1));

    const data = slices[0].viewData;
    expectVertexFuzzyEq(data.updatedStart, new PlineVertex(-radius, 0.0, 1.0));
    expectFuzzyEq(data.updatedEndBulge, 1.0);
    expectVector2FuzzyEq(data.endPoint, new Vector2(radius, 0.0));
    expect(slices[0].startIndexes).toEqual([5, 0]);
    expect(slices[0].endIndexes).toEqual([9, 0]);
    expect(slices[0].opposingDirections).toBe(false);
  });

  test("overlapping_arcs_flipped", () => {
    const radius = 1.0;

    // half circle composed of two vertexes
    const pline1 = plineOpen([
      [-radius, 0.0, 1.0],
      [radius, 0.0, 0.0],
    ]);

    // full circle composed of 10 vertexes
    const maxAngle = TAU;
    const count = 10;
    const subAngle = (1.0 / count) * maxAngle;
    const bulge = bulgeFromAngle(subAngle);

    const vertexes: PlineVertex[] = [];
    for (let i = 0; i < count; i += 1) {
      const angle = i * subAngle;
      vertexes.push(
        new PlineVertex(radius * Math.cos(angle), radius * Math.sin(angle), bulge),
      );
    }

    const pline2 = Polyline.fromVertexes(vertexes, true);

    const intersects = findIntersects(pline1, pline2, {});

    const slices = sortAndJoinOverlappingIntersects(
      intersects.overlappingIntersects,
      pline1,
      pline2,
      1e-5,
    );

    expect(slices.length).toBe(1);
    const slicePline = Polyline.createFrom(slices[0].view(pline2));
    expect(slicePline.vertexCount).toBe(6);
    expectVertexFuzzyEq(slicePline.at(0), pline2.at(5));
    expectVertexFuzzyEq(slicePline.at(1), pline2.at(6));
    expectVertexFuzzyEq(slicePline.at(2), pline2.at(7));
    expectVertexFuzzyEq(slicePline.at(3), pline2.at(8));
    expectVertexFuzzyEq(slicePline.at(4), pline2.at(9));
    expectVertexFuzzyEq(slicePline.at(5), pline2.at(0).withBulge(0.0));

    const data = slices[0].viewData;
    expectVertexFuzzyEq(data.updatedStart, pline2.at(5));
    expectFuzzyEq(data.updatedEndBulge, pline2.at(9).bulge);
    expectVector2FuzzyEq(data.endPoint, new Vector2(radius, 0.0));
    expect(slices[0].startIndexes).toEqual([0, 5]);
    expect(slices[0].endIndexes).toEqual([0, 9]);
    expect(slices[0].opposingDirections).toBe(false);
  });
});

describe("trait method wiring (traits.rs doc examples)", () => {
  test("visit_self_intersects doc example", () => {
    const polyline = plineOpen([
      [0.0, 0.0, 0.0],
      [0.0, 2.0, 0.0],
      [1.0, 1.0, 0.0],
      [-1.0, 1.0, 0.0],
    ]);

    let visitedIntersects = 0;
    polyline.visitSelfIntersects((intersect) => {
      visitedIntersects += 1;
      if (intersect.kind === "basic") {
        expect(intersect.point.fuzzyEqEps(new Vector2(0.0, 1.0), 1e-5)).toBe(true);
      } else {
        expect.fail("Unexpected overlapping intersection");
      }
      // stop visiting intersects on first intersect found by returning false
      // (Rust `Control::Break(())`)
      return false;
    });

    expect(visitedIntersects).toBe(1);
  });

  test("scan_for_self_intersect doc example", () => {
    const polyline = plineOpen([
      [0.0, 0.0, 0.0],
      [0.0, 2.0, 0.0],
      [1.0, 1.0, 0.0],
      [-1.0, 1.0, 0.0],
    ]);

    expect(polyline.scanForSelfIntersect()).toBe(true);
  });

  test("scan_for_self_intersect_opt doc example", () => {
    const polyline = plineOpen([
      [0.0, 0.0, 0.0],
      [0.0, 2.0, 0.0],
      [1.0, 1.0, 0.0],
      [-1.0, 1.0, 0.0],
    ]);

    expect(polyline.scanForSelfIntersectOpt({})).toBe(true);
  });

  test("scanForSelfIntersect false for simple square", () => {
    const polyline = plineClosed([
      [0.0, 0.0, 0.0],
      [1.0, 0.0, 0.0],
      [1.0, 1.0, 0.0],
      [0.0, 1.0, 0.0],
    ]);

    expect(polyline.scanForSelfIntersect()).toBe(false);
    expect(polyline.scanForSelfIntersectOpt({ include: "local" })).toBe(false);
    expect(polyline.scanForSelfIntersectOpt({ include: "global" })).toBe(false);
  });

  test("visitSelfIntersectsOpt include local/global on figure eight", () => {
    // closed "bowtie"/figure-eight shaped polyline with global self intersect at (0.5, 0.5)
    const polyline = plineClosed([
      [0.0, 0.0, 0.0],
      [1.0, 1.0, 0.0],
      [1.0, 0.0, 0.0],
      [0.0, 1.0, 0.0],
    ]);

    const globalIntrs: Vector2[] = [];
    const completedGlobal = polyline.visitSelfIntersectsOpt(
      (intersect) => {
        expect(intersect.kind).toBe("basic");
        if (intersect.kind === "basic") {
          globalIntrs.push(intersect.point);
        }
      },
      { include: "global" },
    );
    expect(completedGlobal).toBe(true);
    expect(globalIntrs.length).toBe(1);
    expectVector2FuzzyEq(globalIntrs[0], new Vector2(0.5, 0.5), 1e-5);

    let localCount = 0;
    polyline.visitSelfIntersectsOpt(
      () => {
        localCount += 1;
      },
      { include: "local" },
    );
    expect(localCount).toBe(0);

    let allCount = 0;
    polyline.visitSelfIntersects(() => {
      allCount += 1;
    });
    expect(allCount).toBe(1);
  });

  test("findIntersects/visitIntersectsOpt methods (circles touching)", () => {
    const pline1 = plineClosed([
      [0.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
    ]);

    const pline2 = plineClosed([
      [1.0, 0.0, 1.0],
      [2.0, 0.0, 1.0],
    ]);

    const intrs = pline1.findIntersects(pline2);
    expect(intrs.basicIntersects.length).toBe(1);
    expect(intrs.overlappingIntersects.length).toBe(0);
    expectVector2FuzzyEq(intrs.basicIntersects[0].point, new Vector2(1.0, 0.0));

    // same result when supplying the spatial index through options
    const intrsOpt = pline1.findIntersectsOpt(pline2, {
      pline1AabbIndex: pline1.createApproxAabbIndex(),
    });
    expect(intrsOpt.basicIntersects.length).toBe(1);
    expectVector2FuzzyEq(intrsOpt.basicIntersects[0].point, new Vector2(1.0, 0.0));

    // visitIntersects visits at least the touch point
    let visitCount = 0;
    pline1.visitIntersects(pline2, (intersect) => {
      if (intersect.kind !== "noIntersect") {
        visitCount += 1;
      }
    });
    expect(visitCount).toBeGreaterThan(0);
  });

  test("disjoint polylines have no intersects", () => {
    const pline1 = plineClosed([
      [0.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
    ]);

    const pline2 = plineClosed([
      [10.0, 10.0, 1.0],
      [11.0, 10.0, 1.0],
    ]);

    const intrs = pline1.findIntersects(pline2);
    expect(intrs.basicIntersects.length).toBe(0);
    expect(intrs.overlappingIntersects.length).toBe(0);

    expect(scanForIntersect(pline1, pline2, {})).toBe(false);

    // two overlapping circles treated as intersect by scanForIntersect
    const pline3 = plineClosed([
      [0.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
    ]);
    expect(scanForIntersect(pline1, pline3, {})).toBe(true);
  });
});
