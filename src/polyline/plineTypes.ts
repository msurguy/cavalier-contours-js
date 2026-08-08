/**
 * Supporting public types used in the core polyline trait methods.
 *
 * Port of `polyline/pline_types.rs`. Rust option structs become interfaces with
 * all-optional fields paired with `defaultXxx()` factory functions returning the
 * Rust `Default` impl values. Rust fieldless enums become string-literal unions.
 * Types generic over the polyline type in Rust (`P: PlineCreation`) stay generic
 * `<P>` here (the `Polyline` type is ported in a later milestone). Visitor traits
 * become function types returning `VisitResult` (`false` = break).
 */
import type { VisitResult } from "../core/controlFlow.js";
import type { Vector2 } from "../core/vector2.js";
import type { StaticAabb2dIndex } from "../index2d/staticAabb2dIndex.js";
import type { PlineSegIntr } from "./plineSegIntersect.js";
import type { PlineVertex } from "./plineVertex.js";
import type { PlineViewData } from "./plineView.js";

/** Represents the orientation of a polyline. */
export type PlineOrientation =
  /** Polyline is open. */
  | "open"
  /** Polyline is closed and directionally clockwise. */
  | "clockwise"
  /** Polyline is closed and directionally counter clockwise. */
  | "counterClockwise";

/** Result from calling `PlineSource.closestPoint`. */
export interface ClosestPointResult {
  /** The start vertex index of the closest segment. */
  segStartIndex: number;
  /** The closest point on the closest segment. */
  segPoint: Vector2;
  /** The distance between the points. */
  distance: number;
}

/** Struct to hold options parameters when performing polyline offset. */
export interface PlineOffsetOptions {
  /**
   * Spatial index of all the polyline segment bounding boxes (or boxes no smaller, e.g. using
   * `PlineSource.createApproxAabbIndex` is valid). If `null` is given then it will be
   * computed internally. `PlineSource.createApproxAabbIndex` or
   * `PlineSource.createAabbIndex` may be used to create the spatial index, the only
   * restriction is that the spatial index bounding boxes must be at least big enough to contain
   * the segments.
   */
  aabbIndex?: StaticAabb2dIndex | null;
  /**
   * If true then self intersects will be properly handled by the offset algorithm, if false then
   * self intersecting polylines may not offset correctly. Handling self intersects of closed
   * polylines requires more memory and computation.
   */
  handleSelfIntersects?: boolean;
  /** Fuzzy comparison epsilon used for determining if two positions are equal. */
  posEqualEps?: number;
  /**
   * Fuzzy comparison epsilon used for determining if two positions are equal when stitching
   * polyline slices together.
   */
  sliceJoinEps?: number;
  /**
   * Fuzzy comparison epsilon used when testing distance of slices to original polyline for
   * validity.
   */
  offsetDistEps?: number;
}

/** Default values for `PlineOffsetOptions` (Rust `PlineOffsetOptions::new`/`Default`). */
export function defaultPlineOffsetOptions(): Required<PlineOffsetOptions> {
  return {
    aabbIndex: null,
    handleSelfIntersects: false,
    posEqualEps: 1e-5,
    sliceJoinEps: 1e-4,
    offsetDistEps: 1e-4,
  };
}

// The containment functions use the same underlying mechinsims as the boolean functions.
/** Information about what happened during the boolean operation. */
export type PlineContainsResult =
  /** Input was not valid to perform containment test operation. */
  | "invalidInput"
  /** Pline1 entirely inside of pline2 with no intersects. */
  | "pline1InsidePline2"
  /** Pline2 entirely inside of pline1 with no intersects. */
  | "pline2InsidePline1"
  /** Pline1 is disjoint from pline2 (no intersects and neither polyline is inside of the other). */
  | "disjoint"
  /** Pline1 intersects with pline2 in at least one place. */
  | "intersected";

export interface PlineContainsOptions {
  /** Spatial index for `self`. */
  pline1AabbIndex?: StaticAabb2dIndex | null;
  /** Fuzzy comparison epsilon used for determining if two positions are equal. */
  posEqualEps?: number;
}

/** Default values for `PlineContainsOptions` (Rust `PlineContainsOptions::new`/`Default`). */
export function defaultPlineContainsOptions(): Required<PlineContainsOptions> {
  return {
    pline1AabbIndex: null,
    posEqualEps: 1e-5,
  };
}

/** Boolean operation to apply to polylines. */
export type BooleanOp =
  /** Return the union of the polylines. */
  | "or"
  /** Return the intersection of the polylines. */
  | "and"
  /** Return the exclusion of a polyline from another. */
  | "not"
  /** Exclusive OR between polylines. */
  | "xor";

