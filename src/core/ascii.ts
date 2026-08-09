/**
 * Luminance → ASCII.
 *
 * Video frames arrive as an undistorted 16:9 luminance grid (see video.ts).
 * Turning that into terminal cells means two things: resampling to the cell
 * grid while accounting for a terminal cell being roughly twice as tall as it
 * is wide, and mapping each cell's brightness to a character plus a colour
 * tier.
 *
 * The resample mapping only depends on the terminal size, so it is built once
 * and cached — per frame the work is then a box average per cell.
 */
import { VIDEO_TIERS } from "./palette.js";

/**
 * Density ramp, dark to bright. Index 0 is a space so black areas stay clean
 * instead of filling the screen with punctuation.
 */
export const RAMP = " .:-=+*#%@";

/**
 * A terminal cell is about twice as tall as it is wide.
 *
 * Only a default: a browser picks its own cell size, and square-ish cells are
 * where the picture gets sharp, so callers pass their real ratio.
 */
export const DEFAULT_CELL_ASPECT = 2;

/** Pulls brightness out of the shadows without blowing out the highlights. */
export const DEFAULT_GAMMA = 0.8;

/** Maps one video frame onto a fixed terminal grid. */
export interface Sampler {
  readonly cols: number;
  readonly rows: number;
  /**
   * Box-average `frame` into `out` (length `cols * rows`), one byte per cell.
   * `out` is supplied by the caller so painting allocates nothing per frame.
   */
  sample(frame: Uint8Array, out: Uint8Array): void;
}

interface Span {
  start: number;
  end: number;
}

/**
 * Cover-fit `srcW × srcH` into `count` output slots and return the source span
 * each slot averages. `crop` is the fraction of the source axis to discard in
 * total, split evenly between the two edges.
 */
function spans(src: number, count: number, crop: number): Span[] {
  const usable = src * (1 - crop);
  const offset = (src - usable) / 2;
  const out: Span[] = [];
  for (let i = 0; i < count; i++) {
    const start = offset + (usable * i) / count;
    const end = offset + (usable * (i + 1)) / count;
    out.push({
      start: Math.floor(start),
      // At least one source sample per cell, even when upscaling.
      end: Math.max(Math.floor(start) + 1, Math.ceil(end)),
    });
  }
  return out;
}

/**
 * Build the mapping from a `srcW × srcH` square-pixel frame onto `cols × rows`
 * terminal cells, cropping to fill.
 *
 * The region on screen is `cols` wide by `rows * CELL_ASPECT` tall in square
 * units — that, not `cols / rows`, is the aspect the source has to be fitted
 * against, or the picture comes out squashed.
 */
export function buildSampler(
  cols: number,
  rows: number,
  srcW: number,
  srcH: number,
  cellAspect: number = DEFAULT_CELL_ASPECT,
): Sampler {
  const srcAspect = srcW / srcH;
  const dstAspect = cols / (rows * cellAspect);

  // Crop the axis that has spare picture, so the frame fills the region.
  let cropX = 0;
  let cropY = 0;
  if (srcAspect > dstAspect) {
    cropX = 1 - dstAspect / srcAspect;
  } else {
    cropY = 1 - srcAspect / dstAspect;
  }

  const xs = spans(srcW, cols, cropX);
  const ys = spans(srcH, rows, cropY);

  return {
    cols,
    rows,
    sample(frame, out) {
      for (let r = 0; r < rows; r++) {
        const { start: y0, end: y1 } = ys[r];
        const rowOff = r * cols;
        for (let c = 0; c < cols; c++) {
          const { start: x0, end: x1 } = xs[c];
          let sum = 0;
          let n = 0;
          for (let y = y0; y < y1; y++) {
            const base = y * srcW;
            for (let x = x0; x < x1; x++) {
              sum += frame[base + x];
              n++;
            }
          }
          out[rowOff + c] = n > 0 ? sum / n : 0;
        }
      }
    },
  };
}

/**
 * Lookup tables from an 8-bit luminance to a ramp character and a brightness
 * tier, for one gain setting. Built once per gain rather than per cell — the
 * inner loop runs `cols * rows` times per frame.
 */
export interface RampTable {
  readonly chars: string[];
  readonly tiers: Uint8Array;
}

export function buildRampTable(
  gain: number,
  gamma: number = DEFAULT_GAMMA,
): RampTable {
  const chars: string[] = new Array(256);
  const tiers = new Uint8Array(256);

  for (let v = 0; v < 256; v++) {
    const lit = Math.min(1, Math.pow((v / 255) * gain, gamma));
    chars[v] = RAMP[Math.min(RAMP.length - 1, Math.floor(lit * RAMP.length))];
    tiers[v] = Math.min(VIDEO_TIERS - 1, Math.floor(lit * VIDEO_TIERS));
  }
  return { chars, tiers };
}
