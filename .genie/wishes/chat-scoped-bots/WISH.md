# Wish: Chat-scoped bots on permanent Omni threads

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `chat-scoped-bots` |
| **Date** | 2026-11-11 |
| **Author** | Sofia (assigned Omni planning worker, for Felipe Rosa) |
| **Appetite** | medium — size M, one wish, three sequential groups |
| **Branch** | `docs/chat-scoped-bots-wish` (planning); execution branches from fresh `origin/dev` after approval |
| **Repos touched** | omni (`apps/omni-channels-dsh`, `packages/api`) |
| **Design** | [DESIGN.md](../../brainstorms/chat-scoped-bots/DESIGN.md) |

## Summary

Extend RFC-0001 chat threads into permanent workers for explicit chat sets. The
Omni Bot or the owner's sidebar "+" creates a thread immediately, with its own
notes and a child key for exactly its chats; automations follow those chats into
the thread. This PR records the reviewed design and the execution plan only;
product implementation waits for independent plan approval.

The design is SHIP (2026-11-10), WRS 100, reviewed content SHA-256
`adcb2024607869bb8a67f58e7fa7f0888d8753bfa2807a6360f178abb1fc3c3c`.
The governing record is [RFC-0001](../../../docs/rfcs/0001-chat-threads.md).
The source decisions remain in [DRAFT.md](../../brainstorms/chat-scoped-bots/DRAFT.md).

## Scope

### IN

- G1, design IN rows 1–3: `chatIds` and notes on thread records, old-record
  migration, chat-to-thread lookup and exclusive membership, one multi-chat child
  key with each chat's instance/recipient lock, and key re-issue on membership changes.
- G2, design IN rows 4–6: `create_thread(chats, title, notes)`, sidebar multi-chat
  creation, explicit-list automation creation at save, cross-thread refusal,
  channel-wide event-time routing, external-message-id dedupe, a thread's
  automation list and deletion question, and the existing owner-controlled send rule.
- G3, design IN row 7: Omni Bot rules and tool/prompt descriptions agree with
  permanent threads, explicit sets and the two automation creation times.

### OUT

- Automatic linking of the same group on two WhatsApp lines; the owner selects
  both chats manually. Revisit after a second duplicate the owner trips on or a
  request to link all chats.
- An Omni-side agent provider opening DSH sessions; DSH continues pulling events.
- A new chat-scoped Bot type or changes to the external bots-dsh package.
- Reading the Omni Bot's full memory from a thread or building shared thread memory.
- The 30-day pending sweep, reading methodology and `pendingOnly` changes; those
  need their own brainstorm.
- Product code, generated SDK changes, service startup, database access, execution
  task dispatch or self-approval in this planning PR.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Extend RFC-0001 sessions, rather than add a Bot type or provider | Permanent sidebar sessions, tools, model following, keys and send controls already exist (R1-1) |
| 2 | One explicit chat set per thread; a chat belongs to at most one thread | Cross-line grouping is manual; a chat resolves to one destination (R1-2) |
| 3 | Omni Bot base first, fixed thread instructions second, own notes last | Context without full-memory inheritance (R1-3) |
| 4 | Create through the Omni Bot tool and the owner's "+" | Both must show the thread before its first turn (R2-1) |
| 5 | Explicit-list `worker: thread` automations establish their thread at save; `channel:<id>` automations route at event time | A channel's future chats are unknown at save; retain `{ kind: 'thread' }` without a thread id (R2-2, reviewer HIGH-2) |
| 6 | No send override on new threads and no tool-writable send permission | Follow the owner's global default, ask unless the owner changed it; preserve the owner's switch (R2-3) |
| 7 | One child key covers the set, preserving each chat's own instance/recipient lock | Independent broad instance and recipient lists must not grant other chat/instance combinations (R2-4, reviewer HIGH-1) |
| 8 | G1 → G2 → G3, with one writer at a time | `threads.js` is shared by all three; descriptions follow the implemented behavior |

