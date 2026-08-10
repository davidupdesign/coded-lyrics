import { describe, expect, it } from "vitest";
import {
  FLAT_SPREAD,
  QUADRANT_CHARS,
  SUBCELL_MODES,
  brailleChar,
  isSubcellMode,
  packCell,
  subcellAspect,
  subcellChars,
  subcellShape,
  type PackedCell,
  type SubcellMode,
} from "./subcell.js";

const fresh = (): PackedCell => ({ char: null, value: 0 });

/** Build a one-cell sub-grid from rows of values. */
function cell(rows: number[][]): { sub: Uint8Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0].length;
  const sub = new Uint8Array(w * h);
  rows.forEach((row, y) => row.forEach((v, x) => (sub[y * w + x] = v)));
  return { sub, w, h };
}

describe("shape", () => {
  it("matches the sub-divisions each mode implies", () => {
    expect(subcellShape("off")).toEqual({ sx: 1, sy: 1 });
    expect(subcellShape("half")).toEqual({ sx: 1, sy: 2 });
    expect(subcellShape("quadrant")).toEqual({ sx: 2, sy: 2 });
    expect(subcellShape("braille")).toEqual({ sx: 2, sy: 4 });
  });

  it("keeps the sampled region's proportions", () => {
    // A terminal cell is 2:1, so halving it vertically gives square samples.
    expect(subcellAspect(2, subcellShape("half"))).toBe(1);
    // Braille splits 2×4, which also squares up a 2:1 cell.
    expect(subcellAspect(2, subcellShape("braille"))).toBe(1);
    // Quadrants divide both axes equally, so the sample keeps the cell's shape.
    expect(subcellAspect(2, subcellShape("quadrant"))).toBe(2);
    expect(subcellAspect(1, subcellShape("off"))).toBe(1);
  });
});

describe("glyph inventory", () => {
  it("covers every bit pattern a mode can produce", () => {
    expect(subcellChars("off")).toEqual([]);
    expect(subcellChars("half")).toHaveLength(4);
    expect(subcellChars("quadrant")).toHaveLength(16);
    expect(subcellChars("braille")).toHaveLength(256);
  });

  it("has no duplicate glyphs within a mode", () => {
    for (const mode of SUBCELL_MODES) {
      const chars = subcellChars(mode);
      expect(new Set(chars).size).toBe(chars.length);
    }
  });

  it("maps braille bits onto the Unicode block", () => {
    expect(brailleChar(0)).toBe("⠀");
    expect(brailleChar(0xff)).toBe("⣿");
    // Masks beyond 8 bits wrap rather than escaping the block.
    expect(brailleChar(0x1ff)).toBe("⣿");
  });

  it("orders the quadrant table so the index is the bit mask", () => {
    expect(QUADRANT_CHARS[0]).toBe(" ");
    expect(QUADRANT_CHARS[0b0001]).toBe("▘"); // top-left
    expect(QUADRANT_CHARS[0b0011]).toBe("▀"); // top half
    expect(QUADRANT_CHARS[0b1100]).toBe("▄"); // bottom half
    expect(QUADRANT_CHARS[0b1111]).toBe("█");
  });

  it("accepts exactly the known modes", () => {
    for (const m of SUBCELL_MODES) expect(isSubcellMode(m)).toBe(true);
    expect(isSubcellMode("octant")).toBe(false);
  });
});

