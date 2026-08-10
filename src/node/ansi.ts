/**
 * Terminal colour and screen-control escapes.
 *
 * Colours are emitted as truecolor SGR when the terminal advertises it,
 * quantised to the 256-colour cube otherwise, and dropped entirely under
 * `NO_COLOR` / `--no-color`. The palette itself lives in `core/palette.ts`;
 * this module only knows how to say it in ANSI.
 */
import { attrColors, type Palette, type RGB } from "../core/palette.js";

export const ESC = "\x1b";
export const ALT_SCREEN_ON = `${ESC}[?1049h`;
export const ALT_SCREEN_OFF = `${ESC}[?1049l`;
export const HIDE_CURSOR = `${ESC}[?25l`;
export const SHOW_CURSOR = `${ESC}[?25h`;
export const CLEAR = `${ESC}[2J${ESC}[H`;
export const RESET = `${ESC}[0m`;

export type ColorDepth = "truecolor" | "256" | "none";

export function detectColorDepth(): ColorDepth {
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== "") return "none";
  const colorterm = (process.env.COLORTERM ?? "").toLowerCase();
  if (colorterm.includes("truecolor") || colorterm.includes("24bit")) {
    return "truecolor";
  }
  const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
  if (
    termProgram === "iterm.app" ||
    termProgram === "wezterm" ||
    termProgram === "ghostty" ||
    termProgram === "vscode"
  ) {
    return "truecolor";
  }
  const term = (process.env.TERM ?? "").toLowerCase();
  if (term.includes("256color") || term.includes("direct")) return "256";
  if (term === "" || term === "dumb") return "none";
  return "256";
}

/** Nearest index in the xterm 256-colour cube (16..231) plus the grey ramp. */
function to256(c: RGB): number {
  const [r, g, b] = c;
  if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 23);
  }
  const q = (v: number) => Math.round(Math.max(0, v - 35) / 40);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

/** Builds the SGR sequences for one palette at the terminal's colour depth. */
export class ColorWriter {
  readonly depth: ColorDepth;

  constructor(depth: ColorDepth) {
    this.depth = depth;
  }

  fg(c: RGB): string {
    if (this.depth === "none") return "";
    if (this.depth === "truecolor") return `${ESC}[38;2;${c[0]};${c[1]};${c[2]}m`;
    return `${ESC}[38;5;${to256(c)}m`;
  }

  bg(c: RGB): string {
    if (this.depth === "none") return "";
    if (this.depth === "truecolor") return `${ESC}[48;2;${c[0]};${c[1]};${c[2]}m`;
    return `${ESC}[48;5;${to256(c)}m`;
  }

  /** SGRs in ATTR_* index order. */
  attrRamp(p: Palette): string[] {
    return attrColors(p).map((c) => this.fg(c));
  }
}