## Simplicity Case

- **Simplest complete design:** extend the existing record with `chatIds` and
  `notes`, extend the existing child mint, add one create tool and multi-select
  picker, and create explicit-list automation threads at save. No new table,
  process, provider, Bot type or second routing layer.
- **Added machinery:** multi-chat child minting is necessary for one key to reach
  the explicitly named chats across instances; an external message id must reach
  dispatch to collapse duplicate delivery from two selected lines.
- **Deferred until measured:** automatic cross-line linking uses the trigger in
  OUT; shared thread memory waits for a request to remember across sets.
- **Complexity removed:** automations carry no thread id; chat membership decides
  routing. Reuse existing persistence, rollback, key revocation and queue paths.

## Dependencies

**depends-on:** none
**blocks:** none

RFC-0001 is the existing foundation. Design preflight must pass on the copied
bytes before wish edits. Plan review by the Omni Reviewer is pending after this
PR opens; DRAFT is not permission to start execution. After APPROVED, the
orchestrator reconciles/creates one task per group and records the wave base with
`genie context --wish chat-scoped-bots`; this PR creates no execution tasks.

## Success Criteria

- [ ] All twelve design criteria are proven by their sole owning group below,
  and TEXT1 proves IN row 7 before final independent review.

The design has twelve success criteria, numbered SC1–SC12 in source order. Each
is assigned to exactly one group below; its full assertion and proof live in
that group's Acceptance Criteria. TEXT1 covers design IN row 7, which has no
separate checkbox in the design's Success Criteria.

| Design criterion | Sole owner | Behavior |
|------------------|------------|----------|
| SC1 | G2 | Bot creates one sidebar thread for three chats at once |
| SC2 | G2 | Events from all three chats use that session |
| SC3 | G1 | Child key reads its three chats and refuses a fourth |
| SC4 | G2 | Explicit-list automation has a thread immediately after save |
| SC5 | G2 | Channel source creates nothing at save and routes at event time |
| SC6 | G2 | New thread follows global send default; tools cannot set it |
| SC7 | G1 | Legacy one-chat records still work |
| SC8 | G1 | Prompt order is Omni Bot base, fixed instructions, notes |
| SC9 | G2 | Sidebar "+" creates one thread from two picked chats |
| SC10 | G1 | Add and remove each replace the key with the exact new set |
| SC11 | G2 | Thread lists automations for its chats |
| SC12 | G2 | Conflicting explicit lists are refused by name; deletion asks |
| TEXT1 (IN 7) | G3 | Rules and descriptions explain the behavior implemented by G1/G2 |

## Execution Strategy

### Wave 1 (sequential)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 1 | engineer | High authority risk: multi-instance child ceiling, key replacement and legacy persistence; bounded to data/key surfaces | inherit | Data, notes and multi-chat child key |
| 2 | engineer | High coupling: creation, sidebar and automation save/dispatch share membership; depends on G1's key contract | inherit | Creation and routing with send controls preserved |
| 3 | engineer | Low risk: text follows completed behavior; sequential because it revisits shared host files | inherit | Omni Bot text and final aggregate verification |

**Global constraints:**
- Validate every external boundary with Zod.
- Represent state changes with events.
- Never edit a deployed migration or use `drizzle push` against shared or production databases.
- Change the schema and its generated SQL migration together.
- Inspect nearby code and established repository patterns before implementing.
- Do not start services, access databases or production systems, or send external messages without explicit approval.
- Prefer safe static gates for routine validation.
- Use a disposable database for database-backed or full integration tests.
- Code, commits and PRs cite `RFC-NNNN` or an ADR key, never a `.genie` path or a wish slug. Write IETF standards with a space ("RFC 4122").

