# Wish: Unified output primitives (omni side)

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `output-primitives-unified` |
| **Date** | 2026-05-04 |
| **Author** | Felipe Rosa <felipe@namastex.ai> |
| **Appetite** | small (~1–2 engineer-days) |
| **Branch** | `wish/output-primitives-unified` |
| **Repos touched** | `automagik/omni` |
| **Design** | [SHARED-DESIGN.md](./SHARED-DESIGN.md) |

> **Companion document:** [SHARED-DESIGN.md](./SHARED-DESIGN.md) — cross-repo unification spec (byte-identical to `automagik-dev/genie#output-primitives-unified` SHARED-DESIGN.md).
> **Sibling wish:** [`automagik-dev/genie#output-primitives-unified`](../../../../genie/.genie/wishes/output-primitives-unified/WISH.md) — both wishes ship in parallel; this repo's `output.ts` is the **reference implementation** that genie absorbs byte-for-byte.

## Summary

omni already has the canonical output helper at `packages/cli/src/output.ts` (322 LOC, 11 functions, JSON+human dual-mode, NO_COLOR-aware, pipe-flush-aware). 47 of 54 command files in `packages/cli/src/commands/` route through it. The remaining 9 direct usages of `chalk` and `ora` (across `update.ts`, `install.ts`, `providers-setup.ts`, `film.ts`) exist because `output.ts` doesn't yet expose `step` / `spinner` / `banner` / `progress` / `divider` primitives that those flows need.

This wish closes the gap: extend `output.ts` with the 5 new primitives per `SHARED-DESIGN.md` §3, migrate the 9 direct chalk/ora call sites, add `boxen` + `cli-progress` as new deps, and lock the contract so the genie sibling has a stable byte-reference to copy. No regression of any current behavior.

## Scope

### IN

**Group 1 — Extend `output.ts` surface**
- Add `step(message): void` — bold cyan ▸ stage divider; JSON-mode emits `{ step: "..." }` to stderr.
- Add `spinner(text): OutputSpinner` — ora wrapper with format-aware degradation (TTY animation / non-TTY plain `info`+`success` / JSON-mode stderr breadcrumb).
- Add `banner(message, options?): void` — boxen wrapper with locked border/color options.
- Add `progress(label): OutputProgress` — cli-progress wrapper rate-limited to 1 stderr line/sec in non-TTY/JSON mode.
- Add `divider(): void` — `─` × terminal width (or 80 if non-TTY); no-op in JSON mode.
- All 5 follow the existing `output.ts` style (TypeScript types exported, JSDoc on every function, `getCurrentFormat()` switch).

**Group 2 — Migrate direct chalk/ora call sites**
- `packages/cli/src/commands/update.ts` — 5 chalk + 5 ora call sites → `output.banner` (the 3-line success banner) + `output.spinner` (each ora step).
- `packages/cli/src/commands/install.ts` — 3 ora call sites → `output.spinner`.
- `packages/cli/src/commands/providers-setup.ts` — 1 ora call site → `output.spinner`.
- `packages/cli/src/commands/film.ts` — 1 ora call site → `output.spinner`.
- After migration, `grep -E "import.*from 'ora'\\|import.*from 'chalk'" packages/cli/src/commands/*.ts | wc -l` is 0 (the only chalk/ora imports left are inside `output.ts` itself).

**Group 3 — Deps + tests + CHANGELOG**
- Add `boxen@^7.1.1` and `cli-progress@^3.12.0` to `packages/cli/package.json`.
- Tests at `packages/cli/src/__tests__/output.test.ts` (extend existing if it exists; create if not):
  - `step` — glyph + color in human; `{ step: "..." }` to stderr in JSON.
  - `spinner` — ora animation in TTY; degradation to `info`+`success` in non-TTY; stderr breadcrumb in JSON.
  - `banner` — borders render; multi-line input handled; stderr breadcrumb in JSON.
  - `progress` — rate-limited stderr in JSON; cli-progress instance returned in TTY.
  - `divider` — width correct; no-op in JSON.
- `CHANGELOG.md` entry: *"Output helper extended with `step`, `spinner`, `banner`, `progress`, `divider` primitives. Direct `chalk` and `ora` usage in command files migrated; only `output.ts` imports them now. Genie CLI absorbs the same surface — see `automagik-dev/genie#output-primitives-unified`."*

