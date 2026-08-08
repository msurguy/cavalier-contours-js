import { FUZZY_EPSILON, fuzzyEqEps, fuzzyEqZeroEps } from "../core/fuzzy.js";
import { Vector2 } from "../core/vector2.js";

/**
 * A polyline vertex is represented by an `x`, `y`, and `bulge` value.
 *
 * `x` and `y` describe the 2D position of the vertex. `bulge` describes the arc sweep angle for
 * the polyline segment that starts with this vertex. `bulge` is defined as
 * `tan(arc_sweep_angle / 4)`. Note a polyline arc segment can never have a sweep angle greater
 * than `PI` (half circle).
 *
 * See `angleFromBulge` and `bulgeFromAngle` for functions to convert between bulge and
 * arc sweep angle.
 *
 * Instances are immutable value objects — never mutate one obtained from a polyline;
 * construct new instances (`withBulge`, etc.).
 */
export class PlineVertex {
  /** X coordinate position for the vertex. */
  readonly x: number;
  /** Y coordinate position for the vertex. */
  readonly y: number;
  /** Bulge for the polyline segment that starts with this vertex. */
  readonly bulge: number;

  constructor(x: number, y: number, bulge: number) {
    this.x = x;
    this.y = y;
    this.bulge = bulge;
  }

  /**
   * Construct a vertex from a `[x, y, bulge]` slice.
   *
   * If the slice does not contain exactly 3 elements then `null` is returned.
   */
  static fromSlice(slice: readonly number[]): PlineVertex | null {
    if (slice.length === 3) {
      return new PlineVertex(slice[0], slice[1], slice[2]);
    } else {
      return null;
    }
  }

  /** Construct a vertex using a 2D vector as the position. */
  static fromVector2(vector2: Vector2, bulge: number): PlineVertex {
    return new PlineVertex(vector2.x, vector2.y, bulge);
  }

  /** Create a copy of the vertex with new bulge value but same `x` and `y` values. */
  withBulge(bulge: number): PlineVertex {
    return new PlineVertex(this.x, this.y, bulge);
  }

  /** Return the position as a 2D vector. */
  pos(): Vector2 {
    return new Vector2(this.x, this.y);
  }

  /**
   * Returns true if `bulge` is fuzzy equal to zero (represents the start of a line segment).
   *
   * `fuzzyEpsilon` defaults to `FUZZY_EPSILON` (Rust `bulge_is_zero` uses the default).
   */
  bulgeIsZero(fuzzyEpsilon: number = FUZZY_EPSILON): boolean {
    return fuzzyEqZeroEps(this.bulge, fuzzyEpsilon);
  }

  /**
   * Returns true if `this.bulge > 0.0` (represents the start of a counter clockwise arc
   * segment).
   */
  bulgeIsPos(): boolean {
    return this.bulge > 0.0;
  }

  /** Returns true if `this.bulge < 0.0` (represents the start of a clockwise arc segment). */
  bulgeIsNeg(): boolean {
    return this.bulge < 0.0;
  }

  /** Fuzzy equal comparison with another vertex using `fuzzyEpsilon` given. */
  fuzzyEqEps(other: PlineVertex, fuzzyEpsilon: number): boolean {
    return (
      fuzzyEqEps(this.x, other.x, fuzzyEpsilon) &&
      fuzzyEqEps(this.y, other.y, fuzzyEpsilon) &&
      fuzzyEqEps(this.bulge, other.bulge, fuzzyEpsilon)
    );
  }

  /** Fuzzy equal comparison with another vertex using `FUZZY_EPSILON`. */
  fuzzyEq(other: PlineVertex): boolean {
    return this.fuzzyEqEps(other, FUZZY_EPSILON);
  }

  /** Display formatting (Rust `Display` impl: `[x, y, bulge]`). */
  toString(): string {
    return `[${this.x}, ${this.y}, ${this.bulge}]`;
  }
}
