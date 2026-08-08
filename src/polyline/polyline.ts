/**
 * Basic polyline data representation.
 *
 * Port of `polyline/pline.rs`. The Rust `Polyline<T>` struct becomes the concrete `Polyline`
 * class extending `PlineSourceMutBase` (which provides all the `PlineSource`/`PlineSourceMut`
 * default trait methods). The Rust `PlineCreation` trait associated functions become static
 * methods (`withCapacity`, `fromVertexes`, `createFrom`, `createFromRemoveRepeat`, `empty`).
 */
import { type PlineSourceBase, PlineSourceMutBase } from "./plineSourceBase.js";
import { PlineVertex } from "./plineVertex.js";

/**
 * Basic polyline data representation that implements the core polyline methods. See
 * `PlineSourceBase`/`PlineSourceMutBase` documentation for all the polyline
 * methods/operations available.
 */
export class Polyline extends PlineSourceMutBase {
  /** Contiguous sequence of vertexes. */
  vertexData: PlineVertex[];
  /** Bool to indicate whether the polyline is closed or open. */
  isClosed: boolean;
  /**
   * Array of user-provided integer values. Preserved across offset calls. Note that a Polyline
   * that was composed out of multiple slices of other Polylines will have userdata values from
   * each source polyline, and as such userdata values may appear repeatedly.
   */
  userdata: number[];

  /**
   * Create a new empty `Polyline`.
   *
   * `new Polyline()` mirrors Rust `Polyline::new()` (`isClosed` set to false) and
   * `new Polyline({ isClosed: true })` mirrors Rust `Polyline::new_closed()`.
   */
  constructor(options?: { isClosed?: boolean }) {
    super();
    this.vertexData = [];
    this.isClosed = options?.isClosed ?? false;
    this.userdata = [];
  }

  /**
   * Create a new empty polyline with `capacity` given and `isClosed` indicating whether it is
   * a closed or open polyline (Rust `PlineCreation::with_capacity` — the capacity hint is
   * unused since JS arrays grow dynamically).
   */
  static withCapacity(capacity: number, isClosed: boolean): Polyline {
    void capacity;
    return new Polyline({ isClosed });
  }

  /**
   * Create a new polyline by constructing from the vertexes given, `isClosed` sets whether the
   * created polyline is closed or open (Rust `PlineCreation::from_iter`). Optionally sets the
   * `userdata` values.
   */
  static fromVertexes(
    vertexes: Iterable<PlineVertex>,
    isClosed: boolean,
    userdata?: readonly number[],
  ): Polyline {
    const result = new Polyline({ isClosed });
    for (const v of vertexes) {
      result.vertexData.push(v);
    }
    if (userdata !== undefined) {
      for (const d of userdata) {
        result.userdata.push(d);
      }
    }
    return result;
  }

  /** Create a new polyline by cloning from an existing polyline source. */
  static createFrom(pline: PlineSourceBase): Polyline {
    const result = Polyline.fromVertexes(pline.iterVertexes(), pline.isClosed);

    result.setUserdataValues(pline.getUserdataValues());
    return result;
  }

  /**
   * Same as `createFrom` but removes any repeat position vertexes in the process using
   * `posEqualEps` for positional comparisons.
   */
  static createFromRemoveRepeat(pline: PlineSourceBase, posEqualEps: number): Polyline {
    const result = Polyline.withCapacity(pline.vertexCount, pline.isClosed);
    for (const v of pline.iterVertexes()) {
      result.addOrReplaceVertex(v, posEqualEps);
    }

    if (pline.isClosed && result.vertexCount >= 2) {
      // catch last position overlapping first for closed polyline case
      const last = result.last();
      if (last !== null && last.pos().fuzzyEqEps(result.at(0).pos(), posEqualEps)) {
        result.removeLast();
      }
    }

    result.setUserdataValues(pline.getUserdataValues());
    return result;
  }