Every Bun/make invocation on this host, including those in commit/push hooks, must
run inside the shared gate wrapper:
`env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh <cmd>`.
Never bypass or time out the wrapper. Set `OMNI_GATE_WRAPPER` to that path in
execution briefs. Group checks supplement repository-required gates: `make
verify-rfcs`, `make lint`, and the normal pre-push typecheck/full-suite contract.
Database-backed execution checks require approval and a disposable database;
the planning PR runs only its authorized static checks. No hook bypass is
implicit. A dependency or unavailable validation blocks that execution handoff.

## Execution Groups

### Group 1: Data, notes and the chat-set key

**Goal:** Supply a compatible thread record and a child key whose authority is
exactly the explicit set, before exposing new creation/routing entry points.

**Deliverables:**
1. Normalize legacy `chatId` to `chatIds: [chatId]`, with empty notes, preserving
   thread/session identity, permission overrides, restart state and sidebar access.
   `byChat` resolves membership, and membership edits enforce one thread per chat.
   Moving a chat requires owner confirmation before changing either set.
2. Build prompts in the design's order: Omni Bot base, fixed thread instructions,
   own notes. Keep notes as thread context, with no full-memory coupling.
3. Extend the strict child API to accept a nonempty explicit UUID set; resolve
   every chat to its own instance/recipient on the server, check every ceiling,
   and retain root-only minting, scope/expiry bounds, cap, revocation and events.
   Preserve legacy single-chat callers and responses. Empty, invalid, missing or
   out-of-authority members mint nothing; no partial set is returned. Enforce
   instance/recipient pairing in `scope-enforcer.ts`: a body-addressed send by
   a multi-chat child passes only when its `instanceId` + `to` resolve to a
   member chat on that instance, in addition to the existing lock checks.
   Resolve with the existing `resolveChatRow(c, to, instanceId)` helper and
   require the returned row's `instanceId` to equal the body's instance and its
   UUID to be in the child's `chatAllowlist`; a raw JID match alone is insufficient.
   Existing child minting already stores chat UUIDs in that list, and existing
   chat rows carry their own instance. Keep every member UUID in the list and
   derive the pair from those rows at authorization time: no new key storage,
   schema, migration or cached pairing map. Missing/unresolvable/nonmember rows
   fail closed. Regenerate `omni-routes.js` when the child-mint summary changes.
4. Migrate the local key-file entry/waiting records as well as thread records;
   relink/drain retries retain the whole set. Add/remove each replace the child
   and retire the old authority; failure stays disconnected rather than using
   the link key or leaving a removed chat usable through the old child.

**Files owned:**
- `apps/omni-channels-dsh/src/host/threads.js` — record normalization, membership,
  lookup and prompt assembly; G2/G3 take sequential ownership afterward.
- `apps/omni-channels-dsh/src/host/thread-keys.js` — key-file compatibility,
  mint/replacement, drain and handover.
- `packages/api/src/services/api-keys.ts`, `packages/api/src/routes/v2/keys.ts`,
  `packages/api/src/schemas/openapi/keys.ts` — bounded mint and its wire schema.
- `packages/api/src/middleware/scope-enforcer.ts` and
  `packages/api/src/middleware/__tests__/scope-enforcer.test.ts` — resolve each
  body-addressed instance/recipient pair to a member chat and prove refusal of
  cross-instance combinations.
- `apps/omni-channels-dsh/src/host/omni-routes.js` — generated route descriptions;
  regenerate with `node apps/omni-channels-dsh/scripts/build-client.mjs` when the
  `POST /keys/children` summary changes, never edit the generated file by hand.
- `apps/omni-channels-dsh/test/threads.test.js`, `test/thread-keys.test.js`,
  `test/thread-fixture.js` (all under `apps/omni-channels-dsh/`).
- `packages/api/src/routes/v2/__tests__/keys-device-child.test.ts` and
  `packages/api/src/services/__tests__/api-key-children-postgres.test.ts`.

