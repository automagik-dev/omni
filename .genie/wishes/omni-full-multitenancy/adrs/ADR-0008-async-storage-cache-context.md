<!-- adr_topic: async_storage_cache_context -->
# ADR-0008 — Async, storage, and cache tenant context

- Status: proposed (G0 gate)

## Context
Async work is NATS/JetStream plus DB-backed job tables (batch_jobs, sync_jobs,
dead_letter_events, processed_events, consumer_offsets) — there is no pg-boss. Media uses
S3/MinIO + local backends. Caches/rate/debounce/session state are keyed by resource UUID.

## Decision
- All NATS/JetStream envelopes carry trusted `tenantId`; subject strategy is tenant-aware or consumers validate envelope tenant before processing. Publishers derive tenant from authenticated/loaded resources, never caller claims.
- Jobs, retries, dead letters, idempotency keys, consumer state, and callbacks preserve tenant context. Missing/ambiguous tenant → quarantine/DLQ + alert; no global processing fallback.
- Object keys use a tenant prefix (`tenants/<tenantId>/instances/<instanceId>/...`). Presigned URLs bind tenant/object/expiry/decision; TTL ≤ 60s; no issue/refresh after revocation.
- Cache keys, rate-limit buckets, debounce buffers, search indexes, exports, and pagination cursors include tenant identity.
- WebSocket/SSE subscriptions, in-memory channel/plugin registries, callback tokens, and long-lived connection state are keyed and authorized by tenant, not only by resource UUID.
- Channel/provider/webhook credentials and session secrets are non-exportable by default and encrypted with tenant-bound context; plaintext never appears in responses, logs, caches, migration receipts, or object metadata.
- Audit logs/traces include tenant ID and actor credential ID; metrics avoid unbounded tenant labels.

## Consequences
- G5 converts NATS/workers/jobs/DLQ/idempotency, media/object storage, cache/rate/debounce/search namespaces, streaming privacy, and revocation propagation.

## Preserves
WISH "Async and storage enforcement"; Success Criterion 11; QA async/storage tests.
