import type { ColorDepth, Palette } from "./theme.js";
import type { TransitionKind } from "./transitions.js";

/** How strongly the audio envelope drives the visuals. */
export type ReactLevel = "off" | "subtle" | "full";

export const REACT_LEVELS: readonly ReactLevel[] = ["off", "subtle", "full"];

export function isReactLevel(v: string): v is ReactLevel {
  return (REACT_LEVELS as readonly string[]).includes(v);
}

export interface WordCue {
  text: string;
  /** Start time in seconds from audio start */
  start: number;
}

/** One timed lyric line (from an LRC `[mm:ss.xx]` row) */
export interface LineCue {
  /** When this line becomes active (clears the previous line) */
  start: number;
  words: WordCue[];
}

export interface LyricsDoc {
  title?: string;
  lines: LineCue[];
}

export interface SyncOptions {
  fps: number;
  palette: Palette;
  colorDepth: ColorDepth;
  transition: TransitionKind;
  react: ReactLevel;
  titleCard: boolean;
}
