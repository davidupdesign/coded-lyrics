/**
 * Playback, and the clock everything else reads.
 *
 * One media element is the master and its `currentTime` is the single source of
 * truth — the lyric animation, the video frame and the audio envelope are all
 * pure functions of it. When the picture comes from a second element, that one
 * is nudged to follow rather than being driven independently, because two
 * elements playing "at the same time" drift apart within a minute.
 */

export type TransportListener = () => void;

/** Beyond this the video is seeked outright; under it, rate-nudged. */
const HARD_SEEK_SEC = 0.5;
/** Under this the drift is not worth touching. */
const DEADBAND_SEC = 0.05;
const CORRECTION_INTERVAL_MS = 500;

export interface TransportOptions {
  /** The element that owns the clock. */
  master: HTMLMediaElement;
  /** A second element supplying picture only, if the video is a separate file. */
  follower?: HTMLMediaElement | null;
}

export class Transport {
  private readonly listeners = new Set<TransportListener>();
  private correction: number | null = null;
  private follower: HTMLMediaElement | null = null;

  /** Seconds to shift the follower against the master. */
  offset = 0;

  constructor(readonly master: HTMLMediaElement, follower?: HTMLMediaElement | null) {
    this.follower = follower ?? null;
    for (const ev of ["play", "pause", "ended", "timeupdate", "durationchange", "seeked"]) {
      master.addEventListener(ev, this.emit);
    }
    this.correction = window.setInterval(this.correctDrift, CORRECTION_INTERVAL_MS);
  }

  private emit = (): void => {
    for (const l of this.listeners) l();
  };

  subscribe(l: TransportListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  setFollower(el: HTMLMediaElement | null): void {
    this.follower = el;
  }

  /**
   * Keep the follower with the master.
   *
   * Small drift is corrected by leaning on `playbackRate` instead of seeking:
   * a seek every half second is visible as a stutter, whereas a 2 % rate change
   * for a moment is not perceptible.
   */
  private correctDrift = (): void => {
    const video = this.follower;
    if (!video || video === this.master || video.readyState < 1) return;

    const duration = video.duration;
    let target = this.master.currentTime + this.offset;
    if (Number.isFinite(duration) && duration > 0) target %= duration;
    if (target < 0) target += Number.isFinite(duration) && duration > 0 ? duration : 0;

    const drift = target - video.currentTime;
    if (Math.abs(drift) > HARD_SEEK_SEC) {
      video.currentTime = target;
      video.playbackRate = 1;
    } else if (Math.abs(drift) > DEADBAND_SEC) {
      video.playbackRate = Math.min(1.05, Math.max(0.95, 1 + drift * 0.5));
    } else {
      video.playbackRate = 1;
    }

    if (this.master.paused && !video.paused) video.pause();
    if (!this.master.paused && video.paused) void video.play().catch(() => {});
  };

  position(): number {
    return this.master.currentTime;
  }

  duration(): number | null {
    const d = this.master.duration;
    return Number.isFinite(d) && d > 0 ? d : null;
  }

  paused(): boolean {
    return this.master.paused;
  }

  /**
   * Start playback. Rejects with `NotAllowedError` unless a user gesture is
   * driving this, which the caller has to surface rather than swallow — a
   * player that silently refuses to start is the worst version of that bug.
   */
  async play(): Promise<void> {
    await this.master.play();
    if (this.follower && this.follower !== this.master) {
      await this.follower.play().catch(() => {});
    }
  }

  pause(): void {
    this.master.pause();
    if (this.follower && this.follower !== this.master) this.follower.pause();
  }

  async toggle(): Promise<void> {
    if (this.master.paused) await this.play();
    else this.pause();
  }

  seekTo(sec: number): void {
    const duration = this.duration();
    const clamped = Math.max(0, duration != null ? Math.min(sec, duration) : sec);
    this.master.currentTime = clamped;
    this.correctDrift();
    this.emit();
  }

  seekBy(delta: number): void {
    this.seekTo(this.position() + delta);
  }

  stop(): void {
    this.pause();
    this.seekTo(0);
  }

  destroy(): void {
    if (this.correction != null) window.clearInterval(this.correction);
    this.correction = null;
    for (const ev of ["play", "pause", "ended", "timeupdate", "durationchange", "seeked"]) {
      this.master.removeEventListener(ev, this.emit);
    }
    this.listeners.clear();
  }
}
