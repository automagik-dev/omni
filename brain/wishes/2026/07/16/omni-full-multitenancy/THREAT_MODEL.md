---
wish: omni-full-multitenancy
group: G0
status: normative-draft-requires-g0-human-security-approval
source_base_commit: d6c400d05287bbf436ecd7e28c56c845b893afc9
---

# G0 Security Threat Model — Omni Full Multitenancy

Scope: logical tenant isolation across DB, API, workers, event bus, storage, cache,
credentials, and outbound egress at the materialization base. Each threat carries a
stable `category:` tag consumed by `validate-g0.mjs`. Mitigations name the enforcing
group (G1–G8x) and the release gate. This model preserves every locked WISH decision
and the H8/H9 receipt gates; it does not authorize any production action.

Trust-boundary summary: authentication runs in an isolated auth plane BEFORE tenant
context exists; the tenant data plane runs only inside `withTenantTransaction` on a
`NOBYPASSRLS` role with `FORCE RLS`; platform/control-plane actions use separate
credentials/routes; all tenant egress crosses one audited default-deny broker.

---

### T01 — Direct and indirect IDOR
- category: idor
- Assets: every `/:id` route and indirect UUID (messages, persons, handoffs, dead letters, turns, media, access rules, jobs, agent tasks, automations, chat participants, event payloads).
- Attack: tenant A supplies tenant B UUID/external ID directly, or indirectly via message edit/reaction/forward/transcription, chat participants, person timeline, event payload, job redrive.
- Current exposure: route guards + allowlists only (scope-enforcer.ts:243-320,372-501); no ownership for indirect UUIDs or global collections.
- Mitigation: non-null `tenant_id` + composite FKs + `FORCE RLS` (G2/G3); tenant predicate before pagination/count/aggregate (G4). Unknown/cross-tenant IDs return non-enumerating 404/empty.
- Verify: direct UUID cross-tenant tests for every `/:id`; indirect-surface matrix; list/search/count/export pre-filter tests (G7).

### T02 — Confused deputy (server acts on attacker-chosen tenant)
- category: confused_deputy
- Attack: caller-supplied header/body/path or `person.metadata.tenantId` steers a privileged server action to another tenant.
- Current exposure: `OmniCustomerContext.tenantId` -> `OMNI_TENANT_ID` derives from untrusted person metadata (types.ts:377; execution-context.ts:75; agent-dispatcher.ts:1746).
- Mitigation: tenant context is immutable and derived from authenticated credential/membership only; caller values are advisory at most and must match a validated membership; the caller-adjacent field is quarantined+renamed (G1/G3).
- Verify: header/body/path tenant-confusion tests; forged `person.metadata.tenantId` cannot cross a boundary (G7).

### T03 — Auth bootstrap / global credential index exposure
- category: auth_bootstrap
- Attack: tenant route enumerates the global credential/hash index, or child-key creation reaches global tables directly, bypassing ceilings.
- Current exposure: `api_keys` mixes auth index + tenant metadata + `['*']` scopes (schema.ts:529-601).
- Mitigation: isolated platform auth index/service returns only immutable context (class/tenant/principal/status/role/ceiling); tenant routes cannot enumerate it; child-key writes cross into the auth plane through a transactional service/procedure (G1/G3).
- Verify: auth-bootstrap tests prove no tenant-route enumeration and transactional ceiling enforcement (G7).

### T04 — Key/role escalation and delegation abuse
- category: key_escalation
- Attack: tenant admin mints platform `*`, selects another tenant, or a child key widens scope/expiry/limits or changes tenant.
- Current exposure: mint enforces only a scope-subset ceiling (keys.ts:188-284); no immutable tenant-lineage ceiling.
- Mitigation: child `tenant_id` == parent and immutable; child scopes/constraints/expiry/limits subset of parent+tenant ceiling; lineage stored; ancestor revocation propagates; tenant admins never mint `*` (G1).
- Verify: delegation/role/scope/constraint/expiry/revocation escalation tests (G7).

### T05 — Pooled-connection context leakage
- category: pooled_context_leakage
- Attack: transaction-local tenant setting survives on a pooled postgres.js connection and bleeds into another request/tenant.
- Mitigation: `set_config('app.tenant_id', ..., true)` transaction-local only; no session-level `SET`; every request/job wrapped in `withTenantTransaction`; context reset verified on reuse (G3).
- Verify: real-PostgreSQL pool-reuse tests prove context never survives the transaction (G7).

