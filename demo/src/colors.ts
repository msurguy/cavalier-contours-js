/** Drafting palette — keep in sync with the CSS custom properties in style.css. */
export const COLORS = {
  /** Source/input geometry (blueprint cyan-white). */
  src: "#6fd7ff",
  srcDim: "rgba(111, 215, 255, 0.34)",
  /** Offset results keeping source orientation (drafting amber). */
  offset: "#ffb454",
  /** Offset results with flipped orientation. */
  reversed: "#ff5d8f",
  /** Raw offset intermediates (violet). */
  raw: "#b18cff",
  /** Collapsed raw arcs / warnings. */
  collapsed: "#ff4d5e",
  /** Boolean second input. */
  plineB: "#5affc3",
  plineBDim: "rgba(90, 255, 195, 0.34)",
  /** Boolean result fill/stroke. */
  resultFill: "rgba(255, 180, 84, 0.16)",
  resultPos: "#ffb454",
  resultNeg: "#ff5d8f",
  /** Vertex handles. */
  vertex: "#e8f4ff",
  /** Hatch loops. */
  hatch: "#ffb454",
  grid: {
    minor: "rgba(84, 140, 190, 0.10)",
    major: "rgba(84, 140, 190, 0.20)",
    axisX: "rgba(111, 215, 255, 0.28)",
    axisY: "rgba(111, 215, 255, 0.28)",
  },
} as const;
