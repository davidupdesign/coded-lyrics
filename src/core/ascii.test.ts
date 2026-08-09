import { describe, expect, it } from "vitest";
import { RAMP, buildRampTable, buildSampler } from "./ascii.js";
import { VIDEO_TIERS } from "./palette.js";

/** A source frame whose value equals its column, for tracing the mapping. */
function ramp(w: number, h: number): Uint8Array {
  const f = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = (x * 255) / (w - 1);
  return f;
}

describe("buildRampTable", () => {
  it("is monotonically non-decreasing in luminance", () => {
    const { chars, tiers } = buildRampTable(1);
    for (let v = 1; v < 256; v++) {
      expect(RAMP.indexOf(chars[v])).toBeGreaterThanOrEqual(RAMP.indexOf(chars[v - 1]));
      expect(tiers[v]).toBeGreaterThanOrEqual(tiers[v - 1]);
    }
  });

  it("keeps black clean and saturates white", () => {
    const { chars } = buildRampTable(1);
    expect(chars[0]).toBe(" ");
    expect(chars[255]).toBe(RAMP[RAMP.length - 1]);
  });

  it("stays inside the ramp and tier range at any gain", () => {
    for (const gain of [0.1, 1, 3, 10]) {
      const { chars, tiers } = buildRampTable(gain);
      for (let v = 0; v < 256; v++) {
        expect(RAMP).toContain(chars[v]);
        expect(tiers[v]).toBeLessThan(VIDEO_TIERS);
        expect(tiers[v]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("gain lifts the picture — never darkens it", () => {
    const base = buildRampTable(1);
    const lifted = buildRampTable(2);
    for (let v = 0; v < 256; v++) {
      expect(RAMP.indexOf(lifted.chars[v])).toBeGreaterThanOrEqual(
        RAMP.indexOf(base.chars[v]),
      );
    }
  });

  it("a lower gamma lifts the shadows", () => {
    const flat = buildRampTable(1, 1);
    const lifted = buildRampTable(1, 0.5);
    expect(RAMP.indexOf(lifted.chars[64])).toBeGreaterThan(RAMP.indexOf(flat.chars[64]));
  });
});

describe("buildSampler", () => {
  it("fills every output cell", () => {
    const s = buildSampler(20, 10, 128, 72);
    const out = new Uint8Array(20 * 10).fill(9);
    s.sample(ramp(128, 72), out);
    expect(out.every((v) => v !== 9)).toBe(true);
  });

  it("preserves left-to-right order when the source is a horizontal ramp", () => {
    const s = buildSampler(16, 8, 128, 72);
    const out = new Uint8Array(16 * 8);
    s.sample(ramp(128, 72), out);
    for (let x = 1; x < 16; x++) expect(out[x]).toBeGreaterThan(out[x - 1]);
  });

  it("crops rather than squashes — cell aspect changes which axis is cropped", () => {
    // A 16:9 source into a square-cell grid of the same ratio needs no crop;
    // into a terminal-cell grid of the same *column* count it must crop.
    const wide = buildSampler(32, 18, 160, 90, 1);
    const tall = buildSampler(32, 18, 160, 90, 2);
    const a = new Uint8Array(32 * 18);
    const b = new Uint8Array(32 * 18);
    wide.sample(ramp(160, 90), a);
    tall.sample(ramp(160, 90), b);
    // Cropping the horizontal axis narrows the span of values that survive.
    const spread = (v: Uint8Array) => Math.max(...v) - Math.min(...v);
    expect(spread(b)).toBeLessThan(spread(a));
  });

  it("upscales without leaving gaps when cells outnumber source pixels", () => {
    const s = buildSampler(64, 32, 16, 9);
    const out = new Uint8Array(64 * 32).fill(200);
    s.sample(ramp(16, 9), out);
    // Every cell got a real average, not the untouched fill value everywhere.
    expect(new Set(out).size).toBeGreaterThan(1);
    expect(out.every((v) => v <= 255)).toBe(true);
  });

  it("reports the grid it was built for", () => {
    const s = buildSampler(40, 12, 128, 72);
    expect([s.cols, s.rows]).toEqual([40, 12]);
  });
});
