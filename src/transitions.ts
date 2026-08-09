/**
 * Word entrance / exit effects.
 *
 * Every effect rewrites the *sub-pixel* ink grid before half-block packing, so
 * it works identically at all glyph scales and never needs to know about
 * terminal cells. Progress `p` runs 0 → 1 and is always derived from playback
 * time, never wall-clock state, so scrubbing lands on the same frame twice.
 */
import { emptyInk } from "./bigfont.js";
import { hash01, hashSeed } from "./hash.js";

export type TransitionKind = "wipe" | "dissolve" | "glitch" | "none";

export const TRANSITION_KINDS: readonly TransitionKind[] = [
  "wipe",
  "dissolve",
  "glitch",
  "none",
];

export function isTransitionKind(v: string): v is TransitionKind {
  return (TRANSITION_KINDS as readonly string[]).includes(v);
}

export interface TransitionResult {
  ink: boolean[][];
  /** Sub-pixels the renderer should accent, or null for none. */
  hot: boolean[][] | null;
}

/** Columns at the wipe's leading edge that get the accent colour. */
const WIPE_EDGE = 2;
/** How much of a dissolve's most recent arrivals stay accented. */
const DISSOLVE_EDGE = 0.18;
/** Shear stops once the glitch is this far along. */
const GLITCH_SETTLE = 0.6;

function clamp01(p: number): number {
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

function wipe(ink: boolean[][], p: number, seed: number): TransitionResult {
  const h = ink.length;
  const w = ink[0]?.length ?? 0;
  const out = emptyInk(h, w);
  const hot = emptyInk(h, w);

  // Rows lag slightly by a per-row jitter so the edge is ragged, not a ruler.
  const edge = p * (w + WIPE_EDGE * 2);
  for (let y = 0; y < h; y++) {
    const lag = (hashSeed(seed * 31 + y) % 3) - 1;
    const rowEdge = edge + lag;
    for (let x = 0; x < w; x++) {
      if (!ink[y][x] || x >= rowEdge) continue;
      out[y][x] = true;
      if (x >= rowEdge - WIPE_EDGE) hot[y][x] = true;
    }
  }
  return { ink: out, hot };
}

function dissolve(ink: boolean[][], p: number, seed: number): TransitionResult {
  const h = ink.length;
  const w = ink[0]?.length ?? 0;
  const out = emptyInk(h, w);
  const hot = emptyInk(h, w);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y][x]) continue;
      const r = hash01(x, y, seed);
      if (r >= p) continue;
      out[y][x] = true;
      if (r >= p - DISSOLVE_EDGE) hot[y][x] = true;
    }
  }
  return { ink: out, hot };
}

function glitch(ink: boolean[][], p: number, seed: number): TransitionResult {
  const h = ink.length;
  const w = ink[0]?.length ?? 0;
  const out = emptyInk(h, w);
  const hot = emptyInk(h, w);

  // Quantise progress so the shear jumps in discrete steps rather than sliding.
  const step = Math.floor(p * 6);
  const settle = p >= GLITCH_SETTLE ? 0 : 1 - p / GLITCH_SETTLE;

  for (let y = 0; y < h; y++) {
    const shift =
      settle === 0
        ? 0
        : Math.round(((hashSeed(seed * 17 + y * 5 + step * 101) % 9) - 4) * settle);
    const dropped = settle > 0 && hash01(y, step, seed) < settle * 0.25;

    for (let x = 0; x < w; x++) {
      if (!ink[y][x]) continue;
      if (dropped) continue;
      if (settle > 0 && hash01(x, y, seed + step) < settle * 0.3) continue;
      const nx = x + shift;
      if (nx < 0 || nx >= w) continue;
      out[y][nx] = true;
      if (shift !== 0) hot[y][nx] = true;
    }
  }
  return { ink: out, hot };
}

/**
 * Apply `kind` at progress `p`. At `p >= 1` every effect returns the clean ink
 * untouched, so a settled word is always pixel-identical regardless of effect.
 */
export function applyTransition(
  ink: boolean[][],
  kind: TransitionKind,
  p: number,
  seed: number,
): TransitionResult {
  const t = clamp01(p);
  if (t >= 1 || kind === "none") return { ink, hot: null };
  if (t <= 0) {
    const h = ink.length;
    const w = ink[0]?.length ?? 0;
    return { ink: emptyInk(h, w), hot: null };
  }

  switch (kind) {
    case "wipe":
      return wipe(ink, t, seed);
    case "dissolve":
      return dissolve(ink, t, seed);
    case "glitch":
      return glitch(ink, t, seed);
  }
}
