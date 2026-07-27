---
title: "Single-Tenant (Master-Key) Deployment Mode"
created: 2026-07-27
updated: 2026-07-27
tags: [deployment, operations, multitenancy, upgrade]
status: current
---

# Single-Tenant (Master-Key) Deployment Mode

> **Who this is for:** operators running one Omni deployment for one
> organization, authenticating with a master API key. This is the default and
> fully supported mode. The multi-tenant control plane exists in the same
> binary but is **off unless you turn it on**, and you never need it.

This page states three things an upgrading operator has to know: which flags
keep the legacy behavior, what changed in this release **regardless of flags**,
and what to do before upgrading a large database.

---

## 1. Staying in single-tenant mode

Single-tenant mode is what you get by doing nothing. Two environment variables
control the boundary, and both fail toward legacy behavior:

| Variable | Single-tenant value | Effect |
|----------|--------------------|--------|
| `OMNI_MULTITENANCY_ENABLED` | unset, or anything other than the exact string `true` | No tenant control plane. `/api/v2/platform/**` is never mounted and 404s. Route and auth behavior are the legacy ones. |
| `OMNI_DB_ENFORCEMENT` | unset, or anything other than the exact string `on` | Enforcement mode `legacy`. The boot path takes no new branch, database roles keep their documented behavior, and no RLS enforcement is required. |

Both comparisons are **exact-string**, by design:

- `OMNI_MULTITENANCY_ENABLED` is on only for `"true"`. `1`, `TRUE`, `yes`, and
  the empty string all leave the legacy world intact
  (`packages/api/src/tenancy/feature-flag.ts`).
- `OMNI_DB_ENFORCEMENT` is enforced only for `"on"`. `1`, `true`, and `ON` are
  **not** enforcement (`packages/db/src/tenancy-startup.ts`,
  `resolveEnforcementMode`).

A stray or half-typed value can therefore neither half-activate nor
half-deactivate a security boundary.

With both flags in their default state:

- **No new control-plane surface.** The ten platform tenant/membership endpoints
  are documented in the OpenAPI spec (tagged `Platform`) but are not mounted;
  a request to them returns 404, not 401.
- **Master-key auth is unchanged.** A legacy key carries no tenant context.
  `POST /auth/validate` simply omits the `credential` object for it — its
  absence is a valid legacy response, not a contract violation.
- **Migrations are additive-only and effectively no-ops.** Migration 0041 adds
  *nullable* `tenant_id` columns, *partial* indexes on `tenant_id IS NOT NULL`,
  and `NOT VALID` foreign keys. No existing row becomes invalid, no existing
  unique constraint is touched, and nothing starts requiring a tenant id.

---

## 2. What changed unconditionally in this release

The following apply to **every** deployment, with the flags off. Read this
section even if you never intend to enable multi-tenancy.

### 2.1 Unauthenticated health/info endpoints no longer report inventory

`/health`, `/info`, and `/health/consumers` are unauthenticated. Fields that
disclosed deployment inventory or event-pipeline volume to an anonymous caller
were **removed**, not scoped — scoping is not available to a caller who presents
no credential and therefore names no tenant. This is a privacy fix, and a
feature flag is not allowed to protect an unauthenticated leak.

| Endpoint | Removed | Still present |
|----------|---------|---------------|
| `GET /health` | the per-channel instance-count aggregation (`instances.total`, `instances.connected`, `instances.byChannel`) | `status`, `version`, `uptime`, `timestamp`, `checks.{database,nats,plugins}` |
| `GET /info` | `instances` (total/connected) and `events` (today/total) | `version`, `environment`, `uptime` |
| `GET /health/consumers` | the whole `consumer_offsets` dump — consumer names, stream names, sequence numbers, event ids, update timestamps, and the consumer count | `status`, plus the two new fields below |

**Action required if you monitor these.** Any dashboard, alert, or synthetic
check reading the removed fields will now see them missing. Migrate as follows:

- **Instance counts** → `GET /api/v2/instances` with a credential. An
  authenticated caller gets the same numbers.
- **Consumer lag** → the new staleness signal on `GET /health/consumers`:

  ```json
  { "status": "ok", "tracking": "active", "freshness": "current" }
  ```

  - `tracking`: `active` when offset rows exist, `idle` when none do. It says
    whether the mechanism runs, without revealing how many consumers run.
  - `freshness`: a bounded bucket derived from the **oldest** consumer offset
    update — `current` (< 60s), `lagging` (>= 60s), `stale` (>= 15min).

  A bucket rather than a lag in seconds is deliberate: an anonymous caller
  polling an exact number can difference it over time into a throughput
  estimate, which is the same disclosure the offset dump was. Alert on
  `freshness != "current"`.

- **Per-consumer detail** → the authenticated event-ops surface.

A failing consumer health check now returns `{"status":"error"}` with HTTP 500
and nothing else; the driver detail (host, port, database, role) goes to the
process logs instead of to the caller.

### 2.2 Migration 0041 runs on first boot