**Group 4 — Lint enforcement**
- Formalize the existing `// biome-ignore lint/suspicious/noConsole: CLI output` pattern: a regex-based lint script (`scripts/lint/no-bare-output-imports.cjs`) that fails CI when any file under `packages/cli/src/commands/` imports `chalk` or `ora` directly (i.e., not via `output.ts`).
- `output.ts` is the single allowlisted file.
- Wire into `bun run lint` and `bun run check`.

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
| 1 | Extensions only — zero changes to existing 16 exports | Backwards compatible. 47 callers already depend on the current shapes. |
| 2 | `OutputSpinner` interface is a **subset** of ora's API | Lock only what we use (`start`, `succeed`, `fail`, `warn`, `info`, `stop`, `text`); leaves room to swap implementation later. |
| 3 | `boxen` + `cli-progress` as new deps | Small (~42 KB combined), pure-JS, ESM. No native deps. |
| 4 | Genie absorbs THIS file as reference | Per `SHARED-DESIGN.md` decision #2. After both wishes merge, `diff` of exports is empty. |
| 5 | Lint rule formalized in same wish as the migration | Without it, drift returns. Same logic as the genie sibling wish Group 6. |
| 6 | `// biome-ignore lint/suspicious/noConsole: CLI output` comments inside `output.ts` are kept | They're correct — `output.ts` IS the single permitted place to call `console.error` directly. |

## Success Criteria

- [ ] `packages/cli/src/output.ts` exports `step`, `spinner`, `banner`, `progress`, `divider` per `SHARED-DESIGN.md` §3.
- [ ] All 5 new exports have full JSDoc + TypeScript types.
- [ ] `boxen@^7.1.1` and `cli-progress@^3.12.0` are in `packages/cli/package.json`.
- [ ] `update.ts` no longer imports `chalk` or `ora` directly. The 3-line success banner uses `output.banner`. Each ora step uses `output.spinner`.
- [ ] `install.ts`, `providers-setup.ts`, `film.ts` no longer import `ora` directly.
- [ ] `grep -lE "from 'ora'\\|from 'chalk'" packages/cli/src/commands/*.ts | wc -l` → 0.
- [ ] All 16 baseline `output.ts` exports continue to work byte-identically (existing tests pass).
- [ ] New tests cover: TTY path, non-TTY path, JSON-mode breadcrumbs, NO_COLOR for every new export.
- [ ] Lint rule fails CI on a deliberate `import ora from 'ora'` added to a fixture file under `packages/cli/src/commands/`.
- [ ] CHANGELOG entry present.
- [ ] `bun test packages/cli/src/__tests__/output.test.ts` passes.
- [ ] `bun run check` passes.

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

### Group 1: Extend `output.ts` surface

**Goal:** Add the 5 new primitives. Pure additions, zero behavior change to existing exports.

**Deliverables:**
1. `packages/cli/src/output.ts` extended with the 5 new exports per `SHARED-DESIGN.md` §3.
2. JSDoc + types for each new export.
3. JSON-mode behavior per `SHARED-DESIGN.md` §5.
4. NO_COLOR / non-TTY degradation per `SHARED-DESIGN.md` §6.
5. New deps added to `packages/cli/package.json` (boxen, cli-progress).

**Acceptance Criteria:**
- [ ] `import { step, spinner, banner, progress, divider } from '../output.js'` resolves and typechecks.
- [ ] `step('Installing...')` emits bold-cyan `▸ Installing...` in human mode; `{ step: "Installing..." }` to stderr in JSON.
- [ ] `spinner('Checking version...').start().succeed('v1.2.3')` produces a real ora animation in TTY; degrades to `info` + `success` in non-TTY.
- [ ] `banner('Updated to v1.2.3', { borderStyle: 'double', borderColor: 'green' })` produces a 3-line boxed banner; emits `{ banner: "..." }` to stderr in JSON.
- [ ] `progress('Downloading')` returns a working `cli-progress.SingleBar` in TTY; rate-limits to ≤1 line/sec to stderr in JSON.
- [ ] `divider()` prints `─` × `process.stdout.columns || 80` in human mode; no-op in JSON mode.

**Validation:**
```bash
bun test packages/cli/src/__tests__/output.test.ts -t "step\|spinner\|banner\|progress\|divider"
```

**depends-on:** none

---

### Group 2: Migrate `update.ts` + `install.ts` + `providers-setup.ts` + `film.ts`

**Goal:** Eliminate all direct `chalk` / `ora` imports in command files. The 3-line success banner in `update.ts` becomes a single `output.banner` call.

