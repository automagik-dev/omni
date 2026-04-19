# Wish: Omni Scope Profiles

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `omni-scope-profiles` |
| **Date** | 2026-04-19 |
| **Design** | [DESIGN.md](../../brainstorms/omni-scope-profiles/DESIGN.md) |

## Summary

Introduce **profiles** as the primary abstraction for issuing omni API keys. A profile is a composition of verb buckets plus enforcement locks (chat, instance, outbound recipient). Replace hand-authored scope arrays with code-defined templates — `cs`, `personal`, `scout`, `coworker`, `admin` — that map onto concrete scopes via a new `verbsToScopes` resolver. Extend the scope-enforcer with three new primitives (`chatAllowlist`, `instanceAllowlist`, `outboundRecipientAllowlist`) and add an output-redactor middleware so the `coworker` profile can run as a peer-to-employees agent without leaking secret sauce. Gate `admin` key creation behind interactive TTY confirmation so no AI can mint a god-key.

## Scope

### IN
- New `packages/api/src/constants/verbs.ts` with verb enum + verb-bucket groupings
- New `packages/api/src/constants/profiles.ts` with 5 profile templates (`cs`, `personal`, `scout`, `coworker`, `admin`)
- New `packages/api/src/lib/verbs-to-scopes.ts` resolver (buckets + overrides → flat scope list)
- Extend `scope-enforcer.ts` middleware with `chatAllowlist`, `instanceAllowlist`, `outboundRecipientAllowlist` checks
- New `packages/api/src/middleware/output-redactor.ts` for per-profile/per-tenant secret redaction on outbound messages, with `secret.redacted` event emission
- Drizzle migration: add `profile`, `profile_overrides`, `chat_allowlist`, `instance_allowlist`, `outbound_recipient_allowlist` columns to `agent_keys`
- Extend `omni keys create` CLI with `--profile`, `--lock-chat`, `--lock-instance`, `--owner`, `--denylist-preset` flags
- Interactive TTY confirmation for `--profile admin` (case-sensitive "I UNDERSTAND" prompt) + `key.admin_created` audit event
- Unit tests for: resolver, every profile template, every new enforcement primitive, redactor middleware, admin TTY gate
- OpenAPI docs regenerated with new fields + CLI help text updated
- Docs in `docs/profiles.md` documenting each template, its locks, and override shape

### OUT
- Profile editing on existing keys (keys are immutable — rotate via revoke + recreate)
- Dynamic verb additions at runtime (verbs frozen per omni release)
- Custom profile authoring via API (only `profile_overrides` is tenant-editable)
- Secret-redaction denylist management UI (config/env only for this wish)
- Brain wiring for the `coworker` profile (consumer-side concern — separate wish in khal-os repo)
- Meeting-data ingest pipeline for coworker (consumer-side)
- UI/dashboard changes for profile visualization

## Decisions

| Decision | Rationale |
|---|---|
| Profiles are code-defined, not DB-defined | Type-safe, no round-trip per auth request, reviewable in PR. Overrides at tenant level land in a jsonb column — forward-compat without losing profile integrity |
| Verb buckets are the authoring unit, not raw scopes | Consumers shouldn't need to know scope names. Buckets map 1:1 to capabilities the agent actually uses |
| `scopes` column stays as the enforcement surface | Enforcer does not need to know about profiles. Profile resolver populates `scopes` at key create time. Backward compatible with every existing key — they get `profile = NULL` |
| Output redactor is middleware, not a scope | Scopes gate "can I make this API call" — redaction gates "what can the response contain." Different layer |
| Admin key creation requires TTY + exact-match prompt | Prevents any non-interactive caller (AI agents, scripts, CI) from ever minting a god-key — even one that has `keys:write`. Human-gated by construction |
| `chat_allowlist` / `instance_allowlist` / `outbound_recipient_allowlist` are `text[]` columns, not a separate join table | Small cardinality (tens, not thousands), read on every authed request, denormalized for latency |

## Success Criteria

