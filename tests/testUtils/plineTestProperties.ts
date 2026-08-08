// Port of Rust `tests/test_utils/pline_test_properties.rs`.
import { fuzzyEqEps } from "../../src/core/fuzzy.js";
import { type AABB, aabb } from "../../src/index2d/staticAabb2dIndex.js";
import type { PlineSourceBase } from "../../src/polyline/plineSourceBase.js";

/** Fuzzy compare AABB values */
export function aabbFuzzyEqEps(a: AABB, b: AABB, eps: number): boolean {
  return (
    fuzzyEqEps(a.minX, b.minX, eps) &&
    fuzzyEqEps(a.minY, b.minY, eps) &&
    fuzzyEqEps(a.maxX, b.maxX, eps) &&
    fuzzyEqEps(a.maxY, b.maxY, eps)
  );
}

/** Holds a set of properties of a polyline for comparison in tests */
export class PlineProperties {
  // positions equal epsilon
  static readonly POS_EQ_EPS = 1e-5;
  // property comparer epsilon
  static readonly PROP_CMP_EPS = 1e-4;
  // epsilon for use of remove_redundant for consistent property compare
  static readonly REMOVE_REDUNDANT_EPS = 1e-4;

  vertexCount: number;
  area: number;
  pathLength: number;
  extents: AABB;
  userdata: number[];

  constructor(
    vertexCount: number,
    area: number,
    pathLength: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    userdata: number[] = [],
  ) {
    this.vertexCount = vertexCount;
    this.area = area;
    this.pathLength = pathLength;
    this.extents = aabb(minX, minY, maxX, maxY);
    this.userdata = userdata;
  }

  static fromPline(pline: PlineSourceBase, invertArea: boolean): PlineProperties {
    // remove redundant vertexes for consistent vertex counts
    const rr = pline.removeRedundant(PlineProperties.REMOVE_REDUNDANT_EPS);
    const p = rr ?? pline;
    const a = p.area();
    const area = invertArea ? -a : a;
    const userdata = [...p.userdata];

    const extents = p.extents();
    if (extents === null) {
      throw new Error("polyline must have extents to create properties");
    }

    const result = new PlineProperties(
      p.vertexCount,
      area,
      p.pathLength(),
      extents.minX,
      extents.minY,
      extents.maxX,
      extents.maxY,
      userdata,
    );
    return result;
  }

  fuzzyEqEps(other: PlineProperties, eps: number): boolean {
    if (this.vertexCount !== other.vertexCount) {
      return false;
    }
    if (!fuzzyEqEps(this.area, other.area, eps)) {
      return false;
    }
    if (!fuzzyEqEps(this.pathLength, other.pathLength, eps)) {
      return false;
    }
    if (!aabbFuzzyEqEps(this.extents, other.extents, eps)) {
      return false;
    }
    if (!userdataSetsMatch(this.userdata, other.userdata)) {
      return false;
    }
    return true;
  }

  fuzzyEqEpsAbsA(other: PlineProperties, eps: number): boolean {
    if (this.vertexCount !== other.vertexCount) {
      return false;
    }
    if (!fuzzyEqEps(Math.abs(this.area), Math.abs(other.area), eps)) {
      return false;
    }
    if (!fuzzyEqEps(this.pathLength, other.pathLength, eps)) {
      return false;
    }
    if (!aabbFuzzyEqEps(this.extents, other.extents, eps)) {
      return false;
    }
    if (!userdataSetsMatch(this.userdata, other.userdata)) {
      return false;
    }
    return true;
  }
}

export function createPropertySet(
  polylines: Iterable<PlineSourceBase>,
  invertArea: boolean,
): PlineProperties[] {
  const result: PlineProperties[] = [];
  for (const pl of polylines) {
    result.push(PlineProperties.fromPline(pl, invertArea));
  }
  return result;
}

export function userdataSetsMatch(actual: readonly number[], expected: readonly number[]): boolean {
  let setsMatch = true;
  for (const datum of expected) {
    if (!actual.includes(datum)) {
      setsMatch = false;
      break;
    }
  }
  return setsMatch;
}

export function propertySetsMatch(
  resultSet: readonly PlineProperties[],
  expectedSet: readonly PlineProperties[],
): boolean {
  let setsMatch = true;
  if (resultSet.length !== expectedSet.length) {
    setsMatch = false;
  } else {
    // using simple N^2 comparisons to compare property sets (sets are always relatively small,
    // e.g. N < 10)
    for (const propertiesExpected of expectedSet) {
      const matchCount = resultSet.filter((propertiesResult) =>
        propertiesExpected.fuzzyEqEps(propertiesResult, PlineProperties.PROP_CMP_EPS),
      ).length;

      if (matchCount !== 1) {
        setsMatch = false;
        break;
      }
    }
  }

  if (!setsMatch) {
    console.error("result:\n", resultSet);
    console.error("expected:\n", expectedSet);
  }

  return setsMatch;
}

export function propertySetsMatchAbsA(
  resultSet: readonly PlineProperties[],
  expectedSet: readonly PlineProperties[],
): boolean {
  let setsMatch = true;
  if (resultSet.length !== expectedSet.length) {
    setsMatch = false;
  } else {
    // using simple N^2 comparisons to compare property sets (sets are always relatively small,
    // e.g. N < 10)
    for (const propertiesExpected of expectedSet) {
      const matchCount = resultSet.filter((propertiesResult) =>
        propertiesExpected.fuzzyEqEpsAbsA(propertiesResult, PlineProperties.PROP_CMP_EPS),
      ).length;

      if (matchCount !== 1) {
        setsMatch = false;
        break;
      }
    }
  }

  if (!setsMatch) {
    console.error("result:\n", resultSet);
    console.error("expected:\n", expectedSet);
  }

  return setsMatch;
}
