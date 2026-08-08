/**
 * Block lyrics font with static `#` outlines.
 *
 * Letters come from the compact atlas in `glyphs.ts`. Each word is painted as
 * solid block ink with a one-cell morphological outline. On entrance, words
 * render slim + sheared (italic) for a short beat before settling to full ink.
 * Empty cells stay blank so the renderer can fill them with the background.
 */
import { GLYPH_H, glyphFor } from "./glyphs.js";

/** One cell of padding around ink so the outline has room. */
const OUTLINE_PAD = 1;

export const FONT_H = GLYPH_H + OUTLINE_PAD * 2;

/** Blank cells between letters — keeps neighboring outlines from merging. */
export const LETTER_GAP = 2;

/** Solid fill for letter bodies. */
export const INK_CHAR = "█";

/** Fixed outline character. */
export const OUTLINE_CHAR = "#";

/** How long a freshly revealed word stays in the slim/italic entrance pose. */
export const ENTRANCE_MS = 280;

export type WordPaintStyle = "enter" | "solid";

/** Cell width of a single character (including outline padding). */
export function charCellWidth(ch: string): number {
  return glyphFor(ch).width + OUTLINE_PAD * 2;
}

/** Cell width of a word including inter-letter gaps. */
export function wordCellWidth(word: string): number {
  const chars = [...word];
  if (chars.length === 0) return 0;
  const ink = chars.reduce((n, ch) => n + glyphFor(ch).width, 0);
  return ink + (chars.length - 1) * LETTER_GAP + OUTLINE_PAD * 2;
}

type CellKind = "ink" | "outline" | "empty";

function emptyInk(h: number, w: number): boolean[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => false));
}

function buildInkGrid(word: string): boolean[][] {
  const chars = [...word];
  const innerW =
    chars.length === 0
      ? 0
      : chars.reduce((n, ch) => n + glyphFor(ch).width, 0) +
        (chars.length - 1) * LETTER_GAP;
  const w = innerW + OUTLINE_PAD * 2;
  const h = FONT_H;
  const ink = emptyInk(h, w);

  let xOff = OUTLINE_PAD;
  for (const ch of chars) {
    const glyph = glyphFor(ch);
    for (let gy = 0; gy < GLYPH_H; gy++) {
      for (let gx = 0; gx < glyph.width; gx++) {
        if (glyph.rows[gy][gx] === "#") {
          ink[gy + OUTLINE_PAD][xOff + gx] = true;
        }
      }
    }
    xOff += glyph.width + LETTER_GAP;
  }
  return ink;
}

/** Keep only the left edge of each contiguous ink run → thinner strokes. */
function slimInk(ink: boolean[][]): boolean[][] {
  const h = ink.length;
  const w = ink[0]?.length ?? 0;
  const out = emptyInk(h, w);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!ink[y][x]) {
        x++;
        continue;
      }
      out[y][x] = true;
      while (x < w && ink[y][x]) x++;
    }
  }
  return out;
}

/** Shear rows to the right for an italic lean; width stays fixed. */
function shearInk(ink: boolean[][]): boolean[][] {
  const h = ink.length;
  const w = ink[0]?.length ?? 0;
  const out = emptyInk(h, w);
  for (let y = 0; y < h; y++) {
    const shift = Math.min(OUTLINE_PAD + 1, Math.max(0, Math.floor(y / 2)));
    for (let x = 0; x < w; x++) {
      if (!ink[y][x]) continue;
      const nx = x + shift;
      if (nx < w) out[y][nx] = true;
    }
  }
  return out;
}

function outlineFromInk(ink: boolean[][]): CellKind[][] {
  const h = ink.length;
  const w = ink[0]?.length ?? 0;
  const mask: CellKind[][] = Array.from({ length: h }, () =>
    Array.from({ length: w }, () => "empty" as CellKind),
  );

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (ink[y][x]) {
        mask[y][x] = "ink";
        continue;
      }
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
          if (ink[ny][nx]) {
            near = true;
            break;
          }
        }
      }
      if (near) mask[y][x] = "outline";
    }
  }
  return mask;
}

function paintMask(mask: CellKind[][]): string[] {
  return mask.map((row) =>
    row
      .map((kind) => {
        if (kind === "ink") return INK_CHAR;
        if (kind === "outline") return OUTLINE_CHAR;
        return " ";
      })
      .join(""),
  );
}

/** Render one word as FONT_H rows of block ink + outline. */
export function renderWord(
  word: string,
  style: WordPaintStyle = "solid",
): string[] {
  let ink = buildInkGrid(word);
  if (style === "enter") {
    ink = shearInk(slimInk(ink));
  }
  return paintMask(outlineFromInk(ink));
}

/** Blank stand-in with the same width as a word (for unrevealed cues). */
export function blankWordCells(word: string): string[] {
  const w = wordCellWidth(word);
  return Array.from({ length: FONT_H }, () => " ".repeat(w));
}

export interface BigRowPaint {
  lines: string[];
  /** Same geometry as `lines`; true where entrance italic should apply. */
  italic: boolean[][];
}

/** Paint a justified row: visible words plus the gap sizes between them. */
export function renderBigRow(
  words: string[],
  styles: Array<WordPaintStyle | "hidden">,
  gapSizes: number[],
): BigRowPaint {
  const lines = Array.from({ length: FONT_H }, () => "");
  const italic = Array.from({ length: FONT_H }, () => [] as boolean[]);

  for (let i = 0; i < words.length; i++) {
    const style = styles[i];
    const piece =
      style === "hidden" ? blankWordCells(words[i]) : renderWord(words[i], style);
    const isItalic = style === "enter";

    for (let r = 0; r < FONT_H; r++) {
      lines[r] += piece[r];
      for (let c = 0; c < piece[r].length; c++) {
        italic[r].push(isItalic && piece[r][c] !== " ");
      }
      if (i < gapSizes.length) {
        lines[r] += " ".repeat(gapSizes[i]);
        for (let g = 0; g < gapSizes[i]; g++) italic[r].push(false);
      }
    }
  }

  return { lines, italic };
}
