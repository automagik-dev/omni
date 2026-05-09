# Wish: Unified output primitives (omni side)

| Field | Value |
|-------|-------|
| **Status** | READY (v2) |
| **Slug** | `output-primitives-unified` |
| **Date** | 2026-05-09 (v2 — re-scoped after `dev` drift audit) |
| **Author** | Felipe Rosa <felipe@namastex.ai> |
| **Appetite** | small (~1–2 engineer-days) |
| **Branch** | `wish/output-primitives-unified-v2` |
| **Repos touched** | `automagik/omni` |
| **Design** | [SHARED-DESIGN.md](./SHARED-DESIGN.md) |
| **Prior attempt** | [PR #605](https://github.com/automagik-dev/omni/pull/605) (closed) — landed G1 only on branch `output-omni`, abandoned 2026-05-05 after pgserve outage. |

> **Companion document:** [SHARED-DESIGN.md](./SHARED-DESIGN.md) — cross-repo unification spec (byte-identical to `automagik-dev/genie#output-primitives-unified` SHARED-DESIGN.md).
> **Sibling wish:** [`automagik-dev/genie#output-primitives-unified`](../../../../genie/.genie/wishes/output-primitives-unified/WISH.md) — both wishes ship in parallel; this repo's `output.ts` is the **reference implementation** that genie absorbs byte-for-byte.

## Summary

omni already has the canonical output helper at `packages/cli/src/output.ts` (321 LOC, 17 exports, JSON+human dual-mode, NO_COLOR-aware, pipe-flush-aware). **50 of 56** command files in `packages/cli/src/commands/` route through it. The remaining **6 outlier files** with **41 direct `chalk`/`ora` call sites** exist because `output.ts` doesn't yet expose `step` / `spinner` / `banner` / `progress` / `divider` / `colorize` primitives that those flows need:

| File | chalk sites | ora sites | Notes |
|------|-------------|-----------|-------|
| `update.ts` | 5 | 5 | 3-line success banner, multi-step install spinners |
| `install.ts` | 0 | 3 | Step spinners |
| `providers-setup.ts` | 0 | 1 | Step spinner |
| `film.ts` | 0 | 1 | Step spinner |
| `journey.ts` | 23 | 0 | Inline latency colorization (`<50ms green`, `<200ms yellow`, `<1000ms red`) — needs `output.colorize` |
| `send.ts` | 1 | 0 | Uses `new Chalk({level:0})` for color-disable — needs `output.getColorizer()` |

This wish closes the gap: extend `output.ts` with **7 new primitives** per `SHARED-DESIGN.md` §3, migrate all 41 direct call sites, add `boxen` + `cli-progress` as new deps, and lock the contract via a CI lint rule. No regression of any current behavior.

> **v2 note:** v1 (PR #605) was scoped at 4 files / 9 call sites and only G1 shipped. Since 2026-05-04, `journey.ts` and `send.ts` joined the outlier set, requiring two new helpers (`colorize`, `getColorizer`) for full coverage. v2 absorbs both.

## Scope

### IN

**Group 1 — Extend `output.ts` surface (7 new exports)**
- Add `step(message): void` — bold cyan ▸ stage divider; JSON-mode emits `{ step: "..." }` to stderr.
- Add `spinner(text): OutputSpinner` — ora wrapper with format-aware degradation (TTY animation / non-TTY plain `info`+`success` / JSON-mode stderr breadcrumb).
- Add `banner(message, options?): void` — boxen wrapper with locked border/color options.
- Add `progress(label): OutputProgress` — cli-progress wrapper rate-limited to 1 stderr line/sec in non-TTY/JSON mode.
- Add `divider(): void` — `─` × terminal width (or 80 if non-TTY); no-op in JSON mode.
- **Add `colorize(text, color): string`** — pure-string colorizer for inline use (`<50ms green`, `<200ms yellow`); respects `disableColors()` / `NO_COLOR`; returns plain text in JSON mode. Supported colors: `red | green | yellow | cyan | dim | bold` (covers every chalk usage in `journey.ts`).
- **Add `getColorizer(): ColorizerFn`** — returns a chalk-like instance for callers that need to compose dynamically (e.g. `send.ts` building a colorizer once, applying many times). Encapsulates the `new Chalk({level:0})` no-color path inside `output.ts` so callers never construct chalk directly.
- All 7 follow the existing `output.ts` style (TypeScript types exported, JSDoc on every export, `getCurrentFormat()` / `areColorsEnabled()` switches).

**Group 2 — Migrate direct chalk/ora call sites (6 files, 41 sites)**
- `packages/cli/src/commands/update.ts` — 5 chalk + 5 ora call sites → `output.banner` (the 3-line success banner) + `output.spinner` (each ora step) + `output.colorize` for inline color where banner is wrong.
- `packages/cli/src/commands/install.ts` — 3 ora call sites → `output.spinner`.
- `packages/cli/src/commands/providers-setup.ts` — 1 ora call site → `output.spinner`.
- `packages/cli/src/commands/film.ts` — 1 ora call site → `output.spinner`.
- `packages/cli/src/commands/journey.ts` — 23 chalk call sites → `output.colorize` for inline thresholded colors; the section headers + dividers → `output.header` / `output.divider`.
- `packages/cli/src/commands/send.ts` — 1 chalk import + `new Chalk({level:0})` pattern → `output.getColorizer()` (drops the chalk import entirely).
- After migration, `grep -lE "from 'ora'|from 'chalk'" packages/cli/src/commands/*.ts | wc -l` is 0. The only chalk/ora imports left are inside `output.ts` itself.

**Group 3 — Deps + tests + PR-body changelog note**
- Add `boxen@^7.1.1` and `cli-progress@^3.12.0` to `packages/cli/package.json`.
- Tests at `packages/cli/src/__tests__/output.test.ts` (extend existing — file already exists, 10K):
  - `step` — glyph + color in human; `{ step: "..." }` to stderr in JSON.
  - `spinner` — ora animation in TTY; degradation to `info`+`success` in non-TTY; stderr breadcrumb in JSON.
  - `banner` — borders render; multi-line input handled; stderr breadcrumb in JSON.
  - `progress` — rate-limited stderr in JSON; cli-progress instance returned in TTY.
  - `divider` — width correct; no-op in JSON.
  - `colorize` — applies ANSI when `areColorsEnabled()`; returns plain text otherwise; respects every supported color name; returns plain text in JSON mode.
  - `getColorizer` — returns a working colorizer; toggles to no-color when `disableColors()` called.
- **No `CHANGELOG.md` entry** — repo doesn't maintain one (release notes live on GitHub release tags via `chore: rolling promotion dev -> main` PRs). Instead, the PR body must include a "What changed for end users" block documenting the new exports + the migration.

**Group 4 — Lint enforcement**
- Add a regex-based lint script (`scripts/lint/no-bare-output-imports.cjs`) that fails CI when any file under `packages/cli/src/commands/` imports `chalk` or `ora` directly. `output.ts` is the single allowlisted file (it's not under `commands/` so no allowlist plumbing needed).
- Wire into `packages/cli/package.json` as `"lint:output": "node ../../scripts/lint/no-bare-output-imports.cjs"` and into the monorepo-root `package.json` `"lint"` script (currently `biome check .`) so it becomes `"biome check . && node scripts/lint/no-bare-output-imports.cjs"`.
- **Note:** the wish previously referenced `bun run check` — that script does not exist in this repo. Lint surface today is `bun run lint` (biome) + `bun run typecheck` (tsc) + `bun run test` (turbo).

### OUT

- **Modifying the existing 16 baseline `output.ts` exports.** They stay byte-identical; only additions.
- **Migrating commands that already use `output.*`.** They're done. This wish is laser-focused on the 4 outlier files.
- **Ink, OpenTUI, Solid for command output.** Per `SHARED-DESIGN.md` §11.
- **Internationalization.** Out of scope.
- **Telemetry hooks on output.** Separate wish.
- **Cross-CLI shared package.** Independent implementations per `SHARED-DESIGN.md` decision #1.
- **Replacing commander help-text styling.** Commander owns it.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Extensions only — zero changes to existing 17 exports | Backwards compatible. 50 callers already depend on the current shapes. |
| 2 | `OutputSpinner` interface is a **subset** of ora's API | Lock only what we use (`start`, `succeed`, `fail`, `warn`, `info`, `stop`, `text`); leaves room to swap implementation later. |
| 3 | `boxen` + `cli-progress` as new deps | Small (~42 KB combined), pure-JS, ESM. No native deps. |
| 4 | Genie absorbs THIS file as reference | Per `SHARED-DESIGN.md` decision #2. After both wishes merge, `diff` of exports is empty. |
| 5 | Lint rule formalized in same wish as the migration | Without it, drift returns. Same logic as the genie sibling wish Group 6. |
| 6 | `// biome-ignore lint/suspicious/noConsole: CLI output` comments inside `output.ts` are kept | They're correct — `output.ts` IS the single permitted place to call `console.error` directly. |
| 7 | **v2 expands surface to 7 (was 5) to absorb `journey.ts` + `send.ts`** | New outliers since v1 was drafted. Adding `colorize` + `getColorizer` is cheaper than allowlisting 24 call sites in the lint rule and writing a follow-up wish. Net cost: ~30 LOC in `output.ts`, two more test cases. |
| 8 | **No `CHANGELOG.md` — PR body carries the changelog** | Repo doesn't maintain a `CHANGELOG.md`; it relies on rolling-promotion PRs and GitHub release notes. Adding one would be a new convention. |
| 9 | **Lint script wires into `bun run lint`, not `bun run check`** | `bun run check` doesn't exist in this monorepo — was an inaccurate assumption in v1. Existing CI surface is `lint` (biome) + `typecheck` + `test`. |

## Success Criteria

- [ ] `packages/cli/src/output.ts` exports `step`, `spinner`, `banner`, `progress`, `divider`, `colorize`, `getColorizer` per `SHARED-DESIGN.md` §3.
- [ ] All 7 new exports have full JSDoc + TypeScript types.
- [ ] `boxen@^7.1.1` and `cli-progress@^3.12.0` are in `packages/cli/package.json`.
- [ ] `update.ts` no longer imports `chalk` or `ora` directly. The 3-line success banner uses `output.banner`. Each ora step uses `output.spinner`.
- [ ] `install.ts`, `providers-setup.ts`, `film.ts` no longer import `ora` directly.
- [ ] `journey.ts` no longer imports `chalk` directly. Inline thresholded colors use `output.colorize`. Section headers/dividers use `output.header` / `output.divider`.
- [ ] `send.ts` no longer imports `chalk` directly. The `c()` helper uses `output.getColorizer()`.
- [ ] `grep -lE "from 'ora'\\|from 'chalk'" packages/cli/src/commands/*.ts | wc -l` → 0.
- [ ] All 17 baseline `output.ts` exports continue to work byte-identically (existing tests pass).
- [ ] New tests cover: TTY path, non-TTY path, JSON-mode breadcrumbs, NO_COLOR for every new export.
- [ ] Lint rule fails CI on a deliberate `import ora from 'ora'` added to a fixture file under `packages/cli/src/commands/`.
- [ ] PR body includes a "What changed for end users" block documenting the new exports + migration.
- [ ] `bun test packages/cli/src/__tests__/output.test.ts` passes.
- [ ] `bun run lint` passes (biome + new `lint:output` script).
- [ ] `bun run typecheck` passes.

## Execution Strategy

### Wave 1 — Extensions (parallel)

| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Add `step`, `spinner`, `banner`, `progress`, `divider` to `output.ts`. Tests for every new export. |

### Wave 2 — Migration (sequential after Wave 1)

| Group | Agent | Description |
|-------|-------|-------------|
| 2 | engineer | Migrate `update.ts` + `install.ts` + `providers-setup.ts` + `film.ts` to use the new primitives. |

### Wave 3 — Deps + tests + lint (parallel)

| Group | Agent | Description |
|-------|-------|-------------|
| 3 | engineer | Add deps + tests + CHANGELOG entry. |
| 4 | engineer | Lint rule + wiring. |

## Execution Groups

### Group 1: Extend `output.ts` surface (7 exports)

**Goal:** Add the 7 new primitives. Pure additions, zero behavior change to existing exports.

**Deliverables:**
1. `packages/cli/src/output.ts` extended with the 7 new exports per `SHARED-DESIGN.md` §3.
2. JSDoc + types for each new export (`OutputSpinner`, `BannerOptions`, `OutputProgress`, `ColorizerFn` interfaces).
3. JSON-mode behavior per `SHARED-DESIGN.md` §5.
4. NO_COLOR / non-TTY degradation per `SHARED-DESIGN.md` §6.
5. New deps added to `packages/cli/package.json` (`boxen@^7.1.1`, `cli-progress@^3.12.0`). `ora` already present.
6. `colorize(text, color)` — pure-string colorizer. Supported colors at minimum: `red | green | yellow | cyan | dim | bold | red.bold` (covers every chalk usage in `journey.ts`). Returns plain text when `!areColorsEnabled()` or in JSON mode.
7. `getColorizer()` — returns a `ColorizerFn` interface (chalk-like, with `.red`/`.green`/etc. properties + `(text) => text` callable). When colors are disabled, returns a no-op identity colorizer. Used by `send.ts` to replace its `new Chalk({level:0})` pattern.

**Acceptance Criteria:**
- [ ] `import { step, spinner, banner, progress, divider, colorize, getColorizer } from '../output.js'` resolves and typechecks.
- [ ] `step('Installing...')` emits bold-cyan `▸ Installing...` in human mode; `{ step: "Installing..." }` to stderr in JSON.
- [ ] `spinner('Checking version...').start().succeed('v1.2.3')` produces a real ora animation in TTY; degrades to `info` + `success` in non-TTY.
- [ ] `banner('Updated to v1.2.3', { borderStyle: 'double', borderColor: 'green' })` produces a 3-line boxed banner; emits `{ banner: "..." }` to stderr in JSON.
- [ ] `progress('Downloading')` returns a working `cli-progress.SingleBar` in TTY; rate-limits to ≤1 line/sec to stderr in JSON.
- [ ] `divider()` prints `─` × `process.stdout.columns || 80` in human mode; no-op in JSON mode.
- [ ] `colorize('42ms', 'green')` returns ANSI-wrapped string in TTY; plain `'42ms'` when `disableColors()` was called or in JSON mode.
- [ ] `getColorizer()` returns an object where `.red('x')`, `.green('x')`, `.yellow('x').bold` all work; when colors are disabled, every method returns the input verbatim.
- [ ] **Resource-leak fix:** the `runEmitter` test helper (called out by Gemini on PR #605) cleans up its tempdir in a `try/finally` so process errors don't leave orphans.

**Validation:**
```bash
bun test packages/cli/src/__tests__/output.test.ts -t "step|spinner|banner|progress|divider|colorize|getColorizer"
bun run typecheck
```

**depends-on:** none

---

### Group 2: Migrate the 6 outlier command files (41 sites)

**Goal:** Eliminate all direct `chalk` / `ora` imports in command files. The 3-line success banner in `update.ts` becomes a single `output.banner` call. The thresholded latency colors in `journey.ts` become `output.colorize` calls.

**Deliverables:**
1. `packages/cli/src/commands/update.ts`:
   - Remove `import chalk from 'chalk'` and `import ora from 'ora'`.
   - 5 `chalk.green('✓')` / `chalk.red('✗')` / `chalk.bold(...)` calls → `output.success` / `output.error` / `output.colorize`.
   - 5 `ora(...)` calls → `output.spinner(...)`.
   - The 3-line success block (`✓ CLI: v…`, `✓ Server: v…`, `✓ Auth: …`) → `output.banner([cliLine, serverLine, authLine], { borderStyle: 'round', borderColor: 'green' })`.
2. `packages/cli/src/commands/install.ts` — 3 ora call sites → `output.spinner`.
3. `packages/cli/src/commands/providers-setup.ts` — 1 ora call site → `output.spinner`.
4. `packages/cli/src/commands/film.ts` — 1 ora call site → `output.spinner`.
5. `packages/cli/src/commands/journey.ts`:
   - Remove `import chalk from 'chalk'`.
   - 4 `chalk.green/yellow/red/red.bold` thresholded latency colors → `output.colorize(text, level)` where `level = 'green' | 'yellow' | 'red' | 'red.bold'` per the existing thresholds.
   - `chalk.bold(title)` for section headers → `output.header(title)`.
   - `chalk.dim('━'.repeat(50))` divider → `output.divider()`.
   - Remaining inline `chalk.dim(...)` / `chalk.yellow(...)` calls → `output.colorize(...)`.
6. `packages/cli/src/commands/send.ts`:
   - Remove `import chalk, { Chalk, type ChalkInstance } from 'chalk'`.
   - Replace the `c()` helper:
     ```ts
     // before
     function c(): ChalkInstance {
       if (areColorsEnabled()) return chalk;
       return new Chalk({ level: 0 });
     }
     // after
     import { getColorizer } from '../output.js';
     // (each call site uses output.getColorizer() directly, or stash once)
     ```
   - All call sites of `c().green(...)` / `c().bold(...)` continue working because `getColorizer()` returns a chalk-shaped object.
7. All locked error strings preserved byte-identically.

**Acceptance Criteria:**
- [ ] `grep -lE "from 'ora'|from 'chalk'" packages/cli/src/commands/*.ts | wc -l` → 0.
- [ ] `bun test packages/cli/src/__tests__/update-verify.test.ts` passes byte-identically.
- [ ] `bun test packages/cli/src/__tests__/install.test.ts` passes byte-identically.
- [ ] Visual diff of `omni update --yes` output before/after migration: same glyphs, same colors, same line count.
- [ ] Visual diff of `omni journey --to <agent>` output before/after migration: same thresholded colors, same headers, same divider rendering.
- [ ] `omni update --json | jq` parses cleanly; spinners/banners go to stderr.
- [ ] `omni send <args> --json | jq` parses cleanly; no ANSI in stdout.

**Validation:**
```bash
! grep -lE "from 'ora'|from 'chalk'" packages/cli/src/commands/*.ts && echo "OK no direct imports"
bun test packages/cli/src/__tests__/update-verify.test.ts
bun test packages/cli/src/__tests__/install.test.ts
bun run typecheck
```

**depends-on:** Group 1

---

### Group 3: Deps + tests + PR-body changelog note

**Goal:** Lock the deps, lock the tests, document the contract in the PR body.

**Deliverables:**
1. `packages/cli/package.json` updated with `boxen@^7.1.1`, `cli-progress@^3.12.0`. `bun install` re-locks.
2. Tests at `packages/cli/src/__tests__/output.test.ts` — comprehensive coverage of every new export (TTY / non-TTY / JSON mode / NO_COLOR / FORCE_COLOR for each of the 7).
3. PR body MUST include a "What changed for end users" block with:
   - List of new `output.*` exports.
   - List of migrated commands.
   - Note that `omni update --json`, `omni journey --json`, etc., now produce clean JSON (no ANSI in stdout).
   - Reference to the genie sibling wish if it's still active.

**Acceptance Criteria:**
- [ ] `bun install` succeeds; `bun.lock` changes reviewable.
- [ ] `bun test packages/cli/src/__tests__/output.test.ts` passes; coverage ≥90% on the 7 new exports.
- [ ] PR description contains the "What changed for end users" block.

**Validation:**
```bash
bun install && bun test packages/cli/src/__tests__/output.test.ts
```

**depends-on:** Group 2

---

### Group 4: Lint rule

**Goal:** Make a regression a CI fail.

**Deliverables:**
1. `scripts/lint/no-bare-output-imports.cjs` — Node script scanning `packages/cli/src/commands/`; fails on any `import .* from 'ora'` or `import .* from 'chalk'` (allowing the existing `from 'chalk'` inside `output.ts` since that file is not under `commands/`).
2. Wire into the **monorepo-root** `package.json` `"scripts"`:
   - Add `"lint:output": "node scripts/lint/no-bare-output-imports.cjs"`.
   - Update existing `"lint": "biome check ."` → `"lint": "biome check . && node scripts/lint/no-bare-output-imports.cjs"` so existing CI gates pick it up automatically.
3. Fixture-based negative test: a file at `packages/cli/src/__tests__/.lint-fixtures/regression-bare-ora.ts.txt` (`.txt` so biome ignores it) with a deliberate `import ora from 'ora'` plus a unit test in `__tests__/lint-output.test.ts` that:
   - Copies the fixture into `packages/cli/src/commands/.tmp-lint-regression.ts`,
   - Runs the lint script,
   - Asserts non-zero exit,
   - Removes the temp file in `try/finally`.
4. The fixture path uses `.tmp-lint-regression.ts` (gitignored prefix) so a crashed test doesn't leave a poison file in the tree.

**Acceptance Criteria:**
- [ ] `bun run lint:output` passes on the migrated tree.
- [ ] `bun run lint:output` fails (exit 1) on the deliberately-bad fixture during the negative test.
- [ ] `bun run lint` (monorepo root) now runs both biome and `lint:output` sequentially, with non-zero exit if either fails.
- [ ] `.gitignore` updated with `packages/cli/src/commands/.tmp-lint-regression.ts` if not already covered.

**Validation:**
```bash
bun run lint && echo "OK clean"
bun test packages/cli/src/__tests__/lint-output.test.ts
```

**depends-on:** Group 2

---

## Cross-wish dependencies

- **paired-with** [`automagik-dev/genie#output-primitives-unified`](../../../../genie/.genie/wishes/output-primitives-unified/WISH.md) — both wishes ship in parallel against their respective `dev` branches. omni's `output.ts` is the byte-reference; genie absorbs it.
- **closes-the-loop-on** `update-unify-stages` (omni side, already merged) — that wish established the unified update pipeline; this wish makes its visual layer consistent with the rest of the CLI.

## QA Criteria

_What must be verified on `dev` after merge._

- [ ] Functional — `omni update`, `omni install`, `omni providers add`, `omni film` all visually identical post-migration (or differences explainable + intentional).
- [ ] Functional — `--json` mode works for every migrated subcommand; stdout valid JSON; stderr has all human breadcrumbs.
- [ ] Functional — `--no-color` produces zero ANSI for every migrated subcommand.
- [ ] Integration — `omni update --json | jq` parses cleanly.
- [ ] Integration — `boxen` borders render correctly in iTerm, kitty, GNOME Terminal, Windows Terminal.
- [ ] Regression — All current tests pass.
- [ ] Regression — Locked error strings in `update-verify.test.ts` byte-identical.
- [ ] Regression — Lint rule fails CI on a deliberate bare-import regression.
- [ ] Cross-CLI parity — `diff <(grep -E "^export" packages/cli/src/output.ts | sort) <(grep -E "^export" ../../genie/src/lib/output.ts | sort)` produces zero meaningful differences after both wishes ship.

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `boxen` ESM compat issue with the omni CLI bundle | Low | boxen is fully ESM since v6; we're on v7. Verify bundle output in Group 3. |
| `cli-progress` adds enough perceptible startup latency to cold-start an `omni status` | Low | cli-progress is lazy-imported only inside `progress()`. Other call sites pay zero cost. Benchmark in Group 1. |
| Visual diff between pre-migration ora and post-migration `output.spinner` is non-zero | Medium | Wrap ora 1:1; the visible behavior is identical. Snapshot test pins it. |
| `output.banner` for the 3-line success block looks worse than the current 3 separate `console.log` lines | Medium | Group 2 acceptance includes a visual review; if the boxed banner is uglier, fall back to 3 separate `output.success` lines (still avoids direct chalk import). |
| Lint rule misfires on a legitimate ora/chalk import in a future test fixture | Low | Allowlist `packages/cli/src/__tests__/` and `packages/cli/src/commands/.test-fixtures/`. |
| External consumers depend on stderr-vs-stdout split that this wish formalizes | Low | The split was already the contract per omni's existing `output.ts`; this wish only extends it. |

---

## Review Results

_Populated by `/review` after execution completes._

---

## Files to Create/Modify

```
# Modify
packages/cli/src/output.ts                                    # +7 exports (~250 LOC)
packages/cli/src/__tests__/output.test.ts                     # +tests for 7 new exports
packages/cli/src/commands/update.ts                           # drop chalk+ora imports, 13 sites
packages/cli/src/commands/install.ts                          # drop ora import, 3 sites
packages/cli/src/commands/providers-setup.ts                  # drop ora import, 1 site
packages/cli/src/commands/film.ts                             # drop ora import, 1 site
packages/cli/src/commands/journey.ts                          # drop chalk import, 23 sites
packages/cli/src/commands/send.ts                             # drop chalk import + Chalk constructor, 1+ sites
packages/cli/package.json                                     # +boxen +cli-progress
package.json                                                  # +lint:output script, wire into lint
.gitignore                                                    # ignore .tmp-lint-regression.ts

# Create
scripts/lint/no-bare-output-imports.cjs
packages/cli/src/__tests__/.lint-fixtures/regression-bare-ora.ts.txt
packages/cli/src/__tests__/lint-output.test.ts

# Reference (read-only)
.genie/wishes/output-primitives-unified/SHARED-DESIGN.md
```

## v1 → v2 Diff Summary

What changed in this re-scope:

1. **Group 1 surface 5 → 7 exports.** Added `colorize` and `getColorizer` so `journey.ts` and `send.ts` can fully migrate without leaving allowlist exceptions.
2. **Group 2 file count 4 → 6.** Added `journey.ts` (23 chalk sites) and `send.ts` (1 chalk import + `new Chalk({level:0})` pattern). These didn't exist as outliers when v1 was drafted.
3. **Group 3 dropped CHANGELOG.md requirement.** Repo doesn't maintain one. PR body carries the changelog instead.
4. **Group 4 wires lint into `bun run lint`, not `bun run check`.** `bun run check` doesn't exist. Also moved fixture path out of `commands/.test-fixtures/` (which would itself trip the lint rule) into `__tests__/.lint-fixtures/` with a `.txt` extension.
5. **G1 acceptance now includes the Gemini-flagged tempdir-leak fix** in `runEmitter` test helper from PR #605 review.
