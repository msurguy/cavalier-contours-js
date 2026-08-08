import { FUZZY_EPSILON, fuzzyEqEps } from "./fuzzy.js";

/**
 * A 2D vector with x and y components.
 *
 * This is the fundamental 2D vector type used throughout the library for representing
 * points, directions, and performing vector operations. Components are `number` (f64).
 *
 * Instances are immutable value objects — never mutate one; construct new instances.
 * Rust operators map to methods: `a + b` → `a.add(b)`, `a - b` → `a.sub(b)`,
 * `s * v` / `v * s` → `v.scale(s)`, `-v` → `v.neg()`.
 *
 * # Examples
 *
 * ```ts
 * const v1 = new Vector2(3.0, 4.0);
 * const v2 = vec2(1.0, 2.0); // shorthand constructor
 *
 * // Vector operations
 * const sum = v1.add(v2);
 * const dotProduct = v1.dot(v2);
 * const length = v1.length();
 * const normalized = v1.normalize();
 * ```
 */
export class Vector2 {
  /** The x-coordinate component. */
  readonly x: number;
  /** The y-coordinate component. */
  readonly y: number;

  /** Create a new vector with x and y components. */
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  /** Create a zero vector (x = 0, y = 0). */
  static zero(): Vector2 {
    return new Vector2(0.0, 0.0);
  }

  /** Uniformly scale the vector by `scaleFactor`. */
  scale(scaleFactor: number): Vector2 {
    return vec2(scaleFactor * this.x, scaleFactor * this.y);
  }

  /** Dot product. */
  dot(other: Vector2): number {
    return this.x * other.x + this.y * other.y;
  }

  /** Compute the perpendicular dot product (`this.x * other.y - this.y * other.x`). */
  perpDot(other: Vector2): number {
    return this.x * other.y - this.y * other.x;
  }

  /** Squared length of the vector. */
  lengthSquared(): number {
    return this.dot(this);
  }

  /** Length of the vector. */
  length(): number {
    return Math.sqrt(this.dot(this));
  }

  /** Normalize the vector (length = 1). */
  normalize(): Vector2 {
    return this.scale(1.0 / this.length());
  }

  /**
   * Normalize the vector unless it is too small to do so robustly.
   *
   * Returns a zero vector when `lengthSquared <= fuzzyEpsilon^2`.
   *
   * This guards geometry algorithms against degenerate segments (for example, repeated input
   * points during parallel offset) where `normalize()` can produce unstable results.
   */
  safeNormalize(): Vector2 {
    const eps = FUZZY_EPSILON;
    if (this.lengthSquared() <= eps * eps) {
      return Vector2.zero();
    } else {
      return this.normalize();
    }
  }

  /** Fuzzy equal comparison with another vector using `fuzzyEpsilon` given. */
  fuzzyEqEps(other: Vector2, fuzzyEpsilon: number): boolean {
    return fuzzyEqEps(this.x, other.x, fuzzyEpsilon) && fuzzyEqEps(this.y, other.y, fuzzyEpsilon);
  }

  /** Fuzzy equal comparison with another vector using `FUZZY_EPSILON`. */
  fuzzyEq(other: Vector2): boolean {
    return this.fuzzyEqEps(other, FUZZY_EPSILON);
  }

  /** Create perpendicular vector. */
  perp(): Vector2 {
    return vec2(-this.y, this.x);
  }

  /** Create perpendicular unit vector (length = 1). */
  unitPerp(): Vector2 {
    return this.perp().normalize();
  }

  /**
   * Create a perpendicular unit vector, or zero for near-zero inputs.
   *
   * Example breakdown case: offsetting a segment whose endpoints are effectively the same point.
   * A plain `unitPerp()` is unstable there, while this keeps the offset step finite.
   */
  safeUnitPerp(): Vector2 {
    return this.perp().safeNormalize();
  }

  /** Rotate this point around an `origin` point by some `angle` in radians. */
  rotateAbout(origin: Vector2, angle: number): Vector2 {
    // translate to origin
    const translated = this.sub(origin);

    // rotate
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    const rotated = vec2(
      translated.x * c - translated.y * s,
      translated.x * s + translated.y * c,
    );

    // translate back
    return rotated.add(origin);
  }

  /** Component-wise addition (Rust `Add` operator). */
  add(rhs: Vector2): Vector2 {
    return new Vector2(this.x + rhs.x, this.y + rhs.y);
  }

  /** Component-wise subtraction (Rust `Sub` operator). */
  sub(rhs: Vector2): Vector2 {
    return new Vector2(this.x - rhs.x, this.y - rhs.y);
  }

  /** Component-wise negation (Rust `Neg` operator). */
  neg(): Vector2 {
    return new Vector2(-this.x, -this.y);
  }

  /** Display formatting (Rust `Display` impl: `[x, y]`). */
  toString(): string {
    return `[${this.x}, ${this.y}]`;
  }
}

/**
 * Shorthand constructor for creating a `Vector2`.
 *
 * This is a convenience function equivalent to `new Vector2(x, y)`.
 *
 * # Examples
 *
 * ```ts
 * const v = vec2(3.0, 4.0);
 * // v.x === 3.0
 * // v.y === 4.0
 * ```
 */
export function vec2(x: number, y: number): Vector2 {
  return new Vector2(x, y);
}
