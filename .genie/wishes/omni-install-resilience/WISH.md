# Wish: omni-install-resilience

| Field | Value |
|-------|-------|
| **Status** | READY |
| **Slug** | `omni-install-resilience` |
| **Date** | 2026-04-09 |
| **Design** | (none — crystallized directly from incident trace 2026-04-09) |
| **Plan review** | SHIP — loop 2 passed on expanded scope (install UX rewrite folded into Group 3) |

## Summary

A fresh `omni install` + `omni start` cascaded into a four-layer failure that took omni-api offline and grew `omni-api-error.log` to a 283 GB sparse file before the restart loop was noticed. This wish closes four gaps exposed by that incident and by the current CLI UX:

1. Orphan postgres detection that misses cross-CWD / cross-install orphans (follow-up to shipped task #127 `pgserve-daemon-ownership`)
2. A broken upstream `@embedded-postgres/linux-x64` package that ships without the soname symlinks its own postgres binary requires
3. `omni start` pm2 invocation with zero restart/logging throttling (root cause of the 283 GB log)
4. `omni install` is an interactive 666-line "setup wizard" that cannot detect an existing install, asks humans for port/dataDir/databaseUrl/apiKey, and has no concept of an AI agent being the one running it — the CLI's primary user today is Claude/Genie, not a human, and the UX must reflect that

The install flow is rewritten to be **reinstall-safe by default** (detect existing `~/.omni/config.json` + pm2 processes + data dir → reuse them, print a clear "data preserved" banner, never prompt), and to end with an **agent handoff block** that instructs the executing agent to verify pm2 health and load the `/omni` skill to continue setup with the user.

## Scope

### IN
- **pgserve orphan detection on the internal port** — `packages/api/src/pgserve.ts` must refuse to start when any process already holds `PGSERVE_PORT + 1000`, not just when the proxy port is taken. `killOrphanedPostgres()` must scan all postgres processes for the internal-port holder (via `ss -tlnp` / `lsof`), not only the one whose PID is in the current data dir's `postmaster.pid`.
- **libicu soname shim** — `@automagik/omni` must ship a postinstall script that creates the missing `libicu{i18n,uc,data}.so.60` symlinks inside `@embedded-postgres/linux-x64/native/lib/` when only `.so.60.2` files are present. Same check must run at pgserve startup as a defensive fallback, before `startMultiTenantServer` is imported.
- **pm2 launch hardening** — `packages/cli/src/commands/start.ts` must pass `--max-restarts`, `--restart-delay`, `--max-memory-restart`, and explicit log paths. `packages/cli/src/commands/install.ts` must install `pm2-logrotate` with `max_size: 10M, retain: 5, compress: true, rotateInterval: '0 0 * * *'`.
- **`omni install` reinstall-safety and wizard removal** — `omni install` must detect an existing install (any of: `~/.omni/config.json` present, pm2 processes `omni-api`/`omni-nats` registered, data dir non-empty) and in that case reuse the existing config without prompting, print a clear "Reinstalling — data at `<dataDir>` will be preserved" banner up front, and refresh binaries/services without touching user data. All `readline`-based interactive prompts (`promptLine`, `promptYesNo`, `chooseProcessManager`, `promptConfig`, `promptApiKey`, the "Set up your first channel?" question, and any other user input prompts) must be deleted. Install becomes non-interactive by default; port/apiKey/databaseUrl overrides come from flags or env vars. The `--non-interactive` flag is deprecated (accepted silently for backward compat).
- **Agent handoff banner at install completion** — replace `printDoneBanner` with a short, imperative block addressed TO the AI agent executing the install (not to a human), telling it exactly what to do next: verify pm2 health, load the `/omni` skill, then assist the user with channel setup. The block must NOT ask questions, must NOT be decorative, and must be structured so an agent reading stdout can act on it directly.
- **Regression tests** — unit + integration tests that simulate each failure mode (orphan on internal port, missing soname symlinks, pm2 restart loop, reinstall on existing data dir, agent handoff block present in stdout) and prove the new guards catch them.

### OUT
- **Rewriting pgserve daemon ownership** — already shipped as task #127 `pgserve-daemon-ownership`. The current in-process daemon model (`PGSERVE_EMBEDDED=true`, `startEmbeddedPgserve` in `packages/api/src/pgserve.ts`) IS the output of that work. This wish closes the remaining gaps; it does not re-open the lifecycle model.
- **Migrating to PG 18** — the cached binary at `~/.pgserve/bin/linux-x64/bin/postgres` is 17.7 and works. Forcing a major upgrade is its own wish.
- **Replacing `@embedded-postgres/linux-x64`** with a different packager — out of scope; we work around the bug rather than fork.
- **Cleaning up other pm2 config drift** (e.g., `exec_mode: cluster`, health checks) — orthogonal hardening, not in this wish.
- **Upstream bug reports** to `@embedded-postgres/linux-x64` and `pgserve` — tracked separately, not blocking this wish.
- **Changes to `ecosystem.config.cjs`** (the dev-only config used by `make dev-services`) — this wish touches only the installed-CLI path (`omni start`), which does NOT use that ecosystem file.
- **Migrating existing data** from PG 17 to PG 18 on reinstall — reinstall preserves data as-is in whatever format it's already in. Format-migration is a separate concern.
- **A full TUI-style install experience** — this wish deletes the interactive wizard; it does NOT replace it with a prettier wizard. The design is "non-interactive by default, agent-driven assist after". Fancy TUIs can be a follow-up wish.
- **Changing the `/omni` skill itself** — the agent handoff block REFERENCES `/omni` as the follow-up; it does not modify the skill's content.

## Decisions

| Decision | Rationale |
|----------|-----------|
| Detect orphans via `ss -tlnp` on the internal port, not via `postmaster.pid` scanning | The incident orphan ran from a stale CWD with data dir `./.pgserve-data` — its `postmaster.pid` was invisible to the current data dir logic. Port-based discovery catches cross-CWD and cross-install orphans. |
| Fail loud on internal-port conflict, do NOT auto-kill by default | Silent-kill of a postgres process we didn't spawn is risky. Instead: refuse to start, print PID + `cmdline` + instructions, accept an explicit opt-in to kill. |
| Two distinct force-cleanup levers: `omni install --force-cleanup` (CLI flag for operators) AND `OMNI_PGSERVE_FORCE_CLEANUP=true` (env var read by pgserve.ts runtime) | Operators use the flag; the runtime path (pgserve.ts startup) can't see CLI flags, so it needs an env var. Install command sets the env var as part of the flag handler. They are NOT redundant — they serve different layers (operator UX vs. runtime check). |
| Ship libicu symlink shim as a postinstall script AND a runtime fallback | Postinstall covers fresh installs. Runtime fallback covers `bun install` flows that skip postinstall (monorepo root installs, CI caches). Cheap redundancy. |
| Use `pm2 start --max-restarts 10 --restart-delay 5000` instead of generating an ecosystem file | Matches the existing `start.ts` style (inline flags). An ecosystem file would be cleaner but is a bigger refactor out of scope. |
| Install `pm2-logrotate` during `omni install`, not `omni start` | Install is the "heavy lifting" entry point; start should be fast. Logrotate only needs to be installed once per pm2 home. |
| Keep the `--force-cleanup` flag on `omni install`, not `omni start` | Aggressive cleanup belongs to install semantics ("set up a working system"), not start ("resume the system you already set up"). |
| Reinstall detection is based on a three-signal check (config.json exists, pm2 process registered, data dir non-empty) — ANY signal = reinstall mode | Any one signal alone could be a stale leftover; two or more is a strong indicator. But to be safe AND to never delete data, we enter reinstall mode on ANY signal. The only thing reinstall mode does differently is "reuse existing config, skip prompts, preserve data" — so erring on the reinstall side is zero-risk. |
| Reinstall mode is silent about unchanged settings; it only prints the data-preservation banner + what's being refreshed | Noise-minimal output is agent-friendly. Agents parsing stdout want deltas, not restated defaults. |
| Remove all `readline` prompts — install is non-interactive by default, not "non-interactive when `--non-interactive` is passed" | The CLI's primary caller is now an AI agent, not a human operator. Prompts block agent automation. Humans wanting overrides can use flags or env vars. `--non-interactive` flag is kept as a silent no-op for backward compat so existing scripts don't break. |
| Agent handoff banner is plain text, parseable by an agent, explicitly addressed "## For the agent running this install" | The banner replaces decorative ASCII art. It includes (a) verify command for pm2 health, (b) explicit instruction "load the /omni skill", (c) what to ask the user next. No emoji, no colors, no questions directed at humans. |
| The wizard's "process manager choice" (PM2 / systemd / manual) is collapsed to PM2 only; `--systemd` flag is kept but no longer prompted | systemd and manual modes were asked interactively but rarely chosen in practice. Removing the prompt simplifies the critical path. `--systemd` still works as an explicit opt-in. |
| The wizard's "Set up your first channel now?" prompt is deleted entirely | It was a dead-end that just printed `Run: omni instances create --help`. The agent handoff banner replaces this with an imperative next-step for the agent. |

## Success Criteria

- [ ] Fresh `omni install` on a system where `@embedded-postgres/linux-x64` ships without `.so.60` symlinks completes without `cannot open shared object file` errors
- [ ] `omni start` invoked while a stale postgres is already listening on `PGSERVE_PORT + 1000` fails with a clear error message that includes the offending PID and process command line — never silently proxies to the orphan
- [ ] `omni install --force-cleanup` actively kills any orphan postgres holding the internal port (after validating the target process is postgres)
- [ ] A crash loop where omni-api exits within < 5 s is throttled by pm2 (≤ 10 restarts within a short window, then marked `errored`) — logs cannot grow unbounded
- [ ] `omni-api-error.log` and `omni-api-out.log` auto-rotate at 10 MB and retain 5 rotations
- [ ] `omni install` on a system with an existing install (config.json present, pm2 processes registered, or data dir non-empty) detects this, prints `Reinstalling — data at <dataDir> will be preserved` BEFORE touching anything, reuses the existing config without prompting, and exits with the data dir byte-identical (same file count, same checksums on a sample of message files)
- [ ] `omni install` on a clean system completes end-to-end with zero user input required — no `readline`, no prompts, no "press Y/n"
- [ ] `omni install` stdout ends with a structured "For the agent running this install" block containing: a `pm2 describe omni-api` command to verify health, an explicit instruction to load the `/omni` skill, and a suggested next step to ask the user about channel setup
- [ ] The agent handoff block is plain text, no ANSI color, no ASCII art, no interactive prompts — parseable by an agent reading stdout
- [ ] All `readline`-based functions (`promptLine`, `promptYesNo`, `chooseProcessManager`, `promptConfig`, `promptApiKey`) are deleted from `install.ts`
- [ ] `install.ts` line count drops substantially (target: < 400 lines from the current 666)
- [ ] Regression tests for each failure mode pass in CI
- [ ] `bun run build` zero errors across all packages
- [ ] `bunx biome check .` zero lint errors
- [ ] `bun test` no new failures (record pre-existing ones)

## Execution Strategy

### Wave 1 (parallel — independent surface areas)

| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | pgserve internal-port orphan guard (`packages/api/src/pgserve.ts` only — env var path) |
| 2 | engineer | libicu soname shim (postinstall script + runtime fallback) |
| 3 | engineer | **Install & Lifecycle CLI Rewrite** — reinstall detection, wizard removal, agent handoff banner, `--force-cleanup` flag, pm2 launch hardening, `pm2-logrotate` install, two new doctor checks. Single engineer owns all changes to `install.ts`, `start.ts`, `doctor.ts`. |

### Wave 2 (after Wave 1)

| Group | Agent | Description |
|-------|-------|-------------|
| 4 | engineer | Regression tests covering all four failure modes (orphan, libicu, pm2 loop, reinstall-on-existing-data) + QA.md |
| review | reviewer | Review Groups 1-4 against acceptance criteria |
| qa | qa | End-to-end on dev: fresh install, reinstall-on-existing-data, simulated orphan, crash loop, agent handoff block presence |

## Execution Groups

### Group 1: pgserve Internal-Port Orphan Guard

**Goal:** Make `startEmbeddedPgserve()` refuse to start when any process holds the internal port (proxy + 1000), regardless of whether that process's `postmaster.pid` is in the current data dir.

**Deliverables:**
1. New helper `findProcessOnPort(port: number): Promise<{ pid: number; cmdline: string } | null>` in `packages/api/src/pgserve.ts` using `ss -tlnp` (Linux), `lsof -iTCP:<port> -sTCP:LISTEN -P -n` (macOS). Parses output into `{ pid, cmdline }`.
2. New helper `killPostgresByPid(pid: number, cmdline: string): Promise<boolean>` that validates `cmdline` contains `postgres` before SIGTERM + 5 s wait + SIGKILL. Refuses to kill if cmdline doesn't match.
3. Before calling `tryStartOnPort()` for each proxy port `P`, probe the internal port `P + 1000`. If occupied:
   - Default behavior: log ERROR with PID + cmdline, throw `PgserveInternalPortConflict` so the API process fails fast instead of silently proxying. Error message MUST include the remediation command: `omni install --force-cleanup` (operator path) or `OMNI_PGSERVE_FORCE_CLEANUP=true omni start` (automation path).
   - If `OMNI_PGSERVE_FORCE_CLEANUP=true` env var set: call `killPostgresByPid()`, wait for port to free, then proceed.
4. Extend `killOrphanedPostgres()` to ALSO scan `PGSERVE_PORT + 1000` via `findProcessOnPort` as a secondary source of truth (not just `postmaster.pid`).

> Note: The `omni install --force-cleanup` CLI flag is implemented in Group 3 (Install & Lifecycle CLI Rewrite) — Group 3 sets `OMNI_PGSERVE_FORCE_CLEANUP=true` in the spawn env. Group 1 owns only the runtime-side env var handling in `pgserve.ts`.

**Files:**
- `packages/api/src/pgserve.ts` (modify)
- `packages/api/src/__tests__/pgserve.test.ts` (new or extend)

**Acceptance Criteria:**
- [ ] Starting omni-api with an orphan postgres listening on 9432 produces `ERROR Pgserve internal port 9432 held by PID <N> (<cmdline>)` and exits non-zero. Error message includes both remediation commands.
- [ ] Setting `OMNI_PGSERVE_FORCE_CLEANUP=true` with the same orphan results in successful startup after the orphan is terminated (env var path — automated test via unit test)
- [ ] `killPostgresByPid()` refuses to kill a process whose cmdline matches `postgres` only as a substring (e.g., shell script that echoes "postgres /tmp/foo") — test with a mocked ps output that has `postgres` embedded but isn't actually the binary. Requires matching `\bpostgres\b` word boundary AND a canonical path prefix from the pgserve binary cache.
- [ ] Existing `killOrphanedPostgres(dataDir)` behavior preserved — test that a `postmaster.pid`-discoverable orphan is still cleaned

**Validation:**
```bash
cd packages/api && bun test src/__tests__/pgserve.test.ts
```

**depends-on:** none

---

### Group 2: libicu Soname Shim

**Goal:** Ensure `@embedded-postgres/linux-x64/native/lib/` always has the soname symlinks (`libicui18n.so.60`, `libicuuc.so.60`, `libicudata.so.60`) the bundled postgres binary's `DT_NEEDED` entries require, regardless of whether upstream fixes the packaging bug.

**Deliverables:**
1. New script `scripts/ensure-libicu-symlinks.cjs` (CommonJS so it runs without Bun) that:
   - Locates `@embedded-postgres/linux-x64/native/lib/` via `require.resolve('@embedded-postgres/linux-x64')` + relative path
   - Scans for any `libicu*.so.60.*` file
   - For each, if the `.so.60` symlink is missing, creates it (`fs.symlinkSync('libicuXXX.so.60.2', 'libicuXXX.so.60')`)
   - Idempotent — re-running is safe
   - Exits 0 even if the package isn't installed (other platforms)
2. Wire the script into the `postinstall` hook of the top-level `package.json` AND `packages/api/package.json` (whichever ships `@embedded-postgres` as a runtime dep).
3. Runtime fallback: at the top of `startEmbeddedPgserve()`, before `await import('pgserve')`, call a synchronous `ensureLibicuSymlinks()` helper that does the same check. If symlinks are missing and the process lacks write permission on the package dir, log a WARN with the exact commands to run manually.
4. Dedupe the logic — `scripts/ensure-libicu-symlinks.cjs` and the runtime helper should share a single implementation (e.g., the runtime helper invokes `require('../../scripts/ensure-libicu-symlinks.cjs')`).

**Files:**
- `scripts/ensure-libicu-symlinks.cjs` (new)
- `package.json` (modify `scripts.postinstall`)
- `packages/api/package.json` (modify `scripts.postinstall`)
- `packages/api/src/pgserve.ts` (wire the runtime fallback)

**Acceptance Criteria:**
- [ ] After `bun install` on a clean checkout, `libicui18n.so.60` exists as a symlink to `libicui18n.so.60.2` inside `@embedded-postgres/linux-x64/native/lib/`
- [ ] Deleting the symlinks and running `omni start` re-creates them via the runtime fallback
- [ ] Running the postinstall on macOS or Windows exits 0 without errors (even though the package isn't installed)
- [ ] Running the postinstall twice in a row is a no-op the second time

**Validation:**
```bash
bun install && \
  test -L node_modules/@embedded-postgres/linux-x64/native/lib/libicui18n.so.60 && \
  test -L node_modules/@embedded-postgres/linux-x64/native/lib/libicuuc.so.60 && \
  test -L node_modules/@embedded-postgres/linux-x64/native/lib/libicudata.so.60 && \
  echo "symlinks OK"
```

**depends-on:** none

---

### Group 3: Install & Lifecycle CLI Rewrite

**Goal:** Rewrite `omni install` from an interactive human-targeted setup wizard into a non-interactive, reinstall-safe, agent-first bootstrapper — and harden the `omni start` / `omni doctor` commands that bracket it.

A single engineer owns all changes to `install.ts`, `start.ts`, and `doctor.ts` to avoid merge conflicts and to keep the install UX internally consistent.

**Deliverables — Sub-section 3A: Install UX Rewrite (`install.ts`)**

1. **Delete the wizard.** Remove `createInterface` import and all `readline`-based functions: `promptLine`, `promptYesNo`, `chooseProcessManager` interactive path, the `nonInteractive` branch in `promptConfig`, `promptApiKey` interactive path, and the `setupChannel` y/n prompt inside `printDoneBanner`. Also remove the `v${VERSION} — setup wizard` subtitle in `printBanner` (replace with `v${VERSION}`).
2. **Keep `--non-interactive` flag as a silent no-op** for backward compatibility with existing scripts. Document it as deprecated in `omni install --help`.
3. **Add reinstall detection.** Before any work, compute `isReinstall` as `true` when ANY of:
   - `~/.omni/config.json` exists and parses to a valid config
   - `pm2 list` contains a process named `omni-api` OR `omni-nats`
   - `~/.omni/data/pgserve/PG_VERSION` file exists (or equivalent marker: `~/.omni/data` contains any non-empty subdirectory)
4. **Reinstall branch.** When `isReinstall === true`:
   - Print BEFORE doing anything else:
     ```
     Reinstalling Omni v${VERSION}
     Your data is at <dataDir> and will be preserved — don't worry.
     ```
   - Load the existing `~/.omni/config.json` and `serverConfig` — do NOT regenerate port/apiKey/databaseUrl/dataDir. `--port` / `--database-url` flags remain respected as explicit overrides; without them, reuse the existing values.
   - Skip NATS re-download if `~/.omni/nats-server` exists (idempotent).
   - Stop and restart pm2 processes with the new hardened flags (Sub-section 3B).
   - Re-run health check.
   - Emit a short "refreshed" summary listing what changed: which binaries were updated, which services restarted.
5. **Fresh-install branch.** When `isReinstall === false`:
   - Use `DEFAULT_API_PORT`, `DEFAULT_DATA_DIR`, embedded `DATABASE_URL`, and a newly-generated `apiKey` — no prompts at all. Flags (`--port`, `--database-url`, `--api-key`) still override.
   - Write `config.json` and `serverConfig`.
   - Start services with hardened pm2 flags.
6. **Agent handoff banner (replaces `printDoneBanner`).** After health check passes, print exactly this structure (NO emoji, NO ASCII art, NO colors, plain text so an agent can parse it):
   ```
   ═══════════════════════════════════════════════════════════
   For the agent running this install
   ═══════════════════════════════════════════════════════════

   Omni v${VERSION} is installed. API: http://localhost:${port}

   Your next actions, in order:

     1. Verify pm2 health:
          pm2 describe omni-api
          pm2 describe omni-nats
        Both must show status: online. If either shows stopped or errored, run:
          omni logs --process api --lines 50
        and diagnose before continuing.

     2. Load the /omni skill (if not already loaded). This gives you the
        full omni playbook: instances, channels, bot setup, troubleshooting.

     3. Assist the user with setting omni up. Ask them which channel they
        want first (WhatsApp, Telegram, Discord, Slack, ...) and walk them
        through:
          omni instances create --help
          omni instances create <name> --channel <channel>

   Config:
     ~/.omni/config.json      (CLI auth)
     ~/.omni/data/            (all data — preserved across reinstalls)
     ~/.omni/logs/            (pm2 logs, rotated)

   API key: <masked or full if just generated>
   ═══════════════════════════════════════════════════════════
   ```
7. **Do NOT exit with `process.exit(0)`** — let the runtime flush stdout naturally.

**Deliverables — Sub-section 3B: pm2 Launch Hardening (`start.ts`)**

8. Modify `runStart()` to pass these flags to `runPm2` for both `omni-api` and `omni-nats`:
   - `--max-restarts 10`
   - `--restart-delay 5000`
   - `--max-memory-restart 2G` (1G for nats)
   - `--log-date-format 'YYYY-MM-DD HH:mm:ss.SSS'`
   - `--output ~/.omni/logs/omni-api-out.log` and `--error ~/.omni/logs/omni-api-error.log` (and nats equivalents)
9. Create `~/.omni/logs/` in `runStart()` before pm2 spawn (mkdirSync recursive).
10. The same hardened flags must be used by `install.ts` when it spawns pm2 (reinstall or fresh-install branch). Extract a shared `buildPm2StartArgs()` helper in `pm2.ts` that both `start.ts` and `install.ts` consume, so the flags are defined in one place.

**Deliverables — Sub-section 3C: `pm2-logrotate` Install (`install.ts`)**

11. During install (both fresh and reinstall), run once:
    - `pm2 install pm2-logrotate`
    - `pm2 set pm2-logrotate:max_size 10M`
    - `pm2 set pm2-logrotate:retain 5`
    - `pm2 set pm2-logrotate:compress true`
    - `pm2 set pm2-logrotate:rotateInterval '0 0 * * *'`
12. If any fail, emit a WARN to stderr but do not fail install — logrotate is best-effort.
13. Skip re-install if `pm2 conf` already shows pm2-logrotate with the same settings (idempotent).

**Deliverables — Sub-section 3D: `--force-cleanup` Flag (`install.ts`)**

14. Add `.option('--force-cleanup', '...')` to `createInstallCommand()`. When set, export `OMNI_PGSERVE_FORCE_CLEANUP=true` into the env passed to any pm2 start / health-check-boot subprocess.
15. The flag is inert (no-op) unless an orphan is actually detected — it does not proactively kill anything.

**Deliverables — Sub-section 3E: New `omni doctor` Checks (`doctor.ts`)**

16. Add `pm2-max-restarts` check — read `pm2 jlist` for `omni-api`, parse `pm2_env.max_restarts`, FAIL if `0` or `>= 1000`, PASS if `10` (or anywhere 5..50). Fix mode: `pm2 delete omni-api && pm2 start ... --max-restarts 10 ...` using the shared `buildPm2StartArgs()` helper.
17. Add `pm2-logrotate-installed` check — run `pm2 conf`, parse the pm2-logrotate block, verify all four keys. FAIL if module missing or any key wrong. Fix mode: re-run the four `pm2 set` commands.
18. Both checks follow the existing pattern at `doctor.test.ts:276` (the `pm2-env-drift` test).

**Files:**
- `packages/cli/src/commands/install.ts` (major rewrite — target < 400 lines from the current 666)
- `packages/cli/src/commands/start.ts` (modify — call `buildPm2StartArgs`)
- `packages/cli/src/commands/doctor.ts` (extend with 2 new checks)
- `packages/cli/src/pm2.ts` (add `buildPm2StartArgs` shared helper)
- `packages/cli/src/__tests__/install.test.ts` (extend — reinstall detection, banner, pm2-logrotate, force-cleanup flag)
- `packages/cli/src/__tests__/start.test.ts` (new or extend — pm2 flag assertions)
- `packages/cli/src/__tests__/doctor.test.ts` (extend — two new check tests)

**Acceptance Criteria:**

*Install UX (3A):*
- [ ] `install.ts` no longer imports `readline`; `promptLine`/`promptYesNo`/`chooseProcessManager`/`promptConfig` interactive path/`promptApiKey` interactive path are deleted
- [ ] `install.ts` line count is under 400
- [ ] `omni install` on a machine with `~/.omni/config.json` present prints `Reinstalling Omni v${VERSION}` and `Your data is at <dataDir> and will be preserved` as the first non-trivial output
- [ ] `omni install` on a machine with a registered pm2 `omni-api` process (but no config.json) still detects reinstall
- [ ] `omni install` on a machine with non-empty `~/.omni/data/pgserve` (but neither config nor pm2) still detects reinstall
- [ ] Reinstall completes without writing a new api key, without regenerating config, and without deleting any file under `~/.omni/data`
- [ ] Fresh `omni install` (no signals) completes end-to-end with zero stdin input
- [ ] `omni install --non-interactive` still works (silent no-op for backward compat)
- [ ] `omni install --help` lists `--non-interactive` as deprecated

*Agent handoff banner (3A):*
- [ ] `omni install` stdout ends with the "For the agent running this install" block
- [ ] Block contains literal substring `pm2 describe omni-api` for health verification
- [ ] Block contains literal substring `load the /omni skill` as an imperative instruction
- [ ] Block contains literal substring `omni instances create` as the suggested next step
- [ ] Block contains NO ANSI escape sequences (test: strip ANSI, compare byte-for-byte)
- [ ] Block contains NO question marks directed at humans (no `?` followed by `[Y/n]` or similar)
- [ ] Block references the preserved data dir path

*pm2 hardening (3B, 3C):*
- [ ] After `omni install` or `omni start`, `pm2 describe omni-api` shows `max restarts: 10`, `restart delay: 5000`, `max memory: 2G`
- [ ] After `omni install`, `pm2 conf` shows `pm2-logrotate:max_size: 10M`, `retain: 5`, `compress: true`, `rotateInterval: '0 0 * * *'`
- [ ] A forced crash loop (e.g., invalid DATABASE_URL) stops restarting after 10 attempts and marks the process `errored`
- [ ] `~/.omni/logs/omni-api-error.log` never exceeds 10 MB (rotation proven via 50 MB of synthetic writes inside the test)
- [ ] `buildPm2StartArgs` is a pure function with unit tests; `install.ts` and `start.ts` both consume it

*Force-cleanup flag (3D):*
- [ ] Running `omni install --force-cleanup` with an orphan on port 9432 completes successfully — the flag sets `OMNI_PGSERVE_FORCE_CLEANUP=true` in the post-install boot env (verified via `install.test.ts` spy on env passed to `runPm2`)
- [ ] `omni install` without the flag refuses to proceed when an orphan is detected (the Group 1 pgserve guard surfaces the error during health check)

*Doctor checks (3E):*
- [ ] `omni doctor` adds a new `pm2-max-restarts` check that flags a running process with `max_restarts: 0` or `max_restarts >= 1000` as FAIL; `omni doctor --fix` re-issues `pm2 delete && pm2 start` with the hardened flags to repair it
- [ ] `omni doctor` adds a new `pm2-logrotate-installed` check that reads `pm2 conf` and flags missing or misconfigured pm2-logrotate; `omni doctor --fix` re-runs the four `pm2 set pm2-logrotate:*` commands
- [ ] `omni doctor` on a correctly-configured install reports both new checks as PASS
- [ ] Both new doctor checks have unit tests in `doctor.test.ts` following the existing pattern (see `pm2-env-drift` test at line 276)

**Validation:**
```bash
cd packages/cli && bun test src/__tests__/start.test.ts src/__tests__/install.test.ts src/__tests__/doctor.test.ts && wc -l src/commands/install.ts
```

**depends-on:** none (but merge conflicts are avoided by having ONE engineer own all `install.ts`/`start.ts`/`doctor.ts` changes)

---

### Group 4: Regression Tests

**Goal:** Every failure mode from the 2026-04-09 incident — and every UX regression the install rewrite could introduce — has a test that would have caught it.

**Deliverables:**
1. Unit test: `pgserve.test.ts` — mock `ss -tlnp` output to simulate an orphan on 9432, assert `startEmbeddedPgserve()` throws `PgserveInternalPortConflict` with the orphan PID in the message.
2. Unit test: `pgserve.test.ts` — mock file system with no `.so.60` symlinks, assert `ensureLibicuSymlinks()` creates them and returns success.
3. Unit test: `start.test.ts` — spy on `runPm2` calls, assert `--max-restarts 10`, `--restart-delay 5000`, `--max-memory-restart 2G`, and log path flags are present (via the shared `buildPm2StartArgs` helper).
4. Unit test: `pm2.test.ts` (new or extend) — `buildPm2StartArgs` pure-function tests: given `{ name: 'omni-api', bundle, logs, env }` returns the expected argv array with all hardened flags; idempotent; no hidden globals.
5. Unit test: `install.test.ts` — spy on `runPm2`, assert `pm2 install pm2-logrotate` + all four `pm2 set` calls are issued in the correct order during install (fresh path).
6. Unit test: `install.test.ts` — **reinstall detection matrix**: parameterize the three signals (config.json present, pm2 process registered, data dir non-empty) and assert that ANY one signal flips `isReinstall` to true. Use a mocked home dir and mocked `runPm2(['list', '--json'])`.
7. Unit test: `install.test.ts` — **reinstall preserves data**: fixture sets up a fake `~/.omni/config.json` + `~/.omni/data/pgserve/PG_VERSION` + a few sample files, run install, assert the files are byte-identical after install, the config is not rewritten, no new api key is generated, and the `Reinstalling Omni` banner is the first non-trivial stdout line.
8. Unit test: `install.test.ts` — **no readline imports**: static assertion that `packages/cli/src/commands/install.ts` source does NOT contain `from 'node:readline'` or `require('readline')`. Also assert `promptLine`, `promptYesNo`, `chooseProcessManager`, `promptConfig`, `promptApiKey` identifiers are absent from the file.
9. Unit test: `install.test.ts` — **install.ts line-count guard**: assert `install.ts` is under 400 lines (fail loud if someone grows the wizard back).
10. Unit test: `install.test.ts` — **agent handoff banner structure**: spy on stdout, run install, assert the final block contains all of: literal substring `For the agent running this install`, literal substring `pm2 describe omni-api`, literal substring `load the /omni skill`, literal substring `omni instances create`. Assert the block contains NO ANSI escape sequences (strip-ansi round-trip byte-equal) and NO `[Y/n]` / `[y/N]` prompts.
11. Unit test: `install.test.ts` — **fresh install is non-interactive**: spy on `process.stdin` for any read attempts, run install with no flags on a clean mocked home dir, assert zero stdin reads occurred and the install completes without blocking.
12. Unit test: `install.test.ts` — **`--non-interactive` flag is a silent no-op**: run install with and without the flag on the same fixture, assert stdout is byte-identical.
13. Integration smoke (manual, documented in `.genie/wishes/omni-install-resilience/QA.md`). The QA.md file MUST cover these scenarios as numbered sections with exact commands and expected output:

    **QA.md required sections:**
    1. **Fresh install on clean system** — `rm -rf ~/.pgserve ~/.omni/data ~/.omni/config.json && pm2 delete all && omni install && omni status` → expect `apiStatus: reachable`, no prompts during install, agent handoff banner present in stdout
    2. **Reinstall preserves data** — starting from the state at end of step 1, capture checksums of `~/.omni/data` contents, then run `omni install` again → expect `Reinstalling Omni v<VERSION>` banner first, `Your data is at <dataDir> and will be preserved` line, data checksums byte-identical after, api key in `config.json` unchanged
    3. **Reinstall detected via pm2 signal only** — `rm -f ~/.omni/config.json && rm -rf ~/.omni/data/pgserve` (leave pm2 process running), then `omni install` → expect reinstall path detected, existing pm2 process stopped and restarted with hardened flags
    4. **Reinstall detected via data-dir signal only** — `pm2 delete all && rm -f ~/.omni/config.json` (leave `~/.omni/data` populated), then `omni install` → expect reinstall path detected, data dir untouched
    5. **Agent handoff banner present and parseable** — run `omni install 2>&1 | tail -40`, grep for `For the agent running this install`, `pm2 describe omni-api`, `load the /omni skill`, `omni instances create` — all must match; also assert no ANSI sequences via `sed 's/\x1b\[[0-9;]*m//g'` round-trip
    6. **Orphan detection on port 9432 (refuse path)** — `postgres -D /tmp/dummy-pg -p 9432 -k /tmp` in one shell, `omni start` in another → expect exit non-zero, ERROR log naming the orphan PID, no silent proxy
    7. **Force cleanup via env var** — same orphan setup, then `OMNI_PGSERVE_FORCE_CLEANUP=true omni start` → expect orphan killed, omni-api healthy
    8. **Force cleanup via CLI flag** — same orphan setup, then `omni install --force-cleanup` → expect orphan killed, post-install health check passes, banner still printed
    9. **libicu symlink check after install** — `ls -la ~/.bun/install/global/node_modules/@embedded-postgres/linux-x64/native/lib/libicui18n.so.60` → expect symlink exists pointing to `libicui18n.so.60.2`
    10. **libicu runtime fallback** — delete the symlinks, restart omni-api → expect symlinks recreated and startup succeeds
    11. **Log rotation under 50 MB write burst** — write 50 MB to `~/.omni/logs/omni-api-error.log` via the pm2 process → expect pm2-logrotate to produce `.0.gz`, `.1.gz` files and keep current < 10 MB
    12. **Slow startup does not trigger false crash-loop** — add a 30 s artificial delay to API startup, verify pm2 does NOT mark process errored within the first 60 s (proves `--restart-delay 5000` slack is sufficient)
    13. **`omni doctor` on a correctly-hardened install** — run after step 1, expect `pm2-max-restarts: PASS` and `pm2-logrotate-installed: PASS`
    14. **`omni doctor --fix` on a degraded install** — manually `pm2 delete omni-api && pm2 start ... --name omni-api` (no flags), run doctor, verify FAIL, then `--fix` repairs to `max_restarts: 10`

**Files:**
- `packages/api/src/__tests__/pgserve.test.ts` (extend)
- `packages/cli/src/__tests__/start.test.ts` (extend or new)
- `packages/cli/src/__tests__/install.test.ts` (extend — reinstall, banner, no-readline, line-count, non-interactive)
- `packages/cli/src/__tests__/pm2.test.ts` (new or extend — `buildPm2StartArgs` pure-function tests)
- `packages/cli/src/__tests__/doctor.test.ts` (extend with two new check tests)
- `.genie/wishes/omni-install-resilience/QA.md` (new — must contain all 14 sections above with exact commands)

**Acceptance Criteria:**
- [ ] All new tests pass under `bun test` from monorepo root
- [ ] Coverage: every acceptance criterion from Groups 1-3 is validated by at least one test
- [ ] Reinstall detection matrix test covers all three signal combinations (config-only, pm2-only, data-dir-only) and the all-three case
- [ ] Agent handoff banner test asserts ALL four literal substrings (`For the agent running this install`, `pm2 describe omni-api`, `load the /omni skill`, `omni instances create`) AND the absence of ANSI + interactive prompts
- [ ] `install.ts` line-count guard test is present and fails if the file exceeds 400 lines
- [ ] QA.md contains all 14 sections listed above with exact commands and expected output
- [ ] QA.md script runs cleanly on a dev box end-to-end (documented run recorded in the wish's Review Results section, not CI-gated)

**Validation:**
```bash
bun test
```

**depends-on:** Group 1, Group 2, Group 3

---

## Dependencies

**Blocks:** none

**Depends on:** task #127 `pgserve-daemon-ownership` — **ALREADY COMPLETED**. The current in-process daemon model in `packages/api/src/pgserve.ts` (in particular `startEmbeddedPgserve`, `killOrphanedPostgres`, and the `PGSERVE_EMBEDDED=true` switch in `ecosystem.config.cjs`) is the output of that task. This wish is a direct follow-up that closes four gaps observed in production use of the shipped daemon-ownership work — three from the 2026-04-09 incident (orphan detection, libicu packaging, pm2 restart loop) plus one pre-existing UX debt (interactive install wizard that can't detect reinstalls and doesn't know about AI agents). No wait state; engineers can start immediately.

**Related GitHub issues:** none yet. File upstream bug reports after this wish merges (these are tracked as a post-merge checklist, NOT as wish scope):
- `@embedded-postgres/linux-x64@18.2.0` missing `.so.60` soname symlinks in `native/lib/`
- `pgserve` `MultiTenantRouter._startPostgres` silent-success: readiness probe via `Bun.connect(internalPort)` can be satisfied by an unrelated postgres process

## QA Criteria

_What must be verified on dev after merge._

- [ ] **Fresh install is zero-prompt** — `rm -rf ~/.pgserve ~/.omni/data ~/.omni/config.json && pm2 delete all && omni install` succeeds with zero stdin reads; stdout ends with the agent handoff block
- [ ] **Reinstall preserves data** — run `omni install` twice in a row; on the second run, data checksums under `~/.omni/data` are byte-identical and the api key in `config.json` is unchanged
- [ ] **Reinstall banner present** — the second run prints `Reinstalling Omni v<VERSION>` and `Your data is at <dataDir> and will be preserved` as the first non-trivial output
- [ ] **Reinstall detected via pm2-only signal** — with no config.json and no data dir, but a registered `omni-api` pm2 process, `omni install` takes the reinstall path
- [ ] **Agent handoff banner parseable** — `omni install 2>&1 | tail -40 | sed 's/\x1b\[[0-9;]*m//g'` contains literal substrings `For the agent running this install`, `pm2 describe omni-api`, `load the /omni skill`, `omni instances create`; no `[Y/n]` / `[y/N]` anywhere in install stdout
- [ ] **Orphan detection fires on port 9432** — spawn `postgres -D /tmp/dummy -p 9432` manually, run `omni start`, verify the ERROR message names the PID and the process does NOT silently proxy
- [ ] **Force cleanup via env var works** — same orphan scenario, run with `OMNI_PGSERVE_FORCE_CLEANUP=true`, verify orphan killed and omni-api healthy
- [ ] **Force cleanup via `--force-cleanup` flag works** — same orphan scenario, run `omni install --force-cleanup`, verify orphan killed and post-install health check passes
- [ ] **libicu symlinks exist after install** — `ls -la ~/.bun/install/global/node_modules/@embedded-postgres/linux-x64/native/lib/libicui18n.so.60` shows a symlink
- [ ] **pm2 restart cap enforced** — force omni-api to crash 15 times in a row (e.g., invalid DB), verify pm2 stops restarting at 10
- [ ] **Log rotation active** — `pm2 conf | grep pm2-logrotate` shows the configured values after `omni install`; under a 50 MB write burst, `omni-api-error.log` stays under 10 MB and rotations appear as `.0.gz` / `.1.gz`
- [ ] **`omni doctor` reports green** on a correctly-configured install (`pm2-max-restarts: PASS`, `pm2-logrotate-installed: PASS`)
- [ ] **`omni doctor --fix` repairs a degraded install** — manually reset pm2 without flags, verify doctor FAILs, then `--fix` brings it back to `max_restarts: 10`
- [ ] **No regression in the happy path** — existing `omni install && omni start && omni status` flow still works end-to-end

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `ss -tlnp` not available on the target system (e.g., some container images) | Medium | Fallback to `lsof -iTCP:<port> -sTCP:LISTEN -P -n`; if both fail, log a WARN and skip the guard (don't block start) |
| `pm2-logrotate` install fails on a restricted pm2 home | Low | Emit WARN, continue install — logrotate is best-effort hardening |
| Auto-creating symlinks in `node_modules/@embedded-postgres/linux-x64/native/lib/` triggers a package-lock check in some tools | Low | Symlinks inside node_modules are common practice (pnpm hoisting); idempotent so repeat runs are safe |
| `killPostgresByPid` SIGKILLs a legitimate postgres used by another project sharing the same host | High | Require both port match AND cmdline contains `postgres`; require explicit `OMNI_PGSERVE_FORCE_CLEANUP=true` env var to enable killing; default is refuse-to-start |
| Upstream `@embedded-postgres/linux-x64` fixes the packaging bug in a later release | Low | Our shim is idempotent and a no-op when symlinks already exist — no cleanup needed |
| `--max-restarts 10` is too low for legitimate slow startups | Low | `--restart-delay 5000` gives 50 s of slack; escalate to 20 if QA shows false positives |

---

## Review Results

### Plan Review — Loop 1 (earlier scope, 3 groups)
**Verdict:** FIX-FIRST → 3 gaps fixed (force-cleanup lever inconsistency, missing doctor-check acceptance criteria, QA.md structure not outlined) → re-review → SHIP.

### Plan Review — Loop 2 (expanded scope with install UX rewrite)
**Verdict:** SHIP.

All wish-specific checks passed:
- `--force-cleanup` cleanly split between Group 1 (env-var runtime path) and Group 3 (CLI flag that sets the env var) with explicit cross-reference note at Group 1
- `install.ts` delete list (`promptLine`, `promptYesNo`, `chooseProcessManager`, `promptConfig`, `promptApiKey`, `printDoneBanner` "first channel?" prompt) verified to match the actual functions present in the current 666-line `install.ts`
- Reinstall data safety proven by Group 4 deliverable #7 (byte-identical fixture test) + success criterion requiring byte-identical data dir
- Agent handoff banner testability: Group 4 deliverable #10 asserts all four literal substrings (`For the agent running this install`, `pm2 describe omni-api`, `load the /omni skill`, `omni instances create`) + no-ANSI round-trip + no `[Y/n]` prompts
- `install.ts` line-count guard test present (Group 4 deliverable #9, target < 400)
- `buildPm2StartArgs` shared helper listed in Files and covered by Group 4 deliverable #4 pure-function test
- Files to Create/Modify section covers every deliverable
- Dependencies honesty: task #127 correctly framed as ALREADY COMPLETED in Summary, Scope OUT, and Dependencies sections

**Next step:** `/work omni-install-resilience` — Groups 1, 2, 3 can execute in parallel (Wave 1); Group 4 waits on Groups 1-3 (Wave 2).

_Execution review (after `/work`) will populate below._

---

## Files to Create/Modify

```
NEW:
  scripts/ensure-libicu-symlinks.cjs                    # Group 2: postinstall + runtime helper
  packages/cli/src/__tests__/pm2.test.ts                # Group 4: buildPm2StartArgs unit tests (if not already present)
  .genie/wishes/omni-install-resilience/QA.md           # Group 4: 14 manual smoke scenarios

MODIFIED:
  package.json                                          # Group 2: postinstall hook → scripts/ensure-libicu-symlinks.cjs
  packages/api/package.json                             # Group 2: postinstall hook → scripts/ensure-libicu-symlinks.cjs
  packages/api/src/pgserve.ts                           # Group 1: internal-port guard + findProcessOnPort + killPostgresByPid
                                                        # Group 2: runtime libicu symlink fallback
  packages/api/src/__tests__/pgserve.test.ts            # Group 4: orphan-on-9432 + libicu symlink creation tests

  packages/cli/src/commands/install.ts                  # Group 3: MAJOR REWRITE
                                                        #   - Delete readline wizard (promptLine, promptYesNo,
                                                        #     chooseProcessManager, promptConfig, promptApiKey,
                                                        #     printDoneBanner "first channel?" prompt)
                                                        #   - Add reinstall detection (3-signal check)
                                                        #   - Add reinstall-preserves-data branch
                                                        #   - Replace printDoneBanner with agent handoff block
                                                        #   - Add --force-cleanup flag → sets OMNI_PGSERVE_FORCE_CLEANUP
                                                        #   - Install pm2-logrotate with hardened settings
                                                        #   - Consume buildPm2StartArgs() from pm2.ts
                                                        #   - Target: < 400 lines (from current 666)
  packages/cli/src/commands/start.ts                    # Group 3: consume buildPm2StartArgs() for both omni-api
                                                        # and omni-nats; mkdir ~/.omni/logs before spawn
  packages/cli/src/commands/doctor.ts                   # Group 3: add pm2-max-restarts + pm2-logrotate-installed checks
                                                        # with --fix modes
  packages/cli/src/pm2.ts                               # Group 3: NEW shared helper buildPm2StartArgs({ name, bundle,
                                                        # logs, env, memory, maxRestarts, restartDelay })
                                                        # returns argv array — single source of truth for pm2 flags
  packages/cli/src/__tests__/start.test.ts              # Group 4: assert buildPm2StartArgs result + mkdir logs
  packages/cli/src/__tests__/install.test.ts            # Group 4: reinstall detection matrix, banner presence,
                                                        # line-count guard, no-readline assertion, non-interactive
                                                        # fresh install, --non-interactive silent-no-op
  packages/cli/src/__tests__/doctor.test.ts             # Group 4: two new check tests following pm2-env-drift pattern
```
