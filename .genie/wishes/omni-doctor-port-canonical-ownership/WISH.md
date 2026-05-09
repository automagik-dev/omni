---
slug: omni-doctor-port-canonical-ownership
title: "omni doctor: detect + repair non-pm2 squatters on canonical ports"
status: ready
priority: P1
target_branch: dev
size: hotfix
---

## Problem

Tonight's incident — `omni-nats` crash-looped 75 times in `pm2` (status `waiting restart`) because an orphan `nats-server` from a prior session (PID 3899940, 21h uptime, started before today's `omni update` to 2.260508.2) held port 4222. The pm2-managed entry could never bind. omni-api was happily connected to the orphan, so messages still flowed — but the pm2 process was burning CPU and rotating logs forever.

`omni doctor` did not catch this and `omni doctor --fix` could not have repaired it. Three concrete gaps in `packages/cli/src/commands/doctor.ts`:

1. **`pm2-status` (L493) detects `waiting restart` but `applyFix` (L927) has no branch for it** — reports FAIL, walks away.
2. **No port-conflict check exists at all.** Doctor only inspects pm2's view of its own processes; it never asks the kernel "who actually owns 4222 / pgserve port?" An orphan non-pm2 process hijacking the canonical port is invisible.
3. **`checkPm2MaxRestarts` (L520) only inspects omni-api, never omni-nats** — the process that crash-looped tonight wasn't even being watched. Worse, `ecosystem.config.cjs` L49 sets `max_restarts: 0` (unlimited), and the very same check FAILs on that value. Operator-blessed config produces a guaranteed FAIL, training operators to ignore it.

The orphan-vs-pm2 race is the most common operational failure after every `omni update`, because pm2 doesn't model "external squatter on my port." Doctor must.

## Scope

Add to `omni doctor` the ability to **detect and repair** non-pm2 processes squatting on canonical ports, plus extend existing checks to cover both managed processes consistently.

### In scope

1. **New check `port-canonical-owner`** — for each `PM2_PROCESSES` entry, resolve its expected port (NATS=4222, pgserve=resolved via `resolvePgservePort`) and verify the listener PID matches the pm2-managed PID. FAIL when a non-pm2 PID owns the port; OK when it matches; WARN when no listener exists yet.
2. **New fixer `fixPortCanonicalOwner`** — SIGTERM the squatter, wait up to 5s for graceful exit, escalate to SIGKILL, then `pm2 restart <name>` so pm2 reclaims. Refuse to act if the squatter is itself pm2-managed under a different name (prevents foot-guns).
3. **Wire `pm2-status` to a fixer** — when `pm2-status` is FAIL because a process is `waiting restart`, run the same `port-canonical-owner` reconciliation, then `pm2 restart` the failing entry.
4. **Extend `checkPm2MaxRestarts` to cover both `api` and `nats` processes** — currently only api. Same threshold logic.
5. **Reconcile the contradiction** — pick a side. Recommendation: change `ecosystem.config.cjs` `max_restarts: 0` → `max_restarts: 10` (matches `PM2_HARDENED_DEFAULTS`). Bounded restarts let the storm self-arrest; doctor's current threshold (5..50) then passes.

### Out of scope

- Generalizing port detection beyond NATS + pgserve (Discord/Telegram channel ports etc).
- `--fix-config` flag to auto-rewrite `ecosystem.config.cjs` (just edit the file in this PR).
- Restart-storm rate detection (`>10/min`); leave for a follow-up wish.
- Anything about the WhatsApp history-sync flood / Baileys session churn — that's a separate in-progress task (#210).

## Files

- `packages/cli/src/commands/doctor.ts` — add `port-canonical-owner` check + fixer, dispatch from `applyFix`, extend `checkPm2MaxRestarts` to cover nats.
- `packages/cli/src/__tests__/doctor.test.ts` — add unit tests for the new check + fixer (mock `lsof`/`ss`, mock pm2 jlist, mock `kill`).
- `ecosystem.config.cjs` — change SHARED `max_restarts: 0` → `10`.
- `packages/cli/src/pm2.ts` (only if needed) — surface a helper to read pm2-managed PIDs by process name.

## Acceptance criteria

1. `omni doctor` (no flag) reports `port-canonical-owner` as a new check, OK on a healthy install.
2. With an orphan `nats-server` bound to 4222 and pm2 omni-nats crash-looping, `omni doctor` reports both `pm2-status=FAIL` and `port-canonical-owner=FAIL` with detail naming the squatter PID.
3. `omni doctor --fix` kills the squatter and brings pm2 omni-nats back to `online`. Re-run reports OK on both checks.
4. `checkPm2MaxRestarts` reports omni-nats's max_restarts independently of omni-api.
5. `ecosystem.config.cjs` change: `pm2 restart ecosystem.config.cjs --update-env` shows `max_restarts: 10` for both processes.
6. New unit tests pass; existing doctor tests still pass.

## Validation

```bash
# build + test
bun run build
bunx biome check .
bun test packages/cli/src/__tests__/doctor.test.ts

# manual repro on a dev box
# 1. start a manual nats-server on 4222 outside pm2
# 2. observe pm2 omni-nats crash-loop
# 3. run `omni doctor`            → expect FAIL on both checks
# 4. run `omni doctor --fix`      → expect squatter killed, pm2 reclaim
# 5. re-run `omni doctor`         → expect OK
```

## Notes for engineer

- Tonight's actual repro is preserved in pm2 logs — the orphan was killed at ~22:08:54 UTC and pm2's `omni-nats` (PID 2342077) reclaimed 4222 cleanly. JetStream restored 322k messages; omni-api reconnected on 3 sockets with one in-flight publish TIMEOUT. That timing window (~3-4s of cutover) is the cost of the fix and is acceptable.
- Use `ss -tlnpH` (or `lsof -i :PORT -sTCP:LISTEN`) to identify the listener. Prefer `ss` — it's in the base image; `lsof` may not be.
- For SIGTERM/SIGKILL, use `process.kill` from `node:process`, not shelling out — easier to test.
- Refuse to act when `--fix` is invoked and the squatter PID has CWD or argv pointing at a known pm2-managed binary path under a *different* name. We don't want doctor murdering a sibling channel process by mistake.
- Target branch `dev`. Conventional commit `fix(doctor): detect and repair non-pm2 port squatters`.
- Single PR. ≤300 LOC delta excluding tests preferred. Tests can be larger.
