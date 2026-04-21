# Wish: Per-Instance Bridge Tmux Session

| Field | Value |
|-------|-------|
| **Status** | APPROVED |
| **Slug** | `per-instance-bridge-tmux-session` |
| **Date** | 2026-04-21 |
| **Design** | _No brainstorm — direct wish_ |

## Summary
Add a per-instance `bridge_tmux_session` field to Omni so a single Omni Agent (one UUID) hooked to N inbound numbers can route each instance's dispatches into its own genie tmux session for isolation and load-balancing visibility. The `nats-genie` provider must propagate the value through the NATS message env as `GENIE_TMUX_SESSION`, which the consumer genie bridge will read (per its sibling wish `automagik/genie:bridge-tmux-session-config`). Motivating use case: enterprise scout fan-out — one scout agent observing 10 inbound numbers, each landing in its own tmux session (`whatsapp-scout-01` … `whatsapp-scout-10`).

## Scope
### IN
- DB migration: `ALTER TABLE instances ADD COLUMN bridge_tmux_session TEXT` (nullable, default null).
- Drizzle schema update in `packages/db/src/schema.ts`: add `bridgeTmuxSession: text('bridge_tmux_session')` to instances.
- API: expose the field in `GET /instances/:id`, `PATCH /instances/:id`, and the SDK types (`packages/sdk`).
- CLI: `omni instances update <id> --bridge-tmux-session <name>` and `--bridge-tmux-session null` to clear.
- Display: include the field in `omni instances get <id>` human output.
- NATS provider: `packages/core/src/providers/nats-genie-provider.ts` reads `instance.bridgeTmuxSession` at dispatch time and includes it in `NatsOutboundMessage.env` as `GENIE_TMUX_SESSION`. Absent/null value → no env key added (no override).
- Tests: schema migration, drizzle roundtrip, API route, CLI update + get, provider env propagation, "null to clear" semantics.

### OUT
- Genie-side consumer (handled by `automagik/genie:bridge-tmux-session-config`).
- Per-chat session overrides (`omni routes` already handles per-chat routing; not tmux-related).
- TUI / SDK UI changes beyond surfacing the field in typed API responses.
- Automatic migration of existing `schemaConfig.tmuxSession` keys (none exist today; if adopted, we can copy in a later wish).
- Retroactive backfill — existing instances keep `bridgeTmuxSession = null` (unchanged behavior).

## Decisions
| Decision | Rationale |
|----------|-----------|
| Store on `instances` table, not `providers` or `agents` | Providers are shared across instances for the same agent (1:1 provider↔agent today). Per-instance routing requires per-instance storage. Agents are shared across instances too. |
| Column name `bridge_tmux_session` (snake_case DB, camelCase TS) | Matches existing `agent_*` convention in instances; Drizzle mapping handles the casing. |
| Env var key `GENIE_TMUX_SESSION` | Matches the key reserved by genie's sibling wish. Keep identical. |
| Propagate via NATS `env` field (not a new payload field) | Already-supported plumbing path: omni builds `trigger.env`, provider publishes `NatsOutboundMessage.env`. Zero protocol breakage. |
| Null = no override | Preserves current bridge behavior (agentName or agent.yaml fallback). Makes rollout safe. |
| CLI uses `null` sentinel to clear | Consistent with other nullable instance fields (`--tts-voice null`, `--debounce-group null`). |

## Success Criteria
- [ ] DB migration applies cleanly on a fresh pgserve and is idempotent.
- [ ] `omni instances update <id> --bridge-tmux-session whatsapp-scout-12` writes the value; `omni instances get <id>` shows `bridgeTmuxSession: whatsapp-scout-12`.
- [ ] `omni instances update <id> --bridge-tmux-session null` clears it back to `null`.
- [ ] API responses for `GET /instances/:id` and list endpoints include the field with correct typing.
- [ ] `NatsGenieProvider.trigger()` includes `env.GENIE_TMUX_SESSION = <value>` in the published payload when `instance.bridgeTmuxSession` is set; omits it entirely when null/undefined.
- [ ] Test coverage: migration, schema roundtrip, API route, CLI update/get, provider env inclusion + omission, null-clear.
- [ ] Full test gate passes (`bun test` or whichever script omni uses — mirror `package.json` scripts).
- [ ] Backward compatibility: instances without the field set behave exactly as today.
- [ ] PR body cross-references `automagik/genie:bridge-tmux-session-config` and states that end-to-end routing requires both PRs merged.

