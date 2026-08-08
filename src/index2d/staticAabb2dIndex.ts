/**
 * Vendored TypeScript port of the `static_aabb2d_index` Rust crate (v2.0.0) — a
 * static/fixed size indexing data structure for two dimensional axis aligned
 * bounding boxes.
 *
 * The index allows for fast construction and fast querying but cannot be modified
 * after creation.
 *
 * Ported from `static_aabb2d_index/src/{core.rs, static_aabb2d_index.rs}` with the
 * numeric type `T` monomorphized to `number` (f64). Only the API surface used by the
 * cavalier_contours algorithms is ported: builder + `query`, `visitQuery`,
 * `itemBoxes`, `itemIndices`, `bounds`, `count`. The Rust `*_with_stack` variants map
 * to the plain methods here (the port reuses one internal stack array per index).
 * The nearest neighbors query methods and lazy query iterators are not ported
 * (unused by cavalier_contours).
 */
import { debugAssert, type VisitResult } from "../core/controlFlow.js";

/**
 * Simple 2D axis aligned bounding box which holds the extents of a 2D box.
 *
 * Port of the Rust `AABB` struct (fields `min_x`, `min_y`, `max_x`, `max_y`).
 */
export interface AABB {
  /** Min x extent of the axis aligned bounding box. */
  minX: number;
  /** Min y extent of the axis aligned bounding box. */
  minY: number;
  /** Max y extent of the axis aligned bounding box. */
  maxX: number;
  /** Max y extent of the axis aligned bounding box. */
  maxY: number;
}

/** Shorthand constructor for an `AABB` (Rust `AABB::new`). */
export function aabb(minX: number, minY: number, maxX: number, maxY: number): AABB {
  return { minX, minY, maxX, maxY };
}

/**
 * Tests if an AABB overlaps the extents given (inclusive of edges/corners touching).
 *
 * Port of Rust `AABB::overlaps`.
 */
export function aabbOverlaps(
  box_: AABB,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  if (box_.maxX < minX || box_.maxY < minY || box_.minX > maxX || box_.minY > maxY) {
    return false;
  }

  return true;
}

/**
 * Maps 2d space to 1d hilbert curve space.
 *
 * 2d space is `x: [0 -> n-1]` and `y: [0 -> n-1]`, 1d hilbert curve value space is
 * `d: [0 -> n^2 - 1]`, where n = 2^16, so `x` and `y` must be between 0 and 65535
 * (u16 max). Result is an unsigned 32 bit integer value.
 *
 * Port of Rust `hilbert_xy_to_index` (u32 arithmetic reproduced with JS bitwise ops;
 * all intermediate values stay below 2^31 so signed JS bitwise ops match the Rust
 * unsigned ops, with a final `>>> 0` to produce the unsigned result).
 */