- [ ] `omni keys create --profile cs --lock-chat <jid> --lock-instance <id>` creates a key whose enforcer denies any request targeting a different chat or instance
- [ ] `omni keys create --profile scout --owner <jid>` creates a key that can only `messages:send` to `<jid>` — any other recipient returns 403
- [ ] `omni keys create --profile coworker --lock-instance <id>` creates a key whose outbound messages are scrubbed against the coworker denylist before delivery
- [ ] `omni keys create --profile admin` refuses to proceed when stdin is not a TTY
- [ ] `omni keys create --profile admin` on a TTY requires the operator to type `I UNDERSTAND` exactly — any other input aborts
- [ ] `key.admin_created` event is emitted for every admin key creation with operator identity + timestamp
- [ ] All 5 profile templates resolve to a scope list via `verbsToScopes()` — scope set matches the documented expectation in each profile's unit test
- [ ] Existing keys continue to work unmodified (backfill migration sets `profile = NULL`, preserves `scopes` verbatim)
- [ ] `secret.redacted` event fires when the coworker redactor catches a pattern match on an outgoing message
- [ ] OpenAPI docs include the new `agent_keys` fields; CLI help text documents `--profile`, `--lock-chat`, `--lock-instance`, `--owner`, `--denylist-preset`
- [ ] `docs/profiles.md` exists and documents every profile's verb buckets, default locks, override shape, and an example `omni keys create` invocation

## Execution Strategy

### Wave 1 (parallel — foundational, no dependencies)

| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Verbs enum + verb-bucket groupings (`constants/verbs.ts`) |
| 2 | engineer | `verbsToScopes()` resolver (`lib/verbs-to-scopes.ts`) |
| 3 | engineer | Drizzle migration for `agent_keys` columns |

### Wave 2 (after Wave 1)

| Group | Agent | Description |
|-------|-------|-------------|
| 4 | engineer | 5 profile templates (`constants/profiles.ts`) — consumes Groups 1 + 2 |
| 5 | engineer | Scope-enforcer extensions (chat/instance/outbound allowlists) — consumes Group 3 |

### Wave 3 (after Wave 2)

| Group | Agent | Description |
|-------|-------|-------------|
| 6 | engineer | Output-redactor middleware + `secret.redacted` events |
| 7 | engineer | CLI extensions (`omni keys create --profile …`) + admin TTY gate |

### Wave 4 (after all above)

| Group | Agent | Description |
|-------|-------|-------------|
| 8 | engineer | Docs (`docs/profiles.md`) + OpenAPI regen + CLI help polish |
| review | reviewer | Full-wish review — security focus on admin gate + enforcer primitives |
| qa | qa | Integration tests on dev — every profile + every lock primitive |

## Execution Groups

### Group 1: Verbs enum + bucket groupings
**Goal:** Canonical verb vocabulary and capability buckets usable by profiles and resolver.
**Deliverables:**
1. `packages/api/src/constants/verbs.ts` with `VERBS` enum (all 14 current verbs) and `VERB_BUCKETS` mapping
2. Exported type `VerbBucket = 'outgoing' | 'read' | 'context' | 'turn' | 'multimodal_in' | 'multimodal_out'`
3. Exported `bucketToScopes: Record<VerbBucket, string[]>` table

**Acceptance Criteria:**
- [ ] All 14 verbs present with correct bucket assignment per DESIGN.md
- [ ] Unit test proves every bucket resolves to the documented scope list
- [ ] No duplicate scopes in a single bucket's list

**Validation:**
```bash
cd packages/api && bun test src/constants/__tests__/verbs.test.ts
```

**depends-on:** none

---

### Group 2: verbsToScopes resolver
**Goal:** Pure function that takes a profile shape + overrides and returns a flat deduplicated scope array.
**Deliverables:**
1. `packages/api/src/lib/verbs-to-scopes.ts` exporting `verbsToScopes(input: { buckets: VerbBucket[]; extraScopes?: string[] }): string[]`
2. Dedup + sort for deterministic output

**Acceptance Criteria:**
- [ ] Given `{ buckets: ['outgoing'] }` returns `['messages:send']`
- [ ] Given `{ buckets: ['outgoing', 'multimodal_out'] }` returns the union, deduped
- [ ] Given `{ buckets: ['outgoing'], extraScopes: ['chats:read'] }` adds the extra
- [ ] Output is sorted (deterministic snapshots)

**Validation:**
```bash
cd packages/api && bun test src/lib/__tests__/verbs-to-scopes.test.ts
```

**depends-on:** Group 1

---

### Group 3: Drizzle migration for agent_keys
**Goal:** Add profile metadata + allowlist columns without breaking existing keys.
**Deliverables:**
1. Schema edit in `packages/db/src/schema.ts` adding 5 columns (`profile`, `profile_overrides`, `chat_allowlist`, `instance_allowlist`, `outbound_recipient_allowlist`)
2. `bunx drizzle-kit generate` produces migration file
3. Existing keys backfill: migration sets `profile = NULL`, other columns default to `[]` or `{}`

**Acceptance Criteria:**
- [ ] `make test-api` green after migration applies
- [ ] Existing key rows are unmodified for `scopes` column
- [ ] Drizzle journal entry committed alongside SQL

**Validation:**
```bash
cd packages/db && bunx drizzle-kit check
make test-api
```

