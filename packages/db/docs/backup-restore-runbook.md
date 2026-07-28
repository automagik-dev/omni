# Backup and Verified-Restore Runbook — Multitenancy Migration

- **Wish:** omni-full-multitenancy
- **Group:** G6 (repository-local, non-production tooling)
- **Status:** DOCUMENT ONLY — non-executable. This file describes a procedure a
  human operator would later follow under separate approval gates. It runs
  nothing, mutates nothing, and grants no authority.
- **Date authored:** 2026-07-21

## Headline invariant (read this first)

> **Four-store recoverability rule.** A recoverable restore of this system is
> the coordinated restore of **four** state stores together, verified into an
> isolated environment. A database restore *without* the matching auth-plane,
> encryption-key, and event/queue state is **not** a recoverable restore and
> **must be refused.**

This is a direct consequence of WISH "Backups and data safety":

> "Backup/restore rehearsals include the auth-plane store, tenant encryption key
> metadata/KMS grants, object-store versions, and queued work. A database
> restore without the matching encryption/auth/event state is not accepted as
> recoverable."

Any operator, script, or approval that proposes restoring the database alone —
or any strict subset of the stores below — is out of policy and the restore is
refused.

---

## 1. Scope and boundary (what this runbook is NOT)

State these plainly so the document is honest about its limits:

1. **This runbook is a document. It executes nothing.** Actual production
   backup and restore are gated behind the **H8.1 `prod-backup` manual approval
   hold** and **Group G8B**, both of which are **OUTSIDE G6**. Nothing here
   authorizes touching production.
2. **G6 rehearses on SYNTHETIC fixtures only.** Restoring a *real* production
   snapshot into an isolated environment (production-snapshot rehearsal) is a
   LATER, separately-gated step that carries its own H-gate receipt. G6 does not
   perform it.
3. **Object-storage key migration is NOT part of G6 and NOT part of this backup
   procedure.** Re-keying existing objects to tenant-prefixed keys of the form
   `tenants/<tenantId>/instances/<instanceId>/...` is a later, separately-launched
   backfill pass. It appears in `LEGACY_MAPPING_DECISIONS.yaml` as
   `object_media_keys` / `tenant_rekey`. This runbook *references* it as that
   future pass and does **not** describe building it. Backup of the object store
   here means snapshotting versions/inventory as they exist, at whatever key
   layout is current.
4. **Tenant hard delete is disabled.** Per WISH "Backups and data safety", the
   tenant lifecycle ends at `archived` in this release. No restore procedure here
   assumes or reconstructs a hard-deleted tenant.

---

## 2. The four state stores (plus queued work) — inventory

Every backup cycle and every verified restore covers **all** of the following.
Missing any one of them fails the four-store recoverability rule.

| # | Store | What it holds | Backup artifact |
|---|-------|---------------|-----------------|
| 1 | Primary PostgreSQL DB | Tenant business data across the 38 Drizzle tables; the G2 `tenant_migration_ledger` (+ `tenant_migration_ledger_history`) | Consistent snapshot + WAL/LSN high-water mark |
| 2 | Auth-plane store (ADR-0003 isolated credential/auth plane) | `auth_credentials`, `platform_api_keys`, `tenant_key_lineage`, memberships | Snapshot of the isolated auth plane |
| 3 | Tenant encryption key **metadata** / KMS grants | Key metadata and grant references only — **NOT key material** | Redacted metadata export + grant reference list |
| 4 | Object-store versions / inventory | Bucket versioning state + inventory receipt at the current key layout | Versioning + inventory receipt |
| 5 | Queued work | NATS backlog, jobs (pg-boss), DLQ/retry state | Queue/backlog + DLQ state receipt |

Store 3 is metadata-and-grants only. Key material never leaves the KMS and never
appears in a backup artifact, receipt, log, or diff.

---

## 3. Redacted receipts only (non-negotiable)

Backup and restore produce **receipts that contain metadata only**: IDs,
prefixes, scopes, constraints, status, counts, checksums. Receipts **NEVER**
contain secret values, key material, or credential hashes.

This ties to WISH "Backups and data safety":

> "Export of legacy key metadata in redacted form (IDs/prefixes/scopes/
> constraints/status only)."
> "No secret values in logs, reports, diffs, or CI artifacts."

Allowed receipt fields follow `RELEASE_SLOS.yaml` →
`credential_custody.redacted_receipt_allowed_fields`:

- `credential_id`, `prefix`, `sha256_fragment`, `tenant_id`, `principal_id`,
  `role`, `scopes`, `constraints`, `created_at`, `expires_at`,
  `storage_paths_without_secret`.

Ceilings from `RELEASE_SLOS.yaml` that bound receipts and rehearsals:

- `security.secret_plaintext_occurrences_in_logs_traces_reports_ci_max: 0`
- `credential_custody.plaintext_in_api_logs_shell_history_git_ci_max: 0`
- `credential_custody.plaintext_file_mode: "0600"` for any transient plaintext,
  and `allowed_plaintext_destinations: exact_paths_named_in_identity_specific_approval_receipt_only`.

