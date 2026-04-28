# Evidence — pm2-log-noise-and-bumps

## Baseline (captured 2026-04-28, before any service restart with fixes applied)

State of `~/.omni/logs/` and `~/.pm2/pm2.log` immediately before the wish landed.

| Metric | Count | Notes |
|--------|-------|-------|
| `bad NAK delay value` in `omni-nats-error.log` | 6 | Each entry has a fractional ns delay (e.g. `1869139323.8630936`). The corresponding NAK redelivery is rejected by the NATS server, so the message gets immediate redelivery with no backoff. |
| `failed to kill - retrying in 100ms` in `~/.pm2/pm2.log` | 824 | One per 100 ms retry; PM2 SIGKILLs after 1600 ms. |
| `Closing open session in favor of incoming prekey bundle` in `omni-api-error.log` | ~1000+ (sample); actual far higher | Log emitted from `@whiskeysockets/libsignal-node/src/session_builder.js:74` via `console.warn` — bypasses omni's pino logger. |
| `Failed to connect` in `omni-api-error.log` | 96,716,257 | DB connection storm on every API restart, caused by PM2 SIGKILLing pgserve dirty before it can drain. |

### File sizes

```
omni-api-error.log    33,482.6 MB apparent  (sparse)
omni-nats-error.log      147.3 KB
~/.omni/logs/ total       1.1 GB on disk
```

The 33 GB apparent size is a sparse file — same failure mode as the 2026-04-09 incident (283 GB) referenced in `packages/cli/src/pm2.ts:23`. The hardened `--max-restarts` and log paths added by WISH `omni-install-resilience` prevent the disk-fill but don't stop the log storm.

### Code under test (before fix)

| File | Line | Issue |
|------|------|-------|
| `packages/core/src/events/nats/consumer.ts` | 149 | `return Math.min(delay + jitter, maxDelayMs)` — float, due to `Math.random()`-based jitter. |
| `packages/cli/src/pm2.ts` | 71-104 | `buildPm2StartArgs` lacks `--kill-timeout`, so PM2's default 1600 ms applies. |
| `packages/api/package.json` | 46 | `"pgserve": "^1.1.10"`. Latest stable is 1.2.0. |
| `packages/channel-whatsapp/vendor/baileys-8e5093c.tgz` | — | Vendored Baileys commit `8e5093c`. |

### Reference verification

```
$ ~/.pm2/pm2.log
2026-04-28T14:02:50: PM2 log: SIGTERM timeout      : 1600
```
PM2's effective `kill_timeout` is 1600 ms while the API's graceful shutdown handler at `packages/api/src/index.ts:327-330` uses a 15 000 ms forceExitTimer. SIGKILL fires ~13.4 s before the API has finished draining DB + NATS + Sentry.

```
$ node_modules/.bun/nats@2.29.3/.../jsmsg.js
nak(millis) {
  payload = StringCodec().encode(`-NAK ${JSON.stringify({ delay: nanos(millis) })}`);
}
function nanos(millis) { return millis * 1000000; }
```
`nanos` preserves fractional ms → fractional ns in the JSON payload → Go server unmarshal into `time.Duration` (int64) fails → "bad NAK delay value".

---

## Group 4 — Baileys vendor bump

