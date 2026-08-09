/**
 * Frame composition — everything between "where are we in the track" and "what
 * is in each cell".
 *
 * This is the whole picture as a pure function of playback position: the video
 * resampled onto the grid, the active lyric wiped in over the top, the previous
 * line dissolving out behind it, and the footer. What it does not do is decide
 * how a cell becomes visible — the terminal turns these buffers into escape
 * sequences, a browser turns them into glyph blits, and neither concern leaks in
 * here.
 *
 * Purity in `position` is load-bearing, not incidental. Every effect draws its
 * randomness from `hash01` keyed on cell coordinates, never on a frame counter
 * or wall clock, so scrubbing to the same second twice paints the same frame.
 */
import { buildRampTable, buildSampler, DEFAULT_CELL_ASPECT, DEFAULT_GAMMA, type RampTable, type Sampler } from "./ascii.js";
import { Charset } from "./charset.js";
import { hash01 } from "./hash.js";
import {
  ATTR_DIM,
  ATTR_GROUND,
  ATTR_HOT,
  ATTR_INK,
  ATTR_VIDEO_0,
  blend,
  darken,
  type Palette,
  type RGB,
} from "./palette.js";
import type { Envelope, PlaybackStatus, VideoSource } from "./ports.js";
import {
  NO_WORD,
  OUTGOING_MS,
  layoutLine,
  wordStates,
  type TextRow,
  type WordState,
} from "./text.js";
import {
  packCell,
  subcellAspect,
  subcellChars,
  subcellShape,
  type PackedCell,
  type SubcellMode,
} from "./subcell.js";
import { applyTransition, type TransitionKind } from "./transitions.js";
import type { LineCue, ReactLevel } from "./types.js";

/** Rows reserved at the bottom for the progress bar and controls. */
export const DEFAULT_FOOTER_ROWS = 2;
/** Blank cells kept clear either side of the lyric so the video can't crowd it. */
export const DEFAULT_PLATE_PAD = 2;
/** Widest a lyric line may run, whatever the grid allows. */
export const DEFAULT_LYRIC_MAX_CHARS = 120;

/** How long the title card holds before the first lyric. */
const TITLE_MS = 2000;
/** Tail of the title card spent fading out. */
const TITLE_FADE_MS = 400;

/** Video brightness is lifted this long after a kick. */
const PULSE_MS = 120;
/** Ground flash decays over this long after a kick. */
const FLASH_MS = 80;

const BAR_FULL = "#";
const BAR_EMPTY = "-";

export interface ComposeConfig {
  palette: Palette;
  transition: TransitionKind;
  react: ReactLevel;
  titleCard: boolean;
  title?: string;
  /** Knock the video out behind the lyric so plain text stays readable. */
  plate: boolean;
  /** Brightness multiplier applied to the video before the ramp lookup. */
  videoGain: number;

  /** Cell height ÷ cell width. 2 is a terminal; a browser picks its own. */
  cellAspect?: number;
  gamma?: number;
  lyricMaxChars?: number;
  platePad?: number;
  footerRows?: number;
  /**
   * Cells each lyric character spans, in both directions.
   *
   * This is what lets the picture get finer without the words getting smaller:
   * at 1 a character is one cell, as in a terminal, and above 1 the lyric is
   * emitted as `lyricLayer` draws instead of cells, so its size stops depending
   * on how dense the grid is. A host that can only paint cells ignores the
   * layer, which is why the terminal pins this at 1.
   */
  lyricScale?: number;
  /**
   * Divide each cell with block-drawing characters for more detail per cell.
   * The terminal leaves this off: it needs a font with good block coverage, and
   * a per-cell background it does not currently emit.
   */
  subcell?: SubcellMode;
  /**
   * Ceiling on the kick flash, 0–1. Dropping it to 0 removes a full-screen
   * luminance flash, which is the accessible default under reduced-motion.
   */
  flashCap?: number;
}

type Resolved = Required<Omit<ComposeConfig, "title">> & { title?: string };

