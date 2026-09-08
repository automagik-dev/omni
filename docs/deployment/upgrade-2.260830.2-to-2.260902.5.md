# Upgrade runbook: 2.260830.2 to 2.260902.5

This runbook covers the database-bearing `omni-api` upgrade from
`v2.260830.2` to `v2.260902.5`. It documents a procedure; it does not authorize
access to a cluster, database, registry, or backup system.

## Decision

- A normal **rolling** upgrade is supported across this boundary. The only
  migration, 0052, adds two nullable, default-free columns to
  `webhook_sources`; a 2.260830.2 process keeps reading and writing that table
  unchanged while and after it runs.
- A quiesced upgrade is not required. Use one only if the operator's standard
  change process demands it for every schema change.
- Image-only rollback is safe at every point of this hop. The columns are
  ignored by the 2.260830.2 code, and its migrator accepts a 53-row journal.
  Dropping the columns is **optional**, never required; the exact reverse SQL is
  in recovery Path B.
- A tag is never the last-known-good artifact. Record and deploy the full OCI
  reference `ghcr.io/automagik-dev/omni-api@sha256:<64-hex-digest>` for both
  releases. `:latest`, `:main`, `:homolog`, and `:v2.260830.2` are mutable
  selectors, not rollback receipts.

## Pinned source evidence

| Boundary | Git commit | Database state | SQL artifact digest |
|---|---|---|---|
| `v2.260830.2` | `b8c1bf20cd42b1e30974fc8d67f2b7d0fb620031` | migrations 0000–0051 (52 total) | migrations 0000–0051: `9dbd44a3a020bee315d552a4e454714a45722740eb0f454d5a931b8fc0f4a3f7` |
| `v2.260902.5` | `ac415b97fe2a5657f7d3203bb0394eb365a97274` | migrations 0000–0052 (53 total) | migration 0052: `f0199e0fbf6e73de7d59eec3fefad899a9bc4f40df57645d03875c67ccc7adfe` |

`ac415b97fe2a5657f7d3203bb0394eb365a97274` is the full 40-hex commit of the
`v2.260902.5` candidate: the immutable `v2.260902.5` tag resolves to it, and it
is the `CANDIDATE_SHA` pinned in `.github/workflows/image-publish.yml`.

The digest algorithm is SHA-256 over each sorted `filename`, a NUL byte, file
bytes, and a trailing NUL byte. The release rehearsal pins it without depending
on Git tags being available in CI. The OCI digests are deliberately not filled
in here: they must come from the registry/attestation and the actually deployed
pod receipt, never from a guessed or mutable tag.

The generic Helm chart supports the `image.digest` field. Supply the repository
and the operator-approved digest separately:

```bash
helm template omni deploy/helm/omni \
  --set-string image.repository=ghcr.io/automagik-dev/omni-api \
  --set-string 'image.digest=sha256:<64-lowercase-hex>'
```

When `image.digest` is non-empty, it wins over `image.tag` and the chart
`appVersion`; the Deployment renders `image.repository@image.digest`. A malformed
value fails Helm rendering with exactly:

`image.digest must be a lowercase sha256 digest (sha256 followed by 64 hexadecimal characters)`

Refuse the render unless its API image is exactly
`ghcr.io/automagik-dev/omni-api@sha256:<64-lowercase-hex>` and it contains no
tag-only API image. Apply the same rule to the rollback image, and verify its
provenance before deployment, for example with
`gh attestation verify oci://<digest-reference> -R automagik-dev/omni`.

This runbook does not pin a public production digest or grant public production deployment authority.
Each approved digest comes from the operator's registry,
attestation, and running-pod receipts rather than this public repository.

The rehearsal and this runbook are deliberately outside the Dockerfile's
`packages/**` and `apps/**` build inputs. Preserve the target candidate with:

```bash
git diff --exit-code ac415b97fe2a5657f7d3203bb0394eb365a97274 -- deploy/Dockerfile deploy/Dockerfile.dockerignore package.json bun.lock packages apps
```

The command must produce no diff before the candidate is promoted. The list
now includes `deploy/Dockerfile.dockerignore`: it decides which files reach the
image build context, so a change to it changes the image without changing
`packages/**`.

## Migration audit

