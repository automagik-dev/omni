# Design: Omni Scope Profiles

| Field | Value |
|-------|-------|
| **Slug** | `omni-scope-profiles` |
| **Date** | 2026-04-19 |
| **WRS** | 100/100 |
| **Source** | Conversation in `agents/genie-configure` — Felipe clarified use cases and enforcement requirements |

## Problem

Omni's scope system today is a flat list of strings on each API key. Everyone who creates a key has to hand-author the scope array. There are no composable profiles, no instance/chat locks, and no output-side filtering. This makes it unsafe to issue a key to a customer-service agent, a coworker-facing PM agent, or an autonomous observer — every role would need a bespoke set of scopes and additional guardrails that don't exist yet.

Four concrete use cases surfaced:

1. **Customer Service (CS)** — a turn agent that speaks on behalf of a tenant to **one specific customer** at a time. Data is sensitive; the key must not be able to read a sibling customer's chat even by accident. Multimodal (image gen, TTS, vision) is an **enterprise preference**, not a platform default — some enterprises want it, others refuse.
2. **Personal assistant (owner-only)** — the operator's own agent, permissive on their instances. On this operator's setup there are two numbers: a "bot number" that can send to an allowlist, and a "personal number" that is read-only so the agent can consume the stream without ever posting.
3. **Scout (public observer)** — autonomous observer that reads conversations and can **only** send to the operator as alerts. Never replies to conversation participants. Has access to a personal brain for context enrichment.
4. **Coworker PM** (the use case on the KHAL-OS VM) — a project manager agent with its own WhatsApp number that acts as a peer to employees. Answers tech/business/roadmap questions from multiple coworkers, eats meeting transcripts. **Must never reveal core code, secret sauce, or internal product knowledge** beyond what an employee is cleared to see.
5. **Admin** — god key, everything on. Equivalent to `--dangerously-skip-permissions`. Only a human operator at a TTY should be able to mint one.

## Decisions

### 1. Profile is the primary abstraction, verbs are the building block

Agents today invoke omni through **verb commands** (`say`, `react`, `listen`, `imagine`, `film`, `speak`, `see`, `history`, `open`, `close`, `use`, `where`, `done`, `send`). These verbs are the natural unit of capability. A profile is a composition of verb buckets + enforcement locks, not a hand-written scope array.

**Verb buckets**

| Bucket | Verbs | Underlying scopes |
|---|---|---|
| `outgoing` | `send`, `say`, `react` | `messages:send` |
| `read` | `history`, `where` | `chats:read` |
| `context` | `open`, `close`, `use` | `context:write`, `instances:read` |
| `turn` | `done` | `turns:close` |
| `multimodal_in` | `listen`, `see` | `media:read`, `messages:send` |
| `multimodal_out` | `speak`, `imagine`, `film` | `tts:synthesize`, `media:write`, `messages:send` |

A new resolver `verbsToScopes(buckets)` derives the concrete scope list. No consumer writes scope strings directly anymore.

### 2. Five profile templates

Each profile is a verb-bucket composition plus optional per-verb overrides plus a set of enforcement locks. Every profile is expressible as a plain TypeScript object in `constants/profiles.ts` of shape:

```ts
type ProfileTemplate = {
  name: 'cs' | 'personal' | 'scout' | 'coworker' | 'admin';
  buckets: BucketName[];                 // whole-bucket inclusion
  verbs?: { add?: Verb[]; remove?: Verb[] };  // per-verb delta on top of buckets
  requiresLocks: LockField[];            // which lock arrays must be non-empty at create time
  defaultLocks?: Partial<LockFields>;    // baked-in lock values (e.g. scout's ownerJid)
};
```

Matrix (✓ = full bucket, ⊕ = bucket + extra verbs, ⊖ = bucket minus verbs, — = excluded):

| Profile | `outgoing` | `read` | `context` | `turn` | `mm_in` | `mm_out` | Default locks |
|---|---|---|---|---|---|---|---|
| `cs` | ✓ | ✓ | ⊖ (no `use`) | ✓ | enterprise-override | enterprise-override | **chatAllowlist + instanceAllowlist required at create time** |
| `personal` | per-instance | ✓ | ✓ | ✓ | ✓ | ✓ | `instanceAllowlist` + per-instance `outboundRecipientAllowlist` |
| `scout` | **owner-only** | ⊖ (no `history`) | — | — | ✓ | — | `outboundRecipientAllowlist = [ownerJid]` (absolute — cannot be widened) |
| `coworker` | ✓ (multi-chat) | ✓ | ✓ | ✓ | ✓ | ✓ | `instanceAllowlist` + **output denylist** (redaction middleware) |
| `admin` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | none |

Concrete per-verb overrides:

- `cs`: `buckets: ['outgoing', 'read', 'context', 'turn']`, `verbs: { remove: ['use'] }` — `use` lets a key switch active instance at the CLI level, which breaks the single-customer-per-key guarantee. A CS key is pinned to one instance by lock anyway, so `use` is pointless and revoking it prevents operator error.
- `scout`: `buckets: ['outgoing', 'multimodal_in']`, `verbs: { add: ['where'], remove: ['history'] }` — scout needs to know which chat it's looking at (`where` reads state) but must never see prior-message history (`history`), because ingesting arbitrary customer chat context into a scout's alerting logic is a data-exfil vector.

The `cs` multimodal buckets default to **off** and enterprises flip them on per-tenant via `profile_overrides`. The platform does not bake multimodal in because it is a commercial / regulatory choice downstream.

**Resolver semantics.** `verbsToScopes(profile)` first expands `buckets` to a verb set, then applies `verbs.add` and `verbs.remove` in order, then maps the final verb set through the verb→scope table. `remove` of a verb not present is a no-op (safe). `add` of a verb already present is a no-op. The add/remove sets must be disjoint (validated at template load time — overlap throws).

