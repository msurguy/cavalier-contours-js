/**
 * App shell: scene switcher, sidebar, canvas render loop, pointer interaction
 * (vertex/geometry drag, pan, cursor-anchored wheel zoom), stats + HUD.
 */
import "./style.css";
import { COLORS } from "./colors";
import { View, drawGrid } from "./view";
import type { DragHandle, Scene, SceneEnv, StatRow } from "./scenes/types";
import { OffsetScene } from "./scenes/offsetScene";
import { BooleanScene } from "./scenes/booleanScene";
import { ShapeScene } from "./scenes/shapeScene";
import { HatchScene } from "./scenes/hatchScene";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const viewportEl = document.getElementById("viewport")!;
const tabsEl = document.getElementById("scene-tabs")!;
const blurbEl = document.getElementById("scene-blurb")!;
const controlsEl = document.getElementById("controls")!;
const statsEl = document.getElementById("stats")!;
const warningEl = document.getElementById("warning-badge")!;
const warningTextEl = document.getElementById("warning-text")!;
const hudCoordsEl = document.getElementById("hud-coords")!;
const hudZoomEl = document.getElementById("hud-zoom")!;
const fitBtn = document.getElementById("fit-btn")!;
const tbSceneEl = document.getElementById("tb-scene")!;
const tbSheetEl = document.getElementById("tb-sheet")!;

const view = new View();

let activeScene: Scene;
let renderQueued = false;

function requestRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    draw();
  });
}

function setStats(rows: StatRow[]): void {
  statsEl.replaceChildren(
    ...rows.flatMap((row) => {
      const dt = document.createElement("dt");
      dt.textContent = row.label;
      const dd = document.createElement("dd");
      dd.textContent = row.value;
      return [dt, dd];
    }),
  );
}

function setWarning(message: string | null): void {
  if (message) {
    warningTextEl.textContent = message;
    warningEl.hidden = false;
  } else {
    warningEl.hidden = true;
  }
}

/** Guarded recompute: a degenerate mid-drag polyline must never crash the app. */
function recomputeGuarded(): void {
  try {
    activeScene.recompute();
    setWarning(null);
  } catch (err) {
    setWarning("degenerate geometry — showing last valid result");
    // keep last good result; log for the curious
    console.warn("recompute failed:", err);
  }
  requestRender();
}

const env: SceneEnv = {
  requestRender,
  requestRecompute: recomputeGuarded,
  setStats,
  setWarning,
};

const scenes: Scene[] = [
  new OffsetScene(env),
  new BooleanScene(env),
  new ShapeScene(env),
  new HatchScene(env),
];

// ---------------------------------------------------------------------------
// Canvas sizing (devicePixelRatio aware)
// ---------------------------------------------------------------------------

function resizeCanvas(): void {
  const rect = viewportEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  view.width = rect.width;
  view.height = rect.height;
  view.dpr = dpr;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  requestRender();
}

new ResizeObserver(resizeCanvas).observe(viewportEl);

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function draw(): void {
  view.applyScreenTransform(ctx);
  ctx.clearRect(0, 0, view.width, view.height);
  drawGrid(ctx, view, COLORS.grid);
  activeScene.draw(ctx, view);
  view.applyScreenTransform(ctx);
  hudZoomEl.textContent = `${view.scale >= 100 ? view.scale.toFixed(0) : view.scale.toFixed(2)} px/u`;
}

// ---------------------------------------------------------------------------
// Scene switching
// ---------------------------------------------------------------------------

function fitView(): void {
  const box = activeScene.extents();
  if (box) {
    view.fit(box);
    requestRender();
  }
}

function activateScene(scene: Scene): void {
  activeScene = scene;
  blurbEl.textContent = scene.blurb;
  controlsEl.replaceChildren();
  scene.buildControls(controlsEl);
  tbSceneEl.textContent = scene.title.toUpperCase();
  tbSheetEl.textContent = `0${scenes.indexOf(scene) + 1} / 0${scenes.length}`;
  for (const [i, btn] of tabButtons.entries()) {
    btn.classList.toggle("active", scenes[i] === scene);
  }
  setWarning(null);
  recomputeGuarded();
  // fit after recompute so offset results are included in the extents
  fitView();
}

const tabButtons: HTMLButtonElement[] = scenes.map((scene, i) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "scene-tab";
  const num = document.createElement("span");
  num.className = "tab-num";
  num.textContent = `0${i + 1}`;
  const label = document.createElement("span");
  label.textContent = scene.title;
  btn.append(num, label);
  btn.addEventListener("click", () => activateScene(scene));
  tabsEl.appendChild(btn);
  return btn;
});

