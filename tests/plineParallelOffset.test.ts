// Port of Rust `tests/test_pline_parallel_offset.rs`.
//
// The Rust `declare_offset_tests!`/`declare_self_intersecting_offset_tests!` macro tables become
// typed case arrays run through `describe`/`test` loops. Every case is ported with the expected
// numeric literals copied verbatim.
import { describe, expect, test } from "vitest";
// importing the package entry registers the `parallelOffset` implementation used by
// `PlineSourceBase.parallelOffsetOpt` (see `src/polyline/internal/plineOffsetRegistry.ts`)
import "../src/index";
import { plineClosed, plineOpen } from "../src/polyline/construct.js";
import type { PlineOffsetOptions } from "../src/polyline/plineTypes.js";
import { Polyline } from "../src/polyline/polyline.js";
import { ModifiedPlineSet, type ModifiedPlineSetVisitor } from "./testUtils/plineModifiers.js";
import {
  createPropertySet,
  PlineProperties,
  propertySetsMatch,
} from "./testUtils/plineTestProperties.js";

function offsetIntoPropertiesSet(
  polyline: Polyline,
  offset: number,
  inverted: boolean,
  handleSelfIntersects: boolean,
): PlineProperties[] {
  const o = inverted ? -offset : offset;
  const options: PlineOffsetOptions = { handleSelfIntersects };
  const offsetResults = polyline.parallelOffsetOpt(o, options);
  for (const r of offsetResults) {
    expect(
      r.removeRepeatPos(PlineProperties.POS_EQ_EPS),
      "offset result should not have repeat positioned vertexes",
    ).toBeNull();
  }
  return createPropertySet(offsetResults, inverted);
}

function runPlineOffsetTests(
  input: Polyline,
  offset: number,
  expectedPropertiesSet: readonly PlineProperties[],
  handleSelfIntersects: boolean,
): void {
  const visitor: ModifiedPlineSetVisitor = (modifiedPline, plineState) => {
    const offsetResults = offsetIntoPropertiesSet(
      modifiedPline,
      offset,
      plineState.invertedDirection,
      handleSelfIntersects,
    );
    expect(
      propertySetsMatch(offsetResults, expectedPropertiesSet),
      `property sets do not match, modified state: ${JSON.stringify(plineState)}`,
    ).toBe(true);

    // For closed polylines, also test with handle_self_intersects=true since it uses a
    // different code path (open polylines always use the same path regardless of this flag)
    if (modifiedPline.isClosed) {
      const offsetResultsSelfIntr = offsetIntoPropertiesSet(
        modifiedPline,
        offset,
        plineState.invertedDirection,
        true,
      );
      expect(
        propertySetsMatch(offsetResultsSelfIntr, expectedPropertiesSet),
        `property sets do not match with handle_self_intersects set to true, modified state: ${JSON.stringify(plineState)}`,
      ).toBe(true);
    }
  };

  const testSet = new ModifiedPlineSet(input, true, true);
  testSet.accept(visitor);
}

interface OffsetTestCase {
  name: string;
  input: Polyline;
  offset: number;
  expected: PlineProperties[];
}

function declareOffsetTests(cases: readonly OffsetTestCase[], handleSelfIntersects: boolean): void {
  for (const c of cases) {
    test(c.name, () => {
      runPlineOffsetTests(c.input, c.offset, c.expected, handleSelfIntersects);
    });
  }
}