**Interfaces:**
- Consumes: `ChildChat = { id: string; externalId: string; instanceId: string }`
  from the current service; existing record/session/key lifecycle and `rt.save()`.
- Consumes: existing `resolveChatRow(c, raw: string, explicitInstanceId?: string): Promise<Chat | null>`
  from `packages/api/src/lib/resolve-chat-id.ts`; `Chat` includes `id`, `instanceId`
  and `externalId`. Native recipients use instance-scoped `findByExternalIdSmart`;
  require the resolved UUID to be a member even if the JID appears in the flat list.
- Produces: normalized records retain existing fields and add
  `chatIds: string[]; notes: string`; `rt.threads.byChat(chatId: string): Thread | undefined`
  resolves any member. Existing scalar chat/channel fields stay as compatibility
  presentation fields, never as the full membership or authority source.
- Produces: `ApiKeyService.mintChild(parentId: string, chats: ChildChat | ChildChat[]): Promise<MintChildResult>`;
  `POST /keys/children` accepts exactly `{ chatId: string }` or `{ chatIds: string[] }`.
  The set response adds `chats: ChildChat[]` to the existing key metadata; the
  legacy single-chat response keeps `chatId`, `chatExternalId`, `instanceId`.
- Produces: `rt.threadKeys.mint(threadId: string, chatIds: string | string[]): Promise<MintResult>`
  and `rt.threadKeys.replace(threadId: string, chatIds: string[]): Promise<MintResult>`;
  `MintResult = { ok: true } | { ok: false; reason: string; reasonCode?: string }`
  with existing optional mint metadata retained. `keyFor(threadId): string | null`
  and revoke semantics remain the consumers' fail-closed boundary.

**Acceptance Criteria:**
- [ ] **SC3:** The thread's key reads only its 3 chats. **Proof:** an API test in
  `packages/api/src/routes/v2/__tests__/` minting a multi-chat child key and
  asserting a fourth chat is refused.
- [ ] **SC7:** Existing one-chat threads keep working. **Proof:** a migration test
  loading an old record with `chatId`.
- [ ] **SC8:** The thread's notes are in its prompt, after the Omni Bot base and
  the fixed thread instructions. **Proof:** a host test asserting that order in
  the thread prompt.
- [ ] **SC10:** Adding or removing a chat re-issues the key. **Proof:** host tests
  asserting the old key is replaced and the new allowlist matches the set after
  an add and after a removal.
- [ ] A multi-chat child for {Fin Ops on line 1, Fin Ops on line 2, Luiza DM
  on line 1} refuses `POST /messages/send` with `instanceId=line2` and
  `to=<Luiza JID>`, even though both values occur in its independent flat lists.
  **Proof:** in `packages/api/src/middleware/__tests__/scope-enforcer.test.ts`,
  exercise the real middleware with those three member UUIDs and assert **403**
  before the send handler is reached; repeat with a Luiza row on line 2 present
  in the database but absent from the member UUIDs, and with no such row. Valid
  sends to each of the three actual member pairs pass. In
  `packages/api/src/routes/v2/__tests__/keys-device-child.test.ts`, mint that set
  through the API and prove the same wrong-pair refusal through real auth and
  scope enforcement. This proves pairing from existing chat rows and the
  existing key allowlist, without new storage.
- [ ] Re-mint, parent narrowing and local persistence failure retain existing
  fail-closed guarantees. Generated `omni-routes.js` agrees with the changed
  child-mint summary.

**Validation:**
```bash
env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh sh -c 'cd apps/omni-channels-dsh && node --import ./test/harness-resolve.mjs --test test/threads.test.js test/thread-keys.test.js'
env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh bun test packages/api/src/middleware/__tests__/scope-enforcer.test.ts packages/api/src/routes/v2/__tests__/keys-device-child.test.ts
```
The first command uses fake DSH/Omni, and the second uses the existing in-memory
Drizzle fixture and real auth/scope middleware. Neither needs a live service.
The disposable PostgreSQL lineage/concurrency test is an additional execution
check after its required approval, before claiming that guarantee.

