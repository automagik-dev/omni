# Wish: Answer mode for a dedicated Omni Bot

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `omni-bot-answer-mode` |
| **Date** | 2026-11-11 |
| **Author** | Sofia (assigned Omni planning worker, for Felipe Rosa) |
| **Appetite** | large — size G, four sequential groups |
| **Branch** | `docs/omni-bot-answer-mode-wish` (planning); execution branches from fresh `origin/dev` after approval |
| **Repos touched** | omni (`apps/omni-channels-dsh`) |
| **Design** | [DESIGN.md](../../brainstorms/omni-bot-answer-mode/DESIGN.md) |

## Summary

A dedicated Omni Bot owns one or more channels. In answer mode its children are
permanent chat threads that answer the people writing there, using the master's
instructions and model plus their own notes, with bounded tools, training and
staff take-over. This PR lands the reviewed design and a draft execution plan;
it implements no product behavior and authorizes no execution.

Design SHIP, WRS 100, reviewed 2026-11-11, content SHA-256
`95b8790c8e0f7e89003d30a23977e24a423f03469b40dbfbebda261784bd4c67`.
The source decisions remain in [DRAFT.md](../../brainstorms/omni-bot-answer-mode/DRAFT.md).
Build on [RFC-0001](../../../docs/rfcs/0001-chat-threads.md) and the approved
[chat-scoped-bots plan](../chat-scoped-bots/WISH.md).

## Scope

### IN

| Design IN | Sole owner | Deliverable |
|-----------|------------|-------------|
| 1 | G1 | Several Omni Bots, exactly one owning bot per channel; events, automations and threads belong to that bot; the default bot retains read-only sight of handed-over channels |
| 2 | G1 | Owner-confirmed dedicated-bot creation and channel hand-over through the sidebar and a proposing default-bot tool |
| 3 | G2 | Answer mode; create a child at a person's first message; master instructions and model, then child notes writable by the master |
| 4 | G2 | Read-only preset, own-chat read/reply/react/media plus owner-allowed tools; no shell/file writes; isolated default or collective reads within the answer bot, including shared notes, with own-chat writes only |
| 5 | G3 | Training asks before every send, staff choose sending per child, bot default for new children, optional graduation after N consecutive unchanged approved drafts |
| 6 | G4 | Positive own-device receipt pauses that child; API sends never count; staff resume or timed resume after 30 minutes of staff silence, configurable per answer bot |

### OUT

- Learning historical conversations, history backfill, persona imitation and
  offering to take over based on learned history: a second design (R4-1).
- Network isolation, read confinement or a separate OS user for children. DSH's
  sandbox covers file writes; stronger isolation is a deployment concern.
- Staff take-over for provider channels that do not ingest staff-message echoes
  with positive own-device evidence. Revisit when the channel supplies it.
- Any product name or product claim: answer mode is a generic mode of an Omni Bot.
- New Bot kinds, external team-package changes, database/schema changes,
  production access or product implementation in this planning PR.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | One channel, one owning Omni Bot; the default bot reads handed-over channels | Prevent duplicate responders while retaining owner reports (R1-2, R2-2) |
| 2 | Sidebar and default-bot proposals converge on owner confirmation | No bot or channel move exists before the owner confirms (R2-1, R3-3) |
| 3 | Children reuse permanent chat threads and inherit their master | No new Bot kind or session per message; master instructions/model then own notes (R1-3) |
| 4 | Visibility is per answer bot, isolated by default; collective shares reads, never destinations | Scope remains comprehensible and own-chat writes remain enforced (R1-1, R2-4) |
| 5 | Children remain on read-only with restricted tools, including after sending is enabled | Sending permission does not grant shell, file writes or other-chat writes (R3-2) |
| 6 | Training is the initial default; staff can select sending and a new-child default; optional N-draft graduation | Trust is earned per child (R4-2) |
| 7 | Staff means a positively proven own-device receipt, never an attributed or unattributed API send | Avoid a bot's own reply pausing itself (reviewer HIGH-1) |
| 8 | Resume by staff button/master or 30 minutes after the last staff message | Human control with the owner-selected default (R2-3, R3-1) |
| 9 | G1 → G2 → G3 → G4, after chat-scoped-bots G3 merges | Shared files transfer between writers; prompts describe settled interfaces |