function resolve(cfg: ComposeConfig): Resolved {
  return {
    ...cfg,
    cellAspect: cfg.cellAspect ?? DEFAULT_CELL_ASPECT,
    gamma: cfg.gamma ?? DEFAULT_GAMMA,
    lyricMaxChars: cfg.lyricMaxChars ?? DEFAULT_LYRIC_MAX_CHARS,
    platePad: cfg.platePad ?? DEFAULT_PLATE_PAD,
    footerRows: cfg.footerRows ?? DEFAULT_FOOTER_ROWS,
    flashCap: cfg.flashCap ?? 1,
    lyricScale: Math.max(1, Math.round(cfg.lyricScale ?? 1)),
    subcell: cfg.subcell ?? "off",
  };
}

export interface FrameInput {
  cols: number;
  /** Grid height including the footer. */
  rows: number;
  lines: LineCue[];
  /** Drives the lyric animation. */
  elapsed: number;
  status?: PlaybackStatus;
  video: VideoSource | null;
  envelope: Envelope | null;
}

/** One oversized lyric glyph, positioned in cells. */
export interface LyricDraw {
  id: number;
  attr: number;
  /** Top-left cell. The glyph covers `scale × scale` cells from here. */
  col: number;
  row: number;
  scale: number;
}

export interface Frame {
  cols: number;
  /** Rows actually composed: `lyricRows + footerRows`. */
  rows: number;
  lyricRows: number;
  charset: Charset;
  /** `cols * rows` glyph ids. */
  ids: Uint16Array;
  /**
   * `cols * rows` attribute indices. Written for every cell, blanks included —
   * a space still carries the attribute of whatever it belongs to, and the
   * terminal's run-length encoding depends on that.
   */
  attrs: Uint8Array;
  /** `rows * 3` background colour per row, after scanlines and kick flash. */
  rowBg: Uint8Array;
  /**
   * Lyric glyphs larger than one cell, or null when `lyricScale` is 1 and the
   * words went into `ids` like everything else.
   */
  lyricLayer: LyricDraw[] | null;
}

/**
 * Widest a lyric line may run, in characters, given the grid.
 *
 * At a scale above 1 each character eats that many columns, so the character
 * budget shrinks accordingly — which is the whole point: a 320-column grid at
 * scale 4 holds about 78 readable characters rather than 120 unreadable ones.
 */
export function textWidth(
  cols: number,
  platePad: number,
  maxChars: number,
  scale = 1,
): number {
  const usable = Math.floor((cols - 2 * (platePad + 1)) / Math.max(1, scale));
  return Math.max(8, Math.min(usable, maxChars));
}

/** Active line = last line whose start <= elapsed. */
export function activeLineIndex(lines: LineCue[], elapsed: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start <= elapsed) idx = i;
    else break;
  }
  return idx;
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/** One laid-out lyric row, positioned and painted. */
interface PaintedRow {
  chars: string[];
  attrs: Uint8Array;
  /** Column the row starts at. */
  left: number;
}

interface Block {
  rows: PaintedRow[];
}

const EMPTY_BLOCK: Block = { rows: [] };

/** A ramp table with its characters pre-resolved to glyph ids. */
interface RampIds {
  table: RampTable;
  ids: Uint16Array;
}

export class FrameCompositor {
  readonly charset = new Charset();

  private cfg: Resolved;
  private rampBase: RampIds;
  private rampKick: RampIds;

  private groundId = 0;

  /** Rebuilt on any grid change — the video→cell mapping depends only on it. */
  private sampler: Sampler | null = null;
  private samplerKey = "";
  private lum = new Uint8Array(0);
  private lumValid = false;
  /** Dimensions of `lum`, which is finer than the cell grid under a sub-cell mode. */
  private subW = 0;
  private subH = 0;
  private readonly packed: PackedCell = { char: null, value: 0 };

  /** Plate span (from, to) per lyric row, for the scaled path. */
  private plate = new Int32Array(0);