/** Represents one of the polyline results from a boolean operation between two polylines. */
export interface BooleanResultPline<P> {
  /** Resultant polyline. */
  pline: P;
  /**
   * Slices that were stitched together to form the `pline` result. If boolean result info is not
   * `"intersected"` this collection may be empty.
   */
  subslices: BooleanPlineSlice[];
}

/** Information about what happened during the boolean operation. */
export type BooleanResultInfo =
  /** Input was not valid to perform boolean operation. */
  | "invalidInput"
  /** Pline1 entirely inside of pline2 with no intersects. */
  | "pline1InsidePline2"
  /** Pline2 entirely inside of pline1 with no intersects. */
  | "pline2InsidePline1"
  /** Pline1 is disjoint from pline2 (no intersects and neither polyline is inside of the other). */
  | "disjoint"
  /** Pline1 exactly overlaps pline2 (same geometric path). */
  | "overlapping"
  /** Pline1 intersects with pline2 but is not exactly overlapping with the same geometric path. */
  | "intersected";

/** Result of performing a boolean operation between two polylines. */
export interface BooleanResult<P> {
  /** Positive remaining space polylines. */
  posPlines: BooleanResultPline<P>[];
  /** Negative subtracted space polylines. */
  negPlines: BooleanResultPline<P>[];
  /** Information about what happened during the boolean operation. */
  resultInfo: BooleanResultInfo;
}

/** Construct an empty `BooleanResult` (Rust `BooleanResult::empty`). */
export function emptyBooleanResult<P>(resultInfo: BooleanResultInfo): BooleanResult<P> {
  return {
    posPlines: [],
    negPlines: [],
    resultInfo,
  };
}

/**
 * Construct a `BooleanResult` from whole polylines with no subslices
 * (Rust `BooleanResult::from_whole_plines`).
 */
export function booleanResultFromWholePlines<P>(
  posPlines: Iterable<P>,
  negPlines: Iterable<P>,
  resultInfo: BooleanResultInfo,
): BooleanResult<P> {
  const result: BooleanResult<P> = {
    posPlines: [],
    negPlines: [],
    resultInfo,
  };
  for (const p of posPlines) {
    result.posPlines.push({ pline: p, subslices: [] });
  }
  for (const p of negPlines) {
    result.negPlines.push({ pline: p, subslices: [] });
  }
  return result;
}

export interface PlineBooleanOptions {
  /** Spatial index for `self` or first polyline argument for the boolean operation. */
  pline1AabbIndex?: StaticAabb2dIndex | null;
  /** Fuzzy comparison epsilon used for determining if two positions are equal. */
  posEqualEps?: number;
  /**
   * If not `null` then this epsilon value is used to determine if a result polyline is collapsed,
   * that is has no area according to abs(area) < eps. Polylines that are collapsed will not be
   * included in the result. This is useful to avoid inconsistent results due to floating point
   * thresholding, or if you just don't want ever want collapsed polylines in the result.
   */
  collapsedAreaEps?: number | null;
}

/** Default values for `PlineBooleanOptions` (Rust `PlineBooleanOptions::new`/`Default`). */
export function defaultPlineBooleanOptions(): Required<PlineBooleanOptions> {
  return {
    pline1AabbIndex: null,
    posEqualEps: 1e-5,
    collapsedAreaEps: null,
  };
}

/** Enum to control which self intersects to include. */
export type SelfIntersectsInclude =
  /** Include all (local and global) self intersects. */
  | "all"
  /** Include only local self intersects (defined as being between two adjacent polyline
   * segments). */
  | "local"
  /** Include only global self intersects (defined as being between two non-adjacent polyline
   * segments). */
  | "global";

export interface PlineSelfIntersectOptions {
  /** Spatial index for the polyline. */
  aabbIndex?: StaticAabb2dIndex | null;
  /** Fuzzy comparison epsilon used for determining if two positions are equal. */
  posEqualEps?: number;
  /**
   * Controls whether to include all (local + global), only local, or only global self
   * intersects.
   */
  include?: SelfIntersectsInclude;
}

/**
 * Default values for `PlineSelfIntersectOptions`
 * (Rust `PlineSelfIntersectOptions::new`/`Default`).
 */
export function defaultPlineSelfIntersectOptions(): Required<PlineSelfIntersectOptions> {
  return {
    aabbIndex: null,
    posEqualEps: 1e-5,
    include: "all",
  };
}

