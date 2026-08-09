/**
 * Everything the player remembers between visits.
 *
 * Stored under a version key and merged over the defaults on read, so adding a
 * setting doesn't strand anyone on a stale blob and removing one doesn't leave
 * a landmine. File handles are deliberately absent — the browser cannot hand
 * those back, and pretending otherwise would mean a broken "resume" button.
 */
import { DEFAULT_GRID_OPTIONS, type GridOptions } from "@core/layout.js";
import { DEFAULT_PALETTE } from "@core/palette.js";
import type { TransitionKind } from "@core/transitions.js";
import type { SubcellMode } from "@core/subcell.js";
import type { ReactLevel } from "@core/types.js";

const STORAGE_KEY = "coded-lyrics.settings.v1";

export interface Settings {
  palette: string;
  transition: TransitionKind;
  react: ReactLevel;
  titleCard: boolean;
  plate: boolean;
  /** Widest a lyric line may run, in characters. */
  lyricMaxChars: number;
  /** Lyric glyphs are drawn this many cells across, decoupling text from density. */
  lyricScale: number;

  videoEnabled: boolean;
  videoGain: number;
  /** Split each cell with block characters for more detail at the same cost. */
  subcell: SubcellMode;

  grid: GridOptions;

  /** Keep the progress bar and key hints inside the grid, as the terminal does. */
  terminalFooter: boolean;
  /** Frames per second to aim for; rAF is the ceiling regardless. */
  fpsCap: number;
  volume: number;
  loop: boolean;
  /** Suppress the full-screen kick flash. */
  reducedMotion: boolean;
  /** Seconds to shift the video against the audio, when they are separate files. */
  avOffset: number;
}

export const DEFAULT_SETTINGS: Settings = {
  palette: DEFAULT_PALETTE,
  transition: "wipe",
  react: "subtle",
  titleCard: true,
  plate: true,
  lyricMaxChars: 120,
  lyricScale: 1,

  videoEnabled: true,
  videoGain: 1,
  subcell: "off",

  grid: { ...DEFAULT_GRID_OPTIONS },

  terminalFooter: true,
  fpsCap: 60,
  volume: 1,
  loop: false,
  reducedMotion: false,
  avOffset: 0,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const saved = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      grid: { ...DEFAULT_SETTINGS.grid, ...(saved.grid ?? {}) },
    };
  } catch {
    // A corrupt or unreadable blob is not worth a broken app.
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Private mode and full quotas both throw here; neither is fatal.
  }
}