## Simplicity Case

- **Simplest complete design:** extend existing bot/channel ownership and thread
  records, prompt section, child keys, tool guards, approval cards and event queue.
- **Added machinery:** one ownership map for multiple Omni Bots (R1-2); answer
  settings and bounded collective reads (R1-1/R2-4); per-child training and an
  optional approval streak (R4-2); per-chat pause/deadline (R1-4/R3-1).
- **Deferred until measured:** history learning stays in its second design;
  per-channel visibility waits for an owner needing both modes on one bot.
- **Complexity removed:** no new Bot kind, parallel responder, destination chosen
  by a child, thread id on automations, new store or history-learning pipeline.

## Dependencies

**depends-on:** chat-scoped-bots
**blocks:** none

All four groups wait for chat-scoped-bots G3 (`feat/chat-scoped-bots-g3`) to merge
to `dev`. G1/G2 already establish permanent chat sets and child keys; G3 changes
`omni-rules.js`, `threadInstructions` and tool descriptions. Reconcile its merged
interfaces from fresh `origin/dev` before implementation; do not edit its branch.
Independent plan approval is also required. This wish remains DRAFT; the owner
routes plan review after this PR opens, creates/reconciles task rows only after
APPROVED, then records the wave base with `genie context --wish omni-bot-answer-mode`.

Release baseline: `@automagik/omni-channels-dsh` **2.261111.9** and the existing
Omni API minimum **2.261102.41** (`engines.omni: ">=2.261102.41"`). The baseline
does not implement answer mode. Answer mode requires the first plugin cut
containing G1–G4; its exact version is recorded when that cut is made. No
downstream release floor has been selected. Each group preserves this API minimum
unless it introduces an API requirement, in which case that group raises
`engines.omni` to its own cut and supplies compatibility proof per the repo rule.
Do not invent a future tag or claim the baseline has the feature.

The existing DSH preset/tool-registry and team session interfaces are prerequisites.
No external package modification is authorized. An unavailable required interface
is a blocker to return to the owner, not a reason to widen this plan silently.

## Success Criteria

The eight design criteria are SC1–SC8 in source order. Every criterion has one
owner below; its complete assertion and proof appear only in that group's
Acceptance Criteria. IN2's sidebar path and IN5's bot default have additional
acceptance coverage in their owning groups.

| Design criterion | Sole owner | Proof command |
|------------------|------------|---------------|
| SC1 | G1 | G1 focused host/client tests |
| SC2 | G1 | G1 focused confirmation tests |
| SC3 | G2 | G2 thread prompt/routing tests |
| SC4 | G2 | G2 preset/tool/key tests |
| SC5 | G2 | G2 visibility tests |
| SC6 | G3 | G3 send/approval tests |
| SC7 | G4 | G4 own-device/fake-clock tests |
| SC8 | G4 | G4 full plugin suite on unchanged one-bot fixtures |

- [ ] Each owning group returns its mapped assertions, runnable proof and tested
  revision; final independent review assesses the integrated tree.

## Execution Strategy

### Wave 1 (sequential)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 1 | engineer | High authority risk: ownership routing and all mutation paths must agree; bounded to existing plugin surfaces | inherit | Ownership and confirmed hand-over |
| 2 | engineer | High trust-boundary risk: untrusted messages, prompts, preset and read/write ceilings; consumes G1 ownership | inherit | Answer children and isolation |
| 3 | engineer | Medium approval-state risk: exact draft correlation and per-child defaults/streak; consumes G2 guards | inherit | Training and sending |
| 4 | engineer | High ordering risk: positive receipts, pending sends, queues and restart-safe deadlines; final integration | inherit | Staff take-over and aggregate verification |

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
- Any product name or product claim: answer mode is a generic mode of an Omni Bot.