| Migration | Upgrade and old-writer result | Operational consequence |
|---|---|---|
| 0052 | `ALTER TABLE "webhook_sources" ADD COLUMN IF NOT EXISTS "signature_config" jsonb;` and `ALTER TABLE "webhook_sources" ADD COLUMN IF NOT EXISTS "signature_secret" text;` — nothing else. Both columns are nullable with no default, so PostgreSQL records a catalog change and never rewrites the table. There is no backfill, no `UPDATE`, no constraint, no index, no trigger, no RLS policy change, and no explicit `BEGIN`/`COMMIT` (the boot migrator supplies the transaction). Every existing row keeps `NULL` in both columns. | Additive. Old 2.260830.2 reads use explicit column lists and never see the columns; old inserts omit them and store `NULL`. The `ALTER TABLE` takes a brief `ACCESS EXCLUSIVE` lock on `webhook_sources`, a low-volume configuration table, so no maintenance window is needed for lock duration. |

What the columns mean (`packages/db/src/schema.ts`, `webhookSources`):

- `signature_config` holds `{ algorithm: 'hmac-sha256' | 'hmac-sha1' | 'token-match', header, prefix? }`
  and is the verification contract for a webhook source.
- `signature_secret` holds the shared secret. The API seals it per tenant with
  `sealCredentialField` before writing (`packages/api/src/services/webhooks.ts`)
  and never returns it. Do not copy the column into logs, tickets, or a shell
  history; treat any dump that contains it as credential material.

Tenancy is unchanged by 0052:

- `webhook_sources` keeps its 0041 shape: nullable `tenant_id`, the `NOT VALID`
  tenant FK, the partial tenant indexes, and the `unowned` ownership trigger
  that sets `tenant_id` to `NULL` on insert because the table has no
  FK-covered parent (`packages/db/src/tenancy-ownership.ts`).
- `webhook_sources` is one of the 37 `RLS_TENANT_TABLES`
  (`packages/db/src/tenancy-rls.ts`). Its four policies predicate only on
  `tenant_id`, so an enforcement-mode database keeps exactly the same policies,
  `ENABLE`/`FORCE ROW LEVEL SECURITY` flags, trigger, constraints, and indexes
  after 0052. The rehearsal asserts that catalog fingerprint before and after.
- The database-access guard (`packages/db/src/tenancy-db-access-guard.ts`)
  already registers `packages/api/src/services/webhooks.ts`; the migration
  adds no new access site.

The migration is idempotent at both levels. The journaled migrator will not
re-run it, and unlike 0045 the raw file is safe to replay by hand because both
statements are `IF NOT EXISTS`; a replay only emits `already exists, skipping`.

The 2.260830.2 migrator only rejects an applied migration count lower than its
52 files. It therefore boots against a 53-migration database, and because the
columns are additive that boot is also compatible, not merely tolerated. The
one runtime difference: the auth-exempt public ingress route
`POST /api/v2/webhooks/ingress/:source` does not exist in 2.260830.2 (it
returns 404 there), and the authenticated `POST /api/v2/webhooks/:source` in
2.260830.2 validates expected headers by presence only. A source that was
switched to signed public ingress after the upgrade stops accepting deliveries
on that URL for as long as the old image runs.

The target migrator applies its pending set and journal rows in one transaction
under an advisory lock, so the ordinary hop remains at 52 rows or commits 53.
The journal entry for 0052 (idx 52, `when` 1785200000000) is strictly later
than 0051 (`when` 1785100000000), which is what drizzle's skip rule requires;
`packages/db/src/migrate.ts` additionally fails the boot if the applied count
ends below the file count. The 0041 online-DDL preflight is a no-op on a fully
migrated 0051 database.

## Preconditions

Do not begin until all items have an operator-owned receipt:

1. Resolve and attest both source and target OCI digests. Record the source
   digest from the currently running pod's `imageID`, not from its tag.
2. Rehearse the exact migration set on disposable PostgreSQL through the
   repository gate (see Repository evidence). No production data is required.
3. Produce a verified-restorable snapshot of PostgreSQL. This hop does not need
   the snapshot as a rollback point, but the operator's standard change process
   still owns that decision. Record its snapshot ID and database WAL/LSN.
4. Confirm the target candidate is intact with the `git diff --exit-code`
   command above.