## Execution Strategy

### Wave 1 (sequential — migration first)
| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | DB migration + drizzle schema + migration test |

### Wave 2 (parallel, after Wave 1)
| Group | Agent | Description |
|-------|-------|-------------|
| 2 | engineer | API route + SDK types + API test |
| 3 | engineer | CLI flags (update/get) + CLI test |
| 4 | engineer | `nats-genie-provider.ts` env propagation + provider test |

### Wave 3 (after Wave 2)
| Group | Agent | Description |
|-------|-------|-------------|
| review | reviewer | Review Groups 1–4 against success criteria; SHIP / FIX-FIRST verdict. |

## Execution Groups

### Group 1: DB Migration + Drizzle Schema
**Goal:** Add the `bridge_tmux_session` column to `instances` and wire it through Drizzle.
**Deliverables:**
1. New drizzle migration SQL in `packages/db/drizzle/` (next sequence number) adding `ALTER TABLE instances ADD COLUMN bridge_tmux_session TEXT`.
2. Update `packages/db/src/schema.ts` instances table definition with `bridgeTmuxSession: text('bridge_tmux_session')`.
3. Migration test (if omni has a migration harness) verifying column exists + NULL default.
4. Drizzle inferred types include the new field.

**Acceptance Criteria:**
- [ ] Migration applies forward cleanly; applying twice is idempotent (guarded by `IF NOT EXISTS` if omni convention uses it) or generated via `drizzle-kit generate`.
- [ ] `instances` schema export includes `bridgeTmuxSession` field of type `string | null`.
- [ ] No other schema churn.

**Validation:**
```bash
cd /home/genie/workspace/repos/omni
bun run db:migrate  # or whatever the project uses
bun test packages/db
```

**depends-on:** none

---

### Group 2: API Route + SDK Types
**Goal:** Surface the field in GET/PATCH `/instances` and typed SDK clients.
**Deliverables:**
1. Update the `/instances/:id` GET response serializer to include `bridgeTmuxSession`.
2. Update the PATCH `/instances/:id` validator (zod) to accept `bridgeTmuxSession?: string | null`.
3. Update SDK types in `packages/sdk` so consumers see the field.
4. API tests for GET (field visible) and PATCH (set + clear with null).

**Acceptance Criteria:**
- [ ] GET shows the field when set and returns `null` when unset.
- [ ] PATCH accepts setting a string and clearing via explicit `null`.
- [ ] Unknown value (non-string, non-null) rejected with 400.
- [ ] SDK types compile; existing consumers unaffected.

**Validation:**
```bash
cd /home/genie/workspace/repos/omni
bun test packages/api/src/routes
bun test packages/sdk
```

**depends-on:** Group 1

---

### Group 3: CLI flags (update + get)
**Goal:** Expose the field through the `omni instances` CLI.
**Deliverables:**
1. Add `--bridge-tmux-session <name>` option to `omni instances update` in `packages/cli/src/commands/instances.ts`.
2. Support the string `null` sentinel to clear the field (consistent with other nullable flags).
3. Display `bridgeTmuxSession` in `omni instances get <id>` human output.
4. CLI tests for both paths.

**Acceptance Criteria:**
- [ ] `omni instances update <id> --bridge-tmux-session foo` sets the field.
- [ ] `omni instances update <id> --bridge-tmux-session null` clears it.
- [ ] `omni instances get <id>` renders the field in the key/value list.
- [ ] `omni instances update --help` lists the flag with description.

**Validation:**
```bash
cd /home/genie/workspace/repos/omni
bun test packages/cli/src/commands/instances
```

**depends-on:** Group 1

---

### Group 4: NATS Provider env propagation
**Goal:** `nats-genie-provider.ts` must include `GENIE_TMUX_SESSION` in the NATS message env when the instance has the field set.
**Deliverables:**
1. In `packages/core/src/providers/nats-genie-provider.ts`, at the point where `NatsOutboundMessage.env` is built (merge with `trigger.env`), add `GENIE_TMUX_SESSION` if `instance.bridgeTmuxSession` is present.
2. Do NOT add the key when the value is null/undefined (keep payload minimal; preserve current behavior).
3. Plumb instance record (or just the field) into the provider constructor/trigger path if not already available.
4. Tests: provider includes env key when set, omits when unset, and does not override if the caller already set `trigger.env.GENIE_TMUX_SESSION` (trigger env wins — keeps programmatic overrides possible).

