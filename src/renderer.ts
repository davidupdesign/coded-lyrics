import type { LineCue, ReactLevel } from "./types.js";
import type { Envelope } from "./envelope.js";
import {
  ATTR_GROUND,
  ATTR_DIM,
  ATTR_INK,
  OUTGOING_MS,
  TRANSITION_MS,
  buildInkGrid,
  dilate,
  fontRows,
  renderBigRow,
  wordCellWidth,
  type CellPaint,
  type WordPaint,
} from "./bigfont.js";
import { SCALE_LADDER, type FontScale } from "./glyphs.js";
import { hash01, hashSeed } from "./hash.js";
import { applyTransition, type TransitionKind } from "./transitions.js";
import { ColorWriter, blend, darken, type Palette } from "./theme.js";

const ESC = "\x1b";
const ALT_SCREEN_ON = `${ESC}[?1049h`;
const ALT_SCREEN_OFF = `${ESC}[?1049l`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR = `${ESC}[2J${ESC}[H`;
const RESET = `${ESC}[0m`;

/** Prefer this many words per wrapped row */
const WORDS_PER_ROW = 4;
/** Blank terminal rows between stacked lyric rows */
const ROW_SPACING = 1;
/** Rows reserved at the bottom for the progress bar and controls */
const FOOTER_ROWS = 2;

/** How long the title card holds before the first lyric */
const TITLE_MS = 2000;
/** Tail of the title card spent fading out */
const TITLE_FADE_MS = 400;

/** Ink stays fattened this long after a kick */
const PULSE_MS = 120;
/** Ground flash decays over this long after a kick */
const FLASH_MS = 80;

/** Eighth-width blocks — 8x the horizontal resolution of a plain bar */
const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
const BAR_FULL = "█";
const BAR_EMPTY = "░";

/** Widest block we allow, given the terminal width. */
export function rowCellBudget(cols: number): number {
  return Math.max(20, Math.min(cols - 4, 160));
}

/** Minimum gap between words, scaled with the glyph size. */
function minWordGap(scale: FontScale): number {
  return Math.max(2, Math.round((scale.subRows * scale.condense) / 3));
}

/**
 * Pack words into short rows (Brat cover rhythm).
 * Sizes are in terminal cells at the given glyph scale.
 */
