export type Theme = "white" | "black";

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
  theme: Theme;
  fps: number;
}
