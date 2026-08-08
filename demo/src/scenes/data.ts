/**
 * Default demo geometry, copied verbatim from the original Rust egui demo app:
 *
 * - `offsetSceneDefault`  → cavalier_contours_ui/src/scenes/pline_offset_scene.rs
 * - `booleanSceneDefaults`→ cavalier_contours_ui/src/scenes/pline_boolean_scene.rs
 * - `shapeSceneDefaults`  → cavalier_contours_ui/src/scenes/multi_pline_offset_scene.rs
 *
 * Vertex format is (x, y, bulge) where bulge = tan(θ/4) of the arc segment
 * starting at that vertex (0 = straight line, 1 = half circle CCW).
 */
import { plineClosed, type Polyline } from "cavalier-contours-js";

/** The classic cavalier_contours demo blob with mixed line + arc segments. */
export function offsetSceneDefault(): Polyline {
  return plineClosed([
    [10.0, 10.0, -0.5],
    [8.0, 9.0, 0.374794619217547],
    [21.0, 0.0, 0.0],
    [23.0, 0.0, 1.0],
    [32.0, 0.0, -0.5],
    [28.0, 0.0, 0.5],
    [39.0, 21.0, 0.0],
    [28.0, 12.0, 0.5],
  ]);
}

/** Two overlapping arc-heavy blobs; the second is scaled to 50% like the Rust demo. */
export function booleanSceneDefaults(): [Polyline, Polyline] {
  const pline1 = plineClosed([
    [10.0, 10.0, -0.5],
    [0.3, 1.0, 0.374794619217547],
    [21.0, 0.0, 0.0],
    [23.0, 0.0, 1.0],
    [32.0, 0.0, -0.5],
    [28.0, 0.0, 0.5],
    [39.0, 21.0, 0.0],
    [28.0, 12.0, 0.5],
  ]);
  const pline2 = plineClosed([
    [10.0, 10.0, -0.5],
    [8.0, 9.0, 0.374794619217547],
    [21.0, 0.0, 0.0],
    [23.0, 0.0, 1.0],
    [32.0, 0.0, -0.5],
    [28.0, 0.0, 0.5],
    [38.0, 19.0, 0.0],
    [28.0, 12.0, 0.5],
  ]);
  pline2.scaleMut(0.5);
  return [pline1, pline2];
}

/** Outer boundary (CCW) plus four holes, from the Rust multi polyline offset scene. */
export function shapeSceneDefaults(): Polyline[] {
  return [
    plineClosed([
      [100.0, 100.0, -0.5],
      [80.0, 90.0, 0.374794619217547],
      [210.0, 0.0, 0.0],
      [230.0, 0.0, 1.0],
      [320.0, 0.0, -0.5],
      [280.0, 0.0, 0.5],
      [390.0, 210.0, 0.0],
      [280.0, 120.0, 0.5],
    ]),
    plineClosed([
      [150.0, 50.0, 0.0],
      [150.0, 100.0, 0.0],
      [223.74732137849435, 142.16931273980475, 0.0],
      [199.491310072685, 52.51543504258919, 0.5],
    ]),
    plineClosed([
      [261.11232783167395, 35.79686193615828, -1.0],
      [250.0, 100.0, -1.0],
    ]),
    plineClosed([
      [320.5065990423979, 76.14222955572362, -1.0],
      [320.2986109239592, 103.52378781211337, 0.0],
    ]),
    plineClosed([
      [273.6131273938006, -13.968608715397636, -0.3],
      [256.61336060995995, -25.49387433156079, 0.0],
      [249.69820124026208, 27.234215862385582, 0.0],
    ]),
  ];
}

/** Hatch scene outline: the same demo blob (closed, arc-heavy, plotter friendly). */
export function hatchSceneDefault(): Polyline {
  return offsetSceneDefault();
}