### 3. Three new enforcement primitives in the scope-enforcer

`packages/api/src/middleware/scope-enforcer.ts` is extended with:

- `chatAllowlist: string[]` — any request whose target chat is not in the allowlist is denied. Enforces CS single-customer isolation.
- `instanceAllowlist: string[]` — any request whose target instance is not in the allowlist is denied. Enforces per-VM / per-tenant isolation.
- `outboundRecipientAllowlist: string[]` — any `messages:send` whose target recipient JID is not in the allowlist is denied. Enforces scout's owner-only alerting and personal's bot-number allowlist.

These locks live on the `api_keys` row alongside `scopes`, so the middleware can enforce them with a single fetch that is already happening on every request.

### 4. Output filter middleware for coworker secret redaction

Secret redaction is **not** a scope — a scope is about "can I make this call." Redaction is about "what can the response contain." It's a separate layer. New module:

```
packages/api/src/middleware/output-redactor.ts
```

At message-send time, the middleware runs the message body through a denylist of patterns and filenames. Matches are replaced with `[redacted]` and logged as a `secret.redacted` event. The denylist is per-profile and per-tenant:

- **coworker** profile denylist: file paths under `repos/core/**`, specific keywords like `SECRET_SAUCE_TOKEN` or whatever the tenant configures, regex patterns for API keys / secrets.
- Redaction logs are fed into Sentry so the operator sees when the agent *tried* to leak.

Redaction applies to **outbound** messages only — the agent can still hold the context in memory; it just can't say it.

This is an independent layer intentionally: an `admin` profile would skip redaction, a `cs` profile would use tenant-customized denylists, etc.

### 5. Admin profile requires interactive TTY confirmation

`omni keys create --profile admin` must:
- Detect the process is attached to a TTY. Refuse to create without one.
- Prompt the operator: `You are about to create an ADMIN key with all scopes and no locks. This bypasses every profile enforcement. Type "I UNDERSTAND" to continue:` — case-sensitive exact match required.
- Log a `key.admin_created` audit event with operator identity + timestamp.

This ensures no AI agent running non-interactively can ever mint a god-key, even if it somehow acquires enough scope to call `keys:write`.

### 6. Data model

Extend the `api_keys` table:

| Column | Type | Purpose |
|---|---|---|
| `profile` | `text` (nullable) | Profile name (`cs`, `personal`, `scout`, `coworker`, `admin`) |
| `profile_overrides` | `jsonb` (nullable) | Per-key overrides merged on top of template. Holds tenant multimodal prefs, denylist additions, allowlist extensions |
| `chat_allowlist` | `text[]` (default empty) | Chat JIDs this key may touch |
| `instance_allowlist` | `text[]` (default empty) | Instance IDs this key may touch |
| `outbound_recipient_allowlist` | `text[]` (default empty) | Recipient JIDs this key may `messages:send` to |

`scopes` column stays — it's still the canonical enforcement surface. The resolver populates it from `profile + profile_overrides` at key create time, so no existing enforcer code has to change its shape.

### 7. CLI surface

```bash
omni keys create --profile cs --lock-chat <jid> --lock-instance <id> --name "acme-corp-support"
omni keys create --profile personal --lock-instance <jid1> --lock-instance <jid2>
omni keys create --profile scout --owner <ownerJid>
omni keys create --profile coworker --lock-instance <id> --denylist-preset khal-os-core
omni keys create --profile admin       # interactive confirmation
```

Non-admin profile creation remains non-interactive (scriptable by automations). Admin is the sole gated path.

## Non-goals

- **Profile editing of existing keys.** Keys are immutable — rotation means revoke + recreate. This avoids the "silently widened key" footgun.
- **Dynamic verb additions.** The verb set is frozen at each omni release. New verbs land in a new release, and profiles reference them by name.
- **Custom profile authoring via the API.** Profiles are code-defined. Tenants can override via `profile_overrides` but cannot create a fully custom `cs-for-acme` profile in the DB. (If that ever becomes necessary, it's a follow-up wish — the override layer is the forward compat.)
- **Secret-redaction denylist management UI.** Denylists are code/config for this wish. A management UI is a separate wish.
- **Brain integration.** The `coworker` profile references a brain for context but the omni side is agnostic about where the brain lives. Brain wiring is a consumer-side concern (separate wish in khal-os repo for the khal-os PM consumer).

## Open risks

| Risk | Severity | Mitigation |
|---|---|---|
| Redactor middleware introduces send-path latency | Medium | Redaction stays **synchronous** — an async fire-and-forget path would leak the unredacted message into the channel's send buffer before the scrub completed, defeating the whole point. Mitigate via Aho-Corasick automaton (all literal denylist entries compiled into a single DFA, O(n) scan regardless of denylist size) + pre-compiled regex array for pattern entries. Benchmark on CI with a 1k-entry denylist over a 10KB message body; target p99 < 5ms. Cap denylist size per tenant at 10k entries with a CLI warning past that threshold. |
| Enterprises want per-chat multimodal overrides inside a single CS tenant | Medium | `profile_overrides` is per-key already. A tenant can mint multiple CS keys with different multimodal configs per customer tier |
| Admin TTY check breaks CI smoke tests | Low | Tests use the factory function directly with explicit "accept" flag that is not a CLI flag |
| Scope-enforcer regression on existing keys | High | Every existing key gets a backfill migration that sets `profile = NULL`, `scopes` preserved verbatim. Enforcer reads `scopes` column regardless of profile — profile is metadata for audit |
| Output redactor corrupts a legitimate business message | Medium | Redaction emits a `secret.redacted` event with the matched pattern — operator can audit false positives and tune denylist |
