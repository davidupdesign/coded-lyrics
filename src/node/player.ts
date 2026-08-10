import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("which", [cmd], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

type BackendKind = "ffplay" | "mpv" | "afplay";

interface Backend {
  kind: BackendKind;
  /** Args to play file starting at `startSec` */
  args: (file: string, startSec: number) => string[];
}

async function resolveBackend(): Promise<{ bin: string; backend: Backend }> {
  // Prefer players that support start-offset (needed for pause/seek)
  if (await commandExists("ffplay")) {
    return {
      bin: "ffplay",
      backend: {
        kind: "ffplay",
        args: (file, startSec) => [
          "-nodisp",
          "-autoexit",
          "-loglevel",
          "quiet",
          "-ss",
          startSec.toFixed(3),
          file,
        ],
      },
    };
  }
  if (await commandExists("mpv")) {
    return {
      bin: "mpv",
      backend: {
        kind: "mpv",
        args: (file, startSec) => [
          "--no-video",
          "--really-quiet",
          `--start=${startSec.toFixed(3)}`,
          file,
        ],
      },
    };
  }
  if (platform() === "darwin" && (await commandExists("afplay"))) {
    return {
      bin: "afplay",
      backend: {
        kind: "afplay",
        // afplay cannot seek — pause/seek will restart from 0
        args: (file) => [file],
      },
    };
  }
  if (platform() === "linux" && (await commandExists("aplay"))) {
    throw new Error(
      "aplay cannot seek. Install ffplay (ffmpeg) or mpv for playback controls.",
    );
  }

  throw new Error(
    "No seekable audio player found. Install ffplay (ffmpeg) or mpv.",
  );
}

async function probeDuration(filePath: string): Promise<number | null> {
  if (!(await commandExists("ffprobe"))) return null;
  return new Promise((resolve) => {
    const child = spawn(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const n = Number.parseFloat(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : null);
    });
  });
}

/**
 * Controllable audio: play/pause, ±seek, stop-to-start.
 * Uses process restart + start offset (ffplay/mpv).
 */
export class ControllableAudioPlayer {
  private filePath = "";
  private bin = "";
  private backend: Backend | null = null;
  private child: ChildProcess | null = null;
  private intentionalKill = false;

  private paused = true;
  private basePosition = 0;
  private wallStart = 0;
  private duration: number | null = null;
  private canSeek = true;
  private finished = false;

  async load(filePath: string): Promise<void> {
    if (!existsSync(filePath)) {
      throw new Error(`Audio file not found: ${filePath}`);
    }
    const resolved = await resolveBackend();
    this.bin = resolved.bin;
    this.backend = resolved.backend;
    this.filePath = filePath;
    this.canSeek = resolved.backend.kind !== "afplay";
    this.duration = await probeDuration(filePath);
    this.basePosition = 0;
    this.paused = true;
    this.finished = false;
  }

  getPosition(): number {
    if (this.paused || this.finished) {
      return this.basePosition;
    }
    const elapsed = (performance.now() - this.wallStart) / 1000;
    let pos = this.basePosition + elapsed;
    if (this.duration != null) {
      pos = Math.min(pos, this.duration);
    }
    return Math.max(0, pos);
  }

  getDuration(): number | null {
    return this.duration;
  }

  isPaused(): boolean {
    return this.paused;
  }

  isFinished(): boolean {
    return this.finished;
  }

  supportsSeek(): boolean {
    return this.canSeek;
  }

  async play(): Promise<void> {
    if (!this.backend || !this.filePath) {
      throw new Error("Audio not loaded");
    }
    if (!this.paused && this.child) return;

    if (this.finished) {
      this.finished = false;
      this.basePosition = 0;
    }

    this.killChild();
    this.paused = false;
    this.wallStart = performance.now();
    this.spawnFrom(this.basePosition);
  }

  pause(): void {
    if (this.paused) return;
    this.basePosition = this.getPosition();
    this.paused = true;
    this.killChild();
  }

  async togglePause(): Promise<void> {
    if (this.paused) {
      await this.play();
    } else {
      this.pause();
    }
  }

  /** Seek by delta seconds (clamped). Restarts playback if currently playing. */
  async seekBy(delta: number): Promise<void> {
    if (!this.canSeek) {
      // afplay: best-effort wall-clock only; cannot restart mid-file
      const next = Math.max(0, this.getPosition() + delta);
      this.basePosition = this.duration != null ? Math.min(next, this.duration) : next;
      if (!this.paused) {
        this.wallStart = performance.now();
      }
      return;
    }

    const wasPlaying = !this.paused && !this.finished;
    let next = this.getPosition() + delta;
    next = Math.max(0, next);
    if (this.duration != null) {
      next = Math.min(next, Math.max(0, this.duration - 0.05));
    }

    this.basePosition = next;
    this.finished = false;
    this.killChild();

    if (wasPlaying) {
      this.paused = false;
      this.wallStart = performance.now();
      this.spawnFrom(this.basePosition);
    } else {
      this.paused = true;
    }
  }

  /** Stop audio and jump to the beginning (paused). */
  stop(): void {
    this.killChild();
    this.basePosition = 0;
    this.paused = true;
    this.finished = false;
    this.wallStart = performance.now();
  }

  destroy(): void {
    this.killChild();
    this.paused = true;
  }

  private spawnFrom(startSec: number): void {
    if (!this.backend) return;
    this.intentionalKill = false;
    const start = this.canSeek ? startSec : 0;
    const child = spawn(this.bin, this.backend.args(this.filePath, start), {
      stdio: "ignore",
    });
    this.child = child;

    child.on("error", (err) => {
      console.error(`Audio player error: ${err.message}`);
    });

    child.on("close", () => {
      if (this.child !== child) return;
      this.child = null;
      if (this.intentionalKill) return;

      // Natural end of file
      this.paused = true;
      this.finished = true;
      this.basePosition = this.duration ?? this.getPosition();
    });
  }

  private killChild(): void {
    if (!this.child) return;
    this.intentionalKill = true;
    const child = this.child;
    this.child = null;
    if (!child.killed) {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 300).unref();
    }
  }
}
