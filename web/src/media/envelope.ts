/**
 * Audio loudness analysis, done once up front.
 *
 * The obvious browser answer is a live `AnalyserNode`, and it is the wrong one:
 * its output depends on when you ask, so seeking backwards would paint a
 * different picture than playing forwards through the same moment. Decoding the
 * whole file into the same envelope the terminal builds keeps the renderer a
 * pure function of position, which is what makes scrubbing look right.
 *
 * Best-effort throughout — an unsupported codec or a refused AudioContext
 * yields `null`, which is exactly the "no reactivity" path the terminal takes
 * when ffmpeg is missing.
 */
import { envelopeFromPcm } from "@core/envelope-math.js";
import type { Envelope } from "@core/ports.js";

export async function analyzeAudioFile(
  file: File,
  signal?: AbortSignal,
): Promise<Envelope | null> {
  let ctx: AudioContext | null = null;
  try {
    const bytes = await file.arrayBuffer();
    if (signal?.aborted) return null;

    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();

    const buffer = await ctx.decodeAudioData(bytes);
    if (signal?.aborted) return null;

    const mono = downmix(buffer);
    const rate = buffer.sampleRate;
    // Release the decoded buffer before the analysis allocates: four minutes of
    // 44.1 kHz stereo is around 40 MB and playback uses the media element, not
    // this, so nothing else needs it.
    return envelopeFromPcm(mono, rate);
  } catch {
    return null;
  } finally {
    void ctx?.close().catch(() => {});
  }
}

/** Average the channels, matching ffmpeg's `-ac 1`. */
function downmix(buffer: AudioBuffer): Float32Array {
  const n = buffer.length;
  const channels = buffer.numberOfChannels;
  if (channels === 1) return buffer.getChannelData(0).slice();

  const out = new Float32Array(n);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  for (let i = 0; i < n; i++) out[i] /= channels;
  return out;
}
