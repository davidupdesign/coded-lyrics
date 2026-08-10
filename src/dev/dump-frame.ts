/**
 * Golden-frame harness.
 *
 * Drives the renderer over a matrix of grid sizes, palettes, transitions and
 * playback positions, and dumps the exact bytes it would have written to the
 * terminal. The output is byte-compared before and after refactors: the render
 * pipeline is a large pile of tuned constants with no other test coverage, so
 * this file is the safety net for moving it around.
 *
 * Everything feeding the renderer is deterministic and self-contained. The
 * video and envelope stubs stand in for ffmpeg, whose output is not reproducible
 * across machines, and both are built from integer arithmetic and `hash01` only
 * — no transcendentals, whose last bits are not pinned by the spec and could
 * drift between engine versions.
 *
 *   npx tsx src/dev/dump-frame.ts test/fixtures/golden-frames.txt
 */
import { writeFileSync } from "node:fs";
import { AnsiRenderer } from "../node/renderer.js";
import { ColorWriter, type ColorDepth } from "../node/ansi.js";
import { PALETTES, type Palette } from "../core/palette.js";
import { TRANSITION_KINDS, type TransitionKind } from "../core/transitions.js";
import { hash01 } from "../core/hash.js";
import type { LyricsDoc, ReactLevel } from "../core/types.js";
import type { Envelope, VideoSource } from "../core/ports.js";

// --------------------------------------------------------------------- stubs

/** Matches the real decoder's store size so the sampler sees the same mapping. */
const STUB_W = 128;
const STUB_H = 72;

/**
 * A synthetic clip: diagonal bands drifting with time, plus fixed noise.
 *
 * The bands produce long runs of one brightness tier and the noise breaks them
 * up, so both halves of `emitRow`'s "only emit an SGR when the attribute
 * changes" branch get exercised on every row.
 */
function stubVideo(): VideoSource {
  const cache = new Map<number, Uint8Array>();

  const build = (idx: number): Uint8Array => {
    const f = new Uint8Array(STUB_W * STUB_H);
    for (let y = 0; y < STUB_H; y++) {
      for (let x = 0; x < STUB_W; x++) {
        const wave = (x * 5 + idx * 7) % 64;
        const band = (y * 3) % 48;
        const noise = Math.floor(hash01(x, y, idx) * 40);
        const v = wave * 3 + band + noise;
        f[y * STUB_W + x] = v > 255 ? 255 : v;
      }
    }
    return f;
  };

  return {
    width: STUB_W,
    height: STUB_H,
    frameCount: 1,
    frameAt(sec) {
      const idx = Math.max(0, Math.floor(sec * 12));
      let f = cache.get(idx);
      if (!f) {
        f = build(idx);
        cache.set(idx, f);
      }
      return f;
    },
    close() {},
  };
}

/** Energy ramps over two seconds; kicks land every 500 ms. */
function stubEnvelope(): Envelope {
  return {
    rate: 50,
    energy: new Float32Array(0),
    sinceKick: new Float32Array(0),
    energyAt(sec) {
      const f = Math.floor(Math.max(0, sec) * 50);
      return (f % 100) / 99;
    },
    kickAgeAt(sec) {
      const f = Math.floor(Math.max(0, sec) * 50);
      return (f % 25) / 50;
    },
  };
}

// ------------------------------------------------------------------- fixture

/**
 * Exercises the paths the small `examples/` fixtures miss: a line that wraps at
 * 80 columns, a word wider than a narrow grid (which the renderer clips rather
 * than splits), and a gap before the first line so the title card has room.
 */
const LYRICS: LyricsDoc = {
  title: "Golden Frames",
  lines: [
    {
      start: 2.0,
      words: [
        { text: "nothing", start: 2.0 },
        { text: "lasts", start: 2.3 },
        { text: "forever", start: 2.6 },
      ],
    },
    {
      start: 3.5,
      words: [
        "the", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog",
        "while", "the", "neon", "sign", "flickers", "above", "an", "empty",
        "parking", "lot",
      ].map((text, i) => ({ text, start: 3.5 + i * 0.12 })),
    },
    {
      start: 6.0,
      words: [{ text: "supercalifragilisticexpialidocious", start: 6.0 }],
    },
    {
      start: 7.5,
      words: [
        { text: "END", start: 7.5 },
        { text: "OF", start: 7.7 },
        { text: "TAPE", start: 7.9 },
      ],
    },
  ],
};

// ------------------------------------------------------------------ plumbing

interface Case {
  label: string;
  cols: number;
  rows: number;
  position: number;
  palette: Palette;
  transition: TransitionKind;
  react: ReactLevel;
  depth: ColorDepth;
  plate: boolean;
  video: boolean;
  titleCard: boolean;
}

const BASE: Omit<Case, "label"> = {
  cols: 80,
  rows: 24,
  position: 3.9,
  palette: PALETTES.phosphor,
  transition: "wipe",
  react: "subtle",
  depth: "truecolor",
  plate: true,
  video: true,
  titleCard: true,
};

