# Open-source readiness TODO

Punch list from the 2026-09-07 repo audit. The code architecture (core/node/web
split, `ports.ts` seam, golden-frame cross-host check) is in good shape — these
items are about the project scaffolding needed to publish and take contributions.

Ordered by priority. Check items off as they land.

## 1. Blockers — must clear before the repo is public

- [ ] **Remove `2TONE/`, lyrics included.** `2TONE/2TONE.lrc` is verbatim
      lyrics of a commercial track (audio/video there are already gitignored,
      the `.lrc` is not). Verbatim song lyrics in a public repo are an
      infringement exposure.
  - [ ] `git rm 2TONE/2TONE.lrc` and delete the folder
  - [ ] strip `2TONE` from `.vercelignore`
  - [ ] add one more original example under `examples/` to replace it as a demo input
- [ ] **Add a `LICENSE` file** at the repo root (MIT, David K, 2026).
      `package.json` and the README say MIT but there is no license text, so
      GitHub won't detect it and the grant isn't actually made.

## 2. CI and contributor infrastructure

- [ ] **Add CI** — `.github/workflows/ci.yml` running
      `npm ci && npm --prefix web ci && npm run check` on a Node 18 / 20 / 22
      matrix. `npm run check` already covers typecheck (both packages), tests,
      and golden frames; nothing runs it on push/PR today.
- [ ] **`CONTRIBUTING.md`** — how to run the checks, the `src/core/`
      host-agnostic rule (enforced by `scripts/check-core.mjs`), how the
      golden-frame workflow works and how to regenerate goldens
      (`npm run goldens`), branch/PR expectations.
- [ ] **`CODE_OF_CONDUCT.md`** — Contributor Covenant.
- [ ] **`.github/ISSUE_TEMPLATE/`** (bug + feature) and a PR template.
- [ ] **`SECURITY.md`** — where to report (private), even if minimal.

## 3. Project hygiene

- [ ] **Collapse install to one command.** Add npm workspaces
      (`"workspaces": ["web"]` in root `package.json`) so a single
      `npm install` covers both packages. Optionally promote `src/core` to a
      real workspace package so `web/` imports it normally instead of via the
      Vite `@core` alias + `server.fs.allow` escape hatch.
  - [ ] update README install steps once this lands
- [ ] **Fix `.gitignore` for local tooling** so `git add -A` can't sweep it in:
  - [ ] add `.remember/`
  - [ ] add `.claude/settings.local.json` (or ignore all of `.claude/` and
        commit a deliberate shared config)
  - [ ] remove the vestigial `!examples/.gitkeep` line (no such file)
- [ ] **Decide the release story.**
  - [ ] If the CLI goes on npm: add a `files` allowlist to `package.json`, a
        `prepublishOnly` build, a build-only tsconfig that excludes `*.test.ts`
        (current `tsc` compiles tests into `dist/`), then tag `v1.0.0` and add
        `CHANGELOG.md`.
  - [ ] If not publishing yet: drop both `package.json` versions to `0.1.0` and
        say "not yet published" in the README.
- [ ] **Fill `package.json` metadata** — `repository`, `homepage`, `bugs`,
      `author` (both root and `web/`).
- [ ] **Add `.nvmrc`** pinning the Node version used in CI.
- [ ] **Add `.editorconfig`**.

## 4. Polish / incremental

- [ ] **Linter + formatter.** Biome (single dep, formats + lints) wired into
      `npm run check` and CI. TS strict catches correctness, not style.
- [ ] **Demo media in the README.** An asciinema cast of the terminal and a
      GIF/video of the browser app near the top — the project is entirely
      visual and the README currently has zero images.
- [ ] **Host-layer tests.** `src/node/` is only covered transitively by
      goldens; `web/` has none. Add parser/timing tests for
      `src/node/parse.ts` and `web/src/media/` (`transport.ts`, `envelope.ts`,
      `videoSource.ts`).
- [ ] **`rm -rf dist`** — stale flat `dist/*.js` from the pre-refactor layout
      is on disk (gitignored, harmless, but confusing).
- [ ] **Consider splitting `src/core/compose.ts`** (802 lines) — `FrameCompositor`
      apart from the config/helpers. Defensible as-is since it's the single
      source of truth; low priority.

---

## Reference: audit scorecard (2026-09-07)

| Axis | Score | Note |
|---|---|---|
| Architecture | 8.5 / 10 | Real core/node/web boundary, enforced host-agnostic core, cross-host golden equivalence |
| Code Quality | 8 / 10 | Strict TS both sides, comments explain *why*, core well tested; hosts thin, no formatter |
| Engineering | 4 / 10 | No CI, no LICENSE file, no contributor docs, two-step install, version unbacked |
| Perf & Risk | 5 / 10 | Copyrighted lyrics committed; local tooling not explicitly ignored; privacy posture otherwise clean |
| **Overall** | **6.5 / 10** | |

Verification at time of audit: `npm run check` passes — typecheck (both
packages), 80 unit tests, 59 golden frames byte-identical.