export function packRows(
  words: string[],
  scale: FontScale,
  budget: number,
  perRow = WORDS_PER_ROW,
): string[][] {
  if (words.length === 0) return [];
  const gap = minWordGap(scale);
  const rows: string[][] = [];
  let current: string[] = [];

  const rowWidth = (row: string[], extra?: string) => {
    const all = extra == null ? row : [...row, extra];
    return (
      all.reduce((n, w) => n + wordCellWidth(w, scale), 0) +
      Math.max(0, all.length - 1) * gap
    );
  };

  for (const word of words) {
    const wouldOverflow =
      current.length >= 1 &&
      (current.length >= perRow || rowWidth(current, word) > budget);
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
    if (last.length === 1 && prev.length < perRow) {
      if (rowWidth(prev, last[0]) <= budget) {
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
  scale: FontScale,
): number[] {
  const gaps = words.length - 1;
  if (gaps <= 0) return [];

  const base = minWordGap(scale);
  const textLen = words.reduce((n, w) => n + wordCellWidth(w, scale), 0);
  const extra = Math.max(0, targetWidth - textLen - gaps * base);

  const gapSizes = Array.from({ length: gaps }, () => base + Math.floor(extra / gaps));

  // Shuffle which gaps absorb the leftover cells, so the rag is uneven.
  const order = Array.from({ length: gaps }, (_, i) => i).sort(
    (a, b) => hashSeed(rowSeed * 13 + a * 7) - hashSeed(rowSeed * 13 + b * 7),
  );
  let remainder = extra % gaps;
  for (const i of order) {
    if (remainder <= 0) break;
    gapSizes[i] += 1;
    remainder -= 1;
  }
  return gapSizes;
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

export interface PlaybackStatus {
  paused: boolean;
  position: number;
  duration: number | null;
}

export interface RendererOptions {
  palette: Palette;
  colors: ColorWriter;
  transition: TransitionKind;
  react: ReactLevel;
  titleCard: boolean;
  envelope: Envelope | null;
  title?: string;
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/** A laid-out block of lyric text, ready to composite onto the ground. */
interface Block extends CellPaint {
  width: number;
}

const EMPTY_BLOCK: Block = { lines: [], attr: [], width: 0 };

/** Word paint state, resolved from playback time before any effect is applied. */
interface WordState {
  /** Transition progress, 0 → 1. Below 0 means not yet revealed. */
  p: number;
  attr: number;
}

export class BratRenderer {
  private readonly opts: RendererOptions;
  private entered = false;
  private prevRows: string[] = [];
  private prevCols = 0;
  private prevScreenRows = 0;

  constructor(opts: RendererOptions) {
    this.opts = opts;
  }

  enter(): void {
    if (this.entered) return;
    this.entered = true;
    process.stdout.write(ALT_SCREEN_ON + HIDE_CURSOR + CLEAR);
  }

  exit(): void {
    if (!this.entered) return;
    this.entered = false;
    process.stdout.write(RESET + SHOW_CURSOR + ALT_SCREEN_OFF);
  }

  paint(lines: LineCue[], elapsed: number, status?: PlaybackStatus): void {
    const cols = process.stdout.columns || 80;
    const screenRows = process.stdout.rows || 24;

    // A resize invalidates every cached row — force one full repaint.
    if (cols !== this.prevCols || screenRows !== this.prevScreenRows) {
      this.prevRows = [];
      this.prevCols = cols;
      this.prevScreenRows = screenRows;
      process.stdout.write(CLEAR);
    }

    const lyricRows = Math.max(1, screenRows - FOOTER_ROWS);
    const budget = rowCellBudget(cols);
    const position = status?.position ?? elapsed;

    const { current, outgoing } = this.selectBlocks(lines, elapsed, lyricRows, budget);

    const out: string[] = [];
    for (let r = 0; r < lyricRows; r++) {
      out.push(this.composeLyricRow(r, lyricRows, cols, position, current, outgoing));
    }
    out.push(this.composeProgressRow(cols, position, status));
    out.push(this.composeControlsRow(cols, status));

    let frame = "";
    for (let r = 0; r < out.length; r++) {
      if (this.prevRows[r] === out[r]) continue;
      frame += `${ESC}[${r + 1};1H${out[r]}`;
      this.prevRows[r] = out[r];
    }
    if (frame.length > 0) {
      process.stdout.write(frame + RESET);
    }
  }

  // ---------------------------------------------------------------- content

  /**
   * Decide what is on screen: the title card, or the active line plus (during
   * the handover window) the previous line dissolving out behind it.
   */
  private selectBlocks(
    lines: LineCue[],
    elapsed: number,
    lyricRows: number,
    budget: number,
  ): { current: Block; outgoing: Block } {
    const titleLine = this.titleLine(lines, elapsed);
    if (titleLine) {
      const age = elapsed * 1000;
      const fade =
        age > TITLE_MS - TITLE_FADE_MS
          ? (age - (TITLE_MS - TITLE_FADE_MS)) / TITLE_FADE_MS
          : null;
      return {
        current: this.renderLine(titleLine, elapsed, lyricRows, budget, fade, 0),
        outgoing: EMPTY_BLOCK,
      };
    }

    const idx = activeLineIndex(lines, elapsed);
    if (idx < 0) return { current: EMPTY_BLOCK, outgoing: EMPTY_BLOCK };

    const pulse = this.pulseAmount(elapsed);
    const current = this.renderLine(
      lines[idx],
      elapsed,
      lyricRows,
      budget,
      null,
      pulse,
    );

    const handover = (elapsed - lines[idx].start) * 1000;
    if (idx > 0 && handover < OUTGOING_MS) {
      const outgoing = this.renderLine(
        lines[idx - 1],
        lines[idx].start,
        lyricRows,
        budget,
        handover / OUTGOING_MS,
        0,
      );
      return { current, outgoing };
    }

    return { current, outgoing: EMPTY_BLOCK };
  }

  /** The synthetic line used for the opening title card, or null. */
  private titleLine(lines: LineCue[], elapsed: number): LineCue | null {
    const title = this.opts.title?.trim();
    if (!this.opts.titleCard || !title) return null;
    if (elapsed * 1000 >= TITLE_MS) return null;
    if (lines.length > 0 && elapsed >= lines[0].start) return null;

    const words = title.split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    return {
      start: 0,
      words: words.map((text, i) => ({ text, start: i * 0.08 })),
    };
  }

  /**
   * Lay out one line at the largest glyph scale that fits, then paint it.
   *
   * `fadeOut` is null for a normal entrance; 0 → 1 dissolves the block away
   * (used by the title card and the outgoing line).
   */
  private renderLine(
    line: LineCue,
    elapsed: number,
    lyricRows: number,
    budget: number,
    fadeOut: number | null,
    pulse: number,
  ): Block {
    const words = line.words.map((w) => w.text.toLowerCase());
    if (words.length === 0) return EMPTY_BLOCK;

    let chosen = SCALE_LADDER[SCALE_LADDER.length - 1];
    let rows: string[][] = [];
    let blockWidth = 0;

    for (const scale of SCALE_LADDER) {
      const packed = packRows(words, scale, budget);
      const gap = minWordGap(scale);
      const width = packed.reduce((widest, row) => {
        const w =
          row.reduce((n, t) => n + wordCellWidth(t, scale), 0) +
          Math.max(0, row.length - 1) * gap;
        return Math.max(widest, w);
      }, 0);
      const height =
        packed.length * fontRows(scale) +
        Math.max(0, packed.length - 1) * ROW_SPACING;

      chosen = scale;
      rows = packed;
      blockWidth = width;
      if (width <= budget && height <= lyricRows) break;
    }

    if (rows.length === 0) return EMPTY_BLOCK;

    const states = this.wordStates(line, elapsed, fadeOut);
    const lines: string[] = [];
    const attr: Uint8Array[] = [];
    let wordOffset = 0;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const rowStart = wordOffset;
      wordOffset += row.length;

      const gaps = bratGaps(row, blockWidth, rowIndex + 1, chosen);
      const painted = renderBigRow(row, gaps, chosen, (i, word, scale) =>
        this.paintWord(word, scale, states[rowStart + i], rowStart + i, pulse),
      );

      // Gaps only exist *between* words, so a lone word can't be justified to
      // the block edges — centre it instead of leaving it hanging off the left.
      const lead =
        row.length === 1
          ? Math.max(0, Math.floor((blockWidth - wordCellWidth(row[0], chosen)) / 2))
          : 0;

      if (lines.length > 0) {
        for (let s = 0; s < ROW_SPACING; s++) {
          lines.push(" ".repeat(blockWidth));
          attr.push(new Uint8Array(blockWidth));
        }
      }

      for (let r = 0; r < painted.lines.length; r++) {
        lines.push(fit(" ".repeat(lead) + painted.lines[r], blockWidth, " "));
        attr.push(shiftAttr(painted.attr[r], lead, blockWidth));
      }
    }

    return trimBlank({ lines, attr, width: blockWidth });
  }

  /** Resolve each word's transition progress from playback time. */
  private wordStates(
    line: LineCue,
    elapsed: number,
    fadeOut: number | null,
  ): WordState[] {
    return line.words.map((cue) => {
      if (fadeOut != null) {
        return { p: 1 - fadeOut, attr: ATTR_DIM };
      }
      if (cue.start > elapsed) return { p: -1, attr: ATTR_INK };
      return {
        p: ((elapsed - cue.start) * 1000) / TRANSITION_MS,
        attr: ATTR_INK,
      };
    });
  }

  private paintWord(
    word: string,
    scale: FontScale,
    state: WordState | undefined,
    seed: number,
    pulse: number,
  ): WordPaint | null {
    if (!state || state.p < 0) return null;

    const kind: TransitionKind =
      state.attr === ATTR_DIM ? "dissolve" : this.opts.transition;
    let ink = buildInkGrid(word, scale);

    // Only settled words pulse — fattening mid-transition fights the effect.
    if (pulse > 0 && state.p >= 1) ink = dilate(ink);

    const result = applyTransition(ink, kind, state.p, seed + 1);
    return { ink: result.ink, hot: result.hot, attr: state.attr };
  }

  // ------------------------------------------------------------- compositing

  private composeLyricRow(
    r: number,
    lyricRows: number,
    cols: number,
    position: number,
    current: Block,
    outgoing: Block,
  ): string {
    const { palette, colors } = this.opts;

    let bg = palette.bg;
    if (palette.scanlines && r % 3 === 2) bg = darken(bg, 0.35);
    const flash = this.flashAmount(position);
    if (flash > 0) bg = blend(bg, palette.inkHot, flash);

    const ramp = colors.inkRamp(palette);
    const groundFg = colors.fg(palette.groundColor);
    const density = this.groundDensity(position);

    // Ground first, then the outgoing block, then the current block on top.
    //
    // The ground dither is keyed on position alone, never on time: rising
    // energy lights more of one *fixed* pattern, so it reads as a texture
    // breathing rather than TV static — and quiet rows stay byte-identical
    // between frames, which is what keeps the row diffing worth having.
    const chars: string[] = new Array(cols);
    const attrs = new Uint8Array(cols);
    for (let x = 0; x < cols; x++) {
      chars[x] =
        palette.groundChar && density > 0 && hash01(x, r, 0) < density
          ? palette.groundChar
          : " ";
      attrs[x] = ATTR_GROUND;
    }

    overlay(chars, attrs, outgoing, r, lyricRows, cols);
    overlay(chars, attrs, current, r, lyricRows, cols);

    return this.emitRow(chars, attrs, colors.bg(bg), ramp, groundFg);
  }

  /** Join cells into one row string, emitting an SGR only when the ink changes. */
  private emitRow(
    chars: string[],
    attrs: Uint8Array,
    bgSgr: string,
    ramp: string[],
    groundFg: string,
  ): string {
    let out = bgSgr;
    let currentAttr = -1;
    for (let x = 0; x < chars.length; x++) {
      const a = attrs[x];
      if (a !== currentAttr) {
        out += a === ATTR_GROUND ? groundFg : ramp[a];
        currentAttr = a;
      }
      out += chars[x];
    }
    return out;
  }

  // ---------------------------------------------------------------- reactive

  private pulseAmount(position: number): number {
    const env = this.opts.envelope;
    if (!env || this.opts.react === "off") return 0;
    const age = env.kickAgeAt(position);
    return age * 1000 < PULSE_MS ? 1 : 0;
  }

  private flashAmount(position: number): number {
    const env = this.opts.envelope;
    if (!env || this.opts.react === "off") return 0;
    const age = env.kickAgeAt(position) * 1000;
    if (age >= FLASH_MS) return 0;
    const peak = this.opts.react === "full" ? 0.22 : 0.1;
    return (1 - age / FLASH_MS) * peak;
  }

  private groundDensity(position: number): number {
    const { palette, react, envelope } = this.opts;
    if (!palette.groundChar) return 0;
    if (!envelope || react === "off") return 0.05;
    const scale = react === "full" ? 0.45 : 0.25;
    return 0.05 + envelope.energyAt(position) * scale;
  }

  // ------------------------------------------------------------------ footer

  private composeProgressRow(
    cols: number,
    position: number,
    status?: PlaybackStatus,
  ): string {
    const { palette, colors } = this.opts;
    const duration = status?.duration ?? null;
    const bg = colors.bg(palette.bg);
    const dim = colors.fg(palette.inkDim);
    const ink = colors.fg(palette.ink);

    // Below this the labels would push the row past the terminal edge and wrap,
    // so drop them and give the whole width to the bar.
    const labelled = cols >= 20;
    const pos = labelled ? formatTime(position) : "";
    const dur = labelled ? (duration != null ? formatTime(duration) : "--:--") : "";
    const chrome = labelled ? pos.length + dur.length + 4 : 0;

    const barWidth = Math.max(0, cols - chrome);
    const frac =
      duration != null && duration > 0
        ? Math.max(0, Math.min(1, position / duration))
        : 0;

    const exact = frac * barWidth;
    const full = Math.floor(exact);
    const eighth = Math.floor((exact - full) * 8);

    let bar = BAR_FULL.repeat(Math.min(full, barWidth));
    if (full < barWidth) {
      bar += EIGHTHS[eighth];
      bar += BAR_EMPTY.repeat(Math.max(0, barWidth - full - (eighth > 0 ? 1 : 0)));
    }

    // The played head is bright; the remainder stays dim.
    const headLen = full + (eighth > 0 ? 1 : 0);
    const played = bar.slice(0, headLen);
    const rest = bar.slice(headLen);

    return labelled
      ? `${bg}${dim} ${pos} ${ink}${played}${dim}${rest} ${dur} `
      : `${bg}${ink}${played}${dim}${rest}`;
  }

  private composeControlsRow(cols: number, status?: PlaybackStatus): string {
    const { palette, colors } = this.opts;
    const state = status?.paused ? "❚❚ paused" : "▶ playing";
    const text = ` ${state}   space play/pause   ←/→ ±5s   s stop   q quit`;
    const clipped = [...text].slice(0, cols).join("");
    const pad = " ".repeat(Math.max(0, cols - [...clipped].length));
    return colors.bg(palette.bg) + colors.fg(palette.inkDim) + clipped + pad;
  }
}

// ------------------------------------------------------------------ helpers

function fit(line: string, width: number, filler: string): string {
  const chars = [...line];
  if (chars.length >= width) return chars.slice(0, width).join("");
  return line + filler.repeat(width - chars.length);
}

function shiftAttr(attr: Uint8Array, lead: number, width: number): Uint8Array {
  if (lead === 0 && attr.length === width) return attr;
  const out = new Uint8Array(width);
  const take = Math.min(attr.length, width - lead);
  if (take > 0) out.set(attr.subarray(0, take), lead);
  return out;
}

/**
 * Drop fully blank rows from the top and bottom of a block.
 *
 * A glyph always reserves its ascender and descender cells, so a word like
 * "cool as" carries an empty terminal row underneath it. Trimming the outer
 * ones reclaims that space for the fit ladder without disturbing the baseline
 * alignment between rows inside the block.
 */
function trimBlank(block: Block): Block {
  let first = 0;
  let last = block.lines.length - 1;
  const blank = (s: string) => s.trim().length === 0;
  while (first <= last && blank(block.lines[first])) first++;
  while (last >= first && blank(block.lines[last])) last--;
  if (first === 0 && last === block.lines.length - 1) return block;
  return {
    lines: block.lines.slice(first, last + 1),
    attr: block.attr.slice(first, last + 1),
    width: block.width,
  };
}

/** Draw a centered block onto a row's cell buffer, skipping blank cells. */
function overlay(
  chars: string[],
  attrs: Uint8Array,
  block: Block,
  r: number,
  lyricRows: number,
  cols: number,
): void {
  if (block.lines.length === 0) return;

  const topPad = Math.max(0, Math.floor((lyricRows - block.lines.length) * 0.4));
  const idx = r - topPad;
  if (idx < 0 || idx >= block.lines.length) return;

  const left = Math.max(0, Math.floor((cols - block.width) / 2));
  const line = [...block.lines[idx]];
  const rowAttr = block.attr[idx];

  for (let i = 0; i < line.length; i++) {
    const x = left + i;
    if (x >= cols) break;
    if (line[i] === " ") continue;
    chars[x] = line[i];
    attrs[x] = rowAttr[i];
  }
}