**depends-on:** none

---

### Group 2: Creation, automation ownership and event routing

**Goal:** Make the named thread appear immediately and route its chats' work
through that session, preserving the owner's permission choices.

**Deliverables:**
1. Register `create_thread(chats, title, notes)` for the Omni Bot and extend the
   sidebar "+" to select several chats, including across channels, before one
   save. Both create one permanent session/record/key through the same host path,
   expose all member chat ids in the view, and draw one thread row for the set.
2. For explicit-chat-list `worker: thread` saves, resolve the complete set before
   persisting: reuse its thread or create one at save. If members are in different
   existing threads, refuse and name those threads without partial mutation;
   the owner or Omni Bot moves chats first with owner confirmation. Do not attach
   thread ids to automations. Channel-wide sources create no thread at save.
3. Route every event through membership lookup; a channel-wide event uses its
   chat's existing set or the existing `ensure` path for a new one-chat thread.
   Keep the 50 automation-created thread cap and serialized creation behavior.
4. Carry the external message id from the event bridge for text as well as media
   into thread dispatch. Skip a second delivery of the same message from another
   selected line, while preserving distinct messages and legitimate automation
   matches; journal-row `ref` alone cannot detect the cross-line duplicate.
5. Project the thread's automations from chat membership, show that list, and ask
   what to do with them before deleting its session/key/record. Cancelling the
   question changes nothing; removal continues through existing cleanup paths.
6. New records have no own send override. Tool schemas cannot set send rights;
   the global default and existing owner-only switch remain authoritative. Audit
   single-chat assumptions in thread tools so reads, sends, reactions and media
   membership checks select only a member chat and retain its instance/recipient.

**Files owned:**
- `apps/omni-channels-dsh/src/host/threads.js` — set creation/view, owner endpoints,
  membership edits and removal question (after G1).
- `apps/omni-channels-dsh/src/host/thread-tools.js` — creation tool and membership-aware
  existing thread tools/permission gates.
- `apps/omni-channels-dsh/src/host/subscriptions.js` — save policy, ownership list,
  dispatch and cross-thread refusal.
- `apps/omni-channels-dsh/src/host/omni-events.js` — external-id propagation.
- `apps/omni-channels-dsh/src/client/omni-tree.js` — picker, single row per set,
  automation list and deletion question in the existing sidebar surface.
- `apps/omni-channels-dsh/test/threads.test.js`, `test/thread-tools.test.js`,
  `test/subscriptions.test.js`, `test/omni-events.test.js`, `test/omni-tree.test.js`,
  `test/thread-fixture.js` (all under `apps/omni-channels-dsh/`).

**Interfaces:**
- Consumes: G1's `chatIds`, `notes`, membership lookup, `mint`/`replace` and
  `keyFor` contracts. Existing `{ kind: 'thread' }` worker shape is unchanged.
- Produces: `create_thread(chats: { channelId: string; chatId: string }[], title: string, notes: string)`
  and host `rt.threads.create(chats, title, notes): Promise<{ ok: true; thread: Thread } | { ok: false; reason: string }>`;
  Zod validates UUIDs and nonempty membership. Neither accepts send permissions.
  Existing `add(channelId, chatId, options)` and `ensure(channelId, chatId)` remain
  compatible one-chat adapters for existing callers.
- Produces: `omni-thread-add` accepts the existing `{ channelId, chatId }` or
  `{ chats: { channelId: string; chatId: string }[]; title: string; notes: string }`,
  returning the existing `{ ok: true; threadId: string; sessionId: string }` on success.
- Produces: `rt.threadsView().omniThreads` rows include `chatIds: string[]` and
  `automations: { id: string; name: string }[]`; the row id/session id identifies
  one set even when its chats span channels. G3 describes these behaviors.