  private ids = new Uint16Array(0);
  private attrs = new Uint8Array(0);
  private rowBg = new Uint8Array(0);
  private capacity = 0;

  constructor(cfg: ComposeConfig) {
    this.cfg = resolve(cfg);
    this.rampBase = this.buildRamp(1);
    this.rampKick = this.buildRamp(this.kickGain());
    this.syncGroundId();
    this.reserveSubcellGlyphs();
  }

  /** Apply a settings change, dropping anything derived from the old one. */
  reconfigure(patch: Partial<ComposeConfig>): void {
    this.cfg = resolve({ ...this.cfg, ...patch });
    this.rampBase = this.buildRamp(1);
    this.rampKick = this.buildRamp(this.kickGain());
    this.syncGroundId();
    this.reserveSubcellGlyphs();
    this.sampler = null;
    this.samplerKey = "";
  }

  get config(): Readonly<Resolved> {
    return this.cfg;
  }

  private kickGain(): number {
    // A kick lifts the whole picture rather than fattening strokes, which is
    // what the block font used to do with `dilate`.
    return this.cfg.react === "full" ? 1.7 : 1.35;
  }

  private buildRamp(kick: number): RampIds {
    const table = buildRampTable(this.cfg.videoGain * kick, this.cfg.gamma);
    const ids = new Uint16Array(256);
    for (let v = 0; v < 256; v++) ids[v] = this.charset.intern(table.chars[v]);
    return { table, ids };
  }

  /**
   * Reserve every glyph the current sub-cell mode can emit.
   *
   * Interning lazily would work, but each new glyph invalidates the browser's
   * atlas — so a pan across a detailed shot would rebuild it repeatedly instead
   * of once.
   */
  private reserveSubcellGlyphs(): void {
    for (const ch of subcellChars(this.cfg.subcell)) this.charset.intern(ch);
  }

  private syncGroundId(): void {
    const ch = this.cfg.palette.groundChar;
    this.groundId = ch ? this.charset.intern(ch) : Charset.SPACE;
  }

  compose(input: FrameInput): Frame {
    const { cols } = input;
    const lyricRows = Math.max(1, input.rows - this.cfg.footerRows);
    const rows = lyricRows + this.cfg.footerRows;
    const position = input.status?.position ?? input.elapsed;

    const cells = cols * rows;
    if (cells > this.capacity) {
      this.ids = new Uint16Array(cells);
      this.attrs = new Uint8Array(cells);
      this.capacity = cells;
    }
    if (this.rowBg.length < rows * 3) this.rowBg = new Uint8Array(rows * 3);

    this.sampleVideo(input.video, cols, lyricRows, position);
    const { current, outgoing } = this.selectBlocks(input.lines, input.elapsed, cols);

    // Above scale 1 the words are too big to live in cells, so they become draw
    // commands and the grid only gets the plate knocked out from under them.
    const scaled = this.cfg.lyricScale > 1;
    let lyricLayer: LyricDraw[] | null = null;
    if (scaled) {
      lyricLayer = [];
      this.resetPlate(lyricRows);
      this.planScaled(outgoing, lyricRows, cols, lyricLayer);
      this.planScaled(current, lyricRows, cols, lyricLayer);
    }

    for (let r = 0; r < lyricRows; r++) {
      const bg = this.composeLyricRow(
        r, lyricRows, cols, position, scaled ? EMPTY_BLOCK : current,
        scaled ? EMPTY_BLOCK : outgoing, input.envelope,
      );
      if (scaled) this.applyPlate(r, cols);
      this.setRowBg(r, bg);
    }
    if (this.cfg.footerRows > 0) {
      this.composeProgressRow(lyricRows, cols, position, input.status);
      this.setRowBg(lyricRows, this.cfg.palette.bg);
    }
    if (this.cfg.footerRows > 1) {
      this.composeControlsRow(lyricRows + 1, cols, input.status);
      this.setRowBg(lyricRows + 1, this.cfg.palette.bg);
    }

    return {
      cols,
      rows,
      lyricRows,
      charset: this.charset,
      lyricLayer,
      ids: this.ids,
      attrs: this.attrs,
      rowBg: this.rowBg,
    };
  }

