# WISH: Enterprise Compliance & Transform Actions

> Extend the automation engine with transform action types (blocks) to unify scattered processing logic, and add compliance foundations for GDPR + SOC 2 certification.

**Status:** DRAFT
**Created:** 2026-02-07
**Author:** WISH Agent (with Felipe + Cezar input, 2 council rounds)
**Beads:** omni-dq9

---

## Background & Problem Statement

### The Starting Point

Felipe identified that Omni v2, as an enterprise omnichannel messaging gateway, needs to pass real compliance certifications to sell to enterprise customers. The specific certifications evaluated were:

| Certification | Decision | Rationale |
|---------------|----------|-----------|
| **GDPR** | **Mandatory** | We handle PII (phone numbers, names, message content). Any EU customer = GDPR applies. |
| **SOC 2 Type II** | **Target** | The #1 gatekeeper question enterprise buyers ask. |
| ISO 27001 | Skip for now | Expensive ($30-50k+). SOC 2 covers 80% of the same ground. |
| PCI DSS | Skip for now | No card processing yet. Architecture should make it easy to add. |
| ISO 27701 | Skip | Extension to ISO 27001. Moot if we skip 27001. |

### What Exists Today

Two previous wishes shipped partial security features:

**api-key-security** (DONE): API key expiration, revocation, scoped access, instance-level restrictions. All acceptance criteria pass.

**api-key-audit** (60% DONE): Audit logging per API request (fire-and-forget), IP tracking, paginated audit endpoint. Missing: tamper-proof integrity, retention policy, stats endpoint.

### What's Broken / Missing

1. **Scattered processing logic.** Audio transcription, image description, prompt injection scanning, and agent output validation are all hardcoded in separate plugins (`media-processor.ts`, `agent-responder.ts`). They can't be reordered, conditionally enabled, or composed into custom pipelines.

2. **No compliance-grade audit trail.** Current audit logging is fire-and-forget — errors silently fail, logs aren't tamper-proof (no hash chain), no retention policy. SOC 2 requires immutable, verifiable audit records.

3. **No GDPR data subject rights.** No endpoint for right-to-deletion (Art. 17) or data export/SAR (Art. 15). These are legal requirements, not nice-to-haves.

4. **Bot tokens stored in plaintext.** Discord, Telegram, WhatsApp Cloud tokens are stored unencrypted in the `instances` table. SOC 2 and basic security hygiene require encryption at rest.

5. **No way to add compliance processing to the message pipeline.** If an enterprise customer needs PII redaction before messages hit storage (GDPR strict mode), or credit card scrubbing before messages reach an agent (future PCI DSS), there's no mechanism to plug that in.

### Felipe's Vision: Pipeline Blocks as Legos

> "I want to be able to build these types of blocks — PII redaction, transcription, prompt injection — and place them anywhere in the pipeline. The same block that redacts PII can be placed pre-store for GDPR strict, or post-store for moderate mode. Like legos."
>
> "We ALREADY HAVE some of this foundation. An input is scanned for prompt injection before moving forward to the agent. The agent output can be checked again. These should be reusable blocks."
>
> "If we have control over the omni pipeline, we will be able to steer into multiple enterprise use cases without developing too much extra code."

---

## Approaches Explored

### Approach 1: Separate Pipeline Block System (REJECTED)

**What it was:** A new `PipelineBlock` interface with 5 phases (`pre-store`, `post-store`, `pre-agent`, `post-agent`, `pre-send`), a block registry, a block runner as a separate NATS subscriber, and a `instance_block_config` DB table.

**Why rejected:**
- Creates a third execution system alongside plugins and automations
- Duplicates infrastructure the automation engine already has (conditions, debounce, queues, logging, variable chaining)
- Over-engineered: phases, priorities, dependency graphs, block types — too many concepts
- First council round (6 members) voted unanimously to MODIFY toward simplification

### Approach 2: Blocks as Layer on Top of Plugins (REJECTED)

