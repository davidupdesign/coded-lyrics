/**
 * Half-block word painter.
 *
 * Words are rasterised into a sub-pixel ink grid (one row per glyph sub-row),
 * then pairs of sub-rows are packed into a single terminal cell using ▀ ▄ █.
 * That halves the vertical cell count while doubling vertical resolution, so a
 * glyph pixel ends up square on screen.
 *
 * Empty cells stay blank, letting the renderer's ground show through.
 */
import { glyphAt, type FontScale } from "./glyphs.js";

/** Solid cell — both sub-pixels ink. */
export const FULL_BLOCK = "█";
/** Top sub-pixel only. */
export const UPPER_HALF = "▀";
/** Bottom sub-pixel only. */
export const LOWER_HALF = "▄";

/** How long a freshly revealed word spends animating in. */
export const TRANSITION_MS = 280;
/** How long the previous line lingers, dissolving out, after a line change. */
export const OUTGOING_MS = 150;

/**
 * Cell attributes. Ordered so `Math.max` resolves priority when two sub-pixels
 * in the same cell disagree: hot beats dim beats ink beats ground.
 */
export const ATTR_GROUND = 0;
export const ATTR_INK = 1;
export const ATTR_DIM = 2;
export const ATTR_HOT = 3;

/** Blank sub-columns between letters, scaled with the glyph size. */
export function letterGap(scale: FontScale): number {
  return Math.max(1, Math.round((scale.subRows * scale.condense) / 6));
}

/** Terminal rows one glyph occupies at a given size. */
export function fontRows(scale: FontScale): number {
  return Math.ceil(scale.subRows / 2);
}

/** Cell width of a word including inter-letter gaps. */
export function wordCellWidth(word: string, scale: FontScale): number {
  const chars = [...word];
  if (chars.length === 0) return 0;
  const ink = chars.reduce((n, ch) => n + glyphAt(ch, scale).width, 0);
  return ink + (chars.length - 1) * letterGap(scale);
}

export function emptyInk(h: number, w: number): boolean[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => false));
}

/** Rasterise a word into a sub-pixel ink grid, `scale.subRows` tall. */
export function buildInkGrid(word: string, scale: FontScale): boolean[][] {
  const chars = [...word];
  const w = wordCellWidth(word, scale);
  const ink = emptyInk(scale.subRows, Math.max(0, w));
  const gap = letterGap(scale);

  let xOff = 0;
  for (const ch of chars) {
    const glyph = glyphAt(ch, scale);
    for (let gy = 0; gy < scale.subRows; gy++) {
      const row = glyph.rows[gy];
      if (!row) continue;
      for (let gx = 0; gx < glyph.width; gx++) {
        if (row[gx] === "#") ink[gy][xOff + gx] = true;
      }
    }
    xOff += glyph.width + gap;
  }
  return ink;
}

/**
 * Morphological dilate — every ink pixel spreads to its 8 neighbours.
 * Used for the audio-reactive bass pulse, which fattens strokes on a kick.
 */
export function dilate(ink: boolean[][]): boolean[][] {
  const h = ink.length;
  const w = ink[0]?.length ?? 0;
  const out = emptyInk(h, w);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y][x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          out[ny][nx] = true;
        }
      }
    }
  }
  return out;
}

/** Terminal-cell paint: characters plus a parallel attribute grid. */
export interface CellPaint {
  lines: string[];
  attr: Uint8Array[];
}

/**
 * Pack a sub-pixel ink grid into terminal rows.
 * Each output row consumes two sub-rows; the attribute of a cell is the
 * highest-priority attribute among its ink sub-pixels.
 */
export function packHalfBlocks(
  ink: boolean[][],
  attrSub: Uint8Array[],
): CellPaint {
  const w = ink[0]?.length ?? 0;
  const rows = Math.ceil(ink.length / 2);
  const lines: string[] = [];
  const attr: Uint8Array[] = [];

  for (let r = 0; r < rows; r++) {
    const topY = r * 2;
    const botY = topY + 1;
    const topRow = ink[topY];
    const botRow = ink[botY];
    let line = "";
    const rowAttr = new Uint8Array(w);

    for (let x = 0; x < w; x++) {
      const top = topRow?.[x] ?? false;
      const bot = botRow?.[x] ?? false;
      if (top && bot) {
        line += FULL_BLOCK;
        rowAttr[x] = Math.max(attrSub[topY][x], attrSub[botY][x]);
      } else if (top) {
        line += UPPER_HALF;
        rowAttr[x] = attrSub[topY][x];
      } else if (bot) {
        line += LOWER_HALF;
        rowAttr[x] = attrSub[botY][x];
      } else {
        line += " ";
        rowAttr[x] = ATTR_GROUND;
      }
    }

    lines.push(line);
    attr.push(rowAttr);
  }

  return { lines, attr };
}

/** What one word contributes to a row: transformed ink plus an accent mask. */
export interface WordPaint {
  ink: boolean[][];
  /** Sub-pixels to draw with the accent colour (wipe edge, landing word). */
  hot: boolean[][] | null;
  /** Base attribute for non-hot ink — `ATTR_INK` or `ATTR_DIM`. */
  attr: number;
}

/**
 * Supplies the painted ink for word `index`, or `null` to leave it blank.
 * The renderer closes over elapsed time, transitions, and audio reactivity.
 */
export type WordPainter = (
  index: number,
  word: string,
  scale: FontScale,
) => WordPaint | null;

/**
 * Paint a justified row: words at `scale`, separated by `gapSizes`.
 * Words are composited into one row-wide sub-pixel grid, then packed once.
 */
export function renderBigRow(
  words: string[],
  gapSizes: number[],
  scale: FontScale,
  paint: WordPainter,
): CellPaint {
  let width = 0;
  for (let i = 0; i < words.length; i++) {
    width += wordCellWidth(words[i], scale);
    if (i < gapSizes.length) width += gapSizes[i];
  }

  const ink = emptyInk(scale.subRows, width);
  const attrSub = Array.from({ length: scale.subRows }, () => new Uint8Array(width));

  let xOff = 0;
  for (let i = 0; i < words.length; i++) {
    const wordWidth = wordCellWidth(words[i], scale);
    const painted = paint(i, words[i], scale);

    if (painted) {
      for (let y = 0; y < scale.subRows; y++) {
        const src = painted.ink[y];
        if (!src) continue;
        const hotRow = painted.hot?.[y];
        for (let x = 0; x < src.length; x++) {
          if (!src[x]) continue;
          const dx = xOff + x;
          if (dx < 0 || dx >= width) continue;
          ink[y][dx] = true;
          const a = hotRow?.[x] ? ATTR_HOT : painted.attr;
          if (a > attrSub[y][dx]) attrSub[y][dx] = a;
        }
      }
    }

    xOff += wordWidth;
    if (i < gapSizes.length) xOff += gapSizes[i];
  }

  return packHalfBlocks(ink, attrSub);
}