A receipt that would need to embed a secret to be meaningful is a design error;
redact the field or reference it by ID/checksum instead.

---

## 4. Pre-migration snapshot procedure (all four stores + queue)

Take the snapshots as a coordinated set. Record a common WAL/LSN high-water mark
and writer epoch so the set is mutually consistent.

**Checklist — snapshot capture (synthetic fixtures in G6):**

- [ ] 4.1 Freeze a coordination point: record the current WAL/LSN high-water
      mark and the current writer epoch. Every store's snapshot references this
      point.
- [ ] 4.2 **Store 1 — PostgreSQL:** take a consistent snapshot of the primary DB
      including `tenant_migration_ledger` and the append-only
      `tenant_migration_ledger_history`. Emit a receipt: per-table counts,
      checksums, snapshot ID, WAL/LSN.
- [ ] 4.3 **Store 2 — auth plane:** snapshot the ADR-0003 isolated auth-plane
      store (`auth_credentials`, `platform_api_keys`, `tenant_key_lineage`,
      memberships). Emit a redacted receipt: credential IDs, prefixes,
      `sha256_fragment`, scopes, constraints, status, counts — **no hashes, no
      secrets**.
- [ ] 4.4 **Store 3 — encryption key metadata / KMS grants:** export key
      metadata and grant *references* only. Emit a receipt of key IDs, grant
      IDs, scopes, status. **Never** export key material.
- [ ] 4.5 **Store 4 — object store:** capture bucket versioning state and an
      inventory receipt at the current key layout. Do **not** re-key; re-keying
      is the later `object_media_keys` / `tenant_rekey` backfill pass, out of
      scope here.
- [ ] 4.6 **Store 5 — queued work:** capture NATS backlog, pg-boss/jobs, and
      DLQ/retry state. Emit a receipt with subject/queue names, envelope
      versions, and counts.
- [ ] 4.7 Bundle all five receipts under one snapshot-set ID keyed to the
      WAL/LSN high-water mark from 4.1. A snapshot set missing any store is
      invalid and must not be promoted to "restorable".

---

## 5. Verified restore into an isolated environment

Per WISH **Release gate 1**: "Backup and isolated restore rehearsal completed
with receipts." A backup that has only been *taken* is not evidence. Every
backup must be **restored into an ISOLATED environment and verified**.

In G6 this rehearsal runs on **synthetic fixtures only**. The
production-snapshot rehearsal (restoring a real, redacted/restricted production
snapshot into a production-like isolated staging, per `RELEASE_SLOS.yaml` →
`workloads.baseline.environment`) is the later separately-gated H-gate step.

**Checklist — verified restore:**

- [ ] 5.1 Provision a fresh **isolated** environment with no network path to
      production data planes.
- [ ] 5.2 Restore **all four stores + queued work** from one snapshot-set ID
      (Section 4). Refuse to proceed if any store is absent — this is the
      four-store recoverability rule enforced at restore time.
- [ ] 5.3 Verify DB integrity: per-table counts and checksums match the capture
      receipt; `tenant_migration_ledger` and `_history` restored intact.
- [ ] 5.4 Verify auth-plane consistency: credentials/memberships/key-lineage
      resolve against restored tenants; no orphaned principals.
- [ ] 5.5 Verify key metadata/grants resolve and that encrypted DB/object data
      is decryptable under the restored grant references (proving stores 1–4 are
      mutually consistent — the core reason the DB cannot be restored alone).
- [ ] 5.6 Verify object-store versioning/inventory receipt matches; verify queue
      backlog/DLQ state replays under known envelope versions.
- [ ] 5.7 Emit an **isolated-restore rehearsal receipt** (metadata only) that
      satisfies `RELEASE_SLOS.yaml` →
      `release_evidence.restore_completeness_auth_key_object_queue_receipt` and
      `production_snapshot_restore_receipt`. Per policy
      `release_evidence.absent_or_unverifiable: fail`, a missing or
      unverifiable receipt is a release failure.

---

## 6. Secure rollback floor — accepted vs. refused

From WISH "Secure rollback floor" and ADR-0007.

### 6.1 Where the floor is, and why

> "The secure rollback floor begins immediately before the first production
> ownership/person/key rewrite or writer-fence transition that a pre-tenant
> build cannot interpret safely — not when a second tenant is created."

**Why this matters for restore choices:** *before* the floor, the schema changes
are additive and code dual-writes, so rollback is safe via the durable
inverse/write-ahead ledger — you can replay inverses and go back. *At and after*
the floor, ownership/person/key data has been rewritten into forms a pre-tenant
build cannot interpret. From that point, a naive "restore the old snapshot" or
"deploy the old binary" silently destroys or misreads post-floor data.

