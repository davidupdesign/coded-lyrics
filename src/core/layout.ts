/**
 * Choosing the grid.
 *
 * A terminal hands you its size and you live with it. A browser is the other
 * way round: the cell size is ours to pick, which is what lets the picture get
 * far finer than any terminal font would allow — but it also means nothing
 * stops us from picking a grid that spills off the page.
 *
 * The rule that prevents that is to derive the grid *from* an integer cell size
 * that already fits, never to pick a grid and then hope the cells divide
 * evenly. `cols * cellW <= availableWidth` then holds by construction rather
 * than by rounding luck, and the few leftover pixels become a margin. That
 * property is the point of this module and is what its tests assert.
 */

export type GridMode = "preset" | "cellPx" | "autoFit";
export type FitMode = "fill" | "letterbox";
export type DprMode = "css" | "native" | "2x";
export type DensityPreset = "tiny" | "small" | "medium" | "large" | "huge" | "extreme";

/** Column counts each preset aims for. */
export const DENSITY_PRESETS: Record<DensityPreset, number> = {
  tiny: 80,
  small: 120,
  medium: 160,
  large: 240,
  huge: 320,
  extreme: 480,
};

export const DENSITY_ORDER: readonly DensityPreset[] = [
  "tiny", "small", "medium", "large", "huge", "extreme",
];

/** Below this a cell cannot carry a legible glyph at any font size. */
const MIN_CELL = 2;

/** Cell shapes worth snapping to: a terminal cell, and a square one. */
export const CELL_ASPECT_TERMINAL = 2;
export const CELL_ASPECT_SQUARE = 1;

export interface GridOptions {
  mode: GridMode;
  preset: DensityPreset;
  /** Target cell width in CSS pixels, for `mode: "cellPx"`. */
  cellPx: number;
  /** Legibility floor for `mode: "autoFit"`, in CSS pixels. */
  autoFitMinCellPx: number;
  /** Cell height ÷ cell width. 2 reads as a terminal, 1 resolves the most detail. */
  cellAspect: number;
  fit: FitMode;
  /** Width ÷ height to letterbox to, e.g. 16/9. Ignored when `fit` is "fill". */
  lockAspect: number | null;
  dprMode: DprMode;
  /** Hard ceiling on cell count, protecting the frame budget. */
  maxCells: number;
  /** Rows the compositor reserves at the bottom. */
  footerRows: number;
  /** Ceiling on cell size imposed by the glyph atlas's memory budget. */
  maxCellPx?: number;
}

export interface GridSpec {
  cols: number;
  rows: number;
  /** Device pixels. */
  cellW: number;
  cellH: number;
  /** Canvas backing store, exactly `cols * cellW` by `rows * cellH`. */
  canvasW: number;
  canvasH: number;
  /** CSS size to set on the element. Never larger than the box it was given. */
  cssW: number;
  cssH: number;
  dpr: number;
  /** Achieved aspect, which rounding may move slightly off the request. */
  cellAspect: number;
  cells: number;
}

export const DEFAULT_GRID_OPTIONS: GridOptions = {
  mode: "preset",
  preset: "small",
  cellPx: 10,
  autoFitMinCellPx: 6,
  cellAspect: CELL_ASPECT_TERMINAL,
  fit: "fill",
  lockAspect: null,
  dprMode: "native",
  maxCells: 60_000,
  footerRows: 2,
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function resolveDpr(mode: DprMode, devicePixelRatio: number): number {
  if (mode === "css") return 1;
  if (mode === "2x") return 2;
  return clamp(devicePixelRatio || 1, 1, 4);
}

/** Columns the mode asks for, before anything is allowed to veto it. */
function targetCols(boxCssW: number, o: GridOptions): number {
  switch (o.mode) {
    case "preset":
      return DENSITY_PRESETS[o.preset] ?? DENSITY_PRESETS.small;
    case "cellPx":
      return Math.max(1, Math.floor(boxCssW / Math.max(1, o.cellPx)));
    case "autoFit":
      return Math.max(1, Math.floor(boxCssW / Math.max(1, o.autoFitMinCellPx)));
  }
}

/**
 * Fit a grid into `boxCssW × boxCssH` CSS pixels.
 *
 * `devicePixelRatio` is passed in rather than read from the environment so this
 * stays pure and testable — the caller supplies whatever the display reports.
 */
export function computeGrid(
  boxCssW: number,
  boxCssH: number,
  o: GridOptions,
  devicePixelRatio = 1,
): GridSpec {
  // 1. The box we are allowed to fill, letterboxed if an aspect is locked.
  let boxW = Math.max(1, boxCssW);
  let boxH = Math.max(1, boxCssH);
  if (o.fit === "letterbox" && o.lockAspect && o.lockAspect > 0) {
    if (boxW / boxH > o.lockAspect) boxW = boxH * o.lockAspect;
    else boxH = boxW / o.lockAspect;
  }

  // 2. The same box in device pixels, which is what the canvas is measured in.
  const dpr = resolveDpr(o.dprMode, devicePixelRatio);
  const W = Math.max(MIN_CELL, Math.floor(boxW * dpr));
  const H = Math.max(MIN_CELL, Math.floor(boxH * dpr));

  const aspect = clamp(o.cellAspect || CELL_ASPECT_TERMINAL, 0.25, 6);

  // 3. An integer cell that fits, honouring the atlas budget if one was given.
  let cellW = Math.max(MIN_CELL, Math.floor(W / targetCols(boxW, o)));
  if (o.maxCellPx && o.maxCellPx >= MIN_CELL) cellW = Math.min(cellW, o.maxCellPx);

  // 4. Grow the cell until the grid is inside the cell budget. Solving for it
  //    directly gets within a step or two, so the loop is a rounding fix-up
  //    rather than a search: cols*rows ≈ W*H / (cellW² * aspect).
  const budget = Math.max(1, o.maxCells);
  const analytic = Math.ceil(Math.sqrt((W * H) / (budget * aspect)));
  cellW = Math.max(cellW, analytic);

  let cellH = 0;
  let cols = 0;
  let rows = 0;
  for (let guard = 0; guard < 64; guard++) {
    cellW = clamp(cellW, MIN_CELL, W);
    cellH = clamp(Math.round(cellW * aspect), MIN_CELL, H);
    // 5. The grid follows from the cell, never the other way round. This is
    //    what makes the fit exact instead of approximate.
    cols = Math.max(1, Math.floor(W / cellW));
    rows = Math.max(1, Math.floor(H / cellH));
    if (cols * rows <= budget || cellW >= W) break;
    cellW++;
  }

  const canvasW = cols * cellW;
  const canvasH = rows * cellH;

  return {
    cols,
    rows,
    cellW,
    cellH,
    canvasW,
    canvasH,
    cssW: canvasW / dpr,
    cssH: canvasH / dpr,
    dpr,
    cellAspect: cellH / cellW,
    cells: cols * rows,
  };
}

/** Step a density preset up or down, stopping at the ends. */
export function stepPreset(preset: DensityPreset, delta: number): DensityPreset {
  const i = DENSITY_ORDER.indexOf(preset);
  return DENSITY_ORDER[clamp(i + delta, 0, DENSITY_ORDER.length - 1)];
}
