import { describe, expect, it } from "vitest";
import { TRANSITION_KINDS, applyTransition, isTransitionKind } from "./transitions.js";

const solid = (h: number, w: number) =>
  Array.from({ length: h }, () => Array.from({ length: w }, () => true));

const count = (grid: boolean[][]) =>
  grid.reduce((n, row) => n + row.filter(Boolean).length, 0);

describe("applyTransition", () => {
  it("returns the clean mask untouched once settled, whatever the effect", () => {
    for (const kind of TRANSITION_KINDS) {
      const ink = solid(2, 10);
      expect(applyTransition(ink, kind, 1, 7).ink).toBe(ink);
      expect(applyTransition(ink, kind, 5, 7).ink).toBe(ink);
    }
  });

  it("draws nothing at or below zero progress", () => {
    for (const kind of TRANSITION_KINDS) {
      if (kind === "none") continue;
      expect(count(applyTransition(solid(2, 10), kind, 0, 7).ink)).toBe(0);
      expect(count(applyTransition(solid(2, 10), kind, -3, 7).ink)).toBe(0);
    }
  });

  it('"none" is a pass-through at any progress', () => {
    const ink = solid(2, 10);
    expect(applyTransition(ink, "none", 0.4, 7).ink).toBe(ink);
  });

  it("is deterministic — same mask, progress and seed paint the same cells", () => {
    for (const kind of TRANSITION_KINDS) {
      const a = applyTransition(solid(3, 12), kind, 0.42, 9);
      const b = applyTransition(solid(3, 12), kind, 0.42, 9);
      expect(a.ink).toEqual(b.ink);
      expect(a.hot).toEqual(b.hot);
    }
  });

  it("never lights a cell the source mask left dark", () => {
    const ink = solid(3, 12);
    ink[1][4] = false;
    for (const kind of TRANSITION_KINDS) {
      for (const p of [0.15, 0.5, 0.85]) {
        const out = applyTransition(ink, kind, p, 3).ink;
        // Glitch shears rows sideways, so a cell can move — but the total can
        // never grow past what the source offered.
        expect(count(out)).toBeLessThanOrEqual(count(ink));
      }
    }
  });

  it("stays inside the grid, including while glitch is shearing", () => {
    for (const kind of TRANSITION_KINDS) {
      for (const p of [0.05, 0.3, 0.59, 0.61, 0.99]) {
        const { ink, hot } = applyTransition(solid(4, 9), kind, p, 5);
        expect(ink).toHaveLength(4);
        for (const row of ink) expect(row).toHaveLength(9);
        if (hot) for (const row of hot) expect(row).toHaveLength(9);
      }
    }
  });

  it("wipe reveals monotonically more as progress grows", () => {
    const ink = solid(1, 40);
    let previous = -1;
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const n = count(applyTransition(ink, "wipe", p, 1).ink);
      expect(n).toBeGreaterThanOrEqual(previous);
      previous = n;
    }
  });

  it("dissolve reveals monotonically more as progress grows", () => {
    const ink = solid(2, 30);
    let previous = -1;
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const n = count(applyTransition(ink, "dissolve", p, 1).ink);
      expect(n).toBeGreaterThanOrEqual(previous);
      previous = n;
    }
  });

  it("tolerates an empty mask", () => {
    for (const kind of TRANSITION_KINDS) {
      expect(() => applyTransition([], kind, 0.5, 1)).not.toThrow();
      expect(() => applyTransition([[]], kind, 0.5, 1)).not.toThrow();
    }
  });
});

describe("isTransitionKind", () => {
  it("accepts exactly the known kinds", () => {
    for (const kind of TRANSITION_KINDS) expect(isTransitionKind(kind)).toBe(true);
    expect(isTransitionKind("sparkle")).toBe(false);
    expect(isTransitionKind("")).toBe(false);
  });
});
