/**
 * Guards the one rule `src/core/` has to keep: it runs in a browser as well as
 * in Node, so it may not reach for either host's globals.
 *
 * A stray `node:fs` import there would typecheck fine and only fail once the
 * web build tried to bundle it, which is a long way from the mistake.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../src/core", import.meta.url));

const BANNED = [
  [/\bfrom\s+["']node:/, "imports a node: builtin"],
  [/\brequire\s*\(/, "uses require()"],
  [/\bprocess\s*\./, "touches process"],
  [/\b__dirname\b|\b__filename\b/, "uses a CommonJS path global"],
  [/\bdocument\s*\./, "touches document"],
  [/\bwindow\s*\./, "touches window"],
  [/\bnavigator\s*\./, "touches navigator"],
  [/\blocalStorage\b/, "touches localStorage"],
];

/**
 * Tests are exempt: they run only under Node, are never bundled for the
 * browser, and reading a fixture off disk is the clearest way to check the
 * parser against the files it actually has to handle.
 */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

const problems = [];
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    // Prose in a comment describing the hosts is not a violation.
    const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
    for (const [pattern, why] of BANNED) {
      if (pattern.test(code)) {
        problems.push(`src/core/${file.slice(ROOT.length + 1)}:${i + 1} ${why}\n    ${line.trim()}`);
      }
    }
  });
}

if (problems.length > 0) {
  console.error("core/ must stay host-agnostic:\n\n" + problems.join("\n") + "\n");
  process.exit(1);
}
console.log("core/ is host-agnostic");