**What it was:** Keep infrastructure plugins (message-persistence, event-persistence) as Layer 1. Add a "block runner" as Layer 2. Keep automations as Layer 3.

**Why rejected:**
- Still creates a new system (the block runner)
- Cezar's question: "How aligned is this with actions? How much does it make sense to just extend actions?"
- Analysis showed that automation actions already have sequential execution, variable chaining (`responseAs`), condition filtering, per-instance queues, and execution logging

### Approach 3: Blocks = New Action Types in Automation Engine (APPROVED)

**What it is:** Transform actions (`transcribe`, `pii_redact`, `describe_image`, `prompt_guard`) are new action types in the existing automation engine, alongside `webhook`, `send_message`, `emit_event`, `log`, `call_agent`.

**Why approved:**
- Zero new systems — 3 files modified, 0 files created (for core infra)
- Variable chaining (`responseAs`) IS the pipeline — action A's output feeds action B
- Conditions ARE `shouldRun()` — filter by event payload fields
- Execution logging IS the audit trail — per-action status, duration, result
- Per-instance queues and backpressure already work
- Dry-run (`testAutomation`) already works
- Second council round (5 members) voted unanimously APPROVE

---

## Decisions Locked

- **DEC-1:** Target GDPR + SOC 2 Type II. Skip ISO 27001, PCI DSS, ISO 27701.
- **DEC-2:** Deployment model is self-hosted, single instance.
- **DEC-3:** Blocks are action types within the automation engine, not a separate system.
- **DEC-4:** First transform action to extract: `transcribe` (from `media-processor.ts`).
- **DEC-5:** Built-in blocks ship as code (TypeScript action executors). Users configure placement via automation CRUD (DB config).
- **DEC-6:** Ship default "system" automations that replicate current hardcoded behavior. Add `system` boolean to automations table — system automations cannot be deleted or disabled via API.
- **DEC-7:** Keep `media-processor.ts` plugin running during migration period. Remove once all functions are action types.
- **DEC-8:** Audit trail upgraded to compliance-grade: hash chain (SHA-256) + sequence counter for tamper detection.
- **DEC-9:** GDPR endpoints: right-to-deletion anonymizes data, data export returns JSON.
- **DEC-10:** Bot token encryption uses AES-256-GCM with per-row IV, key from `OMNI_ENCRYPTION_KEY` env var.

## Assumptions

- **ASM-1:** The existing automation engine's `executeActions()` sequential model is sufficient for transform chaining. No parallel transform execution needed.
- **ASM-2:** Transcription taking 1-5s in a sequential action chain is acceptable when the user explicitly chains it (e.g., transcribe -> call agent). Users control this.
- **ASM-3:** The `system` flag on automations is sufficient protection for compliance-critical automations (vs. a more complex RBAC system).
- **ASM-4:** Single-instance deployment means in-memory state (queues, debounce) is acceptable — no distributed coordination needed.

## Risks

- **RISK-1:** Migration — upgrading Omni without seed automations would break transcription. **Mitigation:** DB seed script creates default system automations on first run / migration.
- **RISK-2:** Action executor ordering matters for compliance (PII redact must come before agent call in GDPR strict). **Mitigation:** Documented in automation templates; validated by tests.
- **RISK-3:** `media-processor.ts` and `transcribe` action could both process the same audio during migration period. **Mitigation:** Transcribe action checks if transcription already exists (idempotent). Or disable media-processor per-instance when automation is active.

---

## Scope

### IN SCOPE

**Transform Actions (Blocks):**
- Extend automation engine with transform action types
- Add `services` to `ActionDependencies` for DB/service access
- Add `system` boolean to automations table
- Implement `transcribe` action type (extract from `media-processor.ts`)
- Implement `describe_image` action type (extract from `media-processor.ts`)
- Ship default system automations (auto-transcribe, auto-describe)
- DB seed/migration for default automations