export function hilbertXyToIndex(x: number, y: number): number {
  // Fast Hilbert curve algorithm by http://threadlocalmutex.com/
  // Ported from C++ https://github.com/rawrunprotected/hilbert_curves (public domain)
  let a1 = x ^ y;
  let b1 = 0xffff ^ a1;
  let c1 = 0xffff ^ (x | y);
  let d1 = x & (y ^ 0xffff);

  let a2 = a1 | (b1 >> 1);
  let b2 = (a1 >> 1) ^ a1;
  let c2 = ((c1 >> 1) ^ (b1 & (d1 >> 1))) ^ c1;
  let d2 = ((a1 & (c1 >> 1)) ^ (d1 >> 1)) ^ d1;

  a1 = a2;
  b1 = b2;
  c1 = c2;
  d1 = d2;
  a2 = (a1 & (a1 >> 2)) ^ (b1 & (b1 >> 2));
  b2 = (a1 & (b1 >> 2)) ^ (b1 & ((a1 ^ b1) >> 2));
  c2 ^= (a1 & (c1 >> 2)) ^ (b1 & (d1 >> 2));
  d2 ^= (b1 & (c1 >> 2)) ^ ((a1 ^ b1) & (d1 >> 2));

  a1 = a2;
  b1 = b2;
  c1 = c2;
  d1 = d2;
  a2 = (a1 & (a1 >> 4)) ^ (b1 & (b1 >> 4));
  b2 = (a1 & (b1 >> 4)) ^ (b1 & ((a1 ^ b1) >> 4));
  c2 ^= (a1 & (c1 >> 4)) ^ (b1 & (d1 >> 4));
  d2 ^= (b1 & (c1 >> 4)) ^ ((a1 ^ b1) & (d1 >> 4));

  a1 = a2;
  b1 = b2;
  c1 = c2;
  d1 = d2;
  c2 ^= (a1 & (c1 >> 8)) ^ (b1 & (d1 >> 8));
  d2 ^= (b1 & (c1 >> 8)) ^ ((a1 ^ b1) & (d1 >> 8));

  a1 = c2 ^ (c2 >> 1);
  b1 = d2 ^ (d2 >> 1);

  let i0 = x ^ y;
  let i1 = b1 | (0xffff ^ (i0 | a1));

  i0 = (i0 | (i0 << 8)) & 0x00ff00ff;
  i0 = (i0 | (i0 << 4)) & 0x0f0f0f0f;
  i0 = (i0 | (i0 << 2)) & 0x33333333;
  i0 = (i0 | (i0 << 1)) & 0x55555555;

  i1 = (i1 | (i1 << 8)) & 0x00ff00ff;
  i1 = (i1 | (i1 << 4)) & 0x0f0f0f0f;
  i1 = (i1 | (i1 << 2)) & 0x33333333;
  i1 = (i1 | (i1 << 1)) & 0x55555555;

  return ((i1 << 1) | i0) >>> 0;
}

/**
 * Helper function to build hilbert coordinate value from AABB extents.
 *
 * Port of the Rust `hilbert_coord` helper in `StaticAABB2DIndexBuilder::build`
 * (including the `to_u16().unwrap_or(saturate)` behavior for the cases of
 * positive/negative infinity — width or height is 0.0 — or NaN inputs).
 */
function hilbertCoord(
  scaledExtent: number,
  aabbMin: number,
  aabbMax: number,
  extentMin: number,
): number {
  const value = scaledExtent * (0.5 * (aabbMin + aabbMax) - extentMin);
  // this should successfully convert to u16 since scaled_extent should be between 0 and
  // u16::MAX and the coefficient should be between 0.0 and 1.0, but in the case of
  // positive/negative infinity (width or height is 0.0) or NAN (inputs contain NAN) we
  // want to continue
  if (value > -1.0 && value < 65536.0) {
    // in range for u16 conversion, truncate toward zero (Rust `as u16` semantics after
    // the range check done by `to_u16`); `Math.trunc(-0.5)` yields `-0` which is fine
    const truncated = Math.trunc(value);
    return truncated < 0 ? 0 : truncated;
  }

  // saturate
  if (value > 0xffff) {
    return 0xffff;
  } else if (value < 0) {
    return 0;
  } else {
    // NAN
    return 0;
  }
}

// modified quick sort that skips sorting boxes within the same node
// (boxes are stored flat in `boxes` with 4 values per box)
function sort(
  values: Uint32Array,
  boxes: Float64Array,
  indices: Uint32Array,
  left: number,
  right: number,
  nodeSize: number,
): void {
  debugAssert(left <= right, "left index should never be past right index");

  if (Math.floor(left / nodeSize) >= Math.floor(right / nodeSize)) {
    // remaining to be sorted fits within the the same node, skip sorting further
    // since all boxes within a node must be visited when querying regardless
    return;
  }

  const mid = Math.floor((left + right) / 2);
  const pivot = values[mid];
  let i = left - 1;
  let j = right + 1;

  for (;;) {
    do {
      i += 1;
    } while (values[i] < pivot);

    do {
      j -= 1;
    } while (values[j] > pivot);

    if (i >= j) {
      break;
    }

    swap(values, boxes, indices, i, j);
  }

  sort(values, boxes, indices, left, j, nodeSize);
  sort(values, boxes, indices, j + 1, right, nodeSize);
}