**Acceptance Criteria:**
- [ ] Env key `GENIE_TMUX_SESSION` present in published NATS payload iff `instance.bridgeTmuxSession` is truthy.
- [ ] Absence is the default; payload is byte-identical to today when field is unset.
- [ ] Unit test with a mock NATS captures the published env for both states.

**Validation:**
```bash
cd /home/genie/workspace/repos/omni
bun test packages/core/src/providers
```

**depends-on:** Group 1

---

## Dependencies
| Direction | Target | Notes |
|-----------|--------|-------|
| **depends-on** | `automagik/genie:bridge-tmux-session-config` | Genie must accept `env.GENIE_TMUX_SESSION` in the executor resolver. End-to-end dog-fooding requires both merged. This wish can be *implemented and merged* independently; the env key is a no-op on an older genie. |

## QA Criteria

_Verified on dev after both PRs merged._

- [ ] Regression: instances without `bridgeTmuxSession` set send payloads identical to pre-change baseline.
- [ ] Set field on pessoal-whatsapp to `whatsapp-scout-12`; trigger a real WhatsApp message; verify a tmux window is created under session `whatsapp-scout-12` on the genie tmux socket.
- [ ] Set field on felipe-whatsapp to `whatsapp-scout-11`; trigger a real WhatsApp message in a routed chat; verify tmux window created under `whatsapp-scout-11`.
- [ ] Unset the field on both; verify tmux windows land in the default `felipe-scout` (or whatever the yaml `bridgeTmuxSession` resolves to) session.
- [ ] Enterprise dogfood: create a third instance, set its field; verify isolation — no window leaks across the three sessions.
- [ ] NATS payload inspection (via `nats sub 'omni.message.>'`) shows `env.GENIE_TMUX_SESSION` iff the instance has the field set.

## Assumptions / Risks
| Risk | Severity | Mitigation |
|------|----------|------------|
| Existing Drizzle migrations assume a specific numbering/order | Low | Use `drizzle-kit generate` to emit the SQL with correct sequence; run against a fresh db to verify. |
| PATCH zod validator on `/instances` is strict and rejects extra fields | Low | Add the new field to the validator schema in Group 2. Roundtrip test catches any miss. |
| Provider already has a config object — adding instance-level field may require plumbing | Medium | Inspect the provider constructor and trigger path in Group 4; thread `instance.bridgeTmuxSession` through or query it at dispatch time. Keep scope tight: no refactor, just pass-through. |
| Older genie consumers on dev may see the env key without knowing what to do with it | None | Genie's sibling wish defines the key; unknown env keys are ignored by older genie consumers. |

---

## Review Results

### Plan Review — 2026-04-21 (SHIP)
All 7 Plan Review checklist items pass. Zero gaps. Ready for `/work`.

- Problem statement: testable via CLI + NATS payload
- Scope IN: 7 concrete deliverables
- Scope OUT: 5 explicit exclusions
- Acceptance criteria: checkboxed per group (G1–G4)
- Execution groups: migration first, then API + CLI + provider in parallel
- Dependencies: G2/G3/G4 → G1; cross-wish `depends-on: automagik/genie:bridge-tmux-session-config`
- Validation: `bun test packages/...` per group

_Populated by `/review` after execution completes._

---

## Files to Create/Modify

```
packages/db/drizzle/<next-seq>_bridge_tmux_session.sql      (CREATE — migration)
packages/db/src/schema.ts                                   (MODIFY — instances table)
packages/api/src/routes/instances/*.ts                      (MODIFY — GET/PATCH handlers + zod)
packages/api/src/routes/.../__tests__/instances.test.ts     (MODIFY — API tests)
packages/sdk/src/types/instance.ts                          (MODIFY — type export)
packages/cli/src/commands/instances.ts                      (MODIFY — flags)
packages/cli/src/__tests__/instances.test.ts                (MODIFY — CLI tests)
packages/core/src/providers/nats-genie-provider.ts          (MODIFY — env propagation)
packages/core/src/providers/__tests__/nats-genie-provider.test.ts (MODIFY — provider tests)
```