5. Decide whether any webhook source will be switched to signed public ingress
   immediately after the upgrade, and who re-supplies its secret if the hop is
   rolled back through Path B. Secrets go in through
   `omni webhooks ... --signature-secret-env` or `--signature-secret-stdin`,
   never through argv or a committed file.

## Upgrade procedure

1. Render the target deployment using its full OCI digest. Refuse the render if
   it contains a tag-only API image.
2. Roll the Deployment normally. The first target pod acquires the migration
   advisory lock, applies 0052 exactly once, and starts serving; later pods
   find the work done. Never pipe the migration file into the live database by
   hand as part of the upgrade.
3. Verify before treating the upgrade as complete:

   - `drizzle.__drizzle_migrations` has exactly 53 rows, and its newest row has
     `created_at = 1785200000000` and
     `hash = b1871aa39887037d2a844546eb306ac67e4023314fa3418a43b008352f3bd063`
     (drizzle's SHA-256 of the 0052 file text);
   - `information_schema.columns` lists `webhook_sources.signature_config`
     (`jsonb`, nullable, no default) and `webhook_sources.signature_secret`
     (`text`, nullable, no default);
   - the `webhook_sources` row count is unchanged and every pre-existing row has
     `NULL` in both new columns;
   - on an enforcement-mode database, `pg_policies` still lists four policies
     for `webhook_sources` and the table still has row security enabled and
     forced;
   - the running pod's `imageID` equals the approved target digest.

4. Only after verification, configure any webhook source for signature
   verification. Values written into the new columns from this point on are the
   only data this hop can lose on rollback.

## Two recovery paths

### Path A — image-only rollback (default)

Deploy the recorded 2.260830.2 **digest** with a normal roll. Leave the
database alone: the 53-row journal and the two columns are accepted by the old
migrator and invisible to the old code. Verify the running `imageID` matches
the source digest. Any `signature_config`/`signature_secret` values written
after the upgrade stay in the table, unused and harmless, and are picked up
again by the next upgrade.

Do not restore the pre-upgrade snapshot for this rollback: it would discard
every accepted write since the upgrade for no schema benefit.

### Path B — manual column removal (optional)

Only if the operator's policy requires the schema to match the running release
exactly. Run under the DDL identity, after the old image is serving, with the
statements below and nothing else:

```sql
ALTER TABLE "webhook_sources" DROP COLUMN IF EXISTS "signature_secret";
ALTER TABLE "webhook_sources" DROP COLUMN IF EXISTS "signature_config";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1785200000000;
```

The `DELETE` is not optional once the columns are dropped: without it the next
2.260902.5 boot believes 0052 already ran and the API starts against a table
that lacks the columns. With it, the re-upgrade is the ordinary hop and 0052 is
applied again. Dropping the columns discards every sealed secret and signature
config written after the upgrade; those sources must be reconfigured, and their
secrets re-supplied, after the re-upgrade. Rows themselves are never removed.

## Repository evidence

The focused test is
`tests/release/upgrade-2.260830.2-to-2.260902.5-postgres.test.ts`. On a
disposable PostgreSQL cluster it builds the exact 2.260830.2 schema (migrations
0000–0051), seeds `webhook_sources` rows the old way, installs the repository's
own tenancy policies on the table, seeds drizzle's bookkeeping for the 52
applied files, and then drives the real `applyMigrations` from
`packages/db/src/migrate.ts`. It asserts that exactly 0052 is applied, that the
two columns have the documented types and nullability, that existing rows keep
`NULL`, that the RLS/trigger/constraint/index catalog fingerprint is unchanged,
that both the migrator and the raw file are idempotent, that old-shaped and
target-shaped writes coexist, and that the Path B reverse SQL followed by a
re-upgrade returns to the same state. Statically it pins the migration digests,
checks that journal idx 52 carries a strictly later `when` than idx 51, and
checks that 0052 contains nothing but the two `ADD COLUMN IF NOT EXISTS`
statements.

Run the focused proof through the repository gate, then the complete isolation
gate:

```bash
bun scripts/pg-gate.ts
```

The gate creates and destroys its own random-port, loopback-only PostgreSQL
cluster, discovers every `*-postgres.test.ts` suite, and fails if any suite is
skipped.
