#!/usr/bin/env node
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Command } from "commander";
import { loadLyrics } from "./parse.js";
import { runSyncedPlayback } from "./sync.js";
import { isReactLevel } from "./types.js";
import {
  DEFAULT_PALETTE,
  detectColorDepth,
  paletteNames,
  resolvePalette,
} from "./theme.js";
import { TRANSITION_KINDS, isTransitionKind } from "./transitions.js";

const program = new Command();

program
  .name("coded-lyrics")
  .description(
    "Play an audio file with word-by-word Brat-style lyrics in the terminal",
  )
  .argument("<audio>", "Path to audio file (mp3, wav, m4a, …)")
  .argument("<lyrics>", "Path to lyrics (.json or .lrc)")
  .option("--palette <name>", paletteNames().join(" | "), DEFAULT_PALETTE)
  .option("--transition <kind>", TRANSITION_KINDS.join(" | "), "wipe")
  .option("--react <level>", "off | subtle | full", "subtle")
  .option("--no-title", "Skip the opening title card")
  .option("--no-color", "Render without colour")
  .option("--theme <theme>", "Deprecated alias for --palette (white | black)")
  .option("--fps <n>", "Render frame rate", "30")
  .action(
    async (
      audio: string,
      lyricsPath: string,
      opts: {
        palette: string;
        transition: string;
        react: string;
        title: boolean;
        color: boolean;
        theme?: string;
        fps: string;
      },
    ) => {
      const audioPath = resolve(audio);
      const lyricsFile = resolve(lyricsPath);

      if (!existsSync(audioPath)) {
        console.error(`Audio not found: ${audioPath}`);
        process.exit(1);
      }
      if (!existsSync(lyricsFile)) {
        console.error(`Lyrics not found: ${lyricsFile}`);
        process.exit(1);
      }

      // --theme is the old flag; --palette wins when both are given.
      const paletteName =
        opts.palette === DEFAULT_PALETTE && opts.theme ? opts.theme : opts.palette;
      const palette = resolvePalette(paletteName);
      if (!palette) {
        console.error(
          `Unknown palette "${paletteName}". Available: ${paletteNames().join(", ")}`,
        );
        process.exit(1);
      }

      if (!isTransitionKind(opts.transition)) {
        console.error(
          `--transition must be one of: ${TRANSITION_KINDS.join(", ")}`,
        );
        process.exit(1);
      }

      if (!isReactLevel(opts.react)) {
        console.error("--react must be off, subtle, or full");
        process.exit(1);
      }

      const fps = Number(opts.fps);
      if (!Number.isFinite(fps) || fps <= 0 || fps > 120) {
        console.error("--fps must be between 1 and 120");
        process.exit(1);
      }

      try {
        const lyrics = loadLyrics(lyricsFile);
        await runSyncedPlayback(audioPath, lyrics, {
          fps,
          palette,
          colorDepth: opts.color ? detectColorDepth() : "none",
          transition: opts.transition,
          react: opts.react,
          titleCard: opts.title,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exit(1);
      }
    },
  );

program.parse();