**Old:** `vendor/baileys-8e5093c.tgz` (upstream commit `8e5093c`)
**New:** `vendor/baileys-ca61ac14.tgz` (upstream commit `ca61ac14d8f62b8dfdabf14ac3d62786b462faba`)
**Upstream date:** 2026-04-25
**Upstream version:** `7.0.0-rc.9` (unchanged — version field hasn't been bumped between SHAs)
**Procedure:** `git clone WhiskeySockets/Baileys` → `bun install` → `bun run build` → `npm pack` → drop tarball into `packages/channel-whatsapp/vendor/` → update `package.json` → `bun install` at omni root → typecheck + tests.

### Commits between `8e5093c..ca61ac14d8` (upstream `WhiskeySockets/Baileys`)

```
ca61ac14d8 fix: duplicate imports in chats.ts (#2496)
3451ade8c3 fix(chats): update abprops query to fix bad-request error (#2473)
25a4ef73df feat: add initial username INBOUND and Usync support (#2480)
1453b06b09 fix: pin music-metadata to 11.12.1 to avoid missing TypeScript decl
60bec03a8d Enrich call event types (#2355)
c727b42605 fix: streamline JID handling by removing redundant checks
8ca9316a10 fix(chats): add validation for jid and pn_jid in updateBlockStatus
402f479ee8 feat: complete tctoken lifecycle with expiration, pruning and re-issue
ac90a2d765 fix: improve app state sync resilience (verified against WA Web)
77c8d3f718 perf: optimize history sync memory and CPU usage (#2333)
d9811963d2 feat: album message sending (#2058)
```

11 commits. 6 fixes, 4 features, 1 enrichment. No upstream commit explicitly addresses the libsignal `Closing open session in favor of incoming prekey bundle` log line — that noise is expected to persist until upstream demotes it. (Confirmed: emitted by `@whiskeysockets/libsignal-node/src/session_builder.js:74` via `console.warn`, separate package not changed by this bump.)

### Validation

- `bun install` at omni root: clean.
- `bunx turbo typecheck`: 21/21 successful (12.4 s).
- `bun test packages/channel-whatsapp`: 375 pass / 0 fail / 1107 expect() calls (21.5 s).
- Live WhatsApp send/receive smoke check: deferred to Group 5 (post-restart with all four fixes applied).

---

## Post-fix (Group 5) — verified 2026-04-28

After PR #551 merged and release-please published `@automagik/omni@2.260428.1` to the `next` dist-tag:

```
omni update --next                                    # pulled 2.260427.1 → 2.260428.1
truncate -s 0 ~/.omni/logs/*.log ~/.pm2/pm2.log       # clean canvas at 18:41:22Z
pm2 delete all && omni start                          # re-register with new launch args
# ... 10-min observation window 18:41:33Z → 18:52:07Z
```

### Pre-bounce baseline (post `omni update`, pre-truncate)

| Metric | Count | Notes |
|--------|-------|-------|
| `bad NAK delay value` | 6 | Same six historic entries. Zero NEW entries since the API restarted on `2.260428.1` with the `Math.floor` fix. |
| `failed to kill` | 839 | Up from 824 in the morning baseline — `omni update`'s 4 PM2 restarts each ate the 1600 ms timeout and added more lines. The OLD launch args were still live until we re-registered. |
| `omni-api-error.log` | 33 GB sparse | Same as morning baseline (1.1 GB on disk). |

### Post-fix counts (10-min window starting 2026-04-28T18:41:33Z, fresh PM2 launch with `--kill-timeout 20000`)

| Metric | Baseline | Post-fix | Δ |
|--------|----------|----------|---|
| `bad NAK delay value` | 6 historic | **0** | clean — Group 1 confirmed |
| `failed to kill` | 839 | **15** | All 15 are from a single old-process kill (pid `185507`) at 18:41:24 — the OLD process registered before our fix, killed by `pm2 delete all`. **0 new entries** in 10 min after re-register. Group 2 confirmed. |
| `Failed to connect` | 96,716,257 | **0** | The DB-connect storm was caused by PM2 SIGKILLing pgserve dirty. Eliminated by Group 2 (no more dirty kills) + Group 3 (pgserve 1.2.0 ready faster). Wish OUT-scope hypothesis verified. |
| `Closing open session …` | thousands | **1** in 10 min | Baileys/libsignal upstream noise (`@whiskeysockets/libsignal-node/src/session_builder.js:74`). Drops from "every WA message" rate to "occasional"; the Baileys vendor bump may have reduced it but the underlying `console.warn` still fires. Acceptable per OUT-scope. |
| omni-api uptime | 4 restarts in last cycle | **635 s, 0 restarts** | Stable. |
| omni-nats uptime | 2 restarts | **635 s, 0 restarts** | Stable. |
| `omni-api-out.log` size | (not measured) | 107 KB in 10 min | Healthy normal log volume. |
| `omni-api-error.log` size | 33 GB sparse | **718 B** in 10 min | Almost no errors. |

### Causal proof for Group 2 (the kill-timeout fix)

Inspecting `~/.pm2/pm2.log` after the bounce:

```
18:41:22Z Stopping app:omni-api id:0
18:41:22Z Stopping app:omni-nats id:1
18:41:22Z App [omni-nats:1] exited with code [0] via signal [SIGINT]   ← clean exit (small process)
18:41:22Z pid=185528 msg=process killed
18:41:22Z pid=185507 msg=failed to kill - retrying in 100ms            ← OLD omni-api,
18:41:22Z pid=185507 msg=failed to kill - retrying in 100ms              still draining,
18:41:22Z pid=185507 msg=failed to kill - retrying in 100ms              kill_timeout=undefined
... (12 more retries) ...
18:41:24Z Process with pid 185507 still alive after 1600ms, sending it SIGKILL now...
18:41:24Z App [omni-api:0] exited with code [0] via signal [SIGKILL]   ← FORCED
18:41:24Z pid=185507 msg=process killed
18:41:33Z App [omni-api:0] starting in -fork mode-                     ← NEW launch with --kill-timeout 20000
18:41:33Z App [omni-api:0] online
18:41:33Z App [omni-nats:1] starting in -fork mode-
18:41:33Z App [omni-nats:1] online
(... 10 minutes of nothing — no new failed-to-kill, no SIGKILL ...)
```

PM2 process state confirms the new flag is active:

```json
[
  { "name": "omni-api",  "version": "2.260428.1", "kill_timeout": 20000, "uptime_s": 635, "restarts": 0 },
  { "name": "omni-nats", "version": "N/A",        "kill_timeout": 20000, "uptime_s": 635, "restarts": 0 }
]
```

### Hard metric verdict

Wish acceptance criterion (Group 5): **"post-fix `Failed to connect` rate is ≤ 1 line per minute averaged over a 10-min observation window"**.

Result: **0 lines / 10 min = 0/min**. ✅ Far below the threshold.

### Live WhatsApp smoke check

The user's WhatsApp instance reconnected cleanly after `omni start` (`Server is healthy at http://localhost:8882/api/v2/health` returned, no instance state change beyond brief reconnect). No connectivity regressions observed during or after the bounce. Formal send-receive trace deferred to user's normal usage — both inbound/outbound message paths exercise the bumped Baileys code naturally.

### Residual / follow-ups

- **`Closing open session in favor of incoming prekey bundle`**: still emits ~1 line per encrypted-session re-handshake. Source is `@whiskeysockets/libsignal-node/src/session_builder.js:74` (`console.warn` directly, bypasses pino). Cosmetic; not a regression. Leave for upstream.
- **Croner `TimeoutNegativeWarning`**: did not appear once in this 10-min window. No action.
- **The 33 GB sparse `omni-api-error.log` that triggered the trace**: now truncated to 718 B. Disk pressure on `/home/genie/.omni/logs/` resolved (1.1 GB → < 200 KB).
