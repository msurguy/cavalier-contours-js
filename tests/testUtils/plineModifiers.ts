// Port of Rust `tests/test_utils/pline_modifiers.rs`.
import { Polyline } from "../../src/polyline/polyline.js";

/**
 * Cycles all the vertex index positions forward by `n`. E.g. index 0 becomes 1, last index becomes
 * 0, etc. (only applicable to closed polylines)
 */
export function cycleStartIndexForward(input: Polyline, n: number): Polyline {
  if (!(n > 0)) {
    throw new Error("cycling forward by 0 just returns the same polyline");
  }
  if (!(n < input.vertexCount)) {
    throw new Error("cycling forward by more than the polyline length is unnecessary");
  }
  if (!input.isClosed) {
    throw new Error("cycling vertex index positions not possible with open polyline");
  }
  // mirrors Rust `input.iter_vertexes().cycle().skip(n).take(input.vertex_count())`
  const vc = input.vertexCount;
  const vertexes = [];
  for (let k = n; k < n + vc; k += 1) {
    vertexes.push(input.at(k % vc));
  }
  return Polyline.fromVertexes(vertexes, input.isClosed);
}

export class ModifiedPlineState {
  invertedDirection: boolean;
  cyclePosition: number;

  constructor(invertedDirection: boolean, cyclePosition: number) {
    this.invertedDirection = invertedDirection;
    this.cyclePosition = cyclePosition;
  }
}

/**
 * Visitor for `ModifiedPlineSet` (Rust `ModifiedPlineSetVisitor` trait / `accept_closure`
 * closure).
 */
export type ModifiedPlineSetVisitor = (
  modifiedPline: Polyline,
  plineState: ModifiedPlineState,
) => void;

export class ModifiedPlineSet {
  input: Polyline;
  invertDirection: boolean;
  cycleIndexPositions: boolean;

  constructor(input: Polyline, invertDirection: boolean, cycleIndexPositions: boolean) {
    this.input = input;
    this.invertDirection = invertDirection;
    this.cycleIndexPositions = cycleIndexPositions;
  }

  /** Visit all the modified polylines (Rust `accept`/`accept_closure`). */
  accept(visitor: ModifiedPlineSetVisitor): void {
    visitor(this.input.clone(), new ModifiedPlineState(false, 0));
    if (this.invertDirection) {
      const pl = this.input.clone();
      pl.invertDirectionMut();
      visitor(pl, new ModifiedPlineState(true, 0));
    }

    if (this.cycleIndexPositions && this.input.isClosed) {
      for (let i = 1; i < this.input.vertexCount; i += 1) {
        const cycled = cycleStartIndexForward(this.input, i);
        visitor(cycled, new ModifiedPlineState(false, i));
      }

      if (this.invertDirection) {
        for (let i = 1; i < this.input.vertexCount; i += 1) {
          const inverted = this.input.clone();
          inverted.invertDirectionMut();
          const cycled = cycleStartIndexForward(inverted, i);
          visitor(cycled, new ModifiedPlineState(true, i));
        }
      }
    }
  }
}
