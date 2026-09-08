# Upgrade runbook: 2.260902.5 to 2.260908.20

This runbook covers the database-bearing `omni-api` upgrade from
`v2.260902.5` to `v2.260908.20`. It documents a procedure; it does not
authorize access to a cluster, database, registry, or backup system.

## Decision

- A normal **rolling** upgrade is supported across this boundary. The hop
  ships thirteen migrations, 0053–0065, all additive: new nullable or
  defaulted columns on `instances`, `webhook_sources`, `omni_events`,
  `automations`, and `agents`, plus two new global tables (`event_schemas`,
  `durable_consumers`). A 2.260902.5 process keeps reading and writing every
  touched table unchanged while and after the migrations run.
- One migration holds a long lock: 0064 adds `omni_events.journal_seq` as
  `bigserial`. Its `nextval()` default is volatile, so PostgreSQL **rewrites
  the whole `omni_events` table** under an `ACCESS EXCLUSIVE` lock while
  backfilling the sequence. The journal is the largest table in the system
  (hundreds of thousands of rows on a mature install); expect the first
  target pod's boot to block event writes for the duration of that rewrite
  plus the non-`CONCURRENTLY` index builds of 0058, 0059, and 0064. Schedule
  the roll for a quiet period. This is a pause, not a maintenance window:
  no manual step happens inside it.
- A quiesced upgrade is not required. Use one only if the operator's standard
  change process demands it for every schema change, or if the measured
  `omni_events` size makes the 0064 rewrite pause unacceptable during
  traffic.
- Image-only rollback is safe at every point of this hop. Every new column
  and table is invisible to the 2.260902.5 code, its migrator accepts a
  66-row journal, and its inserts use explicit column lists so the new
  defaulted columns fill themselves. Manual schema reversal is **not
  offered** for this hop; see recovery Path B.
- A tag is never the last-known-good artifact. Record and deploy the full OCI
  reference `ghcr.io/automagik-dev/omni-api@sha256:<64-hex-digest>` for both
  releases. `:latest`, `:main`, and `:v2.260902.5` are mutable selectors, not
  rollback receipts.

## Pinned source evidence

| Boundary | Git commit | Database state | SQL artifact digest |
|---|---|---|---|
| `v2.260902.5` | `ac415b97fe2a5657f7d3203bb0394eb365a97274` | migrations 0000–0052 (53 total) | migrations 0000–0052: `4aba548905663292d3298e267cdfacf50dedbe1e262e4012d922745f027a6fcc` |
| `v2.260908.20` | `609ff119c3607bfdcf8a85c8e18955552ca1f4b4` | migrations 0000–0065 (66 total) | migrations 0053–0065: `6ac850cccb70948b03fc9f0ef6ee0377263248b370be1ec086e29db6e4919369` |

