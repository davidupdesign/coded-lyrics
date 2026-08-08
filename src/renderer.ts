import type { LineCue, Theme, WordCue } from "./types.js";
import { FONT_H, renderBigRow, wordCellWidth } from "./bigfont.js";

const ESC = "\x1b";
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR = `${ESC}[2J${ESC}[H`;
const RESET = `${ESC}[0m`;

/** Prefer this many words per wrapped row */
const WORDS_PER_ROW = 4;
/** Fallback wrap width when the terminal size is unknown */
const DEFAULT_ROW_CELL_BUDGET = 64;
/** Minimum gap (cells) between words */
const MIN_WORD_GAP = 2;
/** Blank rows between stacked lyric rows so outlines never touch */
const ROW_SPACING = 1;

/** Outline symbols cycled every 100ms. */
const OUTLINE_RAMP = [
  "#",
  "@",
  "$",
  "%",
  "&",
  "*",
  "+",
  "!",
  "/",
  "\\",
  "|",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "<",
  ">",
  "~",
  "^",
] as const;

/** Dense, stable background pattern. */
const BG_PATTERN = ["=", "=", "+", "-", ":", ".", "=", "+", "~", "-"] as const;

/** Widest block we allow, given the terminal width. */
export function rowCellBudget(cols: number): number {
  return Math.max(16, Math.min(cols - 4, 88));
}

function themeColors(theme: Theme): { bg: string; fg: string } {
  if (theme === "white") {
    return {
      bg: `${ESC}[48;2;255;255;255m`,
      fg: `${ESC}[38;2;0;0;0m`,
    };
  }
  return {
    bg: `${ESC}[48;2;0;0;0m`,
    fg: `${ESC}[38;2;255;255;255m`,
  };
}

function hashSeed(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

function patternChar(x: number, y: number): string {
  const i = hashSeed(x * 73856093 ^ y * 19349663) % BG_PATTERN.length;
  return BG_PATTERN[i];
}

function outlineCharNow(): string {
  return OUTLINE_RAMP[Math.floor(Date.now() / 100) % OUTLINE_RAMP.length];
}

/**
 * Pack words into short rows of ~3–4 (Brat cover rhythm).
 * Sizes are in block-font cell widths.
 */
export function packRows(
  words: string[],
  perRow = WORDS_PER_ROW,
  budget = DEFAULT_ROW_CELL_BUDGET,
): string[][] {
  if (words.length === 0) return [];
  const rows: string[][] = [];
  let current: string[] = [];

  for (const word of words) {
    const nextLen =
      current.reduce((n, w) => n + wordCellWidth(w), 0) +
      wordCellWidth(word) +
      current.length * MIN_WORD_GAP;
    const wouldOverflow =
      current.length >= 1 &&
      (current.length >= perRow || nextLen > budget);
    if (wouldOverflow) {
      rows.push(current);
      current = [word];
    } else {
      current.push(word);
    }
  }
  if (current.length > 0) rows.push(current);

  // Prefer fuller lines: if the last row is a single orphan that still fits
  // on the previous row within budget, merge it up.
  if (rows.length >= 2) {
    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    if (last.length === 1) {
      const mergedLen =
        prev.reduce((n, w) => n + wordCellWidth(w), 0) +
        wordCellWidth(last[0]) +
        prev.length * MIN_WORD_GAP;
      if (prev.length < perRow && mergedLen <= budget) {
        prev.push(last[0]);
        rows.pop();
      }
    }
  }
  return rows;
}

/**
 * Compute gap sizes so the row spans exactly `targetWidth` cells.
 * Extra space goes between words only (letters stay flush in the font).
 */
export function bratGaps(
  words: string[],
  targetWidth: number,
  rowSeed: number,
): number[] {
  if (words.length <= 1) return [];

  const textLen = words.reduce((n, w) => n + wordCellWidth(w), 0);
  const gaps = words.length - 1;
  let extra = targetWidth - textLen - gaps * MIN_WORD_GAP;
  if (extra < 0) extra = 0;

  const gapSizes = Array.from({ length: gaps }, () => MIN_WORD_GAP);
  const order = Array.from({ length: gaps }, (_, i) => i).sort((a, b) => {
    const ha = hashSeed(rowSeed * 13 + a * 7);
    const hb = hashSeed(rowSeed * 13 + b * 7);
    return ha - hb;
  });

  let remaining = extra;
  let guard = 0;
  while (remaining > 0 && guard < 5000) {
    for (const i of order) {
      if (remaining <= 0) break;
      gapSizes[i] += 1;
      remaining -= 1;
    }
    guard += 1;
  }
  return gapSizes;
}

/** @deprecated kept for any callers expecting a flat string — prefer bratGaps */
export function bratJustify(words: string[], targetWidth: number, rowSeed: number): string {
  if (words.length === 0) return "";
  const gaps = bratGaps(words, targetWidth, rowSeed);
  if (words.length === 1) {
    return words[0] + " ".repeat(Math.max(0, targetWidth - wordCellWidth(words[0])));
  }
  let out = words[0];
  for (let i = 0; i < gaps.length; i++) {
    out += " ".repeat(gaps[i]) + words[i + 1];
  }
  return out;
}

/**
 * Brat block as terminal rows (block font).
 * Widest packed row sets outer edges; others stretch word-gaps to match.
 */
export function renderBratBlock(
  allWords: string[],
  revealedCount: number,
  budget = DEFAULT_ROW_CELL_BUDGET,
  rowSpacing = ROW_SPACING,
  perRow = WORDS_PER_ROW,
  outlineChar = "#",
): string[] {
  const lower = allWords.map((w) => w.toLowerCase());
  const rows = packRows(lower, perRow, budget);
  if (rows.length === 0 || revealedCount <= 0) return [];

  let blockWidth = 0;
  for (const row of rows) {
    const min =
      row.reduce((n, w) => n + wordCellWidth(w), 0) +
      Math.max(0, row.length - 1) * MIN_WORD_GAP;
    if (min > blockWidth) blockWidth = min;
  }

  let wordOffset = 0;
  const out: string[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const rowStart = wordOffset;
    wordOffset += row.length;
    if (revealedCount <= rowStart) break;

    const revealed = row.map((_, i) => rowStart + i < revealedCount);
    const gaps = bratGaps(row, blockWidth, rowIndex + 1);
    const big = renderBigRow(row, revealed, gaps, outlineChar);

    if (out.length > 0) {
      for (let s = 0; s < rowSpacing; s++) out.push(" ".repeat(blockWidth));
    }

    for (const line of big) {
      // Pad to exact block width for edge hugging
      if (line.length < blockWidth) {
        out.push(line + " ".repeat(blockWidth - line.length));
      } else {
        out.push(line.slice(0, blockWidth));
      }
    }
  }
  return out;
}

/** Active line = last line whose start <= elapsed */
export function activeLineIndex(lines: LineCue[], elapsed: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start <= elapsed) idx = i;
    else break;
  }
  return idx;
}

