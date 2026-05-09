# Wish: PM2 log noise + NAK loop + dep bumps (pgserve, Baileys)

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `pm2-log-noise-and-bumps` |
| **Date** | 2026-04-28 |
| **Author** | Felipe |
| **Appetite** | small (1-2 days) |
| **Branch** | `wish/pm2-log-noise-and-bumps` |
| **Design** | _No brainstorm — direct wish from /trace 2026-04-28_ |

## Summary

A fresh `omni install` (v2.260427.1) is producing high-volume PM2 + omni-api log spam and burning resources via two interacting bugs: NATS rejects every NAK because the JS retry helper emits fractional millisecond delays, and PM2 SIGKILLs the API on every restart because the launcher never sets `--kill-timeout` to match the 15 s graceful shutdown. While we're in the file, bump pgserve `1.1.10 → 1.2.0` (latest is 1.2.0) and re-vendor Baileys from a current upstream commit (the `Closing open session in favor of incoming prekey bundle` console.log is upstream noise that newer Baileys may demote).

## Scope

### IN

- Fix fractional NAK delay in `calculateBackoffDelay` (`packages/core/src/events/nats/consumer.ts`).
- Add `--kill-timeout` to PM2 hardened launch args (`packages/cli/src/pm2.ts`).
- Bump `pgserve` from `^1.1.10` to `^1.2.0` in `packages/api/package.json`.
- Re-vendor Baileys to a fresher upstream commit (replace `vendor/baileys-8e5093c.tgz`) using the established vendoring pattern from PRs #524 / #525.
- Add a regression test that asserts `calculateBackoffDelay` always returns an integer.
- After fixes, capture before/after log volumes (NATS `bad NAK delay value` count, PM2 `failed to kill` count, omni-api error.log size delta over 5 min) as evidence.

### OUT

