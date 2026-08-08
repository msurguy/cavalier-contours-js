// Tests for the vendored `static_aabb2d_index` port. A representative subset of the Rust
// crate's `tests/test.rs` is ported (using its deterministic test data verbatim), plus
// property tests comparing query results against brute force over seeded pseudo-random boxes.
import { expect, test } from "vitest";
import {
  StaticAabb2dIndexBuilder,
  type AABB,
  type StaticAabb2dIndex,
} from "../src/index2d/staticAabb2dIndex.js";

// Deterministic box data from the Rust crate's tests (100 boxes, 4 values each).
function createTestData(): number[] {
  return [
    8, 62, 11, 66, 57, 17, 57, 19, 76, 26, 79, 29, 36, 56, 38, 56, 92, 77, 96, 80, 87, 70, 90,
    74, 43, 41, 47, 43, 0, 58, 2, 62, 76, 86, 80, 89, 27, 13, 27, 15, 71, 63, 75, 67, 25, 2,
    27, 2, 87, 6, 88, 6, 22, 90, 23, 93, 22, 89, 22, 93, 57, 11, 61, 13, 61, 55, 63, 56, 17,
    85, 21, 87, 33, 43, 37, 43, 6, 1, 7, 3, 80, 87, 80, 87, 23, 50, 26, 52, 58, 89, 58, 89, 12,
    30, 15, 34, 32, 58, 36, 61, 41, 84, 44, 87, 44, 18, 44, 19, 13, 63, 15, 67, 52, 70, 54, 74,
    57, 59, 58, 59, 17, 90, 20, 92, 48, 53, 52, 56, 92, 68, 92, 72, 26, 52, 30, 52, 56, 23, 57,
    26, 88, 48, 88, 48, 66, 13, 67, 15, 7, 82, 8, 86, 46, 68, 50, 68, 37, 33, 38, 36, 6, 15, 8,
    18, 85, 36, 89, 38, 82, 45, 84, 48, 12, 2, 16, 3, 26, 15, 26, 16, 55, 23, 59, 26, 76, 37,
    79, 39, 86, 74, 90, 77, 16, 75, 18, 78, 44, 18, 45, 21, 52, 67, 54, 71, 59, 78, 62, 78, 24,
    5, 24, 8, 64, 80, 64, 83, 66, 55, 70, 55, 0, 17, 2, 19, 15, 71, 18, 74, 87, 57, 87, 59, 6,
    34, 7, 37, 34, 30, 37, 32, 51, 19, 53, 19, 72, 51, 73, 55, 29, 45, 30, 45, 94, 94, 96, 95,
    7, 22, 11, 24, 86, 45, 87, 48, 33, 62, 34, 65, 18, 10, 21, 14, 64, 66, 67, 67, 64, 25, 65,
    28, 27, 4, 31, 6, 84, 4, 85, 5, 48, 80, 50, 81, 1, 61, 3, 61, 71, 89, 74, 92, 40, 42, 43,
    43, 27, 64, 28, 66, 46, 26, 50, 26, 53, 83, 57, 87, 14, 75, 15, 79, 31, 45, 34, 45, 89, 84,
    92, 88, 84, 51, 85, 53, 67, 87, 67, 89, 39, 26, 43, 27, 47, 61, 47, 63, 23, 49, 25, 53, 12,
    3, 14, 5, 16, 50, 19, 53, 63, 80, 64, 84, 22, 63, 22, 64, 26, 66, 29, 66, 2, 15, 3, 15, 74,
    77, 77, 79, 64, 11, 68, 11, 38, 4, 39, 8, 83, 73, 87, 77, 85, 52, 89, 56, 74, 60, 76, 63,
    62, 66, 65, 67,
  ];
}

function aabbFromData(data: number[]): AABB[] {
  const result: AABB[] = [];
  for (let i = 0; i < data.length; i += 4) {
    result.push({ minX: data[i], minY: data[i + 1], maxX: data[i + 2], maxY: data[i + 3] });
  }
  return result;
}