One writer at a time. Shared files and fixtures transfer in group order; never
revert another group's edits. Proposed typed contracts below describe new plugin
interfaces, not APIs that already exist. Validate tool/action/event payloads with
Zod and publish transitions through existing events/persistence conventions.
Each group must stay within 25 files / 2,000 insertions; exceeding either requires
returning to the owner to split a sibling wish, without dropping acceptance.

Every Bun/make invocation on this host, including commit/push hooks, runs inside:
`env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh <cmd>`.
Group checks do not replace the repository's required aggregate gates or full
pre-push hook. Build the client using the existing package build command when
client sources change; the owning group includes generated `client.js`.

## Execution Groups

### Group 1: Ownership and confirmed hand-over

**Goal:** Give every channel one owning Omni Bot and preserve the default bot's
read-only sight after an owner-confirmed hand-over (IN1–2).

**Deliverables:**
1. Own `src/host/{subscriptions,omni-events,grants,omni-api,thread-tools,threads,omni-rules}.js`
   and `src/client/{subscriptions,index,omni-tree}.js` within the plugin. Limit
   `threads.js` to owner identity/lookup and `omni-rules.js` to ownership wording;
   transfer both to G2. Own matching focused tests, shared fixture changes and
   generated `client.js`; no unrelated plugin refactor.
2. Persist a default bot and a channel→bot ownership map; missing legacy entries
   resolve to the default. Scope subscriptions, event dispatch, thread ownership,
   sidebar rows, automation boards/badges and worker lookup to that map. Recheck
   ownership at queued dispatch and tool execution; a stale sender cannot act.
3. Sidebar owner action and default-bot proposal tool share one confirmation
   transaction. Cancellation, missing confirmation, stale ownership and failed
   save leave no bot/move behind. A channel transfer cannot leave two active
   responders. Reject conflicting existing multi-chat membership rather than
   silently splitting or widening a thread across owning bots.
4. Apply the read-only rule at grants and raw API/tool boundaries too: default
   bot reads handed-over chats but cannot send/react/delete or run automations
   there, including through `omni_call`. Dedicated bots cannot mutate others'
   channels. Owner confirmation for management is explicit and separate.

**Interfaces:**
- Consumes: existing `rt.eventsBotId(): string | undefined`,
  `rt.threads.bySession(sessionId)` and G3's merged descriptions.
- Produces: `rt.channelOwner(channelId: string): string | undefined`;
  `rt.canChannel(botId: string, channelId: string, action: 'read' | 'write' | 'automate'): boolean`;
  thread `ownerBotId: string`; subscription `ownerBotId: string`;
  `propose_answer_bot({name: string, channelIds: string[]}): {proposalId: string}`;
  owner action `confirm_answer_bot({proposalId: string}): Promise<{botId: string}>`.
  Confirmation resolves actor identity from the owner action, never a model-supplied
  boolean; the sidebar can create a proposal and confirm through the same path.

**Acceptance Criteria:**
- [ ] SC1: two Omni Bots/two channels route each channel's events, automations
  and threads only to its owner; the default reads the handed-over channel while
  all mutation/automation paths there refuse. **Proof:** host routing and grants/API
  tests, including raw-call bypass and ownership changing while a run waits.
- [ ] SC2: the default tool proposes creation/move; no bot or ownership change
  occurs before owner confirmation. **Proof:** host tests for unconfirmed,
  cancelled, confirmed, stale and failed-save proposals.
- [ ] Sidebar creation and hand-over use the same owner-confirmed operation and
  render each bot's owned channels/automations; legacy default owns unassigned
  channels. **Proof:** focused host/client tests using the registered actions.

