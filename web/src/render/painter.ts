/**
 * The seam between a composed frame and pixels.
 *
 * Only one implementation exists today (canvas 2D), but the interface is the
 * whole reason a WebGL painter can be dropped in later without touching
 * anything upstream: it needs the glyph ids, the attributes and the atlas, and
 * nothing else.
 */
import type { Frame } from "@core/compose.js";
import type { BigGlyphCache, GlyphAtlas } from "./atlas.js";

export interface GridPainter {
  /** Cell size in device pixels; the canvas is sized to `cols × rows` of them. */
  resize(cols: number, rows: number, cellW: number, cellH: number): void;
  setAtlas(atlas: GlyphAtlas): void;
  /** Oversized lyric glyphs, used only when `lyricScale` is above 1. */
  setBigGlyphs(cache: BigGlyphCache): void;
  draw(frame: Frame): void;
  dispose(): void;
}
