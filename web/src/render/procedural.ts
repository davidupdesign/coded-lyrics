/**
 * Block and braille glyphs, drawn rather than typeset.
 *
 * These are the one place `fillText` cannot be trusted. Coverage for the
 * quadrant blocks varies between fonts, braille is missing from most monospace
 * faces entirely, and where a fallback face supplies them the metrics rarely
 * line up with the rest of the atlas — so a picture built from them would tile
 * with visible seams.
 *
 * Drawing them as rectangles and dots sidesteps all of that and is exact at any
 * cell size, which matters because these tiles are meant to butt up against
 * each other and read as continuous.
 */
import { QUADRANT_CHARS } from "@core/subcell.js";

/** Character → quadrant mask (tl 1, tr 2, bl 4, br 8), inverted from the table. */
const QUADRANT_MASK = new Map<string, number>(
  QUADRANT_CHARS.map((ch, mask) => [ch, mask]),
);

/** Half blocks are just the quadrant pairs, but `▌`/`▐` are not in that table. */
QUADRANT_MASK.set("▌", 0b0101);
QUADRANT_MASK.set("▐", 0b1010);

const BRAILLE_FIRST = 0x2800;
const BRAILLE_LAST = 0x28ff;

/** Dot bit for each position in the 2×4 grid, matching `core/subcell.ts`. */
const BRAILLE_BIT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

/**
 * Dot radius as a fraction of its sub-cell.
 *
 * Larger than real braille, which is designed to be felt rather than looked at:
 * at typographic size the dots are small and widely spaced, and a picture made
 * of them comes out far too dark. This is close to touching.
 */
const DOT_FILL = 0.42;

/**
 * Draw `ch` into the box if this module owns it.
 *
 * Returns false for anything ordinary, which the caller should typeset instead.
 */
export function drawProceduralGlyph(
  ctx: CanvasRenderingContext2D,
  ch: string,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const code = ch.codePointAt(0);
  if (code === undefined) return false;

  if (code >= BRAILLE_FIRST && code <= BRAILLE_LAST) {
    drawBraille(ctx, code - BRAILLE_FIRST, x, y, w, h);
    return true;
  }

  const mask = QUADRANT_MASK.get(ch);
  if (mask === undefined || mask === 0) return mask === 0;

  // Round the split so the two halves stay adjacent with no seam and no
  // overlap, whatever the parity of the cell size.
  const mx = Math.round(w / 2);
  const my = Math.round(h / 2);
  if (mask & 0b0001) ctx.fillRect(x, y, mx, my);
  if (mask & 0b0010) ctx.fillRect(x + mx, y, w - mx, my);
  if (mask & 0b0100) ctx.fillRect(x, y + my, mx, h - my);
  if (mask & 0b1000) ctx.fillRect(x + mx, y + my, w - mx, h - my);
  return true;
}

function drawBraille(
  ctx: CanvasRenderingContext2D,
  bits: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const sw = w / 2;
  const sh = h / 4;
  const r = Math.max(0.5, Math.min(sw, sh) * DOT_FILL);

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 2; col++) {
      if (!(bits & BRAILLE_BIT[row][col])) continue;
      ctx.beginPath();
      ctx.arc(x + (col + 0.5) * sw, y + (row + 0.5) * sh, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
