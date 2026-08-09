/**
 * Cell dump, for comparing the terminal and the browser.
 *
 * `dump-frame.ts` pins the terminal's *bytes*, which the browser has no
 * equivalent of. This prints the layer above that — the glyph and attribute in
 * every cell — which both hosts do share, so the same computation can be run in
 * a page and the two hashes compared. Matching hashes mean the picture is
 * identical wherever it is drawn; only the drawing differs.
 *
 *   npx tsx src/dev/dump-cells.ts examples/sample.lrc 81 31
 */
import { readFileSync } from "node:fs";
import { FrameCompositor } from "../core/compose.js";
import { PALETTES } from "../core/palette.js";
import { parseLyrics } from "../core/lyrics.js";

/** Positions chosen to hit the title card, a wipe mid-flight, and settled text. */
const POSITIONS = [0.1, 1.9, 4.0, 7.2];

export function dumpCells(lrc: string, cols: number, rows: number): string {
  const doc = parseLyrics(lrc, "auto");
  const compositor = new FrameCompositor({
    palette: PALETTES.phosphor,
    transition: "wipe",
    react: "off",
    titleCard: true,
    title: doc.title,
    plate: true,
    videoGain: 1,
  });

  const out: string[] = [];
  for (const pos of POSITIONS) {
    const f = compositor.compose({
      cols,
      rows,
      lines: doc.lines,
      elapsed: pos,
      status: { paused: false, position: pos, duration: 8 },
      video: null,
      envelope: null,
    });
    out.push(`@${pos}`);
    for (let r = 0; r < f.rows; r++) {
      let text = "";
      for (let x = 0; x < f.cols; x++) text += f.charset.text(f.ids[r * f.cols + x]);
      const attrs = [...f.attrs.slice(r * f.cols, r * f.cols + f.cols)].join("");
      out.push(`${attrs}|${text}`);
    }
  }
  return out.join("\n");
}

export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const [path = "examples/sample.lrc", cols = "81", rows = "31"] = process.argv.slice(2);
const dump = dumpCells(readFileSync(path, "utf8"), Number(cols), Number(rows));
process.stdout.write(`${JSON.stringify({ chars: dump.length, fnv: fnv1a(dump) })}\n`);
if (process.env.DUMP_CELLS_FULL) process.stdout.write(`${dump}\n`);