**Validation:**
```bash
env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh sh -c 'cd apps/omni-channels-dsh && node --import ./test/harness-resolve.mjs --test test/subscriptions.test.js test/omni-events.test.js test/grants.test.js test/omni-api.test.js test/thread-tools.test.js test/threads.test.js test/omni-tree.test.js test/automations-ux.test.js test/team-view.test.js'
env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh sh -c 'cd apps/omni-channels-dsh && bun run build && bun run lint'
```

**depends-on:** none

### Group 2: Answer children and isolation

**Goal:** Create a sandboxed child at the first message on an answer bot's channel,
with master instructions/model, own notes and bounded visibility (IN3–4).

**Deliverables:**
1. Own `src/host/{threads,thread-tools,thread-keys,omni-rules}.js`; take sequential
   ownership of G1's `subscriptions.js`, `omni-events.js`, `grants.js`, `omni-api.js`
   only for answer admission and visibility enforcement; own `src/client/omni-tree.js`
   for owner settings, matching tests/fixtures and generated `client.js`.
2. Reuse chat threads; one child for the person in that channel/chat, lazily on
   first message, idempotent on replay/concurrent delivery. Set/verify the DSH
   read-only preset before any event turn and on resume/agent recreation; fail
   closed if unavailable. Follow the owning master's model and instructions,
   then fixed answer instructions and own notes; the master can update notes.
3. Restrict the live registry and guard tool execution to own-chat read/reply/
   react/media plus owner-allowed tools. No shell/file-write tool can be allowed;
   owner additions never bypass the chat write ceiling. Deny generic tools,
   delegation, master-query or raw-call routes that escape visibility/destination.
4. One visibility setting per bot, isolated by default. Collective reads cover
   only that owning bot's chats and shared notes. Keep the child's write key
   locked to its one chat; mediate collective reads through a read-only scoped
   path, never expose a master key or widen a child's send allowlist. Shared
   notes are bot-owned persisted data, with a master-write/child-read interface.

**Interfaces:**
- Consumes: `rt.channelOwner`, `rt.canChannel`, thread/subscription `ownerBotId`
  from G1; existing `setReadOnly(rt, sessionId): Promise<string>` and child-key mint/revoke.
- Produces: bot `answer: {enabled: boolean, visibility: 'isolated' | 'collective', allowedTools: string[], sharedNotes: string}`;
  `rt.threads.answerFor({ownerBotId: string, channelId: string, chatId: string}): Promise<Thread>`;
  `rt.answerCanRead(threadId: string, chatId: string): boolean`;
  `rt.answerCanSend(threadId: string, chatId: string): boolean`;
  master-only `set_child_notes({threadId: string, notes: string})` and
  `set_answer_shared_notes({botId: string, notes: string})`.
  New children are `training` until G3 supplies the configurable sending policy.

**Acceptance Criteria:**
- [ ] SC3: the first message creates one child that answers that person with the
  owning master's instructions/model, followed by its own notes. **Proof:** host
  tests assert prompt order, master note/model updates, correct destination and
  idempotent creation; existing owner-facing threads retain their behavior.
- [ ] SC4: the child uses read-only; shell and every tool outside chat tools plus
  permitted owner additions refuse, and sends to another chat always refuse.
  **Proof:** host tests for preset failure/recreation, forged raw tool calls,
  forbidden owner additions and wrong-chat keys, including another chat on the
  same answer bot. Model-requested permissions cannot widen the ceiling.
- [ ] SC5: isolated children read only their own chat; collective children read
  other chats/shared notes of their master, but still write only their own chat.
  **Proof:** tests for both settings, a second bot's chat refusal, shared-note
  write refusal and narrowing visibility on an existing child.

**Validation:**
```bash
env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh sh -c 'cd apps/omni-channels-dsh && node --import ./test/harness-resolve.mjs --test test/threads.test.js test/thread-tools.test.js test/thread-keys.test.js test/subscriptions.test.js test/omni-events.test.js test/grants.test.js test/omni-api.test.js test/omni-tree.test.js'
env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh sh -c 'cd apps/omni-channels-dsh && bun run build && bun run lint'
```

