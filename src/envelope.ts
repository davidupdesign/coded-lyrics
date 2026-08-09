/**
 * Audio envelope pre-analysis.
 *
 * ffmpeg is already an effective dependency (ffplay is the preferred playback
 * backend), so amplitude is extracted by decoding the file once to 8 kHz mono
 * f32 and bucketing it into a 50 Hz RMS envelope. No native audio bindings, and
 * a three-minute track analyses in well under a second.
 *
 * Analysis is entirely best-effort: if ffmpeg is absent or fails, the caller
 * gets `null` and rendering carries on unreactive.
 */
import { spawn } from "node:child_process";

/** Envelope frames per second. */
export const ENVELOPE_RATE = 50;

const SAMPLE_RATE = 8000;
const SAMPLES_PER_FRAME = SAMPLE_RATE / ENVELOPE_RATE;
const BYTES_PER_SAMPLE = 4;

/** Frames of moving average used as the onset baseline (~160 ms). */
const SMOOTH_FRAMES = 8;
/** How far above its own baseline a frame must jump to count as a kick. */
const ONSET_THRESHOLD = 0.12;
/** Minimum frames between kicks (~100 ms) so one hit fires once. */
const ONSET_REFRACTORY = 5;

/** Refuse to analyse absurdly long files. */
const MAX_FRAMES = ENVELOPE_RATE * 60 * 20;

export interface Envelope {
  readonly rate: number;
  /** Per-frame loudness, normalised to roughly 0..1. */
  readonly energy: Float32Array;
  /** Seconds elapsed since the most recent onset at each frame. */
  readonly sinceKick: Float32Array;
  /** Loudness at a playback position, clamped to the analysed range. */
  energyAt(sec: number): number;
  /** Seconds since the last onset at a playback position. */
  kickAgeAt(sec: number): number;
}

function frameIndex(sec: number, length: number): number {
  if (length === 0) return -1;
  const i = Math.floor(sec * ENVELOPE_RATE);
  if (i < 0) return 0;
  if (i >= length) return length - 1;
  return i;
}

function makeEnvelope(energy: Float32Array, sinceKick: Float32Array): Envelope {
  return {
    rate: ENVELOPE_RATE,
    energy,
    sinceKick,
    energyAt(sec) {
      const i = frameIndex(sec, energy.length);
      return i < 0 ? 0 : energy[i];
    },
    kickAgeAt(sec) {
      const i = frameIndex(sec, sinceKick.length);
      return i < 0 ? Number.POSITIVE_INFINITY : sinceKick[i];
    },
  };
}

/** Normalise by the 95th percentile so one loud transient can't flatten it. */
function normalise(raw: number[]): Float32Array {
  const out = new Float32Array(raw.length);
  if (raw.length === 0) return out;

  const sorted = Float64Array.from(raw).sort();
  const peak = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  if (!(peak > 0)) return out;

  for (let i = 0; i < raw.length; i++) {
    out[i] = Math.min(1, raw[i] / peak);
  }
  return out;
}

/**
 * Flag frames whose loudness jumps above its own short moving average, with a
 * refractory gap, then convert to "seconds since the last kick" for the
 * renderer to fade against.
 */
function detectOnsets(energy: Float32Array): Float32Array {
  const n = energy.length;
  const sinceKick = new Float32Array(n);
  if (n === 0) return sinceKick;

  let baseline = energy[0];
  let lastKick = -ONSET_REFRACTORY;
  let last = Number.POSITIVE_INFINITY;

  for (let i = 0; i < n; i++) {
    baseline += (energy[i] - baseline) / SMOOTH_FRAMES;
    const flux = energy[i] - baseline;
    if (flux > ONSET_THRESHOLD && i - lastKick >= ONSET_REFRACTORY) {
      lastKick = i;
      last = 0;
    } else if (last !== Number.POSITIVE_INFINITY) {
      last += 1 / ENVELOPE_RATE;
    }
    sinceKick[i] = last;
  }
  return sinceKick;
}

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