  private setRowBg(r: number, c: RGB): void {
    this.rowBg[r * 3] = c[0];
    this.rowBg[r * 3 + 1] = c[1];
    this.rowBg[r * 3 + 2] = c[2];
  }

  // ---------------------------------------------------------------- content

  /**
   * Decide what is on screen: the title card, or the active line plus (during
   * the handover window) the previous line dissolving out behind it.
   */
  private selectBlocks(
    lines: LineCue[],
    elapsed: number,
    cols: number,
  ): { current: Block; outgoing: Block } {
    const titleLine = this.titleLine(lines, elapsed);
    if (titleLine) {
      const age = elapsed * 1000;
      const fade =
        age > TITLE_MS - TITLE_FADE_MS
          ? (age - (TITLE_MS - TITLE_FADE_MS)) / TITLE_FADE_MS
          : null;
      return {
        current: this.renderBlock(titleLine, elapsed, cols, fade),
        outgoing: EMPTY_BLOCK,
      };
    }

    const idx = activeLineIndex(lines, elapsed);
    if (idx < 0) return { current: EMPTY_BLOCK, outgoing: EMPTY_BLOCK };

    const current = this.renderBlock(lines[idx], elapsed, cols, null);

    const handover = (elapsed - lines[idx].start) * 1000;
    if (idx > 0 && handover < OUTGOING_MS) {
      const outgoing = this.renderBlock(
        lines[idx - 1],
        lines[idx].start,
        cols,
        handover / OUTGOING_MS,
      );
      return { current, outgoing };
    }

    return { current, outgoing: EMPTY_BLOCK };
  }

