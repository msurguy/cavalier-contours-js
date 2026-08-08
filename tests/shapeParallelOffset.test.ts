// Port of Rust `tests/test_shape_parallel_offset.rs`.
//
// NOTE: importing from "../src/index.js" (rather than deep module paths) matters here — it
// evaluates `src/polyline/internal/plineOffset.ts` which registers the `parallelOffset`
// implementation used by `PlineSourceBase.parallelOffsetOpt` (used via
// `IndexedPolyline.parallelOffsetForShape`).
import { describe, expect, test } from "vitest";
import { plineClosed, Polyline, Shape } from "../src/index.js";
import { expectFuzzyEq } from "./testUtils/fuzzyAssert.js";
import {
  createPropertySet,
  PlineProperties,
  propertySetsMatch,
} from "./testUtils/plineTestProperties.js";

function runShapeOffsetTests(
  input: Iterable<Polyline>,
  offset: number,
  expectedPropertiesSet: readonly PlineProperties[],
): void {
  const s = Shape.fromPlines(input);
  const result = s.parallelOffset(offset);
  const plines = [...result.ccwPlines, ...result.cwPlines].map((p) => p.polyline);
  const resultProperties = createPropertySet(plines, false);

  expect(
    propertySetsMatch(resultProperties, expectedPropertiesSet),
    "result property sets do not match",
  ).toBe(true);
}

describe("test_simple", () => {
  test("empty_returns_empty", () => {
    runShapeOffsetTests([], 5.0, []);
  });

  test("set_of_empty_returns_empty", () => {
    runShapeOffsetTests(
      [new Polyline({ isClosed: true }), new Polyline({ isClosed: true })],
      5.0,
      [],
    );
  });

  test("rectangle_inside_shape", () => {
    runShapeOffsetTests(
      [
        plineClosed(
          [
            [100.0, 100.0, -0.5],
            [80.0, 90.0, 0.374794619217547],
            [210.0, 0.0, 0.0],
            [230.0, 0.0, 1.0],
            [320.0, 0.0, -0.5],
            [280.0, 0.0, 0.5],
            [390.0, 210.0, 0.0],
            [280.0, 120.0, 0.5],
          ],
          { userdata: [4] },
        ),
        plineClosed(
          [
            [150.0, 50.0, 0.0],
            [150.0, 100.0, 0.0],
            [200.0, 100.0, 0.0],
            [200.0, 50.0, 0.0],
          ],
          { userdata: [117] },
        ),
      ],
      3.0,
      [
        new PlineProperties(
          12,
          40977.79061358948,
          998.5536075336107,
          84.32384698504309,
          -41.99999999999997,
          401.41586988912127,
          205.22199935960901,
          [4],
        ),
        new PlineProperties(
          8,
          -3128.274333882308,
          218.84955592153878,
          147.0,
          47.0,
          203.0,
          103.0,
          [117],
        ),
      ],
    );
  });
});

describe("test_specific", () => {
  test("case1", () => {
    runShapeOffsetTests(
      [
        plineClosed(
          [
            [100.0, 100.0, -0.5],
            [80.0, 90.0, 0.374794619217547],
            [210.0, 0.0, 0.0],
            [230.0, 0.0, 1.0],
            [320.0, 0.0, -0.5],
            [280.0, 0.0, 0.5],
            [390.0, 210.0, 0.0],
            [280.0, 120.0, 0.5],
          ],
          { userdata: [4] },
        ),
        plineClosed(
          [
            [150.0, 50.0, 0.0],
            [146.32758944101474, 104.13867601941358, 0.0],
            [200.0, 100.0, 0.0],
            [200.0, 50.0, 0.0],
          ],
          { userdata: [117] },
        ),
      ],
      17.0,
      [
        new PlineProperties(
          22,
          20848.93377998434,
          1149.2701898185926,
          102.79564651409214,
          -28.000000000000004,
          387.41586988912127,
          181.8843855860552,
          [4, 117],
        ),
      ],
    );
  });

  test("case2", () => {
    runShapeOffsetTests(
      [
        plineClosed(
          [
            [160.655879768138, 148.75471430537402, -0.5],
            [80.0, 90.0, 0.374794619217547],
            [210.0, 0.0, 0.0],
            [230.0, 0.0, 1.0],
            [320.0, 0.0, -0.5],
            [280.0, 0.0, 0.5],
            [390.0, 210.0, 0.0],
            [280.0, 120.0, 0.5],
          ],
          { userdata: [4] },
        ),
        plineClosed(
          [
            [150.0, 50.0, 0.0],
            [192.62381977774953, 130.82800839110848, 0.0],
            [200.0, 100.0, 0.0],
            [200.0, 50.0, 0.0],
          ],
          { userdata: [117] },
        ),
      ],
      17.0,
      [
        new PlineProperties(
          20,
          20135.256681247833,
          1053.2414865948808,
          105.64684517241575,
          -28.000000000000004,
          387.41586988912127,
          181.8843855860552,
          [4, 117],
        ),
        new PlineProperties(
          4,
          2.091291658768,
          9.557331573939933,
          176.64810774674345,
          136.97815392110508,
          178.9335673169721,
          140.906549335123,
          [4, 117],
        ),
      ],
    );
  });

  // Test case for issue fixed: https://github.com/jbuckmccready/cavalier_contours/issues/66
  test("case3", () => {
    runShapeOffsetTests(
      [
        plineClosed(
          [
            [511.25220437557994, 328.84948025435654, 0.0],
            [561.2119896118824, 328.84948025435654, 0.0],
            [561.2119896118824, 363.8703101013724, 0.0],
            [511.25220437557994, 363.8703101013724, 0.0],
          ],
          { userdata: [] },
        ),
        plineClosed(
          [
            [540.0335350561843, 343.6169427142472, -0.2382488851276809],
            [537.4421349268171, 345.12517844750175, -0.009889532389405053],
            [537.3232102367999, 345.3220639672001, 0.0],
            [535.3578079577983, 348.7262405716385, 0.0],
            [535.32462892643, 348.7834560296831, -0.011646639385887355],
            [535.2271073347746, 348.9562631479, -0.25910007835503845],
            [535.2805330874, 352.1843242602999, 0.0],
            [537.0000084336, 355.1625429223, 0.0],
            [543.6691202685, 343.6113023833, 0.0],
            [540.2257285374734, 343.6113053474554, 0.0],
            [540.16153451323, 343.6120105305873, 0.0],
          ],
          { userdata: [] },
        ),
        plineClosed(
          [
            [535.4816659760771, 346.2417647657877, -0.23822264248219718],
            [535.4722003945319, 343.2448614622984, -0.009951542143624231],
            [535.3601905012999, 343.0416179385001, 0.0],
            [533.3951100416035, 339.6379987413748, 0.0],
            [533.3623248097243, 339.5809609408148, -0.011710653864622287],
            [533.2619655102294, 339.4110081813505, -0.11747560444569163],
            [532.1675755117166, 338.3268271911126, -0.13757287100703242],
            [530.4835288827071, 337.8423335382348, 0.0],
            [530.438959126, 337.8420348466, 0.0],
            [527.0000084336, 337.8420348466, 0.0],
            [533.6691202683, 349.3932753857, 0.0],
            [535.3908302312102, 346.4111802353502, 0.0],
            [535.4223097645596, 346.3552449203639, 0.0],
          ],
          { userdata: [] },
        ),
      ],
      0.8,
      [
        new PlineProperties(
          4,
          1616.2241538207163,
          163.56123016663673,
          512.0522043755799,
          329.64948025435655,
          560.4119896118824,
          363.0703101013724,
          [],
        ),
        new PlineProperties(
          28,
          -148.47469897242397,
          61.018056828113345,
          526.2000084335999,
          337.04203484659996,
          544.4691202685001,
          355.96254292230003,
          [],
        ),
      ],
    );
  });
});