**depends-on:** 1

### Group 3: Training and sending

**Goal:** Let staff earn and control each child's sending authority without
changing its sandbox or destination (IN5).

**Deliverables:**
1. Own `src/host/{thread-tools,threads,omni-rules}.js`, `src/client/omni-tree.js`,
   their focused tests/fixtures and generated `client.js`. Take `standing-runs.js`
   only for the answer-child `asksFirst` interaction; ordinary automations retain
   existing permission semantics. Transfer that interface to G4.
2. Initial new-child default training; staff can switch an individual child to
   sending and configure the bot's default for future children. The master can
   propose a default or switch but cannot authorize its own escalation.
3. Optional positive integer N for consecutive unchanged approved drafts. Count
   exact draft/approval identities once, after the approved content is sent;
   edits/rejections break the streak. Retries/replayed approval events cannot
   count twice. Disabled graduation never changes mode by itself.
4. Sending removes the training ask for an own-chat send while retaining all
   unrelated denies/approvals, read-only preset, tools and chat lock. Integrate
   with DSH/standing-run gates so neither an always-ask automation flag prevents
   sending mode nor an allow flag bypasses training. Persist modes/streaks.

**Interfaces:**
- Consumes: G2 `rt.answerCanSend` and answer-child classification/preset guards.
- Produces: child `sendingMode: 'training' | 'sending'`, `approvedStreak: number`;
  bot answer settings `newChildMode: 'training' | 'sending'`, `graduateAfter: number | null`;
  owner action `set_child_sending({threadId: string, mode: 'training' | 'sending'}): Promise<void>`;
  `rt.answerNeedsApproval(threadId: string): boolean`;
  `rt.recordAnswerDraft({threadId: string, draftId: string, approvedText: string, sentText: string, outcome: 'sent' | 'edited' | 'rejected'}): Promise<void>`.
  Draft identity/content comes from the actual approval/send pipeline, never
  model assertions. Existing permission helpers delegate to this policy only
  for answer children; all other threads keep existing defaults.

**Acceptance Criteria:**
- [ ] SC6: a new child asks before every send; staff selecting sending removes
  that ask; optional N consecutive approved unchanged drafts graduate it.
  **Proof:** focused host tests execute the approval/send pipeline for all three
  paths, N−1/N, disabled option, edited/rejected draft, retries and duplicate
  approvals. Sending preserves unrelated deny/ask outcomes and own-chat lock.
- [ ] The bot's default applies only to newly created children; old children
  keep their explicit state. UI changes are staff-authorized, not available to
  child/model escalation. **Proof:** host/client action tests and reload fixtures.

**Validation:**
```bash
env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh sh -c 'cd apps/omni-channels-dsh && node --import ./test/harness-resolve.mjs --test test/thread-tools.test.js test/threads.test.js test/standing-runs.test.js test/omni-tree.test.js'
env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh sh -c 'cd apps/omni-channels-dsh && bun run build && bun run lint'
```

**depends-on:** 2

### Group 4: Staff take-over and final verification

**Goal:** Pause the correct child on proven staff messages and resume safely by
staff or after the configured silence interval (IN6).

**Deliverables:**
1. Own `src/host/{omni-events,standing-runs,threads,thread-tools,omni-rules}.js`,
   `src/client/omni-tree.js`, matching tests/fixtures and generated `client.js`.
   Take `subscriptions.js` only for keeping answer-mode receipt streams alive
   without a matching automation and routing staff receipts before dispatch.
2. Generalize the existing own-device receipt proof from media to staff messages,
   including text: matching journal/canonical chat and external id, canonical
   `senderAgentId === null`, `isFromMe === true`, both receipt payloads proving
   `upsertType === 'notify'`, non-history, `isFromMe`, `key.fromMe` and matching
   `key.id`. Outbound direction or missing agent attribution alone proves nothing.