function swap(
  values: Uint32Array,
  boxes: Float64Array,
  indices: Uint32Array,
  i: number,
  j: number,
): void {
  const tempValue = values[i];
  values[i] = values[j];
  values[j] = tempValue;

  const bi = 4 * i;
  const bj = 4 * j;
  for (let k = 0; k < 4; k += 1) {
    const tempBox = boxes[bi + k];
    boxes[bi + k] = boxes[bj + k];
    boxes[bj + k] = tempBox;
  }

  const tempIndex = indices[i];
  indices[i] = indices[j];
  indices[j] = tempIndex;
}

/**
 * Used to build a `StaticAabb2dIndex`.
 *
 * Port of the Rust `StaticAABB2DIndexBuilder` struct.
 */
export class StaticAabb2dIndexBuilder {
  private nodeSize: number;
  private numItems: number;
  private levelBounds: number[];
  /** Flat box storage, 4 values (minX, minY, maxX, maxY) per box. */
  private boxes: Float64Array;
  private indices: Uint32Array;
  private pos: number;

  /**
   * Construct a new `StaticAabb2dIndexBuilder` to fit exactly the specified `count`
   * number of items.
   *
   * Each node in the index tree has a maximum size which may be adjusted by `nodeSize`
   * for performance reasons, however the default value of 16 is tested to be optimal
   * in most cases (Rust `StaticAABB2DIndexBuilder::new`/`new_with_node_size`).
   *
   * If `nodeSize` is less than 2 then 2 is used, if `nodeSize` is greater than 65535
   * then 65535 is used.
   */
  constructor(count: number, nodeSize: number = 16) {
    if (count === 0) {
      // just return early, with no items added
      this.nodeSize = nodeSize;
      this.numItems = count;
      this.levelBounds = [];
      this.boxes = new Float64Array(0);
      this.indices = new Uint32Array(0);
      this.pos = 0;
      return;
    }

    this.nodeSize = Math.min(Math.max(nodeSize, 2), 65535);
    this.numItems = count;

    // keep subdividing num_items by node_size to build up the level bounds array to
    // represent the R-tree and build up total num_nodes for the tree
    let n = count;
    let numNodes = count;
    const levelBounds: number[] = [n];
    for (;;) {
      n = Math.ceil(n / this.nodeSize);
      numNodes += n;
      levelBounds.push(numNodes);
      if (n === 1) {
        break;
      }
    }

    this.levelBounds = levelBounds;
    this.boxes = new Float64Array(4 * numNodes);
    const indices = new Uint32Array(numNodes);
    for (let i = 0; i < numNodes; i += 1) {
      indices[i] = i;
    }
    this.indices = indices;
    this.pos = 0;
  }

  /**
   * Add an axis aligned bounding box with the extent points (`minX`, `minY`),
   * (`maxX`, `maxY`) to the index.
   *
   * Returns the index position the item was added at (matching the order of calls to
   * `add`). For performance reasons the sanity checks of `minX <= maxX` and
   * `minY <= maxY` are only debug asserted. If an invalid box is added it may lead to
   * unexpected behavior from the constructed `StaticAabb2dIndex`.
   */
  add(minX: number, minY: number, maxX: number, maxY: number): number {
    const index = this.pos;
    // catch adding past num_items (error will be thrown when build is called)
    if (this.pos >= this.numItems) {
      this.pos += 1;
      return index;
    }
    debugAssert(minX <= maxX, "expected minX <= maxX");
    debugAssert(minY <= maxY, "expected minY <= maxY");

    const b = 4 * this.pos;
    this.boxes[b] = minX;
    this.boxes[b + 1] = minY;
    this.boxes[b + 2] = maxX;
    this.boxes[b + 3] = maxY;

    this.pos += 1;
    return index;
  }