function setSize(cols: number, rows: number): void {
  Object.defineProperty(process.stdout, "columns", { value: cols, configurable: true });
  Object.defineProperty(process.stdout, "rows", { value: rows, configurable: true });
}

/**
 * Render one case and return the bytes.
 *
 * A fresh renderer per case makes every paint a full repaint — row diffing would
 * otherwise emit only what changed since the previous case, which is not what we
 * want to pin down here.
 */
function render(c: Case): string {
  setSize(c.cols, c.rows);

  const renderer = new AnsiRenderer({
    palette: c.palette,
    colors: new ColorWriter(c.depth),
    transition: c.transition,
    react: c.react,
    titleCard: c.titleCard,
    envelope: c.react === "off" ? null : stubEnvelope(),
    video: c.video ? stubVideo() : null,
    plate: c.plate,
    videoGain: 1,
    title: LYRICS.title,
  });

  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as NodeJS.WriteStream).write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    renderer.paint(LYRICS.lines, c.position, {
      paused: false,
      position: c.position,
      duration: 9.5,
    });
  } finally {
    (process.stdout as NodeJS.WriteStream).write = original;
  }

  return chunks.join("");
}

function cases(): Case[] {
  const out: Case[] = [];
  const add = (label: string, patch: Partial<Case>) =>
    out.push({ ...BASE, label, ...patch });

  // Playback positions: before the first line, mid title card, title fading,
  // mid word entrance, the line handover window, wrapping, clipping, the end.
  // 5.8 is the only point where the wrapped line is settled on both of its rows
  // — its last word lands at 5.66 and the next line takes over at 6.0.
  for (const position of [
    0, 0.1, 1.7, 1.95, 2.0, 2.08, 2.45, 3.5, 3.55, 4.2, 5.8, 6.1, 7.6, 9.4,
  ]) {
    add(`position/${position}`, { position });
  }

  for (const name of Object.keys(PALETTES)) {
    add(`palette/${name}`, { palette: PALETTES[name] });
  }

  // Two positions per transition: mid-entrance, where the effects differ most,
  // and settled, where every effect must agree.
  for (const transition of TRANSITION_KINDS) {
    add(`transition/${transition}/mid`, { transition, position: 3.56 });
    add(`transition/${transition}/settled`, { transition, position: 4.9 });
  }

  for (const react of ["off", "subtle", "full"] as ReactLevel[]) {
    // 3.9 sits inside a kick's flash window, so the ground/pulse paths engage.
    add(`react/${react}`, { react });
    add(`react/${react}/no-video`, { react, video: false });
  }

  for (const depth of ["truecolor", "256", "none"] as ColorDepth[]) {
    add(`depth/${depth}`, { depth });
  }

  for (const [cols, rows] of [[80, 24], [40, 12], [24, 8], [20, 4], [120, 40], [200, 60]]) {
    add(`grid/${cols}x${rows}`, { cols, rows });
    add(`grid/${cols}x${rows}/clip`, { cols, rows, position: 6.1 });
  }

  add("plate/off", { plate: false });
  add("plate/off/no-video", { plate: false, video: false });
  add("video/off", { video: false });
  add("video/off/vhs", { video: false, palette: PALETTES.vhs });
  add("video/off/brat", { video: false, palette: PALETTES.brat });
  add("title/off", { titleCard: false, position: 0.1 });

  // A few crossed settings, since the sweeps above only vary one axis at a time.
  add("combo/vhs-glitch-full", {
    palette: PALETTES.vhs,
    transition: "glitch",
    react: "full",
    position: 3.58,
  });
  add("combo/360-dissolve-256", {
    palette: PALETTES["360"],
    transition: "dissolve",
    depth: "256",
    position: 2.04,
  });
  add("combo/amber-none-noplate-wide", {
    palette: PALETTES.amber,
    transition: "none",
    plate: false,
    cols: 200,
    rows: 60,
    position: 3.6,
  });
  add("combo/mono-nocolor-narrow", {
    palette: PALETTES.mono,
    depth: "none",
    cols: 24,
    rows: 8,
    position: 3.9,
  });

  return out;
}

// ---------------------------------------------------------------------- main

const lines: string[] = [];
for (const c of cases()) {
  lines.push(`### ${c.label} cols=${c.cols} rows=${c.rows} pos=${c.position} ` +
    `palette=${c.palette.name} transition=${c.transition} react=${c.react} ` +
    `depth=${c.depth} plate=${c.plate} video=${c.video} title=${c.titleCard}`);
  lines.push(JSON.stringify(render(c)));
}

const dump = lines.join("\n") + "\n";
const target = process.argv[2];
if (target) {
  writeFileSync(target, dump);
  process.stderr.write(`wrote ${target} (${cases().length} cases, ${dump.length} bytes)\n`);
} else {
  process.stdout.write(dump);
}
