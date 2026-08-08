// Port of Rust `tests/test_pline_basics.rs`.
import { expect, test } from "vitest";
import { bulgeFromAngle } from "../src/core/mathUtils.js";
import { Vector2 } from "../src/core/vector2.js";
import { plineClosed, plineOpen } from "../src/polyline/construct.js";
import { segLength } from "../src/polyline/plineSeg.js";
import type { FindPointAtPathLengthResult } from "../src/polyline/plineTypes.js";
import { PlineVertex } from "../src/polyline/plineVertex.js";
import { PlineViewData } from "../src/polyline/plineView.js";
import { Polyline } from "../src/polyline/polyline.js";
import {
  expectFuzzyEq,
  expectPlineFuzzyEq,
  expectSome,
  expectVertexFuzzyEq,
} from "./testUtils/fuzzyAssert.js";

const PI = Math.PI;
const TAU = 2.0 * Math.PI;
const FRAC_PI_2 = Math.PI / 2.0;

// Port of Rust `assert_path_length_result_eq!` macro.
function assertPathLengthResultEq(
  left: FindPointAtPathLengthResult,
  right: FindPointAtPathLengthResult,
): void {
  if (
    left.ok &&
    right.ok &&
    left.segIndex === right.segIndex &&
    left.point.fuzzyEqEps(right.point, 1e-5)
  ) {
    return;
  }
  if (!left.ok && !right.ok && Math.abs(left.pathLength - right.pathLength) < 1e-5) {
    return;
  }
  expect.fail(
    `result cases do not match: left: ${JSON.stringify(left)}, right: ${JSON.stringify(right)}`,
  );
}

test("iter_vertexes", () => {
  // NOTE: the Rust test also asserts iterator `size_hint` and `DoubleEndedIterator::next_back`
  // behavior which does not apply to the JS generator port — values and counts are asserted by
  // collecting the generator.
  function runIterVertexesTests(isClosed: boolean): void {
    const polyline = Polyline.withCapacity(0, isClosed);
    {
      // empty
      expect([...polyline.iterVertexes()]).toEqual([]);
    }

    polyline.add(1.0, 2.0, 0.3);

    {
      // one vertex
      const vertexes = [...polyline.iterVertexes()];
      expect(vertexes.length).toBe(1);
      expect(vertexes[0]).toEqual(new PlineVertex(1.0, 2.0, 0.3));
    }

    polyline.add(4.0, 5.0, 0.6);

    {
      // two vertexes
      const vertexes = [...polyline.iterVertexes()];
      expect(vertexes.length).toBe(2);
      expect(vertexes[0]).toEqual(new PlineVertex(1.0, 2.0, 0.3));
      expect(vertexes[1]).toEqual(new PlineVertex(4.0, 5.0, 0.6));
    }
  }

  // should have same results for both open and closed polyline
  runIterVertexesTests(false);
  runIterVertexesTests(true);
});

test("iter_segments", () => {
  const polyline = new Polyline();
  expect([...polyline.iterSegments()].length).toBe(0);

  polyline.add(1.0, 2.0, 0.3);
  expect([...polyline.iterSegments()].length).toBe(0);

  polyline.add(4.0, 5.0, 0.6);
  const oneSeg = [...polyline.iterSegments()];
  expect(oneSeg.length).toBe(1);
  expect(oneSeg[0][0]).toEqual(new PlineVertex(1.0, 2.0, 0.3));
  expect(oneSeg[0][1]).toEqual(new PlineVertex(4.0, 5.0, 0.6));

  polyline.setIsClosed(true);
  const twoSeg = [...polyline.iterSegments()];
  expect(twoSeg.length).toBe(2);
  expect(twoSeg[0][0]).toEqual(new PlineVertex(1.0, 2.0, 0.3));
  expect(twoSeg[0][1]).toEqual(new PlineVertex(4.0, 5.0, 0.6));
  expect(twoSeg[1][0]).toEqual(new PlineVertex(4.0, 5.0, 0.6));
  expect(twoSeg[1][1]).toEqual(new PlineVertex(1.0, 2.0, 0.3));

  polyline.add(0.5, 0.5, 0.5);
  const threeSeg = [...polyline.iterSegments()];
  expect(threeSeg.length).toBe(3);
  expect(threeSeg[0][0]).toEqual(new PlineVertex(1.0, 2.0, 0.3));
  expect(threeSeg[0][1]).toEqual(new PlineVertex(4.0, 5.0, 0.6));
  expect(threeSeg[1][0]).toEqual(new PlineVertex(4.0, 5.0, 0.6));
  expect(threeSeg[1][1]).toEqual(new PlineVertex(0.5, 0.5, 0.5));
  expect(threeSeg[2][0]).toEqual(new PlineVertex(0.5, 0.5, 0.5));
  expect(threeSeg[2][1]).toEqual(new PlineVertex(1.0, 2.0, 0.3));

  polyline.setIsClosed(false);
  const twoSegOpen = [...polyline.iterSegments()];
  expect(twoSegOpen.length).toBe(2);
  expect(twoSegOpen[0][0]).toEqual(new PlineVertex(1.0, 2.0, 0.3));
  expect(twoSegOpen[0][1]).toEqual(new PlineVertex(4.0, 5.0, 0.6));
  expect(twoSegOpen[1][0]).toEqual(new PlineVertex(4.0, 5.0, 0.6));
  expect(twoSegOpen[1][1]).toEqual(new PlineVertex(0.5, 0.5, 0.5));
});