**Compliance — Audit Trail:**
- Upgrade `AuditService.log()` from fire-and-forget to compliance-grade
- Add `integrityHash` (SHA-256 chain) and `sequence` columns to `api_key_audit_logs`
- Add audit log retention job (90-day default, configurable)
- Archive to compressed JSONL before deletion

**Compliance — GDPR:**
- `DELETE /api/v2/persons/:id/data` — right to deletion (anonymize person, redact messages, preserve audit trail)
- `GET /api/v2/persons/:id/export` — data export (JSON: person + messages + identities)

**Compliance — Encryption:**
- `packages/core/src/crypto/field-encryption.ts` — AES-256-GCM field-level encryption
- Encrypt bot tokens at rest in `instances` table
- Migration script for existing plaintext tokens

### OUT OF SCOPE

- PII redaction action type (Phase 2 — needs this infrastructure first)
- Prompt guard / output validation action types (Phase 2)
- Content filter action type (Phase 2)
- Audit stats endpoint (`GET /keys/:id/audit/stats`) — build with dashboard later
- Per-key rate limit enforcement — wire when needed
- `halt`/stop pipeline capability — defer until PII block needs it
- Automation templates CLI (`omni automations templates`) — nice-to-have, later
- Block config UI — Phase 2
- ISO 27001 / PCI DSS certification prep
- Multi-tenant isolation
- Real-time anomaly detection

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| core | [x] types, [x] automations, [x] crypto | New action types, field encryption |
| db | [x] schema, [x] migrations, [x] seeds | `system` on automations, audit columns, token encryption |
| api | [x] routes, [x] services, [x] plugins | GDPR endpoints, audit upgrade, engine wiring |
| sdk | [x] regenerate | New GDPR endpoints |
| cli | [ ] commands | No CLI changes in this wish |
| channel-sdk | [ ] interface | No changes |
| channel-* | [ ] implementations | No changes (tokens encrypted transparently) |

### System Checklist

- [ ] **Events**: No new event types (transform actions emit existing `media.processed`)
- [x] **Database**: `automations.system` column, `api_key_audit_logs.integrityHash` + `sequence`, `instances` token encryption migration
- [x] **SDK**: Regenerate for GDPR endpoints (`/persons/:id/data`, `/persons/:id/export`)
- [ ] **CLI**: No changes this wish
- [x] **Tests**: `core/automations` (new action types), `api/services/audit` (hash chain), `api/routes/persons` (GDPR), `core/crypto` (encryption)

---

## Execution Groups

### Group A: Transform Actions in Automation Engine

**Goal:** Extend the automation engine to support transform action types, extract transcription and image description as the first two transforms, and ship default system automations.

**Packages:** `core`, `db`, `api`

**Deliverables:**

- [ ] Add transform action types to `core/automations/types.ts`: `transcribe`, `describe_image`
- [ ] Add config interfaces: `TranscribeActionConfig`, `DescribeImageActionConfig`
- [ ] Add `services?: Services` to `ActionDependencies` in `core/automations/actions.ts`
- [ ] Implement `executeTranscribeAction()` — extract logic from `media-processor.ts`, calls `MediaProcessingService`, updates message, emits `media.processed`
- [ ] Implement `executeDescribeImageAction()` — extract logic from `media-processor.ts`
- [ ] Add `system` boolean column to `automations` table in `db/src/schema.ts`
- [ ] API: block deletion/disable of system automations in `api/src/routes/v2/automations.ts`
- [ ] DB seed: create default system automations (auto-transcribe-audio, auto-describe-image)
- [ ] Wire `services` into automation engine dependencies in `api/src/plugins/index.ts`
- [ ] Keep `media-processor.ts` active during migration (idempotent — skip if already processed)

**Acceptance Criteria:**

- [ ] An automation with `type: "transcribe"` action transcribes audio and stores result in variable
- [ ] Variable chaining works: `transcribe` -> `call_agent` with `{{transcript}}` template
- [ ] Default system automations are created on fresh install / migration
- [ ] System automations return 403 on DELETE/disable attempts via API
- [ ] Existing media processing continues to work (backward compatible)
- [ ] `make check` passes — all existing tests still pass

