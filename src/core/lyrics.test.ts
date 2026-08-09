import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseLyrics, sniffFormat } from "./lyrics.js";

const fixture = (name: string) =>
  readFileSync(new URL(`../../examples/${name}`, import.meta.url), "utf8");

const texts = (doc: { lines: { words: { text: string }[] }[] }) =>
  doc.lines.map((l) => l.words.map((w) => w.text).join(" "));

describe("sniffFormat", () => {
  it("treats a leading object as JSON and everything else as LRC", () => {
    expect(sniffFormat('  {"lines":[]}')).toBe("json");
    expect(sniffFormat("[00:01.00]hello")).toBe("lrc");
    expect(sniffFormat("")).toBe("lrc");
  });
});

describe("LRC", () => {
  it("parses the shipped fixture", () => {
    const doc = parseLyrics(fixture("sample.lrc"), "auto");
    expect(doc.lines.length).toBeGreaterThan(0);
    expect(doc.lines[0].words.length).toBeGreaterThan(0);
  });

  it("reads [ti:] as the title and ignores other metadata", () => {
    const doc = parseLyrics("[ti:Some Song]\n[ar:Nobody]\n[00:01.00]hello there", "lrc");
    expect(doc.title).toBe("Some Song");
    expect(texts(doc)).toEqual(["hello there"]);
  });

  it("skips blanks and # comments", () => {
    const doc = parseLyrics("# note\n\n[00:01.00]only line\n", "lrc");
    expect(texts(doc)).toEqual(["only line"]);
  });

  it("expands repeated line tags into separate cues", () => {
    const doc = parseLyrics("[00:01.00][00:30.00]chorus", "lrc");
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines[0].start).toBeCloseTo(1);
    expect(doc.lines[1].start).toBeCloseTo(30);
  });

  it("sorts cues by time regardless of file order", () => {
    const doc = parseLyrics("[00:30.00]later\n[00:01.00]earlier", "lrc");
    expect(texts(doc)).toEqual(["earlier", "later"]);
  });

  it("pads a fractional timestamp to milliseconds", () => {
    // .5 is 500 ms, not 5 — the fraction is left-aligned.
    expect(parseLyrics("[00:01.5]x", "lrc").lines[0].start).toBeCloseTo(1.5);
    expect(parseLyrics("[00:01.05]x", "lrc").lines[0].start).toBeCloseTo(1.05);
    expect(parseLyrics("[01:02.250]x", "lrc").lines[0].start).toBeCloseTo(62.25);
  });

  it("honours enhanced word timings, and inherits them for following tokens", () => {
    const doc = parseLyrics("[00:10.00]<00:10.00>one two <00:12.00>three", "lrc");
    const [line] = doc.lines;
    expect(line.words.map((w) => w.text)).toEqual(["one", "two", "three"]);
    expect(line.words[0].start).toBeCloseTo(10);
    expect(line.words[1].start).toBeCloseTo(10);
    expect(line.words[2].start).toBeCloseTo(12);
  });

  it("front-loads plain lines in a burst rather than stretching to the next", () => {
    const doc = parseLyrics("[00:00.00]a b c\n[01:00.00]next", "lrc");
    const gaps = doc.lines[0].words.slice(1).map((w, i) => w.start - doc.lines[0].words[i].start);
    // Words land ~280 ms apart, nowhere near the 60 s until the next line.
    for (const g of gaps) expect(g).toBeCloseTo(0.28, 2);
  });

  it("splits a long line into sequential screens", () => {
    const many = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    const doc = parseLyrics(`[00:00.00]${many}\n[00:30.00]next`, "lrc");
    expect(doc.lines.length).toBeGreaterThan(2);
    for (const line of doc.lines) expect(line.words.length).toBeLessThanOrEqual(12);
    // The screens are spread across the line's own span, not stacked at zero.
    expect(doc.lines[1].start).toBeGreaterThan(doc.lines[0].start);
  });

  it("keeps real word times when a long enhanced line is split", () => {
    const words = Array.from({ length: 20 }, (_, i) => `<00:${String(i + 10).padStart(2, "0")}.00>w${i}`).join(" ");
    const doc = parseLyrics(`[00:10.00]${words}`, "lrc");
    expect(doc.lines.length).toBeGreaterThan(1);
    expect(doc.lines[1].start).toBeCloseTo(doc.lines[1].words[0].start);
  });

  it("rejects a file with no timed lines", () => {
    expect(() => parseLyrics("just prose, no tags", "lrc")).toThrow(/no lines/i);
  });
});

describe("JSON", () => {
  it("parses the shipped fixture", () => {
    const doc = parseLyrics(fixture("sample.json"), "json");
    expect(doc.lines.length).toBeGreaterThan(0);
  });

  it("accepts a flat word list as a single line", () => {
    const doc = parseLyrics(
      JSON.stringify({ title: "T", words: [{ text: "a", start: 0 }, { text: "b", start: 1 }] }),
      "json",
    );
    expect(doc.title).toBe("T");
    expect(texts(doc)).toEqual(["a b"]);
  });

  it("reports malformed input rather than throwing something opaque", () => {
    expect(() => parseLyrics("{oops", "json")).toThrow(/invalid json/i);
    expect(() => parseLyrics("[]", "json")).toThrow(/lines.*words/i);
    expect(() => parseLyrics('{"lines":[]}', "json")).toThrow(/no lines/i);
  });

  it("rejects invalid times and empty text", () => {
    const bad = (lines: unknown) => () => parseLyrics(JSON.stringify({ lines }), "json");
    expect(bad([{ start: -1, words: [{ text: "a", start: 0 }] }])).toThrow(/start time/i);
    expect(bad([{ start: 0, words: [{ text: "  ", start: 0 }] }])).toThrow(/empty text/i);
    expect(bad([{ start: 0, words: [] }])).toThrow(/no words/i);
  });

  it("rejects lines or words that run backwards", () => {
    const outOfOrder = {
      lines: [
        { start: 5, words: [{ text: "a", start: 5 }] },
        { start: 1, words: [{ text: "b", start: 1 }] },
      ],
    };
    expect(() => parseLyrics(JSON.stringify(outOfOrder), "json")).toThrow(/sorted/i);

    const wordsBackwards = {
      lines: [{ start: 0, words: [{ text: "a", start: 5 }, { text: "b", start: 1 }] }],
    };
    expect(() => parseLyrics(JSON.stringify(wordsBackwards), "json")).toThrow(/sorted/i);
  });
});

describe("format dispatch", () => {
  it("auto-detects JSON held in a file that looks like LRC", () => {
    const raw = fixture("sample.json");
    expect(parseLyrics(raw, "auto")).toEqual(parseLyrics(raw, "json"));
  });
});
