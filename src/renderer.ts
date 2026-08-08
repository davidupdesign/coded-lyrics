import type { LineCue, Theme, WordCue } from "./types.js";

const ESC = "\x1b";
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR = `${ESC}[2J${ESC}[H`;
const RESET = `${ESC}[0m`;

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

/** Deterministic irregular gap (1–5 spaces) — Brat-style */
export function irregularGap(wordIndex: number): string {
  let h = (wordIndex + 1) * 2654435761;
  h ^= h >>> 16;
  const r = (h >>> 0) % 10;
  const count = r < 3 ? 1 : r < 6 ? 2 : r < 8 ? 3 : r < 9 ? 4 : 5;
  return " ".repeat(count);
}

export interface LayoutWord {
  text: string;
  index: number;
}

/**
 * Soft-wrap words into short Brat-like lines (target ~18–28 visible cols).
 */
export function layoutLines(
  words: LayoutWord[],
  maxWidth = 28,
): LayoutWord[][] {
  if (words.length === 0) return [];

  const lines: LayoutWord[][] = [];
  let current: LayoutWord[] = [];
  let width = 0;

  for (const w of words) {
    const gap = current.length === 0 ? 0 : irregularGap(w.index).length;
    const nextWidth = width + gap + w.text.length;
    const endsPhrase = /[.,!?;:]$/.test(w.text);

    if (current.length > 0 && nextWidth > maxWidth) {
      lines.push(current);
      current = [w];
      width = w.text.length;
    } else {
      current.push(w);
      width = nextWidth;
    }

    if (endsPhrase && current.length >= 2) {
      lines.push(current);
      current = [];
      width = 0;
    }
  }

  if (current.length > 0) lines.push(current);
  return lines;
}

function renderLine(words: LayoutWord[]): string {
  return words
    .map((w, i) => {
      const gap = i === 0 ? "" : irregularGap(w.index);
      return gap + w.text;
    })
    .join("");
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

  /**
   * Only the current timed line is on screen.
   * Words within that line appear one-by-one as their timestamps hit.
   * When the next LRC line starts, the previous line is cleared.
   */
  paint(lines: LineCue[], elapsed: number, status?: PlaybackStatus): void {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const { bg, fg } = themeColors(this.theme);

    const footerRows = 2;
    const lyricRows = Math.max(1, rows - footerRows);

    const lineIdx = activeLineIndex(lines, elapsed);
    let rendered: string[] = [];

    if (lineIdx >= 0) {
      const line = lines[lineIdx];
      const words = revealedWords(line, elapsed).map((w, i) => ({
        text: w.text.toLowerCase(),
        index: i,
      }));
      const wrapped = layoutLines(words, Math.min(28, Math.max(16, cols - 8)));
      rendered = wrapped.map((row) => renderLine(row));
    }

    const topPad = Math.max(0, Math.floor((lyricRows - rendered.length) / 2));
    const blank = " ".repeat(cols);
    const outLines: string[] = [];

    for (let r = 0; r < lyricRows; r++) {
      const contentIdx = r - topPad;
      if (contentIdx >= 0 && contentIdx < rendered.length) {
        const content = rendered[contentIdx];
        const left = Math.max(0, Math.floor((cols - content.length) / 2));
        const padded =
          " ".repeat(left) +
          content +
          " ".repeat(Math.max(0, cols - left - content.length));
        outLines.push(padded.slice(0, cols));
      } else {
        outLines.push(blank);
      }
    }

    const state = status?.paused ? "paused" : "playing";
    const pos = formatTime(status?.position ?? elapsed);
    const dur =
      status?.duration != null ? formatTime(status.duration) : "--:--";
    const statusLine = ` ${state}  ${pos} / ${dur}`;
    const controlsLine = " space play/pause   ←/→ ±5s   s stop   q quit";

    outLines.push(padRow(statusLine, cols));
    outLines.push(padRow(controlsLine, cols));

    const frame = CLEAR + bg + fg + outLines.join("\n") + RESET;
    if (frame !== this.lastPaint) {
      process.stdout.write(frame);
      this.lastPaint = frame;
    }
  }
}