  /**
   * Build the `StaticAabb2dIndex` with the boxes that have been added.
   *
   * Throws an `Error` if the number of added items does not match the count given at
   * the time the builder was created (Rust returns
   * `StaticAABB2DIndexBuildError::ItemCountError`; the `NumericCastError` case cannot
   * occur since the port is monomorphized to f64).
   */
  build(): StaticAabb2dIndex {
    if (this.pos !== this.numItems) {
      throw new Error(
        `added item count should equal static size given to builder ` +
          `(added: ${this.pos}, expected: ${this.numItems})`,
      );
    }

    if (this.numItems === 0) {
      return new StaticAabb2dIndex(
        this.nodeSize,
        this.numItems,
        this.levelBounds,
        new Float64Array(0),
        this.indices,
      );
    }

    const boxes = this.boxes;

    // calculate total bounds, initialize values with first box
    let minX = boxes[0];
    let minY = boxes[1];
    let maxX = boxes[2];
    let maxY = boxes[3];
    for (let i = 1; i < this.numItems; i += 1) {
      const b = 4 * i;
      minX = Math.min(minX, boxes[b]);
      minY = Math.min(minY, boxes[b + 1]);
      maxX = Math.max(maxX, boxes[b + 2]);
      maxY = Math.max(maxY, boxes[b + 3]);
    }

    // if number of items is less than node size then skip sorting since each node of boxes must
    // be fully scanned regardless and there is only one node
    if (this.numItems <= this.nodeSize) {
      this.indices[this.pos] = 0;
      // fill root box with total extents
      const b = 4 * this.pos;
      boxes[b] = minX;
      boxes[b + 1] = minY;
      boxes[b + 2] = maxX;
      boxes[b + 3] = maxY;

      return new StaticAabb2dIndex(
        this.nodeSize,
        this.numItems,
        this.levelBounds,
        this.boxes,
        this.indices,
      );
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const extentMinX = minX;
    const extentMinY = minY;

    // hilbert max input value for x and y
    const hilbertMax = 65535.0;
    const scaledWidth = hilbertMax / width;
    const scaledHeight = hilbertMax / height;

    // mapping the x and y coordinates of the center of the item boxes to values in the range
    // [0 -> n - 1] such that the min of the entire set of bounding boxes maps to 0 and the max
    // of the entire set of bounding boxes maps to n - 1 our 2d space is x: [0 -> n-1] and
    // y: [0 -> n-1], our 1d hilbert curve value space is d: [0 -> n^2 - 1]
    const hilbertValues = new Uint32Array(this.numItems);
    for (let i = 0; i < this.numItems; i += 1) {
      const b = 4 * i;
      const aabbMinX = boxes[b];
      const aabbMinY = boxes[b + 1];
      const aabbMaxX = boxes[b + 2];
      const aabbMaxY = boxes[b + 3];

      const x = hilbertCoord(scaledWidth, aabbMinX, aabbMaxX, extentMinX);
      const y = hilbertCoord(scaledHeight, aabbMinY, aabbMaxY, extentMinY);
      hilbertValues[i] = hilbertXyToIndex(x, y);
    }

    // sort items by their Hilbert value for constructing the tree
    sort(hilbertValues, boxes, this.indices, 0, this.numItems - 1, this.nodeSize);

    // generate nodes at each tree level, bottom-up
    let pos = 0;
    for (let lb = 0; lb < this.levelBounds.length - 1; lb += 1) {
      const levelEnd = this.levelBounds[lb];
      // generate a parent node for each block of consecutive node_size nodes
      while (pos < levelEnd) {
        let nodeMinX = Number.MAX_VALUE;
        let nodeMinY = Number.MAX_VALUE;
        let nodeMaxX = -Number.MAX_VALUE;
        let nodeMaxY = -Number.MAX_VALUE;
        const nodeIndex = pos;

        // calculate bounding box for the new node
        let j = 0;
        while (j < this.nodeSize && pos < levelEnd) {
          const b = 4 * pos;
          pos += 1;
          nodeMinX = Math.min(nodeMinX, boxes[b]);
          nodeMinY = Math.min(nodeMinY, boxes[b + 1]);
          nodeMaxX = Math.max(nodeMaxX, boxes[b + 2]);
          nodeMaxY = Math.max(nodeMaxY, boxes[b + 3]);
          j += 1;
        }

        // add the new node to the tree
        this.indices[this.pos] = nodeIndex;
        const wb = 4 * this.pos;
        boxes[wb] = nodeMinX;
        boxes[wb + 1] = nodeMinY;
        boxes[wb + 2] = nodeMaxX;
        boxes[wb + 3] = nodeMaxY;
        this.pos += 1;
      }
    }

    return new StaticAabb2dIndex(
      this.nodeSize,
      this.numItems,
      this.levelBounds,
      this.boxes,
      this.indices,
    );
  }
}

/**
 * Static/fixed size indexing data structure for two dimensional axis aligned bounding
 * boxes.
 *
 * The index allows for fast construction and fast querying but cannot be modified
 * after creation. This type is constructed from a `StaticAabb2dIndexBuilder`.
 *
 * 2D axis aligned bounding boxes are represented by two extent points (four values):
 * (minX, minY), (maxX, maxY).
 *
 * Port of the Rust `StaticAABB2DIndex` struct.
 *
 * # Examples
 *
 * ```ts
 * // create builder for index containing 4 axis aligned bounding boxes
 * const builder = new StaticAabb2dIndexBuilder(4);
 * // add bounding boxes to the index
 * // add takes in (minX, minY, maxX, maxY) of the bounding box
 * builder.add(0.0, 0.0, 2.0, 2.0);
 * builder.add(-1.0, -1.0, 3.0, 3.0);
 * builder.add(0.0, 0.0, 1.0, 3.0);
 * builder.add(4.0, 2.0, 16.0, 8.0);
 * // note build throws an Error if the number of added boxes does not equal the static
 * // size given at the time the builder was created
 * const index = builder.build();
 * // query the created index (minX, minY, maxX, maxY)
 * const queryResults = index.query(-1.0, -1.0, -0.5, -0.5);
 * // queryResults holds the index positions of the boxes that overlap with the box
 * // given (positions are according to the order boxes were added to the index builder)
 * // queryResults deep equals [1]
 * ```
 */
export class StaticAabb2dIndex {
  /**
   * The node size used for the index — the maximum number of boxes stored as children
   * of each node in the index tree (Rust `node_size()`).
   */
  readonly nodeSize: number;
  /**
   * Total count of items that were added to the index during construction
   * (Rust `count()`).
   */
  readonly count: number;
  private levelBounds: number[];
  /** Flat box storage, 4 values (minX, minY, maxX, maxY) per box. */
  private boxes: Float64Array;
  private indices: Uint32Array;
  /**
   * Reusable stack buffer for query traversal (maps the Rust `*_with_stack` method
   * variants — one internal stack reused across queries on this index).
   */
  private stack: number[];
  /** Guard for reentrant queries (a query made from within a visitor). */
  private stackInUse: boolean;

