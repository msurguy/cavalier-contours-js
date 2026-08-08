// Port of Rust `tests/test_pline_winding_number.rs`.
import { expect, test } from "vitest";
import { Vector2 } from "../src/core/vector2.js";
import { plineClosed } from "../src/polyline/construct.js";

test("point_and_circle", () => {
  const pl = plineClosed([
    [0.0, 0.0, 1.0],
    [1.0, 0.0, 1.0],
  ]);

  // inside the circle
  {
    const pt = new Vector2(0.5, 0.0);
    expect(pl.windingNumber(pt)).toBe(1);

    const inverted = pl.clone();
    inverted.invertDirectionMut();
    expect(inverted.windingNumber(pt)).toBe(-1);
  }

  // outside the circle
  {
    const pt = new Vector2(2.0, 0.0);
    expect(pl.windingNumber(pt)).toBe(0);

    const inverted = pl.clone();
    inverted.invertDirectionMut();
    expect(inverted.windingNumber(pt)).toBe(0);
  }
});

test("point_and_rectangle", () => {
  const pl = plineClosed([
    [0.0, 0.0, 0.0],
    [4.0, 0.0, 0.0],
    [4.0, 4.0, 0.0],
    [0.0, 4.0, 0.0],
  ]);

  // inside the rectangle
  {
    const pt = new Vector2(1.0, 1.0);
    expect(pl.windingNumber(pt)).toBe(1);

    const inverted = pl.clone();
    inverted.invertDirectionMut();
    expect(inverted.windingNumber(pt)).toBe(-1);
  }

  // outside the rectangle
  {
    const pt = new Vector2(-1.0, 1.0);
    expect(pl.windingNumber(pt)).toBe(0);

    const inverted = pl.clone();
    inverted.invertDirectionMut();
    expect(inverted.windingNumber(pt)).toBe(0);
  }
});

test("multiple_windings", () => {
  // path forming circle overlapping itself
  const pl = plineClosed([
    [0.0, 0.0, 1.0],
    [2.0, 0.0, 1.0],
    [0.0, 0.0, 1.0],
    [2.0, 0.0, 1.0],
  ]);

  // inside the circle
  {
    const pt = new Vector2(0.5, 0.0);
    expect(pl.windingNumber(pt)).toBe(2);

    const inverted = pl.clone();
    inverted.invertDirectionMut();
    expect(inverted.windingNumber(pt)).toBe(-2);
  }

  // outside the circle
  {
    const pt = new Vector2(2.0, 0.0);
    expect(pl.windingNumber(pt)).toBe(0);

    const inverted = pl.clone();
    inverted.invertDirectionMut();
    expect(inverted.windingNumber(pt)).toBe(0);
  }
});

test("point_outside_aligned_with_direction_vectors1", () => {
  const pl = plineClosed([
    [-10.0, 0.0, 1.0],
    [10.0, 0.0, 0.0],
    [20.0, 0.0, 0.0],
    [20.0, -10.0, 0.0],
    [-20.0, -10.0, 0.0],
    [-20.0, 0.0, 0.0],
  ]);

  const pt = Vector2.zero();

  expect(pl.windingNumber(pt)).toBe(0);
});

test("point_outside_aligned_with_direction_vectors2", () => {
  const pl = plineClosed([
    [-5.51073e-15, -30.0, 0.269712],
    [26.0788, -14.8288, 0.0],
    [76.0788, 73.104, 0.12998],
    [80.0, 87.9329, 0.0],
    [80.0, 130.0, 0.0],
    [50.0, 130.0, 0.0],
    [50.0, 95.0, -0.414214],
    [40.0, 85.0, 0.0],
    [0.0, 85.0, 0.0],
  ]);

  const pt = new Vector2(-20.0, 85.0);

  expect(pl.windingNumber(pt)).toBe(0);
});
