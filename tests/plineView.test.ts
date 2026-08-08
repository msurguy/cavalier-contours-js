// Port of Rust `tests/test_pline_view.rs`.
import { expect, test } from "vitest";
import { bulgeFromAngle, pointOnCircle } from "../src/core/mathUtils.js";
import { Vector2 } from "../src/core/vector2.js";
import { plineClosed, plineOpen } from "../src/polyline/construct.js";
import { PlineVertex } from "../src/polyline/plineVertex.js";
import { PlineViewData } from "../src/polyline/plineView.js";
import type { PlineSourceBase } from "../src/polyline/plineSourceBase.js";
import { Polyline } from "../src/polyline/polyline.js";
import {
  expectPlineFuzzyEq,
  expectSome,
  expectVector2FuzzyEq,
  expectVertexFuzzyEq,
} from "./testUtils/fuzzyAssert.js";

const PI = Math.PI;
const FRAC_PI_2 = Math.PI / 2.0;
const FRAC_PI_3 = Math.PI / 3.0;

const POS_EQ_EPS = 1e-5;

/** Rust `zip` of `iter_segments()` comparing vertexes fuzzily (full vertex compare). */
function expectSegmentsFuzzyEq(expected: PlineSourceBase, view: PlineSourceBase): void {
  const expectedSegs = [...expected.iterSegments()];
  const viewSegs = [...view.iterSegments()];
  const count = Math.min(expectedSegs.length, viewSegs.length);
  for (let i = 0; i < count; i += 1) {
    const [v1, v2] = expectedSegs[i];
    const [u1, u2] = viewSegs[i];
    expectVertexFuzzyEq(u1, v1);
    expectVector2FuzzyEq(u2.pos(), v2.pos());
  }
}

test("from_slice_points_single_seg", () => {
  const pline = plineOpen([
    [0.0, 0.0, 1.0],
    [1.0, 0.0, 0.0],
  ]);

  // complete polyline
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(0.0, 0.0),
        0,
        new Vector2(1.0, 0.0),
        0,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    expectPlineFuzzyEq(plineFromSlice, pline);
  }

  // complete polyline (end segment index on top of final vertex)
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(0.0, 0.0),
        0,
        new Vector2(1.0, 0.0),
        1,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    expectPlineFuzzyEq(plineFromSlice, pline);
  }

  // slice from start to middle
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(0.0, 0.0),
        0,
        new Vector2(0.5, -0.5),
        0,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    const bulge = bulgeFromAngle(FRAC_PI_2);
    const expectedResult = plineOpen([
      [0.0, 0.0, bulge],
      [0.5, -0.5, 0.0],
    ]);
    expectPlineFuzzyEq(plineFromSlice, expectedResult);
  }

  // slice from middle to end
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(0.5, -0.5),
        0,
        new Vector2(1.0, 0.0),
        0,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    const bulge = bulgeFromAngle(FRAC_PI_2);
    const expectedResult = plineOpen([
      [0.5, -0.5, bulge],
      [1.0, 0.0, 0.0],
    ]);
    expectPlineFuzzyEq(plineFromSlice, expectedResult);
  }

  // slice from middle to end (end segment index on top of final vertex)
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(0.5, -0.5),
        0,
        new Vector2(1.0, 0.0),
        1,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    const bulge = bulgeFromAngle(FRAC_PI_2);
    const expectedResult = plineOpen([
      [0.5, -0.5, bulge],
      [1.0, 0.0, 0.0],
    ]);
    expectPlineFuzzyEq(plineFromSlice, expectedResult);
  }

  // slice from first third to second third of the segment
  {
    const startPoint = pointOnCircle(0.5, new Vector2(0.5, 0.0), PI + FRAC_PI_3);
    const endPoint = pointOnCircle(0.5, new Vector2(0.5, 0.0), PI + 2.0 * FRAC_PI_3);
    const slice = expectSome(
      PlineViewData.fromSlicePoints(pline, startPoint, 0, endPoint, 0, POS_EQ_EPS),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    const bulge = bulgeFromAngle(FRAC_PI_3);
    const expectedResult = (() => {
      const p = new Polyline();
      p.addVertex(PlineVertex.fromVector2(startPoint, bulge));
      p.addVertex(PlineVertex.fromVector2(endPoint, 0.0));
      return p;
    })();

    expectPlineFuzzyEq(plineFromSlice, expectedResult);
  }

  // collapsed slice at start
  {
    const slice = PlineViewData.fromSlicePoints(
      pline,
      new Vector2(0.0, 0.0),
      0,
      new Vector2(0.0, 0.0),
      0,
      POS_EQ_EPS,
    );

    expect(slice).toBeNull();
  }

  // collapsed slice at end
  {
    const slice = PlineViewData.fromSlicePoints(
      pline,
      new Vector2(1.0, 0.0),
      0,
      new Vector2(1.0, 0.0),
      0,
      POS_EQ_EPS,
    );

    expect(slice).toBeNull();
  }

  const closedPline = plineClosed([
    [0.0, 0.0, 0.0],
    [5.0, 0.0, 0.0],
    [5.0, 5.0, 0.0],
    [0.0, 5.0, 0.0],
  ]);

  // collapsed closed polyline (by having start and end point same with same segment index)
  {
    const slice = PlineViewData.fromSlicePoints(
      closedPline,
      new Vector2(0.0, 0.0),
      0,
      new Vector2(0.0, 0.0),
      0,
      POS_EQ_EPS,
    );

    expect(slice).toBeNull();
  }

  // complete closed polyline (by having end point be at end of last segment)
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        closedPline,
        new Vector2(0.0, 0.0),
        0,
        new Vector2(0.0, 0.0),
        3,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const view = slice.view(closedPline);
    const closedSegs = [...closedPline.iterSegments()];
    const viewSegs = [...view.iterSegments()];
    const count = Math.min(closedSegs.length, viewSegs.length);
    for (let i = 0; i < count; i += 1) {
      const [v1, v2] = closedSegs[i];
      const [u1, u2] = viewSegs[i];
      expectVertexFuzzyEq(u1, v1);
      expectVertexFuzzyEq(u2, v2);
    }
  }
});

