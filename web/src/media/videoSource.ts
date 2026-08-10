/**
 * The ASCII background's picture, taken from a `<video>` element.
 *
 * The terminal decodes the whole clip into memory up front, which makes its
 * `frameAt` a genuinely pure function of position. A browser only ever has the
 * frame it is currently showing, so this keeps a short ring of recent captures
 * — enough that a small scrub lands exactly, while a long seek resolves as soon
 * as the element settles. Everything else in the renderer stays position-pure;
 * this is the one place the browser cannot match that, and it is bounded.
 *
 * Capture is driven by `requestVideoFrameCallback` rather than the render loop:
 * a 24 fps source painted at 60 fps would otherwise be read back two and a half
 * times per new frame, and reading back is the expensive half.
 */
import type { VideoSource } from "@core/ports.js";

/** Recent frames kept for scrubbing, keyed at this rate. */
const RING_RATE = 12;
const RING_SIZE = 16;

interface Captured {
  key: number;
  luma: Uint8Array;
  rgb: Uint8Array | null;
}

export class DomVideoSource implements VideoSource {
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private ctx: CanvasRenderingContext2D;
  private ring: Captured[] = [];
  private latest: Captured | null = null;
  private handle: number | null = null;
  private closed = false;
  private fallbackTime = -1;
  private captures = 0;

  width: number;
  height: number;

  constructor(
    private readonly el: HTMLVideoElement,
    width: number,
    height: number,
    private wantRgb = false,
  ) {
    this.width = width;
    this.height = height;
    this.canvas = this.makeCanvas(width, height);
    this.ctx = this.contextFor(this.canvas);
    this.schedule();
  }

  get frameCount(): number {
    return this.captures;
  }

  private makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  private contextFor(c: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D {
    // `willReadFrequently` is not optional here. Without it the canvas stays
    // GPU-backed and every getImageData forces a synchronous readback, which
    // costs more than everything else in the frame put together.
    const ctx = (c as HTMLCanvasElement).getContext("2d", {
      willReadFrequently: true,
      alpha: false,
    });
    if (!ctx) throw new Error("2D canvas context unavailable");
    return ctx as CanvasRenderingContext2D;
  }

  /** Resize the capture to match the grid. Cheap, but not worth doing per frame. */
  resize(width: number, height: number, wantRgb = this.wantRgb): void {
    if (width === this.width && height === this.height && wantRgb === this.wantRgb) return;
    this.width = width;
    this.height = height;
    this.wantRgb = wantRgb;
    this.canvas = this.makeCanvas(width, height);
    this.ctx = this.contextFor(this.canvas);
    this.ring = [];
    this.latest = null;
  }

  private schedule(): void {
    if (this.closed) return;
    const el = this.el as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
    };
    if (typeof el.requestVideoFrameCallback === "function") {
      this.handle = el.requestVideoFrameCallback((_now, meta) => {
        this.capture(meta.mediaTime);
        this.schedule();
      });
    }
    // Without rVFC (older Firefox), `pump` is called from the render loop.
  }

  /**
   * Capture path for browsers without `requestVideoFrameCallback`. Skips when
   * the element has not advanced, so a paused video costs nothing.
   */
  pump(): void {
    if (this.closed || this.handle != null) return;
    if (this.el.readyState < 2) return;
    if (this.el.currentTime === this.fallbackTime) return;
    this.fallbackTime = this.el.currentTime;
    this.capture(this.el.currentTime);
  }

  private capture(mediaTime: number): void {
    const { width: w, height: h } = this;
    if (this.el.readyState < 2 || w === 0 || h === 0) return;

    try {
      this.ctx.drawImage(this.el, 0, 0, w, h);
    } catch {
      // A tainted or not-yet-decodable frame; try again on the next callback.
      return;
    }

    const { data } = this.ctx.getImageData(0, 0, w, h);
    const luma = new Uint8Array(w * h);
    const rgb = this.wantRgb ? new Uint8Array(w * h * 3) : null;

    for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      // BT.601 luma, in integers — matches what ffmpeg's `-pix_fmt gray` gives
      // the terminal closely enough that the two look the same.
      luma[i] = (r * 77 + g * 150 + b * 29) >> 8;
      if (rgb) {
        rgb[i * 3] = r;
        rgb[i * 3 + 1] = g;
        rgb[i * 3 + 2] = b;
      }
    }

    const shot: Captured = { key: Math.round(mediaTime * RING_RATE), luma, rgb };
    this.latest = shot;
    this.captures++;
    this.ring.push(shot);
    if (this.ring.length > RING_SIZE) this.ring.shift();
  }

  private at(sec: number): Captured | null {
    if (!this.latest) return null;
    const key = Math.round(sec * RING_RATE);
    if (this.latest.key === key) return this.latest;
    for (let i = this.ring.length - 1; i >= 0; i--) {
      if (this.ring[i].key === key) return this.ring[i];
    }
    // Nothing that close; the newest frame is the best answer available.
    return this.latest;
  }

  frameAt(sec: number): Uint8Array | null {
    return this.at(sec)?.luma ?? null;
  }

  rgbAt(sec: number): Uint8Array | null {
    return this.at(sec)?.rgb ?? null;
  }

  close(): void {
    this.closed = true;
    const el = this.el as HTMLVideoElement & {
      cancelVideoFrameCallback?: (h: number) => void;
    };
    if (this.handle != null && typeof el.cancelVideoFrameCallback === "function") {
      el.cancelVideoFrameCallback(this.handle);
    }
    this.handle = null;
    this.ring = [];
    this.latest = null;
  }
}

/**
 * Capture size for a grid.
 *
 * Sampling cost is proportional to source pixels, not to cells, so capturing at
 * the clip's native size would make a dense grid slower for no visible gain.
 * Roughly two source pixels per cell across is enough for the box filter to
 * have something to average.
 */
export function captureSizeFor(cols: number, rows: number, aspect: number): {
  width: number;
  height: number;
} {
  const width = Math.min(1280, Math.max(128, Math.round((cols * 2) / 16) * 16));
  const height = Math.max(72, Math.round(width / (aspect || 16 / 9)));
  void rows;
  return { width, height };
}