- Replacing PM2 with another supervisor (kept — only tuning kill timeout).
- Patching Baileys' `console.log` for the `Closing open session…` line via monkey-patch — we'll see if the upstream bump quiets it; if not, defer to a follow-up wish.
- Croner's `TimeoutNegativeWarning` — cosmetic, fires once at startup, no resource impact. Track separately if it persists after the API stops being SIGKILLed.
- Reworking the DB connection startup race directly — expected to resolve once #2 stops PM2 from killing pgserve mid-shutdown; verify in Group 5, only file a follow-up if it doesn't.
- Migrating to `nats-io/nats.js@3.x` (the `2.x` we use is fine once delays are integers).

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Fix the NAK delay at the source (`calculateBackoffDelay`) with `Math.floor`, not at the call site. | One-line fix at the helper guarantees every existing/future caller sends integer ms; testable in isolation; existing tests at `__tests__/consumer.test.ts:111-138` already cover it. |
| 2 | Set PM2 `--kill-timeout` to `20000` ms (15 s graceful + 5 s buffer). | Matches the explicit `forceExitTimer` in `packages/api/src/index.ts:327` (15 000 ms) plus headroom for Sentry flush (5 s) and DB drain. |
| 3 | Bump pgserve to `^1.2.0` (latest). | Confirmed via `bunx npm view pgserve version` → `1.2.0`. Minor bump; pgserve uses semver; user explicitly asked. |
| 4 | Bump Baileys via the vendor-tarball pattern (not `npm install baileys`). | Established pattern: prior bumps `ad5ea81` → `d077902` → `8e5093c` were all vendored tarballs (see PRs #524, #525). The npm registry version (`baileys@7.0.0-rc.9`) is upstream pre-release; we pin to a tested commit. |
| 5 | Treat NAK fix and PM2 fix as the two real burners; everything else is opportunistic. | Trace evidence: NAK loop drives feedback redelivery (every `Failed to connect` triggers a NAK that NATS rejects → immediate redelivery → CPU + log I/O); PM2 SIGKILL drives the cascade by killing pgserve dirty on every restart. |
| 6 | Run dep bumps in parallel with the code fixes (different files, no overlap). | Bumps touch only `package.json` + `vendor/`; code fixes touch `consumer.ts` + `pm2.ts`. Independent — wave 1 ships them together. |

## Success Criteria

- [ ] `bad NAK delay value` warnings disappear from `~/.omni/logs/omni-nats-error.log` (steady-state — zero new occurrences in 5 min after restart).
- [ ] `pid=X msg=failed to kill - retrying in 100ms` no longer appears on `pm2 restart omni-api` (the API exits cleanly within the 20 s timeout window).
- [ ] `omni-api` graceful shutdown log (`Graceful shutdown complete`) is observable in `~/.omni/logs/omni-api-out.log` after `pm2 stop omni-api`.
- [ ] `bun test packages/core/src/events/nats/__tests__/consumer.test.ts` passes, including a new assertion that `Number.isInteger(calculateBackoffDelay(...))` for representative inputs.
- [ ] `packages/api/package.json` declares `"pgserve": "^1.2.0"`; `bun install` resolves cleanly; `omni-api` boots and migrates.
- [ ] `packages/channel-whatsapp/vendor/` contains a Baileys tarball strictly newer than `8e5093c`; `bun install` resolves cleanly; a manual WhatsApp send/receive smoke check succeeds.
- [ ] `make check` (typecheck + lint + test) green on the wish branch.
- [ ] Evidence file `.genie/wishes/pm2-log-noise-and-bumps/EVIDENCE.md` records before/after log-volume counts and the new Baileys commit SHA.

## Execution Strategy

Single wave of four parallel groups (no internal blockers — different files), then a sequential verification group.

| Wave | Group | Agent | Description | depends-on |
|------|-------|-------|-------------|------------|
| 1 | 1 | engineer | NAK delay integer fix + regression test | none |
| 1 | 2 | engineer | PM2 `--kill-timeout` flag in launch args | none |
| 1 | 3 | engineer | pgserve dep bump `1.1.10 → 1.2.0` | none |
| 1 | 4 | engineer | Baileys vendor re-bump from upstream HEAD | none |
| 2 | 5 | qa | Verify log-volume drop + smoke checks + write EVIDENCE.md | 1, 2, 3, 4 |

---

## Execution Groups

### Group 1: NAK delay integer fix
**Goal:** Stop NATS server from rejecting every redelivery NAK with `bad NAK delay value`. The JS retry helper currently emits fractional ms (e.g. `1869.139`), the nats.js client multiplies by `1e6` for nanos, and Go's `time.Duration` (int64) refuses fractional JSON.

**Deliverables:**
1. `packages/core/src/events/nats/consumer.ts:138-148` — wrap the return in `Math.floor(...)`:
   ```ts
   return Math.floor(Math.min(delay + jitter, maxDelayMs));
   ```
2. `packages/core/src/events/nats/__tests__/consumer.test.ts` — add a test inside the existing `describe('calculateBackoffDelay', ...)` block asserting `Number.isInteger(calculateBackoffDelay(0, 1000))`, repeated for retry counts `0..5`.
3. No other call sites need to change — `subscription.ts:153 msg.nak(delay)` automatically benefits.

**Acceptance Criteria:**
- [ ] `Math.floor` applied at the single helper return; no other delay-emitting call sites added.
- [ ] New test asserts integer output for at least retry counts `0..5` and the `maxDelayMs` clamp case.
- [ ] Existing tests at `consumer.test.ts:114-138` still pass without modification (range bounds unchanged).
- [ ] After `pm2 restart omni-api`, no new `bad NAK delay value` warnings in `~/.omni/logs/omni-nats-error.log` for 5 min.

**Validation:**
```bash
bun test packages/core/src/events/nats/__tests__/consumer.test.ts && \
pm2 restart omni-api && sleep 300 && \
grep -c "bad NAK delay value" ~/.omni/logs/omni-nats-error.log
```
(Last command should report `0` new lines vs a baseline captured before the restart.)

**depends-on:** none

---

### Group 2: PM2 `--kill-timeout` flag
**Goal:** Let the API finish its 15 s graceful shutdown before PM2 SIGKILLs it. PM2's default `kill_timeout` is 1 600 ms (visible in `~/.pm2/pm2.log`: `SIGTERM timeout : 1600`); the omni launcher never overrides it.

**Deliverables:**
1. `packages/cli/src/pm2.ts:71-104` — extend `buildPm2StartArgs` to push `'--kill-timeout', '20000'` into the args array (applies to both `kind: 'api'` and `kind: 'nats'`).
2. Add a `killTimeoutMs: 20000` field to `PM2_HARDENED_DEFAULTS` (constants block at the top of the same file) so it lives next to the other hardened limits.
3. Update the comment block at `packages/cli/src/pm2.ts:17-24` to mention the kill-timeout addition and link to this wish slug.
4. Existing CLI test (if any) under `packages/cli/src/__tests__/` updated; if no existing test covers `buildPm2StartArgs`, add a minimal unit test asserting the args array contains `--kill-timeout 20000`.

**Acceptance Criteria:**
- [ ] `buildPm2StartArgs({ kind: 'api', ... })` returns an array containing `'--kill-timeout', '20000'`.
- [ ] `buildPm2StartArgs({ kind: 'nats', ... })` returns the same flag.
- [ ] After `pm2 delete all && omni start && pm2 restart omni-api`, no `failed to kill - retrying in 100ms` lines in `~/.pm2/pm2.log`.
- [ ] `Graceful shutdown complete` appears in `~/.omni/logs/omni-api-out.log` on the next `pm2 stop omni-api`.

**Validation:**
```bash
bun test packages/cli/src/__tests__/pm2.test.ts && \
pm2 delete all && omni start && \
pm2 stop omni-api && sleep 5 && \
grep -c "Graceful shutdown complete" ~/.omni/logs/omni-api-out.log && \
grep -c "failed to kill" ~/.pm2/pm2.log
```
(First grep ≥ 1, second grep should be 0 new occurrences vs baseline.)

**depends-on:** none

---

### Group 3: pgserve dep bump 1.1.10 → 1.2.0
**Goal:** Move `pgserve` from `^1.1.10` to `^1.2.0` (latest stable on npm).

**Deliverables:**
1. `packages/api/package.json` — change `"pgserve": "^1.1.10"` to `"pgserve": "^1.2.0"`.
2. `bun install` at the repo root; commit the resulting `bun.lock` delta.
3. Read `pgserve` v1.2.0 release notes (CHANGELOG or GitHub release page) to confirm no breaking config changes; document any caveats in this group's notes.

**Acceptance Criteria:**
- [ ] `packages/api/package.json` declares `^1.2.0`.
- [ ] `bun.lock` updated atomically with the package.json change.
- [ ] `bun install` exits 0; no peer-dep warnings introduced.
- [ ] `omni-api` boots end-to-end (`pm2 logs omni-api --lines 50` shows `Graceful shutdown complete` is reachable, server `listening on …` appears).
- [ ] `make check` green.

**Validation:**
```bash
grep -E '"pgserve":' packages/api/package.json && \
bun install && \
make check && \
omni start && sleep 10 && \
curl -fsS http://localhost:3000/health > /dev/null
```

**depends-on:** none

---

### Group 4: Baileys vendor re-bump
**Goal:** Replace `packages/channel-whatsapp/vendor/baileys-8e5093c.tgz` with a fresher upstream commit. The "Closing open session in favor of incoming prekey bundle" line is hardcoded inside Baileys' libsignal integration — newer commits may demote it; even if not, a routine bump keeps us current.

**Deliverables:**
1. Pull a fresh tarball from upstream `WhiskeySockets/Baileys` (latest `master` HEAD or a recent tagged release). Mirror the vendoring procedure from PR #524: `git clone`, checkout commit, `npm pack`, drop the `.tgz` into `packages/channel-whatsapp/vendor/`, name it `baileys-<short-sha>.tgz`.
2. `packages/channel-whatsapp/package.json` — update the `"baileys": "file:vendor/baileys-<old-sha>.tgz"` line to point at the new tarball name.
3. Delete the old tarball (`baileys-8e5093c.tgz`).
4. `bun install` and commit the lockfile delta.
5. Manual smoke check: send a WhatsApp message via an existing instance (`omni send --to <chat> --text "test"`) and confirm an inbound message is received; capture both in `EVIDENCE.md`.
6. **Required:** record in `EVIDENCE.md` the new upstream commit SHA, the commit date, and a 1-line summary of upstream changes since `8e5093c` (use `git log --oneline 8e5093c..<new-sha>` against a clone of `WhiskeySockets/Baileys` or its successor fork). This makes future regressions correlatable.

**Acceptance Criteria:**
- [ ] New tarball present in `vendor/`, old tarball removed.
- [ ] `packages/channel-whatsapp/package.json` references the new `.tgz` file.
- [ ] `bun.lock` updated.
- [ ] `make check` green.
- [ ] WhatsApp send + receive smoke check passes against a live instance.
- [ ] If the `Closing open session…` line stops appearing, note it in EVIDENCE.md; if it persists, file a follow-up issue (not in scope here).

**Validation:**
```bash
ls packages/channel-whatsapp/vendor/baileys-*.tgz && \
grep '"baileys":' packages/channel-whatsapp/package.json && \
bun install && \
make check && \
pm2 restart omni-api && \
omni instances list  # verify whatsapp instance state stays ACTIVE
```

**depends-on:** none

---

### Group 5: Verification + EVIDENCE.md
**Goal:** Prove the fixes worked with measured before/after evidence and capture follow-up notes.

**Deliverables:**
1. `.genie/wishes/pm2-log-noise-and-bumps/EVIDENCE.md` containing:
   - **Baseline section** — line counts (captured BEFORE truncation) for: `bad NAK delay value` (in `omni-nats-error.log`), `failed to kill` (in `~/.pm2/pm2.log`), `Closing open session in favor of incoming prekey bundle` and `Failed to connect` (both in `omni-api-error.log`). Also record `ls -lh ~/.omni/logs/omni-api-error.log` (apparent size) and `du -sh ~/.omni/logs/` (real disk).
   - **Truncation step** — after baseline capture, run `truncate -s 0 ~/.omni/logs/omni-api-error.log ~/.omni/logs/omni-nats-error.log` so post-fix counts measure new behavior, not historic noise. The current `omni-api-error.log` is a 33 GB sparse file with ~96.7M `Failed to connect` lines — without truncation, post-fix grep counts are meaningless.
   - **Post-fix section** — counts captured ≥ 10 min after a clean `pm2 delete all && omni start`. Use the same four greps. Record the `Failed to connect` rate as `count / observation_window_minutes`.
   - The new Baileys commit SHA + upstream commit date + 1-line summary (from Group 4 deliverable 6).
   - The `pgserve` lockfile delta summary (one line: `pgserve: 1.1.10 → 1.2.0`).
   - Any unexpected residual noise (e.g. croner `TimeoutNegativeWarning` if it still fires) noted as candidate follow-ups.
2. Confirm the DB-connect storm (`Failed to connect` cascade on boot) is gone or quantified — see acceptance criteria for the hard threshold.

**Acceptance Criteria:**
- [ ] EVIDENCE.md exists, contains Baseline / Post-fix sections, and shows NAK + `failed to kill` post-fix counts equal to **0**.
- [ ] **Hard metric:** post-fix `Failed to connect` rate is ≤ **1 line per minute** averaged over a 10-min observation window after a clean `pm2 delete all && omni start`. If exceeded, mark Group 5 INCOMPLETE and file a follow-up wish — do not close this wish.
- [ ] WhatsApp smoke check (one outbound + one inbound) recorded in EVIDENCE.md.
- [ ] `make check` re-run green on top of merged Groups 1-4.
- [ ] Any residual noise (e.g. `TimeoutNegativeWarning`, persistent `Closing open session…`) is documented with a recommendation: defer / follow-up wish / accept as cosmetic.

**Validation:**
```bash
test -f .genie/wishes/pm2-log-noise-and-bumps/EVIDENCE.md && \
grep -c "Baseline" .genie/wishes/pm2-log-noise-and-bumps/EVIDENCE.md && \
grep -c "Post-fix" .genie/wishes/pm2-log-noise-and-bumps/EVIDENCE.md && \
make check
```

**depends-on:** Group 1, Group 2, Group 3, Group 4
