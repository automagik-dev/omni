# Upgrade runbook: 2.260718.1 to 2.260830.2

This runbook covers the database-bearing `omni-api` upgrade from
`v2.260718.1` to `v2.260830.2`. It documents a procedure; it does not authorize
access to a cluster, database, registry, or backup system.

## Decision

- A **quiesced** upgrade is supported: stop every old writer, take and verify a
  coordinated snapshot, then start the target image and migrations.
- A normal rolling upgrade is **not supported** across this boundary.
  Migration 0047 rewrites `whatsapp-cloud` to `whatsapp-business` once, but an
  old 2.260718.1 process can write `whatsapp-cloud` again afterward.
- Image-only rollback is safe only while the database is still at migration
  0039 and no target writer has run. After migration 0047, the database contains
  a channel identifier that the old runtime enum does not accept.
- A tag is never the last-known-good artifact. Record and deploy the full OCI
  reference `ghcr.io/automagik-dev/omni-api@sha256:<64-hex-digest>` for both
  releases. `:latest`, `:main`, `:homolog`, and `:v2.260718.1` are mutable
  selectors, not rollback receipts.

## Pinned source evidence

| Boundary | Git commit | Database state | SQL artifact digest |
|---|---|---|---|
| `v2.260718.1` | `33f956ec90ccd5d5a88d177e113a796b49173d13` | migrations 0000–0039 (40 total) | `248e59bb579dcfad6e2c160f47ae05defba406e0df04f510128d9ddbc5f310c1` |
| `v2.260830.2` | `b8c1bf20cd42b1e30974fc8d67f2b7d0fb620031` | migrations 0000–0051 (52 total) | migrations 0040–0051: `6837fab414b2ae5831cc1f7657fa2cb6b8f20c57bf9960f22ceb1b1bbda9c772` |

The digest algorithm is SHA-256 over each sorted `filename`, a NUL byte, file
bytes, and a trailing NUL byte. The release rehearsal pins it without depending
on Git tags being available in CI. The OCI digests are deliberately not filled
in here: they must come from the registry/attestation and the actually deployed
pod receipt, never from a guessed or mutable tag.

The current Helm template renders `image.repository:image.tag`. To render a
digest without changing the chart, set the repository to
`ghcr.io/automagik-dev/omni-api@sha256` and the tag to the bare 64-hex digest;
inspect the rendered Deployment and refuse it unless the resulting image is
exactly `ghcr.io/automagik-dev/omni-api@sha256:<digest>`. Apply the same rule to
the rollback image. Verify its provenance before deployment, for example with
`gh attestation verify oci://<digest-reference> -R automagik-dev/omni`.

The rehearsal and this runbook are deliberately outside the Dockerfile's
`packages/**` and `apps/**` build inputs. Preserve the target candidate with:

```bash
git diff --exit-code b8c1bf20 -- deploy/Dockerfile package.json bun.lock packages apps
```

The command must produce no diff before the candidate is promoted.

## Migration audit

| Migration | Upgrade and old-writer result | Operational consequence |
|---|---|---|
| 0040 | Adds only control-plane tables, indexes, functions, and triggers; it does not change a legacy business table. | Old 2.260718.1 reads and writes are unaffected. |
| 0041 | Adds nullable, no-default `tenant_id` columns; retains global unique constraints; adds partial tenant indexes, `NOT VALID` same-tenant FKs, and parent-derived insert triggers. It adds no RLS. | Old-shaped inserts remain valid. Under an owned parent they inherit its tenant; under a legacy NULL-owner parent they remain NULL. Run the existing online-DDL preflight/phase before the maintenance window if large-table indexes are pending. |
| 0042–0043 | Adds WhatsApp Cloud and Hermes instance configuration plus new WhatsApp template storage. | Additive; old code ignores it. |
| 0044–0045 | 0044 adds scalar `agent_error_message`; 0045 copies a non-null scalar into a one-element `agent_error_messages` JSON array and drops the scalar. 2.260718.1 knew neither column. | The direct hop preserves the only intermediate value shape. Raw 0045 SQL is not re-entrant after the drop because its UPDATE still references the removed column; only the journaled migrator may apply it. Never replay 0045 by hand. |
| 0046 | Adds WhatsApp Flow key storage. | Additive; old code ignores it. |
| 0047 | Rewrites seven typed columns from `whatsapp-cloud` to `whatsapp-business`; historical JSON payloads intentionally retain `whatsapp-cloud`. There is no normalization trigger or constraint. | This is the mixed-version fence and rollback floor: quiesce old writers before it runs, and query historical JSON using both identifiers. |
| 0048 | Adds message thread/permalink columns and two ordinary (non-concurrent) indexes on `messages`. | Schema-compatible with old writes, but index creation can extend the maintenance window. Rehearse duration on an isolated restored snapshot; the synthetic test does not claim production-scale timing. |
| 0049–0050 | Adds scheduled-message storage and nullable Slack user-auth columns. | Additive; old code ignores it. |
| 0051 | Adds pin/star columns and two ordinary partial indexes on `messages`. | Schema-compatible with old writes, with the same maintenance-window caveat as 0048. |

