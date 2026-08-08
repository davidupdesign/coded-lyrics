#!/usr/bin/env node
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Command } from "commander";
import { loadLyrics } from "./parse.js";
import { runSyncedPlayback } from "./sync.js";
import type { Theme } from "./types.js";

const program = new Command();

program
  .name("coded-lyrics")
  .description(
    "Play an audio file with word-by-word Brat-style lyrics in the terminal",
  )
  .argument("<audio>", "Path to audio file (mp3, wav, m4a, …)")
  .argument("<lyrics>", "Path to lyrics (.json or .lrc)")
  .option("--theme <theme>", "white | black", "white")
  .option("--fps <n>", "Render frame rate", "30")
  .action(
    async (
      audio: string,
      lyricsPath: string,
      opts: { theme: string; fps: string },
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

      const theme = opts.theme as Theme;
      if (theme !== "white" && theme !== "black") {
        console.error('--theme must be "white" or "black"');
        process.exit(1);
      }

      const fps = Number(opts.fps);
      if (!Number.isFinite(fps) || fps <= 0 || fps > 120) {
        console.error("--fps must be between 1 and 120");
        process.exit(1);
      }

      try {
        const lyrics = loadLyrics(lyricsFile);
        await runSyncedPlayback(audioPath, lyrics, { theme, fps });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exit(1);
      }
    },
  );

program.parse();