function createIndex(data: number[], nodeSize: number = 16): StaticAabb2dIndex {
  const builder = new StaticAabb2dIndexBuilder(data.length / 4, nodeSize);
  for (let pos = 0; pos < data.length; pos += 4) {
    builder.add(data[pos], data[pos + 1], data[pos + 2], data[pos + 3]);
  }

  return builder.build();
}

function createTestIndex(): StaticAabb2dIndex {
  return createIndex(createTestData());
}

function createSmallTestIndex(): StaticAabb2dIndex {
  const itemCount = 14;
  const smallData = createTestData().slice(0, itemCount * 4);
  return createIndex(smallData);
}

function bruteForceQuery(
  boxes: AABB[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number[] {
  const results: number[] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i];
    if (!(b.maxX < minX || b.maxY < minY || b.minX > maxX || b.minY > maxY)) {
      results.push(i);
    }
  }
  return results;
}

// Seeded deterministic PRNG (mulberry32) — no Math.random in tests.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("buildingFromZeroesIsOk", () => {
  const itemCount = 50;
  const data: number[] = new Array<number>(itemCount * 4).fill(0.0);
  const index = createIndex(data);

  const queryResults = index.query(-1.0, -1.0, 1.0, 1.0);
  queryResults.sort((a, b) => a - b);
  const expectedResults: number[] = [];
  for (let i = 0; i < itemCount; i += 1) {
    expectedResults.push(i);
  }
  expect(queryResults).toEqual(expectedResults);

  const emptyQueryResults = index.query(1.0, 1.0, 2.0, 2.0);
  expect(emptyQueryResults).toEqual([]);
});