3. Persist per-child pause/last-staff time. Pause prevents new, queued and already
   approved-but-unsent child sends; recheck immediately before the API effect.
   The staff event is not a message for the child to answer. Replayed receipts
   do not extend the deadline; later staff messages reset it for that chat only.
4. Staff resume through sidebar or a request to the master; sender authorization
   must come from staff context, never external chat text. Bot-configured silence
   interval defaults to 30 minutes. Rebuild deadlines after restart, cancel stale
   timers and retain the child's sending/training state across pause/resume.
5. Reconcile prompts/descriptions with all four groups, run the full plugin suite
   and required aggregate gates, obtain independent review and record the final
   feature cut/release floor when released; no version bump in this planning PR.

**Interfaces:**
- Consumes: G1 ownership; G2 chat/preset/tool ceilings; G3
  `rt.answerNeedsApproval`/sending state and the standing-run integration.
- Produces: child `paused: boolean`, `lastStaffAt: number | null`;
  bot answer `resumeAfterMs: number` (default `1800000`);
  `rt.pauseAnswer({threadId: string, receiptId: string, staffAt: number}): Promise<void>`;
  staff action `resume_answer_child({threadId: string}): Promise<void>`;
  `rt.answerMayDispatch(threadId: string, now: number): boolean`.
  Timer and explicit resume share the same persisted transition. A resume cannot
  restore channel ownership or widen G2/G3 permissions.

**Acceptance Criteria:**
- [ ] SC7: a phone/linked-device staff receipt pauses only that child's chat;
  attributed and unattributed Omni API sends never pause it; staff resume and
  30 minutes of staff silence resume it. **Proof:** journal plus canonical
  fixtures and fake-clock tests: no own-device proof, append/history replay,
  lookup failure, duplicate receipt, second staff message, 29:59/30:00, custom
  interval, restart, explicit resume, stale timer and pending/queued send race.
- [ ] SC8: existing one-Omni-Bot setups work unchanged. **Proof:** full plugin
  suite passes with no changes to the legacy one-bot fixtures; add separate
  answer-mode fixtures. Aggregate gates and independent review cite the tested
  integrated SHA and explicitly disclose any unrun approval-dependent checks.

**Validation:**
```bash
env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh sh -c 'cd apps/omni-channels-dsh && node --import ./test/harness-resolve.mjs --test "test/*.test.js" && bun run build && bun run lint'
env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh make verify-rfcs
env -i HOME="$HOME" PATH="$HOME/.bun/bin:$PATH" sh /Users/feliperosa/workspace/repos/brain-v3.worktrees/.tools/gate.sh make lint
```
Preserve repository-required aggregate `make check` and the normal pre-push
typecheck/full-suite hook for implementation. Database/service checks require
the repository's explicit approval and disposable fixtures; report unrun checks
instead of claiming static gates qualify the implementation.

**depends-on:** 3

## QA Criteria

_Execution QA uses approved local/disposable fixtures after implementation;
these are planned observations, not results from this documentation PR._

- [ ] Confirm creation and hand-over from sidebar and default-bot proposal;
  cancellation leaves state untouched; see one responding owner per channel.
- [ ] Observe a first-message child, master instructions/model and notes; verify
  isolation/collective reads and refusal of wrong-chat writes and shell.
- [ ] Exercise training, staff switching, bot new-child default and optional
  graduation with edited/rejected drafts between approvals.
- [ ] Reply from the phone, verify that chat pauses immediately, resume via staff
  button/master and advance a fake clock through the staff-silence deadline.
- [ ] Compare a second bot/channel and unchanged one-bot fixtures on the same
  integrated revision; confirm no API send is mistaken for staff.
