/**
 * Block lyrics font with animated outlines.
 *
 * Letters come from the compact atlas in `glyphs.ts`. Each word is painted as
 * solid block ink with a one-cell morphological outline. Empty cells stay
 * blank so the renderer can fill them with the background pattern.
 */
import { GLYPH_H, glyphFor } from "./glyphs.js";

/** One cell of padding around ink so the outline has room. */
const OUTLINE_PAD = 1;

export const FONT_H = GLYPH_H + OUTLINE_PAD * 2;

/** Blank cells between letters — keeps neighboring outlines from merging. */
export const LETTER_GAP = 2;

/** Solid fill for letter bodies. */
export const INK_CHAR = "█";

/** Cell width of a single character (including outline padding). */
export function charCellWidth(ch: string): number {
  return glyphFor(ch).width + OUTLINE_PAD * 2;
}

/** Cell width of a word including inter-letter gaps. */
export function wordCellWidth(word: string): number {
  const chars = [...word];
  if (chars.length === 0) return 0;
  // Outline padding once around the whole word, not per letter.
  const ink = chars.reduce((n, ch) => n + glyphFor(ch).width, 0);
  return ink + (chars.length - 1) * LETTER_GAP + OUTLINE_PAD * 2;
}

type CellKind = "ink" | "outline" | "empty";

function buildWordMask(word: string): CellKind[][] {
  const chars = [...word];
  const innerW =
    chars.length === 0
      ? 0
      : chars.reduce((n, ch) => n + glyphFor(ch).width, 0) +
        (chars.length - 1) * LETTER_GAP;
  const w = innerW + OUTLINE_PAD * 2;
  const h = FONT_H;
  const ink: boolean[][] = Array.from({ length: h }, () =>
    Array.from({ length: w }, () => false),
  );

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

/** Render one word as FONT_H rows of block ink + outline. */
export function renderWord(word: string, outlineChar: string): string[] {
  const mask = buildWordMask(word);
  return mask.map((row) =>
    row
      .map((kind) => {
        if (kind === "ink") return INK_CHAR;
        if (kind === "outline") return outlineChar;
        return " ";
      })
      .join(""),
  );
}

/** Blank stand-in with the same width as a word (for unrevealed cues). */
export function blankWordCells(word: string): string[] {
  const w = wordCellWidth(word);
  return Array.from({ length: FONT_H }, () => " ".repeat(w));
}

/** Paint a justified row: visible words plus the gap sizes between them. */
export function renderBigRow(
  words: string[],
  revealed: boolean[],
  gapSizes: number[],
  outlineChar: string,
): string[] {
  const lines = Array.from({ length: FONT_H }, () => "");
  for (let i = 0; i < words.length; i++) {
    const piece = revealed[i]
      ? renderWord(words[i], outlineChar)
      : blankWordCells(words[i]);
    for (let r = 0; r < FONT_H; r++) {
      lines[r] += piece[r];
      if (i < gapSizes.length) {
        lines[r] += " ".repeat(gapSizes[i]);
      }
    }
  }
  return lines;
}
