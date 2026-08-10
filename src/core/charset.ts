/**
 * Interning table mapping a character to a small integer.
 *
 * The terminal wants characters and a canvas wants an index into a glyph atlas.
 * Resolving that once, in the compositor, keeps the difference out of the inner
 * loop: a 480×135 grid is 65 000 cells a frame, and a hash lookup per cell is
 * not free at that rate.
 *
 * Ids are assigned in a fixed order — the ramp first, then the glyphs the
 * effects need — so a given build always produces the same numbering and an
 * atlas can be cached against `version` rather than rebuilt per frame.
 */
import { RAMP } from "./ascii.js";

/**
 * Characters every render needs: the density ramp (which also supplies the
 * progress bar's `#`/`-` and both ground characters), the edge glyphs, and the
 * stand-in for anything past the cap.
 */
const PRESET = `${RAMP}/\\|_?`;

/**
 * Ceiling on distinct glyphs. Exists because the browser bakes one atlas tile
 * per glyph per colour, so the id space is also a memory budget. Lyrics in any
 * script this renders well use a small fraction of it.
 */
const MAX_GLYPHS = 512;

export class Charset {
  /** `RAMP` starts with a space, so the blank cell is always id 0. */
  static readonly SPACE = 0;

  private readonly ids = new Map<string, number>();
  private readonly list: string[] = [];
  private readonly fallback: number;
  private bumped = 0;

  constructor() {
    for (const ch of PRESET) this.intern(ch);
    this.fallback = this.ids.get("?") ?? 0;
  }

  /** Id for `ch`, assigning a new one if this is the first time it appears. */
  intern(ch: string): number {
    const known = this.ids.get(ch);
    if (known !== undefined) return known;
    if (this.list.length >= MAX_GLYPHS) return this.fallback;

    const id = this.list.length;
    this.ids.set(ch, id);
    this.list.push(ch);
    this.bumped++;
    return id;
  }

  text(id: number): string {
    return this.list[id] ?? "?";
  }

  get size(): number {
    return this.list.length;
  }

  /** Increments whenever a glyph is added, so caches know to rebuild. */
  get version(): number {
    return this.bumped;
  }

  chars(): readonly string[] {
    return this.list;
  }
}