**Deliverables:**
1. `packages/cli/src/commands/update.ts`:
   - Remove `import chalk from 'chalk'` and `import ora from 'ora'`.
   - 5 `chalk.green('✓')` / `chalk.red('✗')` / `chalk.bold(...)` calls → equivalent `output.success` / `output.error` / `output.banner` calls.
   - 5 `ora(...)` calls → `output.spinner(...)`.
   - The 3-line success block (`✓ CLI: v…`, `✓ Server: v…`, `✓ Auth: …`) → `output.banner([cliLine, serverLine, authLine], { borderStyle: 'round', borderColor: 'green' })`.
2. `packages/cli/src/commands/install.ts` — 3 ora call sites → `output.spinner`.
3. `packages/cli/src/commands/providers-setup.ts` — 1 ora call site → `output.spinner`.
4. `packages/cli/src/commands/film.ts` — 1 ora call site → `output.spinner`.
5. All locked error strings preserved byte-identically.

**Acceptance Criteria:**
- [ ] `grep -lE "from 'ora'\\|from 'chalk'" packages/cli/src/commands/*.ts | wc -l` → 0.
- [ ] `bun test packages/cli/src/__tests__/update-verify.test.ts` passes byte-identically.
- [ ] Visual diff of `omni update --yes` output before/after migration: same glyphs, same colors, same line count.
- [ ] `omni update --json | jq` parses cleanly; spinners/banners go to stderr.

**Validation:**
```bash
grep -lE "from 'ora'\\|from 'chalk'" packages/cli/src/commands/*.ts || echo "OK no direct imports"
bun test packages/cli/src/__tests__/update-verify.test.ts
bun test packages/cli/src/__tests__/install.test.ts
```

**depends-on:** Group 1

---

### Group 3: Deps + tests + CHANGELOG

**Goal:** Lock the deps, lock the tests, document the contract.

**Deliverables:**
1. `packages/cli/package.json` updated with `boxen@^7.1.1`, `cli-progress@^3.12.0`. `bun install` re-locks.
2. Tests at `packages/cli/src/__tests__/output.test.ts` — comprehensive coverage of every new export (TTY / non-TTY / JSON mode / NO_COLOR / FORCE_COLOR for each).
3. `CHANGELOG.md` entry per Scope IN.

**Acceptance Criteria:**
- [ ] `bun install` succeeds; lock file changes reviewable.
- [ ] `bun test packages/cli/src/__tests__/output.test.ts` passes; coverage ≥90% on the 5 new exports.
- [ ] `grep -F "Output helper extended with" CHANGELOG.md` matches.

**Validation:**
```bash
bun install && bun test packages/cli/src/__tests__/output.test.ts
grep -F "Output helper extended with" CHANGELOG.md
```

**depends-on:** Group 2

---

### Group 4: Lint rule

**Goal:** Make a regression a CI fail.

**Deliverables:**
1. `scripts/lint/no-bare-output-imports.cjs` — Node script scanning `packages/cli/src/commands/`; fails on any `import .* from 'ora'` or `import .* from 'chalk'` (allowing the existing `from 'chalk'` inside `output.ts` since that file is not under `commands/`).
2. Wire into `package.json` scripts (`"lint:output": "node scripts/lint/no-bare-output-imports.cjs"`) and into `bun run check`.
3. Fixture-based negative test: a file at `packages/cli/src/commands/.test-fixtures/lint-regression.ts` with a deliberate `import ora from 'ora'` plus a unit test that runs the lint and asserts non-zero exit.

**Acceptance Criteria:**
- [ ] `bun run lint:output` passes on the migrated tree.
- [ ] `bun run lint:output` fails (exit 1) on the deliberately-bad fixture.
- [ ] `bun run check` includes the new lint step.

**Validation:**
```bash
bun run lint:output && echo "OK clean"
bun run check
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
packages/cli/src/output.ts
packages/cli/src/__tests__/output.test.ts
packages/cli/src/commands/update.ts
packages/cli/src/commands/install.ts
packages/cli/src/commands/providers-setup.ts
packages/cli/src/commands/film.ts
packages/cli/package.json                                     # +boxen +cli-progress
package.json                                                  # script wiring if monorepo-level
CHANGELOG.md

# Create
scripts/lint/no-bare-output-imports.cjs
packages/cli/src/commands/.test-fixtures/lint-regression.ts   # for the lint negative test

# Reference (read-only)
.genie/wishes/output-primitives-unified/SHARED-DESIGN.md
```
