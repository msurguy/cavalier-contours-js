// Port of Rust `tests/test_pline_contains.rs`.
import { describe, expect, test } from "vitest";
import { plineClosed, plineOpen } from "../src/polyline/construct.js";

describe("test_pline_contains", () => {
  test("test_rectangle_contains_circle", () => {
    const rectangle = plineClosed([
      [-2.0, -2.0, 0.0],
      [2.0, -2.0, 0.0],
      [2.0, 2.0, 0.0],
      [-2.0, 2.0, 0.0],
    ]);

    const circle = plineClosed([
      [-1.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
    ]);

    expect(rectangle.contains(circle)).toBe("pline2InsidePline1");
    expect(circle.contains(rectangle)).toBe("pline1InsidePline2");
  });

  test("test_rectangle_intersects_circle", () => {
    const rectangle = plineClosed([
      [-2.0, -2.0, 0.0],
      [0.5, -2.0, 0.0],
      [0.5, 2.0, 0.0],
      [-2.0, 2.0, 0.0],
    ]);

    const circle = plineClosed([
      [-1.0, 0.0, 1.0],
      [1.0, 0.0, 1.0],
    ]);

    expect(rectangle.contains(circle)).toBe("intersected");
    expect(circle.contains(rectangle)).toBe("intersected");
  });

  test("test_disjoint", () => {
    const rectangle = plineClosed([
      [-2.0, -2.0, 0.0],
      [2.0, -2.0, 0.0],
      [2.0, 2.0, 0.0],
      [-2.0, 2.0, 0.0],
    ]);

    const circle = plineClosed([
      [4.0, 0.0, 1.0],
      [5.0, 0.0, 1.0],
    ]);

    expect(rectangle.contains(circle)).toBe("disjoint");
    expect(circle.contains(rectangle)).toBe("disjoint");
  });

  test("test_copy", () => {
    const rectangle = plineClosed([
      [-2.0, -2.0, 0.0],
      [2.0, -2.0, 0.0],
      [2.0, 2.0, 0.0],
      [-2.0, 2.0, 0.0],
    ]);

    expect(rectangle.contains(rectangle.clone())).toBe("intersected");
  });

  test("test_invalid", () => {
    const bad1 = plineOpen([[0.0, 0.0, 0.0]]);
    const bad2 = plineOpen([[-2.0, -2.0, 0.0]]);

    expect(bad1.contains(bad2)).toBe("invalidInput");
    expect(bad2.contains(bad1)).toBe("invalidInput");
  });

  test("test_self_intersect_scan", () => {
    const hourglass = plineClosed([
      [0.0, 2.0, 0.0],
      [1.0, 1.0, 0.0],
      [0.0, 1.0, 0.0],
      [1.0, 2.0, 0.0],
    ]);
    expect(hourglass.scanForSelfIntersect()).toBe(true);
  });
});
