# Provisional Tenant Ownership Matrix

**Source:** `origin/dev` at `739fd49f1cd31de759664c0dcd266f71c868e338`
**Inventory result:** `packages/db/src/schema.ts` contains 38 `pgTable` declarations and zero `tenant_id` columns.
**Status:** Architecture input; G0 must validate every row and locate tables created outside Drizzle (including pg-boss/internal schemas) before migrations are generated.

## Classification rules

- **Tenant table:** non-null `tenant_id`, RLS, tenant-aware unique indexes, and composite tenant foreign keys.
- **Platform table:** unreachable by tenant runtime roles/routes; accessed only through explicit platform administration or internal infrastructure code.
- **Split:** replace a mixed global/tenant concept with separate platform and tenant tables rather than nullable ownership.
- Denormalized `tenant_id` is intentional on child tables so RLS, indexes, object ownership, and joins are fail-closed without depending on an unscoped parent lookup.

## Current Drizzle tables

| Current table | Proposed owner | Required relationship / migration note |
|---|---|---|
| `agent_providers` | Tenant, with platform catalog split | Tenant provider credentials/config gain `tenant_id`; immutable built-in provider definitions move to a non-secret platform catalog. |
| `agents` | Tenant | Add non-null `tenant_id`; names/aliases unique per tenant, not globally. |
| `agent_routes` | Tenant | Add `tenant_id`; composite FKs ensure route, agent, provider, instance/chat selectors share a tenant. |
| `agent_sessions` | Tenant | Add `tenant_id`; session lookups and cleanup always include tenant. |
| `api_keys` | Split/auth control plane | Replace with a platform-owned credential authentication index (hash/subject → class, tenant, principal, status, role/ceiling) plus tenant-visible same-tenant key metadata/lineage. Authentication must resolve tenant before tenant RLS starts; tenant routes can never list the global index. Platform credentials remain a separate class/store. Legacy `instance_ids` becomes transitional only. |
| `api_key_audit_logs` | Split/append-only | Tenant key audit rows carry `tenant_id`; platform-key actions go to platform audit storage with target tenant and reason. |
| `instances` | Tenant root | Add non-null `tenant_id`; names/default constraints become tenant-local; all channel credentials and session state belong to the tenant. |
| `persons` | Tenant | Add non-null `tenant_id`; cross-tenant person merging is forbidden. Clone ambiguous legacy persons per tenant. |
| `platform_identities` | Tenant | Add `tenant_id`; composite FK to person/instance; uniqueness includes tenant. |
| `conversations` | Tenant | Add `tenant_id`; cross-channel continuity exists only inside one tenant. |
| `chats` | Tenant | Add `tenant_id`; composite FK to instance/conversation; external/canonical IDs unique in tenant/instance scope. |
| `chat_participants` | Tenant | Add `tenant_id`; composite FKs to chat/person/platform identity. |
| `omni_groups` | Tenant | Add `tenant_id`; group IDs are unique only inside the owning instance/tenant. |
| `messages` | Tenant | Add `tenant_id`; composite FK to chat and tenant-aware external ID indexes. |
| `omni_events` | Tenant | Add `tenant_id`; event ingestion derives tenant from trusted instance/context, never payload claims. |
| `handoff_logs` | Tenant | Add `tenant_id`; direct UUID route and list/aggregate queries become tenant-scoped. |
| `close_contact_logs` | Tenant | Add `tenant_id`; composite chat/instance constraints. |
| `access_rules` | Tenant | Add `tenant_id`; instance-scoped and tenant-wide rules are explicit, never global by `instance_id IS NULL`. |
| `global_settings` | Split | Rename/split into `platform_settings` and `tenant_settings`; normal tenant runtime cannot see platform settings. |
| `setting_change_history` | Split/append-only | Separate tenant and platform histories or carry explicit owner class; tenant history has RLS. |
| `batch_jobs` | Tenant | Add `tenant_id`; job payload, status, retry, and cancellation are tenant-scoped. |
| `sync_jobs` | Tenant | Add `tenant_id`; composite FK to instance; status UUID route includes tenant. |
| `media_content` | Tenant | Add `tenant_id`; message/storage keys and presigned URL checks include tenant. |
| `chat_id_mappings` | Tenant | Add `tenant_id`; aliases cannot resolve across tenants. |
| `plugin_storage` | Tenant by default, platform split if required | Add tenant namespace and RLS for plugin state; platform plugin state uses a separate table/schema. No mixed keyspace. |
| `dead_letter_events` | Tenant | Add `tenant_id`; retries rehydrate tenant context and cannot be executed without it. |
| `payload_storage_config` | Split | Platform backend configuration is platform-owned; tenant overrides/quotas use a distinct tenant table. Secrets remain encrypted/isolated. |
| `event_payloads` | Tenant | Add `tenant_id`; payload retrieval and retention are tenant-scoped. |
| `webhook_sources` | Tenant | Add `tenant_id`; source secrets, replay, validation, and test delivery remain inside tenant. |
| `automations` | Tenant | Add `tenant_id`; triggers/actions may reference only same-tenant resources. |
| `automation_logs` | Tenant | Add `tenant_id`; composite FK to automation/event. |
| `consumer_offsets` | Platform infrastructure | Keep outside tenant-facing data access. Consumer identity/subject design must prevent one tenant consumer from advancing another tenant's cursor. If consumers are per tenant, create a tenant-specific offset table rather than mixing. |
| `trigger_logs` | Tenant | Add `tenant_id`; direct reads and cost/usage aggregates are tenant-scoped. |
| `agent_tasks` | Tenant | Add `tenant_id`; task callbacks/tokens are tenant-bound. |
| `turns` | Tenant | Add `tenant_id`; close/reopen and lookup paths validate same tenant/instance/chat. |
| `chat_follow_up_state` | Tenant | Add `tenant_id`; agent/instance/chat precedence cannot cross tenant. |
| `processed_events` | Tenant | Add `tenant_id` to the idempotency key/primary key so one tenant cannot suppress another tenant's event. |
| `genie_hosts` | Platform trust | Keep outside tenant runtime and tenant-admin scopes in the first release. A future tenant-host registry must be a separate tenant-owned table. |

