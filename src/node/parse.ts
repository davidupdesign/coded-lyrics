/**
 * Reading lyrics off disk. All the parsing lives in `core/lyrics.ts`; the only
 * thing that needs a filesystem is turning a path into text plus a format hint.
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { parseLyrics, type LyricsFormat } from "../core/lyrics.js";
import type { LyricsDoc } from "../core/types.js";

export function loadLyrics(filePath: string): LyricsDoc {
  const raw = readFileSync(filePath, "utf8");
  // `.json` is taken at its word; `.lrc`, `.txt` and anything unrecognised are
  // sniffed, so a `.txt` holding JSON still parses as JSON.
  const hint: LyricsFormat = extname(filePath).toLowerCase() === ".json" ? "json" : "auto";
  return parseLyrics(raw, hint);
}