export function revealedWords(line: LineCue, elapsed: number): WordCue[] {
  return line.words.filter((w) => w.start <= elapsed);
}

export interface PlaybackStatus {
  paused: boolean;
  position: number;
  duration: number | null;
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function padRow(content: string, cols: number): string {
  const clipped = content.length > cols ? content.slice(0, cols) : content;
  return clipped + " ".repeat(Math.max(0, cols - clipped.length));
}

function fillPatternRow(cols: number, y: number): string[] {
  return Array.from({ length: cols }, (_, x) => patternChar(x, y));
}

/** Overlay `content` onto a pattern row; spaces in content leave the pattern. */
function compositeRow(pattern: string[], content: string, left: number): string {
  const out = pattern.slice();
  const start = Math.max(0, left);
  for (let i = 0; i < content.length; i++) {
    const x = start + i;
    if (x >= out.length) break;
    const ch = content[i];
    if (ch !== " ") out[x] = ch;
  }
  return out.join("");
}

export class BratRenderer {
  private theme: Theme;
  private entered = false;
  private lastPaint = "";

  constructor(theme: Theme) {
    this.theme = theme;
  }

  enter(): void {
    if (this.entered) return;
    this.entered = true;
    const { bg, fg } = themeColors(this.theme);
    process.stdout.write(HIDE_CURSOR + CLEAR + bg + fg);
  }

  exit(): void {
    if (!this.entered) return;
    this.entered = false;
    process.stdout.write(RESET + SHOW_CURSOR + CLEAR);
  }

  paint(lines: LineCue[], elapsed: number, status?: PlaybackStatus): void {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const { bg, fg } = themeColors(this.theme);

    const footerRows = 2;
    const lyricRows = Math.max(1, rows - footerRows);
    const outlineChar = outlineCharNow();

    const lineIdx = activeLineIndex(lines, elapsed);
    let rendered: string[] = [];

    if (lineIdx >= 0) {
      const line = lines[lineIdx];
      const allTexts = line.words.map((w) => w.text);
      const revealed = revealedWords(line, elapsed).length;
      const budget = rowCellBudget(cols);

      // Pack tighter (more words per row, then no row spacing) until it fits
      for (const perRow of [WORDS_PER_ROW, 4, 5, 6]) {
        rendered = renderBratBlock(
          allTexts,
          revealed,
          budget,
          ROW_SPACING,
          perRow,
          outlineChar,
        );
        if (rendered.length <= lyricRows) break;
      }
      if (rendered.length > lyricRows) {
        rendered = renderBratBlock(allTexts, revealed, budget, 0, 6, outlineChar);
      }
      if (rendered.length > lyricRows) {
        rendered = rendered.slice(0, Math.max(FONT_H, lyricRows));
      }
    }

    const blockWidth = rendered.length > 0 ? rendered[0].length : 0;
    const blockLeft = Math.max(0, Math.floor((cols - blockWidth) / 2));
    const topPad = Math.max(0, Math.floor((lyricRows - rendered.length) * 0.35));
    const outLines: string[] = [];

    for (let r = 0; r < lyricRows; r++) {
      const pattern = fillPatternRow(cols, r);
      const contentIdx = r - topPad;
      if (contentIdx >= 0 && contentIdx < rendered.length) {
        outLines.push(compositeRow(pattern, rendered[contentIdx], blockLeft));
      } else {
        outLines.push(pattern.join(""));
      }
    }

    const state = status?.paused ? "paused" : "playing";
    const pos = formatTime(status?.position ?? elapsed);
    const dur =
      status?.duration != null ? formatTime(status.duration) : "--:--";
    const statusLine = ` ${state}  ${pos} / ${dur}`;
    const controlsLine = " space play/pause   ←/→ ±5s   s stop   q quit";

    // Footer overwrites pattern so controls stay readable
    outLines.push(padRow(statusLine, cols));
    outLines.push(padRow(controlsLine, cols));

    const frame = CLEAR + bg + fg + outLines.join("\n") + RESET;
    if (frame !== this.lastPaint) {
      process.stdout.write(frame);
      this.lastPaint = frame;
    }
  }
}
