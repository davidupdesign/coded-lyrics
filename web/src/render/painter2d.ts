/**
 * Canvas 2D grid painter.
 *
 * Cost here is one `drawImage` per non-blank cell and essentially nothing else,
 * so the frame budget is set by how much of the grid the picture fills. Measured
 * on an attached, GPU-composited canvas that comes to roughly **0.55 µs per
 * drawn cell**, which puts 60 fps at about 29 000 filled cells and 30 fps at
 * about 59 000. A dark frame is far cheaper because most cells are spaces and
 * get skipped; a bright one fills nearly all of them, and that is the case worth
 * budgeting against.
 *
 * The way past that ceiling is not a faster loop — it is drawing fewer cells for
 * the same detail, which is what the sub-cell block modes do. A WebGL painter
 * behind the same `GridPainter` interface is the other option if it is ever
 * needed.
 *
 * Two things that do matter here: every destination coordinate is an integer,
 * because a fractional one makes the browser resample each tile, and row
 * backgrounds are coalesced into runs sharing a colour.
 */
import { Charset } from "@core/charset.js";
import { ATTR_COUNT } from "@core/palette.js";
import type { Frame } from "@core/compose.js";
import type { BigGlyphCache, GlyphAtlas } from "./atlas.js";
import type { GridPainter } from "./painter.js";

export class Canvas2DPainter implements GridPainter {
  private readonly ctx: CanvasRenderingContext2D;
  private atlas: GlyphAtlas | null = null;
  private bigGlyphs: BigGlyphCache | null = null;

  private cols = 0;
  private rows = 0;
  private cellW = 0;
  private cellH = 0;

  /** Non-blank cells drawn on the last frame — what the frame time tracks. */
  private lastCells = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
  }

  resize(cols: number, rows: number, cellW: number, cellH: number): void {
    this.cols = cols;
    this.rows = rows;
    this.cellW = cellW;
    this.cellH = cellH;
    this.canvas.width = cols * cellW;
    this.canvas.height = rows * cellH;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  setAtlas(atlas: GlyphAtlas): void {
    this.atlas = atlas;
  }

  setBigGlyphs(cache: BigGlyphCache): void {
    this.bigGlyphs = cache;
  }

  /** Cells painted on the last frame — surfaced for the performance readout. */
  get drawnCells(): number {
    return this.lastCells;
  }

  draw(frame: Frame): void {
    const atlas = this.atlas;
    if (!atlas) return;

    const { ctx, cellW, cellH } = this;
    const cols = Math.min(this.cols, frame.cols);
    const rows = Math.min(this.rows, frame.rows);
    const { ids, attrs, rowBg } = frame;

    // Background first, coalescing adjacent rows that share a colour. Scanline
    // palettes alternate between two, everything else is a single fill.
    let runStart = 0;
    for (let r = 0; r <= rows; r++) {
      const same =
        r < rows &&
        rowBg[r * 3] === rowBg[runStart * 3] &&
        rowBg[r * 3 + 1] === rowBg[runStart * 3 + 1] &&
        rowBg[r * 3 + 2] === rowBg[runStart * 3 + 2];
      if (same) continue;
      ctx.fillStyle = `rgb(${rowBg[runStart * 3]},${rowBg[runStart * 3 + 1]},${rowBg[runStart * 3 + 2]})`;
      ctx.fillRect(0, runStart * cellH, cols * cellW, (r - runStart) * cellH);
      runStart = r;
    }

    // One pass per attribute, so every drawImage within a pass reads from the
    // same atlas page rather than switching source on almost every call. Worth
    // between 5 % and 12 % once past ~20 000 cells, and nothing below that; the
    // extra scans are one integer compare per cell.
    let drawn = 0;
    for (let attr = 0; attr < ATTR_COUNT; attr++) {
      const page = atlas.page(attr);
      for (let r = 0; r < rows; r++) {
        const off = r * frame.cols;
        const y = r * cellH;
        for (let x = 0; x < cols; x++) {
          const i = off + x;
          if (attrs[i] !== attr) continue;
          const id = ids[i];
          if (id === Charset.SPACE) continue;
          ctx.drawImage(
            page,
            atlas.sx(id), atlas.sy(id), cellW, cellH,
            x * cellW, y, cellW, cellH,
          );
          drawn++;
        }
      }
    }
    // Oversized lyric glyphs sit on top of everything, drawn at their true size
    // rather than as stretched cells.
    const layer = frame.lyricLayer;
    if (layer && this.bigGlyphs) {
      for (const d of layer) {
        const img = this.bigGlyphs.get(
          frame.charset.text(d.id), d.attr, d.scale * cellW, d.scale * cellH,
        );
        if (!img) continue;
        ctx.drawImage(img, d.col * cellW, d.row * cellH);
        drawn++;
      }
    }

    this.lastCells = drawn;
  }

  dispose(): void {
    this.atlas = null;
    this.bigGlyphs = null;
  }
}