The API auto-migrates on startup. On first boot after upgrade, migration
`0041_tenant_ownership_columns` adds nullable `tenant_id` columns, supporting
indexes, `NOT VALID` composite foreign keys, and writer-fence triggers across
29 tenant-owned tables. It is legacy-safe by construction, but on a large
database the **index builds** are the part that costs time — see
[section 3](#3-upgrade-checklist-for-large-databases).

### 2.3 Gupshup cross-id duplicate suppression

Some Gupshup routings deliver the same user message twice: once as the native
event (a `wamid` external id) and once re-posted by an entry-flow relay under a
synthetic `gs-entry-<ms>` id, typically ~1s apart. Id-based dedupe cannot catch
that pair, so the duplicate previously became a second inbound — re-triggering
agent processing and superseding a reply still in flight, so the first reply was
discarded and never reached the user.

Two narrow suppression rules now drop the relay copy, both short-windowed and
failing open:

1. Same chat + same normalized text under a different external id, where one id
   is a relay id, within 10s. Texts of 3 characters or fewer are exempt, because
   "ok"/"yes" repeats are legitimate.
2. A relay text that is only a `filemanager.gupshup.io` URL arriving right after
   a native media message from the same chat (the relay's media echo), within 60s.

**Operator impact:** duplicate inbound Gupshup messages stop; legitimate user
repeats are preserved. Suppressions are logged at info level under
`gupshup cross-id dedupe`.

### 2.4 Voice WebSocket now refuses unrecognized API keys

The voice stream upgrade (`/api/v2/voice/stream/{sessionId}?api_key=…`) was
**fail-open**: the key validator returns `null` — it does not throw — for an
unknown, malformed, expired, or revoked key, and the result was not inspected.
The upgrade therefore admitted every key that failed politely and refused only
the ones that failed loudly.

Every unresolvable outcome now refuses the upgrade:

- no validator available (partially-initialized process) → refuse;
- validator resolves `null` (not a live credential) → refuse;
- validator throws (an auth store we cannot consult is not evidence of
  authority) → refuse.

**Operator impact:** voice clients connecting with an expired, revoked, or
mistyped key now fail the WebSocket upgrade instead of connecting. If a voice
integration breaks after upgrade, the key it presents was never valid — reissue
it rather than reverting.

---

## 3. Upgrade checklist for large databases

Migration 0041 creates its indexes with plain `CREATE INDEX ... IF NOT EXISTS`,
inside the migration transaction. On a fresh or small install that is correct
and fast, and nothing below is needed. On a large database it takes a lock for
the duration of the build, which can exceed a boot timeout and make the API look
like it is failing to start.

Run the online phase **before** upgrading:

```bash
# 1. Preflight: which high-volume tables still need indexes, and how big are they.
#    Reports and exits without changing anything.
bun run db:online-ddl --url "postgres://…" --check

# 2. Online phase: adds the nullable columns (catalog-only, instant) and builds
#    every index with CREATE INDEX CONCURRENTLY — no long lock, and resumable.
bun run db:online-ddl --url "postgres://…"

# 3. Upgrade and start the API as usual. Migration 0041 finds every column and
#    index already present, so it only adds the NOT VALID constraints and the
#    triggers, and takes no long lock.
```

Notes:

- `--url` is **required**. `DATABASE_URL` is deliberately not read: running
  index builds against "whatever was in the environment" is not an accident
  worth enabling.
- The runner is safe to re-run. An `INVALID` index left behind by an interrupted
  `CONCURRENTLY` build is dropped and rebuilt rather than being skipped forever
  by `IF NOT EXISTS`.
- High-volume tables where this matters: `persons`, `platform_identities`,
  `chats`, `chat_participants`, `messages`, `omni_events`, `media_content`,
  `dead_letter_events`, `event_payloads`, `automation_logs`, `trigger_logs`,
  `turns`, `processed_events`.
- Never use `drizzle-kit push` on a database that also runs `migrateDb()` —
  push creates objects without journal entries and the next auto-migrate crashes
  with "relation already exists".

---

## 4. The multi-tenant mode, and why you can ignore it

A full multi-tenant control plane — platform-class credentials, tenant
lifecycle, memberships, per-tenant credential ceilings, and RLS enforcement —
ships in the same binary behind the two flags in
[section 1](#1-staying-in-single-tenant-mode). It is **parallel to**, not a
replacement for, single-tenant operation:

- Single-tenant master-key deployment remains a first-class supported mode. It
  is not deprecated and there is no migration deadline.
- Turning the flags on is an explicit, reversible-by-configuration decision that
  adds surface (`/api/v2/platform/**`) and, under `OMNI_DB_ENFORCEMENT=on`,
  changes the boot path to fail closed unless dedicated database identities
  exist.
- One thing to know if you ever do enable enforcement: `omni keys create --admin`
  refuses to mint a master ("god") key while `OMNI_DB_ENFORCEMENT=on`. A
  plaintext data-plane key with every scope is not an admissible bootstrap under
  enforcement; create a platform-class credential and delegate a tenant-scoped
  key from it instead.

Until then, nothing about single-tenant operation requires a tenant id, a
tenant record, or a platform credential.

---

## See also

- `packages/api/src/routes/health.ts` — the unauthenticated-surface privacy contract, stated inline
- `packages/db/drizzle/0041_tenant_ownership_columns.sql` — the additive migration, with per-section operator notes
- `packages/db/scripts/online-ddl.ts` — the `db:online-ddl` runner
- [[install|Installation Guide]]
