/**
 * Hybrid Unicode ASCII lyrics font.
 *
 * Each terminal cell covers a 2×2 pixel tile from the 8×16 glyph atlas.
 * Contours use solid quadrant/block characters (no white cuts).
 * Fully filled interior cells get a restrained ASCII/Unicode texture.
 */
import { bitmapFor, PIX_H, PIX_W, type Bitmap } from "./glyphs.js";

/** Terminal cells per letter: 8×16 px ÷ 2×2 */
export const FONT_W = 4;
export const FONT_H = 8;

/**
 * 2×2 pixel mask → solid Unicode block/quadrant.
 * Bits: TL=1, TR=2, BL=4, BR=8
 */
const QUAD_TILES: readonly string[] = [
  " ", // 0000
  "▘", // 0001 TL
  "▝", // 0010 TR
  "▀", // 0011 top
  "▖", // 0100 BL
  "▌", // 0101 left
  "▞", // 0110 TR+BL
  "▛", // 0111 missing BR
  "▗", // 1000 BR
  "▚", // 1001 TL+BR
  "▐", // 1010 right
  "▜", // 1011 missing BL
  "▄", // 1100 bottom
  "▙", // 1101 missing TR
  "▟", // 1110 missing TL
  "█", // 1111 full
];

/** Texture ramp for safe interior full cells only */
const INTERIOR_TEXTURE = ["█", "▓", "#", "@", "%"] as const;

function pixelAt(px: Bitmap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= PIX_W || y >= PIX_H) return false;
  return px[y]?.[x] ?? false;
}

function hashSeed(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

function tileMask(px: Bitmap, cx: number, cy: number): number {
  const x = cx * 2;
  const y = cy * 2;
  let mask = 0;
  if (pixelAt(px, x, y)) mask |= 1; // TL
  if (pixelAt(px, x + 1, y)) mask |= 2; // TR
  if (pixelAt(px, x, y + 1)) mask |= 4; // BL
  if (pixelAt(px, x + 1, y + 1)) mask |= 8; // BR
  return mask;
}

/**
 * A full cell is "interior" when all 8 orthogonal neighbors (in cell space)
 * that exist are also fully filled — so texture never weakens an edge.
 */
function isSafeInterior(px: Bitmap, cx: number, cy: number): boolean {
  if (tileMask(px, cx, cy) !== 15) return false;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= FONT_W || ny >= FONT_H) return false;
      if (tileMask(px, nx, ny) !== 15) return false;
    }
  }
  return true;
}

function interiorTexture(ch: string, cx: number, cy: number): string {
  const seed = hashSeed(ch.codePointAt(0)! * 131 + cx * 17 + cy * 31);
  return INTERIOR_TEXTURE[seed % INTERIOR_TEXTURE.length];
}

/**
 * Convert a glyph bitmap into hybrid Unicode/ASCII terminal rows.
 */
export function bitmapToHybridRows(px: Bitmap, ch = "#"): string[] {
  const rows: string[] = [];
  for (let cy = 0; cy < FONT_H; cy++) {
    let line = "";
    for (let cx = 0; cx < FONT_W; cx++) {
      const mask = tileMask(px, cx, cy);
      if (mask === 15 && isSafeInterior(px, cx, cy)) {
        line += interiorTexture(ch, cx, cy);
      } else {
        line += QUAD_TILES[mask];
      }
    }
    rows.push(line);
  }
  return rows;
}

/** @deprecated alias kept for older call sites during transition */
export function bitmapToBrailleRows(px: Bitmap): string[] {
  return bitmapToHybridRows(px);
}

/** Cell width of a word (letters packed tight). */
export function wordCellWidth(word: string): number {
  return Math.max(0, [...word].length * FONT_W);
}

/** Render one word as FONT_H terminal rows (letters flush). */
export function renderWord(word: string): string[] {
  const lines = Array.from({ length: FONT_H }, () => "");
  for (const ch of word) {
    const rows = bitmapToHybridRows(bitmapFor(ch), ch);
    for (let r = 0; r < FONT_H; r++) {
      lines[r] += rows[r];
    }
  }
  return lines;
}

/** Blank stand-in with the same width as a word (for unrevealed cues). */
export function blankWordCells(letterCount: number): string[] {
  const w = letterCount * FONT_W;
  return Array.from({ length: FONT_H }, () => " ".repeat(w));
}

/**
 * Paint a justified row: visible words + gap sizes (cells between words).
 */
export function renderBigRow(
  words: string[],
  revealed: boolean[],
  gapSizes: number[],
): string[] {
  const lines = Array.from({ length: FONT_H }, () => "");
  for (let i = 0; i < words.length; i++) {
    const piece = revealed[i]
      ? renderWord(words[i])
      : blankWordCells(words[i].length);
    for (let r = 0; r < FONT_H; r++) {
      lines[r] += piece[r];
      if (i < gapSizes.length) {
        lines[r] += " ".repeat(gapSizes[i]);
      }
    }
  }
  return lines;
}
