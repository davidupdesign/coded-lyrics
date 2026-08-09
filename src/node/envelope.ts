/**
 * Audio envelope pre-analysis.
 *
 * ffmpeg is already an effective dependency (ffplay is the preferred playback
 * backend), so amplitude is extracted by decoding the file once to 8 kHz mono
 * f32 and bucketing it into a 50 Hz RMS envelope. No native audio bindings, and
 * a three-minute track analyses in well under a second. The maths lives in
 * `core/envelope-math.ts`; this file is the decode.
 *
 * Analysis is entirely best-effort: if ffmpeg is absent or fails, the caller
 * gets `null` and rendering carries on unreactive.
 */
import { spawn } from "node:child_process";
import {
  ENVELOPE_RATE,
  MAX_FRAMES,
  detectOnsets,
  makeEnvelope,
  normalise,
} from "../core/envelope-math.js";
import type { Envelope } from "../core/ports.js";

const SAMPLE_RATE = 8000;
const SAMPLES_PER_FRAME = SAMPLE_RATE / ENVELOPE_RATE;
const BYTES_PER_SAMPLE = 4;

/**
 * Decode `filePath` and return its loudness envelope, or `null` if ffmpeg is
 * unavailable or the decode fails. Never throws — reactivity is optional.
 */
export function analyzeAudio(filePath: string): Promise<Envelope | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        "ffmpeg",
        [
          "-v", "error",
          "-i", filePath,
          "-f", "f32le",
          "-ac", "1",
          "-ar", String(SAMPLE_RATE),
          "-",
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch {
      resolve(null);
      return;
    }

    const rms: number[] = [];
    let sumSquares = 0;
    let inFrame = 0;
    let carry = Buffer.alloc(0);
    let aborted = false;

    const pushSample = (v: number) => {
      sumSquares += v * v;
      inFrame += 1;
      if (inFrame === SAMPLES_PER_FRAME) {
        rms.push(Math.sqrt(sumSquares / SAMPLES_PER_FRAME));
        sumSquares = 0;
        inFrame = 0;
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (aborted) return;
      const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buf.length - (buf.length % BYTES_PER_SAMPLE);
      for (let off = 0; off < usable; off += BYTES_PER_SAMPLE) {
        pushSample(buf.readFloatLE(off));
      }
      // Copy the ≤3 trailing bytes of a split sample forward to the next chunk.
      carry = usable < buf.length ? Buffer.from(buf.subarray(usable)) : Buffer.alloc(0);

      if (rms.length > MAX_FRAMES) {
        aborted = true;
        child.kill("SIGKILL");
      }
    });

    child.on("error", () => resolve(null));

    child.on("close", () => {
      if (rms.length === 0) {
        resolve(null);
        return;
      }
      const energy = normalise(rms);
      resolve(makeEnvelope(energy, detectOnsets(energy)));
    });
  });
}