test("zeroItemIndexWorks", () => {
  const builder = new StaticAabb2dIndexBuilder(0);
  const index = builder.build();
  expect(index.count).toBe(0);
  expect(index.bounds()).toBeNull();
  expect(index.itemBoxes()).toEqual([]);
  const results = index.query(-Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
  expect(results).toEqual([]);

  let foundItem = false;
  const visitCompleted = index.visitQuery(
    -Number.MAX_VALUE,
    -Number.MAX_VALUE,
    Number.MAX_VALUE,
    Number.MAX_VALUE,
    () => {
      foundItem = true;
      return false;
    },
  );
  expect(visitCompleted).toBe(true);
  expect(foundItem).toBe(false);
});

test("buildingFromTooFewItemsThrows", () => {
  const data = createTestData();
  const builder = new StaticAabb2dIndexBuilder(10);
  for (let pos = 0; pos < 9 * 4; pos += 4) {
    builder.add(data[pos], data[pos + 1], data[pos + 2], data[pos + 3]);
  }

  expect(() => builder.build()).toThrowError(/added: 9, expected: 10/);
});

test("buildingFromTooManyItemsThrows", () => {
  const data = createTestData();
  const builder = new StaticAabb2dIndexBuilder(10);
  for (let pos = 0; pos < 20 * 4; pos += 4) {
    builder.add(data[pos], data[pos + 1], data[pos + 2], data[pos + 3]);
  }

  expect(() => builder.build()).toThrowError(/added: 20, expected: 10/);
});

test("skipSortingSmallIndex", () => {
  // 14 items <= node size of 16 so the tree has a single node and sorting is skipped
  const index = createSmallTestIndex();
  const totalBounds = index.bounds();
  expect(totalBounds).not.toBeNull();

  expect(totalBounds).toEqual({ minX: 0, minY: 2, maxX: 96, maxY: 93 });

  const expectedItemBoxes: AABB[] = [
    { minX: 8, minY: 62, maxX: 11, maxY: 66 },
    { minX: 57, minY: 17, maxX: 57, maxY: 19 },
    { minX: 76, minY: 26, maxX: 79, maxY: 29 },
    { minX: 36, minY: 56, maxX: 38, maxY: 56 },
    { minX: 92, minY: 77, maxX: 96, maxY: 80 },
    { minX: 87, minY: 70, maxX: 90, maxY: 74 },
    { minX: 43, minY: 41, maxX: 47, maxY: 43 },
    { minX: 0, minY: 58, maxX: 2, maxY: 62 },
    { minX: 76, minY: 86, maxX: 80, maxY: 89 },
    { minX: 27, minY: 13, maxX: 27, maxY: 15 },
    { minX: 71, minY: 63, maxX: 75, maxY: 67 },
    { minX: 25, minY: 2, maxX: 27, maxY: 2 },
    { minX: 87, minY: 6, maxX: 88, maxY: 6 },
    { minX: 22, minY: 90, maxX: 23, maxY: 93 },
  ];

  // note order should always match (should not be sorted differently from order added since
  // num_items < node_size)
  expect(index.itemBoxes()).toEqual(expectedItemBoxes);
  expect(index.itemIndices()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
});

test("totalExtents", () => {
  const index = createTestIndex();
  const totalBounds = index.bounds();
  expect(totalBounds).toEqual({ minX: 0, minY: 1, maxX: 96, maxY: 95 });
});

test("expectedItemIndicesOrder", () => {
  // first 100 values of the Rust crate's `expected_indices_order` test — exercises the exact
  // hilbert curve values and sorting matching the Rust implementation
  const index = createTestIndex();
  const expectedItemIndices = [
    95, 92, 87, 70, 67, 64, 55, 52, 49, 43, 40, 11, 26, 19, 44, 9, 59, 84, 77, 39, 6, 75, 80,
    18, 23, 62, 58, 88, 86, 27, 90, 0, 73, 7, 37, 30, 13, 14, 48, 17, 56, 79, 25, 38, 85, 76,
    91, 66, 24, 33, 21, 3, 99, 16, 54, 28, 29, 68, 50, 31, 22, 72, 78, 83, 53, 89, 51, 93, 81,
    20, 8, 96, 4, 63, 74, 5, 47, 32, 10, 98, 61, 82, 57, 97, 65, 35, 41, 2, 45, 46, 36, 42, 69,
    34, 1, 60, 15, 94, 12, 71,
  ];
  expect(index.itemIndices()).toEqual(expectedItemIndices);
});

test("itemBoxesRoundTrip", () => {
  // item boxes are in internal (hilbert sorted) order, itemIndices maps back to added order
  const inputBoxes = aabbFromData(createTestData());
  const index = createTestIndex();

  const itemBoxes = index.itemBoxes();
  const itemIndices = index.itemIndices();
  expect(itemBoxes.length).toBe(index.count);
  expect(itemIndices.length).toBe(index.count);

  for (let i = 0; i < itemBoxes.length; i += 1) {
    const addedItemIndex = itemIndices[i];
    expect(itemBoxes[i]).toEqual(inputBoxes[addedItemIndex]);
  }

  // every added index appears exactly once
  const sortedIndices = [...itemIndices].sort((a, b) => a - b);
  for (let i = 0; i < sortedIndices.length; i += 1) {
    expect(sortedIndices[i]).toBe(i);
  }
});

test("query", () => {
  const index = createTestIndex();
  const results = index.query(40, 40, 60, 60);
  results.sort((a, b) => a - b);
  const expectedIndexes = [6, 29, 31, 75];
  expect(results).toEqual(expectedIndexes);
});

test("queryWithManyLevels", () => {
  const index = createIndex(createTestData(), 4);
  const results = index.query(40, 40, 60, 60);
  results.sort((a, b) => a - b);
  const expectedIndexes = [6, 29, 31, 75];
  expect(results).toEqual(expectedIndexes);
});

test("visitQuery", () => {
  const index = createTestIndex();
  const results: number[] = [];
  const completed = index.visitQuery(40, 40, 60, 60, (i) => {
    results.push(i);
  });
  expect(completed).toBe(true);

  results.sort((a, b) => a - b);
  const expectedIndexes = [6, 29, 31, 75];
  expect(results).toEqual(expectedIndexes);
});

test("visitQueryStopsEarly", () => {
  const index = createTestIndex();
  const results = new Set<number>();
  const completed = index.visitQuery(40, 40, 60, 60, (i) => {
    results.add(i);
    if (results.size !== 2) {
      return true;
    } else {
      return false;
    }
  });

  expect(completed).toBe(false);
  expect(results.size).toBe(2);
  const expectedSupersetIndexes = new Set([6, 29, 31, 75]);
  for (const i of results) {
    expect(expectedSupersetIndexes.has(i)).toBe(true);
  }
});

test("queryMatchesBruteForceOnRandomBoxes", () => {
  const rand = mulberry32(0xc0ffee);
  const boxCount = 100;
  const boxes: AABB[] = [];
  for (let i = 0; i < boxCount; i += 1) {
    const minX = 200.0 * rand() - 100.0;
    const minY = 200.0 * rand() - 100.0;
    const maxX = minX + 30.0 * rand();
    const maxY = minY + 30.0 * rand();
    boxes.push({ minX, minY, maxX, maxY });
  }

  // node size 16 (default, 100 items > 16 so the tree has internal nodes) and node size 4
  // (many levels)
  for (const nodeSize of [16, 4]) {
    const builder = new StaticAabb2dIndexBuilder(boxCount, nodeSize);
    for (const b of boxes) {
      builder.add(b.minX, b.minY, b.maxX, b.maxY);
    }
    const index = builder.build();
    expect(index.count).toBe(boxCount);

    for (let q = 0; q < 25; q += 1) {
      const qMinX = 250.0 * rand() - 125.0;
      const qMinY = 250.0 * rand() - 125.0;
      const qMaxX = qMinX + 60.0 * rand();
      const qMaxY = qMinY + 60.0 * rand();

      const results = index.query(qMinX, qMinY, qMaxX, qMaxY);
      results.sort((a, b) => a - b);
      const expected = bruteForceQuery(boxes, qMinX, qMinY, qMaxX, qMaxY);
      expect(results).toEqual(expected);
    }
  }
});

test("boundsMatchesBruteForceOnRandomBoxes", () => {
  const rand = mulberry32(12345);
  const boxCount = 57;
  const boxes: AABB[] = [];
  const builder = new StaticAabb2dIndexBuilder(boxCount);
  let minX = Number.MAX_VALUE;
  let minY = Number.MAX_VALUE;
  let maxX = -Number.MAX_VALUE;
  let maxY = -Number.MAX_VALUE;
  for (let i = 0; i < boxCount; i += 1) {
    const b: AABB = {
      minX: 100.0 * rand() - 50.0,
      minY: 100.0 * rand() - 50.0,
      maxX: 0.0,
      maxY: 0.0,
    };
    b.maxX = b.minX + 10.0 * rand();
    b.maxY = b.minY + 10.0 * rand();
    boxes.push(b);
    builder.add(b.minX, b.minY, b.maxX, b.maxY);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }

  const index = builder.build();
  expect(index.bounds()).toEqual({ minX, minY, maxX, maxY });
});

test("visitQueryEarlyExitOnRandomBoxes", () => {
  const rand = mulberry32(987654321);
  const boxCount = 100;
  const builder = new StaticAabb2dIndexBuilder(boxCount);
  for (let i = 0; i < boxCount; i += 1) {
    const minX = 50.0 * rand();
    const minY = 50.0 * rand();
    builder.add(minX, minY, minX + 5.0 * rand(), minY + 5.0 * rand());
  }
  const index = builder.build();

  // all boxes overlap this query box
  const totalHits = index.query(-100.0, -100.0, 100.0, 100.0).length;
  expect(totalHits).toBe(boxCount);

  // visitor breaks (returns false) after maxHits results — traversal must stop and
  // visitQuery must return false
  const maxHits = 3;
  let visitedCount = 0;
  const completed = index.visitQuery(-100.0, -100.0, 100.0, 100.0, () => {
    visitedCount += 1;
    return visitedCount < maxHits;
  });

  expect(completed).toBe(false);
  expect(visitedCount).toBe(maxHits);
});
