/** 3×5 block glyphs — bigger lyrics without spacing letters apart */
export const FONT_H = 5;
export const FONT_W = 3;

type Glyph = readonly [string, string, string, string, string];

const ON = "#";
const OFF = " ";

function g(...rows: [string, string, string, string, string]): Glyph {
  return rows.map((row) =>
    [...row.padEnd(FONT_W).slice(0, FONT_W)]
      .map((c) => (c === "#" ? ON : OFF))
      .join(""),
  ) as unknown as Glyph;
}

const GLYPHS: Record<string, Glyph> = {
  a: g(" # ", "# #", "###", "# #", "# #"),
  b: g("## ", "# #", "## ", "# #", "## "),
  c: g(" ##", "#  ", "#  ", "#  ", " ##"),
  d: g("## ", "# #", "# #", "# #", "## "),
  e: g("###", "#  ", "## ", "#  ", "###"),
  f: g("###", "#  ", "## ", "#  ", "#  "),
  g: g(" ##", "#  ", "# #", "# #", " ##"),
  h: g("# #", "# #", "###", "# #", "# #"),
  i: g("###", " # ", " # ", " # ", "###"),
  j: g("###", "  #", "  #", "# #", " # "),
  k: g("# #", "# #", "## ", "# #", "# #"),
  l: g("#  ", "#  ", "#  ", "#  ", "###"),
  m: g("# #", "###", "# #", "# #", "# #"),
  n: g("# #", "###", "###", "# #", "# #"),
  o: g(" # ", "# #", "# #", "# #", " # "),
  p: g("## ", "# #", "## ", "#  ", "#  "),
  q: g(" # ", "# #", "# #", " ##", "  #"),
  r: g("## ", "# #", "## ", "# #", "# #"),
  s: g(" ##", "#  ", " # ", "  #", "## "),
  t: g("###", " # ", " # ", " # ", " # "),
  u: g("# #", "# #", "# #", "# #", "###"),
  v: g("# #", "# #", "# #", "# #", " # "),
  w: g("# #", "# #", "# #", "###", "# #"),
  x: g("# #", "# #", " # ", "# #", "# #"),
  y: g("# #", "# #", " # ", " # ", " # "),
  z: g("###", "  #", " # ", "#  ", "###"),
  "0": g("###", "# #", "# #", "# #", "###"),
  "1": g(" # ", "## ", " # ", " # ", "###"),
  "2": g("## ", "  #", " # ", "#  ", "###"),
  "3": g("###", "  #", " ##", "  #", "###"),
  "4": g("# #", "# #", "###", "  #", "  #"),
  "5": g("###", "#  ", "###", "  #", "## "),
  "6": g(" ##", "#  ", "###", "# #", "###"),
  "7": g("###", "  #", " # ", " # ", " # "),
  "8": g("###", "# #", "###", "# #", "###"),
  "9": g("###", "# #", "###", "  #", "## "),
  "'": g(" # ", " # ", "   ", "   ", "   "),
  ",": g("   ", "   ", "   ", " # ", "#  "),
  ".": g("   ", "   ", "   ", "   ", " # "),
  "!": g(" # ", " # ", " # ", "   ", " # "),
  "?": g("## ", "  #", " # ", "   ", " # "),
  "-": g("   ", "   ", "###", "   ", "   "),
  "(": g(" # ", "#  ", "#  ", "#  ", " # "),
  ")": g(" # ", "  #", "  #", "  #", " # "),
};

const FALLBACK = g("###", "# #", "# #", "# #", "###");

function glyphFor(ch: string): Glyph {
  return GLYPHS[ch] ?? FALLBACK;
}

/** Cell width of a word in the block font (letters packed tight). */
export function wordCellWidth(word: string): number {
  return Math.max(0, [...word].length * FONT_W);
}

/** Render one word as FONT_H terminal rows (letters flush). */
export function renderWord(word: string): string[] {
  const lines = Array.from({ length: FONT_H }, () => "");
  for (const ch of word) {
    const glyph = glyphFor(ch);
    for (let r = 0; r < FONT_H; r++) {
      lines[r] += glyph[r];
    }
  }
  return lines;
}

/** Blank stand-in with the same width as a word (for unrevealed cues). */
export function blankWordCells(letterCount: number): string[] {
  const w = letterCount * FONT_W;
  return Array.from({ length: FONT_H }, () => " ".repeat(w));
}

/**
 * Paint a justified row: visible words + gap sizes (cells between words).
 * Pass `revealed` flags parallel to words (false → blank placeholder).
 */
export function renderBigRow(
  words: string[],
  revealed: boolean[],
  gapSizes: number[],
): string[] {
  const lines = Array.from({ length: FONT_H }, () => "");
  for (let i = 0; i < words.length; i++) {
    const piece = revealed[i]
      ? renderWord(words[i])
      : blankWordCells(words[i].length);
    for (let r = 0; r < FONT_H; r++) {
      lines[r] += piece[r];
      if (i < gapSizes.length) {
        lines[r] += " ".repeat(gapSizes[i]);
      }
    }
  }
  return lines;
}