`609ff119c3607bfdcf8a85c8e18955552ca1f4b4` is the full 40-hex commit of the
`v2.260908.20` candidate: the immutable `v2.260908.20` tag resolves to it, and
it is the `CANDIDATE_SHA` pinned in `.github/workflows/image-publish.yml`.

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
git diff --exit-code 609ff119c3607bfdcf8a85c8e18955552ca1f4b4 -- deploy/Dockerfile deploy/Dockerfile.dockerignore package.json bun.lock packages apps
```

The command must produce no diff before the candidate is promoted.

## Migration audit

The wave has three themes: the event backbone (schema registry, causation,
ingress idempotency, strict schemas, transactional emissions, agent manifests,
durable consumers — RFC #925), three channel additions (Gupshup handoff
options, the ASC platform Flow channel, the ASC Brazil gateway channel), and
their connector lifecycle contract.

| Migration | Upgrade and old-writer result | Operational consequence |
|---|---|---|
| 0053 | `instances.gupshup_handoff_options` jsonb, nullable, no default. | Additive; catalog-only, no rewrite. Not a credential — returned by the instances API. |
| 0054 | Four `instances` columns for the ASC Flow channel: `asc_flow_base_url` text, `asc_flow_login` text, `asc_flow_chave` text, `asc_flow_handoff_servico` integer — all nullable, no default. | Additive; catalog-only. `asc_flow_chave` is a channel secret once populated: exclude it from logs and dumps the way other instance credentials are handled. |
| 0055 | `instances.asc_flow_handoff_mode` text, nullable. NULL reads as `'flow'` in the plugin — no backfill. | Additive; catalog-only. |
| 0056 | New global table `event_schemas` (unique on `event_type`, enabled index) and `webhook_sources.event_type_mapping` jsonb. | Additive. The registry is opt-in per event type: an empty table changes no runtime behavior. |
| 0057 | Eight `webhook_sources` connector-lifecycle columns (`expected_interval_seconds`, `last_heartbeat_at`, `heartbeat_count` integer NOT NULL DEFAULT 0, `liveness_status`, `liveness_armed_at`, `stalled_at`, `window_semantics`, `mutation_policy`) plus the partial `webhook_sources_supervised_idx`. | Additive. The NOT NULL DEFAULT column is catalog-only on PostgreSQL 11+; `webhook_sources` is a low-volume configuration table. Liveness supervision stays off until a source declares a cadence. |
| 0058 | `omni_events.causation_id` uuid, nullable, plus `omni_events_causation_idx`. | Additive. The index build takes a `SHARE` lock on `omni_events` (blocks writes, allows reads) for the scan duration. Pre-existing rows stay NULL (forward-only, no backfill). |
| 0059 | `omni_events.idempotency_key` text nullable + global and tenant-scoped unique indexes; `event_type` widened varchar(50)→varchar(255); `webhook_sources.idempotency_key_template` text NOT NULL DEFAULT `'{source}:{sha256(body)}'`; `webhook_sources.total_duplicates` integer NOT NULL DEFAULT 0. | Additive. The widening is binary-coercible — catalog-only, brief `ACCESS EXCLUSIVE`, no rewrite. The unique index builds scan `omni_events` under `SHARE` locks. NULLs are distinct, so legacy rows and 2.260902.5-code inserts (always NULL) never collide. Webhook redeliveries start being deduplicated only once the target code serves ingress. |
| 0060 | `webhook_sources.strict_schemas` boolean NOT NULL DEFAULT false. | Additive; catalog-only. Default false: no source changes behavior until explicitly opted in. |
| 0061 | `automations.transactional_emissions` boolean NOT NULL DEFAULT false. | Additive; catalog-only. Default false: existing automations keep immediate mid-sequence publishing. |
| 0062 | `agents.event_manifest` jsonb, nullable. | Additive; catalog-only. |
| 0063 | `automations.managed_by_agent_id` uuid nullable, `NOT VALID` FK to `agents(id)` ON DELETE CASCADE, plus an index. | Additive. `NOT VALID` means no scan on deploy; only new writes are checked. NULL = hand-made automation; nothing is managed until the manifest compiler writes rows. |
| 0064 | `omni_events.journal_seq` bigserial + unique index; new global table `durable_consumers` (unique on `name`). | **The long one.** The volatile `nextval()` default forces a full `omni_events` table rewrite under `ACCESS EXCLUSIVE` while every existing row is backfilled in physical order, then the unique index is built. Event reads and writes block for the duration. All other statements in the wave are cheap by comparison. |
| 0065 | Three `instances` columns for the ASC Brazil (ASCWhats GW) channel: `asc_base_url` text, `asc_token` text, `asc_originador` varchar(32) — all nullable, no default. The webhook verify token reuses the shared `webhook_verify_token` column, so no new column. | Additive; catalog-only, no rewrite. `asc_token` is a channel secret once populated: exclude it from logs and dumps the way other instance credentials are handled. |

Tenancy posture is unchanged by the wave:

- `instances`, `webhook_sources`, `omni_events`, `automations`, and `agents`
  are all existing `RLS_TENANT_TABLES` (`packages/db/src/tenancy-rls.ts`).
  Their policies predicate only on `tenant_id`; no migration in the wave adds,
  drops, or alters a policy, an RLS flag, an ownership trigger, or a tenant
  FK on them. An enforcement-mode database keeps exactly the same
  `pg_policies` rows and `ENABLE`/`FORCE ROW LEVEL SECURITY` flags after
  0064. The rehearsal asserts that catalog fingerprint before and after.
- The two new tables, `event_schemas` and `durable_consumers`, are global by
  design (their header comments document the decision): no `tenant_id`
  column, no policies, deliberately **not** in `RLS_TENANT_TABLES`. Event
  reads through durable consumers stay tenant-policed by `omni_events`' own
  RLS. Per-tenant ownership of registrations and consumers joins additively
  in a later pass.

Idempotency: the journaled migrator will not re-run an applied file, and every
raw file in the wave is also safe to replay by hand — each `ADD COLUMN`,
`CREATE TABLE`, and `CREATE INDEX` carries `IF NOT EXISTS`, 0063's FK is
guarded by a `pg_constraint` existence check, and re-running 0059's widening
to the same type is a no-op. A replay only emits `already exists, skipping`
notices.

The 2.260902.5 migrator only rejects an applied migration count lower than its
53 files, so it boots against a 66-migration database, and because the wave is
additive that boot is also compatible, not merely tolerated. The runtime
differences all sit behind opt-ins that do not exist in 2.260902.5: schema
registrations, strict-schema sources, ingress dedup, declared connector
cadences, agent manifests, transactional automations, and durable consumers
configured after the upgrade stop being honored for as long as the old image
runs (ingress in particular loses redelivery dedup and accepts duplicates
again).

The target migrator applies its pending set and journal rows in one
transaction under an advisory lock, so the ordinary hop stays at 53 rows or
commits 66. The journal entries for 0053–0065 (idx 53–65, `when`
1785300000000 through 1786500000000 in +100000000 steps) each carry a strictly
later `when` than their predecessor, which is what drizzle's skip rule
requires; `packages/db/src/migrate.ts` additionally fails the boot if the
applied count ends below the file count.

## Preconditions

Do not begin until all items have an operator-owned receipt:

1. Resolve and attest both source and target OCI digests. Record the source
   digest from the currently running pod's `imageID`, not from its tag.
2. Rehearse the exact migration set on disposable PostgreSQL through the
   repository gate (see Repository evidence). No production data is required.
3. Measure `pg_total_relation_size('omni_events')` and derive an expected
   duration for the 0064 rewrite (rewrite throughput on comparable storage,
   plus the three index builds). Decide the roll window from that number.
4. Produce a verified-restorable snapshot of PostgreSQL. This hop does not
   need the snapshot as a rollback point (Path A never touches the database),
   but it is the only route to an exact pre-upgrade schema (see Path B).
   Record its snapshot ID and database WAL/LSN.
5. Confirm the target candidate is intact with the `git diff --exit-code`
   command above.
6. Decide which event-backbone opt-ins (schema registrations, strict-schema
   sources, connector cadences, agent manifests, transactional automations,
   durable consumers) will be configured after the upgrade, and record that
   configuration outside the database — after an image-only rollback the old
   code ignores it, and after a snapshot restore it is gone.

## Upgrade procedure

1. Render the target deployment using its full OCI digest. Refuse the render
   if it contains a tag-only API image.
2. Roll the Deployment normally. The first target pod acquires the migration
   advisory lock, applies 0053–0065 exactly once in order, and starts
   serving; later pods find the work done. The pod's readiness lags by the
   0064 rewrite duration measured in precondition 3. Never pipe migration
   files into the live database by hand as part of the upgrade.
3. Verify before treating the upgrade as complete:

   - `drizzle.__drizzle_migrations` has exactly 66 rows, and its newest row
     has `created_at = 1786500000000` and
     `hash = c18c69e294c7a338a60d2e7dc7cfb8258df151c6125c2e647f8a84ef84b4c800`
     (drizzle's SHA-256 of the 0065 file text);
   - `information_schema.tables` lists `event_schemas` and
     `durable_consumers`, both empty;
   - `information_schema.columns` shows `omni_events.journal_seq` (`bigint`,
     not null, `nextval` default), `omni_events.causation_id` and
     `omni_events.idempotency_key` (nullable, no default), and
     `omni_events.event_type` at `character_maximum_length = 255`;
   - every pre-existing `omni_events` row has a non-null, unique
     `journal_seq` and NULL `causation_id`/`idempotency_key`;
   - `webhook_sources` rows all carry `strict_schemas = false`,
     `idempotency_key_template = '{source}:{sha256(body)}'`,
     `total_duplicates = 0`, `heartbeat_count = 0`, and NULL liveness fields;
   - row counts of `instances`, `webhook_sources`, `omni_events`,
     `automations`, and `agents` are unchanged;
   - on an enforcement-mode database, `pg_policies` lists the same policies
     for the five touched tenant tables as before the roll, and each still
     has row security enabled and forced;
   - the running pod's `imageID` equals the approved target digest.

4. Only after verification, configure the event-backbone opt-ins decided in
   precondition 6. Values written from this point on (schema registrations,
   consumer cursors, liveness declarations, manifests) are the only data this
   hop can strand on rollback.

## Two recovery paths

### Path A — image-only rollback (default)

Deploy the recorded 2.260902.5 **digest** with a normal roll. Leave the
database alone: the 66-row journal, the new columns, and the two new tables
are accepted by the old migrator and invisible to the old code, whose inserts
name their columns explicitly and let the new defaults fill themselves.
Verify the running `imageID` matches the source digest. Configuration written
into the new columns and tables after the upgrade stays in place, unused and
harmless, and is picked up again by the next upgrade — but note the behavior
regression while the old image runs: no ingress dedup, no schema validation,
no liveness supervision, no durable delivery.

Do not restore the pre-upgrade snapshot for this rollback: it would discard
every accepted write since the upgrade for no schema benefit.

### Path B — exact schema reversal (not offered as SQL)

Unlike the 0052 hop, this runbook deliberately ships no reverse SQL. Manual
reversal would have to drop two tables, twenty-seven columns across five tables,
a sequence, six indexes, and a foreign key, delete thirteen bookkeeping rows,
and still could not restore `omni_events.event_type` to `varchar(50)` once
any post-upgrade row carries a longer type — a narrowing `ALTER` would fail
or, worse, be written without the check. A hand-typed 20-statement reversal
against a production journal is a larger risk than the additive leftovers it
removes.

If the operator's policy requires the schema to match the running release
exactly, restore the precondition-4 snapshot through the standard restore
process — accepting that a restore discards every write since the snapshot —
or keep Path A and record the additive delta as an approved exception until
the next upgrade re-lands it.

## Repository evidence

The focused test is
`tests/release/upgrade-2.260902.5-to-2.260908.20-postgres.test.ts`. On a
disposable PostgreSQL cluster it builds the exact 2.260902.5 schema
(migrations 0000–0052), seeds `webhook_sources` and `omni_events` rows the old
way, installs the repository's own tenancy policies on both tables, seeds
drizzle's bookkeeping for the 53 applied files, and then drives the real
`applyMigrations` from `packages/db/src/migrate.ts`. It asserts that exactly
0053–0065 are applied, that every documented column, default, table, and
index exists with the documented type and nullability, that pre-existing rows
keep their values and gain backfilled unique `journal_seq` numbers, that the
RLS/trigger/constraint fingerprint of the touched tenant tables is unchanged
while the index delta is exactly the documented set, that both the migrator
and every raw file are idempotent, that old-shaped and target-shaped writes
coexist, and that the unique index rejects an idempotency-key redelivery.
Statically it pins the migration digests, checks the journal idx/`when`
contiguity for the wave, and checks that the wave contains no destructive
statement and no type change other than the documented 0059 widening.

Run the focused proof through the repository gate, then the complete isolation
gate:

```bash
bun scripts/pg-gate.ts
```

The gate creates and destroys its own random-port, loopback-only PostgreSQL
cluster, discovers every `*-postgres.test.ts` suite, and fails if any suite is
skipped.