### 6.2 ACCEPTED rollbacks after the floor

1. Previous **multitenant-capable** build.
2. **Feature-disabled but tenant-safe** build that retains predicates/RLS.
3. **Maintenance / read-only mode** while the system rolls forward, OR while
   executing a **ledger-backed, explicitly-approved compensation**.

### 6.3 REFUSED — NOT accepted rollback

1. **Disabling RLS.**
2. **Restoring only the pre-migration snapshot while discarding post-snapshot
   writes.**
3. **Deploying a pre-tenant build.**

> "Disabling RLS, restoring only the pre-migration snapshot while discarding
> post-snapshot writes, or deploying a pre-tenant build is not an accepted
> rollback." — WISH / ADR-0007.

Note the interaction with Section 3's headline rule: even a *pre-migration
snapshot restore that is otherwise complete across all four stores* is still a
**refused rollback** once the floor has been crossed, because it discards
post-snapshot writes. Completeness across stores is necessary for any restore;
it does not by itself make a post-floor snapshot-restore an accepted rollback.

---

## 7. How the G6 ledger participates in rollback / compensation

The `tenant_migration_ledger` (migration **0041**, delivered in G2, hardened in
G6) is the durable spine of pre-floor rollback and post-floor compensation.

Per WISH "Backfill and reconciliation", the ledger records, per source row:

- source PK and tenant ID + rule applied;
- a **pre-image + checksum** (and post-image/checksum);
- an **inverse OR compensating action**;
- the **WAL/LSN high-water mark**;
- the **writer epoch**;
- **status**.

> "No person/key rewrite begins until its inverse/write-ahead ledger entry is
> durable." — WISH.

An append-only **`tenant_migration_ledger_history`** table captures the
immutable trail of ledger state transitions. Both tables are part of Store 1 and
must be included in every DB snapshot (Section 4.2) and verified on restore
(Section 5.3).

**Ledger-backed compensation (the accepted post-floor path 6.2.3):**

1. Enter maintenance/read-only mode under an explicit, unexpired approval
   receipt (Section 8).
2. Select ledger entries to reverse by writer epoch and WAL/LSN window.
3. Replay the recorded **inverses / compensating actions** in order, checking
   each pre-image checksum before applying.
4. Append every reversal to `tenant_migration_ledger_history`.
5. Reconcile to a proven-zero-gap state before resuming, matching the
   ownership-write-fence discipline (WISH state 4 "Fenced transformation").

This is what makes post-floor recovery *forward-and-compensate* rather than
*restore-and-discard*: the ledger, not an old snapshot, is the source of truth
for undoing a rewrite.

---

## 8. Approval and gate references (informational — not authority)

This runbook confers no approval. Any real execution requires the distinct,
unexpired manual approval receipts defined in WISH and `RELEASE_SLOS.yaml`.

- Production backup/restore: **H8.1 `prod-backup` hold** + **Group G8B** (outside
  G6).
- Approval receipts are **immutable, single-use**, `maximum_validity_hours: 24`
  (`RELEASE_SLOS.yaml` → `approval_receipts`).
- Normal production approver rule: one explicit approval from either Felipe Rosa
  or Leonardo Cintra (BR). Break-glass requires explicit dual approval from both.
- Task-materialization approval is **never** a production approval
  (`task_materialization_approval_is_production_approval: false`).
- Relevant release evidence that these procedures feed
  (`RELEASE_SLOS.yaml` → `release_evidence.required`):
  `production_snapshot_restore_receipt`,
  `restore_completeness_auth_key_object_queue_receipt`,
  `writer_fence_and_wal_lsn_receipt`,
  `backfill_compensation_and_reconciliation_receipt`,
  `credential_custody_report`. Policy:
  `absent_or_unverifiable: fail`.

---

## 9. Operator quick checklist

- [ ] All FOUR stores + queued work captured under one snapshot-set ID.
- [ ] Snapshot set keyed to a common WAL/LSN high-water mark + writer epoch.
- [ ] Restore rehearsed into an **isolated** environment and **verified**
      (counts, checksums, decryptability, queue replay).
- [ ] Receipts are metadata-only; zero secret/key/hash values anywhere.
- [ ] Ledger + `tenant_migration_ledger_history` included and verified.
- [ ] Rollback intent classified against Section 6 (accepted vs. refused).
- [ ] No production action taken without the matching H8.1 / G8B approval
      receipt.
- [ ] Object re-keying NOT performed here (deferred `tenant_rekey` pass).
- [ ] No tenant hard delete (lifecycle ends at `archived`).

---

*End of runbook. Document only; non-executable. Sources: WISH.md ("Backups and
data safety", "Secure rollback floor", "Release gates", "Backfill and
reconciliation", "Mixed-version compatibility state machine"); ADR-0007;
RELEASE_SLOS.yaml; LEGACY_MAPPING_DECISIONS.yaml (`object_media_keys` /
`tenant_rekey`).*
