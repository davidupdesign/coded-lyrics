/**
 * ASCII video source.
 *
 * ffmpeg decodes the clip once into a fixed-size luminance grid, appending
 * frames to an in-memory store while playback runs. Nothing blocks on the
 * decode: `open` resolves as soon as the process spawns, and `frameAt` clamps
 * to the last frame decoded so far.
 *
 * Holding the whole clip is what makes seeking exact — `frameAt` is a pure
 * function of playback position, with no wall-clock or stream state involved,
 * so scrubbing lands on the frame it should. A streaming decoder restarted with
 * `-ss` on every seek would be cheaper on memory but drifts.
 *
 * Like the audio envelope, this is entirely best-effort: no ffmpeg, no video
 * stream, or a failed decode all yield `null` and rendering carries on over the
 * palette's ground instead.
 */
import { spawn } from "node:child_process";
import type { VideoSource } from "../core/ports.js";

export type { VideoSource };

/** Decoded frames per second. ASCII art at this resolution reads fine at 12. */
export const VIDEO_FPS = 12;

/**
 * Stored frame size — 16:9 in square pixels, wide enough for any terminal the
 * renderer will budget for. Keeping the store undistorted leaves all the
 * cell-aspect maths in ascii.ts instead of baking a terminal-dependent crop
 * into the decode, so a resize needs no re-decode.
 */
export const FRAME_W = 128;
export const FRAME_H = 72;
const FRAME_BYTES = FRAME_W * FRAME_H;

/**
 * Stop decoding past this. Frames cost `FRAME_BYTES` each and are all held, so
 * the ceiling is really a memory budget: 12 minutes is about 80 MB, and longer
 * than any music video. A clip that runs past it simply loops at the cap.
 */
const MAX_FRAMES = VIDEO_FPS * 60 * 12;

function run(bin: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("error", () => resolve(null));
    child.on("close", () => resolve(out));
  });
}

/**
 * True when `filePath` carries a video stream worth rendering.
 *
 * Cover art counts as a video stream to ffprobe, so `attached_pic` has to be
 * rejected explicitly — otherwise an mp3 with embedded artwork would be treated
 * as a one-frame music video.
 */
export async function hasVideoStream(filePath: string): Promise<boolean> {
  const out = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=codec_type:stream_disposition=attached_pic",
    "-of",
    "default=noprint_wrappers=1",
    filePath,
  ]);
  if (out == null) return false;
  if (!/codec_type=video/.test(out)) return false;
  return !/attached_pic=1/.test(out);
}

/**
 * Start decoding `filePath` into a luminance frame store.
 *
 * Resolves once the decoder has spawned, or `null` if it could not start or the
 * file has no usable video stream.
 */
export async function openVideo(filePath: string): Promise<VideoSource | null> {
  if (!(await hasVideoStream(filePath))) return null;

  let child;
  try {
    child = spawn(
      "ffmpeg",
      [
        "-v", "error",
        "-i", filePath,
        "-an",
        "-vf",
        `fps=${VIDEO_FPS},scale=${FRAME_W}:${FRAME_H}:force_original_aspect_ratio=increase,crop=${FRAME_W}:${FRAME_H}`,
        "-pix_fmt", "gray",
        "-f", "rawvideo",
        "-",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return null;
  }

  const frames: Uint8Array[] = [];
  let carry = Buffer.alloc(0);
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    carry = Buffer.alloc(0);
    if (!child.killed) child.kill("SIGKILL");
  };

  child.stdout.on("data", (chunk: Buffer) => {
    if (closed) return;
    let buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;

    let off = 0;
    while (buf.length - off >= FRAME_BYTES) {
      // Copy out of the socket buffer — a subarray would pin the whole chunk.
      frames.push(Uint8Array.from(buf.subarray(off, off + FRAME_BYTES)));
      off += FRAME_BYTES;
      if (frames.length >= MAX_FRAMES) {
        close();
        return;
      }
    }
    carry = off < buf.length ? Buffer.from(buf.subarray(off)) : Buffer.alloc(0);
  });

  child.on("error", close);
  child.on("close", () => {
    closed = true;
    carry = Buffer.alloc(0);
  });

  return {
    width: FRAME_W,
    height: FRAME_H,
    get frameCount() {
      return frames.length;
    },
    frameAt(sec) {
      const n = frames.length;
      if (n === 0) return null;

      const i = Math.floor(Math.max(0, sec) * VIDEO_FPS);
      // While the decoder is still running its length is not yet the clip's, so
      // hold the newest frame rather than wrapping onto a partial store.
      if (!closed) return frames[Math.min(i, n - 1)];
      return frames[i % n];
    },
    close,
  };
}
