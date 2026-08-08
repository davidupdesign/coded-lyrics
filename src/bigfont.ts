/**
 * Self-letter lyrics font.
 *
 * Letters come from the compact atlas in `glyphs.ts` (one pixel = one terminal
 * cell). Every ink cell is painted with the letter itself — a big `u` is made
 * of little `u`s, a big `p` of little `p`s — so each glyph stays readable.
 *
 * Terminal cells can't shrink, so density comes from thicker atlas strokes
 * (more ink cells), not from scaling the whole letter up.
 */
import { GLYPH_H, glyphFor } from "./glyphs.js";

export const FONT_H = GLYPH_H;

/** Blank cells inserted between letters of the same word. */
export const LETTER_GAP = 1;

/** Cell width of a single character. */
export function charCellWidth(ch: string): number {
  return glyphFor(ch).width;
}

/** Cell width of a word including inter-letter gaps. */
export function wordCellWidth(word: string): number {
  const chars = [...word];
  if (chars.length === 0) return 0;
  const ink = chars.reduce((n, ch) => n + charCellWidth(ch), 0);
  return ink + (chars.length - 1) * LETTER_GAP;
}

/** Render one word as FONT_H rows of self-letter art. */
export function renderWord(word: string): string[] {
  const lines = Array.from({ length: FONT_H }, () => "");
  const chars = [...word];

  chars.forEach((ch, index) => {
    const glyph = glyphFor(ch);
    const ink = ch.toLowerCase();
    for (let y = 0; y < FONT_H; y++) {
      let painted = "";
      for (let x = 0; x < glyph.width; x++) {
        painted += glyph.rows[y][x] === "#" ? ink : " ";
      }
      lines[y] += painted;
      if (index < chars.length - 1) lines[y] += " ".repeat(LETTER_GAP);
    }
  });

  return lines;
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
): string[] {
  const lines = Array.from({ length: FONT_H }, () => "");
  for (let i = 0; i < words.length; i++) {
    const piece = revealed[i] ? renderWord(words[i]) : blankWordCells(words[i]);
    for (let r = 0; r < FONT_H; r++) {
      lines[r] += piece[r];
      if (i < gapSizes.length) {
        lines[r] += " ".repeat(gapSizes[i]);
      }
    }
  }
  return lines;
}