/** Simple/basic test cases for parallel offset (e.g. circles and rectangles). */
describe("test_simple", () => {
  const cases: OffsetTestCase[] = [
    {
      name: "empty_returns_empty",
      input: new Polyline(),
      offset: 5.0,
      expected: [],
    },
    {
      name: "circle_collapsed_into_point",
      input: plineClosed(
        [
          [0.0, 0.0, 1.0],
          [2.0, 0.0, 1.0],
        ],
        { userdata: [4] },
      ),
      offset: 1.0,
      expected: [],
    },
    {
      name: "square_collapsed_into_point",
      input: plineClosed(
        [
          [-1.0, -1.0, 0.0],
          [1.0, -1.0, 0.0],
          [1.0, 1.0, 0.0],
          [-1.0, 1.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 1.0,
      expected: [],
    },
    {
      name: "circle_collapsed",
      input: plineClosed(
        [
          [0.0, 0.0, 1.0],
          [2.0, 0.0, 1.0],
        ],
        { userdata: [4] },
      ),
      offset: 2.0,
      expected: [],
    },
    {
      name: "square_collapsed",
      input: plineClosed(
        [
          [-1.0, -1.0, 0.0],
          [1.0, -1.0, 0.0],
          [1.0, 1.0, 0.0],
          [-1.0, 1.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 2.0,
      expected: [],
    },
    {
      name: "closed_rectangle_inward",
      input: plineClosed(
        [
          [0.0, 0.0, 0.0],
          [20.0, 0.0, 0.0],
          [20.0, 10.0, 0.0],
          [0.0, 10.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 2.0,
      expected: [new PlineProperties(4, 96.0, 44.0, 2.0, 2.0, 18.0, 8.0, [4])],
    },
    {
      name: "closed_rectangle_outward",
      input: plineClosed(
        [
          [0.0, 0.0, 0.0],
          [20.0, 0.0, 0.0],
          [20.0, 10.0, 0.0],
          [0.0, 10.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: -2.0,
      expected: [new PlineProperties(8, 332.56637061436, 72.566370614359, -2.0, -2.0, 22.0, 12.0, [4])],
    },
    {
      name: "open_rectangle_inward",
      input: plineOpen(
        [
          [0.0, 0.0, 0.0],
          [20.0, 0.0, 0.0],
          [20.0, 10.0, 0.0],
          [0.0, 10.0, 0.0],
          [0.0, 0.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 2.0,
      expected: [new PlineProperties(5, 0.0, 44.0, 2.0, 2.0, 18.0, 8.0, [4])],
    },
    {
      name: "open_rectangle_outward",
      input: plineOpen(
        [
          [0.0, 0.0, 0.0],
          [20.0, 0.0, 0.0],
          [20.0, 10.0, 0.0],
          [0.0, 10.0, 0.0],
          [0.0, 0.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: -2.0,
      expected: [new PlineProperties(8, 0.0, 69.424777960769, -2.0, -2.0, 22.0, 12.0, [4])],
    },
    {
      name: "closed_rectangle_into_overlapping_line",
      input: plineClosed(
        [
          [0.0, 0.0, 0.0],
          [20.0, 0.0, 0.0],
          [20.0, 10.0, 0.0],
          [0.0, 10.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 5.0,
      expected: [new PlineProperties(2, 0.0, 20.0, 5.0, 5.0, 15.0, 5.0, [4])],
    },
    {
      name: "closed_diamond_offset_inward",
      input: plineClosed(
        [
          [-10.0, 0.0, 0.0],
          [0.0, 10.0, 0.0],
          [10.0, 0.0, 0.0],
          [0.0, -10.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: -5.0,
      expected: [
        new PlineProperties(
          4,
          -17.157287525381,
          16.568542494924,
          -2.9289321881345,
          -2.9289321881345,
          2.9289321881345,
          2.9289321881345,
          [4],
        ),
      ],
    },
    {
      name: "closed_diamond_offset_outward",
      input: plineClosed(
        [
          [-10.0, 0.0, 0.0],
          [0.0, 10.0, 0.0],
          [10.0, 0.0, 0.0],
          [0.0, -10.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 5.0,
      expected: [
        new PlineProperties(8, -561.38252881436, 87.984469030822, -15.0, -15.0, 15.0, 15.0, [4]),
      ],
    },
    {
      name: "open_diamond_offset_inward",
      input: plineOpen(
        [
          [-10.0, 0.0, 0.0],
          [0.0, 10.0, 0.0],
          [10.0, 0.0, 0.0],
          [0.0, -10.0, 0.0],
          [-10.0, 0.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: -5.0,
      expected: [
        new PlineProperties(
          5,
          0.0,
          16.568542494924,
          -2.9289321881345,
          -2.9289321881345,
          2.9289321881345,
          2.9289321881345,
          [4],
        ),
      ],
    },
    {
      name: "open_diamond_offset_outward",
      input: plineOpen(
        [
          [-10.0, 0.0, 0.0],
          [0.0, 10.0, 0.0],
          [10.0, 0.0, 0.0],
          [0.0, -10.0, 0.0],
          [-10.0, 0.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 5.0,
      expected: [
        new PlineProperties(8, 0.0, 80.130487396847, -13.535533905933, -15.0, 15.0, 15.0, [4]),
      ],
    },
    {
      name: "closed_circle_offset_inward",
      input: plineClosed(
        [
          [-5.0, 0.0, 1.0],
          [5.0, 0.0, 1.0],
        ],
        { userdata: [4] },
      ),
      offset: 3.0,
      expected: [new PlineProperties(2, 12.566370614359, 12.566370614359, -2.0, -2.0, 2.0, 2.0, [4])],
    },
    {
      name: "closed_circle_offset_outward",
      input: plineClosed(
        [
          [-5.0, 0.0, 1.0],
          [5.0, 0.0, 1.0],
        ],
        { userdata: [4] },
      ),
      offset: -3.0,
      expected: [new PlineProperties(2, 201.06192982975, 50.265482457437, -8.0, -8.0, 8.0, 8.0, [4])],
    },
  ];

  declareOffsetTests(cases, false);
});

/** Specific test cases for parallel offset that trigger edge case scenarios or specific code paths. */
describe("test_specific", () => {
  const cases: OffsetTestCase[] = [
    {
      // offset arc just past line, in this case float epsilon values can cause failures
      name: "case1",
      input: plineClosed(
        [
          [27.804688, 1.0, 0.0],
          [28.46842055794889, 0.3429054695163245, 0.0],
          [32.34577133994935, 0.9269762697003898, 0.0],
          [32.38116957207762, 1.451312562563487, 0.0],
          [31.5, 1.0, -0.31783751349740424],
          [30.79289310940682, 1.5, 0.0],
          [29.20710689059337, 1.5, -0.31783754777018053],
          [28.49999981323106, 1.00000000000007, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 0.1,
      expected: [
        new PlineProperties(
          4,
          0.094833810726263,
          1.8213211761499,
          31.533345690439,
          0.90572346564886,
          32.26949555256,
          1.2817628453883,
          [4],
        ),
        new PlineProperties(
          6,
          1.7197931450343,
          7.5140262005179,
          28.047835685678,
          0.44926177903859,
          31.495431966272,
          1.4,
          [4],
        ),
      ],
    },
    {
      // first vertex position is on top of intersect with second segment (leading to some
      // edge cases around the join between the last vertex and first vertex)
      name: "case2",
      input: plineClosed(
        [
          [27.804688, 1.0, 0.0],
          [27.804688, 0.75, 0.0],
          [32.195313, 0.75, 0.0],
          [32.195313, 1.0, 0.0],
          [31.5, 1.0, -0.3178375134974],
          [30.792893109407, 1.5, 0.0],
          [29.207106890593, 1.5, -0.31783754777018],
          [28.499999813231, 1.0000000000001, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 0.25,
      expected: [
        new PlineProperties(4, 0.36247092523069, 3.593999211522, 29.16143806012, 1.0, 30.838561906052, 1.25, [4]),
      ],
    },
    {
      // collapsed rectangle with raw offset polyline having no self intersects
      name: "case3",
      input: plineClosed(
        [
          [0.0, 0.0, 0.0],
          [120.0, 0.0, 0.0],
          [120.0, 40.0, 0.0],
          [0.0, 40.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 30.0,
      expected: [],
    },
    {
      // three consecutive raw off segments intersect at the same point
      name: "case4",
      input: plineOpen(
        [
          [30.12347538297979, -17.0, 0.0],
          [42.0, -17.0, 0.0],
          [42.0, 17.0, 0.0],
          [30.123475382979798, 17.0, -0.09331155002441319],
          [30.5, 15.0, 0.0],
          [30.5, -15.0, -0.09331155002441341],
        ],
        { userdata: [4] },
      ),
      offset: -2.0,
      expected: [new PlineProperties(9, 0.0, 99.224754131592, 28.12347538298, -19.0, 44.0, 19.0, [4])],
    },
    {
      // tests clipping circle at start of polyline works correctly (with collapsed arc at
      // start)
      name: "case5",
      input: plineOpen(
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
      offset: -30.0,
      expected: [
        new PlineProperties(
          7,
          0.0,
          916.7498699472794,
          50.000000000000014,
          -74.99999999999997,
          434.41586988912127,
          240.0,
          [4],
        ),
      ],
    },
    {
      // tests line to line join where one of the lines is a collapsed arc and has there is no
      // intersection between them (they should be connected with an arc)
      name: "case6",
      input: plineOpen(
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
      offset: 45.0,
      expected: [
        new PlineProperties(
          9,
          0.0,
          354.5924544050689,
          137.36151283418917,
          37.416573867739416,
          357.2096858656279,
          125.02881860280142,
          [4],
        ),
      ],
    },
    {
      // tests line to line join where one of the lines is a collapsed arc and there is a
      // false intersect between them (they should be connected with an arc)
      name: "case7",
      input: plineOpen(
        [
          [347.88382287598745, 269.85890289007887, -0.5],
          [80.0, 90.0, 0.374794619217547],
          [204.65318559134363, 55.01294696311311, 0.0],
          [179.35722417454295, -56.42578188285236, 1.0],
          [270.7403323676961, -93.94095261477841, -0.5],
          [346.1511941991571, 157.81558178838168, 0.5],
          [390.0, 210.0, 0.0],
          [495.7348032988456, 68.8739763777561, 0.5],
        ],
        { userdata: [4] },
      ),
      offset: 47.0,
      expected: [
        new PlineProperties(
          4,
          0.0,
          226.5117782356207,
          394.0401535993119,
          97.05525803008165,
          533.3488347822203,
          267.40547394194897,
          [4],
        ),
      ],
    },
    {
      // almost collapsed adjacent arcs with true intersects
      name: "case8",
      input: plineClosed(
        [
          [30.0, 0.0, 1.0],
          [30.0, 150.0, 0.0],
          [-380.0, 0.0, 0.0],
          [30.0, -150.0, 1.0],
        ],
        { userdata: [4] },
      ),
      offset: 71.0,
      expected: [
        new PlineProperties(
          3,
          31.563080748331117,
          36.43002218023972,
          17.851377192815367,
          69.95291962376376,
          34.00000003096393,
          75.82916586272847,
          [4],
        ),
        new PlineProperties(
          3,
          7211.747093261731,
          504.5601794261032,
          -173.3532697788056,
          -61.27715478753268,
          -5.862380026216215,
          61.27715478753261,
          [4],
        ),
        new PlineProperties(
          3,
          31.56308032687207,
          36.43002208996665,
          17.851377192815107,
          -75.82916586272874,
          34.000000000000675,
          -69.95291962376365,
          [4],
        ),
      ],
    },
    {
      // almost collapsed adjacent arcs with false intersects
      name: "case9",
      input: plineClosed(
        [
          [30.0, 0.0, 1.0],
          [30.0, 150.0, 0.0],
          [-380.0, 0.0, 0.0],
          [30.0, -150.0, 1.0],
        ],
        { userdata: [4] },
      ),
      offset: 73.0,
      expected: [
        new PlineProperties(
          3,
          6273.618943028112,
          440.30207980349326,
          -167.53223512468745,
          -54.49913379476977,
          -18.567936085649954,
          54.499133794769804,
          [4],
        ),
      ],
    },
    {
      // collapsed adjacent arcs
      name: "case10",
      input: plineClosed(
        [
          [30.0, 0.0, 1.0],
          [30.0, 150.0, 0.0],
          [-380.0, 0.0, 0.0],
          [30.0, -150.0, 1.0],
        ],
        { userdata: [4] },
      ),
      offset: 77.0,
      expected: [
        new PlineProperties(
          3,
          4682.865221417136,
          359.74976552142584,
          -155.89016581645112,
          -45.203002912175684,
          -32.335291189837534,
          45.203002912175705,
          [4],
        ),
      ],
    },
    {
      // sequences of segments aligned along axis
      name: "case11",
      input: plineClosed(
        [
          [-225.0, 0.0, 0.0],
          [-200.0, 0.0, 0.0],
          [-175.0, 0.0, 1.0],
          [-150.0, 0.0, 1.0],
          [-125.0, 0.0, 1.0],
          [-100.0, 0.0, 0.0],
          [-75.0, 0.0, -1.0],
          [-50.0, 0.0, -1.0],
          [-25.0, 0.0, -1.0],
          [0.0, 0.0, 0.0],
          [25.0, 0.0, 1.0],
          [50.0, 0.0, 0.0],
          [75.0, 0.0, 1.0],
          [100.0, 0.0, 0.0],
          [125.0, 0.0, 1.0],
          [150.0, 0.0, 1.0],
          [165.0, 0.0, 1.0],
          [190.0, 0.0, 0.0],
          [215.0, 0.0, 1.0],
          [230.0, 0.0, 1.0],
          [255.0, 0.0, 1.0],
          [270.0, 0.0, 0.0],
          [280.0, 0.0, 0.0],
          [390.0, 200.0, 0.0],
          [365.0, 200.0, 1.0],
          [340.0, 200.0, 1.0],
          [352.5, 200.0, -1.0],
          [290.0, 200.0, 0.0],
          [310.0, 200.0, 1.0],
          [270.0, 200.0, -1.0],
          [280.0, 200.0, -1.0],
          [225.0, 200.0, 1.0],
          [200.0, 200.0, -1.0],
          [175.0, 200.0, 1.0],
          [150.0, 200.0, 0.0],
          [-340.0, 200.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: -9.0,
      expected: [
        new PlineProperties(
          44,
          141959.84850931115,
          2052.5428168464014,
          -348.99999999999994,
          -21.5,
          398.99999999999994,
          229.0,
          [4],
        ),
      ],
    },
    {
      // sequences of segments aligned along axis with some collapsed arcs
      name: "case12",
      input: plineClosed(
        [
          [-225.0, 0.0, 0.0],
          [-200.0, 0.0, 0.0],
          [-175.0, 0.0, 1.0],
          [-150.0, 0.0, 1.0],
          [-125.0, 0.0, 1.0],
          [-100.0, 0.0, 0.0],
          [-75.0, 0.0, -1.0],
          [-50.0, 0.0, -1.0],
          [-25.0, 0.0, -1.0],
          [0.0, 0.0, 0.0],
          [25.0, 0.0, 1.0],
          [50.0, 0.0, 0.0],
          [75.0, 0.0, 1.0],
          [100.0, 0.0, 0.0],
          [125.0, 0.0, 1.0],
          [150.0, 0.0, 1.0],
          [165.0, 0.0, 1.0],
          [190.0, 0.0, 0.0],
          [215.0, 0.0, 1.0],
          [230.0, 0.0, 1.0],
          [255.0, 0.0, 1.0],
          [270.0, 0.0, 0.0],
          [280.0, 0.0, 0.0],
          [390.0, 200.0, 0.0],
          [365.0, 200.0, 1.0],
          [340.0, 200.0, 1.0],
          [352.5, 200.0, -1.0],
          [290.0, 200.0, 0.0],
          [310.0, 200.0, 1.0],
          [270.0, 200.0, -1.0],
          [280.0, 200.0, -1.0],
          [225.0, 200.0, 1.0],
          [200.0, 200.0, -1.0],
          [175.0, 200.0, 1.0],
          [150.0, 200.0, 0.0],
          [-340.0, 200.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 9.0,
      expected: [
        new PlineProperties(
          45,
          105309.44963383305,
          1837.9627621817642,
          -324.4432552044466,
          -3.5,
          374.77855901053806,
          203.5,
          [4],
        ),
        new PlineProperties(
          4,
          17.514629264722736,
          24.09798450969452,
          285.0,
          208.2192186706253,
          296.32455532033674,
          211.00000000000003,
          [4],
        ),
      ],
    },
    {
      // involves near parallel lines with intersect ending up at the end of a segment (failed
      // previously due to skipping all global self intersects at pline segment end points)
      name: "case13",
      input: plineClosed(
        [
          [274.2654113251365, -33.83458301699362, 0.0],
          [272.8148939219459, -33.40645153702632, 0.0],
          [270.5612637345483, -32.77332971826808, 0.0],
          [254.8141988521534, -28.965635958672898, -0.004278242823226474],
          [231.7006747719357, -21.716714720129538, 0.0],
          [230.37047477193764, -21.12631472013047, -0.012056833164683494],
          [267.72224120666004, -39.430804834601496, -0.007322055738970315],
          [271.8159625814055, -35.8506489176749, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 0.8,
      expected: [
        new PlineProperties(
          8,
          75.74000463672292,
          65.09412644187906,
          242.84368242831727,
          -38.465496032789176,
          272.5928914363709,
          -26.104129186572788,
          [4],
        ),
      ],
    },
    {
      // starting with a collapsed loop offsetting negative
      name: "case14",
      input: plineClosed(
        [
          [1.0, 0.0, 0.0],
          [-1.0, 0.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 1.0,
      expected: [
        new PlineProperties(4, -7.141592653589793, 10.283185307179586, -2.0, -1.0, 2.0, 1.0, [4]),
      ],
    },
    {
      // starting with a collapsed loop offsetting positive
      name: "case15",
      input: plineClosed(
        [
          [1.0, 0.0, 0.0],
          [-1.0, 0.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: -1.0,
      expected: [
        new PlineProperties(4, 7.141592653589793, 10.283185307179586, -2.0, -1.0, 2.0, 1.0, [4]),
      ],
    },
    {
      // raw offset polyline has many segments which intersect near a point, including two
      // segments overlapping
      name: "case16",
      input: plineClosed(
        [
          [134.242345653389, -52.5319708744162, 0.0],
          [133.495570653389, -53.1545458744162, 0.0],
          [132.757683153389, -53.8411333744163, 0.0],
          [132.026208153389, -54.6092833744162, 0.0],
          [131.298783153389, -55.4762083744163, 0.0],
          [130.572820653389, -56.4591208744163, 0.0],
          [129.846070653389, -57.5755708744162, 0.0],
          [124.578933153389, -67.0887958744163, 0.0],
          [128.979483153389, -96.1860208744162, 0.0],
          [165.171183153389, -77.3810833744163, 0.0],
          [148.907620653389, 34.4037541255838, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 17.3,
      expected: [
        new PlineProperties(
          8,
          5.0181294125859495,
          11.036602381320794,
          143.0997883790256,
          -69.35328673171023,
          146.28062481696807,
          -65.28735172305409,
          [4],
        ),
      ],
    },
    {
      // same as case 17 but with slightly different offset
      name: "case17",
      input: plineClosed(
        [
          [134.242345653389, -52.5319708744162, 0.0],
          [133.495570653389, -53.1545458744162, 0.0],
          [132.757683153389, -53.8411333744163, 0.0],
          [132.026208153389, -54.6092833744162, 0.0],
          [131.298783153389, -55.4762083744163, 0.0],
          [130.572820653389, -56.4591208744163, 0.0],
          [129.846070653389, -57.5755708744162, 0.0],
          [124.578933153389, -67.0887958744163, 0.0],
          [128.979483153389, -96.1860208744162, 0.0],
          [165.171183153389, -77.3810833744163, 0.0],
          [148.907620653389, 34.4037541255838, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 17.4,
      expected: [
        new PlineProperties(
          8,
          3.9751779587732017,
          9.823062094528733,
          143.34784890970013,
          -69.11170309917232,
          146.17143083814483,
          -65.48750771700713,
          [4],
        ),
      ],
    },
  ];

  declareOffsetTests(cases, false);

  const selfIntersectingCases: OffsetTestCase[] = [
    {
      // tests clipping circle at start and end of polyline works correctly (with self
      // intersect between first and last segment)
      name: "self_intersecting_case1",
      input: plineOpen(
        [
          [305.8082007608764, 149.26270215110728, -0.5],
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
      offset: -30.0,
      expected: [
        new PlineProperties(
          3,
          0.0,
          24.810068463598633,
          261.00286629228214,
          143.21871897609964,
          278.0250516267822,
          160.58068007088974,
          [4],
        ),
        new PlineProperties(
          8,
          0.0,
          1047.5088824641757,
          50.00000000000001,
          -74.99999999999997,
          434.41586988912127,
          240.0,
          [4],
        ),
      ],
    },
    {
      // self intersecting adjacent arcs
      name: "self_intersecting_case2",
      input: plineClosed(
        [
          [-54.126705892111374, -9.012072327640396, 1.0],
          [0.0, 200.0, 0.0],
          [-200.0, 0.0, 0.0],
          [0.0, -200.0, 1.0],
        ],
        { userdata: [4] },
      ),
      offset: -9.0,
      expected: [
        new PlineProperties(
          7,
          72784.07553221736,
          1139.217753852123,
          -209.0,
          -208.99999999999997,
          89.89004749763792,
          209.0,
          [4],
        ),
        new PlineProperties(
          4,
          0.0,
          137.47770415252796,
          -63.126705892111374,
          -21.459436607513837,
          -0.0036782264819059662,
          3.748798488343695,
          [4],
        ),
      ],
    },
  ];

  declareOffsetTests(selfIntersectingCases, true);
});

/** Test cases that have failed or had issues in the past but are otherwise seemingly unremarkable. */
describe("test_past_failures", () => {
  const cases: OffsetTestCase[] = [
    {
      name: "open_pline1",
      input: plineOpen(
        [
          [8.25, 0.0, 0.0],
          [8.25, 0.0625, -0.414214],
          [8.5, 0.3125, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 0.25,
      expected: [
        new PlineProperties(3, 0.0, 0.84789847066602, 7.9999999999999, 0.0, 8.5000001870958, 0.56250000000015, [4]),
      ],
    },
    {
      name: "open_pline2",
      input: plineOpen(
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
      offset: 30.0,
      expected: [
        new PlineProperties(
          9,
          0.0,
          480.07132994083656,
          119.08533878718923,
          16.583123951777,
          374.4158698891213,
          158.00772717933913,
          [4],
        ),
      ],
    },
    {
      // failed when making changes to polyline slices
      name: "open_pline3",
      input: plineOpen(
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
      offset: 25.0,
      expected: [
        new PlineProperties(
          9,
          0.0,
          535.7065850258826,
          112.87974759922413,
          0.0000000000000284217,
          379.4158698891212,
          167.5240988148737,
          [4],
        ),
      ],
    },
    {
      // failed when making changes to polyline slices
      name: "open_pline4",
      input: plineOpen(
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
      offset: 57.0,
      expected: [
        new PlineProperties(
          8,
          0.0,
          174.88800664020044,
          151.6690225512594,
          51.22499389946279,
          302.1362925265432,
          89.80353002260095,
          [4],
        ),
      ],
    },
    {
      // triggered debug asserts due to epsilon values/comparing around repeat vertex
      // positions arising when slices formed into polylines/stitched to polylines
      name: "open_pline5",
      input: plineOpen(
        [
          [151.529431796616, 2672.360415934566, 0.0],
          [151.52944705175477, 2672.3604162683446, -0.0000000232537211708],
          [151.52946162808874, 2672.3604165872725, -0.0024145466234173404],
          [177.34188421196347, 2672.8004877792832, 0.0],
          [177.34191528862172, 2672.8004881589986, 0.0],
          [177.34193697590484, 2672.8004884239886, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 81.0,
      expected: [
        new PlineProperties(
          2,
          0.0,
          26.59869314313687,
          149.7575959931641,
          2753.3410345904244,
          176.35229795820428,
          2753.7944426095614,
          [4],
        ),
      ],
    },
    {
      name: "closed_pline1",
      input: plineClosed(
        [
          [100.0, 100.0, -0.5],
          [80.0, 90.0, 0.374794619217547],
          [100.0, 0.0, 1.0],
          [225.0, 0.0, 1.0],
          [320.0, 0.0, -0.5],
          [280.0, 0.0, 0.5],
          [390.0, 210.0, 0.0],
          [280.0, 120.0, 0.5],
        ],
        { userdata: [4] },
      ),
      offset: 26.0,
      expected: [
        new PlineProperties(
          12,
          26880.50880023272,
          879.9419421394236,
          97.46410017370246,
          -36.5,
          378.41586988912127,
          165.65896506528978,
          [4],
        ),
      ],
    },
    {
      name: "closed_pline2",
      input: plineClosed(
        [
          [112.41916161761486, 317.6090172318188, 0.374794619217547],
          [283.91125822540016, 113.83906801254867, -1.0],
          [320.0, 0.0, -0.5],
          [416.19973184838693, -118.5880908230576, 0.5],
          [390.0, 210.0, 0.0],
          [280.0, 120.0, 0.5],
        ],
        { userdata: [4] },
      ),
      offset: 11.0,
      expected: [
        new PlineProperties(
          4,
          22967.88418361544,
          725.8310555703592,
          306.51750709258783,
          -88.76884688852556,
          474.8986719957476,
          196.35636086795802,
          [4],
        ),
        new PlineProperties(
          2,
          14876.690185910866,
          512.884459926642,
          123.52142671939367,
          127.7080000599289,
          273.04351973980494,
          306.89237970059116,
          [4],
        ),
      ],
    },
    {
      name: "closed_pline3",
      input: plineClosed(
        [
          [-225.0, 0.0, 0.0],
          [280.0, 0.0, 0.0],
          [390.0, 200.0, 0.0],
          [310.0, 200.0, 1.0],
          [270.0, 200.0, -1.0],
          [280.0, 200.0, -1.0],
          [150.0, 200.0, 0.0],
          [-340.0, 200.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: 16.0,
      expected: [
        new PlineProperties(
          7,
          89881.66357519358,
          1621.6223053868894,
          -312.34356480790507,
          16.0,
          362.93966046317865,
          192.8544998953781,
          [4],
        ),
      ],
    },
    {
      name: "closed_pline4",
      input: plineClosed(
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
      offset: -9.0,
      expected: [
        new PlineProperties(
          11,
          53340.59364855598,
          1008.1487200240091,
          71.0,
          -54.00000000000001,
          413.41586988912127,
          219.0,
          [4],
        ),
      ],
    },
    {
      // had problems with intersect at very end of segment arising due to epsilon
      // value mismatches for comparing if two positions are equal
      name: "closed_pline5",
      input: plineClosed(
        [
          [264.0, 189.60769515458668, -0.6866165717616879],
          [237.0, 200.0, 0.9999999999999999],
          [188.0, 200.0, -1.0],
          [186.99999999999997, 200.0, 0.7720018726587661],
          [141.1399906367063, 212.0, 0.0],
          [-340.0, 212.0, 0.5767622536477675],
          [-350.4028756366904, 194.01834650890305, 0.0],
          [-235.4028756366904, -5.9816534910969885, 0.2684220435725749],
          [-225.0, -12.0, 0.0],
          [280.0, -12.0, 0.2735184224363523],
          [290.5145909041198, -5.783024997265875, 0.0],
          [400.5145909041198, 194.2169750027341, 0.5704523505626424],
          [390.0, 212.0, 0.0],
          [373.86000936329407, 212.0, 0.7720018726587679],
          [328.0, 200.0, 0.22133565492006524],
          [334.5, 186.03575995623103, -0.4396641198250874],
          [306.1980067765089, 188.0, 0.0],
          [310.0, 188.0, 0.41421356237309503],
          [322.0, 200.0, 0.9999999999999999],
          [258.0, 200.0, 0.26794919243112475],
        ],
        { userdata: [4] },
      ),
      offset: -3.0,
      expected: [
        new PlineProperties(
          18,
          151176.94826984024,
          1955.7049177723648,
          -355.0,
          -15.0,
          405.00000000000006,
          234.99999999999994,
          [4],
        ),
      ],
    },
    {
      // failed when making changes to polyline slices
      name: "closed_pline6",
      input: plineClosed(
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
      offset: 25.0,
      expected: [
        new PlineProperties(
          10,
          21487.825530978065,
          727.9542629450341,
          112.87974759922413,
          0.0000000000000284217,
          379.4158698891212,
          167.5240988148737,
          [4],
        ),
      ],
    },
    {
      // failed due to issues around construction of polyline slices, involves
      // coincident/overlapping result after offset
      name: "closed_pline7",
      input: plineClosed(
        [
          [0.0, 0.0, 0.0],
          [432.22004474869937, 0.0, 0.0],
          [432.22004474869937, -620.7191231042452, 0.0],
          [414.22004474869937, -620.7191231042452, 0.0],
          [414.22004474869937, -18.0, 0.0],
          [0.0, -18.0, 0.0],
        ],
        { userdata: [4] },
      ),
      offset: -9.0,
      expected: [
        new PlineProperties(
          5,
          -17.38274876480773,
          2030.0155026470434,
          9.0,
          -611.7191231042452,
          423.22004474869937,
          -9.0,
          [4],
        ),
      ],
    },
    {
      // failed due to a bug introduced when making line-arc intersects "sticky" to line end
      // points for consistency across segment intersects
      name: "closed_pline8",
      input: plineClosed(
        [
          [290.0, -4.0, 0.5],
          [390.0, 210.0, 0.0],
          [255.0, 23.0, 0.5],
        ],
        { userdata: [4] },
      ),
      offset: 26.0,
      expected: [
        new PlineProperties(
          2,
          3401.4557886082257,
          338.29794704218466,
          286.1826241465677,
          21.774491471132933,
          381.38235587092686,
          152.78252663170932,
          [4],
        ),
      ],
    },
    {
      // triggered debug assert failures around slice creation due to line-arc intersects
      // returning intersect points too far from segment
      name: "closed_pline9",
      input: plineClosed(
        [
          [28.938897894888974, 10.95930386263893, 0.0],
          [28.886532906360166, 10.91645978111536, -0.3943103187619132],
          [26.97961269906842, 11.04145435367033, 0.49377669119506246],
          [11.308203844176965, 9.458380715736016, -0.20600333237336405],
          [9.895116435209998, 7.757401315567152, 0.330443922787453],
          [20.844033287063855, 1.3912851556945007, -0.027916381806689476],
          [21.000000000000057, 1.4000000000000001, 0.0],
          [23.0, 1.4000000000000001, -0.414213579775936],
          [24.40000000000002, -8.318380800647987e-8, 0.8877523709282997],
          [30.512933651613217, -0.7295415104026899, -0.4394460601826887],
        ],
        { userdata: [4] },
      ),
      offset: 0.1,
      expected: [
        new PlineProperties(
          9,
          195.40133874861155,
          61.346378550776606,
          10.023725045710194,
          -3.0000000085491503,
          30.399051687627463,
          14.069231422671779,
          [4],
        ),
      ],
    },
    {
      // Regression test for issue #77: offset should work correctly when the input has vertices
      // that are close together (this input is the result of a previous offset operation).
      // Before the fix, this failed with handle_self_intersects=true.
      // https://github.com/jbuckmccready/cavalier_contours/issues/77
      name: "issue77_repeated_offset",
      input: plineClosed([
        [2.0, 11.0, -0.6681786379192991],
        [2.7071067811865475, 9.292893218813452, 0.0],
        [-0.2928932188134524, 6.292893218813452, -0.6681786379192989],
        [-2.0, 7.0, 0.0],
        [-2.0, 15.0, -0.6681786379192989],
        [-0.2928932188134524, 15.707106781186548, 0.0],
        [2.7071067811865475, 12.707106781186548, -0.6681786379192991],
      ]),
      offset: 1.0,
      expected: [new PlineProperties(7, -64.3633792727984, 31.14604709099094, -3.0, 5.0, 4.0, 17.0, [])],
    },
  ];

  declareOffsetTests(cases, false);
});

test("repeat_position_input_is_sanitized_before_offset", () => {
  // Minimal regression case: repeat-position input must be sanitized in release/debug paths.
  // Without this change, debug builds panic on the internal repeat-position assertion.
  const input = plineClosed(
    [
      [0.0, 0.0, 0.0],
      [20.0, 0.0, 0.0],
      [20.0, 0.0, 0.0],
      [20.0, 10.0, 0.0],
      [0.0, 10.0, 0.0],
    ],
    { userdata: [4] },
  );

  const result = input.parallelOffset(-2.0);
  expect(result.length, "repeat-position input should still offset").toBe(1);
  expect([...result[0].getUserdataValues()], "offset should preserve input userdata").toEqual([4]);
  expect(
    result[0].removeRepeatPos(PlineProperties.POS_EQ_EPS),
    "offset result should not contain repeat position vertexes",
  ).toBeNull();

  const actual = createPropertySet(result, false);
  const expected = [new PlineProperties(8, 332.56637061436, 72.566370614359, -2.0, -2.0, 22.0, 12.0, [4])];
  expect(propertySetsMatch(actual, expected)).toBe(true);
});

test("repeat_position_input_ignores_external_aabb_after_sanitize", () => {
  // If input is sanitized, external aabb_index from the original polyline must be ignored.
  // Otherwise index/source mismatch can lead to incorrect slice queries.
  const input = plineClosed(
    [
      [0.0, 0.0, 0.0],
      [20.0, 0.0, 0.0],
      [20.0, 0.0, 0.0],
      [20.0, 10.0, 0.0],
      [0.0, 10.0, 0.0],
    ],
    { userdata: [4] },
  );

  const inputAabb = input.createApproxAabbIndex();
  const options: PlineOffsetOptions = {
    aabbIndex: inputAabb,
  };

  const result = input.parallelOffsetOpt(-2.0, options);
  expect(result.length, "repeat-position input should still offset").toBe(1);
  expect([...result[0].getUserdataValues()], "offset should preserve input userdata").toEqual([4]);
  expect(
    result[0].removeRepeatPos(PlineProperties.POS_EQ_EPS),
    "offset result should not contain repeat position vertexes",
  ).toBeNull();

  const actual = createPropertySet(result, false);
  const expected = [new PlineProperties(8, 332.56637061436, 72.566370614359, -2.0, -2.0, 22.0, 12.0, [4])];
  expect(propertySetsMatch(actual, expected)).toBe(true);
});

test("repeat_position_real_world_input_is_sanitized_before_offset", () => {
  // Real-world parallel offset case with repeated first vertex and micro-segments.
  // This is the concrete "fails without fix" regression (old code panics before offseting).
  const input = plineOpen(
    [
      [-736.0355179644317, 8182.4047193246215, 0.0],
      [-736.0355179644317, 8182.4047193246215, 0.0],
      [-736.0354497945418, 8182.4047234225045, -0.0000000280872245462],
      [-736.035438579896, 8182.404724096647, -0.0000000028133819718],
      [-736.0353453440823, 8182.404729701303, -0.17144715353094436],
      [4578.805065246941, 6656.67568798969, 0.0],
      [4578.8050878621025, 6656.675671873701, 0.0],
      [4578.805231182584, 6656.675569740822, 0.0],
    ],
    { userdata: [4] },
  );

  const inputAabb = input.createApproxAabbIndex();
  const options: PlineOffsetOptions = {
    aabbIndex: inputAabb,
  };

  const result = input.parallelOffsetOpt(3.0, options);
  expect(result.length, "repeat-position input should still offset").toBe(1);
  expect([...result[0].getUserdataValues()], "offset should preserve input userdata").toEqual([4]);
  expect(
    result[0].removeRepeatPos(PlineProperties.POS_EQ_EPS),
    "offset result should not contain repeat position vertexes",
  ).toBeNull();

  const actual = createPropertySet(result, false);
  const expected = [
    new PlineProperties(
      4,
      0.0,
      5639.266054391041,
      -736.2155311168141,
      6659.118694762635,
      4580.546248163486,
      8200.360349202138,
      [4],
    ),
  ];
  expect(propertySetsMatch(actual, expected)).toBe(true);
});
