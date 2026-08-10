/**
 * Plain-text lyric layout.
 *
 * A line is wrapped to the terminal width as ordinary text — one cell per
 * character, no bitmap font. Each character records which word cue it came
 * from, which is what lets words reveal one at a time and lets the landing word
 * take the accent colour while settled ones sit at the base ink.
 */
import { ATTR_DIM, ATTR_INK } from "./palette.js";
import type { LineCue } from "./types.js";

/** How long a freshly revealed word spends animating in. */
export const TRANSITION_MS = 280;
/** How long the previous line lingers, dissolving out, after a line change. */
export const OUTGOING_MS = 150;

/** Character index used for the gaps between words. */
export const NO_WORD = -1;

export interface TextRow {
  text: string;
  /** Word cue index per character, or `NO_WORD` for separating spaces. */
  owner: Int16Array;
}

/** Word paint state, resolved from playback time before any effect is applied. */
export interface WordState {
  /** Transition progress, 0 → 1. Below 0 means not yet revealed. */
  p: number;
  attr: number;
}

/**
 * Greedily wrap `words` to `maxWidth`, recording each character's word index.
 *
 * A word longer than the whole width still gets its own row rather than being
 * broken — the renderer clips it, which reads better than a hyphen-less split.
 */
export function layoutLine(words: string[], maxWidth: number): TextRow[] {
  const width = Math.max(1, maxWidth);
  const rows: TextRow[] = [];

  let text = "";
  let owner: number[] = [];

  const flush = () => {
    if (text.length === 0) return;
    rows.push({ text, owner: Int16Array.from(owner) });
    text = "";
    owner = [];
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.length === 0) continue;

    const needed = text.length === 0 ? word.length : text.length + 1 + word.length;
    if (needed > width) flush();

    if (text.length > 0) {
      text += " ";
      owner.push(NO_WORD);
    }
    text += word;
    for (let c = 0; c < word.length; c++) owner.push(i);
  }
  flush();

  return rows;
}

/**
 * Resolve each word's transition progress from playback time.
 *
 * Pure in `elapsed` and the cue times — that is what keeps a seek landing on
 * exactly the frame it should. `fadeOut` runs the whole line backwards instead,
 * for the outgoing line and the title card.
 */
export function wordStates(
  line: LineCue,
  elapsed: number,
  fadeOut: number | null,
): WordState[] {
  return line.words.map((cue) => {
    if (fadeOut != null) return { p: 1 - fadeOut, attr: ATTR_DIM };
    if (cue.start > elapsed) return { p: -1, attr: ATTR_INK };
    return { p: ((elapsed - cue.start) * 1000) / TRANSITION_MS, attr: ATTR_INK };
  });
}