- Produces: `rt.fireSubscription(sub, event)` retains its signature; `event.externalId?: string`
  carries the external message id in addition to `ref`, `chatId` and `instanceId`.
  Dedupe runs before queue admission in the thread dispatch path and remains
  scoped to the destination and automation so distinct matching automations survive.

**Acceptance Criteria:**
- [ ] **SC1:** The owner asks the Omni Bot for a worker on Fin Ops (both lines)
  plus Luiza's DM; one thread with those 3 chats appears in the sidebar at once.
  **Proof:** a host test in `apps/omni-channels-dsh` that calls `create_thread`
  with 3 chats and asserts the sidebar tree lists one thread with 3 chats.
- [ ] **SC2:** An event on any of the 3 chats runs in that thread. **Proof:** a
  host test dispatching events from each chat id and asserting one thread session
  receives all three.
- [ ] **SC4:** Saving a `worker: thread` automation with an explicit chat list
  shows its thread before any event. **Proof:** a host test asserting the thread
  exists right after save.
- [ ] **SC5:** A channel-wide (`channel:<id>`) automation keeps event-time routing:
  no thread at save, an event goes to the thread holding its chat or a new
  one-chat thread. **Proof:** a host test for both cases.
- [ ] **SC6:** A new thread has no send setting of its own and follows the
  owner's global default; no tool can set it. **Proof:** a host test asserting
  `create_thread` ignores a send setting and the gate applies the global default.
- [ ] **SC9:** The sidebar "+" makes one thread from several picked chats.
  **Proof:** a client/host test of the add operation with 2 chats.
- [ ] **SC11:** The thread lists the automations whose chats it holds.
  **Proof:** a host test asserting the list after saving two automations on its chats.
- [ ] **SC12:** Saving an explicit-list automation whose chats sit in two
  threads is refused, naming them; deleting a thread asks about its automations.
  **Proof:** host tests for both.
- [ ] A cross-line duplicate with different journal refs and the same external
  message id enters the thread once per matching automation; a different external
  id still runs. Text and media paths both carry the identity. Cancelled deletion
  and refused saves leave the previous thread/key/automation state intact.

**Validation:**
```bash
env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh sh -c 'cd apps/omni-channels-dsh && node --import ./test/harness-resolve.mjs --test test/threads.test.js test/thread-tools.test.js test/subscriptions.test.js test/omni-events.test.js test/omni-tree.test.js'
```
Use the existing fake host/Omni and client stand-ins. Assert the three-chat
scenario across two instances, not only a same-channel fixture. This focused
check does not replace aggregate repository gates.

**depends-on:** 1

---

### Group 3: Accurate Omni Bot descriptions and final verification

**Goal:** Make the Omni Bot explain and use the permanent threads implemented by
G1/G2, then verify the complete feature against the governing design.

**Deliverables:**
1. Update `omni-rules.js` to explain one permanent sidebar thread per explicit
   chat set, own notes over the base prompt, the create tool and sidebar "+".
2. Align `save_automation` worker descriptions, thread prompt/help text and
   `create_thread` descriptions with explicit-list creation at save, channel-wide
   creation at first event, conflict refusal and the owner-controlled send rule.
   Remove stale one-thread-per-chat or ephemeral/invisible claims.
3. Verify text with host tests of registered tool descriptions and assembled
   prompts, then run the plugin suite and repository aggregate gates. Re-check
   that OUT items stayed out; final approval belongs to an independent reviewer.

**Files owned:**
- `apps/omni-channels-dsh/src/host/omni-rules.js`.
- `apps/omni-channels-dsh/src/host/subscriptions.js`, `src/host/threads.js`,
  `src/host/thread-tools.js` (under `apps/omni-channels-dsh/`, descriptions only,
  after G2; no concurrent writers).
