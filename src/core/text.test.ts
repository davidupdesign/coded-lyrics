import { describe, expect, it } from "vitest";
import { NO_WORD, TRANSITION_MS, layoutLine, wordStates } from "./text.js";
import { ATTR_DIM, ATTR_INK } from "./palette.js";
import type { LineCue } from "./types.js";

/** Read a row's owner array back as the words it claims, for readable assertions. */
function owned(text: string, owner: Int16Array): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (owner[i] === NO_WORD) {
      i++;
      continue;
    }
    let end = i;
    while (end < text.length && owner[end] === owner[i]) end++;
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

describe("layoutLine", () => {
  it("packs words up to the width and wraps at the last one that fits", () => {
    const rows = layoutLine(["aaa", "bbb", "ccc"], 7);
    expect(rows.map((r) => r.text)).toEqual(["aaa bbb", "ccc"]);
  });

  it("records which word each character came from, spaces excluded", () => {
    const [row] = layoutLine(["hi", "there"], 20);
    expect(row.text).toBe("hi there");
    expect(owned(row.text, row.owner)).toEqual(["hi", "there"]);
    expect(row.owner[2]).toBe(NO_WORD);
  });

  it("keeps owner indices pointing at the original word list across rows", () => {
    const rows = layoutLine(["one", "two", "three"], 7);
    // "three" is word 2 even though it lands first on its own row.
    expect(rows[1].owner[0]).toBe(2);
  });

  it("gives an over-long word its own row rather than splitting it", () => {
    const rows = layoutLine(["ok", "supercalifragilistic"], 8);
    expect(rows.map((r) => r.text)).toEqual(["ok", "supercalifragilistic"]);
    // Left intact and over width — the renderer clips, which reads better than
    // a hyphen-less break.
    expect(rows[1].text.length).toBeGreaterThan(8);
  });

  it("drops empty words instead of emitting stray spaces", () => {
    const [row] = layoutLine(["a", "", "b"], 20);
    expect(row.text).toBe("a b");
  });

  it("survives a degenerate width", () => {
    expect(() => layoutLine(["a", "b"], 0)).not.toThrow();
    expect(() => layoutLine(["a", "b"], -5)).not.toThrow();
    expect(layoutLine([], 10)).toEqual([]);
  });
});

describe("wordStates", () => {
  const line: LineCue = {
    start: 10,
    words: [
      { text: "a", start: 10 },
      { text: "b", start: 11 },
    ],
  };

  it("marks unreached words with a negative progress", () => {
    const [a, b] = wordStates(line, 10, null);
    expect(a.p).toBe(0);
    expect(b.p).toBeLessThan(0);
  });

  it("reaches exactly 1 after the transition duration", () => {
    const [a] = wordStates(line, 10 + TRANSITION_MS / 1000, null);
    expect(a.p).toBeCloseTo(1, 10);
  });

  it("keeps running past 1 so settled words stay settled", () => {
    const [a] = wordStates(line, 30, null);
    expect(a.p).toBeGreaterThan(1);
    expect(a.attr).toBe(ATTR_INK);
  });

  it("runs the whole line backwards under fadeOut, at the dim attribute", () => {
    const states = wordStates(line, 10, 0.25);
    expect(states.map((s) => s.p)).toEqual([0.75, 0.75]);
    expect(states.every((s) => s.attr === ATTR_DIM)).toBe(true);
  });

  it("is a pure function of elapsed", () => {
    expect(wordStates(line, 10.4, null)).toEqual(wordStates(line, 10.4, null));
  });
});
