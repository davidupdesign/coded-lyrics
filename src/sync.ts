import type { LyricsDoc, SyncOptions } from "./types.js";
import { ControllableAudioPlayer } from "./player.js";
import { BratRenderer } from "./renderer.js";
import { analyzeAudio } from "./envelope.js";
import { ColorWriter } from "./theme.js";

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

  // Decoding for the envelope and probing the file are independent — overlap
  // them so reactivity costs no extra startup latency.
  const [, envelope] = await Promise.all([
    player.load(audioPath),
    options.react === "off"
      ? Promise.resolve(null)
      : analyzeAudio(audioPath),
  ]);

  const renderer = new BratRenderer({
    palette: options.palette,
    colors: new ColorWriter(options.colorDepth),
    transition: options.transition,
    react: options.react,
    titleCard: options.titleCard,
    envelope,
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