  /** The synthetic line used for the opening title card, or null. */
  private titleLine(lines: LineCue[], elapsed: number): LineCue | null {
    const title = this.cfg.title?.trim();
    if (!this.cfg.titleCard || !title) return null;
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
   * Wrap a line to the grid, then paint each word through the transition.
   *
   * `fadeOut` is null for a normal entrance; 0 → 1 dissolves the block away
   * (used by the title card and the outgoing line).
   */
  private renderBlock(
    line: LineCue,
    elapsed: number,
    cols: number,
    fadeOut: number | null,
  ): Block {
    const words = line.words.map((w) => w.text.toLowerCase());
    if (words.length === 0) return EMPTY_BLOCK;

    const width = textWidth(
      cols, this.cfg.platePad, this.cfg.lyricMaxChars, this.cfg.lyricScale,
    );
    const textRows = layoutLine(words, width);
    if (textRows.length === 0) return EMPTY_BLOCK;

    const states = wordStates(line, elapsed, fadeOut);
    return {
      rows: textRows.map((row) => this.paintRow(row, states, cols)),
    };
  }

  /**
   * Paint one wrapped row. Each word is transitioned independently against its
   * own cue time, so the row fills in word by word rather than all at once.
   */
  private paintRow(row: TextRow, states: WordState[], cols: number): PaintedRow {
    const width = row.text.length;
    const chars: string[] = new Array(width).fill(" ");
    const attrs = new Uint8Array(width);
    const source = [...row.text];

    let i = 0;
    while (i < width) {
      const word = row.owner[i];
      if (word === NO_WORD) {
        i++;
        continue;
      }

      // A word occupies exactly one contiguous span — layoutLine never splits it.
      let end = i;
      while (end < width && row.owner[end] === word) end++;

      const state = states[word];
      if (state && state.p >= 0) {
        const kind: TransitionKind =
          state.attr === ATTR_DIM ? "dissolve" : this.cfg.transition;
        const mask = [Array.from({ length: end - i }, () => true)];
        const { ink, hot } = applyTransition(mask, kind, state.p, word + 1);

        for (let x = 0; x < end - i; x++) {
          if (!ink[0][x]) continue;
          chars[i + x] = source[i + x];
          attrs[i + x] = hot?.[0][x] ? ATTR_HOT : state.attr;
        }
      }
      i = end;
    }

    return { chars, attrs, left: Math.max(0, Math.floor((cols - width) / 2)) };
  }

  // ------------------------------------------------------------- compositing

  /**
   * Resample the current video frame, once per compose.
   *
   * With a sub-cell mode the grid sampled is finer than the cell grid — that
   * extra resolution is exactly what the block characters spend — so the
   * sampler is built for the sub-grid and told the sub-sample's own shape.
   */
  private sampleVideo(
    video: VideoSource | null,
    cols: number,
    lyricRows: number,
    position: number,
  ): void {
    this.lumValid = false;
    if (!video) return;

    const frame = video.frameAt(position);
    if (!frame) return;

    const shape = subcellShape(this.cfg.subcell);
    const subW = cols * shape.sx;
    const subH = lyricRows * shape.sy;
    const aspect = subcellAspect(this.cfg.cellAspect, shape);

    const key = `${subW}x${subH}x${video.width}x${video.height}x${aspect}`;
    if (!this.sampler || this.samplerKey !== key) {
      this.sampler = buildSampler(subW, subH, video.width, video.height, aspect);
      this.samplerKey = key;
      this.lum = new Uint8Array(subW * subH);
    }
    this.sampler.sample(frame, this.lum);
    this.subW = subW;
    this.subH = subH;
    this.lumValid = true;
  }

  /** Fill one row's cells from the sampled video. */
  private paintVideoRow(r: number, cols: number, off: number, scanline: boolean, kick: boolean): void {
    const ramp = kick ? this.rampKick : this.rampBase;
    const mode = this.cfg.subcell;

    if (mode === "off") {
      const src = r * cols;
      for (let x = 0; x < cols; x++) {
        const v = this.lum[src + x];
        this.ids[off + x] = ramp.ids[v];
        // Scanlines drop the video a tier as well as darkening the ground — the
        // characters carry most of the picture, so dimming bg alone barely shows
        // through a dense frame.
        const tier = ATTR_VIDEO_0 + ramp.table.tiers[v];
        this.attrs[off + x] = scanline ? Math.max(ATTR_VIDEO_0, tier - 1) : tier;
      }
      return;
    }

    const packed = this.packed;
    for (let x = 0; x < cols; x++) {
      packCell(mode, this.lum, this.subW, this.subH, x, r, packed);
      const v = Math.min(255, Math.max(0, Math.round(packed.value)));
      // A flat cell has no shape to draw, so it falls back to the density ramp.
      this.ids[off + x] =
        packed.char === null ? ramp.ids[v] : this.charset.intern(packed.char);
      const tier = ATTR_VIDEO_0 + ramp.table.tiers[v];
      this.attrs[off + x] = scanline ? Math.max(ATTR_VIDEO_0, tier - 1) : tier;
    }
  }

  private composeLyricRow(
    r: number,
    lyricRows: number,
    cols: number,
    position: number,
    current: Block,
    outgoing: Block,
    envelope: Envelope | null,
  ): RGB {
    const { palette } = this.cfg;
    const scanline = palette.scanlines && r % 3 === 2;

    let bg = palette.bg;
    if (scanline) bg = darken(bg, 0.35);
    const flash = this.flashAmount(position, envelope);
    if (flash > 0) bg = blend(bg, palette.inkHot, flash);

    const off = r * cols;

    if (this.lumValid) {
      this.paintVideoRow(r, cols, off, scanline, this.pulsing(position, envelope));
    } else {
      // No video: the palette's own ground, dithered by the audio energy.
      //
      // The dither is keyed on position alone, never on time: rising energy
      // lights more of one *fixed* pattern, so it reads as a texture breathing
      // rather than TV static — and quiet rows stay byte-identical between
      // frames, which is what keeps the terminal's row diffing worth having.
      const density = this.groundDensity(position, envelope);
      const lit = palette.groundChar != null && density > 0;
      for (let x = 0; x < cols; x++) {
        this.ids[off + x] =
          lit && hash01(x, r, 0) < density ? this.groundId : Charset.SPACE;
        this.attrs[off + x] = ATTR_GROUND;
      }
    }

    this.overlay(outgoing, r, lyricRows, cols, off);
    this.overlay(current, r, lyricRows, cols, off);

    return bg;
  }

  // ------------------------------------------------------------ lyric scale

  /**
   * Clear the plate spans. `-1` marks a row the lyric does not reach.
   *
   * The plate is tracked separately from the glyphs because at scale it spans
   * several grid rows per line of text, and each of those rows is composed
   * independently.
   */
  private resetPlate(lyricRows: number): void {
    if (this.plate.length < lyricRows * 2) this.plate = new Int32Array(lyricRows * 2);
    this.plate.fill(-1, 0, lyricRows * 2);
  }

  private applyPlate(r: number, cols: number): void {
    if (!this.cfg.plate) return;
    const from = this.plate[r * 2];
    if (from < 0) return;
    const to = Math.min(cols, this.plate[r * 2 + 1]);
    const off = r * cols;
    for (let x = Math.max(0, from); x < to; x++) {
      this.ids[off + x] = Charset.SPACE;
      this.attrs[off + x] = ATTR_GROUND;
    }
  }

  /**
   * Turn a block into oversized draws, and record the plate it needs.
   *
   * Laid out in cells throughout: a character at scale S occupies an S×S cell
   * square, so the block is `rows * S` cells tall and centred as one piece.
   */
  private planScaled(
    block: Block,
    lyricRows: number,
    cols: number,
    out: LyricDraw[],
  ): void {
    if (block.rows.length === 0) return;
    const scale = this.cfg.lyricScale;
    const pad = this.cfg.platePad;

    const blockRows = block.rows.length * scale;
    const topPad = Math.max(0, Math.floor((lyricRows - blockRows) / 2));

    block.rows.forEach((row, ri) => {
      const width = row.chars.length * scale;
      const left = Math.max(0, Math.floor((cols - width) / 2));
      const top = topPad + ri * scale;

      for (let dr = 0; dr < scale; dr++) {
        const r = top + dr;
        if (r < 0 || r >= lyricRows) continue;
        const from = Math.max(0, left - pad);
        const to = Math.min(cols, left + width + pad);
        // Blocks are drawn back to front, so a later one only widens the plate.
        const had = this.plate[r * 2];
        this.plate[r * 2] = had < 0 ? from : Math.min(had, from);
        this.plate[r * 2 + 1] = Math.max(this.plate[r * 2 + 1], to);
      }

      for (let i = 0; i < row.chars.length; i++) {
        const ch = row.chars[i];
        if (ch === " ") continue;
        const col = left + i * scale;
        if (col >= cols) break;
        out.push({ id: this.charset.intern(ch), attr: row.attrs[i], col, row: top, scale });
      }
    });
  }

  /** Draw a vertically centred block onto a row's cells. */
  private overlay(
    block: Block,
    r: number,
    lyricRows: number,
    cols: number,
    off: number,
  ): void {
    if (block.rows.length === 0) return;

    const topPad = Math.max(0, Math.floor((lyricRows - block.rows.length) / 2));
    const row = block.rows[r - topPad];
    if (!row) return;

    // Clear a strip first, including the not-yet-revealed cells: plain text at
    // one cell per character is unreadable over a dense ASCII field, and a
    // plate that grew with the wipe would ripple instead of holding still.
    if (this.cfg.plate) {
      const from = Math.max(0, row.left - this.cfg.platePad);
      const to = Math.min(cols, row.left + row.chars.length + this.cfg.platePad);
      for (let x = from; x < to; x++) {
        this.ids[off + x] = Charset.SPACE;
        this.attrs[off + x] = ATTR_GROUND;
      }
    }

    for (let i = 0; i < row.chars.length; i++) {
      const x = row.left + i;
      if (x >= cols) break;
      if (row.chars[i] === " ") continue;
      this.ids[off + x] = this.charset.intern(row.chars[i]);
      this.attrs[off + x] = row.attrs[i];
    }
  }

  // ---------------------------------------------------------------- reactive

  private pulsing(position: number, envelope: Envelope | null): boolean {
    if (!envelope || this.cfg.react === "off") return false;
    return envelope.kickAgeAt(position) * 1000 < PULSE_MS;
  }

  private flashAmount(position: number, envelope: Envelope | null): number {
    if (!envelope || this.cfg.react === "off") return 0;
    const age = envelope.kickAgeAt(position) * 1000;
    if (age >= FLASH_MS) return 0;
    const peak = this.cfg.react === "full" ? 0.22 : 0.1;
    return (1 - age / FLASH_MS) * peak * this.cfg.flashCap;
  }

  private groundDensity(position: number, envelope: Envelope | null): number {
    const { palette, react } = this.cfg;
    if (!palette.groundChar) return 0;
    if (!envelope || react === "off") return 0.05;
    const scale = react === "full" ? 0.45 : 0.25;
    return 0.05 + envelope.energyAt(position) * scale;
  }

  // ------------------------------------------------------------------ footer

  /** Write a run of text into a row, one cell per character. */
  private write(off: number, x: number, text: string, attr: number, cols: number): number {
    for (const ch of text) {
      if (x >= cols) break;
      this.ids[off + x] = this.charset.intern(ch);
      this.attrs[off + x] = attr;
      x++;
    }
    return x;
  }

  private composeProgressRow(
    r: number,
    cols: number,
    position: number,
    status?: PlaybackStatus,
  ): void {
    const off = r * cols;
    const duration = status?.duration ?? null;

    // Below this the labels would push the row past the grid edge and wrap, so
    // drop them and give the whole width to the bar.
    const labelled = cols >= 24;
    const pos = labelled ? formatTime(position) : "";
    const dur = labelled ? (duration != null ? formatTime(duration) : "--:--") : "";
    // " m:ss [" + bar + "] m:ss " when labelled, else "[" + bar + "]".
    const chrome = labelled ? pos.length + dur.length + 6 : 2;

    const barWidth = Math.max(0, cols - chrome);
    const frac =
      duration != null && duration > 0
        ? Math.max(0, Math.min(1, position / duration))
        : 0;

    const head = Math.round(frac * barWidth);
    const played = BAR_FULL.repeat(head);
    const rest = BAR_EMPTY.repeat(Math.max(0, barWidth - head));

    let x = 0;
    if (labelled) {
      x = this.write(off, x, ` ${pos} [`, ATTR_DIM, cols);
      x = this.write(off, x, played, ATTR_INK, cols);
      x = this.write(off, x, `${rest}] ${dur} `, ATTR_DIM, cols);
    } else {
      x = this.write(off, x, "[", ATTR_DIM, cols);
      x = this.write(off, x, played, ATTR_INK, cols);
      x = this.write(off, x, `${rest}]`, ATTR_DIM, cols);
    }
    for (; x < cols; x++) {
      this.ids[off + x] = Charset.SPACE;
      this.attrs[off + x] = ATTR_DIM;
    }
  }

  private composeControlsRow(r: number, cols: number, status?: PlaybackStatus): void {
    const off = r * cols;
    const state = status?.paused ? "|| paused" : ">  playing";
    const text = ` ${state}   space play/pause   <-/-> +-5s   s stop   q quit`;

    let x = this.write(off, 0, text, ATTR_DIM, cols);
    for (; x < cols; x++) {
      this.ids[off + x] = Charset.SPACE;
      this.attrs[off + x] = ATTR_DIM;
    }
  }
}