## New ownership/control tables

| New table / concept | Owner | Purpose |
|---|---|---|
| `tenants` | Platform control plane | Tenant ID, slug, display name, lifecycle status, policy/quota reference, timestamps. |
| `principals` | Platform identity plane | Stable human/service subject; contains no tenant-owned business data. |
| `tenant_memberships` | Tenant relation | Principal↔tenant role, status, invited/created metadata; unique per principal+tenant. |
| `tenant_role_bindings` or fixed role registry | Tenant relation/platform policy | `tenant-owner`, `tenant-admin`, `tenant-operator`, `tenant-viewer`; scopes are bounded by platform policy. |
| `platform_api_keys` | Platform control plane | Break-glass/automation credentials kept separate from tenant-key query paths and normal tenant RLS context. |
| `auth_credentials` (or isolated auth service/index) | Platform authentication plane | Minimal hash/subject lookup needed to establish immutable credential class, tenant, principal, status, role, and ceiling before opening a tenant transaction; inaccessible to tenant data routes. |
| `tenant_key_lineage` (or equivalent) | Tenant | Parent/root/depth, revocation propagation, immutable ceiling snapshot, creator principal/key. |
| `tenant_settings` | Tenant | Replaces tenant-facing uses of `global_settings`. |
| `platform_settings` | Platform | Runtime-wide values, inaccessible to tenant keys. |
| `tenant_usage_ledger` | Tenant | Quota/rate/budget accounting without cross-tenant aggregates in tenant APIs. |
| `tenant_migration_ledger` | Platform migration plane | Source row→tenant mapping, decision, pre/post image and checksums, inverse/compensating action, writer epoch, WAL/LSN high-water mark, ambiguity/quarantine status, reconciliation receipt. |

## Non-Drizzle boundaries that G0 must inventory

- pg-boss schemas/tables, schedules, queues, retries, and payloads
- NATS/JetStream streams, subjects, durable names, dead-letter flow, and replay tooling
- local filesystem session/auth state and remote S3/MinIO object keys
- Redis/in-memory caches, debounce buffers, idempotency caches, and rate limiters
- OpenTelemetry/log/audit sinks and cardinality/privacy policy
- CLI local state, key receipts, and host trust sentinels
- Helm/Kubernetes secrets, service accounts, backup/restore jobs, and migration roles
- SDK/OpenAPI-generated clients, webhook callbacks, streaming endpoints, and admin UI/BFF contracts
- tenant-controlled outbound integrations: automation URLs/headers, webhook-provider delivery, callbacks, provider `baseUrl`, DNS/redirect handling, proxy/network policy, and egress audit
- revocation-bearing capabilities: auth caches, WebSocket/SSE/channel/provider sessions, queued/retried/DLQ jobs, already-dequeued/in-flight multi-effect work, callback tokens, and presigned URLs
- approval authority/receipts: isolated authenticated signer service, trusted signer registry/revocation epoch, append-only event log, executor read/atomic-consume capability, evidence bundles, writer-fence state, WAL/LSN markers, and restore/compensation ledgers

## G0 exit gate

The implementation may not add the first `tenant_id` migration until reviewers approve a machine-readable ownership manifest covering every table, route, event, job, object prefix, cache namespace, and credential class, with an explicit `tenant`, `platform`, `split`, or `quarantine` disposition.