- `apps/omni-channels-dsh/test/subscriptions.test.js`, `test/threads.test.js`,
  `test/thread-tools.test.js` (under `apps/omni-channels-dsh/`).

**Interfaces:**
- Consumes: G2's `create_thread(chats, title, notes)`, unchanged thread worker
  shape, save/event policies, set view and owner permission boundary.
- Produces: `OPERATOR_RULES: string` and registered tool descriptions/system
  prompt text matching those exact interfaces; no new runtime signature.

**Acceptance Criteria:**
- [ ] **TEXT1 (design IN 7):** Rules, tool descriptions and prompts describe
  permanent sidebar sessions, one per explicit chat set, and all four creation
  paths: `create_thread`, sidebar "+", explicit-list automation at save,
  channel-wide automation at the first event. Host tests inspect the text actually
  registered with the tools/prompt hooks and check it against G2 behavior.
- [ ] The descriptions preserve ask-first/global-default behavior and owner-only
  send control, explain cross-thread refusal, and promise no full-memory
  inheritance, new Bot type, provider or pending sweep.
- [ ] Full plugin checks plus repository-required aggregate gates pass on the
  integrated G1/G2/G3 tree; independent review records the actual tested SHA and
  any approval-dependent checks that remain unrun.

**Validation:**
```bash
env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh sh -c 'cd apps/omni-channels-dsh && node --import ./test/harness-resolve.mjs --test "test/*.test.js"'
env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh make verify-rfcs
env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh make lint
```
Also preserve the normal pre-push typecheck/full-suite gate and any disposable
DB checks required by the implementation. Obtain the repository's required
approval before running database/service checks; never imply that the static
commands alone qualify the product implementation.

**depends-on:** 2

---

## QA Criteria

_Execution QA after merge uses approved local/disposable fixtures; these are not
claims that product behavior was tested by this planning PR._

- [ ] Follow the SC1–SC12 ownership map against fresh evidence on the integrated
  revision, including a restart with a legacy one-chat record.
- [ ] From the Omni Bot and sidebar, create the Fin Ops pair plus Luiza set;
  observe one persistent row/session and the expected prompt ordering.
- [ ] Observe immediate explicit-list save, lazy channel-wide routing, conflict
  refusal, automation ownership list and cancellation of the deletion question.
- [ ] Verify the child cannot read a fourth chat or cross an instance/recipient
  lock, membership changes retire the old key, and send approval still follows
  the owner's global default and switch.
- [ ] Observe one dispatch for the same external message from both lines and
  separate dispatches for distinct messages; compare Omni Bot wording to behavior.

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Multi-chat authority widens a session and could form unintended instance/recipient combinations | High | G1 owns scope-enforcer.ts and its test; resolve the send's body instance/recipient to an existing chat row, require its UUID in the child's existing allowlist, and prove the Luiza-on-line-2 refusal through middleware and a minted child |
| Records and key-file retry entries currently store one `chatId` | Medium | Normalize both; preserve old identity/overrides and full-set relink/drain behavior |
| Shared host files invite conflicting writers | Medium | Strict G1 → G2 → G3 ownership transfer; one PR per implementation group after approval |
| Two selected lines deliver the same external message | Medium | Carry external id for all message paths; dedupe before queue admission; test duplicates and distinct ids |
| Concurrent adds or partial key/persistence failures leave stale membership or authority | Medium | Reuse serialization/rollback and fail closed; owner confirmation precedes moves |
| API/prompt signatures drift during implementation | Medium | G1/G2 publish exact interfaces above; G3 tests registered descriptions after the implementation settles |
| DSH test peers may be absent from a new worktree | Low | Existing `test/harness-resolve.mjs` resolves installed/nearby pinned peers; report an unavailable dependency rather than claiming an unrun test passed |
| 50-thread automation cap and existing permission/restart behavior regress | Low | Preserve current cap, owner-only controls and regression fixtures |

---

## Review Results

