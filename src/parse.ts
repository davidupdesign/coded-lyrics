import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { LineCue, LyricsDoc, WordCue } from "./types.js";

/** More words than this → two sequential screens (first half, then second alone) */
const SPLIT_ABOVE = 6;
const WORD_MS = 280;
const BURST_CAP_MS = 4000;

function assertWord(w: WordCue, label: string): WordCue {
  if (typeof w.text !== "string" || w.text.trim() === "") {
    throw new Error(`${label} has empty text`);
  }
  if (typeof w.start !== "number" || !Number.isFinite(w.start) || w.start < 0) {
    throw new Error(`${label} has invalid start time`);
  }
  return { text: w.text.trim(), start: w.start };
}

function assertLines(lines: LineCue[]): LineCue[] {
  if (lines.length === 0) {
    throw new Error("Lyrics contain no lines");
  }

  const normalized = lines.map((line, li) => {
    if (typeof line.start !== "number" || !Number.isFinite(line.start) || line.start < 0) {
      throw new Error(`Line ${li} has invalid start time`);
    }
    if (!Array.isArray(line.words) || line.words.length === 0) {
      throw new Error(`Line ${li} has no words`);
    }
    const words = line.words.map((w, wi) => assertWord(w, `Line ${li} word ${wi}`));
    for (let i = 1; i < words.length; i++) {
      if (words[i].start < words[i - 1].start) {
        throw new Error(
          `Line ${li}: words must be sorted by start (${words[i].start} < ${words[i - 1].start})`,
        );
      }
    }
    return { start: line.start, words };
  });

  for (let i = 1; i < normalized.length; i++) {
    if (normalized[i].start < normalized[i - 1].start) {
      throw new Error(
        `Lines must be sorted by start time (index ${i}: ${normalized[i].start} < ${normalized[i - 1].start})`,
      );
    }
  }

  return normalized;
}

function frontloadWords(tokens: string[], start: number): WordCue[] {
  const step = Math.min(WORD_MS, BURST_CAP_MS / Math.max(tokens.length, 1)) / 1000;
  return tokens.map((token, idx) => ({ text: token, start: start + idx * step }));
}

/** Split into the fewest near-equal chunks that all fit within `size`. */
function chunkEvenly<T>(items: T[], size: number): T[][] {
  const count = Math.ceil(items.length / size);
  const per = Math.ceil(items.length / count);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += per) {
    out.push(items.slice(i, i + per));
  }
  return out;
}

/**
 * Long lyric lines become several timed screens shown one after another
 * (same behavior as separate LRC lines). Short lines are unchanged.
 */
export function expandLongLines(lines: LineCue[]): LineCue[] {
  const out: LineCue[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.words.length <= SPLIT_ABOVE) {
      out.push(line);
      continue;
    }

    const chunks = chunkEvenly(line.words, SPLIT_ABOVE);
    const timedChunks = chunks
      .slice(1)
      .every((chunk) => chunk[0].start > line.start + 0.05);

    if (timedChunks) {
      out.push({ start: line.start, words: chunks[0] });
      for (const chunk of chunks.slice(1)) {
        out.push({ start: chunk[0].start, words: chunk });
      }
      continue;
    }

    // Plain LRC front-load: share the line's span between the screens and retime each
    const nextStart = lines[i + 1]?.start;
    const slot =
      nextStart != null && nextStart > line.start
        ? (nextStart - line.start) / chunks.length
        : (SPLIT_ABOVE * WORD_MS) / 1000 + 0.2;

    chunks.forEach((chunk, index) => {
      const startAt = line.start + index * slot;
      out.push({
        start: startAt,
        words: frontloadWords(
          chunk.map((w) => w.text),
          startAt,
        ),
      });
    });
  }

  return assertLines(out);
}

function wordsToSingleLine(words: WordCue[]): LineCue[] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  return assertLines([{ start: sorted[0].start, words: sorted }]);
}

function parseJsonLyrics(raw: string): LyricsDoc {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON lyrics file");
  }

  if (!data || typeof data !== "object") {
    throw new Error("Lyrics JSON must be an object");
  }

  const obj = data as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title : undefined;

  if (Array.isArray(obj.lines)) {
    const lines = assertLines(
      obj.lines.map((item, i) => {
        if (!item || typeof item !== "object") {
          throw new Error(`Line at index ${i} is not an object`);
        }
        const line = item as Record<string, unknown>;
        if (!Array.isArray(line.words)) {
          throw new Error(`Line ${i} must include a "words" array`);
        }
        return {
          start: Number(line.start),
          words: line.words.map((w, wi) => {
            if (!w || typeof w !== "object") {
              throw new Error(`Line ${i} word ${wi} is not an object`);
            }
            const word = w as Record<string, unknown>;
            return {
              text: String(word.text ?? ""),
              start: Number(word.start),
            };
          }),
        };
      }),
    );
    return { title, lines: expandLongLines(lines) };
  }

  // Legacy flat words → one line (or group by large gaps)
  if (Array.isArray(obj.words)) {
    const words = obj.words.map((item, i) => {
      if (!item || typeof item !== "object") {
        throw new Error(`Word at index ${i} is not an object`);
      }
      const w = item as Record<string, unknown>;
      return assertWord(
        { text: String(w.text ?? ""), start: Number(w.start) },
        `Word ${i}`,
      );
    });
    return { title, lines: expandLongLines(wordsToSingleLine(words)) };
  }

  throw new Error('Lyrics JSON must include a "lines" or "words" array');
}