describe("packCell", () => {
  it("defers to the density ramp when the cell has no internal contrast", () => {
    const { sub, w, h } = cell([[100], [100 + FLAT_SPREAD - 2]]);
    const out = fresh();
    packCell("half", sub, w, h, 0, 0, out);
    expect(out.char).toBeNull();
    expect(out.value).toBeCloseTo(112, 0);
  });

  it("picks a block once there is a real edge", () => {
    const { sub, w, h } = cell([[240], [10]]);
    const out = fresh();
    packCell("half", sub, w, h, 0, 0, out);
    expect(out.char).toBe("▀");
  });

  it("reads the edge the right way up", () => {
    const out = fresh();
    const top = cell([[240], [10]]);
    packCell("half", top.sub, top.w, top.h, 0, 0, out);
    expect(out.char).toBe("▀");

    const bottom = cell([[10], [240]]);
    packCell("half", bottom.sub, bottom.w, bottom.h, 0, 0, out);
    expect(out.char).toBe("▄");
  });

  it("resolves quadrants independently", () => {
    const out = fresh();
    // Bright on the left, dark on the right.
    const left = cell([[240, 10], [240, 10]]);
    packCell("quadrant", left.sub, left.w, left.h, 0, 0, out);
    expect(out.char).toBe("▌");

    // A single bright corner.
    const corner = cell([[240, 10], [10, 10]]);
    packCell("quadrant", corner.sub, corner.w, corner.h, 0, 0, out);
    expect(out.char).toBe("▘");
  });

  it("resolves braille dots in the historical dot order", () => {
    const out = fresh();
    // Only the top-left dot is lit → dot 1 → bit 0x01.
    const rows = [[240, 10], [10, 10], [10, 10], [10, 10]];
    const { sub, w, h } = cell(rows);
    packCell("braille", sub, w, h, 0, 0, out);
    expect(out.char).toBe(brailleChar(0x01));

    // Bottom-right is dot 8 → bit 0x80.
    const br = cell([[10, 10], [10, 10], [10, 10], [10, 240]]);
    packCell("braille", br.sub, br.w, br.h, 0, 0, out);
    expect(out.char).toBe(brailleChar(0x80));
  });

  it("takes the colour from the lit half, not the whole cell", () => {
    const { sub, w, h } = cell([[240], [0]]);
    const out = fresh();
    packCell("half", sub, w, h, 0, 0, out);
    // Averaging in the dark half would give 120 and wash the edge out.
    expect(out.value).toBe(240);
  });

  it("indexes the right cell out of a larger grid", () => {
    // Two cells side by side: the left flat, the right an edge.
    const w = 4;
    const sub = new Uint8Array([
      100, 100, 240, 10,
      100, 100, 240, 10,
    ]);
    const out = fresh();
    packCell("quadrant", sub, w, 2, 0, 0, out);
    expect(out.char).toBeNull();
    packCell("quadrant", sub, w, 2, 1, 0, out);
    expect(out.char).toBe("▌");
  });

  it("handles a cell running off the edge of the grid", () => {
    // A 1×1 grid asked for a 2×4 braille cell.
    const sub = new Uint8Array([200]);
    const out = fresh();
    expect(() => packCell("braille", sub, 1, 1, 0, 0, out)).not.toThrow();
    expect(out.value).toBe(200);
  });

  it("reports nothing for a cell entirely outside the grid", () => {
    const sub = new Uint8Array([200]);
    const out = fresh();
    packCell("braille", sub, 1, 1, 5, 5, out);
    expect(out.char).toBeNull();
    expect(out.value).toBe(0);
  });

  it("is deterministic", () => {
    const { sub, w, h } = cell([[240, 10], [30, 200], [80, 15], [10, 250]]);
    const a = fresh();
    const b = fresh();
    packCell("braille", sub, w, h, 0, 0, a);
    packCell("braille", sub, w, h, 0, 0, b);
    expect(a).toEqual(b);
  });

  it("only ever emits glyphs the mode declares", () => {
    const modes: SubcellMode[] = ["half", "quadrant", "braille"];
    const out = fresh();
    for (const mode of modes) {
      const allowed = new Set(subcellChars(mode));
      const { sx, sy } = subcellShape(mode);
      // Sweep a range of patterns through the packer.
      for (let seed = 0; seed < 64; seed++) {
        const sub = new Uint8Array(sx * sy);
        for (let i = 0; i < sub.length; i++) sub[i] = ((seed >> i) & 1) ? 250 : 5;
        packCell(mode, sub, sx, sy, 0, 0, out);
        if (out.char !== null) expect(allowed.has(out.char)).toBe(true);
      }
    }
  });
});