### T06 — RLS bypass / missing predicate
- category: rls_bypass
- Attack: a missed application predicate, table-owner privilege, or `row_security=off` exposes cross-tenant rows.
- Mitigation: `ENABLE` + `FORCE ROW LEVEL SECURITY`; `WITH CHECK` on insert/update; runtime role `NOBYPASSRLS NOSUPERUSER`; runtime cannot alter policies, `SET ROLE`, disable row security, or exploit `PUBLIC`/`search_path`/`SECURITY DEFINER` (G3).
- Verify: SQL policy tests confirm ENABLE+FORCE and `rolbypassrls=false`, `rolsuper=false`; owner cannot bypass FORCE (G7).

### T07 — Direct/singleton DB access outside the tenant boundary
- category: direct_db_access
- Attack: a route/service/worker uses a singleton or raw connection that skips the tenant transaction, evading RLS context.
- Mitigation: architectural/static guards reject direct singleton/raw DB access outside the approved tenant transaction/repository boundary (G3).
- Verify: architecture check fails on direct DB access from tenant routes/services/workers (G7).

### T08 — Async replay / cross-tenant dispatch
- category: async_replay
- Attack: a NATS event or job replays/retries and dispatches against another tenant, or a producer lies about tenant.
- Current exposure: NATS subjects are shared; publishers must derive tenant from trusted resources.
- Mitigation: versioned tenant-aware envelopes; producer derives tenant from loaded resource; consumer validates before processing; retries/DLQ/idempotency preserve tenant; idempotency key includes tenant (G5).
- Verify: tenant A event cannot dispatch tenant B; replay/retry keeps tenant; producer lying about tenant is rejected/deterministically mapped (G7).

### T09 — DLQ / backlog poison paths
- category: dlq_backlog_poison
- Attack: a tenantless or malformed backlog item loops, or is globally processed, or a legacy envelope version is misinterpreted.
- Mitigation: missing/ambiguous tenant -> quarantine/DLQ + alert; consumers dual-read known versions and reject unknown/missing tenant; no global fallback; redrive revalidates tenant + revocation (G5).
- Verify: tenantless event quarantined; unknown envelope rejected; duplicate/out-of-order handled without poison loop (G7).

### T10 — Storage / media leakage
- category: storage_media_leakage
- Attack: tenant A fetches tenant B object via guessed key, stale signed URL, cache hit, redirect, or proxy route.
- Mitigation: tenant-prefixed object keys; presigned URL binds tenant/object/expiry/decision, TTL <= 60s; cache keyed by tenant; media re-keyed under tenant prefix on backfill (G5).
- Verify: guessed key/stale URL/cache/redirect cannot fetch cross-tenant media (G7).

### T11 — Callback / presigned capability leakage
- category: callback_presigned_capability
- Attack: an agent-task callback token or presigned URL is reused across tenants or after revocation.
- Mitigation: callback tokens tenant-bound and revalidated at use against the current revocation epoch; presigned URLs not issued/refreshed after revocation; 60s ceiling (G5).
- Verify: callback token cannot act cross-tenant or post-revocation; presigned URL never exceeds ceiling (G7).

### T12 — Tenant-controlled SSRF / DNS rebinding
- category: ssrf_dns_rebinding
- Attack: tenant automation URL, webhook-provider, provider `baseUrl`, or callback targets loopback/RFC1918/link-local/metadata/control-plane, or uses DNS rebinding / alternate IP encodings / IPv4-mapped IPv6 / credential-bearing URLs / redirects.
- Current exposure: automation webhook does a raw `fetch` on a tenant-templated URL with NO guard (actions.ts:132,141); provider clients fetch tenant `baseUrl`; only media has a partial guard (safe-media-fetch.ts) with an `OMNI_MEDIA_URL_GUARD=off` escape hatch.
- Mitigation: one audited default-deny egress broker for ALL tenant egress; direct fetch/socket blocked by architecture check + network policy; DNS re-resolved and revalidated every redirect hop; ambient platform credentials/cookies/proxy/cloud-identity headers never attached; bounded timeouts/redirects/body size (G5).
- Verify: egress tests cover automation URLs/headers, webhook-provider, provider baseUrl, callbacks, redirects, DNS rebinding, alternate IP encodings, IPv4-mapped IPv6, metadata/control-plane/private destinations, oversized responses, timeouts, and direct-network bypass (G7).