  /** Create empty polyline with `isClosed` set to false (Rust `PlineCreation::empty`). */
  static empty(): Polyline {
    return Polyline.withCapacity(0, false);
  }

  /**
   * Create a polyline from parallel flat arrays of `x`, `y`, and `bulge` values (interop
   * helper, e.g. for `Float64Array` data). Optionally sets the `userdata` values.
   *
   * @throws Error if the arrays do not all have the same length.
   */
  static fromFlatArrays(
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    bulge: ArrayLike<number>,
    isClosed: boolean,
    userdata?: readonly number[],
  ): Polyline {
    if (x.length !== y.length || x.length !== bulge.length) {
      throw new Error("fromFlatArrays: x, y, and bulge arrays must all have the same length");
    }
    const result = new Polyline({ isClosed });
    for (let i = 0; i < x.length; i += 1) {
      result.vertexData.push(new PlineVertex(x[i], y[i], bulge[i]));
    }
    if (userdata !== undefined) {
      for (const d of userdata) {
        result.userdata.push(d);
      }
    }
    return result;
  }

  /**
   * Return the vertex data as parallel flat `Float64Array`s of `x`, `y`, and `bulge` values
   * (interop helper).
   */
  toFlatArrays(): { x: Float64Array; y: Float64Array; bulge: Float64Array } {
    const n = this.vertexData.length;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const bulge = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const v = this.vertexData[i];
      x[i] = v.x;
      y[i] = v.y;
      bulge[i] = v.bulge;
    }
    return { x, y, bulge };
  }

  /** Create a copy of this polyline (Rust `Clone` impl — vertexes are immutable and shared). */
  clone(): Polyline {
    const result = new Polyline({ isClosed: this.isClosed });
    result.vertexData = this.vertexData.slice();
    result.userdata = this.userdata.slice();
    return result;
  }

  get vertexCount(): number {
    return this.vertexData.length;
  }

  get(index: number): PlineVertex | null {
    const v = this.vertexData[index];
    return v === undefined ? null : v;
  }

  at(index: number): PlineVertex {
    const v = this.vertexData[index];
    if (v === undefined) {
      throw new Error(
        `vertex index ${index} out of bounds (polyline has ${this.vertexData.length} vertexes)`,
      );
    }
    return v;
  }

  protected createOutputWithCapacity(capacity: number, isClosed: boolean): Polyline {
    return Polyline.withCapacity(capacity, isClosed);
  }

  protected createOutputFromVertexes(
    vertexes: Iterable<PlineVertex>,
    isClosed: boolean,
  ): Polyline {
    return Polyline.fromVertexes(vertexes, isClosed);
  }

  setVertex(index: number, vertex: PlineVertex): void {
    if (index < 0 || index >= this.vertexData.length) {
      throw new Error(
        `vertex index ${index} out of bounds (polyline has ${this.vertexData.length} vertexes)`,
      );
    }
    this.vertexData[index] = vertex;
  }

  insertVertex(index: number, vertex: PlineVertex): void {
    if (index < 0 || index > this.vertexData.length) {
      throw new Error(
        `insert index ${index} out of bounds (polyline has ${this.vertexData.length} vertexes)`,
      );
    }
    this.vertexData.splice(index, 0, vertex);
  }

  remove(index: number): PlineVertex {
    if (index < 0 || index >= this.vertexData.length) {
      throw new Error(
        `remove index ${index} out of bounds (polyline has ${this.vertexData.length} vertexes)`,
      );
    }
    return this.vertexData.splice(index, 1)[0];
  }

  clear(): void {
    this.vertexData.length = 0;
  }

  addVertex(vertex: PlineVertex): void {
    this.vertexData.push(vertex);
  }

  extendVertexes(vertexes: Iterable<PlineVertex>): void {
    for (const v of vertexes) {
      this.vertexData.push(v);
    }
  }

  reserve(additional: number): void {
    // no-op: JS arrays grow dynamically
    void additional;
  }

  setIsClosed(isClosed: boolean): void {
    this.isClosed = isClosed;
  }
}