  /** @internal Constructed by `StaticAabb2dIndexBuilder.build`. */
  constructor(
    nodeSize: number,
    numItems: number,
    levelBounds: number[],
    boxes: Float64Array,
    indices: Uint32Array,
  ) {
    this.nodeSize = nodeSize;
    this.count = numItems;
    this.levelBounds = levelBounds;
    this.boxes = boxes;
    this.indices = indices;
    this.stack = [];
    this.stackInUse = false;
  }

  /**
   * Gets the total bounds of all the items that were added to the index or `null` if
   * the index had no items added in construction (item count is 0).
   */
  bounds(): AABB | null {
    if (this.boxes.length === 0) {
      return null;
    }

    const b = this.boxes.length - 4;
    return {
      minX: this.boxes[b],
      minY: this.boxes[b + 1],
      maxX: this.boxes[b + 2],
      maxY: this.boxes[b + 3],
    };
  }

  /**
   * Queries the index, returning an array of indices to items that overlap with the
   * bounding box given.
   *
   * `minX`, `minY`, `maxX`, and `maxY` represent the bounding box to use for the
   * query. Indexes returned match with the order items were added to the index using
   * `StaticAabb2dIndexBuilder.add`.
   */
  query(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const results: number[] = [];
    this.visitQuery(minX, minY, maxX, maxY, (i) => {
      results.push(i);
    });
    return results;
  }