test("from_slice_points_collapsed_across_near_vertex", () => {
  const pline = plineOpen([
    [0.0, 0.0, 0.0],
    [0.0, POS_EQ_EPS * 1.1, 0.0],
    [0.0, -1.0, 0.0],
  ]);

  const slice = PlineViewData.fromSlicePoints(
    pline,
    new Vector2(0.0, 0.0),
    0,
    new Vector2(0.0, POS_EQ_EPS * 0.55),
    1,
    POS_EQ_EPS,
  );

  expect(slice).toBeNull();
});

test("from_slice_points_multi_seg", () => {
  const pline = plineClosed([
    [0.0, 0.0, 1.0],
    [1.0, 0.0, 0.0],
    [1.0, 1.0, 0.0],
  ]);

  // complete polyline
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(0.0, 0.0),
        0,
        new Vector2(1.0, 1.0),
        1,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    const expectedResult = (() => {
      const pl = pline.clone();
      pl.setIsClosed(false);
      return pl;
    })();
    expectPlineFuzzyEq(plineFromSlice, expectedResult);
  }

  // complete polyline (end segment index on top of last vertex)
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(0.0, 0.0),
        0,
        new Vector2(1.0, 1.0),
        2,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    const expectedResult = (() => {
      const pl = pline.clone();
      pl.setIsClosed(false);
      return pl;
    })();
    expectPlineFuzzyEq(plineFromSlice, expectedResult);
  }

  // slice from start to middle of first segment
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(0.0, 0.0),
        0,
        new Vector2(0.5, -0.5),
        0,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    const bulge = bulgeFromAngle(FRAC_PI_2);
    const expectedResult = plineOpen([
      [0.0, 0.0, bulge],
      [0.5, -0.5, 0.0],
    ]);
    expectPlineFuzzyEq(plineFromSlice, expectedResult);
  }

  // slice from middle to end of first segment
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(0.5, -0.5),
        0,
        new Vector2(1.0, 0.0),
        0,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    const bulge = bulgeFromAngle(FRAC_PI_2);
    const expectedResult = plineOpen([
      [0.5, -0.5, bulge],
      [1.0, 0.0, 0.0],
    ]);
    expectPlineFuzzyEq(plineFromSlice, expectedResult);
  }

  // slice from start to second vertex
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(0.0, 0.0),
        0,
        new Vector2(1.0, 0.0),
        0,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    const expectedResult = plineOpen([
      [0.0, 0.0, 1.0],
      [1.0, 0.0, 0.0],
    ]);
    expectPlineFuzzyEq(plineFromSlice, expectedResult);
  }

  // slice from start to middle of second segment
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(0.0, 0.0),
        0,
        new Vector2(1.0, 0.5),
        1,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    const expectedResult = plineOpen([
      [0.0, 0.0, 1.0],
      [1.0, 0.0, 0.0],
      [1.0, 0.5, 0.0],
    ]);
    expectPlineFuzzyEq(plineFromSlice, expectedResult);
  }

  // slice from second vertex to middle of second segment
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(1.0, 0.0),
        1,
        new Vector2(1.0, 0.5),
        1,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    const expectedResult = plineOpen([
      [1.0, 0.0, 0.0],
      [1.0, 0.5, 0.0],
    ]);
    expectPlineFuzzyEq(plineFromSlice, expectedResult);
  }

  // slice from second vertex to middle of second segment (using previous index for start)
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(1.0, 0.0),
        0,
        new Vector2(1.0, 0.5),
        1,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    const expectedResult = plineOpen([
      [1.0, 0.0, 0.0],
      [1.0, 0.5, 0.0],
    ]);
    expectPlineFuzzyEq(plineFromSlice, expectedResult);
  }

  // slice from middle of first segment to last vertex position
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(0.5, -0.5),
        0,
        new Vector2(1.0, 1.0),
        1,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    const bulge = bulgeFromAngle(FRAC_PI_2);
    const expectedResult = plineOpen([
      [0.5, -0.5, bulge],
      [1.0, 0.0, 0.0],
      [1.0, 1.0, 0.0],
    ]);
    expectPlineFuzzyEq(plineFromSlice, expectedResult);
  }

  // slice from middle of end segment to middle of first segment (wrapping)
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(1.0, 0.5),
        1,
        new Vector2(0.5, -0.5),
        0,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    const bulge = bulgeFromAngle(FRAC_PI_2);
    const expectedResult = plineOpen([
      [1.0, 0.5, 0.0],
      [1.0, 1.0, 0.0],
      [0.0, 0.0, bulge],
      [0.5, -0.5, 0.0],
    ]);
    expectPlineFuzzyEq(plineFromSlice, expectedResult);
  }

  // collapsed slice at start
  {
    const slice = PlineViewData.fromSlicePoints(
      pline,
      new Vector2(0.0, 0.0),
      0,
      new Vector2(0.0, 0.0),
      0,
      POS_EQ_EPS,
    );
    expect(slice).toBeNull();
  }

  // collapsed slice at midpoint of second segment
  {
    const slice = PlineViewData.fromSlicePoints(
      pline,
      new Vector2(1.0, 0.5),
      1,
      new Vector2(1.0, 0.5),
      1,
      POS_EQ_EPS,
    );
    expect(slice).toBeNull();
  }

  // slice from middle of first segment wrapping back to start of first segment
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(0.5, -0.5),
        0,
        new Vector2(0.0, 0.0),
        0,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    const bulge = bulgeFromAngle(FRAC_PI_2);
    const expectedResult = plineOpen([
      [0.5, -0.5, bulge],
      [1.0, 0.0, 0.0],
      [1.0, 1.0, 0.0],
      [0.0, 0.0, 0.0],
    ]);
    expectPlineFuzzyEq(plineFromSlice, expectedResult);
  }

  // slice from middle of second segment wrapping back to middle of first segment
  {
    const slice = expectSome(
      PlineViewData.fromSlicePoints(
        pline,
        new Vector2(1.0, 0.5),
        1,
        new Vector2(0.5, -0.5),
        0,
        POS_EQ_EPS,
      ),
      "slice not collapsed",
    );

    const plineFromSlice = Polyline.createFrom(slice.view(pline));
    const bulge = bulgeFromAngle(FRAC_PI_2);
    const expectedResult = plineOpen([
      [1.0, 0.5, 0.0],
      [1.0, 1.0, 0.0],
      [0.0, 0.0, bulge],
      [0.5, -0.5, 0.0],
    ]);
    expectPlineFuzzyEq(plineFromSlice, expectedResult);
  }
});