**depends-on:** none

---

### Group 4: Profile templates
**Goal:** 5 code-defined profiles consumable by the CLI and the key-creation route.
**Deliverables:**
1. `packages/api/src/constants/profiles.ts` exporting `PROFILES: Record<ProfileName, ProfileTemplate>`
2. `ProfileTemplate` type: `{ buckets: VerbBucket[]; requiresLocks: LockRequirement[]; defaultOverrides?: Partial<ProfileOverrides>; adminOnlyFlag?: true }`
3. Unit tests asserting each template's resolved scope list

**Acceptance Criteria:**
- [ ] `cs` template requires `chatAllowlist` + `instanceAllowlist` at create time
- [ ] `scout` template has `outboundRecipientAllowlist` as a locked override (not tenant-editable)
- [ ] `coworker` template defaults `outputDenylist` to a documented preset
- [ ] `admin` template has `adminOnlyFlag: true` — rejected by non-TTY callers
- [ ] Unit test snapshot confirms resolved scope list per template

**Validation:**
```bash
cd packages/api && bun test src/constants/__tests__/profiles.test.ts
```

**depends-on:** Group 1, Group 2

---

### Group 5: Scope-enforcer extensions
**Goal:** Middleware denies requests that violate chat/instance/outbound-recipient locks.
**Deliverables:**
1. Extend `packages/api/src/middleware/scope-enforcer.ts` with three new check functions
2. Extract target chat/instance/recipient from the request body via a small helper per route category
3. 403 responses include the lock that matched + the attempted value (for operator debugging)

**Acceptance Criteria:**
- [ ] Request to `POST /chats/:otherJid/messages` from a cs-locked key returns 403 with `lock: chatAllowlist`
- [ ] `messages:send` to a non-allowlisted recipient from a scout key returns 403 with `lock: outboundRecipientAllowlist`
- [ ] Request against an instance not in `instance_allowlist` returns 403 with `lock: instanceAllowlist`
- [ ] Empty allowlist (`[]`) is treated as "no lock" (not "deny all") — backward compat for pre-profile keys
- [ ] Unit tests cover allow + deny per primitive

**Validation:**
```bash
cd packages/api && bun test src/middleware/__tests__/scope-enforcer.test.ts
```

**depends-on:** Group 3

---

### Group 6: Output-redactor middleware
**Goal:** Scrub outbound message bodies against per-profile denylists before delivery.
**Deliverables:**
1. `packages/api/src/middleware/output-redactor.ts` that runs on the send-message pipeline
2. Denylist compiled once at startup from `profiles.ts` preset + per-key `profile_overrides.denylistExtras`
3. `secret.redacted` event emitted with matched pattern + message ID
4. Benchmark: send-path p99 latency overhead < 10ms for a 2KB body against a 200-entry denylist

**Acceptance Criteria:**
- [ ] Coworker profile with denylist preset `khal-os-core` scrubs a message containing a denied keyword to `[redacted]`
- [ ] Admin profile bypasses redaction entirely
- [ ] `secret.redacted` event fires on every redaction with full metadata
- [ ] Benchmark in `packages/api/bench/output-redactor.bench.ts` passes latency budget

**Validation:**
```bash
cd packages/api && bun test src/middleware/__tests__/output-redactor.test.ts
bun run bench/output-redactor.bench.ts
```

**depends-on:** Group 4

---

### Group 7: CLI key-creation surface
**Goal:** `omni keys create --profile …` resolves profile to columns and persists via API.
**Deliverables:**
1. Extend `packages/cli/src/commands/keys.ts` with new flags: `--profile`, `--lock-chat` (repeatable), `--lock-instance` (repeatable), `--owner`, `--denylist-preset`
2. For `--profile admin`: detect TTY via `process.stdin.isTTY`, prompt for `I UNDERSTAND`, abort on mismatch or pipe
3. API route `POST /keys` accepts `{ profile, overrides }` and resolves via `verbsToScopes` + profile template
4. `key.admin_created` audit event on admin creation

**Acceptance Criteria:**
- [ ] `omni keys create --profile scout --owner <jid>` persists a key with the expected scopes + outbound lock
- [ ] `echo "" | omni keys create --profile admin` refuses with "admin keys require a TTY"
- [ ] `omni keys create --profile admin` on a TTY prompts exactly the DESIGN-documented text
- [ ] Wrong confirmation text aborts with exit code 1 and no key created
- [ ] `omni events --type key.admin_created` shows the event after success

**Validation:**
```bash
cd packages/cli && bun test src/commands/__tests__/keys.test.ts
# manual TTY verification step (documented in QA criteria)
```

