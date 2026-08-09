/**
 * Re-renders the golden frames and compares them with what was recorded.
 *
 * The render pipeline has no other test coverage and a lot of tuned constants,
 * so this is what makes moving it around safe.
 *
 * Two comparisons, because they answer different questions. Bytes catch any
 * change at all, including ones that only affect how much is written down the
 * pipe. Replaying each frame into (char, fg, bg) per cell catches only changes
 * a viewer could actually see. A byte diff with an identical screen is an
 * encoding change — usually fine, always worth looking at; a screen diff is a
 * visual change and needs a reason.
 *
 * If a diff is intended, re-record with `npm run goldens` and review it.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const expectedPath = join(root, "test/fixtures/golden-frames.txt");
const actualPath = join(mkdtempSync(join(tmpdir(), "coded-lyrics-")), "goldens.txt");

execFileSync("npx", ["tsx", "src/dev/dump-frame.ts", actualPath], {
  cwd: root,
  stdio: ["ignore", "ignore", "inherit"],
});

/** Replay a frame into the cells it paints, ignoring how it got there. */
function screen(s) {
  const cells = [];
  let fg = "";
  let bg = "";
  let row = -1;
  let col = 0;
  const put = (txt) => {
    for (const ch of txt) cells.push(`${row},${col++}:${ch}:${fg}:${bg}`);
  };

  const re = /\x1b\[([0-9;]*)([mH])/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    put(s.slice(last, m.index));
    last = re.lastIndex;
    if (m[2] === "H") {
      const [r, c] = m[1].split(";");
      row = Number(r) || 1;
      col = Number(c) || 1;
      continue;
    }
    const p = m[1];
    if (p === "0" || p === "") {
      fg = "";
      bg = "";
    } else if (p.startsWith("38;")) fg = p;
    else if (p.startsWith("48;")) bg = p;
  }
  put(s.slice(last));
  return cells.join("\n");
}

function load(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  const out = new Map();
  for (let i = 0; i < lines.length - 1; i += 2) {
    if (lines[i].startsWith("### ")) out.set(lines[i], JSON.parse(lines[i + 1]));
  }
  return out;
}

const expected = load(expectedPath);
const actual = load(actualPath);

const byteDiffs = [];
const screenDiffs = [];
for (const [label, want] of expected) {
  const got = actual.get(label);
  if (got === want) continue;
  byteDiffs.push(label);
  if (got === undefined || screen(want) !== screen(got)) screenDiffs.push(label);
}
for (const label of actual.keys()) {
  if (!expected.has(label)) byteDiffs.push(`${label}  (new case)`);
}

if (byteDiffs.length === 0) {
  console.log(`goldens match (${expected.size} cases)`);
  process.exit(0);
}

const show = (list) => list.slice(0, 15).forEach((l) => console.error(`  ${l.slice(4)}`));

if (screenDiffs.length > 0) {
  console.error(`\n${screenDiffs.length} case(s) render differently:\n`);
  show(screenDiffs);
} else {
  console.error(
    `\n${byteDiffs.length} case(s) differ in bytes but render identically ` +
      `— an encoding change, not a visual one:\n`,
  );
  show(byteDiffs);
}
console.error(`\nexpected: ${expectedPath}\nactual:   ${actualPath}\n`);
process.exit(1);