/** Parse [mm:ss.xx] or [mm:ss.xxx] timestamp to seconds */
function parseClock(tag: string): number {
  const m = tag.match(/^\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]$/);
  if (!m) {
    throw new Error(`Invalid LRC timestamp: ${tag}`);
  }
  const minutes = Number(m[1]);
  const seconds = Number(m[2]);
  const frac = m[3] ? Number(m[3].padEnd(3, "0")) / 1000 : 0;
  return minutes * 60 + seconds + frac;
}

/** Parse <mm:ss.xx> word-level timestamp to seconds */
function parseWordClock(tag: string): number {
  const m = tag.match(/^<(\d+):(\d{2})(?:\.(\d{1,3}))?>$/);
  if (!m) {
    throw new Error(`Invalid word timestamp: ${tag}`);
  }
  const minutes = Number(m[1]);
  const seconds = Number(m[2]);
  const frac = m[3] ? Number(m[3].padEnd(3, "0")) / 1000 : 0;
  return minutes * 60 + seconds + frac;
}

/**
 * Enhanced LRC: line tags plus optional word tags.
 * Each `[mm:ss.xx]` row becomes one LineCue; only that line shows while active.
 */
function parseLrcLyrics(raw: string): LyricsDoc {
  const lines = raw.split(/\r?\n/);
  let title: string | undefined;

  type RawLine = { start: number; body: string };
  const lineCues: RawLine[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const meta = trimmed.match(/^\[(ti|title):(.*)\]$/i);
    if (meta) {
      title = meta[2].trim();
      continue;
    }

    if (/^\[[a-zA-Z]+:/.test(trimmed) && !/\[\d+:\d{2}/.test(trimmed)) {
      continue;
    }

    const tagMatch = trimmed.match(/^((?:\[\d+:\d{2}(?:\.\d{1,3})?\])+)\s*(.*)$/);
    if (!tagMatch) continue;

    const tagsPart = tagMatch[1];
    const body = tagMatch[2];
    if (!body.trim()) continue;

    const tags = [...tagsPart.matchAll(/\[\d+:\d{2}(?:\.\d{1,3})?\]/g)].map((m) =>
      parseClock(m[0]),
    );

    for (const start of tags) {
      lineCues.push({ start, body });
    }
  }

  lineCues.sort((a, b) => a.start - b.start);

  const parsed: LineCue[] = [];

  for (let i = 0; i < lineCues.length; i++) {
    const { start, body } = lineCues[i];
    const wordTags = [...body.matchAll(/<(\d+):(\d{2})(?:\.(\d{1,3}))?>/g)];
    const words: WordCue[] = [];

    if (wordTags.length > 0) {
      const parts = body.split(/(<\d+:\d{2}(?:\.\d{1,3})?>)/).filter(Boolean);
      let currentTime = start;
      for (const part of parts) {
        if (/^<\d+:\d{2}(?:\.\d{1,3})?>$/.test(part)) {
          currentTime = parseWordClock(part);
          continue;
        }
        const tokens = part.trim().split(/\s+/).filter(Boolean);
        for (const token of tokens) {
          words.push({ text: token, start: currentTime });
        }
      }
    } else {
      // Front-load words in a short burst after line start, then hold until next line.
      // Stretching across the full gap to nextStart makes late words lag the vocal.
      const tokens = body.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;
      words.push(...frontloadWords(tokens, start));
    }

    if (words.length > 0) {
      parsed.push({ start, words });
    }
  }

  return { title, lines: expandLongLines(assertLines(parsed)) };
}

export function loadLyrics(filePath: string): LyricsDoc {
  const raw = readFileSync(filePath, "utf8");
  const ext = extname(filePath).toLowerCase();

  if (ext === ".json") {
    return parseJsonLyrics(raw);
  }
  if (ext === ".lrc" || ext === ".txt") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      return parseJsonLyrics(raw);
    }
    return parseLrcLyrics(raw);
  }

  if (raw.trim().startsWith("{")) {
    return parseJsonLyrics(raw);
  }
  return parseLrcLyrics(raw);
}
