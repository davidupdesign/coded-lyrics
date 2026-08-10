/**
 * Squeezing more picture into one cell.
 *
 * A density ramp spends a whole cell to say one brightness. Block-drawing
 * characters divide the cell instead: `▀` splits it in two, the quadrants in
 * four, braille in eight. Sampling at that finer grid and picking the character
 * whose shape matches gets multiples more detail out of the same number of
 * cells — which matters twice over, because cost is per cell drawn, so braille
 * at 160 columns resolves more than plain ASCII at 320 while drawing a quarter
 * as many.
 *
 * Flat cells fall back to the density ramp. A cell with no internal contrast has
 * no shape for a block character to match, and thresholding it would turn a
 * smooth gradient into hard banding; the ramp says "middling grey" far better.
 * The result is a hybrid, blocks on the edges and density everywhere else, which
 * is also what makes it read as a drawing rather than as a mosaic.
 */

export type SubcellMode = "off" | "half" | "quadrant" | "braille";

export const SUBCELL_MODES: readonly SubcellMode[] = ["off", "half", "quadrant", "braille"];

export function isSubcellMode(v: string): v is SubcellMode {
  return (SUBCELL_MODES as readonly string[]).includes(v);
}

/** Sub-samples per cell, horizontally and vertically. */
export interface SubcellShape {
  sx: number;
  sy: number;
}

export function subcellShape(mode: SubcellMode): SubcellShape {
  switch (mode) {
    case "half": return { sx: 1, sy: 2 };
    case "quadrant": return { sx: 2, sy: 2 };
    case "braille": return { sx: 2, sy: 4 };
    case "off": return { sx: 1, sy: 1 };
  }
}

/**
 * Cell aspect to sample the sub-grid at.
 *
 * The sub-grid covers the same screen region, so each sub-sample is `sx` times
 * narrower and `sy` times shorter than a cell. Getting this wrong is the
 * difference between a picture and a squashed one.
 */
export function subcellAspect(cellAspect: number, shape: SubcellShape): number {
  return (cellAspect * shape.sx) / shape.sy;
}

/** Indexed by `top | bottom<<1`. */
export const HALF_CHARS = [" ", "▀", "▄", "█"];

/** Indexed by `tl | tr<<1 | bl<<2 | br<<3`. */
export const QUADRANT_CHARS = [
  " ", "▘", "▝", "▀",
  "▖", "▌", "▞", "▛",
  "▗", "▚", "▐", "▜",
  "▄", "▙", "▟", "█",
];

/**
 * Braille dot bit for a position in the 2×4 grid.
 *
 * The ordering is historical rather than raster order: dots 1–3 run down the
 * left column, 4–6 down the right, and 7–8 are the low row added for computing.
 */
const BRAILLE_BIT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

export function brailleChar(bits: number): string {
  return String.fromCharCode(0x2800 + (bits & 0xff));
}

/** Every glyph a mode can emit, so they can be interned and rasterised up front. */
export function subcellChars(mode: SubcellMode): string[] {
  switch (mode) {
    case "half": return [...HALF_CHARS];
    case "quadrant": return [...QUADRANT_CHARS];
    case "braille": return Array.from({ length: 256 }, (_, i) => brailleChar(i));
    case "off": return [];
  }
}

/**
 * Below this spread a cell has no shape worth matching and the ramp takes over.
 *
 * Tuned by eye: low enough that real edges still become blocks, high enough that
 * sensor noise and gradients do not.
 */
export const FLAT_SPREAD = 26;

export interface PackedCell {
  /** The block character, or null when the cell is flat and wants the ramp. */
  char: string | null;
  /** Representative luminance, for picking the colour tier. */
  value: number;
}

/**
 * Choose the character for one cell of a sub-sampled grid.
 *
 * `sub` is the fine grid, `subW` its width; `cx`/`cy` are cell coordinates.
 */
export function packCell(
  mode: SubcellMode,
  sub: Uint8Array,
  subW: number,
  subH: number,
  cx: number,
  cy: number,
  out: PackedCell,
): void {
  const { sx, sy } = subcellShape(mode);
  const x0 = cx * sx;
  const y0 = cy * sy;

  let min = 255;
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < sy; y++) {
    const row = y0 + y;
    if (row >= subH) continue;
    for (let x = 0; x < sx; x++) {
      const col = x0 + x;
      if (col >= subW) continue;
      const v = sub[row * subW + col];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      n++;
    }
  }
  if (n === 0) {
    out.char = null;
    out.value = 0;
    return;
  }

  const mean = sum / n;
  if (max - min < FLAT_SPREAD) {
    out.char = null;
    out.value = mean;
    return;
  }

  // Split at the midpoint rather than the mean: it tracks the edge itself
  // instead of being dragged around by how much of the cell each side covers.
  const threshold = (min + max) / 2;
  let bits = 0;
  let litSum = 0;
  let lit = 0;
  for (let y = 0; y < sy; y++) {
    const row = y0 + y;
    if (row >= subH) continue;
    for (let x = 0; x < sx; x++) {
      const col = x0 + x;
      if (col >= subW) continue;
      const v = sub[row * subW + col];
      if (v <= threshold) continue;
      litSum += v;
      lit++;
      bits |= mode === "braille" ? BRAILLE_BIT[y][x] : 1 << (y * sx + x);
    }
  }

  // The lit part carries the character, so it should also pick the colour;
  // averaging in the dark half would wash every edge out toward grey.
  out.value = lit > 0 ? litSum / lit : mean;
  out.char =
    mode === "braille"
      ? brailleChar(bits)
      : mode === "half"
        ? HALF_CHARS[bits & 0b11]
        : QUADRANT_CHARS[bits & 0b1111];
}