test("attempting_to_wrap_slice_on_open_pline", () => {
  // Rust `#[should_panic]` test — the debug assert throws in the JS port.
  const pline = plineOpen([
    [0.0, 0.0, 1.0],
    [1.0, 0.0, 0.0],
    [1.0, 1.0, 0.0],
  ]);
  expect(() =>
    PlineViewData.fromSlicePoints(
      pline,
      new Vector2(1.0, 0.5),
      1,
      new Vector2(0.5, -0.5),
      0,
      POS_EQ_EPS,
    ),
  ).toThrowError("start index should be less than or equal to end index if polyline is open");
});

test("from_new_start", () => {
  const closedPline = plineClosed([
    [0.0, 0.0, 0.0],
    [5.0, 0.0, 0.0],
    [5.0, 5.0, 0.0],
    [0.0, 5.0, 0.0],
  ]);

  const closedPlineWithBulges = plineClosed([
    [0.0, 0.0, 0.1],
    [5.0, 0.0, 0.2],
    [5.0, 5.0, 0.3],
    [0.0, 5.0, 0.4],
  ]);

  // change start on first segment of closed polyline
  {
    const viewData = expectSome(
      PlineViewData.fromNewStart(closedPline, new Vector2(1.5, 0.0), 0, POS_EQ_EPS),
      "view data to be created",
    );

    const expected = plineClosed([
      [1.5, 0.0, 0.0],
      [5.0, 0.0, 0.0],
      [5.0, 5.0, 0.0],
      [0.0, 5.0, 0.0],
      [0.0, 0.0, 0.0],
    ]);

    const view = viewData.view(closedPline);

    expect(view.segmentCount()).toBe(expected.segmentCount());

    expectSegmentsFuzzyEq(expected, view);
  }

  // change start on top of first vertex of closed polyline (no change)
  {
    const viewData = expectSome(
      PlineViewData.fromNewStart(closedPline, new Vector2(0.0, 0.0), 0, POS_EQ_EPS),
      "view data to be created",
    );

    const view = viewData.view(closedPline);

    expect(view.segmentCount()).toBe(closedPline.segmentCount());

    expectSegmentsFuzzyEq(closedPline, view);
  }

  // change start on top of first vertex of closed polyline with bulge values (no change)
  {
    const viewData = expectSome(
      PlineViewData.fromNewStart(closedPlineWithBulges, new Vector2(0.0, 0.0), 0, POS_EQ_EPS),
      "view data to be created",
    );

    const view = viewData.view(closedPlineWithBulges);

    expect(view.segmentCount()).toBe(closedPlineWithBulges.segmentCount());

    expectSegmentsFuzzyEq(closedPlineWithBulges, view);
  }

  // change start on top of first vertex of closed polyline (no change) (using last segment index
  // that puts point on end of segment)
  {
    const viewData = expectSome(
      PlineViewData.fromNewStart(closedPline, new Vector2(0.0, 0.0), 3, POS_EQ_EPS),
      "view data to be created",
    );

    const view = viewData.view(closedPline);

    expect(view.segmentCount()).toBe(closedPline.segmentCount());

    expectSegmentsFuzzyEq(closedPline, view);
  }

  // change start on top of second vertex of closed polyline
  {
    const viewData = expectSome(
      PlineViewData.fromNewStart(closedPline, new Vector2(5.0, 0.0), 1, POS_EQ_EPS),
      "view data to be created",
    );

    const expected = plineClosed([
      [5.0, 0.0, 0.0],
      [5.0, 5.0, 0.0],
      [0.0, 5.0, 0.0],
      [0.0, 0.0, 0.0],
    ]);

    const view = viewData.view(closedPline);

    expect(view.segmentCount()).toBe(expected.segmentCount());

    expectSegmentsFuzzyEq(expected, view);
  }

  // change start on top of first vertex of closed polyline with bulge values (no change)
  {
    const viewData = expectSome(
      PlineViewData.fromNewStart(closedPlineWithBulges, new Vector2(5.0, 0.0), 1, POS_EQ_EPS),
      "view data to be created",
    );

    const expected = plineClosed([
      [5.0, 0.0, 0.2],
      [5.0, 5.0, 0.3],
      [0.0, 5.0, 0.4],
      [0.0, 0.0, 0.1],
    ]);

    const view = viewData.view(closedPlineWithBulges);

    expect(view.segmentCount()).toBe(expected.segmentCount());

    expectSegmentsFuzzyEq(expected, view);
  }

  // change start on top of second vertex of closed polyline (using last segment index
  // that puts point on end of segment)
  {
    const viewData = expectSome(
      PlineViewData.fromNewStart(closedPline, new Vector2(5.0, 0.0), 0, POS_EQ_EPS),
      "view data to be created",
    );

    const expected = plineClosed([
      [5.0, 0.0, 0.0],
      [5.0, 5.0, 0.0],
      [0.0, 5.0, 0.0],
      [0.0, 0.0, 0.0],
    ]);

    const view = viewData.view(closedPline);

    expect(view.segmentCount()).toBe(expected.segmentCount());

    expectSegmentsFuzzyEq(expected, view);
  }

  // change start on second segment of closed polyline
  {
    const viewData = expectSome(
      PlineViewData.fromNewStart(closedPline, new Vector2(5.0, 2.22), 1, POS_EQ_EPS),
      "view data to be created",
    );

    const expected = plineClosed([
      [5.0, 2.22, 0.0],
      [5.0, 5.0, 0.0],
      [0.0, 5.0, 0.0],
      [0.0, 0.0, 0.0],
      [5.0, 0.0, 0.0],
    ]);

    const view = viewData.view(closedPline);

    expect(view.segmentCount()).toBe(expected.segmentCount());

    expectSegmentsFuzzyEq(expected, view);
  }

  // change start on last segment of closed polyline
  {
    const viewData = expectSome(
      PlineViewData.fromNewStart(closedPline, new Vector2(0.0, 2.22), 3, POS_EQ_EPS),
      "view data to be created",
    );

    const expected = plineClosed([
      [0.0, 2.22, 0.0],
      [0.0, 0.0, 0.0],
      [5.0, 0.0, 0.0],
      [5.0, 5.0, 0.0],
      [0.0, 5.0, 0.0],
    ]);

    const view = viewData.view(closedPline);

    expect(view.segmentCount()).toBe(expected.segmentCount());

    expectSegmentsFuzzyEq(expected, view);
  }
});
