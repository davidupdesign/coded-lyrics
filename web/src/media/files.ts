/**
 * Working out what someone just dropped on the page.
 *
 * Nothing is uploaded — files stay in the tab as object URLs, which is both the
 * private answer and the fast one. Lyrics format detection reuses the parser's
 * own sniffing rather than guessing again from the extension, so a `.txt`
 * holding JSON behaves the same here as it does in the terminal.
 */
import { parseLyrics, type LyricsFormat } from "@core/lyrics.js";
import type { LyricsDoc } from "@core/types.js";

export type MediaKind = "audio" | "video" | "lyrics" | "unknown";

const AUDIO_EXT = ["mp3", "wav", "m4a", "flac", "ogg", "oga", "opus", "aac", "weba"];
const VIDEO_EXT = ["mp4", "webm", "mov", "m4v", "mkv", "avi", "ogv"];
const LYRIC_EXT = ["lrc", "txt", "json"];

function extension(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function classify(file: File): MediaKind {
  const ext = extension(file.name);
  // Lyrics first: some systems report `.txt` as `text/plain` and others as
  // nothing at all, but the extension is unambiguous.
  if (LYRIC_EXT.includes(ext)) return "lyrics";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  return "unknown";
}

export async function readLyrics(file: File): Promise<LyricsDoc> {
  const raw = await file.text();
  const hint: LyricsFormat = extension(file.name) === "json" ? "json" : "auto";
  return parseLyrics(raw, hint);
}

/** A track's display name, preferring the lyrics' own title. */
export function trackTitle(doc: LyricsDoc | null, fallbackFile: File | null): string {
  const fromDoc = doc?.title?.trim();
  if (fromDoc) return fromDoc;
  if (!fallbackFile) return "";
  return fallbackFile.name.replace(/\.[^.]+$/, "");
}

/**
 * An object URL tied to a file, with the previous one released.
 *
 * Object URLs pin the whole file in memory until revoked, and a music video is
 * easily 100 MB, so leaking them across a few track changes is noticeable.
 */
export class ObjectUrl {
  private url: string | null = null;

  set(file: File | null): string | null {
    this.release();
    this.url = file ? URL.createObjectURL(file) : null;
    return this.url;
  }

  release(): void {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}