// ---------------------------------------------------------------------------
// Pointer interaction
// ---------------------------------------------------------------------------

interface PointerState {
  drag: DragHandle | null;
  panning: boolean;
  lastX: number;
  lastY: number;
}

const pointer: PointerState = { drag: null, panning: false, lastX: 0, lastY: 0 };

/** Live screen positions of every pointer currently down on the canvas. */
const activePointers = new Map<number, { x: number; y: number }>();
/** Two-finger pinch state (distance + midpoint in screen px); null when < 2 pointers. */
let pinch: { dist: number; cx: number; cy: number } | null = null;

function canvasPos(e: PointerEvent | WheelEvent): [number, number] {
  const rect = canvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

/** Distance + midpoint of the first two active pointers. */
function pinchMetrics(): { dist: number; cx: number; cy: number } {
  const pts = [...activePointers.values()];
  const dx = pts[0]!.x - pts[1]!.x;
  const dy = pts[0]!.y - pts[1]!.y;
  return {
    dist: Math.hypot(dx, dy) || 1,
    cx: (pts[0]!.x + pts[1]!.x) / 2,
    cy: (pts[0]!.y + pts[1]!.y) / 2,
  };
}

function clearSinglePointer(): void {
  pointer.drag?.end?.();
  pointer.drag = null;
  pointer.panning = false;
  canvas.classList.remove("dragging-geometry", "panning");
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  const [sx, sy] = canvasPos(e);
  canvas.setPointerCapture(e.pointerId);
  activePointers.set(e.pointerId, { x: sx, y: sy });

  // Second finger down → enter pinch-zoom, abandoning any single-pointer drag/pan.
  if (activePointers.size === 2) {
    clearSinglePointer();
    pinch = pinchMetrics();
    return;
  }
  if (activePointers.size > 2) return;

  pointer.lastX = sx;
  pointer.lastY = sy;
  pointer.drag = e.button === 0 ? activeScene.hitTest(sx, sy, view) : null;
  pointer.panning = pointer.drag === null;
  canvas.classList.toggle("dragging-geometry", pointer.drag !== null);
  canvas.classList.toggle("panning", pointer.panning);
});

canvas.addEventListener("pointermove", (e) => {
  const [sx, sy] = canvasPos(e);
  if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: sx, y: sy });

  // Pinch-zoom (two fingers): scale about the midpoint and pan along with it.
  if (pinch && activePointers.size >= 2) {
    const m = pinchMetrics();
    view.zoomAt(m.cx, m.cy, m.dist / pinch.dist);
    view.panBy(m.cx - pinch.cx, m.cy - pinch.cy);
    pinch = m;
    requestRender();
    return;
  }

  const [wx, wy] = view.toWorld(sx, sy);
  hudCoordsEl.textContent = `x ${wx >= 0 ? "+" : ""}${wx.toFixed(3)}  y ${wy >= 0 ? "+" : ""}${wy.toFixed(3)}`;

  if (pointer.drag) {
    const [pwx, pwy] = view.toWorld(pointer.lastX, pointer.lastY);
    pointer.drag.move(wx, wy, wx - pwx, wy - pwy);
  } else if (pointer.panning) {
    view.panBy(sx - pointer.lastX, sy - pointer.lastY);
    requestRender();
  } else {
    // hover feedback
    canvas.classList.toggle("hover-geometry", activeScene.hitTest(sx, sy, view) !== null);
  }
  pointer.lastX = sx;
  pointer.lastY = sy;
});

function endPointer(e: PointerEvent): void {
  activePointers.delete(e.pointerId);
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

  if (activePointers.size >= 2) {
    pinch = pinchMetrics(); // still pinching with the remaining fingers
    return;
  }
  pinch = null;
  if (activePointers.size === 1) {
    // dropped from pinch to a single finger → keep panning, no jump
    const rem = [...activePointers.values()][0]!;
    pointer.drag = null;
    pointer.panning = true;
    pointer.lastX = rem.x;
    pointer.lastY = rem.y;
    canvas.classList.remove("dragging-geometry");
    canvas.classList.add("panning");
    return;
  }
  clearSinglePointer();
}

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const [sx, sy] = canvasPos(e);
    const factor = Math.exp(-e.deltaY * 0.0015);
    view.zoomAt(sx, sy, factor);
    requestRender();
  },
  { passive: false },
);

fitBtn.addEventListener("click", fitView);
window.addEventListener("keydown", (e) => {
  if (e.key === "f" || e.key === "F") {
    if (document.activeElement instanceof HTMLInputElement) return;
    fitView();
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

resizeCanvas();
activateScene(scenes[0]!);
