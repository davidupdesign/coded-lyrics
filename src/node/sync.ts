import type { LyricsDoc, ReactLevel } from "../core/types.js";
import type { Palette } from "../core/palette.js";
import type { TransitionKind } from "../core/transitions.js";
import { ControllableAudioPlayer } from "./player.js";
import { AnsiRenderer } from "./renderer.js";
import { analyzeAudio } from "./envelope.js";
import { openVideo } from "./video.js";
import { ColorWriter, type ColorDepth } from "./ansi.js";

/** Where the ASCII background comes from, and how it is drawn. */
export interface VideoOptions {
  /** Clip to decode, or null to use the audio file when it carries video. */
  path: string | null;
  /** Disable the background entirely. */
  enabled: boolean;
  /** Brightness multiplier applied before the ramp lookup. */
  gain: number;
  /** Knock the video out behind the lyric so plain text stays readable. */
  plate: boolean;
}

export interface SyncOptions {
  fps: number;
  palette: Palette;
  colorDepth: ColorDepth;
  transition: TransitionKind;
  react: ReactLevel;
  titleCard: boolean;
  video: VideoOptions;
}

export async function runSyncedPlayback(
  audioPath: string,
  lyrics: LyricsDoc,
  options: SyncOptions,
): Promise<void> {
  const player = new ControllableAudioPlayer();
  const frameMs = 1000 / options.fps;

  let raf: NodeJS.Timeout | null = null;
  let cleaned = false;
  let quit = false;
  const stdin = process.stdin;
  const hadRawMode = stdin.isTTY && typeof stdin.setRawMode === "function";

  // Envelope analysis, the video decoder and probing the file are independent —
  // overlap them so neither costs extra startup latency. `openVideo` resolves
  // as soon as ffmpeg spawns; its frames keep arriving during playback.
  const videoSource = options.video.enabled
    ? options.video.path ?? audioPath
    : null;

  const [, envelope, video] = await Promise.all([
    player.load(audioPath),
    options.react === "off"
      ? Promise.resolve(null)
      : analyzeAudio(audioPath),
    videoSource ? openVideo(videoSource) : Promise.resolve(null),
  ]);

  const renderer = new AnsiRenderer({
    palette: options.palette,
    colors: new ColorWriter(options.colorDepth),
    transition: options.transition,
    react: options.react,
    titleCard: options.titleCard,
    envelope,
    video,
    plate: options.video.plate,
    videoGain: options.video.gain,
    title: lyrics.title,
  });

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (raf) {
      clearInterval(raf);
      raf = null;
    }
    if (hadRawMode) {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onKey);
    }
    player.destroy();
    // The decoder outlives the audio child, so it needs killing explicitly or
    // it survives the quit.
    video?.close();
    renderer.exit();
  };

  const onSignal = () => {
    quit = true;
    cleanup();
    process.exit(0);
  };

  const onKey = (data: string | Buffer) => {
    const key = typeof data === "string" ? data : data.toString("utf8");

    // Ctrl+C
    if (key === "\u0003") {
      onSignal();
      return;
    }

    // quit
    if (key === "q" || key === "Q") {
      quit = true;
      return;
    }

    // play / pause
    if (key === " ") {
      void player.togglePause();
      return;
    }

    // stop → beginning + paused
    if (key === "s" || key === "S") {
      player.stop();
      return;
    }

    // left arrow / h / ,
    if (key === "\u001b[D" || key === "h" || key === "H" || key === ",") {
      void player.seekBy(-5);
      return;
    }

    // right arrow / l / .
    if (key === "\u001b[C" || key === "l" || key === "L" || key === ".") {
      void player.seekBy(5);
      return;
    }
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    renderer.enter();

    if (hadRawMode) {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");
      stdin.on("data", onKey);
    }

    await player.play();

    await new Promise<void>((resolve) => {
      raf = setInterval(() => {
        if (quit) {
          resolve();
          return;
        }

        const elapsed = player.getPosition();
        renderer.paint(lyrics.lines, elapsed, {
          paused: player.isPaused(),
          position: elapsed,
          duration: player.getDuration(),
        });
      }, frameMs);
    });
  } finally {
    cleanup();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
