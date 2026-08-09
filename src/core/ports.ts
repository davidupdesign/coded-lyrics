/**
 * What the renderer needs from the outside world.
 *
 * Both are deliberately narrow and keyed on playback position rather than on
 * stream state, because that is what makes the picture a pure function of where
 * you are in the track — scrub to the same second twice and you get the same
 * frame. The terminal satisfies these with ffmpeg; the browser satisfies them
 * with a `<video>` element and a decoded `AudioBuffer`.
 */

export interface VideoSource {
  readonly width: number;
  readonly height: number;
  /** Frames available so far. */
  readonly frameCount: number;
  /**
   * Luminance frame for a playback position (`width * height` bytes), or `null`
   * before the first frame lands.
   */
  frameAt(sec: number): Uint8Array | null;
  /**
   * Colour plane for the same position (`width * height * 3` bytes), or `null`.
   * Optional: a luminance-only host simply omits it, and colour video modes are
   * then unavailable.
   */
  rgbAt?(sec: number): Uint8Array | null;
  /** Release the decoder. Safe to call more than once. */
  close(): void;
}

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

export interface PlaybackStatus {
  paused: boolean;
  position: number;
  duration: number | null;
}