export interface FindIntersectsOptions {
  /** Spatial index for `self` or first polyline argument to find intersects. */
  pline1AabbIndex?: StaticAabb2dIndex | null;
  /** Fuzzy comparison epsilon used for determining if two positions are equal. */
  posEqualEps?: number;
}

/** Default values for `FindIntersectsOptions` (Rust `FindIntersectsOptions::new`/`Default`). */
export function defaultFindIntersectsOptions(): Required<FindIntersectsOptions> {
  return {
    pline1AabbIndex: null,
    posEqualEps: 1e-5,
  };
}

/** Represents a polyline intersect at a single point. */
export interface PlineBasicIntersect {
  /** Starting vertex index of the first polyline segment involved in the intersect. */
  startIndex1: number;
  /** Starting vertex index of the second polyline segment involved in the intersect. */
  startIndex2: number;
  /** Point at which the intersect occurs. */
  point: Vector2;
}

/** Represents an overlapping polyline intersect segment. */
export interface PlineOverlappingIntersect {
  /** Starting vertex index of the first polyline segment involved in the overlapping intersect. */
  startIndex1: number;
  /** Starting vertex index of the second polyline segment involved in the intersect. */
  startIndex2: number;
  /** First end point of the overlapping intersect (closest to the second segment start). */
  point1: Vector2;
  /** Second end point of the overlapping intersect (furthest from the second segment start). */
  point2: Vector2;
}

/**
 * Represents a polyline intersect that may be either a `PlineBasicIntersect` or
 * `PlineOverlappingIntersect` (Rust `PlineIntersect` enum).
 */
export type PlineIntersect =
  | ({ kind: "basic" } & PlineBasicIntersect)
  | ({ kind: "overlapping" } & PlineOverlappingIntersect);

/**
 * Visitor for polyline intersects (Rust `PlineIntersectVisitor` trait); return `false`
 * to break/stop visiting.
 */
export type PlineIntersectVisitor = (intersect: PlineIntersect) => VisitResult;

/**
 * Simple struct that bundles up the context information for visiting intersections of two
 * polylines. Note: two of these are used when making a visit, one for each polyline.
 */
export interface PlineIntersectVisitContext {
  vertexIndex: number;
  v1: PlineVertex;
  v2: PlineVertex;
}

/**
 * Visitor used to visit intersections of two plines (Rust `TwoPlinesIntersectVisitor` trait);
 * return `false` to break/stop visiting.
 */
export type TwoPlinesIntersectVisitor = (
  intersect: PlineSegIntr,
  pline1Context: PlineIntersectVisitContext,
  pline2Context: PlineIntersectVisitContext,
) => VisitResult;

/**
 * Visitor for polyline vertexes (Rust `PlineVertexVisitor` trait); return `false` to
 * break/stop visiting.
 */
export type PlineVertexVisitor = (vertex: PlineVertex) => VisitResult;

/**
 * Visitor for polyline segments — two consecutive vertexes (Rust `PlineSegVisitor` trait);
 * return `false` to break/stop visiting.
 */
export type PlineSegVisitor = (v1: PlineVertex, v2: PlineVertex) => VisitResult;

/** Represents a collection of basic and overlapping polyline intersects. */
export interface PlineIntersectsCollection {
  basicIntersects: PlineBasicIntersect[];
  overlappingIntersects: PlineOverlappingIntersect[];
}

/** Construct an empty `PlineIntersectsCollection` (Rust `PlineIntersectsCollection::new_empty`). */
export function emptyPlineIntersectsCollection(): PlineIntersectsCollection {
  return {
    basicIntersects: [],
    overlappingIntersects: [],
  };
}

/**
 * Result of `PlineSource.findPointAtPathLength` (Rust `Result<(usize, Vector2<T>), T>`).
 *
 * `{ ok: true, segIndex, point }` maps to Rust `Ok((seg_index, point))` and
 * `{ ok: false, pathLength }` maps to Rust `Err(total_path_length)`.
 */
export type FindPointAtPathLengthResult =
  | { readonly ok: true; readonly segIndex: number; readonly point: Vector2 }
  | { readonly ok: false; readonly pathLength: number };

/** Open polyline slice created in the process of performing a polyline boolean operation. */
export interface BooleanPlineSlice {
  /**
   * View data for the slice, can be used with source polyline to form a view of the vertexes for
   * the slice.
   */
  viewData: PlineViewData;
  /**
   * If true then the source polyline for this slice is pline1 from the boolean operation
   * otherwise it is pline2.
   */
  sourceIsPline1: boolean;
  /**
   * Whether the slice is an overlapping slice or not (both polylines in the boolean operation
   * overlapped along this slice).
   */
  overlapping: boolean;
}