test("iter_segment_indexes", () => {
  const polyline = new Polyline();
  expect([...polyline.iterSegmentIndexes()].length).toBe(0);

  polyline.add(1.0, 2.0, 0.3);
  expect([...polyline.iterSegmentIndexes()].length).toBe(0);

  polyline.add(4.0, 5.0, 0.6);
  const oneSeg = [...polyline.iterSegmentIndexes()];
  expect(oneSeg).toEqual([[0, 1]]);

  polyline.setIsClosed(true);
  const twoSeg = [...polyline.iterSegmentIndexes()];
  expect(twoSeg).toEqual([
    [0, 1],
    [1, 0],
  ]);

  polyline.add(0.5, 0.5, 0.5);
  const threeSeg = [...polyline.iterSegmentIndexes()];
  expect(threeSeg).toEqual([
    [0, 1],
    [1, 2],
    [2, 0],
  ]);

  polyline.setIsClosed(false);
  const twoSegOpen = [...polyline.iterSegmentIndexes()];
  expect(twoSegOpen).toEqual([
    [0, 1],
    [1, 2],
  ]);
});

test("invert_direction_mut", () => {
  const polyline = new Polyline({ isClosed: true });
  polyline.add(0.0, 0.0, 0.1);
  polyline.add(2.0, 0.0, 0.2);
  polyline.add(2.0, 2.0, 0.3);
  polyline.add(0.0, 2.0, 0.4);

  polyline.invertDirectionMut();

  expectVertexFuzzyEq(polyline.at(0), new PlineVertex(0.0, 2.0, -0.3));
  expectVertexFuzzyEq(polyline.at(1), new PlineVertex(2.0, 2.0, -0.2));
  expectVertexFuzzyEq(polyline.at(2), new PlineVertex(2.0, 0.0, -0.1));
  expectVertexFuzzyEq(polyline.at(3), new PlineVertex(0.0, 0.0, -0.4));
});

