#!/usr/bin/env node
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Command, Option } from "commander";
import { loadLyrics } from "./node/parse.js";
import { runSyncedPlayback } from "./node/sync.js";
import { isReactLevel } from "./core/types.js";
import { DEFAULT_PALETTE, paletteNames, resolvePalette } from "./core/palette.js";
import { detectColorDepth } from "./node/ansi.js";
import { TRANSITION_KINDS, isTransitionKind } from "./core/transitions.js";

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
  .option(
    "--video <path>",
    "Clip to render as an ASCII background (defaults to the audio file if it has video)",
  )
  .option("--no-video", "Skip the ASCII background")
  .option("--video-gain <n>", "Brightness multiplier for the background", "1")
  .option("--no-plate", "Don't clear the background behind the lyric")
  .option("--fps <n>", "Render frame rate", "30")
  // Pin the grid instead of following the terminal. For comparing renders
  // against a fixed reference — the web build has to match this exactly.
  .addOption(new Option("--cols <n>").hideHelp())
  .addOption(new Option("--rows <n>").hideHelp())
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
        video: string | boolean;
        videoGain: string;
        plate: boolean;
        fps: string;
        cols?: string;
        rows?: string;
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

      // commander folds --video/--no-video into one key: a string when a path
      // was given, `false` for --no-video, `true` when neither appeared.
      const videoEnabled = opts.video !== false;
      const videoPath = typeof opts.video === "string" ? resolve(opts.video) : null;
      if (videoPath && !existsSync(videoPath)) {
        console.error(`Video not found: ${videoPath}`);
        process.exit(1);
      }

      const videoGain = Number(opts.videoGain);
      if (!Number.isFinite(videoGain) || videoGain <= 0 || videoGain > 10) {
        console.error("--video-gain must be between 0 and 10");
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

      // The renderer reads its grid straight off stdout, so pinning the size is
      // a matter of lying about the terminal rather than threading an override
      // through every layer.
      for (const [flag, key] of [["--cols", "columns"], ["--rows", "rows"]] as const) {
        const raw = key === "columns" ? opts.cols : opts.rows;
        if (raw == null) continue;
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1) {
          console.error(`${flag} must be a positive integer`);
          process.exit(1);
        }
        Object.defineProperty(process.stdout, key, { value: n, configurable: true });
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
          video: {
            path: videoPath,
            enabled: videoEnabled,
            gain: videoGain,
            plate: opts.plate,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exit(1);
      }
    },
  );

program.parse();