**depends-on:** Group 4, Group 5, Group 6

---

### Group 8: Docs + OpenAPI regen
**Goal:** Every new surface is documented and the SDK knows the new fields exist.
**Deliverables:**
1. `docs/profiles.md` with one section per profile: verb buckets, default locks, overrides, CLI invocation example
2. `make sdk-generate` produces updated SDK with new key fields
3. CLI `--help` text for `keys create` lists every new flag with a one-line description
4. Changelog entry in keepachangelog format

**Acceptance Criteria:**
- [ ] `docs/profiles.md` covers all 5 profiles with at least one example each
- [ ] SDK has new typed `profile` field on key-create input + response
- [ ] CLI `omni keys create --help` includes `--profile`, `--lock-chat`, `--lock-instance`, `--owner`, `--denylist-preset`
- [ ] Changelog entry under `Unreleased`

**Validation:**
```bash
make sdk-generate && git diff --exit-code packages/sdk/src/generated  # should either be clean or include only expected additions
omni keys create --help | grep -E '\-\-profile|\-\-lock-chat|\-\-lock-instance|\-\-owner|\-\-denylist-preset' | wc -l  # expects 5
```

**depends-on:** Group 7

---

## QA Criteria

_What must be verified on dev after merge. The QA agent tests each criterion._

- [ ] Create one key per profile on a dev omni and exercise a representative call per profile — expected allows succeed, expected denies return 403 with the correct `lock:` field
- [ ] Admin creation via non-TTY (pipe) is refused; via TTY with the correct phrase succeeds
- [ ] Secret redaction fires on a coworker key sending a message containing a denied keyword; `secret.redacted` event visible via `omni events`
- [ ] Existing (pre-migration) keys continue working without change — sample five from dev and exercise their current scopes
- [ ] Benchmark run on dev: redactor adds < 10ms p99 on a representative payload
- [ ] OpenAPI surface at `/api/v2/docs` renders new fields; SDK type-checks

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Output redactor introduces meaningful send-path latency | Medium | Benchmark in Group 6 with a hard budget. Compile denylist once; use a single-pass Aho-Corasick over a regex union |
| Admin TTY check breaks smoke tests in CI | Low | Tests bypass the CLI and call the factory with an explicit `operator_confirmed: true` flag that is NOT a CLI flag |
| A consumer has a legitimate business message that matches the denylist | Medium | Redactor emits `secret.redacted` events so operators can audit false positives; denylist is tunable per-tenant |
| Backward compat for pre-profile keys regresses | High | Group 3 backfill sets `profile = NULL` and preserves `scopes`. Enforcer reads `scopes` regardless — profile is metadata. Added integration test: five fixture pre-profile keys still pass their existing allow/deny matrix |
| A tenant requests a fully custom profile | Low | Override surface (`profile_overrides`) handles most cases. Fully custom templates are deferred to a follow-up wish — documented in OUT scope |

---

## Review Results

_Populated by `/review` after execution completes._

---

## Follow-up wishes (not this scope)

- **`omni-coworker-consumer`** (lives in `agents/khal-os` repo) — wire the khal-os PM agent to a WhatsApp instance using the `coworker` profile, connect to its own brain, ingest meeting transcripts
- **`omni-scout-consumer`** (lives in operator's personal VM) — scout agent using the `scout` profile + personal brain
- **`omni-profile-management-ui`** — dashboard view to inspect profiles, override denylists, rotate keys

---

## Files to Create/Modify

```
packages/api/src/constants/verbs.ts                      (new)
packages/api/src/constants/profiles.ts                   (new)
packages/api/src/constants/__tests__/verbs.test.ts       (new)
packages/api/src/constants/__tests__/profiles.test.ts    (new)
packages/api/src/lib/verbs-to-scopes.ts                  (new)
packages/api/src/lib/__tests__/verbs-to-scopes.test.ts   (new)
packages/api/src/middleware/scope-enforcer.ts            (edit)
packages/api/src/middleware/__tests__/scope-enforcer.test.ts (edit)
packages/api/src/middleware/output-redactor.ts           (new)
packages/api/src/middleware/__tests__/output-redactor.test.ts (new)
packages/api/bench/output-redactor.bench.ts              (new)
packages/api/src/routes/v2/keys.ts                       (edit)
packages/db/src/schema.ts                                (edit)
packages/db/drizzle/NNNN_agent_keys_profiles.sql         (new, generated)
packages/cli/src/commands/keys.ts                        (edit)
packages/cli/src/commands/__tests__/keys.test.ts         (edit)
docs/profiles.md                                         (new)
CHANGELOG.md                                             (edit)
```
