import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRID_OPTIONS,
  DENSITY_ORDER,
  DENSITY_PRESETS,
  computeGrid,
  stepPreset,
  type GridOptions,
} from "./layout.js";

const opts = (patch: Partial<GridOptions> = {}): GridOptions => ({
  ...DEFAULT_GRID_OPTIONS,
  ...patch,
});

/** Deterministic pseudo-random source, so a failure is always reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("computeGrid — the no-overflow invariant", () => {
  it("never produces a canvas larger than the box it was given", () => {
    const rand = rng(20260809);
    const modes = ["preset", "cellPx", "autoFit"] as const;
    const fits = ["fill", "letterbox"] as const;
    const dprs = ["css", "native", "2x"] as const;

    for (let i = 0; i < 800; i++) {
      const boxW = 1 + Math.floor(rand() * 4000);
      const boxH = 1 + Math.floor(rand() * 3000);
      const dpr = [1, 1.5, 2, 2.5, 3][Math.floor(rand() * 5)];
      const o = opts({
        mode: modes[Math.floor(rand() * modes.length)],
        preset: DENSITY_ORDER[Math.floor(rand() * DENSITY_ORDER.length)],
        cellPx: 1 + Math.floor(rand() * 48),
        autoFitMinCellPx: 1 + Math.floor(rand() * 20),
        cellAspect: 0.5 + rand() * 3,
        fit: fits[Math.floor(rand() * fits.length)],
        lockAspect: [null, 16 / 9, 4 / 3, 1, 9 / 16][Math.floor(rand() * 5)],
        dprMode: dprs[Math.floor(rand() * dprs.length)],
        maxCells: 500 + Math.floor(rand() * 120_000),
      });

      const g = computeGrid(boxW, boxH, o, dpr);
      const where = `box=${boxW}x${boxH} dpr=${dpr} ${JSON.stringify(o)}`;

      // The canvas fits inside the box, in device pixels and in CSS pixels.
      expect(g.canvasW, where).toBeLessThanOrEqual(Math.floor(boxW * g.dpr));
      expect(g.canvasH, where).toBeLessThanOrEqual(Math.floor(boxH * g.dpr));
      expect(g.cssW, where).toBeLessThanOrEqual(boxW + 1e-9);
      expect(g.cssH, where).toBeLessThanOrEqual(boxH + 1e-9);

      // The canvas is exactly a whole number of cells.
      expect(g.canvasW, where).toBe(g.cols * g.cellW);
      expect(g.canvasH, where).toBe(g.rows * g.cellH);

      // And the grid is usable and inside its budget.
      expect(g.cols, where).toBeGreaterThanOrEqual(1);
      expect(g.rows, where).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(g.cellW), where).toBe(true);
      expect(Number.isInteger(g.cellH), where).toBe(true);
      expect(g.cells, where).toBeLessThanOrEqual(o.maxCells);
    }
  });

  it("holds at degenerate box sizes", () => {
    for (const [w, h] of [[1, 1], [1, 2000], [2000, 1], [3, 5], [0, 0]]) {
      const g = computeGrid(w, h, opts(), 2);
      expect(g.cols).toBeGreaterThanOrEqual(1);
      expect(g.rows).toBeGreaterThanOrEqual(1);
      expect(g.canvasW).toBeLessThanOrEqual(Math.max(2, Math.floor(Math.max(1, w) * 2)));
      expect(g.canvasH).toBeLessThanOrEqual(Math.max(2, Math.floor(Math.max(1, h) * 2)));
    }
  });
});

describe("computeGrid — density", () => {
  it("hits the preset's column count when there is room", () => {
    for (const preset of DENSITY_ORDER) {
      const g = computeGrid(1920, 1080, opts({ preset, maxCells: 1e9 }), 1);
      // Integer cells mean the count lands at or just above the target, never
      // below it — a wider cell would have fitted fewer columns than asked.
      expect(g.cols).toBeGreaterThanOrEqual(DENSITY_PRESETS[preset]);
      expect(g.cols).toBeLessThan(DENSITY_PRESETS[preset] * 2);
    }
  });

  it("denser presets really do resolve more cells", () => {
    let previous = 0;
    for (const preset of DENSITY_ORDER) {
      const g = computeGrid(1920, 1080, opts({ preset, maxCells: 1e9 }), 1);
      expect(g.cells).toBeGreaterThan(previous);
      previous = g.cells;
    }
  });

  it("backs the grid off rather than exceeding the cell budget", () => {
    const g = computeGrid(3840, 2160, opts({ preset: "extreme", maxCells: 20_000 }), 2);
    expect(g.cells).toBeLessThanOrEqual(20_000);
    expect(g.cols).toBeLessThan(DENSITY_PRESETS.extreme);
  });

  it("cellPx mode lands near the requested cell size", () => {
    const g = computeGrid(1000, 600, opts({ mode: "cellPx", cellPx: 10 }), 1);
    expect(g.cellW).toBe(10);
    expect(g.cols).toBe(100);
  });

  it("autoFit fills the box down to the legibility floor", () => {
    const g = computeGrid(1200, 800, opts({ mode: "autoFit", autoFitMinCellPx: 8, maxCells: 1e9 }), 1);
    expect(g.cellW).toBeGreaterThanOrEqual(8);
    expect(g.cols).toBeLessThanOrEqual(150);
  });
});

describe("computeGrid — shape", () => {
  it("square cells give roughly twice the rows of terminal cells", () => {
    const term = computeGrid(1600, 900, opts({ cellAspect: 2, maxCells: 1e9 }), 1);
    const square = computeGrid(1600, 900, opts({ cellAspect: 1, maxCells: 1e9 }), 1);
    expect(square.rows / term.rows).toBeGreaterThan(1.8);
    expect(square.cols).toBe(term.cols);
  });

  it("letterboxing to 16:9 leaves the canvas at that ratio", () => {
    const g = computeGrid(1600, 1200, opts({ fit: "letterbox", lockAspect: 16 / 9, maxCells: 1e9 }), 1);
    expect(g.cssW / g.cssH).toBeGreaterThan(1.6);
    expect(g.cssW / g.cssH).toBeLessThan(1.85);
    expect(g.cssH).toBeLessThan(1200);
  });

  it("letterboxing to a portrait ratio constrains the width instead", () => {
    const g = computeGrid(1600, 1200, opts({ fit: "letterbox", lockAspect: 9 / 16, maxCells: 1e9 }), 1);
    expect(g.cssW).toBeLessThan(1600);
    expect(g.cssW / g.cssH).toBeLessThan(0.7);
  });

  it("device pixel ratio buys resolution without changing the CSS footprint", () => {
    const one = computeGrid(1000, 600, opts({ dprMode: "css", maxCells: 1e9 }), 3);
    const three = computeGrid(1000, 600, opts({ dprMode: "native", maxCells: 1e9 }), 3);
    expect(three.dpr).toBe(3);
    expect(three.canvasW).toBeGreaterThan(one.canvasW);
    expect(three.cssW).toBeLessThanOrEqual(1000);
  });

  it("respects an atlas memory ceiling on cell size", () => {
    const g = computeGrid(1920, 1080, opts({ mode: "cellPx", cellPx: 40, maxCellPx: 12 }), 1);
    expect(g.cellW).toBeLessThanOrEqual(12);
  });
});

describe("stepPreset", () => {
  it("moves through the ladder and stops at the ends", () => {
    expect(stepPreset("tiny", -1)).toBe("tiny");
    expect(stepPreset("tiny", 1)).toBe("small");
    expect(stepPreset("extreme", 1)).toBe("extreme");
    expect(stepPreset("medium", -1)).toBe("small");
  });
});
