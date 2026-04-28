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

## Post-fix (Group 5)

_To be captured after Group 5 verification: clean `pm2 delete all && omni start`, 10-min observation window, before/after grep counts, WhatsApp smoke check._