The old migrator only rejects an applied migration count lower than its 40
files. It can therefore boot against a 52-migration database. A successful old
pod start is not compatibility evidence: it can still misroute or reject
`whatsapp-business` rows.

The target migrator applies its pending set and journal rows in one transaction,
so the ordinary hop remains at 40 rows or commits all 52. Treat a 41–51 count as
nonstandard/manual drift and follow recovery Path B.

## Preconditions

Do not begin until all items have an operator-owned receipt:

1. Resolve and attest both source and target OCI digests. Record the source
   digest from the currently running pod's `imageID`, not from its tag.
2. Rehearse the exact migration set on disposable PostgreSQL. For a realistic
   time bound, use an isolated, access-controlled restore with production-like
   table sizes; no production data is required by the repository test.
3. Run the 0041 online-DDL check/phase using approved secret injection. Do not
   put a database URL in source control, logs, or a durable shell history.
4. Produce a coordinated, verified-restorable snapshot of PostgreSQL and the
   matching auth/key metadata, object-store state, and queued work. Record its
   snapshot ID and database WAL/LSN.
5. Establish a maintenance boundary that stops **all** writers: API pods,
   workers, scheduled jobs, queue consumers, and operator scripts. A read-only
   HTTP banner alone is insufficient.
6. Confirm no old process can restart automatically while the migration runs.

## Upgrade procedure

1. Enter maintenance and drain work. Record the final writer timestamp/epoch
   and queue depth; then verify they remain unchanged.
2. Take the final coordinated snapshot and verify its restore receipt. Do not
   resume writers after this point.
3. Stop every 2.260718.1 process. This deliberately replaces the chart's normal
   rolling behavior for this one boundary.
4. Render the target deployment using its full OCI digest. Refuse the render if
   it contains a tag-only API image.
5. Start one target migrator/API instance. Let the journaled migrator apply
   0040–0051 exactly once; never pipe individual migration files into the live
   database.
6. Verify before adding replicas or resuming writes:

   - `drizzle.__drizzle_migrations` has exactly 52 rows for this release;
   - the expected 0040–0051 tables and columns exist;
   - each typed channel column has zero `whatsapp-cloud` rows across
     `instances`, `platform_identities`, `chats`, `omni_groups`, `omni_events`,
     `sync_jobs`, and `trigger_logs.channel_type`;
   - historical JSON may still contain `whatsapp-cloud` by design;
   - the running pod's `imageID` equals the approved target digest.

7. Start the remaining target replicas, perform read-only health checks, then
   resume consumers and writers. Once any target write is accepted, record that
   the pre-upgrade snapshot is no longer a lossless rollback point.

## Two recovery paths

### Path A — database still at 0039

If no target migration committed and no target writer ran, keep writers
quiesced and deploy the recorded 2.260718.1 **digest**. Verify the database still
has 40 journal rows and the running `imageID` matches the source digest, then
resume. This is the only image-only rollback path.

### Path B — any target migration committed

Do not deploy 2.260718.1 against that database.

- If writers never resumed after the final snapshot, restore the complete
  coordinated snapshot into a fresh recovery environment, verify it is at 0039,
  deploy the source digest against that restored state, and switch over only
  after verification. No post-snapshot write may be discarded.
- If any writer resumed, a return to the pre-tenant 2.260718.1 contract is
  refused because snapshot restore would lose accepted writes and image-only
  rollback cannot interpret the renamed channel data. Stay in maintenance and
  fix forward with an attested, target-schema-compatible image digest. Any
  exceptional data-loss recovery requires a separate incident decision and is
  not this runbook.

## Repository evidence

The focused test is
`tests/release/upgrade-2.260718.1-to-2.260830.2-postgres.test.ts`. On a
disposable PostgreSQL cluster it builds the exact 2.260718.1 schema, seeds all
seven channel-bearing tables, applies 0040–0051 in order, verifies 0045 and the
0047 rewrite, exercises old-shaped writes, and demonstrates the rollback
mismatch.

The initial rolling-safety assertion failed with
`Expected: "whatsapp-business"; Received: "whatsapp-cloud"` after a simulated
late old write. The corrected contract is the quiesced procedure above.

Run the focused proof through the repository gate, then the complete isolation
gate:

```bash
bun scripts/pg-gate.ts
```

The gate creates and destroys its own random-port, loopback-only PostgreSQL
cluster, discovers every `*-postgres.test.ts` suite, and fails if any suite is
skipped.
