/**
 * Palettes and cell attributes.
 *
 * The default look is a CRT phosphor terminal; brat green is one palette among
 * several. This module is host-agnostic: it defines what a colour *is*, not how
 * to emit it. The terminal's SGR encoding lives in `node/ansi.ts`, and the
 * browser's atlas tinting reads the same `attrColors` this file exports, so the
 * two can never drift apart.
 */

/**
 * Cell attributes — an index into the palette's colour ramp.
 *
 * The lyric slots come first, then the ASCII video's brightness tiers, dark to
 * bright. `attrColors` returns the colours in exactly this order.
 */
export const ATTR_GROUND = 0;
export const ATTR_INK = 1;
export const ATTR_DIM = 2;
export const ATTR_HOT = 3;
/** First video tier; there are `VIDEO_TIERS` of them, ascending in brightness. */
export const ATTR_VIDEO_0 = 4;
/** Brightness tiers the ASCII video is quantised to. */
export const VIDEO_TIERS = 4;
/** Total attributes, and so the length of every colour ramp. */
export const ATTR_COUNT = ATTR_VIDEO_0 + VIDEO_TIERS;

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
  /**
   * Brightest tier of the ASCII video. Kept well below `ink` so the lyric stays
   * dominant over even a blown-out frame.
   */
  readonly videoInk: RGB;
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
    groundChar: ".",
    groundColor: [22, 60, 22],
    videoInk: [40, 150, 40],
    scanlines: true,
  },
  amber: {
    name: "amber",
    bg: [10, 6, 0],
    ink: [255, 176, 0],
    inkHot: [255, 236, 190],
    inkDim: [92, 62, 0],
    groundChar: ".",
    groundColor: [64, 44, 0],
    videoInk: [150, 105, 0],
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
    videoInk: [70, 105, 0],
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
    videoInk: [150, 150, 150],
    scanlines: false,
  },
  vhs: {
    name: "vhs",
    bg: [26, 0, 51],
    ink: [255, 62, 165],
    inkHot: [110, 240, 255],
    inkDim: [98, 24, 66],
    groundChar: ":",
    groundColor: [58, 12, 92],
    videoInk: [150, 40, 100],
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
    videoInk: [130, 130, 130],
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

/**
 * Foreground colour per attribute, in ATTR_* index order: ground, ink, dim,
 * hot, then the video tiers fading up from the background toward `videoInk`.
 *
 * The lowest tier starts above `bg` rather than at it — a tier-0 cell still
 * draws a ramp character, and drawing it in the background colour would make it
 * invisible while still costing an escape sequence.
 *
 * Both hosts build their ramp from this: the terminal wraps each colour in an
 * SGR, the browser bakes one tinted atlas page per entry.
 */
export function attrColors(p: Palette): RGB[] {
  const ramp: RGB[] = [p.groundColor, p.ink, p.inkDim, p.inkHot];
  for (let t = 0; t < VIDEO_TIERS; t++) {
    ramp.push(blend(p.bg, p.videoInk, (t + 1) / VIDEO_TIERS));
  }
  return ramp;
}