  /**
   * Same as `query` but instead of returning a collection of indices a `visitor`
   * function is called for each index that would be returned. The `visitor` returns
   * `false` to stop visiting results early (any other return value continues).
   *
   * Returns `true` if all results were visited, `false` if the visitor broke early
   * (port of Rust `visit_query`/`visit_query_with_stack` — one reusable internal
   * stack is used for the traversal).
   */
  visitQuery(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    visitor: (index: number) => VisitResult,
  ): boolean {
    if (this.count === 0) {
      // empty index, return early since no results to visit
      return true;
    }

    // reuse the internal stack buffer unless a reentrant query (query made from
    // within a visitor) is in progress, in which case allocate a fresh local stack
    let stack: number[];
    if (this.stackInUse) {
      stack = [];
    } else {
      stack = this.stack;
      this.stackInUse = true;
    }

    try {
      return this.visitQueryImpl(minX, minY, maxX, maxY, visitor, stack);
    } finally {
      if (stack === this.stack) {
        this.stackInUse = false;
      }
    }
  }

  // Implementation function which assumes this.count > 0.
  private visitQueryImpl(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    visitor: (index: number) => VisitResult,
    stack: number[],
  ): boolean {
    const boxes = this.boxes;
    let nodeIndex = this.indices.length - 1;
    let level = this.levelBounds.length - 1;
    // ensure the stack is empty for use
    stack.length = 0;

    for (;;) {
      const end = Math.min(nodeIndex + this.nodeSize, this.levelBounds[level]);

      for (let pos = nodeIndex; pos < end; pos += 1) {
        const b = 4 * pos;
        if (boxes[b + 2] < minX || boxes[b + 3] < minY || boxes[b] > maxX || boxes[b + 1] > maxY) {
          // no overlap
          continue;
        }

        const index = this.indices[pos];
        if (nodeIndex < this.count) {
          if (visitor(index) === false) {
            return false;
          }
        } else {
          stack.push(index);
          stack.push(level - 1);
        }
      }

      if (stack.length > 1) {
        level = stack.pop() as number;
        nodeIndex = stack.pop() as number;
      } else {
        return true;
      }
    }
  }

  /**
   * Returns all the item `AABB` that were added to the index by
   * `StaticAabb2dIndexBuilder.add` during construction.
   *
   * NOTE: mirrors Rust `item_boxes()` semantics — the boxes are in the index's
   * internal (hilbert sorted) order, NOT the order they were added (unless the item
   * count is less than or equal to the node size, in which case sorting is skipped).
   * Use `itemIndices` to map a box's positional index back to the original index
   * position the item was added.
   */
  itemBoxes(): AABB[] {
    const result: AABB[] = [];
    for (let i = 0; i < this.count; i += 1) {
      const b = 4 * i;
      result.push({
        minX: this.boxes[b],
        minY: this.boxes[b + 1],
        maxX: this.boxes[b + 2],
        maxY: this.boxes[b + 3],
      });
    }
    return result;
  }

  /**
   * Used to map an item box index position from `itemBoxes` back to the original
   * index position the item was added (Rust `item_indices()`).
   */
  itemIndices(): number[] {
    const result: number[] = [];
    for (let i = 0; i < this.count; i += 1) {
      result.push(this.indices[i]);
    }
    return result;
  }
}
