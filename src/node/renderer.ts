/**
 * Terminal output.
 *
 * The picture itself is composed in `core/compose.ts`; everything here is about
 * getting it onto a terminal — encoding cells as SGR runs, tracking the screen
 * size, and re-sending only the rows that actually changed.
 *
 * Two things keep the byte count down at 30 fps: an escape is emitted only when
 * a cell's attribute differs from its neighbour's, and a row is only sent when
 * it differs from what is already on screen. Between them, a still frame over a
 * quiet passage costs almost nothing.
 */
import {
  FrameCompositor,
  activeLineIndex,
  type ComposeConfig,
  type Frame,
} from "../core/compose.js";
import type { Envelope, PlaybackStatus, VideoSource } from "../core/ports.js";
import type { Palette, RGB } from "../core/palette.js";
import type { LineCue, ReactLevel } from "../core/types.js";
import type { TransitionKind } from "../core/transitions.js";
import {
  ALT_SCREEN_OFF,
  ALT_SCREEN_ON,
  CLEAR,
  ESC,
  HIDE_CURSOR,
  RESET,
  SHOW_CURSOR,
  ColorWriter,
} from "./ansi.js";

export type { PlaybackStatus };
export { activeLineIndex };

export interface RendererOptions {
  palette: Palette;
  colors: ColorWriter;
  transition: TransitionKind;
  react: ReactLevel;
  titleCard: boolean;
  envelope: Envelope | null;
  video: VideoSource | null;
  /** Knock the video out behind the lyric so plain text stays readable. */
  plate: boolean;
  /** Brightness multiplier applied to the video before the ramp lookup. */
  videoGain: number;
  title?: string;
}

export class AnsiRenderer {
  private readonly colors: ColorWriter;
  private readonly palette: Palette;
  private readonly envelope: Envelope | null;
  private readonly video: VideoSource | null;
  private readonly compositor: FrameCompositor;

  private entered = false;
  private prevRows: string[] = [];
  private prevCols = 0;
  private prevScreenRows = 0;
  private cachedRamp: string[] | null = null;

  constructor(opts: RendererOptions) {
    this.colors = opts.colors;
    this.palette = opts.palette;
    this.envelope = opts.envelope;
    this.video = opts.video;

    const cfg: ComposeConfig = {
      palette: opts.palette,
      transition: opts.transition,
      react: opts.react,
      titleCard: opts.titleCard,
      title: opts.title,
      plate: opts.plate,
      videoGain: opts.videoGain,
    };
    this.compositor = new FrameCompositor(cfg);
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

    const frame = this.compositor.compose({
      cols,
      rows: screenRows,
      lines,
      elapsed,
      status,
      video: this.video,
      envelope: this.envelope,
    });

    let out = "";
    for (let r = 0; r < frame.rows; r++) {
      const row = this.emitRow(frame, r);
      if (this.prevRows[r] === row) continue;
      out += `${ESC}[${r + 1};1H${row}`;
      this.prevRows[r] = row;
    }
    if (out.length > 0) {
      process.stdout.write(out + RESET);
    }
  }

  /** Join a row's cells, emitting an SGR only when the attribute changes. */
  private emitRow(frame: Frame, r: number): string {
    const ramp = this.attrSgr();
    const { cols, ids, attrs, charset } = frame;
    const off = r * cols;
    const bg: RGB = [
      frame.rowBg[r * 3],
      frame.rowBg[r * 3 + 1],
      frame.rowBg[r * 3 + 2],
    ];

    let out = this.colors.bg(bg);
    let currentAttr = -1;
    for (let x = 0; x < cols; x++) {
      const a = attrs[off + x];
      if (a !== currentAttr) {
        out += ramp[a];
        currentAttr = a;
      }
      out += charset.text(ids[off + x]);
    }
    return out;
  }

  private attrSgr(): string[] {
    if (!this.cachedRamp) {
      this.cachedRamp = this.colors.attrRamp(this.palette);
    }
    return this.cachedRamp;
  }
}