// TS-addition: property-based sanity tests not present in the Rust test file (the Rust shape
// test file is thin). These check coarse invariants of the shape offset algorithm using a
// simple rectangle-with-rectangular-hole shape.
describe("ts_addition_property_sanity", () => {
  // outer 100x100 ccw rectangle (positive area 10000)
  const outerRect = (): Polyline =>
    plineClosed([
      [0.0, 0.0, 0.0],
      [100.0, 0.0, 0.0],
      [100.0, 100.0, 0.0],
      [0.0, 100.0, 0.0],
    ]);

  // 60x60 cw rectangular hole from (20, 20) to (80, 80) (negative area -3600)
  const holeRect = (): Polyline =>
    plineClosed([
      [20.0, 20.0, 0.0],
      [20.0, 80.0, 0.0],
      [80.0, 80.0, 0.0],
      [80.0, 20.0, 0.0],
    ]);

  test("rect_with_hole_offset_inward_shrinks_outer_grows_hole", () => {
    const shape = Shape.fromPlines([outerRect(), holeRect()]);
    const d = 5.0;
    const result = shape.parallelOffset(d);

    // counts stay 1/1 for small offset distance
    expect(result.ccwPlines.length).toBe(1);
    expect(result.cwPlines.length).toBe(1);

    // outer rectangle offset inward by 5 is exactly a 90x90 rectangle
    const outerArea = result.ccwPlines[0].polyline.area();
    expectFuzzyEq(outerArea, 8100.0, 1e-8);

    // hole grows (offset inward on the shape inflates the hole): area magnitude increases,
    // bounded above by the full 70x70 square (corners are rounded by arcs)
    const holeArea = result.cwPlines[0].polyline.area();
    expect(holeArea).toBeLessThan(0.0);
    expect(Math.abs(holeArea)).toBeGreaterThan(3600.0);
    expect(Math.abs(holeArea)).toBeLessThan(4900.0);
  });

  test("rect_with_hole_offset_until_hole_collapses", () => {
    const shape = Shape.fromPlines([outerRect(), holeRect()]);
    // negative offset inflates the shape / deflates the 60x60 hole; the hole collapses when
    // the offset distance reaches half the hole width (30)
    const d = -31.0;
    const result = shape.parallelOffset(d);

    expect(result.cwPlines.length).toBe(0);
    expect(result.ccwPlines.length).toBe(1);

    // outer grew: area must exceed the original 100x100 area
    expect(result.ccwPlines[0].polyline.area()).toBeGreaterThan(10000.0);
  });

  test("round_trip_offset_approximately_preserves_areas", () => {
    const shape = Shape.fromPlines([outerRect(), holeRect()]);
    const d = 5.0;

    const offsetShape = shape.parallelOffset(d);
    const roundTrip = offsetShape.parallelOffset(-d);

    expect(roundTrip.ccwPlines.length).toBe(1);
    expect(roundTrip.cwPlines.length).toBe(1);

    // round trip rounds the outer corners with radius `d` arcs so the area differs from the
    // original by at most 4 corners * (1 - pi/4) * d^2 ≈ 21.46 — use a loose epsilon of 25
    const looseEps = 25.0;
    expectFuzzyEq(roundTrip.ccwPlines[0].polyline.area(), 10000.0, looseEps);
    expectFuzzyEq(roundTrip.cwPlines[0].polyline.area(), -3600.0, looseEps);
  });
});
