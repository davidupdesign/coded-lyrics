/**
 * Palettes and colour emission.
 *
 * The default look is a CRT phosphor terminal; brat green is one palette among
 * several. Colours are emitted as truecolor SGR when the terminal advertises
 * it, quantised to the 256-colour cube otherwise, and dropped entirely under
 * `NO_COLOR` / `--no-color`.
 */

const ESC = "\x1b";

export type RGB = readonly [number, number, number];

export interface Palette {
  readonly name: string;
  /** Screen ground. */
  readonly bg: RGB;
  /** Settled lyric ink. */
  readonly ink: RGB;
  /** Accent — the word currently landing, and the wipe's leading edge. */
  readonly inkHot: RGB;
  /** The outgoing line as it dissolves away. */
  readonly inkDim: RGB;
  /** Character sprinkled over the ground, or null for a flat ground. */
  readonly groundChar: string | null;
  readonly groundColor: RGB;
  /** Darken every third terminal row for a CRT scanline. */
  readonly scanlines: boolean;
}

export const PALETTES: Record<string, Palette> = {
  phosphor: {
    name: "phosphor",
    bg: [0, 0, 0],
    ink: [51, 255, 51],
    inkHot: [190, 255, 190],
    inkDim: [18, 92, 18],
    groundChar: "·",
    groundColor: [22, 60, 22],
    scanlines: true,
  },
  amber: {
    name: "amber",
    bg: [10, 6, 0],
    ink: [255, 176, 0],
    inkHot: [255, 236, 190],
    inkDim: [92, 62, 0],
    groundChar: "·",
    groundColor: [64, 44, 0],
    scanlines: true,
  },
  brat: {
    name: "brat",
    bg: [138, 206, 0],
    ink: [0, 0, 0],
    inkHot: [40, 40, 40],
    inkDim: [104, 158, 0],
    groundChar: null,
    groundColor: [138, 206, 0],
    scanlines: false,
  },
  "360": {
    name: "360",
    bg: [255, 255, 255],
    ink: [0, 0, 0],
    inkHot: [90, 90, 90],
    inkDim: [200, 200, 200],
    groundChar: null,
    groundColor: [255, 255, 255],
    scanlines: false,
  },
  vhs: {
    name: "vhs",
    bg: [26, 0, 51],
    ink: [255, 62, 165],
    inkHot: [110, 240, 255],
    inkDim: [98, 24, 66],
    groundChar: "▖",
    groundColor: [58, 12, 92],
    scanlines: true,
  },
  mono: {
    name: "mono",
    bg: [0, 0, 0],
    ink: [255, 255, 255],
    inkHot: [255, 255, 255],
    inkDim: [96, 96, 96],
    groundChar: null,
    groundColor: [0, 0, 0],
    scanlines: false,
  },
};

export const DEFAULT_PALETTE = "phosphor";

/** Aliases kept so the previously documented `--theme white|black` still works. */
const THEME_ALIASES: Record<string, string> = {
  white: "360",
  black: "mono",
};

export function paletteNames(): string[] {
  return Object.keys(PALETTES);
}

export function resolvePalette(name: string): Palette | null {
  const key = name.toLowerCase();
  return PALETTES[THEME_ALIASES[key] ?? key] ?? null;
}

/** Mix `a` toward `b` by `t` in [0,1]. */
export function blend(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

export function darken(c: RGB, t: number): RGB {
  return blend(c, [0, 0, 0], t);
}

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

  /** Ink colours in ATTR_* index order: ground, ink, dim, hot. */
  inkRamp(p: Palette): string[] {
    return [
      this.fg(p.groundColor),
      this.fg(p.ink),
      this.fg(p.inkDim),
      this.fg(p.inkHot),
    ];
  }
}