**Validation:**
```bash
make check
bun test packages/core/src/automations/
bun test packages/api/
```

### Group B: Compliance-Grade Audit Trail

**Goal:** Upgrade the audit trail from fire-and-forget to tamper-proof with retention policy, meeting SOC 2 requirements.

**Packages:** `db`, `api`

**Deliverables:**

- [ ] Add `integrityHash VARCHAR(64)` column to `api_key_audit_logs` table
- [ ] Add `sequence INTEGER` column to `api_key_audit_logs` table
- [ ] Upgrade `AuditService.log()`: await insert, compute SHA-256 hash chain (`hash(previousHash + entryJSON)`), assign monotonic sequence per API key
- [ ] On insert failure: log error, don't block HTTP response, but DO record the gap
- [ ] Add `GET /api/v2/audit/verify` endpoint — recomputes hash chain, reports integrity status
- [ ] Create `packages/api/src/jobs/audit-retention.ts` — background job:
  - Default retention: 90 days (configurable via settings table)
  - Archive expired logs to compressed JSONL before deletion
  - Log the retention cleanup event itself to the audit trail
  - Run on configurable interval (daily default)

**Acceptance Criteria:**

- [ ] Inserting audit records creates a valid hash chain (each record's hash depends on previous)
- [ ] Deleting or modifying a record in the middle of the chain is detectable via verify endpoint
- [ ] Sequence gaps are detectable (monotonic counter per API key)
- [ ] Retention job deletes records older than configured threshold
- [ ] Archived JSONL files are created before deletion
- [ ] `make check` passes

**Validation:**
```bash
make check
bun test packages/api/src/services/audit*
bun test packages/api/src/jobs/audit*
```

### Group C: GDPR Endpoints + Token Encryption

**Goal:** Implement GDPR data subject rights (deletion + export) and encrypt sensitive credentials at rest.

**Packages:** `core`, `db`, `api`, `sdk`

**Deliverables:**

- [ ] Create `packages/core/src/crypto/field-encryption.ts`:
  - AES-256-GCM encryption with per-row random IV
  - `encrypt(plaintext, key)` -> `iv:ciphertext:tag` (base64)
  - `decrypt(encrypted, key)` -> plaintext
  - Key from `OMNI_ENCRYPTION_KEY` environment variable
  - Graceful fallback: if env var not set, log warning and store plaintext (backward compatible)
- [ ] Add encryption/decryption to instance service for bot token fields (`apiKey`, `token`, `secret` in instance config JSONB)
- [ ] Migration script: encrypt all existing plaintext tokens
- [ ] `DELETE /api/v2/persons/:id/data` — right to deletion:
  1. Anonymize `persons` record (replace name/phone/email with SHA-256 hash)
  2. Anonymize linked `platformIdentities` (replace platformUserId, displayName)
  3. Soft-delete `messages` where person is sender (replace content with `[REDACTED]`, keep message structure for chat integrity)
  4. Preserve audit trail entries (replace person reference with `DELETED_USER_<hash>`)
  5. Create audit log entry for the deletion itself (who requested, when, what was deleted)
  6. Return summary: `{ personsAnonymized: 1, identitiesAnonymized: N, messagesRedacted: N }`
- [ ] `GET /api/v2/persons/:id/export` — data export / SAR:
  1. Return JSON with: person record, all platform identities, all messages (sent + received), all chat participations, automation interaction logs
  2. Include metadata: export timestamp, data scope description
  3. Format: JSON (not PDF — keep it simple)
- [ ] Regenerate SDK for new endpoints

**Acceptance Criteria:**

- [ ] Bot tokens are encrypted in DB, decrypted transparently on read
- [ ] Existing instances with plaintext tokens still work (migration is idempotent)
- [ ] If `OMNI_ENCRYPTION_KEY` is not set, system works with warning (no crash)
- [ ] Right-to-deletion anonymizes all PII for a person across all tables
- [ ] After deletion, person cannot be re-identified from remaining data
- [ ] Audit trail records the deletion event with requestor info
- [ ] Data export returns complete person data as JSON
- [ ] `make check` passes
- [ ] SDK regenerated with new endpoint types

**Validation:**
```bash
make check
bun test packages/core/src/crypto/
bun test packages/api/src/routes/v2/persons*
bun test packages/api/src/services/instances*
make sdk-generate
```

---

## Technical Reference

### Transform Action Type Pattern

Each transform action follows this pattern (same as existing action executors):

```typescript
// In core/automations/types.ts
interface TranscribeActionConfig {
  language?: string;              // default from settings or 'pt'
  provider?: 'groq' | 'openai';  // default from settings
  responseAs?: string;            // store result in variable for chaining
}

// In core/automations/actions.ts
async function executeTranscribeAction(
  config: TranscribeActionConfig,
  context: TemplateContext,
  deps: ActionDependencies,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  // 1. Get media path from payload
  // 2. Call deps.services.media.transcribe()
  // 3. Update message record with transcription
  // 4. Return { success: true, result: { text: "...", provider, durationMs } }
}
```

### Hash Chain for Audit Trail

```
Record 1: hash = SHA256("genesis" + JSON(record1))
Record 2: hash = SHA256(record1.hash + JSON(record2))
Record 3: hash = SHA256(record2.hash + JSON(record3))
```

Verification: recompute chain from first record, compare hashes. Any mismatch = tampering detected.

### System Automation Seed Example

```json
{
  "name": "Auto-transcribe audio messages",
  "description": "System automation: transcribes audio/voice messages using configured provider",
  "triggerEventType": "message.received",
  "triggerConditions": [
    { "field": "content.type", "operator": "eq", "value": "audio" }
  ],
  "conditionLogic": "or",
  "actions": [
    { "type": "transcribe", "config": { "responseAs": "transcript" } }
  ],
  "debounce": { "mode": "none" },
  "enabled": true,
  "priority": 100,
  "system": true
}
```

### Field Encryption

```typescript
// Encrypt
const encrypted = encrypt("bot-token-123", process.env.OMNI_ENCRYPTION_KEY);
// -> "aGVsbG8=:Y2lwaGVy...:dGFn..."  (iv:ciphertext:tag, base64)

// Decrypt
const plaintext = decrypt(encrypted, process.env.OMNI_ENCRYPTION_KEY);
// -> "bot-token-123"
```

---

## Success Criteria (Overall)

- [ ] Audio transcription works as an automation action type (not just hardcoded plugin)
- [ ] Users can create custom automation chains: transcribe -> agent -> reply
- [ ] System automations replicate current behavior (zero regression)
- [ ] Audit trail is tamper-proof (hash chain verifiable)
- [ ] Audit logs are retained/archived per policy
- [ ] GDPR deletion anonymizes all person data
- [ ] GDPR export produces complete person data dump
- [ ] Bot tokens are encrypted at rest
- [ ] `make check` passes with 0 errors across all packages
- [ ] Another agent can review this wish and execute it without ambiguity

---

## Future Work (Not This Wish)

These items are explicitly deferred and should become separate wishes:

1. **PII Redaction Action** — `pii_redact` action type (LLM-powered or regex). Needs `haltOnFailure` capability in engine.
2. **Prompt Guard Action** — Extract from `agent-responder.ts` as `prompt_guard` action type.
3. **Output Validation Action** — `output_validate` action type for agent response checking.
4. **Content Filter Action** — `content_filter` action type for enterprise policy enforcement.
5. **Rate Limit Enforcement** — Wire per-key `rateLimit` field in auth middleware.
6. **Automation Templates** — Pre-built recipes via `omni automations templates` CLI.
7. **Audit Stats Endpoint** — `GET /keys/:id/audit/stats` for dashboard analytics.
8. **PCI DSS Prep** — Card scrubbing action type when payment processing is added.
