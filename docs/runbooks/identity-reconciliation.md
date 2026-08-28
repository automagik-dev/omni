# Runbook — Identity reconciliation rollout

> One-time cleanup of existing identity fragmentation on a production omni
> instance, after the P0/P1 identity fixes land. Pairs with ADR-0003
> (LID-first identity).
> **Status: PLAN — not executed. Requires explicit human approval + a DB backup
> before any write step.**

## Why

`dev` ships two identity fixes:

- **P1 — idempotent resolution** (PR #909): concurrent first-contact no longer mints
  orphan persons or null identity FKs.
- **P0 — handle canonicalization** (PR #918): bare digits / `@s.whatsapp.net` /
  device-suffix `:NN` / Twilio `whatsapp:` prefix all normalize to one key before
  keying; `internal`/`a2a` are excluded from the person graph. This stops NEW
  duplicates.

P0 stops the bleeding but does **not** repair the duplicates already in a DB.
`packages/api/scripts/reconcile-identity-fragmentation.ts` (DRY-RUN by default)
repairs the existing rows.

## What the reconciliation does

Measured against a production instance with real WhatsApp traffic (dry run,
read-only). Numbers are illustrative of scale — **always re-run the dry run against
the target DB to get its own counts before applying.**

| Pass | Effect |
|------|--------|
| Step 1 — dedupe fragmented identities | collapse every spelling of the same number (bare / `@s.whatsapp.net` / device-suffix) to one canonical identity; merge the duplicate persons (oldest survives, fields coalesced) |
| Step 2 — backfill phone-less persons via `chat_id_mappings` | set `primary_phone` from a known `@lid`→phone mapping, or merge into an existing phone-person when one already holds that number |

On a fragmented dataset this typically removes a large fraction of duplicate
person rows (order of ~25–30% on a heavily-fragmented instance).

## ⚠️ Blocking precondition — schema parity

The reconciliation script selects full `persons` rows, so the target DB **must be
on the current schema** (it references `persons.tenant_id`, added in the additive
multitenancy phase). An instance running an older published omni will fail with
`column "tenant_id" does not exist` — and because Step 1 writes before Step 2, an
`--apply` against a stale schema can **partially mutate then abort mid-run**.

**Therefore deploy the current omni to the target first** — its auto-migrate on
startup (`migrateDb()` in `packages/api/src/index.ts`) brings the schema current
and activates P0 canonicalization. Only then run the reconciliation.

## Rollout order

1. **Pick a low-traffic window.** Identity merges touch `persons`,
   `platform_identities`, `messages.sender_*`, `chat_participants`, `omni_events`.
2. **Deploy the current omni** to the target instance.
   - On boot it **auto-migrates** (adds `tenant_id`, etc.).
   - Verify: `/health` reports the new version; `checks.database = ok`.
   - From this point, NEW inbound messages are keyed canonically (no new dupes).
3. **Back up the database** (full logical dump or PITR snapshot). Do not skip — the
   reconciliation deletes duplicate person rows.
4. **Dry run** (read-only, mutates nothing) and capture the report:
   ```bash
   cd packages/api
   DATABASE_URL=<target omni DATABASE_URL> bun run scripts/reconcile-identity-fragmentation.ts
   ```
   Sanity-check the counts against what you expect for this instance.
5. **Apply** (writes; irreversible without the backup):
   ```bash
   DATABASE_URL=<target omni DATABASE_URL> bun run scripts/reconcile-identity-fragmentation.ts --apply
   ```
   The script is idempotent — safe to re-run; a second run should report ~0 work.
6. **Verify post-state:**
   - `persons` row count dropped by roughly the merged-persons figure from the dry run.
   - No `(channel, instance_id, canonical-number)` group has >1 identity spelling.
   - Spot-check known contacts: one person, phone set, history intact
     (messages/participants re-pointed, nothing orphaned).
   - `platform_identities` with `person_id is null` for human channels = 0.
7. **Monitor** for a day: new-person creation rate should drop.

## Rollback

- The reconciliation has no undo — **restore from the step-3 backup** if the
  post-state is wrong.
- The code deploy rolls back like any other omni deploy; the additive `tenant_id`
  migration is forward-only and harmless to leave in place.

## Notes

- Run reconciliation **after** the code deploy so writes during/after the run are
  already canonical (avoids re-fragmenting mid-cleanup).
- `mergePersons` keeps the **oldest** person and coalesces
  `displayName`/`primaryPhone`/`primaryEmail`/`avatarUrl` (never drops a value the
  survivor lacked). Re-pointed FKs: `platform_identities`, `chat_participants`,
  `messages.sender_person_id`, `omni_events.person_id`.
- Every omni instance with real WhatsApp traffic needs this same sequence
  (deploy → backup → dry-run → apply).
- Later phases (P3 group-scoped LID↔PN, P4 `identity_links` audit + coalescing
  merge, P5 cross-channel + tenant-scoped uniques) are tracked in ADR-0003 and are
  **not** part of this runbook.