test("remove_repeat", () => {
  {
    // empty polyline
    const polyline = new Polyline({ isClosed: true });
    const result = polyline.removeRepeatPos(1e-5);
    expect(result).toBeNull();
  }

  {
    // single vertex
    const polyline = new Polyline({ isClosed: true });
    polyline.add(2.0, 2.0, 0.5);
    const result = polyline.removeRepeatPos(1e-5);
    expect(result).toBeNull();
  }

  {
    // two repeats, closed polyline
    const polyline = new Polyline({ isClosed: true });
    polyline.add(2.0, 2.0, 0.5);
    polyline.add(2.0, 2.0, 1.0);
    polyline.add(3.0, 3.0, 1.0);
    polyline.add(3.0, 3.0, 0.5);
    const result = expectSome(polyline.removeRepeatPos(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(2);
    expect(result.isClosed).toBe(true);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(2.0, 2.0, 1.0));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(3.0, 3.0, 0.5));
  }

  {
    // two repeats, open polyline
    const polyline = new Polyline();
    polyline.add(2.0, 2.0, 0.5);
    polyline.add(2.0, 2.0, 1.0);
    polyline.add(3.0, 3.0, 1.0);
    polyline.add(3.0, 3.0, 0.5);
    const result = expectSome(polyline.removeRepeatPos(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(2);
    expect(result.isClosed).toBe(false);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(2.0, 2.0, 1.0));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(3.0, 3.0, 0.5));
  }

  {
    // no repeats, closed polyline
    const polyline = new Polyline({ isClosed: true });
    polyline.add(2.0, 2.0, 0.5);
    polyline.add(3.0, 3.0, 1.0);
    const result = polyline.removeRepeatPos(1e-5);
    expect(result).toBeNull();
  }

  {
    // no repeats, open polyline
    const polyline = new Polyline();
    polyline.add(2.0, 2.0, 0.5);
    polyline.add(3.0, 3.0, 1.0);
    polyline.add(4.0, 3.0, 1.0);
    const result = polyline.removeRepeatPos(1e-5);
    expect(result).toBeNull();
  }

  {
    // last repeats position on first for closed polyline
    const polyline = new Polyline({ isClosed: true });
    polyline.add(2.0, 2.0, 0.5);
    polyline.add(3.0, 3.0, 1.0);
    polyline.add(2.0, 2.0, 1.0);
    const result = expectSome(polyline.removeRepeatPos(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(2);
    expect(result.isClosed).toBe(true);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(2.0, 2.0, 0.5));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(3.0, 3.0, 1.0));
  }

  {
    // last repeats position on first for open polyline
    const polyline = new Polyline();
    polyline.add(2.0, 2.0, 0.5);
    polyline.add(3.0, 3.0, 1.0);
    polyline.add(2.0, 2.0, 1.0);
    const result = polyline.removeRepeatPos(1e-5);
    expect(result).toBeNull();
  }

  {
    // catches case where prev position is updated even when vertex is skipped causing the end
    // result to actually have a repeat position
    const polyline = new Polyline();
    polyline.add(149.75759744152376, 2753.341034622115, 0.0);
    polyline.add(149.75761269666256, 2753.341034955893, -0.000000016806842584315973);
    polyline.add(149.75760725254852, 2753.341034836777, -0.000000026349436410555433);
    polyline.add(149.75759871737387, 2753.3410346500286, -0.0000000059965514775939255);
    polyline.add(149.7576044186626, 2753.341034774772, -0.000000017257169693252198);
    polyline.add(149.7576208261107, 2753.3410351337648, -0.00000001907759705765955);
    polyline.add(149.75762700577317, 2753.3410352689743, -0.0024145466234173404);
    polyline.add(176.35224446582103, 2753.7944419559553, -0.000000003667288472897212);
    polyline.add(176.35224565393378, 2753.7944419704727, 0.0);
    polyline.add(176.35227673059205, 2753.794442350188, 0.0);
    polyline.add(176.35229710705553, 2753.794442599162, 0.0);

    const result = expectSome(polyline.removeRepeatPos(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(7);
    expect(result.isClosed).toBe(false);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(149.75759744152376, 2753.341034622115, 0.0));
    expectVertexFuzzyEq(
      result.at(1),
      new PlineVertex(149.75761269666256, 2753.341034955893, -0.000000026349436410555433),
    );
    expectVertexFuzzyEq(
      result.at(2),
      new PlineVertex(149.75759871737387, 2753.3410346500286, -0.000000017257169693252198),
    );
    expectVertexFuzzyEq(
      result.at(3),
      new PlineVertex(149.7576208261107, 2753.3410351337648, -0.0024145466234173404),
    );
    expectVertexFuzzyEq(
      result.at(4),
      new PlineVertex(176.35224446582103, 2753.7944419559553, 0.0),
    );
    expectVertexFuzzyEq(result.at(5), new PlineVertex(176.35227673059205, 2753.794442350188, 0.0));
    expectVertexFuzzyEq(result.at(6), new PlineVertex(176.35229710705553, 2753.794442599162, 0.0));
  }
});

test("remove_redundant_removes_repeat_pos", () => {
  {
    // empty polyline
    const polyline = new Polyline({ isClosed: true });
    const result = polyline.removeRedundant(1e-5);
    expect(result).toBeNull();
  }

  {
    // single vertex
    const polyline = new Polyline({ isClosed: true });
    polyline.add(2.0, 2.0, 0.5);
    const result = polyline.removeRedundant(1e-5);
    expect(result).toBeNull();
  }

  {
    // two repeats, closed polyline
    const polyline = new Polyline({ isClosed: true });
    polyline.add(2.0, 2.0, 0.5);
    polyline.add(2.0, 2.0, 1.0);
    polyline.add(3.0, 3.0, 1.0);
    polyline.add(3.0, 3.0, 0.5);
    const result = expectSome(polyline.removeRepeatPos(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(2);
    expect(result.isClosed).toBe(true);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(2.0, 2.0, 1.0));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(3.0, 3.0, 0.5));
  }

  {
    // two repeats, open polyline
    const polyline = new Polyline();
    polyline.add(2.0, 2.0, 0.5);
    polyline.add(2.0, 2.0, 1.0);
    polyline.add(3.0, 3.0, 1.0);
    polyline.add(3.0, 3.0, 0.5);
    const result = expectSome(polyline.removeRepeatPos(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(2);
    expect(result.isClosed).toBe(false);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(2.0, 2.0, 1.0));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(3.0, 3.0, 0.5));
  }

  {
    // no repeats, closed polyline
    const polyline = new Polyline({ isClosed: true });
    polyline.add(2.0, 2.0, 0.5);
    polyline.add(3.0, 3.0, 1.0);
    const result = polyline.removeRedundant(1e-5);
    expect(result).toBeNull();
  }

  {
    // no repeats, open polyline
    const polyline = new Polyline();
    polyline.add(2.0, 2.0, 0.5);
    polyline.add(3.0, 3.0, 1.0);
    polyline.add(4.0, 3.0, 1.0);
    const result = polyline.removeRedundant(1e-5);
    expect(result).toBeNull();
  }

  {
    // last repeats position on first for closed polyline
    const polyline = new Polyline({ isClosed: true });
    polyline.add(2.0, 2.0, 0.5);
    polyline.add(3.0, 3.0, 1.0);
    polyline.add(2.0, 2.0, 1.0);
    const result = expectSome(polyline.removeRepeatPos(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(2);
    expect(result.isClosed).toBe(true);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(2.0, 2.0, 0.5));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(3.0, 3.0, 1.0));
  }

  {
    // last repeats position on first for open polyline
    const polyline = new Polyline();
    polyline.add(2.0, 2.0, 0.5);
    polyline.add(3.0, 3.0, 1.0);
    polyline.add(2.0, 2.0, 1.0);
    const result = polyline.removeRedundant(1e-5);
    expect(result).toBeNull();
  }

  {
    // catches case where prev position is updated even when vertex is skipped causing the end
    // result to actually have a repeat position
    const polyline = new Polyline();
    polyline.add(149.75759744152376, 2753.341034622115, 0.0);
    polyline.add(149.75761269666256, 2753.341034955893, -0.000000016806842584315973);
    polyline.add(149.75760725254852, 2753.341034836777, -0.000000026349436410555433);
    polyline.add(149.75759871737387, 2753.3410346500286, -0.0000000059965514775939255);
    polyline.add(149.7576044186626, 2753.341034774772, -0.000000017257169693252198);
    polyline.add(149.7576208261107, 2753.3410351337648, -0.00000001907759705765955);
    polyline.add(149.75762700577317, 2753.3410352689743, -0.0024145466234173404);
    polyline.add(176.35224446582103, 2753.7944419559553, -0.000000003667288472897212);
    polyline.add(176.35224565393378, 2753.7944419704727, 0.0);
    polyline.add(176.35227673059205, 2753.794442350188, 0.0);
    polyline.add(176.35229710705553, 2753.794442599162, 0.0);

    const result = expectSome(polyline.removeRepeatPos(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(7);
    expect(result.isClosed).toBe(false);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(149.75759744152376, 2753.341034622115, 0.0));
    expectVertexFuzzyEq(
      result.at(1),
      new PlineVertex(149.75761269666256, 2753.341034955893, -0.000000026349436410555433),
    );
    expectVertexFuzzyEq(
      result.at(2),
      new PlineVertex(149.75759871737387, 2753.3410346500286, -0.000000017257169693252198),
    );
    expectVertexFuzzyEq(
      result.at(3),
      new PlineVertex(149.7576208261107, 2753.3410351337648, -0.0024145466234173404),
    );
    expectVertexFuzzyEq(
      result.at(4),
      new PlineVertex(176.35224446582103, 2753.7944419559553, 0.0),
    );
    expectVertexFuzzyEq(result.at(5), new PlineVertex(176.35227673059205, 2753.794442350188, 0.0));
    expectVertexFuzzyEq(result.at(6), new PlineVertex(176.35229710705553, 2753.794442599162, 0.0));
  }
});

test("remove_redundant", () => {
  {
    // redundant point on line and repeat position
    const polyline = new Polyline({ isClosed: true });
    polyline.add(2.0, 2.0, 0.0);
    polyline.add(3.0, 3.0, 0.0);
    polyline.add(3.0, 3.0, 0.0);
    polyline.add(4.0, 4.0, 0.0);
    polyline.add(2.0, 4.0, 0.0);
    const result = expectSome(polyline.removeRedundant(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(3);
    expect(result.isClosed).toBe(true);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(2.0, 2.0, 0.0));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(4.0, 4.0, 0.0));
    expectVertexFuzzyEq(result.at(2), new PlineVertex(2.0, 4.0, 0.0));
  }

  {
    // self intersecting points along line (collinear but opposing direction, points should not
    // be removed)
    const polyline = new Polyline({ isClosed: true });
    polyline.add(2.0, 2.0, 0.0);
    polyline.add(3.0, 3.0, 0.0);
    polyline.add(2.5, 2.5, 0.0);
    polyline.add(4.0, 4.0, 0.0);
    polyline.add(2.0, 4.0, 0.0);
    const result = polyline.removeRedundant(1e-5);
    expect(result).toBeNull();
  }

  {
    // simple counter clockwise circle with extra vertex along one arc
    const bulge = Math.tan(FRAC_PI_2 / 4.0);
    const polyline = new Polyline({ isClosed: true });
    polyline.add(0.0, 0.0, -bulge);
    polyline.add(1.0, 1.0, -bulge);
    polyline.add(2.0, 0.0, -1.0);
    const result = expectSome(polyline.removeRedundant(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(2);
    expect(result.isClosed).toBe(true);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(0.0, 0.0, -1.0));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(2.0, 0.0, -1.0));
  }

  {
    // arcs along greater arc
    const radius = 5.0;
    const maxAngle = FRAC_PI_2;
    const count = 4;
    const subAngle = (1.0 / count) * maxAngle;
    const bulge = bulgeFromAngle(subAngle);

    const polyline = new Polyline();
    for (let i = 0; i <= count; i += 1) {
      const angle = i * subAngle;
      polyline.add(radius * Math.cos(angle), radius * Math.sin(angle), bulge);
    }

    const result = expectSome(polyline.removeRedundant(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(2);
    expect(result.isClosed).toBe(false);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(radius, 0.0, bulgeFromAngle(maxAngle)));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(0.0, radius, bulge));
  }

  {
    // arcs along circle
    const radius = 5.0;
    const maxAngle = TAU;
    const count = 10;
    const subAngle = (1.0 / count) * maxAngle;
    const bulge = bulgeFromAngle(subAngle);

    const polyline = new Polyline({ isClosed: true });
    for (let i = 0; i < count; i += 1) {
      const angle = i * subAngle;
      polyline.add(radius * Math.cos(angle), radius * Math.sin(angle), bulge);
    }

    const result = expectSome(polyline.removeRedundant(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(2);
    expect(result.isClosed).toBe(true);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(radius, 0.0, 1.0));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(-radius, 0.0, 1.0));
  }

  {
    // arcs along circle open polyline
    const radius = 5.0;
    const maxAngle = TAU;
    const count = 10;
    const subAngle = (1.0 / count) * maxAngle;
    const bulge = bulgeFromAngle(subAngle);

    const polyline = new Polyline();
    for (let i = 0; i <= count; i += 1) {
      const angle = i * subAngle;
      polyline.add(radius * Math.cos(angle), radius * Math.sin(angle), bulge);
    }

    const result = expectSome(polyline.removeRedundant(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(3);
    expect(result.isClosed).toBe(false);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(radius, 0.0, 1.0));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(-radius, 0.0, 1.0));
    expectVertexFuzzyEq(result.at(2), new PlineVertex(radius, 0.0, bulge));
  }

  {
    // already minimum circle
    const radius = 5.0;

    const polyline = new Polyline({ isClosed: true });
    polyline.add(0.0, -radius, 1.0);
    polyline.add(0.0, radius, 1.0);

    const result = polyline.removeRedundant(1e-5);
    expect(result).toBeNull();
  }

  {
    // closed half circle with arc that causes first vertex to be redundant
    const radius = 5.0;

    const bulge = bulgeFromAngle(-FRAC_PI_2);

    const polyline = new Polyline({ isClosed: true });
    polyline.add(0.0, radius, bulge);
    polyline.add(radius, 0.0, 0.0);
    polyline.add(-radius, 0.0, bulge);

    const result = expectSome(polyline.removeRedundant(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(2);
    expect(result.isClosed).toBe(true);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(-radius, 0.0, -1.0));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(radius, 0.0, 0.0));
  }

  {
    // open polyline with bulge values that would cause first vertex to be redundant if
    // polyline were closed
    const radius = 5.0;

    const bulge = bulgeFromAngle(-FRAC_PI_2);

    const polyline = new Polyline();
    polyline.add(0.0, radius, bulge);
    polyline.add(radius, 0.0, 0.0);
    polyline.add(-radius, 0.0, bulge);

    const result = polyline.removeRedundant(1e-5);
    expect(result).toBeNull();
  }

  {
    // closed path with redundant first vertex point along line
    const polyline = new Polyline({ isClosed: true });
    polyline.add(2.0, 2.0, 0.0);
    polyline.add(3.0, 3.0, 0.0);
    polyline.add(3.0, -2.0, 0.0);
    polyline.add(-2.0, -2.0, 0.0);
    polyline.add(-1.0, -1.0, 0.0);

    const result = expectSome(polyline.removeRedundant(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(3);
    expect(result.isClosed).toBe(true);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(-2.0, -2.0, 0.0));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(3.0, 3.0, 0.0));
    expectVertexFuzzyEq(result.at(2), new PlineVertex(3.0, -2.0, 0.0));
  }

  {
    // open polyline with values that would cause first vertex to be redundant due to being
    // collinear if polyline were closed
    const polyline = new Polyline();
    polyline.add(2.0, 2.0, 0.0);
    polyline.add(3.0, 3.0, 0.0);
    polyline.add(3.0, -2.0, 0.0);
    polyline.add(-2.0, -2.0, 0.0);
    polyline.add(-1.0, -1.0, 0.0);

    const result = polyline.removeRedundant(1e-5);
    expect(result).toBeNull();
  }

  {
    // circle defined by 4 vertexes
    const bulge = Math.tan(PI / 8.0);
    const polyline = new Polyline({ isClosed: true });
    polyline.add(-0.5, 0.0, bulge);
    polyline.add(0.0, -0.5, bulge);
    polyline.add(0.5, 0.0, bulge);
    polyline.add(0.0, 0.5, bulge);

    const result = expectSome(polyline.removeRedundant(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(2);
    expect(result.isClosed).toBe(true);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(-0.5, 0.0, 1.0));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(0.5, 0.0, 1.0));
  }

  {
    // rounded rectangle collapsed into circle
    const bulge = Math.tan(PI / 8.0);
    const polyline = new Polyline({ isClosed: true });
    polyline.add(-0.5, 0.0, bulge);
    polyline.add(0.0, -0.5, 0.0);
    polyline.add(0.0, -0.5, bulge);
    polyline.add(0.5, 0.0, 0.0);
    polyline.add(0.5, 0.0, bulge);
    polyline.add(0.0, 0.5, 0.0);
    polyline.add(0.0, 0.5, bulge);
    polyline.add(-0.5, 0.0, 0.0);

    const result = expectSome(polyline.removeRedundant(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(2);
    expect(result.isClosed).toBe(true);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(-0.5, 0.0, 1.0));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(0.5, 0.0, 1.0));
  }

  {
    // rounded rectangle collapsed into circle shifted vertex positions
    const bulge = Math.tan(PI / 8.0);
    const polyline = new Polyline({ isClosed: true });
    polyline.add(-0.5, 0.0, 0.0);
    polyline.add(-0.5, 0.0, bulge);
    polyline.add(0.0, -0.5, 0.0);
    polyline.add(0.0, -0.5, bulge);
    polyline.add(0.5, 0.0, 0.0);
    polyline.add(0.5, 0.0, bulge);
    polyline.add(0.0, 0.5, 0.0);
    polyline.add(0.0, 0.5, bulge);

    const result = expectSome(polyline.removeRedundant(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(2);
    expect(result.isClosed).toBe(true);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(-0.5, 0.0, 1.0));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(0.5, 0.0, 1.0));
  }

  {
    // rounded rectangle collapsed into circle (but kept as open polyline)
    const bulge = Math.tan(PI / 8.0);
    const polyline = new Polyline();
    polyline.add(-0.5, 0.0, bulge);
    polyline.add(0.0, -0.5, 0.0);
    polyline.add(0.0, -0.5, bulge);
    polyline.add(0.5, 0.0, 0.0);
    polyline.add(0.5, 0.0, bulge);
    polyline.add(0.0, 0.5, 0.0);
    polyline.add(0.0, 0.5, bulge);
    polyline.add(-0.5, 0.0, 0.0);

    const result = expectSome(polyline.removeRedundant(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(3);
    expect(result.isClosed).toBe(false);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(-0.5, 0.0, 1.0));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(0.5, 0.0, 1.0));
    expectVertexFuzzyEq(result.at(2), new PlineVertex(-0.5, 0.0, 0.0));
  }

  {
    // rounded rectangle collapsed into circle with many repeat vertex positions
    const bulge = Math.tan(PI / 8.0);
    const polyline = new Polyline({ isClosed: true });
    polyline.add(-0.5, 0.0, 0.0);
    polyline.add(-0.5, 0.0, 0.0);
    polyline.add(-0.5, 0.0, 0.0);
    polyline.add(-0.5, 0.0, bulge);
    polyline.add(-0.5, 0.0, bulge);
    polyline.add(-0.5, 0.0, bulge);
    polyline.add(0.0, -0.5, 0.0);
    polyline.add(0.0, -0.5, 0.0);
    polyline.add(0.0, -0.5, 0.0);
    polyline.add(0.0, -0.5, bulge);
    polyline.add(0.5, 0.0, 0.0);
    polyline.add(0.5, 0.0, bulge);
    polyline.add(0.0, 0.5, 0.0);
    polyline.add(0.0, 0.5, bulge);
    polyline.add(0.0, 0.5, bulge);
    polyline.add(0.0, 0.5, bulge);

    const result = expectSome(polyline.removeRedundant(1e-5), "vertexes to be removed");
    expect(result.vertexCount).toBe(2);
    expect(result.isClosed).toBe(true);
    expectVertexFuzzyEq(result.at(0), new PlineVertex(-0.5, 0.0, 1.0));
    expectVertexFuzzyEq(result.at(1), new PlineVertex(0.5, 0.0, 1.0));
  }

  {
    // n equal points
    const polyline1 = Polyline.withCapacity(3, false);
    polyline1.add(0.0, 0.0, 0.0);
    polyline1.add(0.0, 0.0, 0.0);
    polyline1.add(0.0, 0.0, 0.0);
    const polyline2 = Polyline.withCapacity(3, false);
    polyline2.add(1.0, 1.0, 0.0);
    polyline2.add(1.0, 1.0, 0.0);
    polyline2.add(1.0, 1.0, 1.0);
    const polyline3 = Polyline.withCapacity(2, false);
    polyline3.add(2.0, 2.0, 0.0);
    polyline3.add(2.0, 2.0, 1.0);

    const r1 = expectSome(polyline1.removeRedundant(1e-5), "vertexes to be removed");
    const r2 = expectSome(polyline2.removeRedundant(1e-5), "vertexes to be removed");
    const r3 = expectSome(polyline3.removeRedundant(1e-5), "vertexes to be removed");
    expect(r1.vertexCount).toBe(1);
    expect(r2.vertexCount).toBe(1);
    expect(r3.vertexCount).toBe(1);
    expectVertexFuzzyEq(r1.at(0), new PlineVertex(0.0, 0.0, 0.0));
    expectVertexFuzzyEq(r2.at(0), new PlineVertex(1.0, 1.0, 1.0));
    expectVertexFuzzyEq(r3.at(0), new PlineVertex(2.0, 2.0, 1.0));
  }
});

test("rotate_start", () => {
  {
    // empty polyline
    const polyline = new Polyline({ isClosed: true });
    expect(polyline.rotateStart(0, new Vector2(0.0, 0.0), 1e-5)).toBeNull();
  }

  {
    // single vertex polyline
    const polyline = plineClosed([[1.0, 0.0, 0.0]]);
    expect(polyline.rotateStart(0, new Vector2(0.0, 0.0), 1e-5)).toBeNull();
  }

  {
    // open polyline
    const polyline = plineOpen([
      [0.0, 0.0, 0.0],
      [1.0, 0.0, 0.5],
      [1.0, 1.0, 0.2],
      [0.0, 1.0, -0.1],
    ]);
    expect(polyline.rotateStart(0, new Vector2(0.0, 0.0), 1e-5)).toBeNull();
  }

  {
    // no change
    const polyline = plineClosed([
      [0.0, 0.0, 0.0],
      [1.0, 0.0, 0.5],
      [1.0, 1.0, 0.2],
      [0.0, 1.0, -0.1],
    ]);

    const rotNoChange = expectSome(
      polyline.rotateStart(0, new Vector2(0.0, 0.0), 1e-5),
      "rotate start to succeed",
    );
    expect(rotNoChange.fuzzyEq(polyline)).toBe(true);
  }

  {
    // end becomes start
    const polyline = plineClosed([
      [0.0, 0.0, 0.0],
      [1.0, 0.0, 0.5],
      [1.0, 1.0, 0.2],
      [0.0, 1.0, -0.1],
    ]);

    const rotEndIsStart = expectSome(
      polyline.rotateStart(polyline.vertexCount - 1, new Vector2(0.0, 1.0), 1e-5),
      "rotate start to succeed",
    );

    const expectedEndAsStart = plineClosed([
      [0.0, 1.0, -0.1],
      [0.0, 0.0, 0.0],
      [1.0, 0.0, 0.5],
      [1.0, 1.0, 0.2],
    ]);

    expectPlineFuzzyEq(rotEndIsStart, expectedEndAsStart);
  }

  {
    // split in middle of line segment
    const polyline = plineClosed([
      [0.0, 0.0, 0.0],
      [1.0, 0.0, 0.0],
      [1.0, 1.0, 0.0],
      [0.0, 1.0, 0.0],
    ]);

    const rot = expectSome(
      polyline.rotateStart(0, new Vector2(0.5, 0.0), 1e-5),
      "rotate start to succeed",
    );
    const expectedRot = plineClosed([
      [0.5, 0.0, 0.0],
      [1.0, 0.0, 0.0],
      [1.0, 1.0, 0.0],
      [0.0, 1.0, 0.0],
      [0.0, 0.0, 0.0],
    ]);
    expectPlineFuzzyEq(rot, expectedRot);
  }

  {
    // split in middle of arc segment
    const polyline = plineClosed([
      [0.0, 0.0, 0.0],
      [1.0, 0.0, 1.0],
      [1.0, 1.0, 0.0],
      [0.0, 1.0, 0.0],
    ]);

    const rot = expectSome(
      polyline.rotateStart(1, new Vector2(1.5, 0.5), 1e-5),
      "rotate start to succeed",
    );

    const expectedRot = plineClosed([
      [1.5, 0.5, bulgeFromAngle(FRAC_PI_2)],
      [1.0, 1.0, 0.0],
      [0.0, 1.0, 0.0],
      [0.0, 0.0, 0.0],
      [1.0, 0.0, bulgeFromAngle(FRAC_PI_2)],
    ]);
    expectPlineFuzzyEq(rot, expectedRot);
  }
});

test("area", () => {
  {
    const circle = new Polyline({ isClosed: true });
    circle.add(0.0, 0.0, 1.0);
    circle.add(2.0, 0.0, 1.0);
    expectFuzzyEq(circle.area(), PI);
    circle.invertDirectionMut();
    expectFuzzyEq(circle.area(), -PI);
  }

  {
    const halfCircle = new Polyline({ isClosed: true });
    halfCircle.add(0.0, 0.0, -1.0);
    halfCircle.add(2.0, 0.0, 0.0);
    expectFuzzyEq(halfCircle.area(), -0.5 * PI);
    halfCircle.invertDirectionMut();
    expectFuzzyEq(halfCircle.area(), 0.5 * PI);
  }

  {
    const rectangle = new Polyline({ isClosed: true });
    rectangle.add(0.0, 0.0, 0.0);
    rectangle.add(3.0, 0.0, 0.0);
    rectangle.add(3.0, 2.0, 0.0);
    rectangle.add(0.0, 2.0, 0.0);
    expectFuzzyEq(rectangle.area(), 6.0);
    rectangle.invertDirectionMut();
    expectFuzzyEq(rectangle.area(), -6.0);
  }

  {
    const openPolyline = new Polyline();
    openPolyline.add(0.0, 0.0, 0.0);
    openPolyline.add(2.0, 0.0, 0.0);
    openPolyline.add(2.0, 2.0, 0.0);
    openPolyline.add(0.0, 2.0, 0.0);
    expectFuzzyEq(openPolyline.area(), 0.0);
    openPolyline.invertDirectionMut();
    expectFuzzyEq(openPolyline.area(), 0.0);
  }

  {
    const emptyOpenPolyline = new Polyline();
    expectFuzzyEq(emptyOpenPolyline.area(), 0.0);
  }

  {
    const emptyClosedPolyline = new Polyline({ isClosed: true });
    expectFuzzyEq(emptyClosedPolyline.area(), 0.0);
  }

  {
    const oneVertexOpenPolyline = new Polyline();
    oneVertexOpenPolyline.add(1.0, 1.0, 0.0);
    expectFuzzyEq(oneVertexOpenPolyline.area(), 0.0);
  }

  {
    const oneVertexClosedPolyline = new Polyline({ isClosed: true });
    oneVertexClosedPolyline.add(1.0, 1.0, 0.0);
    expectFuzzyEq(oneVertexClosedPolyline.area(), 0.0);
  }
});

test("path_length", () => {
  {
    const emptyOpenPolyline = new Polyline();
    expectFuzzyEq(emptyOpenPolyline.pathLength(), 0.0);
  }

  {
    const emptyClosedPolyline = new Polyline();
    expectFuzzyEq(emptyClosedPolyline.pathLength(), 0.0);
  }

  {
    const oneVertexOpenPolyline = new Polyline();
    oneVertexOpenPolyline.add(1.0, 1.0, 0.0);
    expectFuzzyEq(oneVertexOpenPolyline.pathLength(), 0.0);
  }

  {
    const oneVertexClosedPolyline = new Polyline({ isClosed: true });
    oneVertexClosedPolyline.add(1.0, 1.0, 0.0);
    expectFuzzyEq(oneVertexClosedPolyline.pathLength(), 0.0);
  }

  {
    const circle = new Polyline({ isClosed: true });
    circle.add(0.0, 0.0, 1.0);
    circle.add(2.0, 0.0, 1.0);
    expectFuzzyEq(circle.pathLength(), TAU);
    circle.invertDirectionMut();
    expectFuzzyEq(circle.pathLength(), TAU);
  }

  {
    const halfCircle = new Polyline({ isClosed: true });
    halfCircle.add(0.0, 0.0, -1.0);
    halfCircle.add(2.0, 0.0, 0.0);
    expectFuzzyEq(halfCircle.pathLength(), PI + 2.0);
    halfCircle.invertDirectionMut();
    expectFuzzyEq(halfCircle.pathLength(), PI + 2.0);
  }

  {
    const rectangle = new Polyline({ isClosed: true });
    rectangle.add(0.0, 0.0, 0.0);
    rectangle.add(3.0, 0.0, 0.0);
    rectangle.add(3.0, 2.0, 0.0);
    rectangle.add(0.0, 2.0, 0.0);
    expectFuzzyEq(rectangle.pathLength(), 10.0);
    rectangle.invertDirectionMut();
    expectFuzzyEq(rectangle.pathLength(), 10.0);
  }

  {
    const openPolyline = new Polyline();
    openPolyline.add(0.0, 0.0, 0.0);
    openPolyline.add(3.0, 0.0, 0.0);
    openPolyline.add(3.0, 2.0, 0.0);
    openPolyline.add(0.0, 2.0, 0.0);
    expectFuzzyEq(openPolyline.pathLength(), 8.0);
    openPolyline.invertDirectionMut();
    expectFuzzyEq(openPolyline.pathLength(), 8.0);
  }
});

test("extents", () => {
  {
    const emptyPline = new Polyline();
    expect(emptyPline.extents()).toBeNull();
  }

  {
    const oneVertexPline = new Polyline();
    oneVertexPline.add(1.0, 1.0, 0.0);
    expect(oneVertexPline.extents()).toBeNull();
  }

  {
    // basic line
    const pline = plineOpen([
      [-2.0, -1.0, 0.0],
      [3.0, 4.0, 0.0],
    ]);
    let extents = expectSome(pline.extents(), "extents to exist");
    expect(extents.minX).toBe(-2.0);
    expect(extents.minY).toBe(-1.0);
    expect(extents.maxX).toBe(3.0);
    expect(extents.maxY).toBe(4.0);

    pline.setIsClosed(true);
    extents = expectSome(pline.extents(), "extents to exist");
    expect(extents.minX).toBe(-2.0);
    expect(extents.minY).toBe(-1.0);
    expect(extents.maxX).toBe(3.0);
    expect(extents.maxY).toBe(4.0);
  }

  {
    // axis aligned circle
    const pline = plineClosed([
      [-1.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
    ]);
    let extents = expectSome(pline.extents(), "extents to exist");
    expect(extents.minX).toBe(-1.0);
    expect(extents.minY).toBe(-1.0);
    expect(extents.maxX).toBe(1.0);
    expect(extents.maxY).toBe(1.0);

    // half circle
    pline.setIsClosed(false);
    extents = expectSome(pline.extents(), "extents to exist");
    expect(extents.minX).toBe(-1.0);
    expect(extents.minY).toBe(-1.0);
    expect(extents.maxX).toBe(1.0);
    expect(extents.maxY).toBe(0.0);
  }

  {
    // axis aligned circle
    const pline = plineClosed([
      [0.0, -1.0, 1.0],
      [0.0, 1.0, 1.0],
    ]);
    let extents = expectSome(pline.extents(), "extents to exist");
    expect(extents.minX).toBe(-1.0);
    expect(extents.minY).toBe(-1.0);
    expect(extents.maxX).toBe(1.0);
    expect(extents.maxY).toBe(1.0);

    // half circle
    pline.setIsClosed(false);
    extents = expectSome(pline.extents(), "extents to exist");
    expect(extents.minX).toBe(0.0);
    expect(extents.minY).toBe(-1.0);
    expect(extents.maxX).toBe(1.0);
    expect(extents.maxY).toBe(1.0);
  }

  {
    // handles repeat position vertexes
    const pline = plineClosed([
      [-1.0, 0.0, 0.0],
      [-1.0, 0.0, 1.0],
      [-1.0, 0.0, 0.0],
      [-1.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
    ]);
    const extents = expectSome(pline.extents(), "extents to exist");
    expect(extents.minX).toBe(-1.0);
    expect(extents.minY).toBe(-1.0);
    expect(extents.maxX).toBe(1.0);
    expect(extents.maxY).toBe(1.0);
  }
});

test("find_point_at_path_length", () => {
  const pline = plineClosed([
    [0.0, 0.0, 1.0],
    [1.0, 0.0, -1.0],
    [1.0, 1.0, 0.0],
    [1.0, 2.0, 0.0],
  ]);
  const plinePathLength = pline.pathLength();

  // 0 path length (point at very start)
  {
    const r = pline.findPointAtPathLength(0.0);
    const expected: FindPointAtPathLengthResult = {
      ok: true,
      segIndex: 0,
      point: new Vector2(0.0, 0.0),
    };
    assertPathLengthResultEq(r, expected);
  }

  // total path length (point at very end)
  {
    const r = pline.findPointAtPathLength(plinePathLength);
    const expected: FindPointAtPathLengthResult = {
      ok: true,
      segIndex: 3,
      point: new Vector2(0.0, 0.0),
    };
    assertPathLengthResultEq(r, expected);
  }

  // negative path length
  {
    const r = pline.findPointAtPathLength(-1.0);
    const expected: FindPointAtPathLengthResult = {
      ok: true,
      segIndex: 0,
      point: new Vector2(0.0, 0.0),
    };
    assertPathLengthResultEq(r, expected);
  }

  // target path length greater than total
  {
    const r = pline.findPointAtPathLength(plinePathLength + 1.0);
    const expected: FindPointAtPathLengthResult = { ok: false, pathLength: plinePathLength };
    assertPathLengthResultEq(r, expected);
  }

  // half path length of first seg
  {
    const targetPathLength = segLength(pline.at(0), pline.at(1)) / 2.0;
    const r = pline.findPointAtPathLength(targetPathLength);
    const expected: FindPointAtPathLengthResult = {
      ok: true,
      segIndex: 0,
      point: new Vector2(0.5, -0.5),
    };
    assertPathLengthResultEq(r, expected);
  }

  // full path length of first seg
  {
    const targetPathLength = segLength(pline.at(0), pline.at(1));
    const r = pline.findPointAtPathLength(targetPathLength);
    const expected: FindPointAtPathLengthResult = {
      ok: true,
      segIndex: 0,
      point: new Vector2(1.0, 0.0),
    };
    assertPathLengthResultEq(r, expected);
  }

  // half path length into second seg
  {
    const targetPathLength =
      segLength(pline.at(0), pline.at(1)) + segLength(pline.at(1), pline.at(2)) / 2.0;
    const r = pline.findPointAtPathLength(targetPathLength);
    const expected: FindPointAtPathLengthResult = {
      ok: true,
      segIndex: 1,
      point: new Vector2(0.5, 0.5),
    };
    assertPathLengthResultEq(r, expected);
  }

  // half path length into third seg
  {
    const targetPathLength =
      segLength(pline.at(0), pline.at(1)) +
      segLength(pline.at(1), pline.at(2)) +
      segLength(pline.at(2), pline.at(3)) / 2.0;
    const r = pline.findPointAtPathLength(targetPathLength);
    const expected: FindPointAtPathLengthResult = {
      ok: true,
      segIndex: 2,
      point: new Vector2(1.0, 1.5),
    };
    assertPathLengthResultEq(r, expected);
  }

  // sub slice tests (mostly to validate segment index offset)
  const subSlice = expectSome(
    PlineViewData.fromSlicePoints(pline, pline.at(2).pos(), 2, pline.at(3).pos(), 3, 1e-5),
    "slice not collapsed",
  );
  const subSliceLength = segLength(pline.at(2), pline.at(3));
  const view = subSlice.view(pline);

  // 0 path length (point at very start)
  {
    const r = view.findPointAtPathLength(0.0);
    const expected: FindPointAtPathLengthResult = {
      ok: true,
      segIndex: 0,
      point: new Vector2(1.0, 1.0),
    };
    assertPathLengthResultEq(r, expected);
  }

  // total path length (point at very end)
  {
    const r = view.findPointAtPathLength(subSliceLength);
    const expected: FindPointAtPathLengthResult = {
      ok: true,
      segIndex: 0,
      point: new Vector2(1.0, 2.0),
    };
    assertPathLengthResultEq(r, expected);
  }
});

test("create_from_remove_repeat", () => {
  const pline = plineClosed([
    [0.0, 0.0, 0.0],
    [1.0, 0.0, 0.0],
    [1.0, 0.0, 0.0],
    [1.0, 1.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 0.0],
  ]);

  const result = Polyline.createFromRemoveRepeat(pline, 1e-5);

  const expected = plineClosed([
    [0.0, 0.0, 0.0],
    [1.0, 0.0, 0.0],
    [1.0, 1.0, 0.0],
    [0.0, 1.0, 0.0],
  ]);

  expect(result.fuzzyEq(expected)).toBe(true);
});
