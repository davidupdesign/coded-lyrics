/**
 * Turning raw amplitude into the envelope the renderer reacts to.
 *
 * The host decodes audio however it can — ffmpeg in the terminal,
 * `decodeAudioData` in the browser — and hands the PCM here. Everything past
 * that point is shared, so the two hosts react to the same music the same way.
 *
 * Exact numerical parity between hosts is not on offer: different decoders and
 * resamplers disagree in the last bits. The normalisation below is scale-free,
 * so what carries across is the shape, not the samples.
 */
import type { Envelope } from "./ports.js";

/** Envelope frames per second. */
export const ENVELOPE_RATE = 50;

/** Frames of moving average used as the onset baseline (~160 ms). */
export const SMOOTH_FRAMES = 8;
/** How far above its own baseline a frame must jump to count as a kick. */
export const ONSET_THRESHOLD = 0.12;
/** Minimum frames between kicks (~100 ms) so one hit fires once. */
export const ONSET_REFRACTORY = 5;

/** Refuse to analyse absurdly long files. */
export const MAX_FRAMES = ENVELOPE_RATE * 60 * 20;

function frameIndex(sec: number, length: number): number {
  if (length === 0) return -1;
  const i = Math.floor(sec * ENVELOPE_RATE);
  if (i < 0) return 0;
  if (i >= length) return length - 1;
  return i;
}

export function makeEnvelope(energy: Float32Array, sinceKick: Float32Array): Envelope {
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
export function normalise(raw: ArrayLike<number>): Float32Array {
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
export function detectOnsets(energy: Float32Array): Float32Array {
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
 * Bucket mono PCM at any sample rate into an `ENVELOPE_RATE` RMS envelope.
 *
 * Used by hosts that decode to a whole buffer at once. The terminal streams its
 * samples instead and calls `normalise`/`detectOnsets` directly, which is the
 * same computation fed a chunk at a time.
 */
export function envelopeFromPcm(pcm: Float32Array, sampleRate: number): Envelope | null {
  if (pcm.length === 0 || !(sampleRate > 0)) return null;

  const perFrame = sampleRate / ENVELOPE_RATE;
  const frames = Math.min(MAX_FRAMES, Math.floor(pcm.length / perFrame));
  if (frames === 0) return null;

  const rms = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    // Integer bounds from the fractional stride, so a non-multiple sample rate
    // (44 100 gives 882 exactly, but 48 000 gives 960 and 22 050 gives 441)
    // never drifts a frame off the grid.
    const from = Math.floor(f * perFrame);
    const to = Math.floor((f + 1) * perFrame);
    let sum = 0;
    for (let i = from; i < to; i++) sum += pcm[i] * pcm[i];
    rms[f] = Math.sqrt(sum / Math.max(1, to - from));
  }

  const energy = normalise(rms);
  return makeEnvelope(energy, detectOnsets(energy));
}