- **2026-11-11 — Design preflight:** the copied DESIGN.md passed
  `node /Users/feliperosa/.claude/skills/brainstorm/references/design-review-evidence.mjs verify .genie/brainstorms/chat-scoped-bots/DESIGN.md`
  with exit **0**. Reviewed content digest remains
  `adcb2024607869bb8a67f58e7fa7f0888d8753bfa2807a6360f178abb1fc3c3c`;
  reviewer `codex-sofia (Omni Reviewer t3q7)`, reviewed 2026-11-10T21:30:10.000Z.
- **Planning validation:** gated `make verify-rfcs` exit **0** (29 tests),
  gated `make lint` exit **0** (1,910 files), and isolated `genie wish lint`
  exit **0** for this wish. No execution handoff is approved.
- **2026-11-11 — Independent plan review at `d7a28458db86c3b46c3f731dd5959ddb32b52cc4`:**
  FIX-FIRST, one HIGH (HIGH-1), reviewer Claude (Opus 5.5), read-only Omni Reviewer.
  G1 omitted the middleware needed to enforce each chat's instance/recipient pair;
  the three flat allowlists admitted Luiza on the wrong line. The review also
  noted missing ownership of generated `omni-routes.js`.
- **Bounded plan repair:** G1 now owns that middleware/test and the generated
  route file, names the existing-row/UUID pairing check and exact negative proof,
  and removes the implementation-time contingency. Inspection of
  `resolve-chat-id.ts` and `services/chats.ts` confirms the existing instance-scoped
  lookup returns the row UUID/instance; existing `chatAllowlist` stores member
  UUIDs, so no new key storage is needed. DESIGN.md and DRAFT.md stay unchanged.
- **Plan re-review:** PENDING — Omni Reviewer after push. Status remains DRAFT;
  the author does not assert that HIGH-1 is independently cleared or the plan approved.
- **Execution / PR review:** not run; no product implementation in this PR.

---

## Files to Create/Modify

Planning PR (only these four files):

```
.genie/brainstorms/chat-scoped-bots/DESIGN.md  (byte-for-byte copy)
.genie/brainstorms/chat-scoped-bots/DRAFT.md   (byte-for-byte copy)
.genie/INDEX.md                             (one Ready entry only)
.genie/wishes/chat-scoped-bots/WISH.md        (this DRAFT plan)
```

Execution ownership is listed per group above. The unique product file set is:

```
# G1; threads.js and its fixtures transfer sequentially to G2/G3
apps/omni-channels-dsh/src/host/threads.js
apps/omni-channels-dsh/src/host/thread-keys.js
packages/api/src/services/api-keys.ts
packages/api/src/routes/v2/keys.ts
packages/api/src/schemas/openapi/keys.ts
packages/api/src/middleware/scope-enforcer.ts
packages/api/src/middleware/__tests__/scope-enforcer.test.ts
apps/omni-channels-dsh/src/host/omni-routes.js  (generated)
packages/api/src/routes/v2/__tests__/keys-device-child.test.ts
packages/api/src/services/__tests__/api-key-children-postgres.test.ts
apps/omni-channels-dsh/test/threads.test.js
apps/omni-channels-dsh/test/thread-keys.test.js
apps/omni-channels-dsh/test/thread-fixture.js
# G2; descriptions/tests transfer sequentially to G3 where listed
apps/omni-channels-dsh/src/host/thread-tools.js
apps/omni-channels-dsh/src/host/subscriptions.js
apps/omni-channels-dsh/src/host/omni-events.js
apps/omni-channels-dsh/src/client/omni-tree.js
apps/omni-channels-dsh/test/thread-tools.test.js
apps/omni-channels-dsh/test/subscriptions.test.js
apps/omni-channels-dsh/test/omni-events.test.js
apps/omni-channels-dsh/test/omni-tree.test.js
# G3
apps/omni-channels-dsh/src/host/omni-rules.js
```