### T13 — Revocation after dequeue / mid-effect
- category: revocation_after_dequeue
- Attack: work authorized at enqueue is revoked before its next side effect but still executes; a long-lived session survives revocation.
- Mitigation: revalidate revocation epoch at dequeue/redrive, immediately before every external/durable side effect, and between multi-effect steps; cancel/deny within 30s; sessions terminate <= 30s; auth caches invalidate <= 15s (G5), per `RELEASE_SLOS.yaml`.
- Verify: revoke-after-dequeue and revoke-between-first-and-second-side-effect tests prove cancellation/denial within 30s (G7).

### T14 — Mixed-version races
- category: mixed_version_races
- Attack: an old pod/worker/producer without tenant awareness races an ownership transform or runs after cutover, writing unowned/cross-tenant state.
- Mitigation: machine-checkable schema/binary/event/writer epochs; fleet-compatible drain of old producers; deployment/startup refuses unsafe combinations; `FORCE RLS` only after states 1–4 pass; no second tenant before secure state (G8A state machine).
- Verify: rolling-upgrade matrix exercises every epoch combination, old-producer drain, startup refusal (G8A).

### T15 — Rollback reopening global access
- category: rollback_global_reopen
- Attack: rolling back to a pre-tenant build, disabling RLS, or restoring only the pre-migration snapshot reopens global-query behavior.
- Mitigation: secure rollback floor before the first incompatible ownership/person/key rewrite; accepted rollbacks are previous multitenant build, feature-disabled-but-tenant-safe build, or maintenance/read-only with ledger-backed compensation. Disabling RLS or deploying a pre-tenant build is NOT accepted (G8x).
- Verify: secure rollback rehearsal proves protections stay on (G8A).

### T16 — Restore mismatch
- category: restore_mismatch
- Attack: a DB restore without matching encryption-key/auth-plane/event/object-store state yields a partially-recoverable or inconsistent system.
- Mitigation: backup/restore rehearsals include the auth-plane store, tenant encryption key metadata/KMS grants, object-store versions, and queued work; a DB-only restore is not accepted as recoverable (G8B).
- Verify: production-snapshot restore rehearsal with per-table counts/checksums and person/key ambiguity cases (G8A/G8B).

### T17 — Approval receipt forgery / replay
- category: approval_receipt_forgery
- Attack: a forged/tampered/expired/reused/executor-authored receipt authorizes a production hold, or concurrent launchers consume one receipt.
- Mitigation: isolated append-only Ed25519 approval authority; executors have read/consume only; atomic compare-and-consume immediately before mutation; exactly one consumer wins; single-use, digest/epoch/audience/policy-bound receipts (H8.1–H9.2, G7 launcher guard). All fail-closed conditions in `RELEASE_SLOS.yaml`.
- Verify: forged approver, canonical tampering, wrong audience/policy, revoked signer, executor-issued, stale event, concurrent replay all fail closed; exactly one compare-and-consume wins (G7).

### T18 — Shared-runtime compromise (RESIDUAL — requires human acceptance)
- category: shared_runtime_compromise
- Attack: a full RCE in the single shared Omni runtime process can legitimately open a tenant transaction for ANY tenant; logical RLS isolation does not contain a compromised runtime.
- Residual risk: ACCEPTED-PENDING-HUMAN-SIGN-OFF. RLS limits blast radius of query bugs/IDOR but is not hard containment against runtime RCE.
- Required acceptance: the G0 human/security gate must explicitly accept this residual, OR the architecture escalates to per-tenant service/database credentials or stronger physical isolation before implementation (WISH Success Criterion 17; ADR-0010).
- Verify: gate records an explicit, dated human/security acceptance of the shared-runtime residual; any stronger containment requirement is implemented, not implied.

---

## Locked-decision preservation

- H8.1–H9.2 remain non-executable holds; each production mutation needs a distinct canonical Ed25519 receipt atomically compare-and-consumed (unchanged).
- `RELEASE_SLOS.yaml` numeric ceilings are normative and fail-closed; missing measurement = failure.
- Tenant hard delete stays disabled; lifecycle ends at archived.
- No caller-supplied value ever establishes tenant authority.
- This threat model authorizes no production action and creates no production/hold task.