- [ ] Verify the release includes G1–G4 and records plugin version and compatible
  `engines.omni`; the baseline alone is not evidence of answer-mode availability.

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Ownership disagrees between grants, raw calls and event queues | High | G1 owns all three; recheck at execution and test stale hand-over |
| Stranger messages exploit inherited full-tool behavior | High | G2 explicit registry restriction plus guard, read-only preset and key ceiling; fail closed on missing preset |
| Collective reads accidentally widen send keys or reveal other bots | High | G2 mediates reads within owner bot; retains one-chat write key and tests both negative paths |
| Sending mode is defeated or bypassed by standing-run/preset gates | High | G3 owns the policy interaction; proof through actual approval/send pipeline |
| API echo mistaken for staff or approved send races with pause | High | G4 positive journal/canonical receipt proof and pre-effect pause check, fake-clock/race tests |
| Provider channel has no staff echoes | Medium | Explicitly outside take-over support until positive own-device evidence exists; never guess from direction |
| Existing multi-chat thread crosses future owning bots | Medium | G1 refuses inconsistent hand-over; no automatic membership split or key expansion |
| Shared source and prompt changes conflict with chat-scoped-bots G3 | Medium | All groups wait for its merge; sequential ownership and fresh base |
| Group grows beyond its bounded admission band | Medium | Return to the owner for a sibling split before expanding scope |
| Required local DSH test peers are absent | Low | Use existing test resolver and report the concrete dependency blocker; no invented passing test |
| Final release version is not yet assigned | Low | Preserve evidenced API minimum; record first G1–G4 plugin cut at release, per owner direction |

## Review Results

- **2026-11-11 — Design preflight:** copied DESIGN.md verified with
  `node /Users/feliperosa/.claude/skills/brainstorm/references/design-review-evidence.mjs verify .genie/brainstorms/omni-bot-answer-mode/DESIGN.md`,
  exit **0**. Reviewed content digest remains
  `95b8790c8e0f7e89003d30a23977e24a423f03469b40dbfbebda261784bd4c67`;
  reviewer `codex t5h7 (Omni Reviewer t3q7)`, reviewed 2026-11-11T19:41:45.000Z.
- **Independent plan review:** pending; owner routes review after the PR opens.
  DRAFT is not self-approval. No execution tasks created or dispatched.
- **Planning validation:** gated `make verify-rfcs` exit **0** (29 tests),
  gated `make lint` exit **0** (1,945 files). Repository-wide `genie wish lint`
  exits **1** with 28 unrelated findings, byte-identical to the findings from
  the untouched HEAD planning corpus. A focused snapshot containing this wish,
  chat-scoped-bots and both linked designs passes `genie wish lint --dir <snapshot>`
  with exit **0** (2 wishes, no broken brainstorm links). Existing wishes are
  outside this PR's scope. Full-corpus lint remains red; this is not plan approval.
- **Execution / product validation:** not run; this PR changes planning Markdown only.

## Files to Create/Modify

Planning PR — exactly these four files:

```
.genie/brainstorms/omni-bot-answer-mode/DESIGN.md  (byte-for-byte copy)
.genie/brainstorms/omni-bot-answer-mode/DRAFT.md   (byte-for-byte copy)
.genie/INDEX.md                                 (one Ready line only)
.genie/wishes/omni-bot-answer-mode/WISH.md        (this DRAFT plan)
```

Execution files, relative to `apps/omni-channels-dsh/`; ownership transfers
sequentially as declared in each group:

```
src/host/subscriptions.js
src/host/omni-events.js
src/host/grants.js
src/host/omni-api.js
src/host/thread-tools.js
src/host/threads.js
src/host/omni-rules.js
src/host/thread-keys.js
src/host/standing-runs.js
src/client/subscriptions.js
src/client/index.js
src/client/omni-tree.js
client.js (generated by the owning group's build)
test/subscriptions.test.js
test/omni-events.test.js
test/grants.test.js
test/omni-api.test.js
test/thread-tools.test.js
test/threads.test.js
test/thread-keys.test.js
test/standing-runs.test.js
test/omni-tree.test.js
test/automations-ux.test.js
test/team-view.test.js
test/thread-fixture.js (extend only new answer fixtures; retain legacy fixtures)
package.json (only if an implementation group raises engines.omni)
```
