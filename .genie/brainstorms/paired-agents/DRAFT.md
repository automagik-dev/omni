# DRAFT: paired-agents

## Round 1: what the owner said versus what the lead assumes

Repository: `<omni-checkout>` at HEAD `ee5753234` (2.261030.11).

**What the owner said** (their words, from the request and from
`.genie/brainstorms/gitlab-sdlc-connector/owner-decisions-2026-11-01.md`; none of it is in this ledger yet):

- "omni probably needs to recognize / pair agents. the old omni agent method (focused on integrations) is outdated. we
  need the other way around, like you, this specific claude code, registering as an omni [agent] that's consuming
  specific resources ... the current way agent works needs to be rethought (not removing the old) but extending it so
  that it can work with anything, i dont want future omni to have direct agent integrations at all... sync calls with
  agent callbacks are so 2023".
- An agent of any harness pairs with Omni, becomes a principal with its own narrow child key, declares what it consumes
  in its manifest `accepts`, receives deliveries asynchronously and outbound-only (an agent-owned durable consumer:
  pull, long-poll or SSE), and acts through outbound verbs and typed connector actions. The provider/call_agent path
  stays untouched.
- Council `council-paired-agents-2026-11-01.md`: proceed-with-conditions, C0 to C14, taken as decided inputs.
- **Delivery mode is set PER AGENT**: an agent is either called through call_agent or a subscriber through an
  agent-owned consumer, so one event never reaches one agent both ways. This answers the council's open owner question
  on mode placement (per agent, not per `accepts` entry).
- The GitLab slice waits for these slices, with no interim bridge on unowned consumers.
- Success: one concept for "agent X subscribes to Y", no per-framework code in Omni, isolation proven by tests (C0, C1,
  C2, C5), and the 40-consumer benchmark within a stated latency target.

**Contracts handed in by other brainstorms** (facts this design must honour, not redesign):

- GitLab connector (Settled there): typed rows are `connector.gitlab.*` (R3-1); only deliveries that match a
  subscription are journaled (R4-1); C2's per-source grant names a connector or a connector subscription; GitLab v1
  has no actions (R1-2, R3-3); the paired-agent programme is designed here (R4-2).
- Swarm collective consciousness (brain-v3, Settled there): "Brain is the boundary" (R1-1). Brain owns one Omni
  consumer per event family and fans out per-bot inboxes. That answer said no Omni change is needed for isolation; it
  was written before the council found C0 to C2. Brain's own consumer is isolated from other keys only once C0 and C1
  ship, so the swarm design depends on this one.
- `ae/1` (brain-v3 `.genie/rfcs/agent-event-envelope.md`): a draft, not approved. It is a profile of `OmniEvent`
  (`actor`, `work`, `audience`, `trust`, `refs`, `data` in the payload; correlation and causation in metadata). Its rule
  3 already names C5 ("the emission guard checks the paired agent's key against `actor.bot`"). The herdr coordinator
  recorded on 2026-11-01 that schema ownership comes after v0.1.0.

**Already established by the GitLab brainstorm's scouts** (at the same HEAD, not re-scouted):

- F2: a durable consumer takes one exact `eventType` or one trailing-`*` prefix glob, plus `excludeTypes`. So an agent
  with several resource families holds several consumers and several cursors; this is a fact, not a gap.
- F10: `durable_consumers.owner_key_id` exists (0082); `omni_events.agent_id` and `platform_identities.agent_id` exist
  (0001); `agents.event_manifest` (0062) and `automations.managed_by_agent_id` (0063) exist; neither `durable_consumers`
  nor `api_keys` has an `agent_id`. This settles the council's schema conflict on the column side. Scout 1 (round 1)
  found no writer of `omni_events.agent_id` on send, say or `/events/trigger`.
- F13: the automation engine's list is not tenant-filtered; F16: the next free migration was `0091`, which the GitLab
  ingress slice also needs.

**What the lead assumes** (each load-bearing one is listed under Open as a question for after the scouts):

- A1. The council's conditions are the programme's spine; this brainstorm sequences and tests them rather than
  reopening them.
- A2. The per-agent delivery mode is one field on the agent, read by the existing reconciler; switching it removes the
  managed rows of the other mode (C6). Where the field lives (an `agents` column or a manifest key) is a design detail.
- A3. Deliveries carry `ae/1` as a payload profile inside the C8 fence. Approval of `ae/1` is not a gate for v1; Omni
  stamps only what it can verify (`actor.bot` from the agent key, `trust`, provenance) and passes the rest through.
  This becomes a question if a scout shows the envelope needs Omni-side schema enforcement.
- A4. Each paired agent may hold several consumers (one per event family, F2), as Brain does. "One concept" means one
  declaration (`accepts`), not one cursor; a union view stays a C14 deferred trigger.
- A5. Typed connector action grants per key can wait: the only queued consumer (GitLab) has no actions in v1.
- A6. A Claude Code or Codex session drains deliveries at hook boundaries or through a supervisor (C12); how a session
  is woken is the swarm brainstorm's R1-2 and stays out of Omni.

## Size triage (round 1)

**G, and it splits.** It touches consumers, keys and scopes, the event trigger route, the manifest reconciler, the
delivery payload and a new CLI verb, with at least four additive migrations, and it gates two other brainstorms. A
proposed split, in the council's order:

1. **C0 pull leak fix** (P). A live, pre-existing exposure, confirmed at HEAD by scout 0: a regression test plus the
   instance clause on pull. Two existing tests pin today's unrestricted WHERE and change with it
   (`event-consumers.test.ts:244-257`, `:426-431`). It does not need the rest of the design and could ship as its own
   fix now (Open O1).
2. **Ownership and instance-less grants** (M): C1, C2, with the C0 test kept.
3. **Agent credential and scopes** (M): C3, C4, the name-match backfill.
4. **Emission guard, provenance, loop guard** (M): C5, C9.
5. **One declaration, two compile targets** (M, the largest M): C6 with the per-agent mode, C8 fenced envelope
   carrying `ae/1`, C10 explicit verb targets. Scout 2 overturned A2: the manifest schema is `strict()` with no mode
   field and the reconciler compiles only `call_agent` automations, so this slice also carries a manifest schema
   change, a compiler branch, a migration giving `durable_consumers` an agent owner, its own diff and apply path,
   cursor preservation on converge and a shorter deterministic consumer name. It may split in two at design time.
6. **Pairing UX** (M): C11, `omni agents pair`, last.
7. **Benchmark and operator controls** (P to M): C13, per-agent lag, backlog limit, resume from now.

C7 (dispatcher untouched), C12 (no Brain or harness code) and C14 (a default-off flag and one rollback per slice) bind
every slice; they are proof obligations, not slices.

## Round 1 scout findings

Four read-only scouts reported: three in omni at `ee5753234`, one in brain-v3. Citations are the scouts'; paths are
under `packages/` unless they say otherwise. Nothing was modified.

**Consumers and isolation (scout 0)**

- C0 is real. `pull()` calls `scanPage(consumer, limit)` with no caller clause (`api/src/services/event-consumers.ts:619-620`,
  `:884-891`, whose comment says "pull never passes one"); SSE adds `streamInstanceClause(caller.instanceIds)`
  (`:744-745`). An instance-restricted key with `events:write` can pull any unscoped consumer and get every instance's
  rows, and can create its own unscoped consumer, since `resolveConsumerScope` returns unscoped for any caller when
  `scoped` is falsy (`:298`). No test asserts the leak; two pin the unrestricted WHERE (`__tests__/event-consumers.test.ts:244-257`,
  `:426-431`). The only restricted-key row test covers SSE.
- The two paths also disagree the other way: for a restricted key on an unscoped consumer, SSE drops NULL-instance rows
  (`custom.*`, `connector.event`) through `instance_id IN (...)`, and pull returns them.
- Scoped consumers drop NULL-instance rows through `instanceScopeClause` (`:381-384`), on pull and SSE alike.
  `connector.event` rows are always NULL-instance at insert (`api/src/services/connectors.ts:1002-1018`; migration 0090
  says so by design). Deleting an instance NULLs its rows' `instance_id` (FK `ON DELETE SET NULL`), so they leave
  scoped consumers too.
- `canAccessConsumer` (`:349-355`) allows: any unscoped consumer; any caller with `instanceIds === null`; otherwise
  only `owner_key_id = caller.keyId`. Unscoped consumers have no enforcement on pull, ack, stream, inspect or delete,
  so any `events:write` key can pull, ack or delete them. Instance-unrestricted keys bypass ownership of scoped
  consumers.
- Stream caps: 5 per key, 100 per process, in memory (`api/src/services/event-consumer-stream.ts:53-58`); over cap is
  429 with Retry-After 1; streams end every 30 s with `reconnect`.
- Lag counts all journal rows past the cursor (`head = max(journal_seq)` over the whole table, `:454-456`, `:476-481`),
  not matching rows; `caughtUp` is the matching-aware flag.
- No retention, prune or archival path for `omni_events` exists in the repo. A slow cursor loses nothing; the risk is
  unbounded journal growth and a long scan for a returning consumer.
- The pull query is `SELECT *` paged on `omni_events_journal_seq_uq`, with the type glob, instance scope and access
  verdict in SQL; payload `filters` run in JS after the page (`:628-640`). There is no composite
  `(event_type, journal_seq)` or `(instance_id, journal_seq)` index. Long-poll rescans every 500 ms for up to 30 s, so
  40 idle long-pollers run about 80 scans per second; SSE rescans every 1000 ms without a NATS wake, 25 ms minimum
  after one.

**Keys, scopes and the agent principal (scout 1)**

- `api_keys` has `parent_key_id` (0088), `scopes`, nullable `expiresAt`, `chatAllowlist`, `outboundRecipientAllowlist`,
  `instanceIds`, `profile` and the context columns (`db/src/schema.ts:614-700`). A child can never be wider than its
  parent in scopes, instances or expiry, and a parent change clamps or revokes children (`api/src/services/api-keys.ts:197-219`,
  `:850-870`). Minting today makes only `cs` children, locked to one chat (`:690-740`).
- POST `/events/trigger` needs `events:write` (`api/src/constants/scopes.ts:495`). Consumer create, pull, ack, stream
  and delete all need `events:write` too (`:200-205`); there is no consume-only scope.
- `DEVICE_CLIENTS` (omni-desktop, omni-dsh, omni-cli, unfold) and `DEVICE_CLIENT_KEYS` are code constants
  (`api/src/login/config.ts:72-102`). Unfold's companion `agent` key (messages:send, events:read, events:write,
  instances:read) is the nearest thing to "consume plus send" today. Device approval can complete headlessly through
  `omni approve`, but it binds to the single owner, mints owner-scope keys with no expiry by default, and login is off
  whenever multitenancy is on (`config.ts:4-8`, `api/src/routes/v2/login.ts:368-373`).
- Connector actions are guarded only by the coarse `connectors:invoke`; `api_keys` has no per-action grant column
  (`scopes.ts:119`, `routes/v2/connectors.ts:184-193`).
- `agents.provider` is varchar(50) NOT NULL; the enum (`claude`, `agno`, `openai`, `gemini`, `custom`,
  `omni-internal`) is enforced only in Zod (`core/src/schemas/agent.ts:25-29`). No column can hold a unique external id;
  only `metadata` jsonb (unindexed) or the non-unique `name` (`db/src/schema.ts:399-437`).
- Agents join keys by name only: `agentKeyNameCandidates` has one production call site (`agent-dispatcher.ts:2935`)
  and `agentKeyName` two (`routes/v2/instances.ts:1384`, `:1402`).
- `omni_events.agent_id` and `causation_id` are copied from metadata on the journal paths, but no writer sets
  `metadata.agentId` on send, say or `/events/trigger`; trigger forwards a caller-given `causationId` only, and nothing
  derives an agent from the calling key.

**Manifest, reconciler and delivery (scout 2)**

- `AgentEventManifestSchema` is `strict()` with only `accepts` and `publishes` (`core/src/schemas/agent-manifest.ts:89-94`).
  An `accepts` filter is equality only, compiled to `eq` conditions (`api/src/services/manifest-compiler.ts:92-97`).
- Manifest event types must be core types, `custom.*` or `system.*` (`agent-manifest.ts:34-43`). The `ae/1` kinds
  (`agent.review.verdict`, `agent.gate.result`, `agent.status`, `agent.mr.merged`, `team.*`) are none of these, so an
  agent cannot declare them in `accepts` or `publishes` today.
- The reconciler runs only on a manifest write and on agent delete, never at boot; an unchanged manifest is a strict
  no-op; rows no longer wanted are deleted (`manifest-compiler.ts:187-258`, `api/src/services/agents.ts:210`, `:235`).
  It writes only `call_agent` automations.
- `checkPublishAllowed` exists but runs only inside the `emit_event` automation action for managed rows, and the
  compiler never emits `emit_event`, so the publish gate is effectively unreachable today
  (`api/src/plugins/automation-actions.ts:277-300`, `:569-583`).
- A pull delivers the full `omni_events` row (`rawPayload`, `agentRequest`, `agentResponse`, `metadata`, ...), with no
  fence, no untrusted marker and no redaction on the pull path. A chatless `call_agent` run gets the bare event JSON.
- The event-schema registry is opt-in per type and is consulted only by `emit_event` and `custom.*` webhook ingress.
- `omni agents graph [--type]` exists and shows manifest-declared accepts and publishes plus compiled counts; it shows
  no consumers, mode, lag or agent-to-agent edges (`cli/src/commands/agents.ts:215-300`).
- Next free migration: `0091`; no branch claims it.

**Brain (scout 3, brain-v3)**

- Brain's `src/lib/omni` reads chat messages over REST (`chats.getMessages`, `GET /api/v2/chats/{id}/messages`), never
  the events API. Its per-(instance, chat) checkpoint is used only by `brain omni run`, which stores nothing. Output
  comes from the archiver (sweep), which writes `Conversas/` day files from a rewritten overlap window.
- No Omni text is fenced on Brain's inject path; the only fence (`MemoryStore.fenceBlock`) has no caller. Nothing
  dedupes event redeliveries across restarts.
- Only SessionStart (one 320-char line) and UserPromptSubmit (up to 10,000 chars) return context to the host; the
  composer has no slot for an event inbox today.
- The swarm needs one Brain-owned consumer per family; only GitLab (`custom.gitlab.*`) has an Omni source, and such a
  consumer must be unscoped today because the rows carry no instance.

**Corrections to the council report** (`council-paired-agents-2026-11-01.md`; the conditions stand, their detail is
corrected):

- C1: `durable_consumers.owner_key_id` already exists (0082). Only `agent_id` is new.
- C0 and C2 have different fix points: the scoped NULL-instance drop is `instanceScopeClause`, not
  `streamInstanceClause` (council `:101`). C2 changes `instanceScopeClause`; C0 adds the key clause to pull.
- `canAccessConsumer` grants by owner key identity, not by instance overlap (council `:59`).
- The load model counts requests, not scans (council `:18`): 40 idle long-pollers do about 80 scans per second.
- Answered council unknowns: `connector.event` rows are always NULL-instance; nothing prunes `omni_events`.

## WRS bar (round 1, after the scouts)

| Dimension | Score | Why |
|---|---|---|
| Problem | 17/20 | The three council facts that were unverified are now verified at HEAD: the C0 leak, the NULL-instance drop (and that `connector.event` is always NULL-instance), and that no path writes `omni_events.agent_id` for send, say or trigger. Nothing is in this ledger yet. |
| Scope | 10/20 | The slices are firmer (slice 5 grew when A2 fell; the Brain fetcher sits outside the feed), but no Scope IN item is approved. |
| Decisions | 6/20 | Unchanged: no owner answer yet. O3 became a fact; O1, O2, O6 and O8 are asked. |
| Risks | 15/20 | Retention, stream caps, the `/events/trigger` scope and headless approval are answered, and new risks are named: any `events:write` key can ack or delete an unscoped consumer, 80 scans/s idle load with JS-side filters and no composite index, 40 x 3 SSE streams over the 100-per-process cap, an unreachable publish gate, `ae/1` kinds invalid in manifests, no fence on either side, pairing unavailable under multitenancy. |
| Criteria | 7/20 | The C0 regression test is precise (a restricted key pulls an unscoped consumer; the two pinning tests change) and lag's definition is known. The latency target (O2) is still missing. |
| **Total** | **55/100** | |

## Gap map (round 1)

- **Settled (outside the ledger):** direction, the council's C0 to C14 (with the corrections above), per-agent
  delivery mode, GitLab waits.
- **Settled by facts:** single-type-or-glob consumers (F2), the agent columns (F10), and everything in "Round 1 scout
  findings": C0 at HEAD, the NULL-instance drop, `canAccessConsumer`, stream caps, lag, no retention, the key and scope
  rules, device clients, the reconciler, `connector.event` instances, no `agent_id` writer, Brain's fetcher and drain
  points. O3 is answered by fact (A7).
- **Owner decisions asked this round:** O1 (C0 timing), O2 (latency target), O6 (action grants versus C4), O8 (the
  agent event type namespace).
- **Owner decisions waiting:** O4 (WhatsApp agents on pull), O5 (`agents.provider`), O7 (external bot id), O9 (pairing
  under multitenancy).
- **Facts still unknown:** the pull query plan on a production-sized journal (no EXPLAIN was run; the benchmark
  answers it); whether anything outside the repo prunes `omni_events`; whether channel plugins set `metadata.agentId`;
  whether key create accepts unregistered scope strings; whether any channel stores credentials in `rawPayload`.
- **Blocks what:** O1 blocks slice 1's timing; O2 blocks the C13 criterion; O8 blocks C5 and slice 5's manifest work;
  O6 settles the C4 profile; O7 blocks the `actor.bot` stamp; O9 blocks slice 6. The GitLab connector and measurement
  slices wait on slices 1 to 5; the swarm's Omni intake waits on slices 1 and 2.

## Round 2: what the owner settled, and what it changes

The owner answered all four round-1 questions (Settled R1-1 to R1-4). HEAD is still `ee5753234`; no C0 fix wish exists
under `.genie/wishes/` yet.

- **R1-1, C0 ships now as its own fix.** A fix wish lands the pull instance clause (A8's shape) and its regression test
  ahead of this design. C0 stays in Scope IN: this design does not re-implement it, but every later slice keeps its
  regression test green, and slice 2 (C1, C2) builds on the clause. The consequence the owner accepted with the A8
  shape: an instance-restricted key pulling an unscoped consumer stops receiving NULL-instance rows until C2's grants
  land.
- **R1-2, p95 2 s from journal insert to delivery** for the 40-consumer benchmark. The question asked for two numbers;
  the answer sets only the latency. The rows-read bound per pull request is still open (O10), so C13's criterion is
  half-stated.
- **R1-3, typed per-key connector action grants are deferred, and the paired-agent profile omits `connectors:invoke`.**
  C4 is read narrowed: the profile is consume plus `messages:send` under the two allowlists, with no connector
  invocation. The C4 Scope IN text keeps its words "and declared typed actions" verbatim (the ledger owns the string);
  the design reads that clause as empty in v1 under R1-3. A connector action for agents needs a later grant design.
- **R1-4, agent-emitted event types use `custom.agent.*` in v1.** This passes the manifest validator as it stands
  (`custom.*` is allowed), so C5's publish gate can check declared types without a validator change. It opens a
  reservation gap the design must close: `custom.*` webhook ingress is live (scout 2), so unless ingress or
  `/events/trigger` refuses the `custom.agent.` prefix from a non-agent source, anyone with a webhook or `events:write`
  can forge an agent event. Whether they refuse it today is a repository fact (scout A, round 2). `ae/1` kinds map to
  `custom.agent.<kind>` (for example `custom.agent.review.verdict`); the mapping is a naming rule, not a schema.

## WRS bar (round 2, before the scouts)

| Dimension | Score | Why |
|---|---|---|
| Problem | 18/20 | The leak, the NULL-instance drop and the missing `agent_id` writer are verified; R1-1 fixes the first now. The new `custom.agent.*` forgery gap is named but unmeasured; what identifies the source of an instance-less row is unknown, so C2's grant has no key yet. |
| Scope | 12/20 | Fourteen Scope IN items in the ledger, all raised by the lead, none narrowed or dropped by the owner. R1-1 fixes C0's place (a separate fix, kept as a proof obligation) and R1-3 narrows C4 in prose. Slice 5 may still split at design time. |
| Decisions | 11/20 | Four settled (R1-1 to R1-4). Open: O4 (conversational agents on pull), O5 (`agents.provider`), O7 (external bot id), O9 (pairing under multitenancy) and the new O10 (rows-read bound). Where the delivery-mode field lives stays a design detail. |
| Risks | 15/20 | Round-1 risks stand. New: `custom.agent.*` forgery through webhook ingress or trigger. Still unknown: credentials in `rawPayload`, how tenancy reaches consumers and keys, whether plugins already write `metadata.agentId`. |
| Criteria | 10/20 | p95 2 s (R1-2) and the C0 regression test are testable. The rows-read bound (O10) is open, and C2's end-to-end refusal test cannot be written until a row's source can be matched in SQL. |
| **Total** | **66/100** | |

## Gap map (round 2)

- **Settled by the owner (ledger):** R1-1 C0 now as its own fix; R1-2 p95 2 s; R1-3 action grants deferred, no
  `connectors:invoke` in the profile; R1-4 `custom.agent.*`.
- **Settled outside the ledger (round 1):** direction, C0 to C14 with the round-1 corrections, per-agent delivery
  mode, GitLab waits.
- **Facts this round's scouts gather:** (A) what identifies the source of each instance-less row and whether a grant
  can match it in SQL, plus whether ingress or trigger refuses `custom.agent.*`, `custom.webhook.*` or `connector.*`
  today; (B) every path a key journals an event, `metadata.agentId` writers, a causation chain C9 can bound,
  `contextChatId` resolution for C10, scope-string validation for C4 and the real name-matched dispatcher keys for C3;
  (C) secrets in `omni_events` rows for C8; (D) how tenancy reaches keys, agents, consumers and automations, for O9.
- **Owner decisions waiting:** O4, O5, O7, O9, O10. They are asked after the scouts report, at most four at a time;
  O10 and O9 carry the most weight.
- **Facts left to the benchmark:** the pull query plan on a production-sized journal (no database here; C13 measures
  it).
- **Blocks what:** O10 blocks C13's second number; scout A blocks C2's grant shape and the C5 reservation rule; O7
  blocks the `actor.bot` stamp; O9 blocks slice 6; scout C blocks C8's redaction list. Slices 1 to 5 still gate the
  GitLab connector, and slices 1 and 2 gate the swarm's Omni intake.

## Round 2 scout findings

Four read-only scouts reported, all in omni at `ee5753234`. Citations are the scouts'; paths are under `packages/`
unless they say otherwise. The lead spot-checked the tenant-consumer chain (O11) and the webhook type rule. Nothing was
modified.

**Source of instance-less rows and prefix reservation (scout A)**

- `omni_events` has no source column. The real columns are `instance_id`, `agent_id`, `channel`, `event_type`,
  `tenant_id`, `causation_id` and `idempotency_key`. Everything else that names a source sits in `metadata` or
  `rawPayload` jsonb (`db/src/schema.ts:1981-2110`). Neither jsonb column has an index, GIN or expression index in
  the schema or the drizzle migrations (`:2095-2121`).
- Connector ingress claim rows carry `connectorId`, `subscriptionId` and `provider` in `metadata`, plus the same ids in
  `rawPayload` (`api/src/services/connectors.ts:966-1018`, `:185-211`). A connector event published any other way
  (test delivery, `emit_event`, operator publish) is journaled by `journalInternalEvent` with only
  `{correlationId, source, fullEventType}` in metadata (`api/src/plugins/event-persistence.ts:704-752`).
- Webhook claim rows carry `metadata.webhookSource`, which is the source's name, not its id. They set no `tenantId`
  (`api/src/services/webhooks.ts:464-475`, `:545-567`).
- `/events/trigger`, poll connectors, `emit_event` and the journaled `system.*` emitters record only a producer-class
  string in `metadata.source` (`manual-trigger`, `automation`, `connector-liveness`, `dead-letter-service`). None of
  them records the calling key, the agent or the automation. The automation id survives only inside the derived
  `idempotency_key` text (`api/src/services/webhooks.ts:693-815`, `api/src/plugins/automation-actions.ts:505-530`).
- `journalInternalEvent` never writes `agent_id`. The column exists and is indexed (`omni_events_agent_id`), but no
  custom, connector or system producer fills it.
- `instanceScopeClause` is `inArray(instance_id, ids)` (`api/src/services/event-consumers.ts:381-384`), ANDed with the
  type clause and the access clause in `scanPage` (`:880-912`). The indexed discriminators that could sit beside it
  are `event_type`, `tenant_id`, `agent_id` and `causation_id`.
- **No path refuses `custom.agent.*` today.**
  - Webhook ingress: the type is `custom.webhook.<source>`, or `custom.<source>.<token>` when the source has a
    mapping (`api/src/services/webhooks.ts:141-155`, read by the lead). A source name is any 1 to 100 chars, with no
    reserved-name check. So a source named `agent`, or `agent.x`, emits `custom.agent.*`.
  - `/events/trigger` refuses only types that do not start with `custom.` (`api/src/routes/v2/webhooks.ts:174-189`).
    Any `events:write` key may emit `custom.agent.*` or `custom.webhook.*`. Poll `emitType` has the same rule.
  - `emit_event` from an automation with no `managed_by_agent_id` passes every gate. `publishGeneric` then accepts any
    core type, any `custom.*` or `system.*` type and `connector.event` (`core/src/events/nats/registry.ts:105-136`).
    So such an automation can publish `connector.event`, or even `message.received`.

**Emission, causation, verb targets, scopes and keys (scout B)**

- No path stamps the producing key or agent today.
  - Verb sends (`say`, `send`, `react`, `speak` and the other send routes) journal `message.sent` through
    `emitMessageSent`, with a fresh correlation id and no causation (`channel-sdk/src/base/BaseChannelPlugin.ts:372-380`).
  - `createOmniEvent` drops `metadata.agentId` even though `event-persistence` would copy it
    (`core/src/events/factory.ts:56-73`). The only agent trace is `payload.senderAgentId` on `sentBy: 'agent'`, and it
    lands in `messages.sender_agent_id`.
  - Ambient causality (`runWithEventCausality`) runs only in the automation engine and the agent dispatcher. No
    API-key HTTP request reaches either.
- `/events/trigger` takes any caller-supplied `causationId` after a UUID check alone. It does not check that the parent
  exists or that the caller may see it, and it records no key (`api/src/services/webhooks.ts:694-749`).
- There is no depth field. `causation_id` is an indexed uuid with no FK; correlation lives only in metadata jsonb.
- `EventsService.trace` walks the chain one SELECT per ancestor (capped at 50) and breadth-first downward (capped at
  depth 10 and 200 nodes). A pruned or missing parent ends the chain silently. There is no `WITH RECURSIVE` anywhere
  (`api/src/services/events.ts:71-73`, `:267-315`).
- Verb targets. The CLI resolves `say` and `done` targets field by field, in this order: flags, env, `GET /v2/context`,
  config (`cli/src/context.ts:49-72`). The server never reads the context columns for a send. Sends take an explicit
  `instanceId` and `to`, checked by `checkInstanceAccess` and the allowlists.
- The exception is `POST /turns/close`. Its body has no instance or chat target, and it falls back to the key's
  `context_instance_id`/`context_chat_id` (`api/src/routes/v2/turns.ts:55-113`). The dispatcher writes those columns at
  every turn open, so one scoped key holds one context at a time, and the last writer wins
  (`api/src/plugins/agent-dispatcher.ts:2964-2985`).
- Scope strings are not checked against any registry on key create or update. A `*` caller can grant any string. A key
  holding an unregistered scope keeps it, and the scope does nothing until a `SCOPE_MAP` entry requires it
  (`api/src/routes/v2/keys.ts:62-70`, `:208-241`). Agent keys built from `agent.metadata.omniScopes` are not checked
  either.
- Dispatcher keys are named `agent:<tenantId>:<name>` or `agent:<name>` (`api/src/lib/agent-key-name.ts:29-49`) and
  created with `created_by = 'system:auto-provision'`.
- `turns.api_key_id` and `turns.agent_id` are written together at turn open, and both are indexed. That makes `turns`
  the only exact key-to-agent link, but only for keys that have served a turn.
- Parsing a key name is heuristic: an agent name may contain `:`. Neither `agents.name` nor `api_keys.name` is unique,
  and `findByName` is `LIMIT 1` with no ORDER BY. Renaming an agent leaves its key under the old name.

**Secrets in `omni_events` (scout C)**

- Pull returns the whole unprojected row: `rawPayload`, `metadata`, `textContent`, `mediaUrl`, `errorMessage`,
  `idempotencyKey` and the rest (`api/src/services/event-consumers.ts:895`, `:629`, `:775`). The only response-side
  redactor covers `/messages/send` request bodies (`api/src/middleware/output-redactor.ts:52`).
- Fields that carry credentials or session material into rows a consumer receives:
  - WhatsApp (Baileys): `rawPayload` spreads the full `WAMessage`. The repo's own fixture shows `mediaKey`,
    `fileEncSha256`, `directPath`, the `mmg.whatsapp.net` URL and `messageContextInfo.messageSecret`, all
    hand-redacted in the fixture (`channel-whatsapp/src/plugin.ts:3585`,
    `channel-whatsapp/test/fixtures/real-payloads.json:21-28`, `:100-110`). History sync stores the whole message.
    When the local download fails, `mediaUrl` holds the raw WhatsApp URL (`handlers/messages.ts:1240`).
  - Gupshup: `khalSessionId` and an `x-khal-session-id` header copy (`channel-gupshup/src/handlers/webhooks.ts:627-640`).
  - Twilio: the whole form map, including `AccountSid` (`channel-twilio-whatsapp/src/handlers/webhooks.ts:196-203`).
  - Slack: `files` verbatim, with private file URLs in `mediaUrl`. The bot token is deliberately excluded.
  - Discord: `guildConfig` and attachment URLs.
  - `system.dead_letter` and `system.agent.run_completed`: raw `error` text and agent output, unscrubbed.
  - Connector deliveries: redacted only for the subscription's own secret (`api/src/services/connectors.ts:779`).
- Telegram and Meta Cloud (WhatsApp Business, ASC) store no token-bearing URL in the row: they reference media by file
  or media id.
- `agentRequest` and `agentResponse` have no writer anywhere.
- A typical `message.received` row has two kinds of field. Provenance: `instanceId`, `personId`,
  `platformIdentityId`, `chatId`, `chatUuid`, `externalId`, `direction`, `receivedAt`, `metadata` `{correlationId,
  from}`. Untrusted: `textContent` and the sender-controlled parts of `rawPayload` (body, quoted message, display
  name, chat name, filenames, captions) (`api/src/plugins/event-persistence.ts:251-290`).
- No untrusted-text fence exists anywhere. The redaction helpers that do exist (log redaction, `redactValue` for
  connector secrets, config-audit and observability scrubbers, the send-route denylist) touch no row that reaches a
  consumer.

**Tenancy (scout D)**

- Two switches control it. `OMNI_MULTITENANCY_ENABLED=true` turns multitenancy on and mounts `/api/v2/platform`.
  `OMNI_DB_ENFORCEMENT=on` adds forced RLS. With the first on and the second off, the boot warning says isolation is
  advisory only (`api/src/tenancy/feature-flag.ts:12-16`, `api/src/tenancy/enforcement-posture.ts`).
- These tables carry a nullable `tenant_id`: `agents`, `instances`, `omni_events`, `automations` and
  `connector_event_subscriptions`. The database derives the value in insert triggers.
- `instances` is the only ownership root. `automations` is "unowned": `tenant_id` stays NULL until the G6 backfill
  (`db/src/tenancy-ownership.ts:378-390`).
- `api_keys` has no tenant column. Tenant credentials live in `tenant_key_lineage`, which has no `agent_id`
  (`db/src/schema.ts:4580-4630`).
- `durable_consumers` has no `tenant_id` and no RLS, and its name index is global (`db/src/schema.ts:3693-3787`).
- Device login is off under multitenancy by explicit code, because device approval mints legacy keys with no tenant
  binding (`api/src/login/config.ts:4-8`, `api/src/routes/v2/login.ts:434-460`).
- Two mint paths still work under multitenancy:
  - A platform credential issues a tenant root key.
  - A tenant credential mints a same-tenant child key with explicit scopes through `POST /keys`
    (`handleTenantChildCreate`, `api/src/routes/v2/keys.ts:531-640`).
- There is no invite flow.
- **Cross-tenant consumer access (O11, chain confirmed by the lead at HEAD).** The consumer routes are in
  `TENANT_SCOPED_ROUTES`, so a tenant credential can reach them (`api/src/tenancy/route-ownership.ts:671`, `:755-757`,
  `:908-910`). A tenant key with no `instanceIds` constraint is projected with `instanceIds: null`
  (`api/src/middleware/tenancy.ts:100-111`), and `canAccessConsumer` returns true for any such caller
  (`api/src/services/event-consumers.ts:349-355`). So a tenant key can list, inspect, ack and delete another tenant's
  consumers. Under enforcement, RLS still limits the rows a pull returns to the caller's tenant
  (`event-consumers.ts:460-464`), but ack and delete move or remove the other tenant's cursor. With enforcement off,
  the rows themselves cross tenants as well.
- The automation engine matches automations by event type alone and never compares `automation.tenantId`
  (`core/src/automations/engine.ts:497-506`). F13 is confirmed: at boot, `list()` loads every automation with no tenant
  clause (`api/src/services/automations.ts:193-201`).
- `reloadEngine` runs after every CRUD and replaces the engine's set from whatever scope the request ran in
  (`:183-188`). After a CRUD under a tenant credential with enforcement on, the reload could therefore hold only that
  tenant's rows.
- The manifest reconciler inserts managed rows with no tenant. Its own header says "tenant is left to the database"
  (`api/src/services/manifest-compiler.ts:38-55`).

## Design consequences (round 2)

What R1-1 to R1-4 and the round-2 facts now require of each slice. These are lead design calls that only add scrutiny;
none changes an owner answer.

- **C2 and C5 share one mechanism: a provenance stamp written in an indexed column at journal time.** A per-source
  grant cannot be a clause on `metadata->>'x'`. That would be an unindexed jsonb read, and the field does not even
  exist on trigger, poll, `emit_event` or `system.*` rows. So the journal paths stamp the source in real columns
  (A13):
  - the producing agent in the existing `agent_id`;
  - the producing key in a new `producing_key_id`;
  - for ingress rows, a source reference to a connector subscription or webhook source, by id and not by name.
  
  C2's grant is then one indexed clause ORed into `instanceScopeClause`, and C5's "stamped and filterable" is the
  same column. This adds an additive migration and a stamp in the factory and in `journalInternalEvent`. The factory
  stops dropping `metadata.agentId` when the agent comes from the authenticated key, and never takes it from the
  caller's body.
- **The C5 reservation covers four paths, not two (A11, A14).** Webhook source create and ingress refuse names that
  would yield `custom.agent.*`. `/events/trigger` and poll refuse `custom.agent.*` from a key not bound to an agent.
  `emit_event` refuses `connector.*` always, and refuses `custom.agent.*` unless the automation is managed by the
  agent whose manifest publishes the type. Core types published through `emit_event` are a pre-existing gap outside
  the C list (O12).
- **C9's depth is computed by Omni, never trusted from the caller (A17).** A depth value is stamped from the stored
  parent at journal time, one primary-key read. For agent-bound keys, `/events/trigger` checks that a supplied
  `causationId` exists and is visible to the key; behaviour for other keys is unchanged. Self-drop uses the stamped
  `agent_id`, so a verb send by agent X is dropped from X's own consumer once sends stamp the key's agent.
  - Residual risk: two agents can ping-pong while omitting `causationId`, which resets the depth. The backlog limit
    and rate limits bound that case, not depth.
- **C10 narrows to two places (A18).** Sends already take explicit targets server-side, so the gap is in two places:
  - The CLI's fallback to `GET /context`. For an agent key in subscriber mode, `/context` returns no chat or message,
    and the verbs then need `--instance`/`--chat`.
  - `POST /turns/close`, a dispatcher feature. Subscriber-mode agents have no turns, and the dispatcher stays
    untouched (C7).
- **C3's backfill is deterministic or it is reported, never guessed (A15).** Order:
  1. `turns(api_key_id, agent_id)`, used only when a key maps to exactly one agent;
  2. keys with `created_by = 'system:auto-provision'` and `name LIKE 'agent:%'`, resolved through `instance_ids` to
     `instances.agent_id`;
  3. everything else stays NULL. That includes ambiguous names, duplicates and renamed agents. `doctor` lists these
     keys with the fix (record-and-report).

  Under multitenancy, `api_keys.agent_id` covers only the legacy plane. Tenant credentials would need an agent
  binding on `tenant_key_lineage` (O9).
- **C4's consume scope is a `SCOPE_MAP` change plus a fixed server-side profile (A19).** Pull, ack, stream and
  inspect accept the new consume scope or `events:write` while the flag is on, so existing consumer keys keep working.
  The paired-agent profile is a server constant, so no free-form scope string is minted. General scope-string
  validation stays out of scope.
- **C8 is an allowlist projection, not a denylist redaction (A16).** An agent-owned consumer receives provenance
  columns plus one fenced `data` field. Channel rows never pass `rawPayload` through. Custom and connector payloads go
  into `data`, marked untrusted. `agentRequest`, `agentResponse` and raw `error` text are not passed through.
  - Legacy consumers are unchanged (C1).
  - The C8 test asserts the absence of the fields scout C found, starting from the WhatsApp fixture: `mediaKey`,
    `messageSecret`, `directPath`, the `mmg.whatsapp.net` URL, Gupshup's session id and Twilio's `AccountSid`.
- **New risks for slice 5 (C6) and slice 2.** Managed `call_agent` rows carry no tenant, and the engine matches by
  type alone, so on a multitenant deployment one tenant's agent can be called for another tenant's event. Agent-owned
  consumers inherit the global name index and the cross-tenant access of O11. Both tie the paired-agent slices to O9
  and O11.

## WRS bar (round 2, after the scouts)

| Dimension | Score | Why |
|---|---|---|
| Problem | 19/20 | Every source question the round planned is answered at HEAD: no source column, no `agent_id` or key writer, no prefix refusal anywhere, the exact secret fields in rows, and how tenancy reaches keys, consumers and automations. A new live exposure is confirmed (O11). |
| Scope | 12/20 | Unchanged: no owner answer this round. Scope grew in substance, though. C2 and C5 need a stamped column, the C5 reservation covers four paths, and multitenancy adds work to slices 2, 3 and 6 if O9 says yes. O11 and O12 may add items. |
| Decisions | 11/20 | Unchanged: four settled, and O4, O5, O7, O9, O10 and O11 are open. Asked now: O10, O9, O11, O7. |
| Risks | 18/20 | The round-1 unknowns are measured: credentials in `rawPayload` (WhatsApp keys, Gupshup session, Twilio SID), no `metadata.agentId` writer, unchecked `causationId`, `custom.agent.*` and `connector.event` forgeable, cross-tenant consumer access, tenant-blind engine matching. Still unknown: the engine's boot list under enforcement, live data (webhook sources named `agent*`, duplicate agent key names), and signed CDN URLs. |
| Criteria | 13/20 | Testable now: C2's end-to-end refusal on a stamped indexed column; C5's forgery tests on the four concrete paths; C8's absence assertions from the WhatsApp fixture; C3's backfill counted against `turns`. Still open: the rows-read bound (O10), and C9's depth bound has no number. |
| **Total** | **73/100** | |

## Gap map (round 2, after the scouts)

- **Settled by the owner (ledger):** R1-1 to R1-4.
- **Settled by facts this round:**
  - source identity of each instance-less row, and that no indexed source column exists;
  - that no path refuses `custom.agent.*`, and that `emit_event` can publish `connector.event` and core types;
  - no key or agent stamp on any emission;
  - the causation chain's shape and cost;
  - verb target resolution;
  - unvalidated scope strings;
  - the deterministic backfill handles;
  - the leaking fields in rows;
  - the tenancy model and both multitenant mint paths;
  - O11's access chain.
- **Lead design calls this round (Assumed):** A13 stamped provenance column, A14 four-path reservation, A15 backfill
  order, A16 allowlist envelope, A17 Omni-computed depth, A18 C10 narrowing, A19 consume scope transition.
- **Owner decisions asked now:** O10 (rows-read bound), O9 (pairing under multitenancy), O11 (cross-tenant consumer
  access fix timing), O7 (external bot id).
- **Owner decisions waiting:** O4 (conversational agents on pull), O5 (`agents.provider`), O12 (core types from
  `emit_event`).
- **Facts still unknown:**
  - the pull plan and the cost of the new column clause on a production-sized journal (C13 measures both);
  - whether the engine's boot `list()` succeeds, sees everything or raises 42501 under `OMNI_DB_ENFORCEMENT=on`;
  - whether live deployments populate `automations.tenant_id` or `agents.tenant_id`;
  - whether a tenant-credential manifest write runs in the tenant scope;
  - whether live databases hold webhook sources named `agent*`, duplicate `agent:` key names or renamed agents;
  - whether Discord, Slack or Twilio media URLs carry signed parameters;
  - reaction journaling and the media-processor columns;
  - how `mediaKey` serialises in jsonb.
- **Blocks what:**
  - O10 blocks C13's second number.
  - O9 blocks slice 6, and decides whether slices 2 and 3 must be tenant-aware.
  - O11 decides whether a second fix ships ahead of the design, as C0 did.
  - O7 blocks the `actor.bot` stamp.
  - A13 is the gate for slice 2 and the C5 part of slice 4.
  - Slices 1 to 5 still gate the GitLab connector, and slices 1 and 2 still gate the swarm's Omni intake.

## Round 3: what the owner settled, and what it changes

The owner answered all four round-2 questions (Settled R2-1 to R2-4). HEAD is still `ee5753234`. No wish under
`.genie/wishes/` yet carries the C0 fix (R1-1) or the cross-tenant consumer fix (R2-3).

- **R2-1, rows read per pull request: matched rows only.** With R1-2, C13's criterion now has both numbers:
  - p95 at most 2 s from journal insert to delivery, for 40 consumers at one busy GitLab project's journal volume;
  - one pull request (a long-poll, across all its rescans, as EXPLAIN ANALYZE reports it) reads no journal row that
    fails the consumer's SQL clauses past its cursor: the type or glob, `excludeTypes`, the instance clause, the
    access verdict and, once C2 lands, the grant clause. An idle rescan is an index probe that reads no heap row.

  Three consequences follow, and the design must face each one:
  - **Filters.** The payload `filters` run in JS after the page (round 1, scout 0, `event-consumers.ts:628-640`). A
    row that matches the type but fails a filter is read and not delivered. Whether that row counts as "matched" is
    the owner's reading of R2-1, and it decides whether the filters must move into SQL (O13, asked after scout E).
  - **Indexes.** R2-1 needs a composite index such as `(event_type, journal_seq)` at the least. The A13 grant is an OR
    over the instance column, the source reference and `agent_id`, and an OR may defeat a single composite index.
    The plan is C13's to measure; scout E maps which index set could meet the bound in each consumer shape.
  - **Lag.** The same index makes C13's per-agent lag on matching rows cheap to compute. Today's lag counts every
    journal row past the cursor (round 1, scout 0).
- **R2-2, single-owner only in v1.** Pairing (C11) and the agent-bound key (C3) serve single-owner deployments. The
  honest consequence is a refusal gate (A20): no paired-agent flag turns on while `OMNI_MULTITENANCY_ENABLED` is true,
  and `doctor` names the reason and says that v1 is single-owner. A silent half-working mode on a multitenant
  deployment would break the failure doctrine. Four round-2 tenancy unknowns leave this design's scope; they are not
  deleted:
  - the engine's boot `list()` under enforcement;
  - whether a tenant-credential manifest write runs in tenant scope;
  - live `tenant_id` population on `automations` and `agents`;
  - an agent binding on `tenant_key_lineage`.

  The tenant-blind matching of managed `call_agent` rows stays a named pre-existing risk outside the C list. Those
  rows are written by the existing reconciler, which C7 keeps as it is.
- **R2-3, the cross-tenant consumer access (O11) ships now as its own fix.** As with C0, a separate fix wish lands it
  ahead of this design. It enters Scope IN as C15, a proof obligation every slice keeps green. Its likely shape is
  that `canAccessConsumer` stops granting on `instanceIds === null` alone when the caller is a tenant credential, and
  the fix wish owns the exact shape. Slices 1 and 2 build on it the way they build on C0: C1's ownership check
  extends the same predicate.
- **R2-4, Omni agent id only.** No external-id column is added. Three things follow:
  - Inside the C8 fence, `ae/1` `actor.bot` is data the agent supplied and Omni does not verify it.
  - The verified identity is the `agent_id` stamped from the key (A13). The deterministic consumer name (C6) and the
    pairing record (C11) key off the Omni agent id.
  - Mapping a herdr bot id to an Omni agent is the harness's or Brain's job (C12), not Omni's.

## WRS bar (round 3, before the scouts)

| Dimension | Score | Why |
|---|---|---|
| Problem | 19/20 | Unchanged in substance: every source question is answered at HEAD. One new fact gap: "one busy GitLab project's journal volume" has never been put as a number, and C13 cannot run without it. |
| Scope | 15/20 | R2-2 removes multitenant work from slices 2, 3 and 6, and R2-3 adds C15 as a proof obligation. Slice 5 may still split at design time. O12 may add a C5 clause. |
| Decisions | 14/20 | Eight settled. Open: O4 and O5, which have waited two rounds, O12, and three new ones: O13 (what "matched" means for payload filters), O14 (C9's depth bound) and O15 (the backlog limit's number and behaviour). |
| Risks | 18/20 | Multitenancy leaves through a refusal gate. New: an OR'd grant clause may defeat the composite index that R2-1 needs. Still unknown: whether media URLs carry signed parameters (C8), and whether agent sends can be made idempotent (C9). |
| Criteria | 15/20 | C13 has both numbers (p95 2 s, matched rows only), but no stated volume, and "matched" is ambiguous for payload filters. C9's depth bound has no number. The backlog limit has no number and no defined behaviour when it is exceeded. |
| **Total** | **81/100** | |

## Gap map (round 3)

- **Settled by the owner (ledger):** R1-1 to R1-4 and R2-1 to R2-4.
- **Settled outside the ledger (round 1):** direction, C0 to C14 with the round-1 corrections, per-agent delivery
  mode, GitLab waits.
- **Lead design calls (Assumed):** A13 to A19 stand. New this round: A20 (multitenancy refusal gate), A21 (C15 shape
  and placement), A22 (the R2-1 criterion's reading), A23 (consequences of the Omni agent id).
- **Facts this round's scouts gather:**
  - E: how the pull clauses compose, every index on `omni_events`, whether `filters` can move into SQL, and which
    index set could meet R2-1 in each consumer shape;
  - F: the "busy GitLab project" volume, from the GitLab brainstorm;
  - G: idempotency on sends and trigger, media access without a provider URL, and signed media URLs (C8, C9);
  - H: the flag mechanism, multitenancy detection, cursor seek or reset, backlog caps, and consumer naming on
    converge (C14, C13, C6).
- **Owner decisions after the scouts (at most four):** O4 and O5 have waited two rounds and go in this batch unless a
  confirmed exposure displaces them. O13 depends on scout E. O14, O15 and O12 compete for the remaining places.
- **Out of this design (R2-2):** tenant-aware keys, consumers, pairing and managed automations, and the round-2
  tenancy unknowns listed above.
- **Blocks what:**
  - Scout F's volume and O13 block C13's criterion. O15 blocks C13's backlog-limit test.
  - O14 blocks C9's depth test.
  - O4 decides whether a conversational agent may switch mode, which C6 needs.
  - O12 decides whether C5 refuses core types from `emit_event`.
  - Scout G blocks C8's media rule and C9's idempotency test.
  - O7, O9, O10 and O11 no longer block anything.
  - C0 and C15 ship ahead as fixes. Slices 1 to 5 still gate the GitLab connector, and slices 1 and 2 still gate
    the swarm's Omni intake.

## Round 3 scout findings

Four read-only scouts reported: E, G and H in omni at `ee5753234` (code only, no database), F in
`.genie/brainstorms/gitlab-sdlc-connector/`. Citations are the scouts'; paths are under `packages/` unless they say
otherwise. No EXPLAIN was run, so every query-plan statement below is an inference from the schema and the PostgreSQL
planner rules, not a measurement; C13 measures. The lead spot-checked the long-poll loop
(`api/src/services/event-consumers.ts:618-638`), `scopeTriggerKey` (`api/src/services/webhooks.ts:96-105`), the
absence of any idempotency field or `Idempotency-Key` header on the send routes, and that no code branches on
`agent.provider`. No scout found text in the code that addresses the reader. Nothing was modified.

**How a pull builds its SQL, and which indexes exist (scout E)**

- Every pull, shared claim, reclaim, stream page and lag check goes through one `scanPage`: `SELECT * FROM omni_events
  WHERE journal_seq > cursor [AND journal_seq <= through] AND <type clause> AND <instance clause> AND <access clause>
  AND <extra> ORDER BY journal_seq LIMIT n` (`api/src/services/event-consumers.ts:884-909`).
  - Type clause: an entry ending in `*` becomes `event_type LIKE '<prefix>%'`, anything else goes into
    `event_type IN (...)`, and `excludeTypes` is applied as `NOT(<same builder>)` (`api/src/services/events.ts:24-47`).
  - Instance clause: `instance_id IN (...)` for a scoped consumer, the literal `false` for an empty set, nothing for an
    unscoped one (`event-consumers.ts:381-384`).
  - Access clause: `access_decision = <filter>`, widened to `(access_decision = <filter> OR journal_ready = false)` when
    `waitForReady` is on. The stream path always forces `waitForReady`, so every access-filtered stream scan carries
    that OR (`:406-413`, `:743`).
- The long-poll loop re-runs the scan every 500 ms while the page is empty, for up to 30 s, and never writes the
  cursor inside the loop. Payload filters and the access verdict then run in JS on the page. When nothing matched, the
  cursor jumps past the scanned page under a monotonic guard (`:610-649`, read by the lead).
  - A row that passes the SQL clauses but fails a payload filter ends the loop, is read once, delivered as nothing,
    and is skipped by that cursor jump. It is not re-read on a later pull.
  - **The DRAFT's "an idle rescan reads no heap row" is false in one case.** When `waitForReady` cuts a non-empty
    page to empty, every rescan fetches the same held not-ready rows again, up to `limit` of them, every 500 ms
    (`:618-627`, `:222-231`). Those rows pass the SQL clauses, so R2-1's bound still holds; the sentence about an idle
    rescan does not.
  - A shared consumer's claim runs inside a compare-and-swap loop of up to 20 attempts, and a reclaim re-reads its
    range, so rows read per pull also count retries and reclaims (`:760-821`, `:865-869`).
- **Indexes on `omni_events`:** the primary key and 19 others, every one on a single column. None is composite with
  `journal_seq`, and none covers `access_decision`, `journal_ready` or any jsonb column (`db/src/schema.ts:2095-2122`;
  migrations `0000`, `0001`, `0041`, `0058`, `0059`, `0064`). Migrations `0080` and `0083` add `journal_ready` and
  `access_decision` with no index. One drift: `schema.ts` declares `omni_events_tenant_idx` as a plain index, while
  `0041` creates it as a partial one (`WHERE tenant_id IS NOT NULL`).
- No source-reference column exists yet; A13's column and `producing_key_id` are new migrations, as the DRAFT assumes.
  The connector subscription id lives only in `metadata` jsonb (`db/src/schema.ts:2054`, `db/drizzle/0090_*.sql:7-10`).
- **Consumer payload `filters` are not equality only.** The create schema accepts `eq`, `neq`, `gt`, `lt`, `gte`,
  `lte`, `contains`, `not_contains`, `exists`, `not_exists` and `regex`, up to 20 conditions, ANDed
  (`api/src/schemas/openapi/event-consumers.ts:17-27`, `core/src/automations/types.ts:11-23`). The DRAFT's O13 said
  "equality only (round 1, scout 2)". Round 1's fact was about the manifest `accepts` filter, which
  `filterToConditions` compiles to `eq` only (`api/src/services/manifest-compiler.ts:92-97`, read by the lead). Both
  hold: a consumer compiled from `accepts` (C6) carries `eq` filters only, while a hand-created consumer may carry any
  of the eleven.
- The consumer matcher reads `rawPayload` only, by dot path, with strict `===` for `eq`. The automation engine instead
  matches on a context that flattens `metadata` and `rawPayload` (`event-consumers.ts:266-272`, `:430-432`;
  `core/src/automations/conditions.ts:30-45`). So today the same `accepts` filter can resolve its field differently
  in the two delivery modes.
- Moving filters into SQL: only `eq` and `exists` map cleanly onto jsonb (`raw_payload @> ...`, `#>`). Ranges need
  typed casts, `contains` needs array and string branches, and `regex` needs a translation from JS to POSIX. With no
  jsonb index, a SQL filter removes rows from the output but still reads their heap tuples, and a `jsonb_path_ops` GIN
  index returns rows unordered by `journal_seq`.
- Index shapes, by consumer shape (inference):
  - **Exact type.** A composite `(event_type, journal_seq)` makes reads equal the rows that match the type, and an
    empty rescan one index probe. `excludeTypes` as `NOT(...)` cannot use it, so excluded rows inside the range are
    still read.
  - **Trailing-`*` glob.** The same index serves `LIKE 'prefix%'` only with `text_pattern_ops` or a C collation, and
    returns rows by `(type, seq)`. Reads stay matched-only, but the early stop is lost: each rescan sorts the whole
    matching backlog. Keeping both needs a generated namespace column indexed with `journal_seq`, or per-type ordered
    scans merged by `journal_seq`.
  - **Instance-scoped `message.received` with the A13 grant OR** (instance, source reference, `agent_id`). The
    single-column indexes give a BitmapOr that reads only matching rows but unordered, so every rescan re-collects and
    sorts. Reads equal to matches plus an early stop need one composite per grant branch, such as
    `(instance_id, event_type, journal_seq)`, and a query written as per-branch ordered scans merged by `journal_seq`.
    `scanPage` does not emit that today.
  - An OR term on an unindexed column defeats the whole OR. The existing case is the `waitForReady` access clause,
    always on for streams. A NULL `instance_id` is never matched by `IN`, so reaching NULL-instance rows needs its own
    indexed OR branch.

**The busy GitLab project's volume (scout F)**

- **No source states a volume for a busy project.** The only figure is "~750 in-scope events a day" for `khal/brain`
  (`gitlab-sdlc-connector/DRAFT.md:708`, `:1100`), with no derivation, no hourly figure and no burst rate.
- F11's counts for that project, from about two days of history (created 2026-10-30): 267 issues opened, 178 MRs
  opened, 168 merged, 531 push events (81, 297 and 153 a day, the last day partial), 378 MR comments, 245 issue
  comments, and zero pipelines failed, tags, releases and deployments (`gitlab-sdlc-connector/DRAFT.md:155-162`). They
  sum to about 880 a day, not 750, and the draft does not say which subset is in scope. The project is new, so this is
  a launch spike, not a steady state.
- Under R4-1 only deliveries that match a subscription are journaled, so the journaled share depends on the
  subscription set, which no file names (`gitlab-sdlc-connector/DRAFT.md:232-241`, `:832-837`).
- No byte size per row is given. A GitLab push row carries its body twice (`{...data}` plus `rawPayload`), and nothing
  prunes `omni_events` (`gitlab-sdlc-connector/DRAFT.md:664-672`).

**Send and trigger idempotency, and media (scout G)**

- `POST /events/trigger` takes an optional `idempotencyKey` (1 to 255 chars) (`api/src/routes/v2/webhooks.ts:190-219`).
  - It is stored as `manual:{instanceId ?? tenantId ?? 'global'}:{key}` in `omni_events.idempotency_key` and in
    `metadata.idempotencyKey` (`api/src/services/webhooks.ts:96-105`, `:763-785`). The function's comment says
    "never global", but the code falls back to `global` when the call has no instance and no tenant. So two producers
    without an instance that pick the same key collide, and the second gets the first one's event id back.
  - The dedup authority is the unique index on `idempotency_key` with `onConflictDoNothing`; a duplicate returns the
    original event id with `duplicate: true` and HTTP 201, the same status as a new event, and a failed publish
    deletes the claim so a retry is not taken for a duplicate (`:551-578`, `:786-814`).
- **No send route takes an idempotency key.** `POST /messages/send` and every other send route (`media`, `reaction`,
  `tts` and the rest, used by `say`, `react`, `speak`, `imagine` and `done`) call the provider directly, so two
  identical requests send twice (`api/src/routes/v2/messages.ts:672-712`, `:1329-1456`). `messages` dedups only on the
  provider's `external_id`, which exists only after the send (`db/src/schema.ts:1936-1941`). `POST /turns/close` is
  idempotent by state, not by key.
- **Omni already serves media without a provider URL.**
  - `POST /messages/media/download` takes a message reference, checks instance access, and returns a cached or fresh
    Omni-hosted copy at `/api/v2/media/<path>`; it needs `messages:read`
    (`api/src/routes/v2/messages.ts:1033-1143`).
  - `GET /media/:instanceId/*` streams a stored file by path and needs `media:read`. The scope enforcer binds it to
    the instance only, not to a chat, so a chat-locked key with `media:read` can probably read any file under its
    instance if it knows the path (`api/src/middleware/scope-enforcer.ts:215-240`; not fully verified).
  - In remote mode the dispatcher already hands agents a presigned URL minted at dispatch time, with a TTL clamped to
    60 s; in local mode it hands an absolute file path (`api/src/plugins/agent-dispatcher.ts:1075-1175`).
  - The default turn scopes and the `cs` profile hold neither `messages:read` nor `media:read`
    (`api/src/constants/scopes.ts:13`, `api/src/constants/profiles.ts:219-250`). Neither does the C4 profile.
- **Stored provider `mediaUrl` values carry no token added by Omni's code, and none is usable by an agent as it is.**
  - Slack: a `files.slack.com` URL that needs the bot token as a bearer header, which Omni adds itself and must never
    hand to an agent (`channel-slack/src/plugin.ts:2566-2625`).
  - WhatsApp (Baileys): an Omni-hosted URL when the download succeeded, else the encrypted `mmg.whatsapp.net` blob
    (`channel-whatsapp/src/handlers/messages.ts:855-915`, `:1236-1242`).
  - Discord, Twilio and Gupshup: the provider URL verbatim. Whether they expire or need credentials is not visible in
    code (`channel-discord/src/plugin.ts:1190-1196`, `channel-twilio-whatsapp/src/handlers/webhooks.ts:109-118`,
    `channel-gupshup/src/handlers/webhooks.ts:709-718`).

**Flags, multitenancy detection, cursors and naming (scout H)**

- **Default-off flags are environment predicates read on every call, compared to the exact string `'true'`.** The
  precedent is `OMNI_MULTITENANCY_ENABLED`: `isMultitenancyEnabled()` gates the `/api/v2/platform` mount, and the
  rollback is to unset it and restart (`api/src/tenancy/feature-flag.ts:13-17`, `api/src/app.ts:652-662`,
  `docs/deployment/single-tenant-mode.md:28-38`). That flag also changes middleware, login, cache, scheduling and
  stream subscriptions, so it is not a narrow precedent. `A2A_ENABLED` is a second one (`api/src/app.ts:213`, `:277`).
  `global_settings` has no boolean getter and carries no flag.
- Multitenancy state is reported by authenticated `POST /auth/validate` through `serverTenancyPosture()`, and shown by
  `omni multitenancy status`, `omni status` and `omni auth` (`api/src/tenancy/server-posture.ts:46-60`,
  `api/src/routes/v2/auth.ts:106`). **`omni doctor` reports no flag state at all:** its 14 checks are infrastructure
  checks (`cli/src/commands/doctor.ts:90-104`, `:1263-1281`).
- **No seek, reset or "from now" exists on an existing consumer.** The routes are list, create, get, delete, pull, ack
  and stream. `startFrom` (`now` or `beginning`) applies only at create. Acks are monotonic and refuse a cursor behind
  the stored one (`api/src/routes/v2/event-consumers.ts:62-135`, `api/src/services/event-consumers.ts:449-451`,
  `:637`, `:669`, `:683`).
- **No backlog cap, pause, status column or dead-letter store exists for durable consumers.** Lag is `head - cursor`
  over every journal row. The only bounds are per request: 500 rows and 30 s (`event-consumers.ts:197-199`, `:454-456`;
  `db/src/schema.ts:3735-3790`). `consumer_offsets` and `/health/consumers` track NATS sequences, a different system.
- Consumer names are unique through one global index on `durable_consumers.name` (varchar 100), and a taken name
  blocks every other caller (`db/src/schema.ts:3740`, `:3788`; `event-consumers.ts:557-563`).
- **The manifest compiler does not touch consumers.** It reconciles `call_agent` automations by deterministic name and
  updates drifted rows in place by id (`api/src/services/manifest-compiler.ts:190-250`,
  `api/src/services/automations.ts:319-337`).
- The cursor lives only in `durable_consumers.cursor` (and `lease_state`). Delete is a hard delete with no tombstone.
  The last cursor survives only in a `system.consumer.deleted` bus event that is not journaled, and only when a bus is
  wired. Recreating a consumer sets its cursor from `startFrom`: `now` skips everything since the old cursor with no
  record, `beginning` replays the whole journal. `CreateConsumerInput` has no cursor field
  (`event-consumers.ts:63-110`, `:536-557`, `:573-596`).

## Design consequences (round 3)

What R2-1 to R2-4 and the round-3 facts require of each slice. These are lead design calls that only add scrutiny;
none changes an owner answer.

- **R2-1's bound holds as the owner chose it; one sentence of the DRAFT's own wording does not.** The criterion reads
  "no journal row that fails the consumer's SQL clauses". The added sentence "an idle rescan is an index probe that
  reads no heap row" is false while the readiness gate holds a page. Rows held that way pass the clauses, so they are
  inside the bound, but C13 also reports how many times one pull re-reads the same held rows, and slice 7 makes a
  rescan after a hold probe only the held head row (A22, sharpened). The Round 3 section above keeps the sentence as
  it was written; A22 is the reading.
- **The scan for agent-owned consumers is a new query, not a new index alone (A25).**
  - one composite index per grant branch, each ending in `journal_seq`, plus `(event_type, journal_seq)`;
  - the grant written as per-branch ordered scans merged by `journal_seq`, not as one OR;
  - the access verdict and `journal_ready` indexed, or carried in a partial index, so their OR stops defeating the
    plan;
  - `excludeTypes` refused on agent-owned consumers, or rewritten as a positive type list;
  - globs served by a namespace column or a per-type merge, chosen after C13 measures;
  - legacy consumers keep today's `scanPage` (C1).
- **C6 has two more obligations (A28).**
  - The compiled consumer filter must resolve fields exactly as the automation engine does, or one `accepts` entry
    matches different rows in the two modes. A test proves the same declaration matches the same rows in both.
  - Convergence updates the managed consumer in place by its deterministic name and never deletes and recreates it,
    because a recreate loses the cursor silently. A name already held by a consumer the reconciler does not manage is
    refused and reported by `doctor`, never adopted. A mode switch away from subscriber still deletes the consumer
    (C6), so switching back starts from now, and the gap is recorded and reported (record-and-report).
- **C9's idempotency is two pieces of work (A26).**
  - For agent-bound keys, the trigger key is namespaced by the agent (`agent:<agentId>:<key>`), not by instance,
    tenant or `global`, so two agents cannot collide.
  - The send routes gain an optional caller key for agent-bound keys, claimed before the provider call and released on
    failure; a duplicate returns the first result with `duplicate: true`. A crash after the provider accepted the send
    and before the result is recorded can still send twice; the design says so rather than claim exactly-once.
  - The residual ping-pong risk under A17 is narrower than written: two agents that keep up never build a backlog, so
    the backlog limit does not bound them. Rate limits do.
- **C8 never carries a provider `mediaUrl` (A27).** The envelope carries the message id, the media type and a
  has-media marker. The C4 profile gains no read scope by assumption; how a paired agent reaches the bytes is O16.
- **C13 needs three controls that do not exist.** A forward-only seek to head ("resume from now", monotonic like ack,
  with the skipped range journaled), a backlog measure over matching rows, and whatever O15 decides happens past the
  limit (A29, A30).
- **C14 and A20 follow the exact-string env precedent (A20, sharpened).** Each slice reads its own env flag with
  `=== 'true'`; rollback is to unset it and restart, with the additive columns left in place and unread. `doctor`
  gains a new check that reads the server's posture through `POST /auth/validate`, because it reports no flag state
  today.

## WRS bar (round 3, after the scouts)

| Dimension | Score | Why |
|---|---|---|
| Problem | 19/20 | Every planned question is answered from code. The one remaining gap is now known to have no source: no file states a busy project's volume, and the only figure (~750 a day) does not match its own counts. A24 stands in until C13's first run. |
| Scope | 15/20 | No owner answer this round and no Scope IN change. The slices grew in substance: a per-branch scan and new indexes (slice 2 and 7), a send idempotency key (slice 4), an update-in-place consumer path and a filter-parity test (slice 5), a forward seek and a backlog measure (slice 7), a new `doctor` check (every flag). O16 may add a media path. |
| Decisions | 14/20 | Unchanged: eight settled, none answered this round. Asked now: O4, O5, O13, O15. Waiting: O12, O14 and the new O16. |
| Risks | 19/20 | Found and named: held not-ready rows re-read every rescan, an OR'd grant and `excludeTypes` defeating the index, globs losing the early stop, filter fields resolved differently by the two modes, a cursor lost on any recreate, the `global` trigger-key collision, sends with no idempotency, and media reachable only behind read scopes the C4 profile lacks. Still unknown: Discord, Twilio and Gupshup URL expiry, the database collation, and whether `GET /media` is chat-bound. |
| Criteria | 16/20 | Testable now: C8's media rule (no provider URL in the envelope), C9's trigger and send duplicates, C6's filter parity and cursor survival across converge, A20's refusal. C13 has a stated volume, but it is an assumption (A24), not a source. Still open: O13 (what "matched" means for filters), O14 (C9's depth number) and O15 (backlog behaviour). |
| **Total** | **83/100** | |

## Gap map (round 3, after the scouts)

- **Settled by the owner (ledger):** R1-1 to R1-4 and R2-1 to R2-4.
- **Settled by facts this round:**
  - how a pull's SQL composes, every index on `omni_events`, and which index set each consumer shape needs;
  - that consumer filters take eleven operators while `accepts` compiles to `eq`, and that the two modes resolve
    filter fields differently;
  - that no busy-project volume exists in any source;
  - trigger idempotency, the absence of send idempotency, the Omni-hosted media routes and their scopes;
  - the flag precedent, where multitenancy is reported, and that `doctor` reports no flag;
  - that no seek, cap, pause or dead-letter exists, and that a recreate or delete loses the cursor.
- **Lead design calls (Assumed):** A20 and A22 sharpened; new A24 (C13 volume), A25 (agent-consumer scan and
  indexes), A26 (C9 idempotency), A27 (C8 media), A28 (C6 filter parity and converge in place), A29 (resume from now),
  A30 (backlog default size).
- **Owner decisions asked now:** O4 (conversational agents on pull), O5 (`agents.provider`), O13 (filter-dropped rows),
  O15 (backlog behaviour).
- **Owner decisions waiting:** O12 (core types from `emit_event`), O14 (C9's depth bound), O16 (media for paired
  agents).
- **Facts still unknown:**
  - the real plans and costs on a production-sized journal, the collation and the Postgres version (C13 measures);
  - whether Discord, Twilio and Gupshup media URLs expire or need credentials;
  - whether `GET /media/:instanceId/*` enforces any chat binding;
  - whether any foreign key or trigger touches `durable_consumers` on delete;
  - the row-level security policy text on `omni_events` and how its tenant predicate uses an index;
  - whether any live consumer uses filter operators other than `eq`.
- **Blocks what:**
  - O13 blocks C13's rows-read test; O15 blocks C13's backlog test; A24 can be replaced by an owner figure at any time.
  - O14 blocks C9's depth test.
  - O4 decides whether the subscriber mode C6 builds is open to chat agents; O5 decides what a paired agent row holds.
  - O16 blocks the media half of C8 only: without it, the envelope carries no way to fetch bytes.
  - O12 decides whether C5 refuses core types from `emit_event`.
  - C0 and C15 ship ahead as fixes. Slices 1 to 5 still gate the GitLab connector, and slices 1 and 2 still gate the
    swarm's Omni intake.

## Round 4: what the owner settled, and what it changes

The owner answered all four round-3 questions (Settled R3-1 to R3-4). HEAD is still `ee5753234`. No wish under
`.genie/wishes/` carries the C0 fix (R1-1) or the cross-tenant consumer fix (R2-3) yet.

- **R3-1, a conversational agent may move to subscriber mode, and the cost is stated.** Call mode stays the default
  (C6). The switch is never silent (A31): it names what the agent loses and what a person waits. One fact behind the
  question was incomplete. It said "once C6 lands, nothing in the code stops the switch", but it did not ask how the
  dispatcher chooses whom to call. If the dispatcher serves an agent through `instances.agent_id` rather than through
  managed `call_agent` rows, a mode switch alone leaves dispatcher delivery on, and the agent gets each message both
  ways, against C6. Scout J checks it. If it holds, the owner's answer stands and the way out becomes O18.
- **R3-2, `agents.provider` gains the member `paired`.** It is a code change at the Zod and OpenAPI sites; the column
  is varchar(50) with no database check. The consequence the design adds (A32): a `paired` agent has no endpoint, so
  it is subscriber-only, and a call-mode compile for it is refused.
- **R3-3, a row that fails only the payload filters counts as matched.** Filters stay in JS, no jsonb index is added,
  and R2-1 is met by the index and scan work of A25 alone. C13's rows-read criterion is now fully defined: one pull
  reads no row that fails the consumer's SQL clauses. C13 also reports the filter-dropped count (A33).
- **R3-4, past the backlog limit Omni only reports.** No pause, no skip, no dead-letter store, no new cursor
  behaviour. The work left is a bounded matching-row count, a mark in `omni agents graph`, a `doctor` warning with the
  fix, and the manual "resume from now" control C13 already names (A29, A34). This removes the largest open piece of
  slice 7.

What is still open: O12 (core types from `emit_event`), O14 (C9's depth number and what happens past it), O16 (how a
paired agent reaches media bytes), O17 (C13's volume, A24 made a question) and the candidate O18.

## WRS bar (round 4, before the scouts)

| Dimension | Score | Why |
|---|---|---|
| Problem | 19/20 | Unchanged. One premise of R3-1 is unverified: how the dispatcher picks the agent it calls (scout J). |
| Scope | 17/20 | R3-4 settles slice 7's behaviour past the limit, R3-2 fixes what a paired agent row holds, R3-1 opens subscriber mode to conversational agents. Slice 5 may still split at design time. O16 may add a media path, and O18 may touch C7. |
| Decisions | 16/20 | Twelve settled. Open: O12, O14, O16 and O17; O18 is a candidate that depends on scout J. |
| Risks | 18/20 | New: a mode switch may leave dispatcher delivery on (C6 against C7). Still unknown: whether `GET /media` is chat-bound, which live paths emit core types through `emit_event`, Discord, Twilio and Gupshup URL expiry, the database collation. |
| Criteria | 17/20 | C13's rows-read and backlog criteria are defined (R3-3, R3-4). Missing: C9's depth number (O14), the media half of C8 (O16), and a volume the owner has seen (O17). |
| **Total** | **87/100** | |

## Gap map (round 4)

- **Settled by the owner (ledger):** R1-1 to R1-4, R2-1 to R2-4, R3-1 to R3-4.
- **Lead design calls (Assumed):** A13 to A30 stand; A24 becomes O17. New: A31 (the switch notice), A32 (`paired` is
  subscriber-only), A33 (filters in JS, the filter-dropped count), A34 (report only, bounded backlog count).
- **Facts this round's scouts gather (code only, omni at `ee5753234`):**
  - I: whether `GET /media/:instanceId/*` and `POST /messages/media/download` honour a chat binding, and whether the
    dispatcher's presign can be called outside the dispatcher, for O16;
  - J: how the dispatcher chooses whom to call, the dispatcher-only features a subscriber agent loses, every site
    that enumerates `agents.provider`, for R3-1, R3-2 and O18;
  - K: who emits core types through `emit_event`, the `system.dead_letter` shape, any depth reference, and how the
    engine's `#1148` sender guard relates to C9's self-drop, for O12 and O14.
- **Owner decisions next batch (at most four):** O12, O14, O16, O17. If scout J confirms O18, it takes a place, and
  the lowest-priority of the others waits under Open with the reason.
- **Blocks what:**
  - O14 blocks C9's depth test; O16 blocks the media half of C8; O17 blocks C13's pass or fail; O12 decides one C5
    clause.
  - Scout J, and O18 if it is asked, decide how slice 5 implements a mode switch without breaking C6 or C7.
  - C0 and C15 ship ahead as fixes. Slices 1 to 5 still gate the GitLab connector, and slices 1 and 2 still gate the
    swarm's Omni intake.

## Round 4 scout findings

Three read-only scouts reported: I, J and K, all in omni at `ee5753234`, code only, no database. Citations are the
scouts'; paths are under `packages/` unless they say otherwise. The lead spot-checked the dispatcher's agent gate
(`api/src/plugins/agent-dispatcher.ts:5779-5786`), the key rewrite on unbind (`api/src/routes/v2/instances.ts:1380-1396`)
and the auto-provisioned key's scopes (`api/src/constants/scopes.ts:13`), `ApiKeyService.instanceAllowed`
(`api/src/services/api-keys.ts:978-981`), `enforceAllowlist` (`api/src/middleware/scope-enforcer.ts:149-175`), the
presign branches (`api/src/services/media-storage.ts:517-543`) and the default media mode
(`channel-sdk/src/media-backends/config.ts:110-138`). No scout found text in the code that addresses the reader.
Nothing was modified.

**How the dispatcher picks whom to call (scout J)**

- The dispatcher selects its agent through the instance binding, never through managed `call_agent` rows. The path
  is: subscribe to `message.received` (durable `agent-dispatcher-msg`) → `shouldProcessMessage` →
  `resolveEffectiveInstance` → debounce → `processAgentResponse` → `dispatchToAgent` → provider
  (`agent-dispatcher.ts:6258-6367`, `:6272-6331`, `:4453-4468`, `:4116-4180`).
- The hard gate drops a message when `instances.agent_id` is null (`:5783`, read by the lead). The reaction and
  typing paths apply the same gate (`:5988`, `:6525-6528`). After the gate, `route.agentId ?? instance.agentId`
  picks the agent (chat route, then user route, then the instance), and `getAgentProvider` loads the provider by
  `agentProviderId` (`:5098-5122`, `:5015-5039`, `:4962-4975`). The dispatcher never reads `agents.provider` and never
  reads `agents.is_active`.
- **O18's premise is confirmed.** A mode switch that removes managed `call_agent` rows leaves `instances.agent_id` and
  `agent_routes.agent_id` as they are, so dispatcher delivery stays on and the agent receives each message both ways.
  The only ways to stop it are to unbind every instance and route that names the agent, or to add a mode check inside
  the dispatcher, which is an edit to `agent-dispatcher.ts` and so an exception to C7. Setting `agent_provider_id` to
  null or `is_active` to false does not stop it.
- **A bound provider-less agent sends the customer an error.** If an agent with no `agentProviderId` (a `paired`
  agent under A32) is bound to an instance, every inbound message ends in `ProviderError('No agent provider configured
  for instance', 400)`. That is not retried, and `sendErrorFeedback` sends "Opa, tive um probleminha aqui" (or the
  instance's configured text) to the person; on Gupshup it triggers a human handoff instead
  (`agent-dispatcher.ts:3122-3123`, `:4182-4196`, `:3412-3425`, `:4478-4488`, `:826-856`;
  `api/src/services/agent-runner.ts:645-647`).
- Whether the automation engine would also fire a managed `call_agent` row for `message.received` on an instance the
  dispatcher serves was not traced. Nothing in the compiler or the manifest schema forbids it
  (`api/src/services/manifest-compiler.ts:144-163`; `core/src/schemas/agent-manifest.ts:34-43`).

**What unbinding an instance does (scout J, the key rewrite read by the lead)**

- `PATCH /instances/:id` with `agentId: null` writes the column and evicts the provider cache; it does not change the
  instance's active or connection state (`api/src/services/instances.ts:144-157`; `api/src/routes/v2/instances.ts:1313-1365`).
- **Unbinding an agent's last instance widens its key to every instance. This is a live exposure today.** The handler
  removes the instance from the old agent's auto-provisioned key `agent:<name>` and writes `instanceIds: null` when the
  list becomes empty (`instances.ts:1389`). Null means every instance (`api-keys.ts:978-981`, `middleware/auth.ts:210`).
  The key carries `messages:send`, `turns:close`, `tts:synthesize` and `context:read` by default (`scopes.ts:13`), or
  the agent's declared `omniScopes`. Moving an agent to another instance, or unbinding it, therefore turns a
  one-instance key into an all-instances key. The same happens when an instance is reassigned to a different agent.
  An empty list is no safe substitute: `context.ts:142,195` and `connectors.ts:45` treat an empty list as unrestricted
  (lead grep).
- Other effects of unbinding: `sentBy: 'agent'` sends still go out but carry no `senderAgentId`, with a warning
  (`messages.ts:748-764`); reconnect replay is skipped (`agent-replay.ts:120-124`); an A2A instance answers 409 and drops
  out of discovery (`app.ts:60-62`, `a2a-discovery.ts:201`); the trash-emoji session reset throws
  (`session-cleaner.ts:170-173`).
- Agent keys are auto-provisioned only on that PATCH, when `agentId` changes (`instances.ts:1351-1362`, `:1398-1432`).

**What a subscriber agent loses (scout J)**

Dispatcher-only, so lost on a switch to subscriber mode (all in `agent-dispatcher.ts`):
- message guards: the DM, mention and reply-to-bot filter; access control with the pairing request and block message;
  own-echo, first-party loop, stale, broadcast and trash-emoji drops (`:5742-5816`, `:5864-5958`);
- debounce and batching, with restart on typing and a "received" reaction while a run is busy (`:434-445`,
  `:6296-6350`, `:6514-6557`, `:4082-4100`);
- typing presence, the reaction acknowledgement and the optional text acknowledgement (`:539-553`, `:4317-4327`,
  `:4418-4440`);
- inbound quoted-message context and reply quoting (`:1483-1580`, `:1713-1770`, `:1614-1621`);
- splitting, formatting, pacing, the self-chat prefix and `before_message_write` hooks (`:1592-1648`, `:2436`);
- turns, turn context on the key, `OMNI_*` env and `POST /turns/close`, for turn-based providers
  (`:2895-3058`; `api/src/routes/v2/turns.ts:104-140`);
- session handling: session ids by strategy, resets, per-thread lazy init (`:3578-3760`, `:4013-4030`);
- error replies and the Gupshup handoff; a subscriber agent's failure is silent to the person (`:600-960`);
- the handoff pause, the close-contact gate, the per-chat limiter, the LLM response gate, supersede, wait-for-media,
  streaming with cancel, reaction triggers and `before_agent_start` hooks (`:4343-4392`, `:4211-4280`, `:6039-6060`,
  `:423-432`, `:1945`, `:2534-2700`, `:6431-6560`, `:3167`);
- causality: a reply sent inside a dispatcher run is stamped caused-by the inbound event (`:6236-6243`); a
  subscriber's send is a root unless it supplies a cause.

Not lost, because the dispatcher never did them: read receipts (explicit routes only, `messages.ts:2890-2979`) and TTS
replies (send and TTS routes only).

**Where `agents.provider` is enumerated (scout J)**

- Eight sites hard-code the six members: `core/src/schemas/agent.ts:25`; `db/src/schema.ts:62-63` and `:404` (a type
  only, no database check); `api/src/routes/v2/agents.ts:29` (update inherits it, the list filter takes any string);
  `api/src/schemas/openapi/agents.ts:53,76,109`; the CLI's `VALID_PROVIDERS` and help (`cli/src/commands/agents.ts:25`)
  and `_setup-helpers.ts:17-32`; the SDK (`sdk/src/client.ts:4620` and the generated `types.generated.ts`, which is
  regenerated); and `docs/architecture/actor-model.md:94`, which is already stale (five members). The UI and the
  Python and Go SDKs have no such enum.
- No runtime code branches on the value, so `paired` is an additive enum edit. `agentProviderId` is already optional
  at every create and update surface, and the column is nullable.
- Code that requires `agentProviderId` and fails without it: the dispatcher (above), `AgentRunnerService.run` and its
  streaming variant (`agent-runner.ts:645-647`, `:865-870`), chatless and message-bound `call_agent`
  (`api/src/plugins/automation-actions.ts:112-114`, `:437`) and the session cleaner (`session-cleaner.ts:179-181`).
- The manifest compiler reads neither field, so A32's refusal of a call-mode compile for a `paired` agent is a new
  check, not an edit to an existing one (`manifest-compiler.ts:128-163`).

**Media for a paired agent (scout I, two branches read by the lead)**

- `GET /media/:instanceId/*` binds to the instance only. The handler checks the instance id and the path segments and
  streams the file. It reads no key, chat allowlist, `contextChatId` or message (`api/src/routes/v2/media.ts:728-830`).
  The enforcer extracts the instance from the path and leaves the chat target null (`scope-enforcer.ts:215-240`,
  `:343-361`).
- **A key with an active chat allowlist is refused on `GET /media` outright.** `enforceAllowlist` denies a null target
  when the list is non-empty, and denies everything when the profile requires the lock and the list is empty
  (`scope-enforcer.ts:149-175`, read by the lead; `:637-640`). R1-3 bounds the paired profile's `messages:send` by a
  chat allowlist, so adding `media:read` to C4 would not reach any bytes without also exempting the route from the
  chat lock. This is read from code; no test covers a chat lock on `/media` (the existing test covers the instance
  lock only, `middleware/__tests__/scope-enforcer-media.test.ts:58-91`).
- `POST /messages/media/download` (`messages:read`) checks instance access only in the handler. A chat-locked key is
  refused on the `messageId` and `instanceId`+`chatExternalId` refs (no chat target), passes the chat lock on
  `chatId`+`externalId`, and is then refused by the recipient lock, because the route is not recipient-free. It
  returns a relative `/api/v2/media/<path>`, which again needs `media:read` (`messages.ts:950-1143`;
  `scope-enforcer.ts:296-312`, `:495-524`).
- The presign is reachable outside the dispatcher: `services.mediaStorage.presignedUrl(key, ttl, tenantId)` is public
  on the shared `Services` object (`api/src/services/media-storage.ts:161`, `:517`; `api/src/services/index.ts:143`,
  `:233-234`). **The DRAFT's "60-second presigned URLs" holds only under a tenant.** With a tenant id the TTL is
  clamped to 60 s; without one (the single-owner world of R2-2) there is no clamp and the backend default is 3,600 s
  (`media-storage.ts:517-522`, `:541`; `channel-sdk/src/media-backends/config.ts:70`).
- Presigning exists only in remote mode. `OMNI_MEDIA_MODE` unset means local (`config.ts:110-138`), where
  `presignedUrl` throws and the dispatcher hands the provider an absolute file path instead
  (`channel-sdk/src/media-backends/local-backend.ts:125-127`; `agent-dispatcher.ts:1096-1109`, `:1151-1155`).
- Omni serves no short-lived per-object media token of its own (keyword search; it could miss an unusual name).
  A successful `GET /media` response is cacheable for a year (`media.ts:815`).

**Core types through `emit_event`, dead letters, depth and the sender guard (scout K)**

- Nothing refuses a core type in `emit_event`. `validateEmitEvent` checks the publish allowlist (only when the
  automation has a managing agent) and the schema registry; `EventRegistry.validate` passes every core type without
  looking at the payload; the config takes any string (`api/src/plugins/automation-actions.ts:549-600`, `:273-297`;
  `core/src/events/nats/registry.ts:104-136`; `api/src/routes/v2/automations.ts:68-75`).
- No path, template, preset, plugin skill, CLI helper, test fixture or document in the repo configures `emit_event`
  with a core type. The CLI scaffold hard-codes `custom.` and the docs describe a custom event
  (`cli/src/commands/automations-scaffold.ts:18-34`; `docs/architecture/event-system.md:513`). Deployed rows are
  unknown. The manifest allows a core type in `publishes`, so an agent may declare `message.received` today
  (`core/src/schemas/agent-manifest.ts:28-43`, `:134-141`).
- Where a refusal goes decides what it breaks. Inside `validateEmitEvent` or `enforceEmitEventGates` it touches
  `emit_event` only. Inside `EventRegistry.validate` or `publishGeneric` it also breaks replay, dead-letter retry, the
  WhatsApp plugin and webhooks (`api/src/services/event-ops.ts:487`; `api/src/services/dead-letters.ts:284,407`). The
  automation dry-run never calls `validateEmitEvent`, so a new refusal would not show there unless added
  (`api/src/services/automations.ts:361-412`).
- `system.dead_letter` has two producers. The NATS layer announces subscription failures on the bus and writes no row
  (`core/src/events/nats/client.ts:520-552`). `DeadLetterService` writes a `dead_letter_events` row and announces it
  (`dead-letters.ts:228-248`). The only production writer of rows is `createSchemaValidationFailure`, from refused
  emissions (`publish_not_declared`, schema refusals) and webhook ingress (`automation-actions.ts:255`;
  `webhooks.ts:646,667`). A refusal row gets a fresh event id, `error = '<reason>: …'`, no auto-retry, and status
  `pending` (`dead-letters.ts:190-225`; `db/src/schema.ts:2862-2900`). The announcement is journaled; the refused event
  is not (`event-persistence.ts:681-755`).
- A manual retry republishes through `publishGeneric`, skipping the emit gates and dropping causation
  (`dead-letters.ts:253-300`). A retried depth refusal would restart as a root at depth 0.
- Durable consumers have no dead-letter or max-delivery concept; redelivery is lease expiry
  (`api/src/services/event-consumers.ts:29`, `:194-252`).
- Depth references: the only enforced chain bound is the internal channel's `MAX_HOP_LIMIT = 5`, carried in
  `rawPayload.hopCount` and dropped with a warning (`channel-internal/src/plugin.ts:18`, `:72-110`;
  `agent-dispatcher.ts:2867-2889`). `trace` caps display at 50 ancestors, depth 10 and 200 nodes
  (`api/src/services/events.ts:70-73`). The automation engine has no chain bound; per-hop idempotency keys dedupe
  replays, not chains (`core/src/automations/actions.ts:455-475`).
- Ambient causality is set only by the engine and by dispatcher runs (`core/src/automations/engine.ts:945-955`;
  `agent-dispatcher.ts:6242,6407,6473`). Whether the send routes accept a caller-supplied `causationId` was not
  checked.
- The engine's `#1148` guard is not C9's self-drop. It keys on `payload.senderInstanceId`, which only the WhatsApp
  (Baileys) plugin stamps, only on `message.received`, and which only the automation engine reads
  (`core/src/automations/engine.ts:525-571`; `channel-whatsapp/src/plugin.ts:3674`, `:610-623`). No code stamps it on
  `message.sent`. The closest analogue is the dispatcher's echo check, which keys on a persisted
  `messages.sender_agent_id` (`agent-dispatcher.ts:5692-5722`; `message-persistence.ts:1396`).

## Design consequences (round 4)

- **R3-1 needs a way to stop dispatcher delivery (O18).** Without one, a switched agent gets every message twice,
  against C6. The two ways out each cost something: a dispatcher mode check is an exception to C7; unbinding loses the
  binding's side effects and, until the key widening is fixed, widens the agent's key to every instance.
- **The key widening is a live exposure of its own (O19).** It is in the code today, independent of this design, and
  it touches the keys A15's backfill links to agents. It is the same class as R1-1 and R2-3.
- **A `paired` agent must never be bound (A35).** A bound provider-less agent sends the person an error reply on
  every message, so binding a `paired` agent to an instance or a route is refused, as is changing a bound agent's
  provider to `paired`.
- **The switch notice now has its list (A31).** It names what scout J found, not a list from memory, and drops read
  receipts and TTS, which were never dispatcher features.
- **A subscriber agent's consumer keeps the access verdict (A36).** Dispatcher access control does not run for it, so
  the compiled consumer carries the journal's access clause.
- **Media has three workable shapes, not four (O16).** Adding `media:read` to C4 reaches no bytes under a chat
  allowlist. What remains: no bytes in v1, a new chat-bound fetch, or a pull-time presign (remote mode only, with an
  explicit TTL).
- **C9's self-drop is a third mechanism (A37), and its depth has a reference (O14, A38).** `#1148` cannot be reused.
  The only enforced chain bound in Omni is 5.
- **O12 can be asked precisely.** No in-repo emitter would break, the refusal belongs in `validateEmitEvent` only, and
  the dry-run needs the same check.
- **The default mode may already deliver twice (next scout).** If the automation engine fires a managed `call_agent`
  row for `message.received` on an instance the dispatcher serves, a bound chat agent in call mode (C6's default)
  whose `accepts` names `message.received` is called twice today, once by the dispatcher and once by the compiled
  automation. That is the C6 and C7 collision in the default path, independent of O18. It is slice 5's first fact to
  gather, and the next round's scout reads the engine's matching for it before any question is written.

## WRS bar (round 4, after the scouts)

| Dimension | Score | Why |
|---|---|---|
| Problem | 19/20 | R3-1's unverified premise is answered from code: the dispatcher serves through `instances.agent_id`, and a mode switch alone leaves delivery on. One path that bears on the default mode is still unread: whether the engine fires a managed `call_agent` row for `message.received` beside the dispatcher. |
| Scope | 17/20 | Unchanged. O18 may make an exception to C7, O19 may add a fix ahead of the design, O16 may add a media path. A35 and A36 add refusals and a clause, not slices. |
| Decisions | 16/20 | Unchanged: twelve settled, none answered this round. Asked now: O18, O19, O14, O16. Waiting: O12 and O17. |
| Risks | 19/20 | Found and named: double delivery on a switch, the key widening to every instance, the error reply from a bound provider-less agent, the chat lock refusing `GET /media` outright, the missing 60 s clamp in the single-owner world, retries resetting depth. Still unknown: deployed `emit_event` rows with core types, whether the engine fires a managed `call_agent` row beside the dispatcher, whether send routes accept a caller cause, Discord, Twilio and Gupshup URL expiry, the database collation. |
| Criteria | 18/20 | Newly testable: a switched agent bound to an instance gets no dispatcher call (C6), a `paired` agent cannot be bound (A35), the self-drop keyed on the stamped `agent_id` (A37), a depth refusal row that no retry can replay (A38). Still open: the depth number (O14), the media half of C8 (O16), C13's volume (O17). |
| **Total** | **89/100** | |

## Gap map (round 4, after the scouts)

- **Settled by the owner (ledger):** R1-1 to R1-4, R2-1 to R2-4, R3-1 to R3-4.
- **Settled by facts this round:**
  - the dispatcher's agent selector (instance binding plus routes), and that a mode switch leaves it on;
  - what unbinding does, including the key widening;
  - every dispatcher-only feature a subscriber agent loses, and the two it never had;
  - every `agents.provider` site, and every reader that fails without `agentProviderId`;
  - that `GET /media` is instance-bound, refuses a chat-locked key, and that presigning is remote-only and unclamped
    without a tenant;
  - that nothing in the repo emits a core type through `emit_event`, where a refusal belongs, the dead-letter shape
    and retry, the one enforced hop bound (5), and that `#1148` is not C9's mechanism.
- **Lead design calls (Assumed):** A31, A32, A27 and A17 sharpened; new A35 (no binding for `paired`), A36 (access
  verdict on a subscriber's consumer), A37 (self-drop keyed on `agent_id`), A38 (depth refusal is dead-lettered and
  not retryable), A39 (the shape of the key-widening fix).
- **Owner decisions asked now:** O18 (how a switch stops dispatcher delivery), O19 (when the key widening is fixed),
  O14 (C9's depth number), O16 (media bytes).
- **Owner decisions waiting:** O12 (core types from `emit_event`) and O17 (C13's volume), with reasons under Open.
- **Facts still unknown:**
  - deployed automation rows that use `emit_event` with a core type (needs the database);
  - whether the automation engine fires a managed `call_agent` row for `message.received` beside the dispatcher;
  - whether the send routes accept a caller-supplied `causationId`;
  - whether the journal's access verdict is written for every inbound row (A36 depends on it);
  - the real plans and costs on a production-sized journal, the collation and the Postgres version (C13 measures);
  - Discord, Twilio and Gupshup media URL expiry; the RLS policy text on `omni_events`.
- **Blocks what:**
  - O18 blocks how slice 5 implements a mode switch, and whether C7 keeps its wording.
  - O19 decides whether a live exposure ships ahead; O18's unbind option depends on it.
  - O14 blocks C9's depth test; O16 blocks the media half of C8; O17 blocks C13's pass or fail (A24 stands in).
  - O12 decides one C5 clause; no slice test waits on it yet.
  - C0 and C15 ship ahead as fixes. Slices 1 to 5 still gate the GitLab connector, and slices 1 and 2 still gate the
    swarm's Omni intake.

## Round 5: what the owner settled, and what it changes

The owner answered all four round-4 questions (Settled R4-1 to R4-4). HEAD is still `ee5753234`. No wish under
`.genie/wishes/` carries the C0 fix (R1-1), the cross-tenant consumer fix (R2-3) or the key-widening fix (R4-2) yet.

- **R4-1, a switch to subscriber mode is stopped by a dispatcher mode check.** This is the one edit to
  `agent-dispatcher.ts` the owner approved; the question quoted C7's wording, so the answer is an approved exception
  to it. C7's Scope IN text stays verbatim because the ledger owns it, and a new item, C17, states the exception and
  its proof (A40). Scout J found three places that gate on the binding (`:5783` for messages, `:5988` for reactions,
  `:6525-6528` for typing), so the check covers every one of them, not the message path alone. The per-agent mode
  field, which A2 left as a design detail, is now read by the dispatcher on every inbound message, so where it lives
  and how fresh the dispatcher's read is decide whether a switch can still deliver twice. Scout L reads the
  dispatcher's caching and the debounce buffer for it.
- **R4-2, the key widening is fixed now, as its own fix.** The question said a fix ahead of the design adds a Scope
  IN item, so it enters as C16, on C15's precedent: it ships ahead of the design, and every slice keeps its test
  green. A39 is its shape. Scout M checks whether PATCH is the only writer that empties an agent key's `instanceIds`,
  so the fix covers every path, and whether the provisioning lookup by name skips revoked keys.
- **R4-3, C9's depth bound is 5.** The counting rule is a lead call (A41): a root is depth 0, each journaled child is
  its parent's depth plus 1, a depth-5 emission is accepted, a depth-6 emission is refused as
  `causation_depth_exceeded` through A38's dead-letter path. What depth actually bounds depends on which routes carry a
  cause (A17): scout M checks whether the send routes accept a caller `causationId`, and whether `causation_id` is
  indexed for the one parent lookup the stamp needs.
- **R4-4, no media bytes in v1.** The C8 envelope carries the message id, the media type and a has-media marker, and
  nothing that reaches bytes: no provider URL, no Omni path, no presign. The C4 profile gains no media scope. The
  consequence the design adds (A42): a conversational agent switched to subscriber mode under R3-1 loses media
  entirely, because the dispatcher hands its provider a presigned URL or a local path (`agent-dispatcher.ts:1096-1109`)
  and nothing replaces it, so the switch notice names it; `omni agents graph` and `doctor` show media bytes as OFF for
  subscriber agents, in A34's report-only style.

What is still open: O12 (core types from `emit_event`, waiting since round 2, heads the next batch) and O17 (C13's
volume, A24 stands in). One candidate depends on scout L: whether the default call mode already delivers
`message.received` twice to a bound agent (O20, below).

## WRS bar (round 5, before the scouts)

| Dimension | Score | Why |
|---|---|---|
| Problem | 19/20 | Unchanged. One path that bears on the default mode is still unread: whether the engine fires a managed `call_agent` row for `message.received` beside the dispatcher (scout L). |
| Scope | 18/20 | R4-2 adds C16 and R4-1 adds C17; R4-4 closes the media path, so C8 needs no new route. Slice 5 may still split at design time, and O20 may add a compiler rule. |
| Decisions | 18/20 | Sixteen settled. Open: O12 and O17; O20 is a candidate that depends on scout L. |
| Risks | 19/20 | New: a stale mode read in the dispatcher, or a batch already in the debounce buffer, could still deliver once both ways at the switch. Still unknown: default-mode double delivery, deployed `emit_event` rows with core types, whether the access verdict is journaled for every inbound row, the database collation. |
| Criteria | 19/20 | Newly testable: depth 5 accepted and 6 refused (R4-3, A41), an envelope that carries no URL, path or presign (R4-4), a switched bound agent gets no dispatcher call on the message, reaction or typing path (R4-1, C17), an unbind never widens a key (R4-2, C16). Still a stand-in: C13's volume (O17). |
| **Total** | **93/100** | |

## Gap map (round 5)

- **Settled by the owner (ledger):** R1-1 to R1-4, R2-1 to R2-4, R3-1 to R3-4, R4-1 to R4-4.
- **Scope IN added by the lead from owner answers:** C16 (from R4-2, the key-widening fix ahead of the design) and
  C17 (from R4-1, the dispatcher mode check and its proof).
- **Lead design calls (Assumed):** A40 (C7 read narrowed by R4-1), A41 (the depth counting rule), A42 (media OFF for
  subscriber agents and named in the switch notice), A43 (the mode field is an `agents` column the dispatcher reads,
  pending scout L).
- **Facts this round's scouts gather (code only, omni at `ee5753234`):**
  - L: whether the automation engine fires a managed `call_agent` row for `message.received` on an instance the
    dispatcher serves, and whether the compiler adds any instance condition; what the dispatcher reads and caches per
    instance and agent, how a mode write would invalidate it, and what happens to a batch already in the debounce
    buffer or a run already started at the switch; for O20, C17 and A43;
  - M: whether the access verdict is journaled for every inbound row on every channel (A36); whether the send routes
    accept a caller `causationId` (A17, A41); whether `omni_events.causation_id` is indexed and whether any depth
    column exists (A41); every writer of an agent key's `instanceIds` and whether the name lookup at
    `instances.ts:1403` skips revoked keys (C16, A39).
- **Owner decisions next batch (at most four):** O12 first, then O17, then O20 if scout L confirms it, then anything
  scouts L and M turn into an owner choice.
- **Blocks what:**
  - O20, if confirmed, blocks slice 5's call-mode compile for bound agents: C6's "no event reaches one agent both
    ways" may already fail in the default mode.
  - Scout L's freshness and buffer facts decide how C17 is built so a switch neither delivers twice nor drops a batch
    silently.
  - O12 decides one C5 clause; O17 decides C13's pass or fail (A24 stands in).
  - C0, C15 and C16 ship ahead as fixes. Slices 1 to 5 still gate the GitLab connector, and slices 1 and 2 still gate
    the swarm's Omni intake.

## Round 5 scout findings

Two read-only scouts reported: L and M, both in omni at `ee5753234`, code only, no database. Citations are the
scouts'; paths are under `packages/` unless they say otherwise. The lead spot-checked the engine's matching
(`core/src/automations/engine.ts:495-531`), the compiled managed row (`api/src/services/manifest-compiler.ts:133-150`),
the enqueue-time capture and its reuse at flush (`api/src/plugins/agent-dispatcher.ts:6305-6316`, `:6344-6349`,
`:6174-6184`), the access-journal flag (`api/src/plugins/event-persistence.ts:155-164`, `.env.example:70`), the
unassign write and the provisioning lookup (`api/src/routes/v2/instances.ts:1383-1412`), `findByName`
(`api/src/services/api-keys.ts:597-605`), the `api_keys` table and its indexes (`db/src/schema.ts:614-690`,
`db/drizzle/0000_closed_patriot.sql:650-653`), the `omni_events` primary key (`db/src/schema.ts:1981-1984`) and the
consumer access filter values (`api/src/schemas/openapi/event-consumers.ts:30`). One scout claim is corrected below.
The only text in the code that addresses a reader is the description written into each managed row, "Do not edit by
hand — apply the agent's manifest instead" (`manifest-compiler.ts:137`), which is aimed at human operators; it was
reported and not followed. Nothing was modified.

**The default call mode delivers twice today (scout L; O20's premise confirmed from code)**

- The engine picks automations by event type, the `enabledAt` cutoff and the connector target only, and the target
  check narrows `connector.event` alone. There is no instance filter, no agent filter and no dispatcher check; the one
  skip after selection is the same-tenant instance-sender loop (`engine.ts:46-52`, `:495-531`, `:557-571`).
- The compiler adds nothing either. A compiled row's conditions come only from the manifest entry's `filter`, and its
  action is exactly `call_agent` with the agent id; it reads no binding and no route (`manifest-compiler.ts:96-103`,
  `:133-148`). A manifest may name `message.received` (`core/src/schemas/agent-manifest.ts:28-37`).
- `callAgent` has no guard. It loads the event's instance, runs the agent through `agentRunner.runOrStream` and
  records a trigger log; it sends no reply to the chat (`api/src/plugins/automation-actions.ts:386-458`, `:139-185`).
  The engine's claim is per automation and never sees the dispatcher's `agent-dispatcher-msg` key (`engine.ts:880-942`).
- The dispatcher serves an instance only when `instances.agent_id` is set; a route's agent applies only on such an
  instance (`agent-dispatcher.ts:5781-5786`, `:5119`).
- **Verdict:** an agent bound to an instance, in call mode, whose `accepts` names `message.received`, is run twice
  per message: once by the dispatcher, which replies, and once by its managed row, which is a second billed provider
  run plus whatever tools or verbs that run calls. The managed row is also broader than the dispatcher: no reply
  filter, no access check, no mention or newsletter gates and no instance condition, so it runs on messages the
  dispatcher drops, including from senders the instance blocks, and on every instance in the deployment. This is
  derived from code, not reproduced at runtime, and it holds today for any deployed agent in that state.

**What the dispatcher reads, caches and buffers (scout L)**

- Per inbound message it reads the instance row uncached, the `agents` row through a fresh select in
  `applyAgentFkOverrides`, and the provider row fresh before `providerCache` (`api/src/services/agent-runner.ts:589-597`;
  `agent-dispatcher.ts:4990-5020`, `:4962-4975`).
- Two caches only. The route LRU holds 1,000 entries for 30 s and is cleared only by route mutations
  (`api/src/services/route-resolver.ts:78-92`, `:213-231`; `services/routes.ts:148`, `:189`, `:213`). `providerCache`
  has no TTL, is keyed provider and instance, and bakes instance and agent config in; `AgentService.update` evicts it
  only for `PROVIDER_BAKED_AGENT_COLUMNS`, and `updateManifest` never does (`agent-dispatcher.ts:4824-4862`;
  `services/agents.ts:20-26`, `:154-170`, `:179-215`). Neither cache holds an agent's mode, so a mode column read in
  `applyAgentFkOverrides`' select is fresh on every message and needs no eviction.
- **The debounce buffer captures the agent at enqueue.** The message handler resolves route and agent before
  buffering and stores the result as `resolvedInstance`; the flush reuses the first message's capture for the whole
  batch (`agent-dispatcher.ts:6307-6315`, `:6347`, `:6176-6183`). The buffer is keyed by instance and chat, lives in
  memory, and messages that arrive during a flush go out as the next batch under their own enqueue-time capture
  (`api/src/plugins/message-debouncer.ts:99-110`, `:136-173`, `:243-285`). A flush-time drop removes the queued
  acknowledgement and is otherwise silent (`agent-dispatcher.ts:6165-6222`).
- A run already started keeps its captured instance through retries; nothing re-resolves the agent mid-run
  (`:4116-4180`, `:4449-4470`). A reaction is resolved when it arrives (`:5972-5992`, `:5143-5180`). The typing path's
  gate is at `:6530`, not `:6525-6528` as this DRAFT cited; it resolves fresh, only restarts the timer of an existing
  buffer, and does nothing while a flush is in flight (`:6520-6555`).

**The access verdict (scout M; A36 does not hold as written)**

- `omni_events.access_decision` is written only when `OMNI_JOURNAL_ACCESS_DECISION=true`, which is off by default and
  commented out in `.env.example`, and only for inbound `message.received` and `reaction.*` rows. There is no backfill
  (`db/src/schema.ts:2065-2073`; `db/drizzle/0083_event_access_decision.sql`; `event-persistence.ts:157-164`).
- It is written when the persistence consumer fills the row, not at the channel's skeleton insert
  (`api/src/plugins/context.ts:46-77`; `event-persistence.ts:230-291`), and NATS redelivery recomputes it (`:213-221`,
  `:286-290`).
- It stays NULL when the flag is off, for from-me rows, without an `instanceId`, when the instance is missing, when
  evaluation throws, and when a fill never lands (`event-persistence.ts:162-208`, `:317-322`).
- An instance running without access control stores `'disabled'`, which matches neither the `allowed` nor the
  `denied` consumer filter; NULL matches neither either (`event-persistence.ts:199`;
  `api/src/services/event-consumers.ts:391-426`). A consumer's access filter is refused with 400 while the flag is off
  (`api/src/schemas/openapi/event-consumers.ts:113-121`).
- `channel-a2a` and `agent-replay` publish `message.received` without the ingress claim; the same subscriber
  journals them (`channel-a2a/src/a2a-handler.ts:803-823`; `api/src/services/agent-replay.ts:334-362`).

**Causation and depth (scout M)**

- No send route accepts a caller cause. `POST /messages/send` strips unknown keys, and its `x-correlation-id` header
  only records journey checkpoints (`api/src/routes/v2/messages.ts:672-715`, `:1329-1396`). An HTTP send runs outside
  any ambient causality, which only the engine and the dispatcher enter (`core/src/events/causality.ts`;
  `engine.ts:949`; `agent-dispatcher.ts:6242`, `:6407`, `:6473`), so an agent's `omni say` is a causation root. A17's
  sharpened reading is confirmed.
- The one caller-supplied cause is the webhook emit route, validated as a UUID and not required to exist
  (`api/src/routes/v2/webhooks.ts:188`, `:202-213`; `api/src/services/webhooks.ts:735-760`).
- `causation_id` has a btree index (`db/drizzle/0058_omni_events_causation_id.sql:20-24`). No depth or hop column or
  metadata key exists; the internal channel's `hopCount` lives in `raw_payload` (`db/src/schema.ts:2056-2090`;
  `channel-internal/src/plugin.ts:18`, `:74-109`). A depth stamp reads its parent by `omni_events.id`, the primary key,
  so the `causation_id` index serves trace's child walk, not the stamp (lead).

**Agent keys (scout M; one claim corrected by the lead)**

- The only writer of an `agent:<name>` key's `instanceIds` on binding is `handleAgentKeyProvisioning`, called from
  `PATCH /instances/:id` when `agentId` changes; `POST /instances` with an agent provisions nothing
  (`instances.ts:1349-1361`, `:1373-1437`, `:1165-1215`). The other writer is `PATCH /keys/:id` (`routes/v2/keys.ts:100`,
  `:908-935`).
- The last unassign writes null (every instance), and a key already holding `[]` is also written back as null
  (`instances.ts:1385-1392`). If loading the old agent throws, the removal is skipped and the id stays; a key already
  null is never narrowed (`:1381-1396`).
- Instance delete, agent delete and agent rename never touch `api_keys`. Deleting an agent nulls `instances.agent_id`
  through the foreign key without the unassign path, so its key stays active on those instances. Renaming an agent
  orphans its key, still active, and the dispatcher's turn lookup by the new name finds nothing until a re-bind
  (`db/src/schema.ts:647`, `:1012`; `agent-dispatcher.ts:2935-2946`).
- `findByName` has no status filter and returns `limit(1)` with no order (`api-keys.ts:602-604`). It serves both
  provisioning lookups and the dispatcher's turn lookup (`instances.ts:1385`, `:1403`; `agent-dispatcher.ts:2938`).
- **Correction.** Scout M read `api_keys.name` as unique from `schema.ts:345` and flagged that it had not confirmed
  the table. The lead checked: `:345` is `agent_providers`; `api_keys.name` is `varchar(255) NOT NULL` with no unique
  constraint, and the table's only unique index is on `key_hash` (`schema.ts:618`, `:689`;
  `0000_closed_patriot.sql:651`). So after A39 revokes a key, a re-bind appends the instance to the revoked row; a
  fresh key with the same name can be created, but then every name lookup, the dispatcher's included, returns one of
  the two rows arbitrarily. Auth refuses a revoked key (`api-keys.ts:325-335`), so the failure shows up at the agent's
  first call.

## Design consequences (round 5)

- **O20 is confirmed, and it is the owner's.** The default mode calls a bound agent twice per message today. The ways
  out each cost something: refusing the overlap at manifest apply and at bind time, skipping at run time inside
  `call_agent` (a second exception to C7), or reading C6 as covering subscriber mode only.
- **A36 fails on a default deployment (O21).** A subscriber's access clause needs a verdict that is off by default and
  stores `'disabled'` for an open instance. Requiring the flag would narrow R3-1 in practice, so it is asked, not
  announced.
- **C17 becomes a cutover at one instant (A44), not a cache eviction (A43 revised).** The mode read is fresh already;
  the risk is the buffered batch, and a check at flush would drop it silently.
- **The C17 check sits after route resolution (A40 sharpened),** because a route can name a subscriber agent on an
  instance whose own agent is in call mode, and the reverse.
- **A re-bind after C16's revoke needs the name freed (A39 sharpened).** The key name is not unique and the lookup has
  no status filter, so the fix renames a key when it revokes it, which leaves every lookup, the dispatcher's included,
  unchanged.
- **C9's depth is a stamped column (A41 sharpened).** No depth exists to reuse, and the send routes carry no cause, so
  depth bounds `/events/trigger` chains and the engine's and the dispatcher's ambient chains.
- **Agent delete and rename leave live keys (O22, waits).** Neither widens a key, so they sit outside C16.
- **Call-mode managed rows carry no access clause (O23, waits).** That is today's behaviour, kept by C7, and the
  opposite of what A36 asks of subscriber mode.

## WRS bar (round 5, after the scouts)

| Dimension | Score | Why |
|---|---|---|
| Problem | 20/20 | The last unread path is read: the engine fires a managed `call_agent` row beside the dispatcher, so the default mode double-delivers today. Every path the design changes has been traced in code. |
| Scope | 18/20 | Unchanged. O20 may add a compile-time and bind-time refusal, O21 a precondition or a pull-time check; O22 and O23 wait outside Scope IN. The ledger's Scope ratchet does not list C16 and C17 yet. |
| Decisions | 18/20 | Unchanged: sixteen settled, none answered this round. Asked now: O12, O17, O20, O21. Waiting: O22, O23. |
| Risks | 19/20 | Found and named: the default-mode double run, the access verdict off by default with `'disabled'` and NULL matching no filter, the batch captured at enqueue, the revoked-key lookup and the non-unique key name, live keys left by agent delete and rename. Still unknown: deployed `emit_event` rows with core types, deployed overlaps, whether the access flag is on anywhere, NATS ordering between the engine and the dispatcher, the collation. |
| Criteria | 19/20 | Newly testable: messages straddling a switch arrive exactly once each (A44), a re-bind after a revoke gets a working key (A39), six chained emissions journal five rows (A41). Still a stand-in: C13's volume (O17). |
| **Total** | **94/100** | |

## Gap map (round 5, after the scouts)

- **Settled by the owner (ledger):** R1-1 to R1-4, R2-1 to R2-4, R3-1 to R3-4, R4-1 to R4-4.
- **Scope IN added by the lead from owner answers:** C16 (R4-2) and C17 (R4-1). The ledger's Scope ratchet does not
  list them; the lead does not edit it, and flags it for the script.
- **Settled by facts this round:**
  - the engine fires a managed `call_agent` row beside the dispatcher, with no instance, agent or access condition;
  - the dispatcher's caches hold no mode, and the debounce buffer captures the agent at enqueue;
  - the access verdict is opt-in, written at fill, and `'disabled'` or NULL match no filter;
  - no send route carries a cause, `causation_id` is indexed, and no depth exists;
  - every writer of an agent key's `instanceIds`, the lookup with no status filter, and the name that is not unique.
- **Lead design calls (Assumed):** A36 revised (now O21), A39, A40 and A41 sharpened, A43 revised, new A44 (the
  cutover instant).
- **Owner decisions asked now:** O12 (core types from `emit_event`), O17 (C13's volume), O20 (the default-mode double
  run), O21 (the subscriber's access check).
- **Owner decisions waiting:** O22 (keys left by agent delete and rename) and O23 (access on call-mode rows), with
  reasons under Open.
- **Facts still unknown:**
  - deployed rows: `emit_event` with a core type, bound agents whose manifest accepts `message.received`, and whether
    `OMNI_JOURNAL_ACCESS_DECISION` is on anywhere (needs the database and the deployments);
  - NATS ordering between the engine's subscription and `agent-dispatcher-msg`, whether the two runs share an agent
    session, and whether any test covers the overlap;
  - writers of the `agents` table outside `packages/api` and `packages/cli` (raw SQL, seeds);
  - the real plans and costs on a production-sized journal, the collation and the Postgres version (C13 measures);
  - Discord, Twilio and Gupshup media URL expiry; the RLS policy text on `omni_events`.
- **Blocks what:**
  - O20 blocks slice 5's call-mode compile and C6's "no event reaches one agent both ways" test.
  - O21 blocks slice 5's subscriber compile for `message.received` and reactions, and A36's test.
  - O12 decides one C5 clause; O17 decides C13's pass or fail (A24 stands in).
  - C0, C15 and C16 ship ahead as fixes; C16's re-bind test follows A39. Slices 1 to 5 still gate the GitLab
    connector, and slices 1 and 2 still gate the swarm's Omni intake.

## Round 6: what the owner settled, and what it changes

The owner answered all four round-5 questions (Settled R5-1 to R5-4). HEAD is still `ee5753234`. No wish under
`.genie/wishes/` carries the C0, C15 or C16 fix yet. The ledger's Scope ratchet now lists C16 and C17, so the round-5
flag about them is closed.

- **R5-1, core types are refused from `emit_event` for agent emitters only.** This is C5's own reach: an `emit_event`
  action in an automation an agent manages may not publish a core type, and an unmanaged automation behaves as
  today. The refusal sits in `validateEmitEvent` and its dry-run, never in `EventRegistry.validate` or
  `publishGeneric` (scout K). A45 is its shape; how `emit_event` knows the managing agent is a fact scout O reads.
  The unmanaged case goes to its own issue, outside this design.
- **R5-2, C13 runs at A24's volume.** A24 is no longer a stand-in: 1,000 GitLab rows a day, 90 days of them inside
  900,000 rows of other families, and a live hour with one 300-row burst in one minute. C13's pass or fail against
  R1-2 and R2-1 is measured there.
- **R5-3, the default-mode overlap is refused.** A call-mode agent that a dispatcher serves (bound to an instance or
  named by a route) may not accept an event the dispatcher already turns into a run for it. The refusal is checked
  at manifest apply and at bind time, `doctor` lists existing overlaps, and nothing changes at run time, so C7 stays
  intact. The bind-time refusal puts a check on `instances.agent_id` and `agent_routes` writes, which no Scope IN item
  names, so it enters as C18 on C16's and C17's precedent. A round-6 fact narrows it: `ManifestEventTypeSchema`
  accepts literal dot-separated tokens only, with no glob (`core/src/schemas/agent-manifest.ts:25-42`), so the refused
  set is a list of exact types. Which types the dispatcher turns into a run (`message.received` and which reaction
  types) is a fact scout N reads. A46 is the shape, including the order of a mode switch, which R5-3 now constrains.
- **R5-4, a subscriber needs the journal's access flag.** A subscriber agent's consumer for `message.received` and
  reactions carries the access clause, admitting `allowed` and `disabled`; a NULL verdict is not delivered and is
  counted; a switch while `OMNI_JOURNAL_ACCESS_DECISION` is off is refused with the reason and the enable path. A47
  carries what the answer leaves to the lead: the flag turned off after a switch, rows from before the flag inside
  A44's cursor window, and a `paired` agent that accepts `message.received` without ever being bound.

What is still open: O22 (keys left by agent delete and rename) and O23 (access on call-mode rows), both waiting since
round 5. Both are asked this round, after scouts N and O report, because each needs one fact to have real options:
O22 whether agent delete is hard or soft and how rename runs, O23 whether the engine can read an access verdict at
all when it evaluates a call-mode row.

## WRS bar (round 6, before the scouts)

| Dimension | Score | Why |
|---|---|---|
| Problem | 20/20 | Unchanged. Every path the design changes has been traced in code. |
| Scope | 19/20 | C18 joins from R5-3; R5-1 sits inside C5 and R5-4 inside C6's subscriber compile. The refusal sites for C18 (every writer of `instances.agent_id` and `agent_routes`, every caller of the reconciler) are not all listed yet. Slice 5 may still split at design time. |
| Decisions | 19/20 | Twenty settled. Open: O22 and O23, both asked this round after the scouts. |
| Risks | 19/20 | New: a deployed overlap meeting a refusal in a reconcile that runs at boot, a subscriber starved silently when the access flag goes off after its switch. Still unknown: deployed rows (overlaps, `emit_event` with core types, the flag's state), NATS ordering between the engine and the dispatcher, the collation. |
| Criteria | 19/20 | Newly testable: an agent-managed `emit_event` of a core type refused and an unmanaged one unchanged (R5-1), C13 at A24's volume (R5-2), an overlapping manifest apply or bind refused with the reason (R5-3), a switch refused while the flag is off and a NULL-verdict row counted, not delivered (R5-4). Open: the exact type list C18 refuses. |
| **Total** | **96/100** | |

## Gap map (round 6)

- **Settled by the owner (ledger):** R1-1 to R1-4, R2-1 to R2-4, R3-1 to R3-4, R4-1 to R4-4, R5-1 to R5-4.
- **Scope IN added by the lead from owner answers:** C18 (from R5-3, the overlap refusal at manifest apply and bind
  time). C16 and C17 are in the ledger's ratchet.
- **Settled by facts this round:** a manifest `accepts` names literal types only, so C18's refused set is a list.
- **Lead design calls (Assumed):** A24 confirmed (R5-2); new A45 (R5-1's reach), A46 (R5-3's refusal and the switch
  order), A47 (R5-4's edges).
- **Facts this round's scouts gather (code only, omni at `ee5753234`):**
  - N: every writer of `instances.agent_id` and `agent_routes`, every caller of the reconciler and whether it runs at
    boot or on a timer, and what a refusal there does; the event types the dispatcher turns into an agent run; whether
    the engine can read an access verdict when it evaluates a call-mode row (O23); any test covering the overlap.
  - O: how `emit_event` and its dry-run know the managing agent (R5-1); the verdict on a2a, agent-replay and reaction
    rows, how the server reads the access flag, and whether `waitForReady` holds a row until the fill (R5-4, A47);
    whether agent delete is hard or soft and how rename runs (O22).
- **Owner decisions this round (after the scouts):** O22 and O23, with options shaped by N and O, plus anything the
  scouts turn into an owner choice.
- **Blocks what:**
  - O23 decides whether call-mode managed rows gain an access clause, which C6's compiler would carry.
  - O22 decides whether agent delete and rename join the key fixes or go to their own issue.
  - Scout N's reconciler facts decide whether C18's refusal can stop a boot, which A46 must rule out.
  - C0, C15 and C16 ship ahead as fixes. Slices 1 to 5 still gate the GitLab connector, and slices 1 and 2 still
    gate the swarm's Omni intake.

## Round 6 scout findings

Two read-only scouts reported: N and O, both in omni at `ee5753234`, code only, no database. Citations are the
scouts'; paths are under `packages/` unless they say otherwise. The lead spot-checked the dispatcher's two agent
lookups (`api/src/plugins/agent-dispatcher.ts:2908-2946`, the turn-based key lookup, and `:4995-5015`, the
`applyAgentFkOverrides` select): neither filters `agents.is_active`, and the only `isActive` checks in the file are
the provider's (`:4972`) and the instance's (`:5640`). The lead also checked that the turn-based helper is the only
caller of that key lookup (`:3240-3241`), and the prior finding that `/events/trigger` refuses every type that does not
start with `custom.` (round 2, `api/src/routes/v2/webhooks.ts:174-189`). One round-5 claim is corrected below. Text in
the code that addresses a reader, reported as data and not followed: the managed row's description "Do not edit by
hand — apply the agent's manifest instead (omni agents manifest apply)" (`api/src/services/manifest-compiler.ts:137`),
the CRUD refusals "cannot be modified directly — update that agent's manifest instead" and "managedByAgentId is
compiler-owned" (`api/src/services/automations.ts:227`, `:305-318`), and the comment on the default reply filter
that "prevents the silent-drop bug" (`api/src/routes/v2/instances.ts:1172-1175`). Nothing was modified.

**Bind and reconcile sites for C18 (scout N)**

- `instances.agent_id` is written by `POST /instances` (`createInstanceSchema.agentId`, `routes/v2/instances.ts:90`,
  `:1154`, `:1195` → `InstanceService.create`, `services/instances.ts:349`) and `PATCH /instances/:id` (`:1281`,
  `:1343` → `InstanceService.update`, a `.set` of the whole body, `services/instances.ts:416-421`), with no manifest,
  access or accepts check. The CLI's `omni instances update`, `omni connect` and `omni setup` reach it through the
  same PATCH (`cli/src/commands/instances.ts:63-65`, `:1276`; `connect.ts:145`; `setup.ts:243-244`).
- A tRPC router defines `instances.create` and `instances.update` with an `agentId` field and calls the same service
  (`api/src/trpc/router.ts:70-102`); only one test imports it, so whether it is mounted is unknown.
- `agent_routes` is written by `POST`, `PATCH` and `DELETE /instances/:instanceId/routes[/:id]`
  (`routes/v2/agent-routes.ts:65`, `:100`, `:130` → `RouteService.create`, `.update` (`.set({...data})`, so the agent
  can change) and `.delete`, `services/routes.ts:67-75`, `:109`, `:178-181`, `:205`), and the CLI's `omni routes`
  commands reach the same routes (`cli/src/commands/agent-routes.ts:86-90`, `:187`, `:322`). Two maintenance scripts
  write the table directly, deleting rows and re-pointing `personId` or `chatId`, never `agentId`
  (`api/scripts/fix-person-duplicates.ts:99-117`; `db/scripts/consolidate-lid-chats.ts:172-188`). No seed or migration
  inserts route rows.
- The reconciler has exactly two callers, both in `AgentService`: `updateManifest` (`PUT /agents/:id/manifest`, the
  CLI's `omni agents manifest apply`) and `delete` (`DELETE /agents/:id`, `omni agents delete`), wired in
  `services/index.ts:242-248` (`services/agents.ts:210`, `:235`; `manifest-compiler.ts:128`, `:228-229`). **It never runs
  at boot, over all agents or on a timer.** Neither call site catches: in `updateManifest` the manifest `UPDATE` runs
  first (`agents.ts:187-191`), then the publish, then the awaited reconcile, so a throw fails the request. A comment
  says apply and compile share the request's transaction inside a tenant scope (`services/index.ts:242-244`); outside a
  tenant scope the rollback was not traced.
- The compiled row has no instance field and reads neither `instances.agent_id` nor `agent_routes`; the target
  instance comes from the event payload at run time (`manifest-compiler.ts:101-124`; `core/src/automations/actions.ts:880-905`).

**What the dispatcher turns into a run (scout N)**

- Exactly three subscriptions start an agent run: `message.received` (buffered, run on the debounced flush),
  `reaction.received` and `reaction.removed` (`agent-dispatcher.ts:6258-6259`, `:6381-6382`, `:6448-6449`; file header
  `:1-8`). `presence.typing` only restarts an existing buffer's timer, `media.processed` only resolves a pending media
  promise, and `agent.run.cancel_requested` only cancels (`:6514-6556`, `:6569-6598`, `:6602-6625`).
- Every run needs `instances.agent_id` set (`:5811-5815`, `:5983`), so a route's agent is dispatched only on an
  instance that has an agent of its own. A reaction runs only when the instance's `triggerEvents` lists its type and
  the emoji passes `isReactionTrigger` (`:5986-5988`); `message.received` runs when `triggerEvents` is empty or lists
  it (`:5351-5355`, `:5817`).
- No test covers a bound agent whose manifest accepts `message.received`: the manifest tests and the dispatcher tests
  share no file (`api/src/services/__tests__/manifest-compiler-postgres.test.ts:280-320` drives the engine with no
  instance and no dispatcher).

**The engine and the access verdict (scout N; O23's fact)**

- The engine cannot read an access verdict. Conditions are evaluated on the in-flight bus event
  (`buildConditionContext(event.payload, event.metadata)`), never on the `omni_events` row, and no access field is set
  on the event envelope anywhere in `packages/core` (`core/src/automations/engine.ts:892-896`;
  `core/src/automations/conditions.ts:31-38`).
- The engine and the persistence consumer are independent NATS consumers with no ordering between them
  (`engine.ts:311-340`, durable `automation-engine-<type>`, start `new`; `api/src/plugins/event-persistence.ts:210-214`,
  queue `event-persistence`, start `first`), and the verdict exists only under `OMNI_JOURNAL_ACCESS_DECISION=true`.
- `call_agent` (`api/src/plugins/automation-actions.ts:386-410`) never calls `AccessService`, and the `automations`
  table has no access column (`db/src/schema.ts:3401`; the `access_filter` column is on `event_consumers`, `:3783`).
  An access check on a call-mode row is new code either way: a call to `AccessService.evaluateAccess` (pure, reads
  the cache only, `api/src/services/access.ts:282-310`) or a new column plus engine wiring.
- The dispatcher decides access with live rules at dispatch time (`checkAccess`, `agent-dispatcher.ts:5890`, `:6000`,
  `:5901-5925`); the journaled verdict is frozen at ingest (`api/src/schemas/openapi/event-consumers.ts:120`).

**How `emit_event` knows its managing agent (scout O; R5-1's mechanism)**

- The marker is `automations.managed_by_agent_id`, a nullable FK to `agents.id` with `ON DELETE CASCADE`
  (`db/src/schema.ts:3464-3473`, index `:3488`). The engine copies it into the action's context as
  `context.automation.managedByAgentId` (`core/src/automations/engine.ts:686`, `:749`), and `executeEmitEvent` passes
  it to `validateEmitEvent` as `emitterAgentId` (`core/src/automations/actions.ts:545-580`, `:495-515`). The action's
  own config has no agent field (`core/src/automations/types.ts:88-91`).
- **No row reaches that check today.** The compiler writes only a `call_agent` action on managed rows
  (`manifest-compiler.ts:145`), and the public CRUD refuses to create, edit or delete a managed row or to set the
  marker (`api/src/services/automations.ts:217-239`, `:305-318`). Hand-made `emit_event` rows have a NULL marker. And
  `/events/trigger` already refuses every non-`custom.` type, so an agent key cannot journal a core type there either.
- The dry-run never calls `validateEmitEvent`: `AutomationService.test` substitutes templates and reports
  `wouldExecute` only (`automations.ts:356-407`; `engine.ts:1083-1118`). Manual execute threads no managing agent and
  passes no `validateEmitEvent`, so it runs with no gate at all (`automations.ts:436`, `:448-461`;
  `core/src/automations/actions.ts:257-259`).

**The access verdict at the edges (scout O; A47's facts)**

- The flag is read on every call, never cached (`event-persistence.ts:157-164`, `:243`, `:593`); the consumer create
  check reads it per call too (`api/src/services/event-consumers.ts:438-445`, `:537`). No doctor code reads it.
- `channel-a2a` and `agent-replay` rows go through the same fill, so they get a verdict under the flag
  (`channel-a2a/src/a2a-handler.ts:783-824`; `api/src/services/agent-replay.ts:334-362`). They are never skeletons:
  their row is first written by the fill, with `journal_ready` and the verdict in one statement. Whether
  `evaluateAccess` gives a meaningful verdict for a2a's synthetic sender was not run.
- `waitForReady` holds only skeletons (`journal_ready=false`) younger than the settle window (default 5,000 ms per the
  doc comment, `EVENT_CONSUMER_SETTLE_MS`); a skeleton older than that counts as ready and can be delivered with a NULL
  verdict, and the cursor passes it (`event-consumers.ts:205-232`, `:387-425`).

**Agent delete and rename (scout O; O22's facts)**

- **Agent delete is soft.** `DELETE /agents/:id` and `omni agents delete` set `agents.is_active=false` and run the
  reconciler with no manifest, which deletes every compiled automation for the agent, and nothing else; there is no
  `deleted_at` (`api/src/services/agents.ts:215-236`; `api/src/routes/v2/agents.ts:93-103`;
  `cli/src/commands/agents.ts:494-509`; `db/src/schema.ts:399-437`). No code path hard-deletes an agent.
- So the `ON DELETE SET NULL` foreign keys on `instances.agent_id` and `agent_routes.agent_id` never fire
  (`db/src/schema.ts:473`, `:1012`), and the dispatcher's agent lookups never read `is_active` (lead-checked, above).
  **A deleted agent bound to an instance keeps answering its chats**, and its auto-provisioned key stays active and in
  use. `a2a-discovery` is the one reader that skips inactive agents (`api/src/services/a2a-discovery.ts:144`, `:216`).
- **Rename** is `PATCH /agents/:id` (`omni agents update --name`), which updates the row and evicts the provider cache
  of every instance and route naming the agent, because `name` is a provider-baked column. It does not touch
  `api_keys` or the reconciler (`api/src/services/agents.ts:14-26`, `:139-176`). The key keeps the old name
  `agent:<old>`; a turn-based agent's dispatch looks its key up by the new name, logs "Turn-based dispatch: scoped API
  key not found" and drops the message until a re-bind provisions a key under the new name
  (`agent-dispatcher.ts:2933-2946`). Non-turn-based providers do not use the key on dispatch.
- **Correction.** Round 5 wrote that "deleting an agent nulls `instances.agent_id` through the foreign key". It does
  not: the delete is soft, the binding stays, and the agent stays live. The round-5 text is left as written.

## Design consequences (round 6)

- **C18's refused set is three exact types:** `message.received`, `reaction.received` and `reaction.removed` (A46
  sharpened). Typing, media and cancel never start a run.
- **A refusal can never stop a boot,** because the reconciler only runs inside `PUT /agents/:id/manifest` and
  `DELETE /agents/:id`. A46's boot clause is retired. The apply-time check moves ahead of the manifest write, since a
  throw inside the reconciler relies on a rollback that was traced only inside a tenant scope.
- **The bind-time checks sit in the services,** `InstanceService.create`/`update` and `RouteService.create`/`update`,
  so the HTTP routes, the CLI and the tRPC router (mounted or not) all pass through them.
- **R5-1's clause guards a path no code creates today** (A45 sharpened). It stays as answered, cheap where the gate
  already receives the emitter; its dry-run half is new code.
- **R5-4's clause needs a two-value access filter** and inherits a frozen verdict (A47 sharpened).
- **O23 is narrowed to unbound call-mode agents and has no cheap option:** the engine cannot read the verdict, so any
  access check on a managed row is new code, and in `call_agent` it would be a second exception to C7.
- **O22 is bigger than round 5 said:** a deleted agent stays live on its instances, and a rename stops a turn-based
  agent answering. Neither widens a key, so neither is inside C16.

## WRS bar (round 6, after the scouts)

| Dimension | Score | Why |
|---|---|---|
| Problem | 20/20 | Unchanged. The last reads are done: the bind and reconcile sites, the dispatcher's run types, the engine's view of an event, agent delete and rename. |
| Scope | 19/20 | C18's sites are now listed in full and placed in the services. O22 and O23 may each add a Scope IN item beside C16 or C18. The ledger's Scope ratchet does not list C18 yet. |
| Decisions | 19/20 | Unchanged: twenty settled. Asked now: O23 and O22, the last two open. |
| Risks | 19/20 | Retired: a C18 refusal stopping a boot. Found and named: a deleted agent still answering its chats, a rename silently dropping a turn-based agent's messages, the dry-run with no `emit_event` gate, manual execute with no gate, a skeleton past the settle window delivered with a NULL verdict, the verdict frozen at ingest while the dispatcher checks live. Still unknown: deployed rows, whether the tRPC router is mounted, whether replay, the follow-up sweeper or scheduled messages start runs outside the dispatcher, rollback outside a tenant scope, NATS ordering, the collation. |
| Criteria | 20/20 | The one open item closes: C18 refuses exactly three types. Every settled answer has a test, and O22's and O23's options each name theirs. |
| **Total** | **97/100** | |

## Gap map (round 6, after the scouts)

- **Settled by the owner (ledger):** R1-1 to R1-4, R2-1 to R2-4, R3-1 to R3-4, R4-1 to R4-4, R5-1 to R5-4.
- **Scope IN added by the lead from owner answers:** C18 (from R5-3). The ledger's Scope ratchet lists C16 and C17
  but not C18; the lead does not edit it, and flags it for the script.
- **Settled by facts this round:**
  - the dispatcher runs an agent on `message.received`, `reaction.received` and `reaction.removed` only;
  - every writer of `instances.agent_id` and `agent_routes`, and the reconciler's two request-driven callers;
  - the engine cannot read an access verdict, and `call_agent` checks no access;
  - `emit_event` learns its managing agent from the engine's context, and no managed row carries `emit_event`;
  - the access flag is read per call, a2a and replay rows get a verdict, and `waitForReady` holds only young skeletons;
  - agent delete is soft and leaves the agent live; rename leaves the key under the old name;
  - no test covers the overlap.
- **Lead design calls (Assumed):** A45, A46 and A47 sharpened; A39 sharpened (its `doctor` line). Two calls in A46
  add scrutiny and are announced: the fixed three-type set, and a route checked even on an instance with no agent.
- **Owner decisions asked now:** O23 (access on unbound call-mode rows), O22 (agent delete and rename).
- **Facts still unknown:**
  - deployed rows: overlaps, `emit_event` with a core type, unbound call-mode agents accepting `message.received`,
    deleted agents still bound, and whether `OMNI_JOURNAL_ACCESS_DECISION` is on anywhere;
  - whether the tRPC router is mounted, whether replay, the follow-up sweeper or scheduled messages start agent runs,
    and whether a reconcile throw rolls the manifest write back outside a tenant scope;
  - NATS ordering between the engine and the dispatcher, the collation, the real plans at A24's volume;
  - Discord, Twilio and Gupshup media URL expiry; the RLS policy text on `omni_events`.
- **Blocks what:**
  - O23 decides whether C6's call-mode compile carries anything for access, and the test for an unbound agent.
  - O22 decides whether C16's fix wish grows a delete and rename part, or `doctor` reports both meanwhile.
  - C0, C15 and C16 ship ahead as fixes. Slices 1 to 5 still gate the GitLab connector, and slices 1 and 2 still
    gate the swarm's Omni intake.

## Round 7: what the owner settled, and what it changes

The owner answered both round-6 questions (Settled R6-1 and R6-2). HEAD is still `ee5753234`. No wish under
`.genie/wishes/` carries the C0, C15 or C16 fix yet. The ledger's Scope ratchet now lists C18, so the round-6 flag
about it is closed. Twenty-two decisions are settled, and nothing is open or asked.

- **R6-1: unbound call-mode agents and blocked senders get their own issue, and `doctor` reports them.** C7 and
  `call_agent` stay unchanged, as the owner chose for the overlap in R5-3. The design does not add an access check to
  call-mode managed rows. A call-mode agent that no instance binds and no route names, and whose manifest accepts
  `message.received`, `reaction.received` or `reaction.removed`, keeps running on every instance, including on
  messages from senders the instance blocks. `doctor` lists each such agent with the consequence and the fix. The fix
  is either to remove the entry or to switch the agent to subscriber mode, which carries the access clause under R5-4.
  The access check itself goes to a follow-up issue outside this design (A48).
- **R6-2: agent delete and rename get their own issue, and `doctor` reports them.** C16 stays the widening fix it was
  approved as. `doctor` lists two kinds of agent, each with the consequence and the fix:
  - an inactive agent still bound or routed: it still answers its chats, and its key stays active;
  - a turn-based agent whose current name has no key: it drops its messages.

  A39 (round 5 sharpened) already placed those lines in C16's fix wish, so nothing moves. A39's "until O22 is
  answered" clause becomes permanent (A39 sharpened, round 7). Changing delete and rename themselves goes to a
  follow-up issue (A48).
- **C19 is added by the lead from the two answers.** It adds scrutiny and is announced, on C18's precedent. Both
  answers make `doctor` responsible for something, and no Scope IN item names those `doctor` lines. C18's `doctor`
  line covers overlaps only, and C16's text names no `doctor` line. C19 records exactly what the two answers name.
  The unmanaged `emit_event` case from R5-1 had a different answer ("its own issue", with no `doctor` line) and does
  not ride in.

**A gap the lead found this round.** Every path round 6 traced runs through `agent-dispatcher.ts`. A grep this round
for code that acts on a bound agent outside it found more:
- `plugins/session-cleaner.ts` listens for a trash-emoji message. It resolves the instance's agent through
  `applyAgentFkOverrides` and `resolveProvider`, which it imports from the dispatcher (`:20`, `:216-230`). It then
  resets the provider session (`:232-235`), sends the person a confirmation, and "blocks agent response" (file header
  `:1-8`).
- `plugins/follow-up-hooks.ts` arms a follow-up sequence on an agent-origin `message.sent` (`:87-107`).
- `scheduler.ts` and `services/agent-replay.ts` (reached from `routes/v2/instances.ts`) also name agents.

None of these was read for whether it acts on a subscriber-mode agent. C17's test reads "no dispatcher call on any
path and no error reply". A31's switch notice lists only dispatcher features. So a switched agent could still get a
session reset, a confirmation sent for it, a follow-up sequence or a replayed run, and neither the test nor the
notice would say so. Scout P reads these paths. Two facts settle without a scout:
- `plugins/agent-responder.ts` is dead code. `index.ts:669` calls `setupAgentResponder`, which `plugins/index.ts:32`
  re-exports from `agent-dispatcher.ts`, where it is an alias of `setupAgentDispatcher` (`:6711`).
- The chatless `call_agent` run (`automation-actions.ts:122`, `runChatless`) is the engine path that C7 already
  covers.

## WRS bar (round 7, before the scouts)

| Dimension | Score | Why |
|---|---|---|
| Problem | 20/20 | Unchanged. The non-dispatcher paths are a gap in what the design covers, not in what the problem is. |
| Scope | 19/20 | C19 joins from R6-1 and R6-2. Scout P may show that C17's check, or A31's notice, must reach files other than `agent-dispatcher.ts`. Scout Q decides whether the `doctor` lines need a new read endpoint. |
| Decisions | 19/20 | Twenty-two settled, and nothing is open or asked. One candidate, O24, waits on scout P. |
| Risks | 19/20 | New: the session cleaner, follow-up hooks, scheduler and replay may act on a subscriber-mode agent. Deployed rows cannot be seen from here, and `doctor` reports each state that matters. The collation and the real query plans are left to C13 to measure. |
| Criteria | 19/20 | C19's `doctor` lines are testable. C17's "no dispatcher call on any path" test may be incomplete until scout P lists the other paths. |
| **Total** | **96/100** | Round 6 ended at 97. The lead's finding costs one point in each of Scope, Risks and Criteria. R6-1 and R6-2 close the round-6 Decisions gap, and O24 reopens it. |

## Gap map (round 7)

- **Settled by the owner (ledger):** R1-1 to R1-4, R2-1 to R2-4, R3-1 to R3-4, R4-1 to R4-4, R5-1 to R5-4, R6-1 and
  R6-2.
- **Scope IN added by the lead from owner answers:**
  - C19, from R6-1 and R6-2: the `doctor` lines for unbound call-mode agents, for inactive agents still bound or
    routed, and for turn-based agents with no key under their current name;
  - C15 to C18, which the ledger's Scope ratchet already lists.
- **Settled by facts this round:**
  - `agent-responder.ts` is dead code;
  - the chatless `call_agent` is the engine path C7 already covers.
- **Lead design calls (Assumed):** A48, which names the follow-up issues and places C19's `doctor` lines. A39 is
  sharpened, and its O22 clause becomes permanent.
- **Facts this round's scouts gather (code only, omni at `ee5753234`):**
  - P: every path outside the dispatcher's three subscriptions that resolves an agent through `instances.agent_id` or
    `agent_routes` and then runs it, resets its session or sends on its behalf. For each path: how it picks the agent,
    whether it reads the agent's mode or `is_active`, and what a subscriber-mode agent would experience. P also
    answers whether the tRPC router is mounted, and whether `updateManifest` runs in a database transaction outside a
    tenant scope.
  - Q: how `omni doctor` gets its data, and whether any endpoint returns what the C18, C19, A35, A39 and A47 lines
    need: agents with their bindings, routes, manifest `accepts`, mode, `is_active` and key state, and the state of
    `OMNI_JOURNAL_ACCESS_DECISION`.
- **Owner decisions this round:** none until the scouts report. O24 is asked only if scout P finds a path that acts on a
  subscriber-mode agent and closing it would change something the owner already approved. If it would not, the lead
  announces the change, because it adds scrutiny.
- **Facts still unknown and not scoutable:**
  - deployed rows, and whether `OMNI_JOURNAL_ACCESS_DECISION` is on anywhere (`doctor` reports both);
  - NATS ordering between the engine and the dispatcher, which A44's timestamp cutover makes irrelevant to delivery;
  - the collation and the real plans at A24's volume, which C13 measures;
  - Discord, Twilio and Gupshup media URL expiry, which R4-4 makes irrelevant in v1;
  - the RLS policy text on `omni_events`.
- **Blocks what:**
  - Scout P decides whether C17 and A31 are complete, and whether O24 exists.
  - Scout Q decides whether the `doctor` lines are CLI-only or need a read endpoint.
  - If both come back clean, round 8 can crystallize.
  - C0, C15 and C16 ship ahead as fixes. Slices 1 to 5 still gate the GitLab connector, and slices 1 and 2 still gate
    the swarm's Omni intake.

## Round 7 scout findings

Both scouts read omni at `ee575323462b` (HEAD, matching `ee5753234`), code only. Their reports are evidence; the
lead checked one fact (`GET /keys`, below).

**Scout P: code outside the dispatcher that acts on a bound agent.** Two code paths outside the dispatcher's three
subscriptions resolve an agent and then act on it. Neither reads a per-agent mode, which does not exist yet, or
`agents.is_active`.
- **The session cleaner** (`plugins/session-cleaner.ts`), its own durable consumer registered in `index.ts:685-690`.
  On a trash-emoji-only `message.received` it takes `instance.agentId` (`:162-171`), never a route, so a routed chat
  resets the instance default's session. It reads that agent's provider (`:175-185`), calls
  `agentProvider.resetSession` (`:231-235`; Agno `deleteSession` at `:245-246`), disarms the follow-up sequence and
  clears `agentPaused` (`:309-355`), then sends the person "✅ Conversa limpa!" (`:402-408`), or "❌ Erro ao limpar
  sessão" on a failure that is not on its skip list (`:440`). The header's "blocks agent response" (`:7`) is the
  dispatcher's own drop (`agent-dispatcher.ts:5763-5766`, its own copy of the regex at `:5378-5383`); the cleaner
  blocks nothing. For a switched agent that keeps its provider, the reset would run and the person would be told
  their session was reset while the subscriber's context is untouched; a provider failure would send an error reply
  outside the dispatcher, which C17's test forbids. A provider-less agent throws a skippable error and nothing
  happens. The same reset is reachable from `POST /chats/clear-session` (`routes/v2/chats.ts:976-1020`), which sends
  nothing to the person.
- **The automation engine's `call_agent`** (`plugins/automation-actions.ts`). It runs `ctx.agentId ?? instance.agentId`
  (`:409`), where an empty `config.agentId` means the instance's own agent (`core/src/automations/actions.ts:845-905`),
  through `agentRunner.runOrStream` (`:449`). The chatless variant needs an explicit id and runs `runChatless`
  (`:85-123`). The compiler writes `call_agent` on managed rows only (`services/manifest-compiler.ts:125-153`), and C6
  removes those at a switch. A row an operator writes by hand is not touched by C6 or C18, so it would start a
  provider run for a subscriber-mode agent beside its consumer's delivery. This is O24.
- **Paths that resolve no agent to act on it:**
  - agent replay (`services/agent-replay.ts`) gates only on `instances.agent_id` being set (`:120`; the manual route
    `routes/v2/instances.ts:4157-4210` checks nothing). It republishes up to 24 h of unanswered inbound messages as
    `message.received` with a fresh event id (`:339-367`), so a subscriber's consumer would receive them again as new
    rows;
  - the follow-up hooks arm only on an agent-attributed `message.sent` (`follow-up-hooks.ts:88-110`). A `sentBy:
    'agent'` send attributes it to `instance.agentId` (`routes/v2/messages.ts:755-765`). The sweeper publishes
    `chat.idle_timeout` and `follow_up.fired` and runs nothing; a run there needs a `call_agent` automation (O24);
  - `scheduler.ts` names no agent. Scheduled messages go out through the channel plugin with no agent check
    (`services/scheduled-messages.ts:378-390`), so a message scheduled before a switch still goes out;
  - the a2a handler (`packages/channel-a2a/src/a2a-handler.ts:497-520`) publishes `message.received` into a task chat
    and waits up to `A2A_SEND_WAIT_MS` (30 s) for the reply the dispatcher would send;
  - handoff and close-contact write `agentPaused` (`routes/v2/messages.ts:2049-2053`), which only the dispatcher and
    the clear-session paths read;
  - turns are opened only by the dispatcher (`agent-dispatcher.ts:2951`). The turn monitor still nudges and closes a
    turn opened before a switch.
- **`agents.is_active` is read by no run, reset or send path,** only by the agent list filter and the a2a card
  (`services/agents.ts:90`, `services/a2a-discovery.ts:144,216`). This confirms R6-2's premise.
- **The tRPC router is not mounted.** `packages/api/package.json:15-18` exports it, nothing imports or serves it, and
  `packages/db/src/tenancy-db-access-guard.ts:1682` says the same.
- **`updateManifest` is not one transaction outside a tenant scope.** It runs the manifest `UPDATE`
  (`services/agents.ts:187`), publishes `system.agent.manifest.updated` (`:197`), then reconciles (`:210`) one
  statement per row (`services/manifest-compiler.ts:228-262`, `services/automations.ts:319-337`). No `transaction(`
  call exists in those files, and `scopedHandle` returns the plain pool with no scope (`tenancy/tenant-scope.ts:91-94`),
  so each statement autocommits and a failure mid-reconcile leaves the new manifest with part of its compiled plan.
  Inside a tenant scope the middleware wraps the handler in one transaction (`middleware/tenancy.ts:240-262`), but
  both bus publishes are plain awaits, not `runAfterTenantCommit`, so they fire before the commit. Under R2-2 the
  paired-agent world is the no-scope one.
- **The round-4 open item at this DRAFT's line 1090** (whether the engine fires a managed `call_agent` row for
  `message.received` beside the dispatcher) is confirmed again: it does, whenever a manifest accepts that event. Round
  5 (scout L) already settled it, and C18 answers it.
- Text addressed to a reader, reported as data and not followed: `tenancy-db-access-guard.ts:1682-1686` ("OPEN
  QUESTION for the orchestrator: ... or retire the unmounted surface") and the description string the compiler writes
  into each managed row (`manifest-compiler.ts:135`, "Do not edit by hand").

**Scout Q: how `omni doctor` gets its data.**
- `doctor` is one file, `packages/cli/src/commands/doctor.ts`. All data goes through an injected `DoctorDeps`
  (`:192-294`), and `productionDeps()` (`:296-440`) is the real one, so tests stub it. The only API reads are the
  health URL, `POST /auth/validate` (`:363`) and `GET /instances` (`:393`), all with the stored CLI key.
- **No endpoint returns the planned lines' data in one read.** `GET /agents` returns rows with `isActive` and
  `eventManifest` but no bindings (`routes/v2/agents.ts:47-57`). `GET /instances` carries `agentId`. Routes are listed
  one instance at a time (`routes/v2/agent-routes.ts:19-33`). `GET /keys` returns `name`, `status`, `instanceIds` and
  `createdBy`, capped at 100 with no cursor and no name filter (`routes/v2/keys.ts:870-888`). The SDK exposes each
  read, so a CLI-only line is possible at a cost of one call per instance, and with more than 100 keys it would miss
  some silently. `GET /agents?isActive=false` does not filter, because `z.coerce.boolean()` reads `'false'` as true
  (`routes/v2/agents.ts:20-26`).
- **`OMNI_JOURNAL_ACCESS_DECISION` is visible on no surface.** It is a bare `process.env` read at
  `event-persistence.ts:163` and `event-consumers.ts:387,438-445`. `POST /auth/validate`'s `data.server` carries
  exactly three posture fields, one of them `multitenancyEnabled` (`tenancy/server-posture.ts:46-53`), and doctor
  throws the posture away (`doctor.ts:363-365`). A47's line needs a new authenticated read.
- **The verdict is a fixed structure.** `CheckLevel` is `OK | WARN | FAIL`, `CheckId` is a closed union of 14 ids, and
  a result is `{id, level, detail}` with no remediation field, so the consequence and the fix go in `detail`
  (`:87-116`). The process exits 1 only when a check FAILs (`:1464-1469`). `omni update` prints only the counts
  (`update.ts:598-601`). A new check joins in five places: the id union, a check function, the `runAllChecks` array
  (`:1263-1281`), a deps seam, and optionally `applyFix`. `doctor.test.ts:390-411` pins 14 checks in order. The
  header (`:1-24`) lists 10 and `--help` (`:1427-1450`) 11.
- The existing API checks report OK when the API is unreachable (`listLockedInstances` returns `[]`, `:386-406`).
- Auto-provisioned agent keys are named `agent:<name>` or `agent:<tenantId>:<name>`, with `createdBy
  'system:auto-provision'` (`lib/agent-key-name.ts:29-48`, `routes/v2/instances.ts:1398-1432`).
- Scout Q found no reader-addressed text in the files it read.

**Checked by the lead.** `GET /keys` returns `services.apiKeys.list()` (`services/api-keys.ts:587-589`, a plain
`select()`), and a grep of `packages/api/src` finds no step that strips `keyHash` from it; the route's own neighbours
use an explicit projection for exactly that reason (`routes/v2/keys.ts:625`, `:761`). It needs `keys:read` and returns
a hash, not a credential, so it is a lead observation outside this design, not a question. The design's own read
(A51) uses an explicit projection.

## Design consequences (round 7)

- **The session cleaner, `POST /chats/clear-session` and agent replay get a mode read** (A49). Each lives in a file C7
  does not name, and each changes only what happens to a subscriber-mode agent, which no deployment has, so call mode
  stays as it is. This adds scrutiny and is announced.
- **C17's test grows** (A40 sharpened, round 7). "No error reply" now covers the cleaner's ❌ reply, and the test
  asserts no `resetSession` and no confirmation for a subscriber agent.
- **The switch notice grows** (A31 sharpened, round 7): the trash-emoji reset, replay on reconnect, a2a blocking
  callers, `agentPaused`, follow-up attribution and scheduled messages.
- **Owner-written `call_agent` rows are O24,** asked this round. Every complete fix touches something approved: C7
  (a skip in `call_agent`), R3-1 (a refused switch), or C6's "both ways" (report only).
- **The switch and the compile run in one explicit transaction, with events after the commit** (A50). Outside a tenant
  scope nothing makes them atomic today, and a half-finished switch would leave both modes' rows live.
- **`doctor`'s agent lines read one new owner read endpoint** (A51), which also carries the journal flag. They are
  grouped into three check ids, each a WARN with the consequence and the fix.
- **Facts retire four unknowns:** the tRPC router is not mounted, the reconcile is not transactional, no run path
  reads `is_active`, and scheduled messages, follow-ups, a2a, handoff and turns run no agent.

## WRS bar (round 7, after the scouts)

| Dimension | Score | Why |
|---|---|---|
| Problem | 20/20 | Unchanged. |
| Scope | 19/20 | Every path outside the dispatcher is named, and the three that act on a subscriber get a mode read (A49) in files C7 does not name. O24 may add a check site or narrow C6's reading. The ledger's Scope ratchet does not list C19 yet. |
| Decisions | 19/20 | Twenty-two settled. O24 is asked, and it is the last open decision. |
| Risks | 20/20 | Named and placed: the session cleaner's reset, confirmation and error reply (A49), replay duplicates (A49), the non-atomic switch and publishes before the commit (A50), the 100-key cap and the `isActive` coerce bug (A51), and owner-written `call_agent` rows (O24). Retired: the tRPC router, the follow-up sweeper and scheduled messages as run paths. Still unknown and not scoutable: deployed rows, which `doctor` reports. |
| Criteria | 20/20 | C17's test covers the cleaner and replay. A50 has a fault-injection test. Each `doctor` group has a stubbed-deps test, and each O24 option names its test. |
| **Total** | **98/100** | Up from 96. The scouts closed the Scope and Criteria gaps that the lead's finding had opened, and found the transaction risk. O24 holds Decisions at 19. |

## Gap map (round 7, after the scouts)

- **Settled by the owner (ledger):** R1-1 to R1-4, R2-1 to R2-4, R3-1 to R3-4, R4-1 to R4-4, R5-1 to R5-4, R6-1 and
  R6-2.
- **Scope IN added by the lead from owner answers:** C19 (from R6-1 and R6-2). The ledger's Scope ratchet lists C0 to
  C18 but not C19. The lead does not edit the ratchet, and flags it for the script.
- **Settled by facts this round:**
  - outside the dispatcher, only the session cleaner (and `clear-session`) and `call_agent` act on a resolved agent;
  - replay, follow-ups, scheduled messages, a2a, handoff and turns run no agent;
  - no run, reset or send path reads `is_active`;
  - the tRPC router is not mounted;
  - `updateManifest` and the reconcile are not one transaction outside a tenant scope;
  - `doctor`'s data path, its fixed verdict and how a check joins it;
  - `OMNI_JOURNAL_ACCESS_DECISION` is visible on no surface.
- **Lead design calls (Assumed):**
  - A49 (mode reads in the cleaner, `clear-session` and replay);
  - A50 (one transaction for the switch and the compile);
  - A51 (`doctor`'s read endpoint and check groups);
  - A31 and A40 sharpened.

  All of them add scrutiny and are announced.
- **Owner decision asked now:** O24, owner-written `call_agent` automations that resolve to a subscriber-mode agent.
- **Lead observations outside the design (no issue filed):** these predate this design and the design changes none
  of them:
  - the cleaner resets the instance default's session in a routed chat;
  - `GET /keys` returns `keyHash`;
  - in-scope manifest publishes fire before the commit;
  - `?isActive=false` does not filter.
- **Facts still unknown and not scoutable:**
  - deployed rows, and whether `OMNI_JOURNAL_ACCESS_DECISION` is on anywhere (`doctor` reports both);
  - whether a replayed row carries the original message id (A49 verifies it);
  - whether the a2a streaming send ever times out;
  - whether nats-genie's reset reaches a runtime;
  - NATS ordering, which A44 makes irrelevant;
  - the collation and the real plans, which C13 measures;
  - media URL expiry, which R4-4 makes irrelevant in v1;
  - the RLS policy text on `omni_events`.
- **Blocks what:**
  - O24 decides whether the design adds a check site for owner-written rows, changes `call_agent`, or reads C6 for
    compiled rows only. Round 8 crystallizes after the answer.
  - C0, C15 and C16 ship ahead as fixes, and A51's endpoint lands with C16's. Slices 1 to 5 still gate the GitLab
    connector, and slices 1 and 2 still gate the swarm's Omni intake.

## Round 8: what the owner settled, and what it changes

The owner answered O24 (Settled R7-1). HEAD is still `ee5753234`. The ledger's Scope ratchet now lists C19, so the
round-7 flag about it is closed. Twenty-three decisions are settled, and nothing is open or asked.

- **R7-1: hand-written `call_agent` automations are reported, not blocked.** An automation an operator writes by hand
  (no managing agent) whose `call_agent` action resolves to a subscriber-mode agent keeps running. `call_agent` stays
  unchanged (C7), a switch is not refused (R3-1 stands), and no new automation write is refused. `doctor` lists each
  such row, and the switch notice names the rows that resolve to the agent being switched. Both give the consequence
  and the fix.
- **C6 is read by R7-1** (A52). "No event reaches one agent both ways" holds for the rows the compiler manages and for
  the dispatcher (C17, A49). For hand-written rows it holds only after the operator acts on the report. The owner saw
  this trade-off in the option text, so this is a reading of C6, the way A10 reads C4 by R1-3 and A40 reads C7 by
  R4-1, not a change to it.
- **C20 is added by the lead from the answer.** It adds scrutiny and is announced, on the C18 and C19 precedent. The
  answer makes `doctor` and the switch notice responsible for something, and no Scope IN item names it. C19 is not
  widened, because the owner already has it as recorded.

**Checked by the lead (code only, omni at `ee5753234`), for C20's data path.**
- `automations.managed_by_agent_id` is NULL on a hand-made row and set on a compiled one (`packages/db/src/schema.ts:3465-3473`),
  so `doctor` can tell the two apart.
- `GET /automations` returns every row through a plain `select()`, with no limit and no cursor
  (`routes/v2/automations.ts:321-328`, `services/automations.ts:193-201`). Unlike `GET /keys`, nothing is missed
  silently. It needs `automations:read` (`constants/scopes.ts:93`).
- Its `?enabled=` filter is `z.coerce.boolean()` (`routes/v2/automations.ts:253-255`), the same coerce bug as
  `GET /agents?isActive=false`, so `enabled=false` does not filter. A lead observation outside the design; C20's read
  filters on the server's own column instead.
- An empty `config.agentId` resolves to `instance.agentId` (`automation-actions.ts:409`), never to a route. So an
  empty-id row reaches a subscriber-mode agent only on an instance that binds it, and a route-named subscriber is
  reached only by a row that names it by id. The chatless variant always names its agent (`:85-123`).

## WRS bar (round 8)

| Dimension | Score | Why |
|---|---|---|
| Problem | 20/20 | Unchanged since round 1's scouts: an external agent pairs with Omni and receives only the events it owns, under C0 to C20's guarantees. |
| Scope | 20/20 | C0 to C20 are named, each with its slice or fix wish. C20 joins from R7-1. Every path outside the dispatcher is placed: A49's three mode reads, and hand-written `call_agent` rows under C20. The C19 ratchet flag is closed. |
| Decisions | 20/20 | Twenty-three settled (R1-1 to R7-1). Nothing is open or asked, and every Open entry is answered. The lead's design calls (A1 to A52) all add scrutiny and are announced, or read an approved item by an owner answer. |
| Risks | 20/20 | Unchanged from round 7, plus the hand-written rows, now reported. What cannot be seen from here (deployed rows, the journal flag's state) is reported by `doctor`. The collation and the real plans are measured by C13 at A24's settled volume. |
| Criteria | 20/20 | Every Scope IN item names its test. C20's are a stubbed-deps `doctor` test (one row naming a subscriber agent by id, one empty-id row on its instance, and a managed row, a disabled row and a call-mode target that stay silent) and a switch test asserting that the notice lists the rows. |
| **Total** | **100/100** | Up from 98. R7-1 closes the last open decision, and C20 places its consequence. |

## Gap map (round 8)

- **Settled by the owner (ledger):** R1-1 to R1-4, R2-1 to R2-4, R3-1 to R3-4, R4-1 to R4-4, R5-1 to R5-4, R6-1,
  R6-2 and R7-1.
- **Scope IN added by the lead from owner answers:**
  - C20, from R7-1: the `doctor` line and the switch-notice line for hand-written `call_agent` rows that resolve to a
    subscriber-mode agent;
  - C15 to C19, which the ledger's Scope ratchet already lists.
- **Settled by facts this round:** C20's data path (`managed_by_agent_id`, the uncapped `GET /automations`, the
  empty-id resolution through `instance.agentId` only).
- **Lead design calls (Assumed):** A52 (C6 read by R7-1, and C20's shape), A51 and A31 sharpened.
- **Lead observations outside the design (no issue filed):** round 7's four, plus `GET /automations?enabled=false`
  does not filter.
- **Facts still unknown and not scoutable:** unchanged from round 7. Each is reported by `doctor`, measured by C13,
  verified by a named test, or made irrelevant by a settled answer.
- **Owner decisions this round:** none. Nothing is open.
- **Blocks what:**
  - Nothing blocks the design. Round 8 crystallizes.
  - C0, C15 and C16 ship ahead as fixes, and A51's endpoint lands with C16's. Slices 1 to 5 still gate the GitLab
    connector, and slices 1 and 2 still gate the swarm's Omni intake.

## Round 11: what changed since round 8

Rounds 9 and 10 left no narrative in this DRAFT; this section records them. HEAD on `dev` is still `ee5753234`.

- **The round-8 design was reviewed FIX-FIRST.** The ledger records the verdict at digest `7a68d852…99b5`, with
  fourteen finding ids (C1 to C9, HIGH-1, HIGH-2, MEDIUM-1 to MEDIUM-3) and `repaired: false`. The findings' text is
  not on disk in this folder or in `gitlab-sdlc-connector/`. DESIGN.md has since been edited (17:07, after the 17:02
  review): rows 2, 17 and 24, Risk 12 and the slice table's note cite reviewer HIGH-1, HIGH-2, MEDIUM-1 and MEDIUM-3.
  Its review stamp still reads FIX-FIRST at the old digest, so the design is repaired in part and not re-reviewed.
  Nothing here claims it shipped.
- **MEDIUM-3 became R8-1, and R9-1 corrected it.** The owner's mobile app sent "GitLab ships first"; the owner
  re-picked when the question was sent again. Settled now (R9-1, reopening R8-1): slice 7's benchmark (p95 under 2 s,
  matched rows only, at A24's 1,000 GitLab rows a day) must pass before the GitLab connector ships. DESIGN.md's slice
  table (slice 5 "gates the GitLab connector") and Risk 12 ("until it is answered, the gate stays slices 2 to 5") are
  stale and change at the next write: the gate becomes fixes 1 to 3 and slices 2 to 5 and 7.
- **C20 is missing from the ledger's Scope ratchet.** Round 8 announced it (A52) and DESIGN.md rows 11 and 85 carry
  it, but the ledger lists C0 to C19. This round's return records it, worded once:
  "C20 (from R7-1): `doctor` and the switch notice list, without changing any row, each enabled hand-written
  `call_agent` automation (no managing agent) that resolves to a subscriber-mode agent, by `config.agentId` or, when
  that id is empty, by the instance's own agent, with the consequence and the fix; no automation write is refused and
  `call_agent` is unchanged".
- **New input: fix 3's implementer asked for a steer.** The relayed request (hc `t1pz omni-fix-c0`, on PR #1462,
  C16's fix) reads: blindly appending every tenant-bound instance to every `agentKeyNameCandidates` name would
  reintroduce the original cross-tenant graft (tenant B's `support` matching tenant A's bare `agent:support`). The
  implementer will reuse a bare candidate only when its non-empty instance grants establish the same agent and
  instance-tenant ownership, otherwise provision the canonical qualified key, repair canonical candidates, and leave
  NULL keys untouched with no replacement. They asked whether the owner intended a different ownership proof.

## Fix 3 (PR #1462): what the lead checked

Checked by the lead at PR #1462's head `8c73ff55d` (`gh pr diff 1462`, state OPEN, base `dev`) and at `ee5753234`.
The implementer's local worktree is mid-rework and is not described here.

- **The owner never set a bind-time ownership proof.** R4-2 asked only when the widening is fixed, and said a re-bind
  "is something the fix verifies". So the implementer's proof contradicts nothing approved, and the lead records it
  with four additions (A53).
- **PR #1462 changes the dispatcher's key lookup.** `agent-dispatcher.ts:2935-2946` now takes, for each name
  candidate, only an active key created by `system:auto-provision` whose `instanceIds` contains the current instance;
  HEAD takes the first row with the name (`findByName` at `api-keys.ts:602-605` has no status or creator filter). The
  PR body gives the reason: for a tenant-owned instance the lookup falls back to the bare global `agent:<name>`, which
  may be another tenant's key, and dispatch writes this chat's turn and context (`contextInstanceId`,
  `contextChatId`, `:2973`) onto it. That leak exists only under multitenancy. The approved text says otherwise:
  C7 "agent-dispatcher.ts and call_agent behaviour unchanged under a regression proof", C17 "the one approved edit to
  agent-dispatcher.ts is a per-agent mode check", and A39 left the lookup alone for exactly that reason. This is a
  change to approved text, so it is asked (O26).
- **Who the check silences.** A turn-based agent stops answering, logged "scoped API key not found", when no
  candidate key lists the instance: a key already widened to `null`; an agent named by a route on an instance its key
  does not list; an instance created through `POST /instances` with an agent before the fix (HEAD's POST provisions
  no key; the PR adds that); and an `agent:<name>` key an operator created by hand (the PR also reserves the
  `agent:` prefix on `POST`/`PATCH /keys`). What such an agent could do with a key that does not list the instance is
  not claimed here; it was not read.
- **Keys already widened stay widened.** The PR body says so ("keys already widened before this fix are not
  automatically inferred or revoked"), and the implementer plans to leave NULL keys untouched. At `ee5753234` the
  only code that writes `createdBy: 'system:auto-provision'` is `instances.ts:1425`, which creates a key with
  `[instanceId]`; the only code that writes `null` onto such a key is the unbind at `instances.ts:1386-1390`. So an
  active auto-provisioned agent key with `instanceIds` `null` or `[]` comes from the bug (or a hand edit through
  `PATCH /keys`), and it still authenticates on every instance with `messages:send`, `turns:close`,
  `tts:synthesize` and `context:read`. HEAD's bind narrowed such a key back to `[instanceId]` on the next bind
  (`currentIds = existingKey.instanceIds ?? []`); "untouched" drops that. Nothing approved covers this residue:
  R4-2 and C16 are about the writer. Asked (O25).
- **`doctor` would not see it.** A39's `agent-keys` line lists keys whose `instanceIds` name an instance not bound to
  their agent; a key that names no instance is not obviously caught. The lead sharpens A39 to list it (adds scrutiny).
- **PR head's unbind looks up one name.** `handleAgentKeyProvisioning` removes the instance from
  `agentKeyName(oldAgent.name, tenantId)` only. Once a bind may extend a bare key under the proof, an unbind that
  checks only the qualified name leaves the bare key's grant in place, a widening by omission that C16's "every writer
  of the key's instanceIds" test must cover (A53).
- **PR head still revokes without renaming.** DESIGN.md row 3 says "revoked and renamed"; the PR frees the name by
  filtering on `status = 'active'` at the provisioning lookup instead. Outside the dispatcher both free the name. The
  dispatcher's own lookup is O26's subject.

## WRS bar (round 11)

| Dimension | Score | Why |
|---|---|---|
| Problem | 20/20 | Unchanged: an external agent pairs with Omni and receives only the events it owns, under C0 to C20. |
| Scope | 19/20 | C0 to C20 are placed, and R9-1's gate is placed (slice 7 before GitLab). C20 is absent from the ledger until this round's return records it. |
| Decisions | 16/20 | Twenty-five settled (R1-1 to R9-1, with R8-1 reopened by R9-1). Two open from fix 3: O25 (keys already widened) and O26 (the dispatcher's key check against C7 and C17). |
| Risks | 18/20 | Two live risks from fix 3 are known and unresolved: widened keys that keep every instance, and turn-based agents the dispatcher check silences. The rest is unchanged from round 8. |
| Criteria | 18/20 | Fix 3's dispatcher behaviour has no test in the design, and C16's test does not yet cover a bind that extends a bare key followed by an unbind (A53). Both follow O26 and A53. |
| **Total** | **91/100** | Down from 100. Fix 3's implementation surfaced two decisions the round-8 design did not hold. |

## Gap map (round 11)

- **Settled by the owner (ledger):** R1-1 to R7-1, R8-1 (reopened) and R9-1: slice 7's benchmark gates the GitLab
  connector.
- **Scope IN recorded by this return:** C20 (from R7-1), worded as above.
- **Lead design calls (Assumed):** A53 (fix 3's ownership proof, the steer to the implementer), A39 sharpened (the
  `doctor` line for keys with no instance list), A54 (R9-1's gate in the design).
- **Open, for the owner:** O25 (keys already widened), O26 (the dispatcher's key check).
- **Cross-brainstorm flag, not an edit:** `.genie/INDEX.md` lists `gitlab-sdlc-connector` as Ready with its next route
  `wish`, and a `gitlab-g1` worktree exists (`feat/connector-ingress-core-safety`). R9-1 gates shipping the GitLab
  connector, not starting it; that brainstorm's design should carry the gate.
- **Blocks what:**
  - O25 and O26 block fix 3's merge (PR #1462) as approved text reads, and the design's fix 3 rows.
  - Nothing else blocks. Fixes 1 and 2 are unaffected. Once O25 and O26 are answered, the design is rewritten with
    R9-1's gate, C20 and fix 3's answers, and reviewed again.

## Round 12: what the owner settled, and what it changes

The owner answered O25 and O26. HEAD on `dev` is still `ee5753234`; PR #1462 is still OPEN at head `8c73ff55d`
(`updatedAt` moved, the head did not). Twenty-seven decisions are settled, and nothing is open or asked. The ledger's
Scope ratchet now lists C20, so round 11's flag about it is closed.

- **R11-1: keys the bug already widened are revoked and re-provisioned.** Fix 3 finds every active key created by
  `system:auto-provision` whose `instanceIds` is `null` or `[]`, revokes it, and provisions narrow keys for the
  instances that use the agent. The shape is A55.
- **R11-2: the dispatcher's key check applies on tenant-owned instances only.** On an instance with a tenant, the
  dispatcher takes only an active key created by `system:auto-provision` that lists the instance. On an instance with
  no tenant, the lookup stays as it is at HEAD. C7 and C17 are read by R11-2 (A56), the way A40 reads C7 by R4-1. Their
  Scope IN text stays verbatim.

**Checked by the lead (code only: omni at `ee5753234`, PR #1462's diff at `8c73ff55d`).**
- **Nobody holds an auto-provisioned key's secret.** `handleAgentKeyProvisioning` keeps only `result.key.id` from
  `apiKeys.create` (`instances.ts:1418-1427`). The plaintext is returned only by `POST /keys`, `/keys/children`, login
  and platform-tenants. The dispatcher hands the agent `OMNI_INSTANCE`, `OMNI_CHAT`, `OMNI_MESSAGE` and
  `OMNI_TURN_ID`, never a key (`agent-dispatcher.ts:2992-2998`). `POST /turns/close` finds the turn by the caller's
  key, then by an explicit `turnId`, then by instance and chat headers (`turns.ts:60-80`), so an agent holding any other
  key still closes its turn. At HEAD the key is a turn record (`turns.apiKeyId`) and a context carrier.
  - **A correction to R11-1's question text.** It said a widened key "still works on every instance". Its scopes do,
    but no code path gives anyone its secret, so the exposure is latent, not live. The answer stands: revoking removes
    a credential nobody should have, and re-provisioning keeps dispatch working, as the option said.
  - **The live residue is a hand-made key.** HEAD's `findByName` has no creator filter, so HEAD's unbind wrote `null`
    onto any key named `agent:<name>`, including one an operator created through `POST /keys`, whose secret that
    operator holds. R11-1 named system-created keys only, and a hand-made key created with `null` on purpose cannot be
    told apart from one the bug widened. No in-repo doc, script or skill creates an `agent:`-named key (searched in
    omni and genie). So the lead does not revoke hand-made keys; `doctor` lists them (A57). That adds scrutiny and
    changes nothing approved.
- **PR #1462 replaces `findByName` with `findAgentKeyByName`.** The new lookup filters on `status = 'active'` and
  `createdBy = 'system:auto-provision'` (diff `api-keys.ts`), and both provisioning and the dispatcher call it. Under
  R11-2 the dispatcher's untenanted branch keeps a name-only lookup with no status filter, so a revoked row that keeps
  its name could be returned ahead of its replacement. Every revoke therefore renames the key, as A39 and DESIGN.md
  row 3 already say ("revoked and renamed to `name:revoked:keyId`"). PR head revokes without renaming, so it changes
  here (A56).
- **PR #1462 reserves the `agent:` prefix** on `POST /keys` and `PATCH /keys` (`keyNameSchema`, diff `keys.ts:59-111`):
  "The agent: prefix is reserved for system-provisioned keys". Nothing approved speaks to hand-made `agent:` keys. A
  refusal at write is added scrutiny, on the A11 and A14 precedent, so it is announced (A57), not asked. Existing
  hand-made keys are left as they are and listed by `doctor`.
- **Who R11-2 still silences, and only on tenant-owned instances.** There are four cases.
  - A widened key: R11-1's repair re-provisions it (A55).
  - A route that names the agent on an instance its key does not list.
  - An instance created with an agent through `POST /instances` before the fix, which made no key: PR #1462 now
    provisions one on `POST`, but older instances still have none.
  - A hand-made `agent:<name>` key.

  Each agent left is listed by `doctor` (A56) with the fix. On untenanted instances nothing changes.

## WRS bar (round 12)

| Dimension | Score | Why |
|---|---|---|
| Problem | 20/20 | Unchanged: an external agent pairs with Omni and receives only the events it owns, under C0 to C20. |
| Scope | 20/20 | C0 to C20 are in the ledger, C20 included. R9-1's gate is A54, and fix 3's two answers are placed in A55 and A56. The reservation and the hand-made residue are A57. |
| Decisions | 20/20 | Twenty-seven settled (R1-1 to R11-2, with R8-1 reopened by R9-1). Nothing is open or asked. The lead's calls A55 to A57 add scrutiny or follow an answer, and each is announced. |
| Risks | 20/20 | Fix 3's two live risks are closed: R11-1 repairs widened system keys, and R11-2 bounds the silencing to tenant instances, where `doctor` names each agent it silences. What remains is reported, not hidden: hand-made `agent:` keys (A57), and the round-8 review's finding text, which is not on disk. DESIGN.md cites only HIGH-1, HIGH-2, MEDIUM-1 and MEDIUM-3, so the rewrite is reviewed again in this run rather than assumed repaired. |
| Criteria | 20/20 | Every Scope IN item names its test. Fix 3 gains A55's repair test, A56's dispatcher tests, and the unbind-revoke-rebind test on an untenanted instance. A57 adds a reservation test and a `doctor` test. |
| **Total** | **100/100** | Up from 91. R11-1 and R11-2 close the last two open decisions, and A55 to A57 place what they leave. |

## Gap map (round 12)

- **Settled by the owner (ledger):** R1-1 to R7-1, R8-1 (reopened), R9-1, R11-1 (revoke and re-provision) and R11-2
  (tenant instances only).
- **Scope IN:** C0 to C20, all in the ledger. Nothing is added or dropped this round.
- **Settled by facts this round:**
  - nobody holds an auto-provisioned key's secret;
  - PR #1462's `findAgentKeyByName` and the `agent:` reservation;
  - the name-only lookup that R11-2 keeps for untenanted instances, which makes the rename at revoke necessary.
- **Lead design calls (Assumed):**
  - A55: R11-1's repair;
  - A56: R11-2's reading of C7 and C17, the required rename, and the `doctor` line for agents the tenant check
    silences;
  - A57: the `agent:` reservation and hand-made `agent:` keys, both reported;
  - A53 and A39 updated to point at the answers.
- **Decided by the lead, not asked:**
  - Hand-made `agent:` keys are reported by `doctor`, not revoked. Their secret is held by someone, and their intent
    cannot be told from the bug's.
  - The prefix reservation is announced as added scrutiny.
- **Owner decisions this round:** none. Nothing is open.
- **Cross-brainstorm flag, unchanged:** `gitlab-sdlc-connector`'s design should carry R9-1's gate.
- **Blocks what:**
  - Nothing blocks the design. Round 12 crystallizes: the design is rewritten with R9-1's gate (A54), C20 and fix 3's
    answers (A55 to A57), then reviewed again.
  - PR #1462 needs three changes before it matches what is approved:
    - the dispatcher check applies on tenant instances only;
    - a revoke renames the key;
    - A55's repair is added.

## Rounds 13 and 14: what happened

Rounds 13 and 14 left no narrative in this DRAFT; this section records them from the ledger and DESIGN.md.

- **Round 13.** The owner answered R12-1 "Repair again (Recommended)". The design was repaired and reviewed a third
  time: FIX-FIRST at digest `d5eecc79…a00a8` (`repaired: true`), with fifteen finding ids (C1 to C11, HIGH-1, HIGH-2,
  MEDIUM-1, LOW-1). DESIGN.md's review stamp carries that digest (reviewed 2026-11-01T21:31:23Z). R12-1's HIGH-1
  (no criterion for C9's self-drop and idempotency, or for C5's stamp) now has criteria in DESIGN.md's Success
  Criteria: the body-supplied `agentId` and `producing_key_id` criterion, the self-drop criterion and the trigger
  and send idempotency criterion. The rest of the round-13 finding text is not on disk.
- **Between rounds 13 and 14, fix 3 merged**, in two PRs: #1462 at 2026-11-01T21:19:59Z (merge `db318c533`) and
  #1469, its review follow-ups, at 21:38:13Z (merge `663f0a08f`). Two GitLab connector PRs merged in the same window:
  #1465 (`8885c362f`, connector ingress core safety, gitlab-sdlc-connector G1) and #1468 (`562a335f4`, the connector
  ingress schema, G2).
- **Round 14 asked three questions**, which the owner answered:
  - R13-1: the merged untenanted lookup, which takes only active system keys. Accepted as merged; this reopens
    R11-2.
  - R13-2: the merged start-up repair stops the boot on any error. The owner picked "Log and keep running".
  - R13-3: where C2's per-source grants live and who writes them. The owner picked "Owner-approved grants table".

## Round 15: what the owner settled, and what it changes

The owner's words this run: "R13-1 accept merged no-tenant lookup (active system keys only; doctor lists hand-made
agent: keys), R13-2 the start-up key repair fails open (log, health degraded, doctor line; a separate Omni PR
implements it), R13-3 owner-approved per-source grants table written only at pairing. Rewrite DESIGN.md against
origin/dev 663f0a08 (#1462, #1465, #1468, #1469 merged): fix 3 is merged, not open; cite #1465 as the baseline for the
connector.* reservation; place the repair test under services/__tests__."

Thirty decisions are settled (R1-1 to R13-3; R8-1 is reopened by R9-1 and R11-2 by R13-1). Nothing is open or asked.
What each answer changes is A58 to A61. The rewrite directives are under "Design consequences (round 15)" below.

## Merged baseline at origin/dev `663f0a08f` (checked by the lead)

Read with `git show 663f0a08f:<path>` and `git grep … 663f0a08f`. After it, `origin/dev` has only `7a4764225`
(a version bump).

- **Fix 3 as merged (#1462 and #1469).**
  - **The dispatcher lookup** (`packages/api/src/plugins/agent-dispatcher.ts:2935-2957`):
    - On an untenanted instance it calls `findAgentKeyByName('agent:<name>')`, which returns active keys created by
      `system:auto-provision` only, newest first. Ties break deterministically, per the repair test "agent lookup
      selects the newest active system key and deterministically breaks timestamp ties".
    - On a tenant-owned instance it takes, for each name candidate, the key whose `instanceIds` contains the
      instance.
    - When nothing is found it logs "Turn-based dispatch: scoped API key not found" and returns false.
    - A route-named agent reaches this lookup: `resolveEffectiveInstance` takes `route.agentId ?? instance.agentId`
      (`:5129`) and applies it to the effective instance.
  - **A revoke does not rename.** `git grep ':revoked:'` over `packages/api/src` finds nothing. Revoked keys are
    skipped by the lookup's status filter, as R13-1 says.
  - **The start-up repair** is `packages/api/src/services/agent-key-reconciliation.ts`.
    - It takes `pg_advisory_xact_lock(hashtext('omni:agent-key-reconciliation'))` (`:86`, `:130`).
    - Under enforcement it enumerates tenants on the auth plane and repairs inside each tenant's runtime scope
      (`:148`).
    - It re-provisions for bindings read through `instances.agent_id` only (`:62`, `:97`). Routes are not read.
    - A revoked widened key with no bound instance gets one warning: "Revoked widened agent key has no bound
      instance; bind the agent to an instance to restore dispatch" (`:156`).
  - **The repair stops the boot on failure.** `packages/api/src/index.ts:1045-1047` awaits `reconcileAgentKeys`
    with no catch, under the comment "Fail startup on repair errors instead of serving a partially repaired world".
    R13-2 changes this.
  - **Route writes provision no key.** `packages/api/src/services/routes.ts` has no provisioning or `agentKey` call.
  - **Tests as merged:**
    - `packages/api/src/services/__tests__/agent-key-reconciliation-postgres.test.ts` (the repair: widened `null`
      and `[]` keys, route-only widened keys warning once, operator keys unchanged, the cross-tenant bare-key case,
      newest-first lookup, a healthy boot taking no repair transaction, and the enforced start-up under runtime RLS);
    - `packages/api/src/plugins/__tests__/agent-dispatcher-key-scope.test.ts`;
    - `packages/api/src/routes/v2/__tests__/instances-agent-key-postgres.test.ts`;
    - `packages/api/src/routes/v2/__tests__/instances-agent-key-tenancy.test.ts`;
    - `packages/api/src/routes/v2/__tests__/keys-admin-route-guard.test.ts`;
    - the new `packages/api/src/lib/agent-key-ownership.ts`.
  - **Issue #1466** (the #1462 review follow-ups) is still OPEN. #1469's tests cover its ordering and start-up-cost
    items. Its no-tenant bind-proof item was not verified line by line in this round.
- **#1465 is the baseline for the `connector.*` reservation (C5).**
  - `packages/core/src/events/types.ts:153-161` types the namespace `connector.${string}`, with
    `isConnectorEventType`.
  - The NATS client's plain publishes throw "Connector events require publishConnector"
    (`packages/core/src/events/nats/client.ts:243`, `:255`). `publishConnector` requires a `publishEventId`
    (`:273`).
  - The automation emit refuses "Connector events may only be emitted by connector ingress"
    (`packages/core/src/automations/actions.ts:572`), and the engine gates connector types
    (`packages/core/src/automations/engine.ts:42`).
  - Dead-letter retry and event replay treat connector types separately (`packages/api/src/services/dead-letters.ts:267`,
    `packages/api/src/services/event-ops.ts:490`).
- **#1468** adds `packages/db/drizzle/0092_connector_ingress.sql`:
  - `connectors.hook_secret` and unmatched counters;
  - `connector_event_subscriptions.ingress` (`subscription` or `connector`), with an untargeted unique index on
    `(connector_id, provider_event_key)`;
  - a replaced `omni_events` tenant-ownership trigger, after 0090 derived a connector event's tenant from its
    persisted subscription.

  0092 is the last migration on `origin/dev`, so the slices' migrations take the next free numbers when they merge.
- **The health surface for R13-2.** `packages/api/src/routes/health.ts:91-101` turns `status` into `degraded` when
  `arePluginsDegraded()` (`packages/api/src/plugin-state.ts`) is true, with a reason. That is the existing pattern a
  degraded repair follows.

## Design consequences (round 15)

These are the directives for this run's rewrite of DESIGN.md. Each comes from the owner's words, a Settled answer or
an announced lead call.

1. **Baseline.** Every fact is read at `origin/dev` `663f0a08f`. Line cites taken at `ee5753234` are re-read there or
   replaced. The header's size line reads: fixes 1, 2 and 3 merged; two fix 3 follow-ups as separate Omni PRs (A59,
   A60); then slices 2 to 7.
2. **Fix 3 is merged, not open.**
   - Rows 3, 3a, 3b and 4 describe what merged, citing #1462 (`db318c533`) and #1469 (`663f0a08f`).
   - Every "PR #1462, open at its head" sentence goes.
   - The "revoked and renamed to `name:revoked:keyId`" step goes (R13-1), and so does `doctor`'s line for revoked
     keys that kept their name: its consequence was the dispatcher returning a revoked row, which R13-1 removes.
3. **The untenanted lookup (R13-1)** uses only active system keys, newest first. A hand-made `agent:<name>` key is
   never used for dispatch, and `doctor` lists it (A61).
4. **The start-up repair fails open (R13-2).** It is fix 3 follow-up A, a separate Omni PR (A59).
5. **The repair test** is `packages/api/src/services/__tests__/agent-key-reconciliation-postgres.test.ts`, which
   exists. Row 3a's `packages/api/src/routes/v2/__tests__/` placement is wrong. Follow-up A's tests sit beside it in
   `packages/api/src/services/__tests__/`.
6. **Route-named agents** get fix 3 follow-up B (A60), which keeps what rows 3 and 3a already promised.
7. **C5's `connector.*` clause** cites #1465 as its baseline, with the paths above. The slice adds only what #1465
   does not prove: an agent-bound key's `connector.*` emission is refused. C5's other clauses are unchanged.
8. **C2's grants (R13-3)** are a grants table written only at pairing (A58). It shapes rows 5 and 15 and the C2
   criterion.
9. **Two-tenant Postgres proofs assert the live role** (A62).
10. **Migrations.** The slices' migrations follow 0092 (#1468). Row 5's source reference for connector rows uses
    #1468's connector-keyed ingress.

## WRS bar (round 15)

| Dimension | Score | Why |
|---|---|---|
| Problem | 20/20 | Unchanged: an external agent pairs with Omni and receives only the events it owns, under C0 to C20. |
| Scope | 20/20 | C0 to C20 are in the ledger and placed. Fixes 1 to 3 are merged. R13-2's fail-open and A60's route provisioning are two named follow-up PRs outside the slices. R13-3's grants table is placed across slices 2 and 6 (A58). |
| Decisions | 20/20 | Thirty settled, and nothing is open or asked. R13-1 to R13-3 close the three questions round 14 asked. A58 to A62 follow an answer or add scrutiny, and each is announced. |
| Risks | 20/20 | The merged residues are named with their consequences: route-named agents silenced until follow-up B (A60), and a failed repair that leaves widened keys active, with health degraded and a `doctor` line (A59). A self-granting agent is closed by R13-3. #1470's superuser test hazard is answered by A62. |
| Criteria | 20/20 | Each answer names its tests. A58 has the grant tests (no self-grant, the owner's `gitlab-billing` example, a grant through pairing). A59 has the throwing repair with health degraded and the `doctor` line. A60 has route writes and the repair for routed instances. A61 has the hand-made key that is not used, plus `doctor`. A62 has the live-role assertion. |
| **Total** | **100/100** | Up from round 14's open three. Every settled answer is placed, and the design can be rewritten against `663f0a08f` from Settled and Assumed alone. |

## Gap map (round 15)

- **Settled by the owner (ledger):** R1-1 to R13-3. R8-1 is reopened by R9-1, and R11-2 by R13-1.
- **Scope IN:** C0 to C20, unchanged. Nothing is added or dropped.
- **Settled by facts this round:**
  - the merged fix 3 shape, at `663f0a08f`;
  - #1465's `connector.*` reservation;
  - #1468's migration 0092;
  - the health pattern for degraded.
- **Lead design calls (Assumed):**
  - A58: the grants table;
  - A59: follow-up A, the repair that fails open;
  - A60: follow-up B, route-named agents;
  - A61: R13-1's consequences;
  - A62: the live-role assertion;
  - A55 to A57 updated.
- **Decided by the lead, not asked:**
  - Follow-up B keeps what the reviewed design already promised (routed instances get keys). R11-1's option text
    named only bound instances, and R11-2 accepted silencing until a fix existed, so keeping it changes nothing
    approved. Dropping it would narrow the design and would need a question.
  - Grants land as a table in slice 2, with their sole writer in slice 6. Until slice 6, no instance-less row reaches
    any agent-owned consumer.
- **Relayed input, outside this brainstorm's authority:**
  - **What arrived.** This run's workflow request relays an implementer message (hc `t1q0 omni-fix-tenant`) on issue
    #1470 ("Two-tenant Postgres tests can silently run as superuser on hostless (Unix-socket) URLs").
  - **What it asks.** A bounded exception for its G6 rehearsal: a fresh disposable cluster on a loopback random port,
    never 5432 or 15432, cleaned after the run.
  - **Why it is not decided here.** That is an operational permission for the owner, not a paired-agents design
    decision. A brainstorm round cannot grant it, and nothing here blocks on it. A62 takes the scrutiny it implies.
- **Cross-brainstorm flag:**
  - `gitlab-sdlc-connector`'s design should carry R9-1's gate.
  - Under A58, its rows reach a paired agent only after slice 6, because the only grant writer is pairing.
- **Blocks what:** nothing blocks the design. Round 15 crystallizes, and the design is rewritten against
  `663f0a08f` under the directives above, then reviewed again.

## Open

- O1. Answered (R1-1).
- O2. Latency answered (R1-2); the rows-read bound moves to O10.
- O4. Answered (R3-1): a conversational agent may be switched to subscriber mode, and the cost is stated. How the
  switch stops dispatcher delivery is a fact scout J gathers (see Round 4).
- O5. Answered (R3-2): a new `agents.provider` member, `paired`.
- O6. Answered (R1-3): deferred, and the profile omits `connectors:invoke`.
- O7. Answered (R2-4): the Omni agent id only, with no external-id column.
- O8. Answered (R1-4): `custom.agent.*`.
- O9. Answered (R2-2): single-owner only in v1.
- O10. Answered (R2-1): matched rows only. What "matched" covers for payload filters moves to O13.
- O11. Answered (R2-3): fixed now as its own fix, and it enters Scope IN as C15.
- O12 (new, round 2). `emit_event` from an automation with no managing agent can publish core types such as
  `message.received`. C5 covers `connector.*` and the two reserved `custom.*` prefixes, not core types. Refusing core
  types would change existing automations' behaviour, so whether it joins C5 or goes to its own issue is the owner's
  call. (Owner; waiting since round 2. Displaced in round 3 by O13 and O15, which block C13's tests.)
  Round 4 (scout K): no path, fixture, template, skill or document in the repo emits a core type through
  `emit_event`; only deployed rows could break. A refusal belongs in `validateEmitEvent` only (inside
  `EventRegistry.validate` or `publishGeneric` it would break replay, dead-letter retry, WhatsApp and webhooks), and
  the dry-run would need the same check. The manifest allows a core type in `publishes`. The options to ask: refuse
  for agent-attributed emitters only (C5's own reach, no change for unmanaged automations, with the rest as its own
  issue), refuse for every `emit_event` with `doctor` listing existing rows first, or leave C5 as it is and file an
  issue. (Owner; waits a third time, and heads the next batch. Reason: no slice test waits on it, while O18, O19,
  O14 and O16 each block a test, a slice's shape or a live exposure.)
  Round 5: nothing new; it heads this round's batch, written after scouts L and M report. (Owner.)
  Round 5, after the scouts: asked, with the three options above. (Owner; asked.)
  Round 6: answered (R5-1), agent emitters only; the shape is A45, and the unmanaged case goes to its own issue.
- O13. Answered (R3-3): a row that passes the SQL clauses but fails the payload filters counts as matched.
- O14. Answered (R4-3): depth 5; the counting rule is A41, and what happens past it is A38.
- O15. Answered (R3-4): past the per-agent backlog limit, Omni reports and does nothing else.
- O16. Answered (R4-4): no media bytes in v1; the consequences are A42.
- O17 (new, round 4; A24 made a question). C13's volume. No source states "one busy GitLab project's journal volume"
  (round 3, scout F), so C13's pass or fail rests on a lead stand-in: 1,000 GitLab rows a day, 90 days of them
  (90,000 rows) inside 900,000 rows of other families, a live hour replaying one day with one 300-row burst in one
  minute. A load-bearing assumption is asked, not kept silent. The choices are to accept A24, to give an owner figure,
  or to size C13 from a measured production journal before the benchmark runs. (Owner; waits. Reason: A24 is a
  working stand-in the owner can replace at any time, and C13 runs last, so nothing is built on it before the next
  batch.)
  Round 5: nothing new; it follows O12 in this round's batch. (Owner.)
  Round 5, after the scouts: asked. (Owner; asked.)
  Round 6: answered (R5-2), A24 accepted.
- O18. Answered (R4-1): a dispatcher mode check; it enters Scope IN as C17, and A40 reads C7 by it.
- O19. Answered (R4-2): fixed now, as its own fix; it enters Scope IN as C16, with A39 as its shape.
- O20 (candidate, round 5; asked only if scout L confirms it). The automation engine may fire a managed `call_agent`
  row for `message.received` on an instance the dispatcher already serves. If it does, a bound agent in call mode
  (C6's default) whose `accepts` names `message.received` is called twice for each message today, once by the
  dispatcher and once by the compiled automation, which C6 forbids, independent of any switch. What the compiler does
  for such an agent (skip the event the dispatcher already delivers, refuse the compile with the reason, or leave it
  and report it) is the owner's call. (Owner, after scout L.)
  Round 5, scout L: confirmed from code, not reproduced (see Round 5 scout findings). The engine matches by event type
  alone and the compiled row carries no instance or agent condition, so the second run happens today, also on
  messages the dispatcher drops and on every instance. The options asked: refuse the overlap at manifest apply and at
  bind time and have `doctor` list existing overlaps (no runtime change, C7 intact); skip at run time in `call_agent`
  (a second exception to C7, one binding read per event); or report only and read C6's "both ways" as subscriber mode
  only. (Owner; asked.)
  Round 6: answered (R5-3), refuse the overlap; it enters Scope IN as C18, and A46 is its shape.
- O21 (new, round 5; A36 made a question). The consumer compiled for a subscriber's `message.received` and reaction
  events was to carry the journal's access clause (A36). Scout M found that verdict is written only under
  `OMNI_JOURNAL_ACCESS_DECISION=true`, off by default, that an open instance stores `'disabled'`, which no filter
  matches, and that a consumer's access filter is refused with 400 while the flag is off. Requiring the flag narrows
  R3-1 in practice, so the choice is asked: require the flag (the switch refused with the reason and the enable path,
  the clause admitting `allowed` and `disabled`, a NULL verdict not delivered and counted); check access at pull time
  (current verdict, new code outside A25's index plan); have the paired-agent flag turn the journal on; or no access
  parity, stated. (Owner; asked.)
  Round 6: answered (R5-4), require the journal flag; the edges the answer leaves are A47.
- O22 (new, round 5; waits). Deleting an agent nulls `instances.agent_id` through the foreign key and leaves its
  auto-provisioned key active on those instances; a later agent bound there shares the instance with that key.
  Renaming an agent orphans its key, still active, and breaks the dispatcher's turn lookup until a re-bind. Whether
  agent delete revokes the key and rename carries it, here or as its own issue, is the owner's call. (Owner; waits.
  Reason: neither widens a key, so it is outside C16; A39 has `doctor` report both states meanwhile, and four
  questions already block a slice, a fix or a test.)
  Round 6: asked after scout O reports, with options shaped by whether agent delete is hard or soft and how rename
  runs: revoke on delete and carry the key on rename as part of C16's fix, the same as its own issue, or report only
  through `doctor` (A39). (Owner; asked this round.)
  Round 6, after the scouts: scout O found the delete soft, so round 5's premise was wrong (see the correction under
  Round 6 scout findings). A deleted agent keeps its bindings, its routes and its active key, and the dispatcher keeps
  calling it, because no agent lookup reads `is_active`; only its compiled automations go. A rename leaves the key
  under the old name, so a turn-based agent's dispatch finds no key and drops the message until a re-bind. Asked as
  one decision covering both, with the same placement for each: its own issue with `doctor` reporting both states
  (recommended, C16 stays the widening fix it was approved as); refuse delete while the agent is bound or routed and
  carry the key on rename, as a Scope IN item beside C16; or unbind on delete through the unassign path (so C16
  revokes the key) and carry the key on rename, as a Scope IN item beside C16. (Owner; asked.)
  Round 7: answered (R6-2). The fix goes to its own issue, and `doctor` reports both states. C19 records the `doctor`
  lines, which ship with C16's fix wish (A39).
- O23 (new, round 5; waits). A call-mode managed row for `message.received` or a reaction carries no access clause, so
  a call-mode agent is run on messages from senders the instance blocks. That is today's `call_agent` behaviour, kept
  by C7, and the opposite of what O21 asks of subscriber mode. Whether the compiler adds the clause to call-mode rows is
  the owner's call. (Owner; waits. Reason: it changes existing managed rows, it is not a regression this design
  introduces, and O20 and O21 decide the shape it would follow.)
  Round 6: O20 and O21 are answered (R5-3, R5-4), so the shape is known. Under R5-3 a call-mode agent a dispatcher
  serves can no longer accept `message.received`, so O23 now concerns unbound call-mode agents, whose managed row runs
  on every instance. Asked after scout N reports whether the engine can read an access verdict when it evaluates the
  row: the verdict is written when the persistence consumer fills the row, which may land after the engine has run.
  If it cannot, adding the clause needs new code, and the options say so. (Owner; asked this round.)
  Round 6, after the scouts: scout N found the engine cannot read the verdict at all (conditions see the bus event,
  never the journal row, and the two consumers are unordered), and `call_agent` checks no access, so every option but
  the first is new code. Asked, for an agent bound to no instance and named by no route whose manifest accepts
  `message.received` or a reaction type: its own issue with `doctor` reporting each such agent (recommended, C7 and
  `call_agent` unchanged, as the owner chose in R5-3); an access check in `call_agent` for managed rows with live
  rules (a second exception to C7, the kind R5-3 declined for the overlap); or widen C18 so no call-mode agent may
  accept those types, leaving subscriber mode, which carries the access clause under R5-4, as the only way. (Owner;
  asked.)
  Round 7: answered (R6-1). The fix goes to its own issue, and `doctor` reports each such agent. C19 records the
  `doctor` line. C7 and `call_agent` are unchanged.
- O24 (candidate, round 7; asked only if scout P confirms it). Code outside `agent-dispatcher.ts` may act on an agent
  bound to an instance or named by a route: the session cleaner's trash-emoji reset and confirmation, the follow-up
  hooks, the scheduler and agent replay. If any of them acts on a subscriber-mode agent, the switch R3-1 allows is not
  clean. C17's check covers only the dispatcher's three paths, and A31's notice names only dispatcher features. The
  lead's call depends on what closing the gap would change:
  - if closing it changes nothing the owner approved (for example, a mode check in a file C7 does not name, or one
    more line in the switch notice), the lead announces it as added scrutiny;
  - if closing it changes approved behaviour (C7, C17's "one approved edit", or call-mode behaviour), it is asked.

  (Lead, after scout P.)
  Round 7, after scout P: asked, on owner-written `call_agent` automations only. Such a row runs `config.agentId`, or
  the instance's own agent when the id is empty (`automation-actions.ts:409`, `:449`; the chatless variant at
  `:85-123`), with no mode read. Every complete fix touches something approved: a skip in `call_agent` (C7), a
  refused switch (R3-1), or report only, which leaves C6's "both ways" covering compiled rows only. The options are:
  `doctor` and the switch notice report each such row (recommended); refuse the switch and new rows that name the
  agent by id; or skip in `call_agent`. The session cleaner, `clear-session` and replay are not asked: closing them
  changes nothing approved, and A49 announces them. (Owner; asked.)
  Round 8: answered (R7-1), `doctor` and the switch notice report each such row. It enters Scope IN as C20, and A52
  is its shape.
- O25 (new, round 11; fix 3, PR #1462). Auto-provisioned agent keys the bug already widened (active, created by
  `system:auto-provision`, `instanceIds` `null` or `[]`) stay active on every instance after fix 3, and the PR leaves
  them untouched. Options asked: revoke them once on upgrade and provision a fresh narrow key for every instance that
  currently binds the agent (recommended: it closes the exposure R4-2 ordered fixed now, and the re-provision keeps a
  bound agent answering under any O26 answer), or `doctor` reports each with the revoke command and nothing changes
  until an operator acts. Either way A39's sharpened `doctor` line lists any that remain. (Owner; asked.)
  Round 12: answered (R11-1), revoke and re-provision; the shape is A55. Hand-made `agent:` keys, which the question
  did not cover, are A57.
- O26 (new, round 11; fix 3, PR #1462). PR #1462's dispatcher key check (active, `system:auto-provision`, the
  instance in `instanceIds`) is a second edit to `agent-dispatcher.ts`, against C7, C17's "one approved edit" and
  A39. Options asked: apply it only on tenant-owned instances, where the leak lives (recommended: single-owner
  deployments, the only world R2-2 supports for paired agents, see no dispatcher change); apply it everywhere as
  written; or no dispatcher change, with the leak sent to its own issue. Whichever is picked, C17 and C7 are read by
  it, as A40 reads C7 by R4-1. (Owner; asked.)
  Round 12: answered (R11-2), tenant instances only; the reading and the tests are A56.
  Round 15: R13-1 reopened R11-2 and accepted the merged untenanted lookup, which takes active system keys only (A61).
- Round 14's three questions, which have no O number here: R13-1 (the merged untenanted lookup), R13-2 (whether the
  start-up repair fails open) and R13-3 (where grants live). Round 15: answered, and placed in A61, A59 and A58.

No question is open.

## Assumed

- A1 stands.
- A2 is overturned by scout 2: the mode field cannot be read by the existing reconciler as it is. Slice 5 adds the
  schema field, a compiler branch and a `durable_consumers` managed-row path (see Size triage). Where the field lives
  (an `agents` column or a manifest key) is still a design detail.
- A3 stands, narrowed: the schema registry enforces only through `emit_event` and `custom.*` webhook ingress, so
  `ae/1` stays an unenforced payload profile by default. Whether its kinds can be declared at all is O8.
- A4 stands.
- A5 is now a question (O6), because deferring changes C4.
- A6 stands; scout 3 confirms only SessionStart and UserPromptSubmit return context, and that Brain has no inbox slot
  or redelivery dedup yet (Brain-side work, outside Omni under C12).
- A7 (new, replaces O3). Brain's chat archive and an Omni consumer feed are complementary, not rivals: the archive
  pulls chat messages over REST, the feed carries journaled event families such as `custom.gitlab.*`, and the swarm
  names no chat message family. Neither is "canonical" over the other; Brain's own choice stays in brain-v3.
- A8 (new). C0 takes the council's first-named shape: pull applies the caller's instance clause exactly as SSE does.
  A consequence the owner sees in O1: an instance-restricted key pulling an unscoped consumer stops receiving
  NULL-instance rows (`custom.*`, `connector.event`) until C2's grants land.
- A9 (new). Brain's swarm consumer for `custom.gitlab.*` must be an agent-owned consumer under C1 (Brain as an ordinary
  paired agent, C12), since an unscoped consumer can be acked or deleted by any `events:write` key.
- A10 (new, round 2). C4 is read narrowed by R1-3: the "declared typed actions" clause is empty in v1, and the C4
  Scope IN text is left verbatim because the ledger owns it. Not a scope drop; the owner's R1-3 answer decides it.
- A11 (new, round 2, adds scrutiny; confirmed necessary by scout A). Under R1-4, `custom.agent.*` is reserved the way
  C5 reserves `custom.webhook.*` and `connector.*`. Only a key bound to an agent may journal it, and only the types
  that agent's manifest publishes. Webhook ingress and non-agent `/events/trigger` calls are refused for that prefix.
  Announced rather than asked, because it only tightens C5. Scout A found that no path refuses the prefix today. A
  webhook source named `agent` already emits `custom.agent.*`.
- A12 (new, round 2). `ae/1` kinds are spelled `custom.agent.<kind>` in v1 (for example `custom.agent.gate.result`);
  `team.*` maps to `custom.agent.team.*`. A naming rule only; `ae/1` stays an unenforced payload profile (A3).
- A3 sharpened (round 2). Inside the C8 fence, `ae/1`'s payload `actor` is data the agent supplied. The verified
  identity is the stamped `agent_id` column (A13), whatever O7 decides.
- A9 strengthened (round 2). An agent-owned consumer under C1 is also needed because of O11: today an unscoped or
  scoped consumer is reachable by any instance-unrestricted key, including another tenant's.
- A13 (new, round 2, adds scrutiny). C2's grant and C5's provenance share one stamp, written in indexed real columns
  at journal time:
  - the producing agent in the existing `agent_id`, taken from the authenticated key and never from the caller's body;
  - the producing key in a new `producing_key_id`;
  - for ingress rows, a source reference to the connector subscription or webhook source id.

  Metadata jsonb is unindexed and absent on most instance-less producers, so it cannot carry the grant. Additive
  migration, behind slice 2's flag.
- A14 (new, round 2, adds scrutiny). The C5 reservation covers webhook source create and ingress, `/events/trigger`,
  poll `emitType` and `emit_event`. `emit_event` refuses `connector.*` always, and refuses `custom.agent.*` unless the
  managing agent's manifest publishes the type. Existing webhook sources named `agent*` are reported by `doctor`, not
  silently renamed.
- A15 (new, round 2, adds scrutiny). The C3 backfill runs in this order: (1) the `turns` key-to-agent link, used only
  when it is unique; (2) `system:auto-provision` keys named `agent:%`, resolved through `instances.agent_id`; (3)
  anything else stays NULL, and `doctor` reports it with the fix. Never by name alone.
- A16 (new, round 2, adds scrutiny). The C8 envelope is an allowlist projection for agent-owned consumers. It carries
  provenance columns and one fenced, untrusted `data` field. Channel `rawPayload`, `agentRequest`, `agentResponse` and
  raw `error` text are not passed through. Legacy consumers are unchanged.
- A17 (new, round 2, adds scrutiny). C9's causation depth is stamped by Omni from the stored parent. For agent-bound
  keys, `/events/trigger` checks that a supplied `causationId` exists and is visible to the key. Ping-pong without
  causation is bounded by the backlog limit and rate limits, not by depth.
- A18 (new, round 2, adds scrutiny). C10 means two things: `/context` returns no chat or message to a subscriber-mode
  agent key, so verbs need explicit `--instance`/`--chat`; and subscriber-mode agents have no turns. The dispatcher's
  context writes stay as they are (C7).
- A19 (new, round 2). C4's consume scope is added to `SCOPE_MAP` for pull, ack, stream and inspect, with
  `events:write` still accepted while the flag is on. The agent profile is a server constant. General scope-string
  validation stays out of scope.
- A20 (new, round 3, adds scrutiny; follows R2-2). Every paired-agent flag (C14) refuses to turn on while
  `OMNI_MULTITENANCY_ENABLED` is true. `doctor` prints that paired agents are OFF, says that v1 is single-owner, and
  names the condition. No paired-agent path runs half-working on a multitenant deployment.
- A21 (new, round 3; follows R2-3). C15 ships as its own fix wish ahead of the design, like C0. It confines
  consumer list, inspect, pull, ack, stream and delete to the caller's tenant, with a regression test. C1's ownership
  check extends the same `canAccessConsumer` predicate rather than adding a second one.
- A22 (new, round 3; reads R2-1). R2-1's bound is checked per pull request across all its rescans. A row counts as
  read if the scan touches its heap tuple. The bound covers the type or glob, `excludeTypes`, the instance clause, the
  access verdict and the C2 grant clause. Whether it also covers payload filters is O13, not assumed.
- A23 (new, round 3; follows R2-4). `ae/1` `actor.bot` inside the fence is unverified agent data. The managed
  consumer name and the pairing record key off the Omni agent id. No external-id column is added in v1.
- A20 sharpened (round 3, scout H). Each slice's flag is an environment variable read on every call and compared to
  the exact string `'true'`, as `OMNI_MULTITENANCY_ENABLED` is. Rollback is to unset it and restart; the additive
  columns stay and go unread. The refusal is decided in one place that reads `isMultitenancyEnabled()`. `doctor`
  reports it through a new check that reads the server's posture from `POST /auth/validate`, since `doctor` reports
  no flag today.
- A22 sharpened (round 3, scout E). Rows the readiness gate holds pass the SQL clauses and sit inside R2-1's bound.
  The DRAFT's sentence "an idle rescan is an index probe that reads no heap row" holds only when no page is held. C13
  reports re-reads of held rows as a second count, shared-consumer retries and reclaims count toward the pull, and the
  design makes a rescan after a hold probe only the held head row.
- A24 (new, round 3; no source states the volume, scout F). C13's "one busy GitLab project's journal volume" is taken
  as 1,000 GitLab rows a day, rounded up from F11's counts (about 880 a day over a two-day launch). The benchmark
  journal holds 90 days of that (90,000 rows) inside 900,000 rows of other families, so the rows the index must skip
  outnumber the matches ten to one. The live phase plays one day's 1,000 rows within one hour, with one burst of 300
  rows in one minute (F11's peak-day pushes). The first run sets the baseline (R1-2). This is a stand-in, not a source
  figure; the owner can replace it.
- A25 (new, round 3, adds scrutiny; scout E). Agent-owned consumers get their own scan: one composite index per grant
  branch ending in `journal_seq`, plus `(event_type, journal_seq)`; the grant written as per-branch ordered scans
  merged by `journal_seq`; the access verdict and `journal_ready` indexed or in a partial index; `excludeTypes`
  refused or rewritten as a positive list; globs served by a namespace column or a per-type merge, picked after C13
  measures. Legacy consumers keep `scanPage` as it is.
- A26 (new, round 3, adds scrutiny; scout G). C9's idempotency: for agent-bound keys, the trigger key is namespaced
  `agent:<agentId>:<key>` instead of instance, tenant or `global`; the send routes take an optional caller key for
  agent-bound keys, claimed before the provider call, released on failure, and a duplicate returns the first result
  with `duplicate: true`. A crash between the provider's acceptance and the record can still send twice, and the
  design states it.
- A27 (new, round 3, adds scrutiny; scout G). The C8 envelope never carries a provider `mediaUrl`. It carries the
  message id, the media type and a has-media marker. No read scope is added to the C4 profile by assumption; the
  bytes are O16.
- A28 (new, round 3, adds scrutiny; scouts E and H). C6's compiled consumer filter resolves fields exactly as the
  automation engine does, proven by a test that one declaration matches the same rows in both modes. Convergence
  updates the managed consumer in place by its deterministic name and never deletes and recreates it. A name held by
  a consumer the reconciler does not manage is refused and reported, never adopted. Switching back to subscriber after
  a switch away starts from now, and the gap is recorded and reported.
- A29 (new, round 3; scout H). "Resume from now" is a new forward-only seek to the journal head on agent-owned
  consumers, monotonic like ack, open to the owning agent's key and admin keys, with the skipped `journal_seq` range
  journaled as an event so the skip is never silent.
- A30 (new, round 3). The per-agent backlog limit defaults to 10,000 matching rows, about ten days at A24's rate,
  settable per agent. What happens past it is O15.
- A17 narrowed (round 3). The backlog limit does not bound two agents that ping-pong while keeping up, because they
  build no backlog; rate limits are the bound for that case.
- A24 becomes a question (round 4): O17. It stays the stand-in until the owner answers.
- A31 (new, round 4; follows R3-1, adds scrutiny). Switching an agent bound to an instance to subscriber mode is
  allowed, and never silent. The switch (manifest write or CLI) prints the cost: no turns, no turn context, no
  `POST /turns/close`, replies only by explicit send naming the target (C10), and a person waits the pull latency
  (p95 2 s) plus the agent's drain time. `omni agents graph` shows each agent's mode. The full list of
  dispatcher-only features the notice names comes from scout J, not from this DRAFT's memory.
- A32 (new, round 4; follows R3-2, adds scrutiny). `paired` joins the `agents.provider` enum at every Zod and OpenAPI
  site scout J lists. A `paired` agent has no `agentProviderId` and no endpoint, so it is subscriber-only: compiling
  its `accepts` to `call_agent`, or setting it to call mode, is refused with the reason. A dispatcher-served agent
  switched to subscriber mode under R3-1 keeps its own provider value.
- A33 (new, round 4; follows R3-3). Payload filters stay in JS; no jsonb index is added. R2-1's bound counts rows
  that fail the SQL clauses. C13 reports rows read but dropped by a payload filter as a separate count, so the cost
  of a broad SQL clause with a narrow filter stays visible.
- A34 (new, round 4; follows R3-4, adds scrutiny). Report only means: past the limit nothing pauses, skips or drops;
  `omni agents graph` marks the agent over its limit, and `doctor` warns with the consequence (the agent is N matching
  rows behind) and the fix ("resume from now", A29, or a higher per-agent limit). The backlog count is itself bounded:
  it counts matching rows up to the limit plus one over the per-branch indexes (A25), so the report never becomes the
  unbounded scan it reports on.
- A31 sharpened (round 4, scout J). The switch notice names scout J's list: the reply, access, echo, stale and
  broadcast guards; debounce and batching; typing, reaction and text acknowledgements; quoted context and reply
  quoting; splitting and pacing; turns, turn context and `POST /turns/close`; session handling; error replies to the
  person (a subscriber's failure is silent to them); the handoff and close-contact gates, the limiter, the response
  gate, supersede, wait-for-media, streaming and reaction triggers; and causation on replies. It does not name read
  receipts or TTS, which the dispatcher never did.
- A32 sharpened (round 4, scout J). `paired` is added at the eight enumerating sites scout J lists, the generated SDK
  types are regenerated, and the stale `docs/architecture/actor-model.md:94` is corrected. The dispatcher never reads
  `agents.provider`, so the refusals A32 names live at the manifest compile entry and the mode setter (a new check;
  the compiler reads no provider today), not in the dispatcher.
- A35 (new, round 4, adds scrutiny; scout J). A `paired` agent can never be bound. Setting `instances.agent_id` or an
  `agent_routes` row to a `paired` agent, and changing a bound agent's provider to `paired`, are refused with the
  reason. A bound provider-less agent would send the person an error reply on every inbound message
  (`agent-runner.ts:645-647` → `sendErrorFeedback`). `doctor` reports any existing row in that state.
- A36 (new, round 4, adds scrutiny; scout J). The dispatcher's access control does not run for a subscriber agent, so
  the consumer compiled for a subscriber's `message.received` carries the journal's access clause (allowed rows only,
  with `waitForReady`), and a sender the instance blocks never reaches the agent. The reply filter (DM, mention,
  reply-to-bot), the pairing request and the block message do not carry over; the switch notice names them (A31).
  This holds only if the access verdict is journaled for every inbound row, which the design verifies first.
- A37 (new, round 4; scout K). C9's self-drop is its own check in the agent-owned consumer's scan, keyed on the
  stamped `agent_id` (A13): a row the owning agent produced is not delivered to that agent's consumers by default. It
  does not reuse `#1148` (`senderInstanceId`, WhatsApp-only, inbound-only, engine-only) or `allowInstanceSenders`.
  The dispatcher's `#938` echo check stays as it is (C7).
- A17 sharpened (round 4, scout K). An external agent's verb send runs outside any ambient causality, so it is a
  causation root unless the send route accepts a caller-supplied cause, which was not checked. Depth therefore bounds
  chains of agent emissions through `/events/trigger`; chat ping-pong through sends is bounded by C9's self-drop and
  rate limits, not by depth.
- A38 (new, round 4, adds scrutiny; scout K). An agent emission past C9's depth bound is refused at journal time and
  dead-lettered through the existing writer as `causation_depth_exceeded`, the same path `publish_not_declared` takes:
  not journaled, never auto-retried, and refused by manual retry, because retry skips the gates and drops causation,
  so a retried row would restart at depth 0. The agent gets the refusal in the response. The number is O14.
- A27 sharpened (round 4, scout I). Adding `media:read` to C4 is not a workable option: a key with an active chat
  allowlist is refused on `GET /media` outright, and `POST /messages/media/download` refuses it as well. Any route to
  the bytes needs new code (O16).
- A39 (new, round 4; the fix shape for O19). When the last instance leaves an auto-provisioned agent key, the key is
  revoked rather than written as `null` (every instance) or `[]`, which `context.ts:142,195` and `connectors.ts:45`
  read as unrestricted. A regression test proves an unbind or a reassignment never widens the key. Whether a re-bind
  then provisions a fresh key depends on whether the provisioning lookup by name (`instances.ts:1403`) skips revoked
  keys; that was not read, and the fix verifies it rather than writing `instanceIds` onto a revoked row.
- A40 (new, round 5; follows R4-1). C7 is read narrowed by R4-1, as A10 reads C4 by R1-3: the C7 Scope IN text stays
  verbatim, and the one approved edit to `agent-dispatcher.ts` is the C17 mode check. It sits where the dispatcher
  resolves the agent (after `route.agentId ?? instance.agentId`) and covers the message, reaction and typing gates
  (`:5783`, `:5988`, `:6525-6528`). C7's regression proof then covers call-mode agents unchanged, plus a test that an
  agent in subscriber mode, bound to an instance or named by a route, gets no dispatcher call on any of the three
  paths and no error reply. Nothing else in the dispatcher changes.
- A41 (new, round 5; follows R4-3). C9's depth: Omni stamps each journaled event's depth from its stored parent; a
  row with no cause is depth 0, a child is its parent's depth plus 1. An agent emission at depth 5 is journaled; one
  at depth 6 is refused at journal time as `causation_depth_exceeded` (A38). The test drives a chain of six agent
  emissions and asserts five journaled rows, one dead-letter row and a refusal in the sixth response. How the parent's
  depth is read (a stamped column or a bounded walk) waits on scout M.
- A42 (new, round 5; follows R4-4, adds scrutiny). No media bytes in v1 means the C8 envelope carries no provider
  URL, no Omni media path and no presign, and C8's test on `message.received` asserts all three are absent. A
  conversational agent switched to subscriber mode under R3-1 loses media entirely, since the dispatcher handed its
  provider a presign or a local path (`agent-dispatcher.ts:1096-1109`), so the A31 switch notice names it.
  `omni agents graph` and `doctor` show media bytes as OFF for subscriber agents, with the reason ("v1 delivers no
  attachment bytes"), never silently.
- A43 (new, round 5; sharpens A2, pending scout L). The per-agent delivery mode is an `agents` column, not a manifest
  key, because the dispatcher reads it on every inbound message and a manifest read there would be a jsonb parse per
  message. A mode write evicts whatever the dispatcher caches for that agent, so no message is called after the
  switch commits. Scout L's facts on the dispatcher's caches and the debounce buffer decide whether that holds as
  written.
- A36 revised (round 5, scout M). As written it does not hold: the verdict it relies on is opt-in and off by default,
  NULL on several paths, and `'disabled'` on an open instance. How a subscriber agent keeps access parity is now O21.
  Until the owner answers, the design carries O21's recommended option.
- A39 sharpened (round 5, scout M and the lead's correction). `api_keys.name` is not unique and `findByName` has no
  status filter, so a revoked key keeps its name in every lookup. Every revoke of an auto-provisioned agent key
  (created by `system:auto-provision`, named `agent:<name>` or `agent:<tenantId>:<name>`) also renames it to
  `<name>:revoked:<keyId>`, freeing the name, and a later bind provisions a fresh key. No lookup changes, so the
  dispatcher's turn lookup (`agent-dispatcher.ts:2938`) behaves as today (C7). A status filter in `findByName` was
  considered and left out: it changes dispatcher behaviour outside C17. The fix covers the `[]` path as well as the
  empty-after-filter one (`instances.ts:1386-1390`). `doctor` reports, without changing anything, an agent key whose
  `instanceIds` name an instance not bound to its agent, a key whose agent no longer exists or no longer has its
  name (O22), and a revoked key that kept its name from before the fix. The regression tests: an unbind never widens
  a key, and a re-bind after a revoke gets a key that authenticates.
- A40 sharpened (round 5, scout L). The C17 check sits after route resolution, at the three `resolveEffectiveInstance`
  call sites (`:6307` on enqueue, `:5165` for reactions, `:6538` for typing), not at the instance-only gates (`:5783`,
  `:5988`, `:6530`), because a route can name a subscriber agent on an instance whose own agent is in call mode, and
  the reverse. The typing gate is `:6530`; this DRAFT cited `:6525-6528` before.
- A41 sharpened (round 5, scout M). There is no depth to reuse. A new nullable `causation_depth` smallint on
  `omni_events` (additive, behind slice 4's flag) is written at journal time for every row that carries a
  `causation_id`: one primary-key read of the parent, plus 1. A parent with no stamped depth (journaled before the
  column) is resolved by walking `causation_id` up at most six hops. The send routes carry no cause, so depth bounds
  `/events/trigger` chains and the engine's and the dispatcher's ambient chains; chat ping-pong through sends stays
  bounded by C9's self-drop and rate limits (A17).
- A43 revised (round 5, scout L). The mode is an `agents` column read in `applyAgentFkOverrides`' fresh select
  (`agent-dispatcher.ts:4990-5020`), which already runs on every message, so no cache needs evicting. It is never
  added to `providerCache` or the route LRU, and `PROVIDER_BAKED_AGENT_COLUMNS` stays as it is. The sentence "a mode
  write evicts whatever the dispatcher caches" is withdrawn; what decides double delivery is the buffer (A44).
- A44 (new, round 5; scout L, adds scrutiny). A mode switch is a cutover at one instant. The switch writes the mode
  and a `delivery_mode_since` instant on the `agents` row in one transaction. The C17 check compares each inbound
  event's own timestamp, the one the journal stores with the row, against that instant: earlier goes the old mode's
  way, at or after goes the new mode's. The compiled consumer for subscriber mode admits rows from the same instant on
  the same field. Both sides compare the same value of the same event, so each event goes exactly one way, whatever
  the clock skew between processes. A batch buffered before the switch passed the check under the old mode, so the
  dispatcher sends it and the consumer never delivers it; a run already started finishes. There is no check at flush:
  a drop there would lose messages that a consumer starting at the instant never sees, and it would be silent
  (`queuedAck?.remove()`, `:6165-6222`). Rows can be journaled out of timestamp order, so the consumer's first cursor
  sits a bounded window before the journal head at commit and applies the instant inside that window; the window's
  size is a design detail. On a switch back to call mode, rows the consumer had not delivered before the instant are
  skipped, and the skipped range is journaled and reported, as A29 does. The tests: messages straddling a switch
  arrive exactly once each, and a batch buffered across the commit is sent once, by the dispatcher.
- A24 confirmed (round 6; R5-2). The owner accepted A24 as C13's volume. It is a settled figure now, not a stand-in.
- A45 (new, round 6; follows R5-1). C5 gains one clause: `validateEmitEvent` refuses a core event type when the
  automation is managed by an agent, with the reason, and the dry-run returns the same refusal. An automation no agent
  manages emits core types as today. A refusal is a validation error at the action, which the engine already
  records; it is not a journal-time dead-letter like A38's, because nothing reaches the journal. The test: a managed
  row whose `emit_event` names `message.received` is refused live and in dry-run, and an unmanaged row naming it
  still emits. How the action knows its managing agent is a fact scout O reads; the refusal never takes the agent
  from the action's own config. The unmanaged case goes to its own issue, outside this design.
- A46 (new, round 6; follows R5-3, adds scrutiny). C18's refusal. The refused set is the list of event types the
  dispatcher turns into a run for an agent: `message.received`, plus the reaction types scout N confirms. The check
  refuses, with the reason and the fix (remove the entry, or switch the agent to subscriber mode):
  - a manifest apply that leaves a call-mode agent, bound to an instance or named by a route, accepting one of them;
  - a write to `instances.agent_id` or an `agent_routes` row that names a call-mode agent already accepting one;
  - a mode switch from subscriber to call while the agent is bound and accepts one, since that switch creates the
    overlap.

  The order of a switch to subscriber follows: the mode is written first, or with the manifest in one transaction, so
  the overlap never exists between the two writes. No deployed row is removed or disabled: `doctor` lists each
  existing overlap with the consequence (the agent runs twice per message, and the managed run also takes messages
  the dispatcher drops) and the fix. A refusal never stops a boot: if the reconciler runs at start-up, an
  overlapping manifest found there is left as it is and reported, never refused into a crash. Scout N confirms
  whether the reconciler runs at boot. The tests: each of the three writes is refused with the reason, an unbound
  call-mode agent may still accept `message.received` (O23 decides its access), and `doctor` lists a seeded overlap.
- A47 (new, round 6; follows R5-4, adds scrutiny). The access precondition reaches every subscriber consumer compiled
  for `message.received` or a reaction type, including a `paired` agent that is never bound (A35), not only a switched
  conversational agent. A NULL verdict is counted per agent and shown in `omni agents graph`. Rows journaled before
  the flag was on, including those inside A44's first-cursor window, are NULL, so they are counted and not delivered.
  If the flag is turned off after a switch, the consumer keeps pulling and every new row is NULL; nothing stops, but
  `doctor` is non-PASS for each subscriber agent in that state, with the consequence ("agent X receives no
  `message.received` or reactions while `OMNI_JOURNAL_ACCESS_DECISION` is off") and the enable path, in A34's
  report-only style. The test: with the flag off, the switch and the compile are refused; with it on, `allowed` and
  `disabled` rows are delivered, a `denied` row is not, and a NULL row is counted and not delivered.
- A45 sharpened (round 6, scout O). The check reads `context.automation.managedByAgentId`, which the engine copies
  from the row and `executeEmitEvent` already passes to `validateEmitEvent` as `emitterAgentId`; it never reads the
  action's config. No row reaches it today: the compiler writes only `call_agent` on managed rows, the CRUD refuses to
  create or edit one, and `/events/trigger` refuses every non-`custom.` type. The clause stays, as R5-1 answered, as a
  guard for any later compile that puts `emit_event` on a managed row. Its dry-run half is new code:
  `AutomationService.test` gains the same gate call for `emit_event` actions, fed the same context. Manual execute has
  no gate at all today and threads no managing agent; it stays as it is, since it is not a path R5-1 named, and the
  test covers the live engine path and the dry-run only.
- A46 sharpened (round 6, scout N). The refused set is exactly `message.received`, `reaction.received` and
  `reaction.removed`. The checks sit:
  - for manifest apply, in `AgentService.updateManifest` before the manifest `UPDATE`, so a refused manifest is never
    written and nothing depends on the reconciler's rollback, which was traced only inside a tenant scope;
  - for binds, in `InstanceService.create` and `.update` and `RouteService.create` and `.update`, so `POST` and
    `PATCH /instances`, the route endpoints, the CLI and the tRPC router (mounted or not) all pass through them; the
    two maintenance scripts never change a route's `agentId` and need no check;
  - for the mode switch from subscriber to call, in `AgentService.update`.

  The boot clause is retired: the reconciler runs only inside `PUT /agents/:id/manifest` and `DELETE /agents/:id`,
  never at start-up or on a timer, and delete compiles an empty manifest, which overlaps nothing. Two calls add
  scrutiny and are announced. The set is fixed rather than read from each instance's `triggerEvents`, so a manifest
  accepting `reaction.received` is refused for an agent bound to an instance that never dispatches reactions; reading
  the instance's list would make `triggerEvents` writes a fourth check site and depend on route overrides no scout
  read, and the fix offered is the same (remove the entry or switch to subscriber mode). And a route naming such an
  agent is refused even on an instance with no agent of its own, where the dispatcher would not run it yet, because a
  later bind of that instance would create the overlap through the route. No test covers the overlap today, so C18's
  tests are new.
- A47 sharpened (round 6, scout O). A consumer's access filter takes one value today, so admitting `allowed` and
  `disabled` is new code in the filter and its SQL clause. The verdict is frozen at ingest while the dispatcher checks
  live rules, so a row journaled before an owner blocks a sender is still delivered; the switch notice (A31) says so.
  A skeleton older than the settle window is delivered with a NULL verdict and the cursor passes it, so it is counted
  and not delivered even if its fill lands later. a2a and replay rows get a verdict like any other. No `doctor` code
  reads `OMNI_JOURNAL_ACCESS_DECISION` today, so A47's `doctor` line is new.
- A39 sharpened (round 6, scout O). Agent delete is soft, so `doctor`'s "a key whose agent no longer exists" reads "a
  key whose agent is inactive but still bound or routed": that agent still answers its chats. Until O22 is answered,
  `doctor` also lists a turn-based agent whose current name has no key, which does not answer.
- A39 sharpened (round 7; follows R6-2). The clause "until O22 is answered" becomes permanent, because the owner sent
  delete and rename to their own issue. `doctor` lists two states in C16's fix wish, each with the consequence and the
  fix:
  - an inactive agent still bound or routed, whose key stays active: it still answers its chats, and the fix is to
    unbind it or reactivate it;
  - a turn-based agent whose current name has no key: it drops its messages, and the fix is to re-bind it.

  Nothing is changed at runtime. These lines are C19's second and third parts.
- A48 (new, round 7; follows R6-1 and R6-2, adds scrutiny). The design names three follow-up issues so that none of
  them is lost:
  1. from R5-1: refuse core event types from `emit_event` in automations that no agent manages;
  2. from R6-1: an access check for a call-mode agent bound to no instance and named by no route whose manifest
     accepts `message.received` or a reaction type;
  3. from R6-2: agent delete leaves the agent live on its bindings and routes with an active key, and rename leaves
     the key under the old name.

  The lead files nothing. The design lists the three as follow-ups. C19's first part, the `doctor` line for unbound
  call-mode agents, ships with the slice that lands C18's `doctor` line, because both read the same
  manifest-against-binding join. Its consequence line: "agent X runs on `message.received` (or the reaction type) on
  every instance, including messages from senders the instance blocks". Its fix: remove the entry, or switch the
  agent to subscriber mode. Like every `doctor` line in this design, it makes `doctor` non-PASS without changing a
  row. Scout Q decides whether `doctor` can read this through an existing endpoint.
- A49 (new, round 7; scout P, adds scrutiny). Three paths outside the dispatcher read the agent's mode. Each
  changes only what happens to a subscriber-mode agent, so call mode is unchanged and C7 and C17's one dispatcher
  edit stand.
  - **The session cleaner.** The check sits in the shared `clearAgentSession` (`session-cleaner.ts:152`), so the
    trash-emoji path and `POST /chats/clear-session` both pass through it. When the agent that serves the chat is in
    subscriber mode, it skips the reset, the confirmation and the error reply. That agent is the route's, else the
    instance's: the check reads the route only to decide whether to skip. The trash-emoji path sends nothing, and the
    route returns the reason. The 🗑️ reaches the subscriber's consumer as an ordinary row, because Omni never runs
    a subscriber's provider and so has no session to reset. In call mode the cleaner still resets the instance
    default even in a routed chat, as today.
  - **Agent replay.** `onInstanceConnect` (`agent-replay.ts:120`) and the manual route
    (`routes/v2/instances.ts:4157-4210`) skip an instance whose agent is in subscriber mode, and the route returns the
    reason. The consumer reads the journal from its own cursor, so it already holds those rows, and a replay would
    journal them again under fresh event ids. A route-named subscriber on an instance whose own agent is in call mode
    can still get replayed rows. Its dedupe key is the message id the C8 envelope carries (A27), not the event id.
    The design verifies that a replayed row carries the original message id, and the switch notice says so.
  - **C17's test grows to match** (A40 sharpened, round 7). For a subscriber-mode agent, bound or routed, a 🗑️ causes
    no `resetSession`, no confirmation and no error reply. A reconnect replays nothing for its instance. A call-mode
    agent still gets today's reset, confirmation and replay.
- A40 sharpened (round 7, scout P). C17's "no error reply" covers the session cleaner's ❌ reply as well as the
  dispatcher's. The one approved edit to `agent-dispatcher.ts` is unchanged. A49's checks sit in other files.
- A31 sharpened (round 7, scout P). The switch notice adds:
  - the 🗑️ reset is gone, and a 🗑️ arrives as an ordinary message;
  - replay on reconnect is gone for the agent's instance, and a routed chat may see replayed rows under fresh event
    ids;
  - a blocking a2a caller waits up to 30 s unless the agent replies into the task chat;
  - handoff and close-contact set `agentPaused`, which the consumer does not read, so the agent must stop itself;
  - a `sentBy: 'agent'` send arms the instance's follow-up sequence as today;
  - messages scheduled before the switch still go out;
  - a turn opened before the switch is nudged and closed by the turn monitor.
- A50 (new, round 7; scout P, adds scrutiny; sharpens A44 and A46). Outside a tenant scope, which is the only world
  R2-2 allows paired agents, `updateManifest` autocommits each statement. Its bus publishes also fire before any
  commit. So "the mode is written first, or with the manifest in one transaction" (A46) is new code, and it does not
  rely on today's behaviour.
  - **One explicit transaction.** The mode switch, and every compile this design adds, runs in one transaction. It
    covers the mode and `delivery_mode_since` (A44), the manifest, the managed-row diff, and the consumer create or
    delete.
  - **Events after the commit.** `system.agent.manifest.updated` and `.compiled` are published after the commit.
  - **Why.** It closes a half-finished switch: a consumer inserted while the `call_agent` rows are still live delivers
    each event both ways.
  - **Plain manifest apply.** It goes through the same transaction, because it shares `reconcileAgent`. Today it can
    leave a partial plan. After this change it cannot, and nothing else about it changes.
  - **The test.** A failure is injected mid-diff. The old manifest, the old mode and the old rows remain, and no event
    is published.
- A51 (new, round 7; scout Q, adds scrutiny). `doctor`'s data path for the C18, C19, A34, A35, A39, A42 and A47 lines.
  - **One new authenticated read.** It needs both `agents:read` and `keys:read`, and returns one row per agent:
    - id, name, `isActive`, provider and mode (once mode exists);
    - its manifest `accepts` types;
    - the instances that bind it and the routes that name it;
    - its auto-provisioned key's id, name, status and `instanceIds`, matched under both name shapes, through an
      explicit projection that never returns `keyHash`.

    The response also carries the server's `OMNI_JOURNAL_ACCESS_DECISION`.
  - **Why not the CLI fan-out.** It would be one routes call per instance, and `GET /keys` stops at 100 with no
    cursor, so a key past 100 would be missed silently.
  - **Why not the posture object.** `auth/validate`'s posture is a three-field shape pinned by
    `public-surface-privacy.test.ts`, so it stays as it is.
  - **When it lands.** The endpoint lands with C16's fix wish, the first to ship a `doctor` line, and gains fields with
    each slice.
  - **Three check ids, each with its own deps seam:**
    - `agent-keys`, A39 and C19's second and third parts, with C16's fix;
    - `agent-delivery`, C18, C19's first part, A35 and O24's line if picked, with C18's slice;
    - `agent-subscribers`, A34, A42 and A47, with the subscriber slice.
  - **How each check reports.** A check is WARN when any agent is in a listed state, and names each agent with the
    consequence and the fix in `detail`.
  - **When the read fails.** The check is WARN with the reason. This deliberately differs from
    `listLockedInstances`' silent OK: a dark read is never green.
  - **WARN, not FAIL.** Only FAIL changes `doctor`'s exit code, and these states predate the design, so deployments
    that script `doctor` do not start failing.
  - **What each slice updates.** It updates `doctor.test.ts`'s pinned count and order, and the stale header and
    `--help` lists.
- A52 (new, round 8; follows R7-1, adds scrutiny). C6 is read by R7-1, and C20 has this shape.
  - **The reading.** C6's text stays. "No event reaches one agent both ways" is enforced for the compiler's managed
    rows (C6, A50) and for the dispatcher (C17, A49). A hand-written `call_agent` row that resolves to a
    subscriber-mode agent is reported and left running; it stops when the operator disables or edits it, or switches
    the agent back. `call_agent` is unchanged (C7).
  - **Which rows.** Enabled automations with `managed_by_agent_id` NULL and a `call_agent` action (chat or chatless)
    that resolves to a subscriber-mode agent:
    - the row names the agent in `config.agentId`; or
    - `config.agentId` is empty and an instance binds the agent (`instances.agent_id`), because an empty id resolves
      to the instance's agent and never to a route (`automation-actions.ts:409`).

    A disabled row is not listed: it runs nothing. When it is enabled again, the next `doctor` run lists it.
  - **The `doctor` line.** It joins the `agent-delivery` check (A51), where A51 reserved "O24's line if picked". The
    check stays a WARN, and it names each row by id and name, its trigger type and the agent it resolves to.
    - The consequence: "automation R runs agent X on T beside X's feed, so X receives T both ways", and, for a
      `paired` agent, "it has no provider, so every run fails and is logged as failed".
    - The fix: disable or edit R, or switch X back to call mode.
  - **The switch notice.** A31's notice, shown at a switch to subscriber mode, lists the same rows for the agent being
    switched, with the same consequence and fix. The switch is not refused (R3-1).
  - **No refusal at automation write.** Creating or editing a hand-written row that resolves to a subscriber-mode agent
    is not refused and gets no notice: R7-1's answer named `doctor` and the switch notice only.
  - **Tests.**
    - A stubbed-deps `doctor` test lists a row that names a subscriber agent by id and an empty-id row on that agent's
      instance. It stays silent for a managed row, a disabled row, and a row whose agent is in call mode.
    - A switch test asserts that the notice lists the agent's hand-written rows.
- A51 sharpened (round 8; follows R7-1). The one read also returns, server-side and without a limit, the hand-written
  rows A52 lists, each with its id, name, trigger type, `enabled` and the agent it resolves to. So it needs
  `automations:read` beside `agents:read` and `keys:read`. It filters on the `enabled` column itself, never through
  `GET /automations?enabled=`, whose coerce reads `'false'` as true. The field lands with the slice that adds the
  mode, because before it no agent is in subscriber mode.
- A31 sharpened (round 8; follows R7-1). The switch notice adds: each hand-written `call_agent` automation that
  resolves to this agent keeps running it beside its feed (and fails on every event for a `paired` agent) until it is
  disabled or edited (A52).
- A53 (new, round 11; the steer to fix 3's implementer, adds scrutiny). The owner never set a bind-time ownership
  proof (R4-2 is silent on it), so the implementer's proof stands, with these additions:
  - **Reuse.** A bind of instance I (tenant T, which may be none) extends the qualified key `agent:<T>:<name>` when
    T is set, or the bare `agent:<name>` when it is not. It extends a bare key for a tenant-owned I only when that key
    is active, created by `system:auto-provision`, has a non-empty `instanceIds`, and every listed instance exists and
    has tenant T. Otherwise it provisions or extends the qualified key. The rule is symmetric: an untenanted I never
    extends a bare key that lists a tenant's instance. The agent is matched by name, because `api_keys.agent_id`
    arrives with C3.
  - **NULL and `[]` keys** are never reused or extended under the proof. Their fate is O25, not this call.
  - **Unbind** removes I from whichever candidate key lists it (qualified, then bare) and revokes a key whose list
    becomes empty. C16's "every writer of the key's instanceIds" test covers a bind that extended a bare key followed
    by an unbind of that instance, and asserts the bare key no longer lists it.
  - **A bare key whose list spans two tenants** (grafted by the original bug) is never extended. `doctor`'s
    `agent-keys` line lists it, without changing it: the consequence is "one credential reaches instances of tenants
    A and B", and the fix is to revoke it and re-bind each instance.
- A39 sharpened (round 11; adds scrutiny). `doctor`'s `agent-keys` check (WARN) also lists each active
  auto-provisioned agent key whose `instanceIds` is `null` or `[]`. The consequence: "this key works on every
  instance". The fix: revoke it, then re-bind the agent's instances. It ships with fix 3 under either O25 answer;
  under O25's revoke option it lists only keys the upgrade could not revoke.
- A54 (new, round 11; follows R9-1). The design's gate for the GitLab connector becomes fixes 1 to 3 and slices 2 to 5
  and 7: slice 7's benchmark passes (p95 under 2 s from journal insert to delivery, matched rows only, at A24's
  volume) before the connector ships. Risk 12 closes. Slice 7 stays after slice 5 and still gates nothing else.
- A53 and A39 updated (round 12). In A53, "Their fate is O25" now reads R11-1 (A55). In A39's round-11 sharpening,
  "under O25's revoke option" is the case that holds: the `agent-keys` line lists only the widened keys the repair
  could not revoke.
- A55 (new, round 12; follows R11-1, the repair's shape).
  - **Which rows:** active keys with `createdBy = 'system:auto-provision'`, a name under either `agent:` shape, and
    `instanceIds` `null` or `[]`.
  - **What happens to each, in one transaction:**
    - the key is revoked and renamed to `<name>:revoked:<keyId>` (A39);
    - narrow keys are provisioned for the agent's instances, meaning every instance that binds the agent
      (`instances.agent_id`) and every instance where a route names it (`agent_routes`);
    - they are grouped by name under A53's rule: one qualified key per tenant, and one bare key for the untenanted
      instances. Each new key lists exactly its instances and gets the agent's `omniScopes` or `DEFAULT_TURN_SCOPES`,
      as provisioning does;
    - an agent with no such instance gets the revoke only.

    One transaction means the dispatcher never finds the agent without a key between the two writes.
  - **Why routes are included (lead call, announced):** at HEAD an untenanted dispatch takes the key by name whatever
    its list. A route-named agent that is bound nowhere was served by the widened key. Re-provisioning only for bound
    instances would silence it on single-owner deployments, which R11-2 keeps unchanged. Listing the routed
    instances keeps it answering, with a key still far narrower than every instance.
  - **Where it runs:** once, as an idempotent data repair at API start-up, after migrations. It is not a schema
    migration, because creating a key needs the service's key generation and hash. Because it is idempotent, a second
    run finds no row. A failure is logged and never stops the boot. `doctor`'s `agent-keys` line (A39) then lists
    each key the repair left, with the consequence and the revoke command.
  - **Hand-made keys** are outside this repair (A57).
  - **The tests:**
    - a widened key is revoked and renamed, and each bound or routed instance gets a narrow key that lists it;
    - dispatch on a bound instance opens the turn on the new key;
    - a second run changes nothing;
    - a key created with `null` by hand is left alone.
- A56 (new, round 12; follows R11-2).
  - **The reading.** C7 and C17 are read by R11-2, the way A40 reads C7 by R4-1, and their text stays verbatim.
    `agent-dispatcher.ts` gets two approved edits:
    - C17's mode check;
    - the key check, which applies only when `instance.tenantId` is set.

    On an untenanted instance the dispatcher keeps HEAD's name-only lookup, so PR #1462 keeps a name-only method for
    it beside `findAgentKeyByName`.
  - **The rename becomes required.** That name-only lookup has no status filter, so every revoke of an
    auto-provisioned key renames it (A39, DESIGN.md row 3). Otherwise a re-bind on an untenanted instance creates a
    fresh key while the dispatcher may still return the revoked row.
  - **`doctor`** (adds scrutiny). The `agent-keys` check (WARN) lists each tenant-owned instance where a turn-based
    agent that the instance binds, or that a route on it names, has no active auto-provisioned key listing that
    instance.
    - The consequence: "agent X drops its messages on instance I (logged 'scoped API key not found')".
    - The fix: re-bind instance I to X, which provisions the key.
  - **The tests:**
    - on a tenant instance whose only candidate is another tenant's bare key, the lookup finds nothing, logs it and
      returns false;
    - a tenant instance with a qualified key that lists it is served;
    - an untenanted instance whose key is hand-made, or does not list it, is served as at HEAD;
    - on an untenanted instance, unbind, revoke and re-bind, and dispatch opens the turn on the fresh key, never the
      renamed row;
    - `doctor` lists a seeded silenced tenant agent.
- A57 (new, round 12; adds scrutiny). PR #1462's reservation of the `agent:` prefix on `POST /keys` and `PATCH /keys`
  stands as announced scrutiny: a refusal at write, on the A11 and A14 precedent, that changes nothing approved.
  Renaming a key off the prefix stays allowed. Hand-made `agent:` keys that already exist are not revoked, because
  their secret is held by whoever made them, and their intent cannot be told from the bug's (round 12, checked by the
  lead).
  - **`doctor`.** The `agent-keys` check (WARN) lists each active key named under either `agent:` shape that was not
    created by `system:auto-provision`.
    - The consequence: on an untenanted instance the dispatcher's name lookup may open the agent's turns on it; on a
      tenant instance the agent is silenced (A56); and with `instanceIds` `null` or `[]` it works on every instance.
    - The fix: rename it off the prefix, or revoke it.
  - **The tests:**
    - `POST /keys` and a `PATCH /keys` rename to an `agent:` name are refused with the reason;
    - a rename off the prefix succeeds;
    - `doctor` lists a seeded hand-made `agent:` key, and stays silent for system keys.
- A55 to A57 updated (round 15; follow R13-1 and R13-2, and the merged fix 3 at `663f0a08f`).
  - **A55.** The repair merged as `packages/api/src/services/agent-key-reconciliation.ts`, and its test is
    `packages/api/src/services/__tests__/agent-key-reconciliation-postgres.test.ts`.
    - A revoke does not rename (R13-1).
    - It re-provisions for bound instances only, as R11-1's option text said. A55's routed instances move to A60.
    - "A failure is logged and never stops the boot" is not what merged; R13-2 makes it so through A59.
  - **A56.** R13-1 reopens R11-2, and A61 replaces the untenanted half.
    - "The rename becomes required" is retracted, because revoked keys are skipped.
    - The test "an untenanted instance whose key is hand-made … is served as at HEAD" is replaced in A61.
    - The tenant half and its `doctor` line stand.
  - **A57.** The reservation stands as merged (`packages/api/src/routes/v2/keys.ts`). The `doctor` consequence for a
    hand-made `agent:` key changes in A61.
- A58 (new, round 15; follows R13-3, the grants table).
  - **Shape.** A new table holds one row per agent, source kind and source id. The source kinds are:
    - `connector`: a `connectors` id;
    - `connector_subscription`: a `connector_event_subscriptions` id (#1468's `ingress` column says which kind);
    - `webhook_source`: a verified webhook source name;
    - `agent`: a producing Omni agent id.

    Each row also records the approving key, the approval time and a nullable revocation time, and is unique per
    agent, kind and id while active. It has a nullable `tenant_id`, stamped and registered in
    `packages/db/src/tenancy-rls.ts` the way fix 2's 0091 is, although the slices refuse to turn on under
    multitenancy.
  - **The one writer is pairing (C11).**
    - The pairing request carries the sources the agent's manifest declares.
    - The device page, the self-chat approval message and `omni approve` show each source beside the declared
      resources and verbs.
    - Approval mints the C3 key and writes the grants in one transaction.
    - To add or remove a source, the agent pairs again, and the new approval replaces the agent's grant set.
    - C3's per-agent revocation also revokes the agent's grants.
    - No HTTP route or CLI command writes the table directly, for any key, agent-bound keys included. Owner and
      admin keys may read it.
  - **The reader is C2.** An instance-less row reaches an agent-owned consumer only when an active grant of the
    consumer's agent matches the row's stamped source reference (row 5). That is one indexed join in the agent-owned
    scan.
  - **Placement.** The table and its read clause land in slice 2, and the only writer lands in slice 6. Until slice
    6, no production grant exists, so no instance-less row reaches any agent-owned consumer: it fails closed.
    Consequence, flagged to `gitlab-sdlc-connector`: GitLab rows reach a paired agent only after slice 6. R9-1's gate
    is unchanged.
  - **The tests:**
    - **Slice 2,** with a grant row seeded by the test:
      - a `connector.gitlab.*` row is delivered to the granted agent and refused to any other key (C2's proof);
      - a row from an ungranted source is not delivered;
      - revoking the grant stops delivery.
    - **Slice 6:**
      - a pairing approval naming connector `gitlab-brain` writes exactly that grant;
      - the paired agent's own key cannot create or change a grant through any route it can reach;
      - the owner's example: agent `reviewer`, paired to `gitlab-brain`, is never delivered `gitlab-billing` rows;
      - revoking the agent revokes its grants.
  - **`doctor`** (adds scrutiny). It lists each active grant whose source no longer exists, with the consequence
    ("this grant matches nothing") and the fix (pair the agent again).
- A59 (new, round 15; follows R13-2; fix 3 follow-up A, a separate Omni PR).
  - **What changes.** `packages/api/src/index.ts:1045-1047` stops letting a repair error stop the boot. The PR:
    - logs the error with its reason;
    - records a degraded reason that `packages/api/src/routes/health.ts` reports as `status: degraded`, the
      `arePluginsDegraded` pattern in `packages/api/src/plugin-state.ts`;
    - lets the boot go on.
  - **`doctor`.** The `agent-keys` check reports the failed repair.
    - The consequence: "widened agent keys the repair did not reach stay active on every instance".
    - The fix: correct the reported row and restart, or revoke the keys that `doctor`'s widened-key line lists.
  - **How it ships.** Unflagged and always on, like fixes 1 to 3. It is not a slice, and it is not added to R9-1's
    gate (A54 is unchanged).
  - **The tests:**
    - **In `packages/api/src/services/__tests__/`:** a repair that throws is logged and leaves start-up running, and
      a successful repair records no degraded reason.
    - **A health test beside `packages/api/src/__tests__/health-nats.test.ts`:** `/health` reports `degraded` with
      the reason.
    - **`packages/cli/src/__tests__/doctor.test.ts`:** `doctor` shows the line.
- A60 (new, round 15; fix 3 follow-up B, a separate Omni PR; keeps what DESIGN.md rows 3 and 3a already promised).
  - **The residue at `663f0a08f`.** Route writes provision no key, and the repair reads bindings only. So three
    kinds of agent are silenced, each logging "scoped API key not found":
    - (a) a tenant-owned instance I where a route names agent X and X's key does not list I. This is R11-2's named
      case.
    - (b) an untenanted agent named only by routes whose widened key the repair revoked. The repair warns once.
    - (c) an untenanted route-named agent that never had a system key.
  - **Follow-up B.**
    - A route create, and a route update whose agent is X, provisions or extends X's key with I under row 3's naming
      and reuse rule, on every instance:
      - on a tenant-owned I, the qualified key;
      - on an untenanted I, the bare key.

      This changes row 3's "on an untenanted instance a route create or update extends no key": under R13-1 the
      untenanted lookup needs an active system key, so the old reason no longer holds.
    - Removals stay as row 3 says.
    - The repair's binding set adds `agent_routes`, so agents silenced before follow-up B heal on the next boot.
  - **`doctor`.** Each silenced route-named agent is listed. Until follow-up B ships, the fix is to bind I to X,
    which also changes I's default agent. After it, the fix is `omni routes update R --agent X`.
  - **The tests:**
    - a route create on a tenant instance extends X's key with I, and X is served there;
    - an untenanted route-only agent gets a key on route create and is served;
    - the next boot's repair provisions a key for a routed instance whose widened key was revoked;
    - a route delete or retarget removes I and revokes an emptied key.
- A61 (new, round 15; follows R13-1).
  - **The reading.** C7 and C17 are read by R13-1, as A56 read them by R11-2. The untenanted lookup takes only
    active keys created by `system:auto-provision`, newest first. A hand-made `agent:<name>` key is never used for
    dispatch, and the agent stays silent until it is bound again, which provisions a system key (the owner's
    example: `omni instances update <id> --agent support`).
  - **`doctor`.** The `agent-keys` check lists each active hand-made `agent:` key.
    - The consequence: it is never used for dispatch, so its agent drops messages until re-bound; with
      `instanceIds` `null` or `[]` it still authenticates on every instance for whoever holds it.
    - The fix: re-bind the agent's instances, then rename the key off the prefix or revoke it.
  - **The tests:**
    - an untenanted instance whose only `agent:` key is hand-made is not served and logs the reason;
    - after a re-bind it is served on the new system key;
    - an untenanted system key that does not list the instance is still served, because the lookup has no membership
      check;
    - `doctor` lists the hand-made key.
- A62 (new, round 15; adds scrutiny, from #1470). Every two-tenant Postgres proof this design names asserts, before
  its first query, that its live role is neither a superuser nor `BYPASSRLS`. That covers fix 2's C15 tests, the
  repair's enforced start-up test, and any slice test that runs two tenant keys. A test that runs as a superuser
  proves nothing about tenant isolation, which is #1470's finding. The assertion uses #1470's shared helper once it
  merges. Until then, the test checks `pg_roles` itself.

## Round 1 dispatch

Four read-only worker scouts, three in omni at `ee5753234`, one in brain-v3. No council: the paired-agents council
already ran on this proposal, and no decision is contested yet. The scouts have reported (above); the round's
questions are O1, O2, O6 and O8.

## Round 2 dispatch

Four read-only worker scouts in omni at `ee5753234` (A: instance-less row provenance and prefix reservation; B:
emission and verb paths; C: secrets in `omni_events`; D: tenancy across keys, agents, consumers and automations). No
query-plan scout: there is no database here, and C13 measures it. No council: nothing is contested, and the allowance
of one stays unspent. The scouts have reported (above). The round's questions are O10, O9, O11 and O7. O11 displaced
O4 because it is a confirmed live exposure. O4, O5 and O12 wait for the next batch.

## Round 3 dispatch

Four read-only worker scouts in omni at `ee5753234`, code only (there is no database here):
- E: pull clause composition, `omni_events` indexes and whether filters can move into SQL, for R2-1 and O13;
- F: the busy-GitLab-project journal volume, from `.genie/brainstorms/gitlab-sdlc-connector/`, for C13;
- G: send and trigger idempotency, media access without a provider URL, and signed media URLs, for C8 and C9;
- H: the flag mechanism, multitenancy detection, cursor seek and backlog caps, and consumer naming on converge, for
  C14, A20, C13, O15 and C6.

No council: nothing is contested and hard to reverse, and the allowance of one stays unspent. The scouts have
reported (above). The round's questions are O4 and O5, which have waited since round 1, then O13 and O15, which block
C13's two tests. O14, O12 and the new O16 wait for the next batch.

## Round 4 dispatch

Three read-only worker scouts in omni at `ee5753234`, code only (there is no database here):
- I: media access for a paired agent, for O16;
- J: how the dispatcher picks the agent it calls, the dispatcher-only features a subscriber agent loses, and the
  `agents.provider` sites, for R3-1, R3-2 and the candidate O18;
- K: core-type emitters through `emit_event`, the dead-letter shape, depth references and the `#1148` sender guard,
  for O12 and O14.

No council: nothing is contested and hard to reverse; the C6 and C7 tension is a fact question first. The allowance
of one stays unspent. Questions are written after the scouts report: O12, O14, O16 and O17, with O18 taking a place
only if scout J confirms it.

The scouts have reported (above). Scout J confirmed O18 and found a live exposure, the agent key that widens to
every instance on unbind, which becomes O19; by the round-2 precedent a confirmed live exposure takes a place. The
round's questions are O18, O19, O14 and O16. O12 and O17 wait, with reasons under Open: O12 blocks no slice test, and
O17 has a working stand-in (A24). No council: the C6 and C7 tension is now an owner choice between two known costs,
not a contested reading, and the allowance of one stays unspent.

## Round 5 dispatch

Two read-only worker scouts in omni at `ee5753234`, code only (there is no database here):
- L: whether the automation engine fires a managed `call_agent` row for `message.received` beside the dispatcher,
  and what the dispatcher caches and buffers at a mode switch, for O20, C17, A40 and A43;
- M: the access verdict on every inbound row, a caller `causationId` on the send routes, the `causation_id` index and
  any depth column, and every writer of an agent key's `instanceIds`, for A36, A41, C16 and A39.

No council: R4-1 to R4-4 left nothing contested, and the allowance of one stays unspent. Questions are written after
the scouts report: O12 first, then O17, then O20 if scout L confirms it.

The scouts have reported (above). Scout L confirmed O20 from code. Scout M found that A36's access verdict is off by
default, which turns A36 into O21, and the lead corrected one of its claims (`api_keys.name` is not unique). The
round's questions are O12, O17, O20 and O21. O22 and O23 wait, with reasons under Open. No council: each question is
an owner choice between known costs, not a contested reading, and the allowance of one stays unspent.

## Round 6 dispatch

Two read-only worker scouts in omni at `ee5753234`, code only (there is no database here):
- N: every writer of `instances.agent_id` and `agent_routes` and every caller of the reconciler, whether it runs at
  boot or on a timer and what a refusal there does; the event types the dispatcher turns into an agent run; whether
  the automation engine can read an access verdict when it evaluates a call-mode row; any test covering the overlap.
  For C18, A46 and O23.
- O: how `emit_event` and its dry-run know the managing agent; the access verdict on a2a, agent-replay and reaction
  rows, how the server reads `OMNI_JOURNAL_ACCESS_DECISION`, and whether `waitForReady` holds a row until the fill;
  whether agent delete is hard or soft and how rename runs. For A45, A47 and O22.

No council: R5-1 to R5-4 left nothing contested, and O22 and O23 are owner choices between known costs once the
scouts give each its facts. The allowance of one stays unspent. Questions are written after the scouts report: O23
and O22, plus anything the scouts turn into an owner choice.

The scouts have reported (above). Scout N closed C18's type list and retired the boot risk; scout O found agent delete
soft, which corrects round 5 and makes O22 larger. The round's questions are O23 and O22, the last two open. Nothing
else the scouts found is the owner's alone: the two C18 calls that add scrutiny are announced in A46. No council: each
question is a choice between known costs, and the allowance of one stays unspent.

## Round 7 dispatch

Two read-only worker scouts in omni at `ee5753234`, code only (there is no database here):
- P (high effort): every path outside the dispatcher's three subscriptions that resolves an agent through
  `instances.agent_id` or `agent_routes` and then runs it, resets its session or sends on its behalf. The paths
  include the session cleaner, the follow-up hooks, the scheduler, agent replay, the a2a handler and any handoff
  path. For each path, P reports how it picks the agent, whether it reads the agent's mode or `is_active`, and what a
  subscriber-mode agent would experience. P also answers whether the tRPC router is mounted, and whether
  `updateManifest` runs in a database transaction outside a tenant scope. For C17, A31 and the candidate O24.
- Q (medium effort): how `omni doctor` gets its data. Q reports which endpoints the CLI reads, and whether any
  endpoint returns agents with their bindings, routes, manifest `accepts`, mode, `is_active` and key state, and the
  state of `OMNI_JOURNAL_ACCESS_DECISION`. For C18, C19, A35, A39 and A47.

No council: R6-1 and R6-2 left nothing contested, and the open gap is a fact question. The allowance of one stays
unspent. Questions are written after the scouts report: O24 only if scout P confirms a path that acts on a
subscriber-mode agent and closing it would change approved behaviour. Otherwise there are no questions, and round 8
can crystallize.

The scouts have reported (above). Scout P found two code paths outside the dispatcher that act on a resolved agent.
The session cleaner (with `clear-session`), together with agent replay's re-delivery, closes with a mode read in
files C7 does not name, announced in A49. Owner-written `call_agent` automations cannot be closed without touching C7,
R3-1 or C6's reading, so O24 is asked, alone. Scout Q found no endpoint that serves `doctor`'s agent lines; A51 adds
one. No council: O24 is a choice between known costs, and the allowance of one stays unspent. Round 8 crystallizes
after O24 is answered.

## Round 8 dispatch

No scouts and no council. R7-1 answered the last open decision, and the one fact C20 needed (how `doctor` tells a
hand-written row from a managed one, and whether the list is capped) the lead read directly. R7-1 left nothing
contested, and the council allowance of one stays unspent. WRS is 100 with nothing open or asked, so this round
crystallizes: the script has the design written and reviewed in this run.

## Round 11 dispatch

No scouts and no council. The facts O25 and O26 rest on were read directly by the lead (PR #1462's diff at
`8c73ff55d`, its body, and `instances.ts`, `api-keys.ts` and `agent-dispatcher.ts` at `ee5753234`). Neither decision
is contested enough to spend 0.7 to 1.3M tokens on a council: each is a choice between known costs, and the
allowance of one stays unspent. Two questions are asked. The steer the implementer requested is A53, a lead call that
adds scrutiny. WRS is 91, so this round does not crystallize; the design is rewritten after O25 and O26 are answered.

## Round 12 dispatch

No scouts and no council. R11-1 and R11-2 answered the last two open decisions. The lead read the facts their shapes
need directly: PR #1462's diff at `8c73ff55d` (keys, api-keys, dispatcher), and `instances.ts`, `turns.ts`,
`context.ts` and `agent-dispatcher.ts` at `ee5753234`, plus a search of omni and genie for flows that create
`agent:`-named keys. Nothing is contested, and the council allowance of one stays unspent. WRS is 100 with nothing
open or asked, so this round crystallizes. In this run, the design is rewritten with R9-1's gate (A54), C20, and fix
3's answers (A55 to A57), and then reviewed again against the round-8 FIX-FIRST findings.

## Round 15 dispatch

No scouts and no council. R13-1 to R13-3 answered everything round 14 asked. The lead read the merged baseline
directly at `origin/dev` `663f0a08f`:
- PRs #1462, #1465, #1468 and #1469 through `gh`;
- the dispatcher lookup, the start-up repair and its boot call, `routes.ts`, the health route, the `connector.*`
  checks and migrations 0090 and 0092 through `git show` and `git grep`;
- issues #1466 and #1470.

Nothing is contested, and the council allowance of one stays unspent. One gap surfaced: merged fix 3 provisions no key
for route-named instances. Keeping the reviewed design's promise as follow-up B (A60) changes nothing approved, so it
is announced, not asked. WRS is 100 with nothing open or asked, so this round crystallizes. In this run, DESIGN.md is
rewritten against `663f0a08f` under "Design consequences (round 15)" and reviewed again. The #1470 G6 exception the
workflow relayed is recorded in the gap map for the owner. A brainstorm round cannot grant it.

## Settled

- **R1-1** (round 2, decision): Scouts confirmed at HEAD ee5753234 that an instance-restricted key with events:write can pull any unscoped durable consumer and receive every instance's rows. Pull skips the caller's instance clause that SSE applies (event-consumers.ts:619-620 vs :744-745), and such a key can even create its own unscoped consumer. The fix shape is the council's first one (assumed A8): pull applies the caller's instance clause exactly as SSE does, plus a regression test. When does the C0 fix ship? — owner picked "Now, as its own fix (Recommended)"
- **R1-2** (round 2, decision): What target must the 40-consumer benchmark (C13) meet at one busy GitLab project's journal volume? Two numbers: p95 time from journal insert to delivery, and rows read per pull request (one long-poll request, as EXPLAIN ANALYZE reports it across its rescans). Facts: long-poll rescans every 500 ms for up to 30 s (about 60 scans per request), each page is capped at 500 rows, the type glob runs in SQL but payload filters run in JS after the page, there is no composite (event_type, journal_seq) index, 40 idle long-pollers run about 80 SELECT * scans per second, and SSE rescans every 1000 ms without a NATS wake (25 ms after one). No baseline was measured; the first benchmark run sets it. — owner picked "p95 2 s (Recommended)"
- **R1-3** (round 2, decision): Council C4 gives the paired-agent profile "consume, messages:send (bounded by chatAllowlist and outboundRecipientAllowlist) and the declared typed connector actions only". Today connector actions sit behind the coarse connectors:invoke scope, api_keys has no per-action grant column, and the only queued connector (GitLab v1) has no actions. Do typed per-key connector action grants ship in v1? — owner picked "Defer, omit invoke (Recommended)"
- **R1-4** (round 2, decision): The manifest validator accepts only core event types, custom.* and system.* (agent-manifest.ts:34-43). So the ae/1 kinds (agent.review.verdict, agent.gate.result, agent.status, agent.mr.merged, team.*) cannot be declared in accepts or publishes, and C5's publish gate needs them declared. The herdr coordinator puts schema ownership after v0.1.0, and ae/1 is not approved. Which namespace do agent-emitted event types use in v1? — owner picked "custom.agent.* (Recommended)"
- **R2-1** (round 3, decision): (O10) R1-2 set p95 2 s for the 40-consumer benchmark (C13) and left the second number open: how many journal rows may one pull request read, as EXPLAIN ANALYZE reports across all its rescans? Facts at ee5753234: pull is SELECT * paged on journal_seq with 500 rows per page and about 60 rescans per 30 s long-poll; the type glob runs in SQL but there is no composite (event_type, journal_seq) index, so an idle rescan walks the journal from the cursor and filters by type, while with that index an idle rescan is a single index probe. What rows-read bound must C13 meet? — owner picked "Matched rows only (Recommended)"
- **R2-2** (round 3, decision): (O9) Must agent pairing (C11) and the agent-bound key (C3) work on multitenant deployments in v1? Facts at ee5753234: device login is off whenever OMNI_MULTITENANCY_ENABLED=true because device approval mints tenantless legacy keys (login/config.ts:4-8); under multitenancy the only mint paths are a platform-issued tenant root key and a tenant child key through POST /keys; there is no invite flow; api_keys has no tenant column, tenant_key_lineage has no agent column, durable_consumers has no tenant_id, and managed call_agent rows are inserted with no tenant while the engine matches automations by event type alone. — owner picked "Single-owner only (Recommended)"
- **R2-3** (round 3, decision): (O11, adds a Scope IN item) Scout D found, and the lead confirmed at ee5753234, a live cross-tenant exposure: the durable-consumer routes are in TENANT_SCOPED_ROUTES (route-ownership.ts:671, :755-757, :908-910), a tenant key without an instanceIds constraint is projected with instanceIds null (middleware/tenancy.ts:100-111), canAccessConsumer allows any such caller (event-consumers.ts:349-355), and durable_consumers has no tenant_id. So a tenant key can list, inspect, ack and delete another tenant's consumers, and with OMNI_DB_ENFORCEMENT off can pull their rows too. When is it fixed? — owner picked "Now, as its own fix (Recommended)"
- **R2-4** (round 3, decision): (O7) How does an Omni agent relate to a permanent external id such as an automagik-herdr bot id (b- plus 10 base32, the ae/1 actor.bot)? Facts at ee5753234: no agents column fits (metadata jsonb is unindexed, name is not unique), so a unique id needs a migration; Omni can verify only its own agent id, which round 2's design stamps from the key into omni_events.agent_id; ae/1 is not approved and the herdr coordinator puts schema ownership after v0.1.0. — owner picked "Omni agent id only (Recommended)"
- **R3-1** (round 4, decision): (O4) May an agent that talks to people in a chat (one bound to an instance and served by the dispatcher today) be switched to subscriber mode in v1? Facts at ee5753234: call_agent stays the default (C6). A subscriber agent gets no turns, no turn context and no POST /turns/close, because those are dispatcher features (A18). Its replies are explicit sends after a pull, so a person waits for the pull latency (p95 2 s, R1-2) plus however long the agent takes to drain its feed. Once C6 lands, nothing in the code stops the switch. — owner picked "Allow, state the cost (Recommended)"
- **R3-2** (round 4, decision): (O5) What does agents.provider hold for a paired agent, which Omni never calls? Facts at ee5753234: the column is varchar(50), and its enum (claude, agno, openai, gemini, custom, omni-internal) is enforced only in Zod, at five sites (core/src/schemas/agent.ts:25, routes/v2/agents.ts:29 and three OpenAPI schemas). No code branches on agent.provider; the one read is a2a-discovery.ts:169. 'custom' has no special handling anywhere today. — owner picked "New member `paired` (Recommended)"
- **R3-3** (round 4, decision): (O13) R2-1 says one pull reads only matched rows. Does a row that passes a consumer's SQL clauses (type or glob, instance, access verdict, grant) but fails its payload filters count as matched? Facts at ee5753234 (scout E): filters run in JS after the page, on rawPayload; such a row is read once, delivered as nothing and skipped by the cursor jump, and it is never re-read. Consumer filters accept eleven operators (eq, ranges, contains, exists, regex and more), while a consumer compiled from a manifest accepts entry carries eq only. Only eq and exists map cleanly onto jsonb, there is no jsonb index, and a GIN index on raw_payload returns rows unordered by journal_seq. — owner picked "Count as matched (Recommended)"
- **R3-4** (round 4, decision): (O15) C13 asks for a per-agent backlog limit; the lead's default size is 10,000 matching rows (A30), settable per agent. What happens when an agent passes it? Facts at ee5753234 (scout H): durable consumers have no cap, pause, status column, seek or dead-letter store; cursors only move forward (acks refuse a cursor behind the stored one); 'from now' exists only at create; a deleted consumer's cursor is lost. Every option below needs new code. — owner picked "Report only (Recommended)"
- **R4-1** (round 5, decision): (O18) R3-1 lets an agent that is bound to an instance switch to subscriber mode. Scout J confirmed at ee5753234 that the dispatcher chooses whom to call through instances.agent_id, which agent_routes can override per chat or per user. It never reads managed call_agent rows (agent-dispatcher.ts:5783, :5098-5122). So a mode switch on its own leaves dispatcher delivery on, and the agent receives each message both ways, which C6 forbids. C7 currently reads: "agent-dispatcher.ts and call_agent behaviour unchanged under a regression proof". How does a switch to subscriber mode stop dispatcher delivery? — owner picked "Dispatcher mode check (Recommended)"
- **R4-2** (round 5, decision): (O19, a live exposure; it adds a Scope IN item if fixed ahead of or in this design) Scout J found, and the lead confirmed at ee5753234, the following. When an instance's agent is changed or cleared, PATCH /instances/:id removes the instance from the old agent's auto-provisioned key agent:<name>. When that list becomes empty, it writes instanceIds null (routes/v2/instances.ts:1389), and null means every instance (services/api-keys.ts:978-981, middleware/auth.ts:210). By default the key holds messages:send, turns:close, tts:synthesize and context:read (constants/scopes.ts:13). So unbinding or reassigning an agent's last instance turns a one-instance key into an all-instances key, today and independent of this design. The lead's fix shape (A39) revokes the key instead. An empty list is no substitute, because context.ts:142,195 and connectors.ts:45 read an empty list as unrestricted. The fix comes with a regression test. Whether a later re-bind provisions a fresh key is something the fix verifies. When is it fixed? — owner picked "Now, as its own fix (Recommended)"
- **R4-3** (round 5, decision): (O14) C9 bounds causation depth. Omni stamps each agent emission's depth from its stored parent (A17). Under the lead's call A38, an emission past the bound is refused at journal time and dead-lettered as causation_depth_exceeded: it is never journaled and never retried, because a retry skips the gates, drops causation and would restart the chain at depth 0. Scout K found one enforced chain bound in Omni: the internal channel's agent-to-agent hop cap of 5 (channel-internal/src/plugin.ts:18). trace's depth of 10 is a display cap only (services/events.ts:70-73), and the automation engine has no chain bound at all. What depth number does C9 enforce? — owner picked "5 emissions (Recommended)"
- **R4-4** (round 5, decision): (O16) How does a paired agent reach the bytes of an inbound attachment? The C8 envelope carries the message id, the media type and a has-media marker, never a provider URL (A27). Scout I found at ee5753234 that a key with an active chat allowlist, which R1-3's profile has, is refused outright on GET /media and also by POST /messages/media/download (middleware/scope-enforcer.ts:149-175). So adding media:read to C4 would reach nothing. Presigning exists only in remote mode, and OMNI_MEDIA_MODE unset means local. Without a tenant (the single-owner world of R2-2), a presign has no 60 s clamp and defaults to 3,600 s (services/media-storage.ts:517-522). Every option below except the first needs new code. — owner picked "No bytes in v1 (Recommended)"
- **R5-1** (round 6, decision): (O12, waiting since round 2) An automation's emit_event action, in an automation that no agent manages, can publish core event types such as message.received. C5 reserves connector.*, custom.webhook.* and custom.agent.*, but not core types. Facts at ee5753234 (scout K, round 4): no path, fixture, template, skill or document in the repository emits a core type through emit_event, so only deployed rows could break, and those cannot be listed without the database. A refusal belongs in validateEmitEvent only: inside EventRegistry.validate or publishGeneric it would break replay, dead-letter retry, WhatsApp and webhooks. The dry-run needs the same check. The manifest already allows a core type in publishes. Does refusing core types from emit_event become part of C5? — owner picked "Agent emitters only (Recommended)"
- **R5-2** (round 6, decision): (O17) C13's 40-consumer benchmark runs at 'one busy GitLab project's journal volume', and no source gives that volume (round 3, scout F). The lead's stand-in (A24) is 1,000 GitLab rows a day, rounded up from about 880 a day over a two-day launch. The journal holds 90 days of them (90,000 rows) inside 900,000 rows of other event families, and a live hour replays one day with one burst of 300 rows in one minute. C13's pass or fail against R1-2 (p95 2 s) and R2-1 (matched rows only) is measured at that volume. Which volume does C13 use? — owner picked "Accept A24 (Recommended)"
- **R5-3** (round 6, decision): (O20) Scout L confirmed from code at ee5753234, without a runtime reproduction, that the default call mode already delivers some messages twice. The automation engine picks automations only by event type, the enabledAt cutoff and the connector target (core/src/automations/engine.ts:495-510). A compiled managed row carries only the manifest entry's filter and the call_agent action, with no instance, agent or access condition (api/src/services/manifest-compiler.ts:133-148). call_agent runs the agent without checking the dispatcher (api/src/plugins/automation-actions.ts:386-458). So when an agent is bound to an instance and its manifest's accepts names message.received, it runs twice per message. The dispatcher's run replies to the chat. The managed row's run is a second billed provider run, plus whatever tools that run calls. The managed row also runs on messages the dispatcher drops, such as messages filtered as replies and messages from blocked senders, and on every instance. This is live today for any deployed agent in that state; deployed rows cannot be seen from here. C6 says 'no event reaches one agent both ways'. What does the design do about it? — owner picked "Refuse the overlap (Recommended)"
- **R5-4** (round 6, decision): (O21, from A36) The dispatcher's access control, which handles pairing requests and blocked senders, does not run for a subscriber agent. A36 therefore gave the consumer compiled for its message.received and reaction events the journal's access clause. Scout M found at ee5753234 that omni_events.access_decision is written only when OMNI_JOURNAL_ACCESS_DECISION=true. That setting is off by default (api/src/plugins/event-persistence.ts:157-164, .env.example:70), and rows written while it was off are never backfilled. The verdict is written when the persistence consumer fills the row and is recomputed if NATS redelivers it. It stays NULL when evaluation throws or the fill never lands. An instance without access control stores 'disabled', which matches neither the 'allowed' nor the 'denied' filter (event-persistence.ts:199; api/src/services/event-consumers.ts:391-426). A consumer's access filter is refused with 400 while the flag is off. R3-1 allowed a bound agent to switch to subscriber mode. How does a subscriber agent keep the instance's access rules? — owner picked "Require the journal flag (Recommended)"
- **R6-1** (round 7, decision): (O23) R5-3 refuses the overlap for a call-mode agent the dispatcher serves, so what remains is a call-mode agent bound to no instance and named by no route whose manifest accepts message.received, reaction.received or reaction.removed. Its compiled call_agent row runs on every such event on every instance, including messages from senders the instance blocks, because the row carries no access condition. That is today's behaviour, and C7 keeps call_agent unchanged. Scout N found at ee5753234 that the automation engine cannot read an access verdict: conditions are evaluated on the event on the bus, never on the omni_events row, and no access field is on the event (core/src/automations/engine.ts:892-896, conditions.ts:31-38). The persistence consumer that writes the verdict is an independent NATS consumer with no ordering against the engine, and writes it only with OMNI_JOURNAL_ACCESS_DECISION=true (api/src/plugins/event-persistence.ts:157-164, :210-244). call_agent never calls AccessService (api/src/plugins/automation-actions.ts:386-410). So any access check on these rows is new code. What does the design do about an unbound call-mode agent receiving messages from blocked senders? — owner picked "Own issue, doctor reports (Recommended)"
- **R6-2** (round 7, decision): (O22) Scout O found at ee5753234 that agent delete is a soft delete: DELETE /agents/:id and omni agents delete set agents.is_active=false and remove the agent's compiled automations, and nothing else (api/src/services/agents.ts:215-236). The ON DELETE SET NULL foreign keys on instances.agent_id and agent_routes.agent_id fire only on a hard delete, which no code issues, and the dispatcher's agent lookups never read is_active (agent-dispatcher.ts:2913-2921, :4995-5015, checked by the lead). So a deleted agent bound to an instance keeps answering its chats, and its auto-provisioned key stays active and in use. Round 5 said delete nulls the binding; that was wrong. Rename (PATCH /agents/:id) updates the name and evicts provider caches but leaves the key named agent:<old name>; a turn-based agent's dispatch looks its key up by the new name, logs 'scoped API key not found' and drops the message until a re-bind provisions a key (agent-dispatcher.ts:2933-2946). Neither widens a key, so neither is inside C16. Where are delete and rename fixed? — owner picked "Own issue, doctor reports (Recommended)"
- **R7-1** (round 8, decision): (O24) Scout P found at ee5753234 that an automation an operator writes by hand, which no agent manages, can still run an agent that has been switched to subscriber mode. Its call_agent action runs config.agentId, or the instance's own agent when that id is empty (api/src/plugins/automation-actions.ts:409, run through agentRunner.runOrStream at :449; core/src/automations/actions.ts:845-905). The chatless variant runs an agent named by id (:85-123). Neither reads a mode, which does not exist yet. C6 removes only the compiler's managed rows at a switch, and C18 refuses only compiled overlaps, so such a row already runs a call-mode agent beside the dispatcher today, and the design leaves that alone. After a switch under R3-1, the same row starts a provider run beside the consumer's delivery. On message.received the agent then gets the event both ways, which C6 says never happens. A paired agent named by id has no provider, so the run fails on every event. C7 keeps call_agent unchanged. What does the design do about owner-written call_agent automations that resolve to a subscriber-mode agent? — owner picked "Doctor and notice (Recommended)"
- **R8-1** (round 9, decision): Should the GitLab connector wait for the slice 7 benchmark? Round 1 read your words "The GitLab slice waits for the paired-agent slices" as slices 2 to 5, so the design lets GitLab ship on agent-owned consumers once slice 5 lands. Slice 7 is the 40-consumer benchmark at 1,000 GitLab rows a day. It proves your success item: p95 under 2 s from journal insert to delivery, with each pull reading only matching rows. The benchmark gates nothing today, so GitLab could be in use before anyone has measured the consumers it runs on. What must pass before the GitLab connector ships? — owner picked "GitLab ships first" · reopened by R9-1
- **R9-1** (round 10, decision): Correct R8-1? The mobile app sent the wrong answer, and you re-picked when the question was sent again. Recorded: "GitLab ships first" → new: Benchmark gates GitLab (Recommended): slice 7's benchmark (p95 under 2 s, matching rows only, at 1,000 GitLab rows a day) must pass before the GitLab connector ships. — owner picked "Benchmark gates GitLab (Recommended)" · reopens R8-1
- **R11-1** (round 12, decision): (O25, fix 3, PR #1462) Before fix 3, every time an agent's last instance was unbound or reassigned, its auto-provisioned key agent:<name> was rewritten with instanceIds null, which means every instance. That happened on deployed systems. PR #1462 stops new widenings. Its body says keys already widened are not found or revoked, and its implementer plans to leave them untouched. At ee5753234 no other code path creates such a key (active, created by system:auto-provision, instanceIds null or []), so each one comes from the bug or from a hand edit. Each still works on every instance with messages:send, turns:close, tts:synthesize and context:read. Before the fix, binding the agent again narrowed the key back to that one instance; leaving these keys untouched drops that repair. Whatever you answer, `doctor` will list any such key that remains, with the revoke command (A39, announced). What does fix 3 do with keys that are already widened? — owner picked "Revoke and re-provision (Recommended)"
- **R11-2** (round 12, decision): (O26, fix 3, PR #1462) PR #1462 also changes how the dispatcher finds a turn-based agent's key (agent-dispatcher.ts:2935-2946). It now takes only an active key created by system:auto-provision that lists the current instance; today it takes the first key with the name. The PR's reason is a leak that exists only with multitenancy on. For a tenant-owned instance, the lookup falls back to the bare name agent:<name>, which is shared across all tenants and may be another tenant's key, and dispatch then writes this chat's turn and chat context onto that key. What you approved says otherwise: C7 "agent-dispatcher.ts and call_agent behaviour unchanged under a regression proof" and C17 "the one approved edit to agent-dispatcher.ts is a per-agent mode check"; A39 left the lookup alone for that reason. Paired agents are single-owner only (R2-2), but fix 3 is always on. With the check, a turn-based agent stops answering (logged 'scoped API key not found') in four cases: its key was widened to null; a route names it on an instance its key does not list; its instance was created through POST /instances with an agent before the fix, which made no key; or an operator created its agent:<name> key by hand. How far does the dispatcher change go? — owner picked "Tenant instances only (Recommended)" · reopened by R13-1
- **R12-1** (round 13, review-findings): The design review returned FIX-FIRST after this run's repair (1 of 2 repairs used). Open findings: HIGH-1 (HIGH) Three Scope IN clauses the owner adopted have no success criterion or named proof. C9 (DRAFT.md:2963) has three clauses: the self-drop of the agent's own emissions, the depth bound, and idempotent actions under at-least-once delivery. The design proves only the depth bound. Row 8 describes the self-drop (keyed on the stamped agent_id) and the send idempotency key (first result returned with duplicate: true), and Risks 4 and 5 rely on both as mitigations, yet nothing tests either. C5 (DRAFT.md:2960) requires the producing key and agentId to be stamped on every journaled event and to be filterable. Row 5 says the stamp is taken 'from the key, never the body', and C2 grants and C9 self-drop both rely on it, yet no criterion proves that a body-supplied agentId is ignored, that producing_key_id is written, or that the stamp can be filtered on. An implementation could ship a spoofable provenance stamp, no self-drop or no send idempotency and still pass every listed criterion.. How should the next run go on? — owner picked "Repair again (Recommended)"
- **R13-1** (round 14, decision): Fix 3 merged (#1462, then #1469) slightly differently from your R11-2 answer. You picked "Tenant instances only (Recommended)", which said an instance with no tenant keeps today's lookup by name. The merged no-tenant lookup still uses the name and checks no instance list, but it now picks only ACTIVE keys created by the system (newest first). Effect: an agent:<name> key an operator made by hand before the fix (creating such names is now refused) is no longer used for dispatch, so that agent stops answering until it is bound again, which makes a fresh system key. Revoked keys are skipped too, so the design's 'rename on revoke' step is unnecessary. Example: you made agent:support by hand last year on a single-owner Omni; after upgrade, support stops replying until you re-run `omni instances update <id> --agent support`. Old → new: "Tenant instances only (Recommended)" → Tenant instances only, and the no-tenant lookup uses only active system keys, as merged. — owner picked "Accept as merged (Recommended)" · reopens R11-2
- **R13-2** (round 14, decision): The merged start-up key repair (#1462) stops Omni from starting if it hits any error. The design (row 3a, Risk 13) said: log the error and keep running. Example: one odd key row makes the repair throw; with the merged code, Omni refuses to boot after the upgrade and every channel is down until someone fixes the row by hand; with the design, Omni boots, the error is logged and doctor shows it, but any widened key the repair did not reach stays active, the same exposure as before the upgrade, not a new one. Which should Omni do? — owner picked "Log and keep running (Recommended)"
- **R13-3** (round 14, decision): The design lets a paired agent receive events that belong to no instance (a GitLab connector, a webhook source, another agent) only through an explicit per-source grant (C2). It never says where a grant is stored or who may create it. If the agent's own key can grant itself any source, the grant isolates nothing: an agent could subscribe itself to another team's GitLab connector in the same tenant. Example: agent 'reviewer' is paired to read connector gitlab-brain; without a rule, it could add gitlab-billing to its own consumer. Where do grants live and who writes them? — owner picked "Owner-approved grants table (Recommended)"

## Asked

_No open questions._

## Size

- **G** · raised by lead · round 1

## Scope ratchet

- C0: durable-consumer pull applies the caller's instance clause exactly as SSE does, with a regression test proving an instance-restricted key cannot pull another instance's rows · added by lead · round 1
- C1: agent-owned durable consumers (nullable agent_id; pull, ack, stream, inspect and delete allowed only to keys bound to that agent or admin/owner-tier keys; agent keys cannot create unowned consumers; agent-less legacy consumers unchanged) · added by lead · round 1
- C2: an explicit per-source grant lets an agent-owned consumer receive instance-less rows (a connector or connector subscription, a webhook source, or a producing agent), proven end to end: a connector.gitlab.* row is delivered to its owning agent and refused to any other key · added by lead · round 1
- C3: agent-bound child key (nullable api_keys.agent_id, parentKeyId lineage never wider than its parent, mandatory expiry, rotation, per-agent revocation, backfill of the name-matched dispatcher keys before any code depends on the FK; never an owner device grant) · added by lead · round 1
- C4: a consume-only scope for consumer pull, ack and stream, separate from events:write and POST /events/trigger, and a paired-agent key profile limited to consume, messages:send under chatAllowlist and outboundRecipientAllowlist, and declared typed actions · added by lead · round 1
- C5: emission guard and provenance (agent-key emissions checked against the manifest's publishes, refusals dead-lettered as publish_not_declared, the producing key and agentId stamped on every journaled event and filterable, custom.webhook.* reserved for verified sources and connector.* published only by connector ingress) · added by lead · round 1
- C6: accepts is the one way to say 'agent X subscribes to Y', and the existing reconciler compiles it to call_agent automations or agent-owned consumers according to a per-agent delivery mode. Recompiling is a no-op, a mode switch removes the other mode's managed rows, and no event reaches one agent both ways · added by lead · round 1
- C8: a fenced delivery envelope carrying ae/1 as a payload profile (untrusted inbound text only in a marked data field with provenance, no credentials or provider secrets), with a test on message.received · added by lead · round 1
- C9: loop guard (an agent-owned consumer drops the agent's own emissions by default, causation depth bounded, agent actions idempotent under at-least-once delivery) · added by lead · round 1
- C10: agent verbs acting on async deliveries name an explicit chat or instance target, or use a per-thread child key, never the key's mutable contextChatId · added by lead · round 1
- C11: pairing UX last, as `omni agents pair`: owner approval shows the declared resources and verbs, mints the narrow C3 key, and a registered agent client class means a new harness needs no per-framework code · added by lead · round 1
- C13: a 40-consumer benchmark at one busy GitLab project's journal volume, reporting pull latency and rows scanned per pull against a stated target, plus per-agent lag on matching rows in `omni agents graph`, a per-agent backlog limit and a 'resume from now' control · added by lead · round 1
- C7 and C12 proof obligations: agent-dispatcher.ts and call_agent behaviour unchanged under a regression proof, and no Brain-specific or harness-specific code path in Omni · added by lead · round 1
- C14: each slice ships behind its own default-off flag with an additive, idempotent migration and a single rollback · added by lead · round 1
- C15 (from R2-3): durable-consumer list, inspect, pull, ack, stream and delete never cross tenants, with a regression test proving a tenant key cannot reach another tenant's consumer; it ships now as its own fix ahead of this design, and every slice keeps that test green · added by lead · round 3
- C16 (from R4-2): unbinding or reassigning an agent's last instance never widens its auto-provisioned agent key to every instance (the key is revoked, never written as null or an empty list), with a regression test covering every writer of the key's instanceIds; it ships now as its own fix ahead of this design, and every slice keeps that test green · added by lead · round 5
- C17 (from R4-1): the one approved edit to agent-dispatcher.ts is a per-agent mode check where the dispatcher resolves the agent, covering the message, reaction and typing gates; C7's regression proof covers call-mode agents unchanged, plus a test that an agent in subscriber mode, bound to an instance or named by a route, gets no dispatcher call on any path and no error reply · added by lead · round 5
- C18 (from R5-3): a call-mode agent served by the dispatcher (bound to an instance or named by a route) may not accept an event type the dispatcher already turns into a run for it; the overlap is refused with the reason at manifest apply, at every write of instances.agent_id or agent_routes, and at a switch from subscriber to call mode, never at run time and never by stopping a boot, and `doctor` lists existing overlaps with the consequence and the fix · added by lead · round 6
- C19 (from R6-1 and R6-2): `doctor` reports, without changing any row, each call-mode agent bound to no instance and named by no route whose manifest accepts message.received, reaction.received or reaction.removed (it runs on every instance, blocked senders included), each inactive agent still bound or routed (it still answers its chats and its key stays active), and each turn-based agent whose current name has no key (it drops its messages), each with the consequence and the fix; the fixes themselves go to their own issues outside this design · added by lead · round 7
- C20 (from R7-1): `doctor` and the switch notice list, without changing any row, each enabled hand-written `call_agent` automation (no managing agent) that resolves to a subscriber-mode agent, by `config.agentId` or, when that id is empty, by the instance's own agent, with the consequence and the fix; no automation write is refused and `call_agent` is unchanged · added by lead · round 11

## Councils

_None convened._

## Ledger

```ledger
{
  "settled": [
    {
      "id": "R1-1",
      "kind": "decision",
      "question": "Scouts confirmed at HEAD ee5753234 that an instance-restricted key with events:write can pull any unscoped durable consumer and receive every instance's rows. Pull skips the caller's instance clause that SSE applies (event-consumers.ts:619-620 vs :744-745), and such a key can even create its own unscoped consumer. The fix shape is the council's first one (assumed A8): pull applies the caller's instance clause exactly as SSE does, plus a regression test. When does the C0 fix ship?",
      "answer": "Now, as its own fix (Recommended)",
      "value": "fix-now",
      "provenance": "owner picked \"Now, as its own fix (Recommended)\"",
      "round": 2
    },
    {
      "id": "R1-2",
      "kind": "decision",
      "question": "What target must the 40-consumer benchmark (C13) meet at one busy GitLab project's journal volume? Two numbers: p95 time from journal insert to delivery, and rows read per pull request (one long-poll request, as EXPLAIN ANALYZE reports it across its rescans). Facts: long-poll rescans every 500 ms for up to 30 s (about 60 scans per request), each page is capped at 500 rows, the type glob runs in SQL but payload filters run in JS after the page, there is no composite (event_type, journal_seq) index, 40 idle long-pollers run about 80 SELECT * scans per second, and SSE rescans every 1000 ms without a NATS wake (25 ms after one). No baseline was measured; the first benchmark run sets it.",
      "answer": "p95 2 s (Recommended)",
      "value": "p95-2s",
      "provenance": "owner picked \"p95 2 s (Recommended)\"",
      "round": 2
    },
    {
      "id": "R1-3",
      "kind": "decision",
      "question": "Council C4 gives the paired-agent profile \"consume, messages:send (bounded by chatAllowlist and outboundRecipientAllowlist) and the declared typed connector actions only\". Today connector actions sit behind the coarse connectors:invoke scope, api_keys has no per-action grant column, and the only queued connector (GitLab v1) has no actions. Do typed per-key connector action grants ship in v1?",
      "answer": "Defer, omit invoke (Recommended)",
      "value": "defer",
      "provenance": "owner picked \"Defer, omit invoke (Recommended)\"",
      "round": 2
    },
    {
      "id": "R1-4",
      "kind": "decision",
      "question": "The manifest validator accepts only core event types, custom.* and system.* (agent-manifest.ts:34-43). So the ae/1 kinds (agent.review.verdict, agent.gate.result, agent.status, agent.mr.merged, team.*) cannot be declared in accepts or publishes, and C5's publish gate needs them declared. The herdr coordinator puts schema ownership after v0.1.0, and ae/1 is not approved. Which namespace do agent-emitted event types use in v1?",
      "answer": "custom.agent.* (Recommended)",
      "value": "custom-agent",
      "provenance": "owner picked \"custom.agent.* (Recommended)\"",
      "round": 2
    },
    {
      "id": "R2-1",
      "kind": "decision",
      "question": "(O10) R1-2 set p95 2 s for the 40-consumer benchmark (C13) and left the second number open: how many journal rows may one pull request read, as EXPLAIN ANALYZE reports across all its rescans? Facts at ee5753234: pull is SELECT * paged on journal_seq with 500 rows per page and about 60 rescans per 30 s long-poll; the type glob runs in SQL but there is no composite (event_type, journal_seq) index, so an idle rescan walks the journal from the cursor and filters by type, while with that index an idle rescan is a single index probe. What rows-read bound must C13 meet?",
      "answer": "Matched rows only (Recommended)",
      "value": "matched-only",
      "provenance": "owner picked \"Matched rows only (Recommended)\"",
      "round": 3
    },
    {
      "id": "R2-2",
      "kind": "decision",
      "question": "(O9) Must agent pairing (C11) and the agent-bound key (C3) work on multitenant deployments in v1? Facts at ee5753234: device login is off whenever OMNI_MULTITENANCY_ENABLED=true because device approval mints tenantless legacy keys (login/config.ts:4-8); under multitenancy the only mint paths are a platform-issued tenant root key and a tenant child key through POST /keys; there is no invite flow; api_keys has no tenant column, tenant_key_lineage has no agent column, durable_consumers has no tenant_id, and managed call_agent rows are inserted with no tenant while the engine matches automations by event type alone.",
      "answer": "Single-owner only (Recommended)",
      "value": "single-owner",
      "provenance": "owner picked \"Single-owner only (Recommended)\"",
      "round": 3
    },
    {
      "id": "R2-3",
      "kind": "decision",
      "question": "(O11, adds a Scope IN item) Scout D found, and the lead confirmed at ee5753234, a live cross-tenant exposure: the durable-consumer routes are in TENANT_SCOPED_ROUTES (route-ownership.ts:671, :755-757, :908-910), a tenant key without an instanceIds constraint is projected with instanceIds null (middleware/tenancy.ts:100-111), canAccessConsumer allows any such caller (event-consumers.ts:349-355), and durable_consumers has no tenant_id. So a tenant key can list, inspect, ack and delete another tenant's consumers, and with OMNI_DB_ENFORCEMENT off can pull their rows too. When is it fixed?",
      "answer": "Now, as its own fix (Recommended)",
      "value": "fix-now",
      "provenance": "owner picked \"Now, as its own fix (Recommended)\"",
      "round": 3
    },
    {
      "id": "R2-4",
      "kind": "decision",
      "question": "(O7) How does an Omni agent relate to a permanent external id such as an automagik-herdr bot id (b- plus 10 base32, the ae/1 actor.bot)? Facts at ee5753234: no agents column fits (metadata jsonb is unindexed, name is not unique), so a unique id needs a migration; Omni can verify only its own agent id, which round 2's design stamps from the key into omni_events.agent_id; ae/1 is not approved and the herdr coordinator puts schema ownership after v0.1.0.",
      "answer": "Omni agent id only (Recommended)",
      "value": "omni-id",
      "provenance": "owner picked \"Omni agent id only (Recommended)\"",
      "round": 3
    },
    {
      "id": "R3-1",
      "kind": "decision",
      "question": "(O4) May an agent that talks to people in a chat (one bound to an instance and served by the dispatcher today) be switched to subscriber mode in v1? Facts at ee5753234: call_agent stays the default (C6). A subscriber agent gets no turns, no turn context and no POST /turns/close, because those are dispatcher features (A18). Its replies are explicit sends after a pull, so a person waits for the pull latency (p95 2 s, R1-2) plus however long the agent takes to drain its feed. Once C6 lands, nothing in the code stops the switch.",
      "answer": "Allow, state the cost (Recommended)",
      "value": "allow-with-notice",
      "provenance": "owner picked \"Allow, state the cost (Recommended)\"",
      "round": 4
    },
    {
      "id": "R3-2",
      "kind": "decision",
      "question": "(O5) What does agents.provider hold for a paired agent, which Omni never calls? Facts at ee5753234: the column is varchar(50), and its enum (claude, agno, openai, gemini, custom, omni-internal) is enforced only in Zod, at five sites (core/src/schemas/agent.ts:25, routes/v2/agents.ts:29 and three OpenAPI schemas). No code branches on agent.provider; the one read is a2a-discovery.ts:169. 'custom' has no special handling anywhere today.",
      "answer": "New member `paired` (Recommended)",
      "value": "new-member",
      "provenance": "owner picked \"New member `paired` (Recommended)\"",
      "round": 4
    },
    {
      "id": "R3-3",
      "kind": "decision",
      "question": "(O13) R2-1 says one pull reads only matched rows. Does a row that passes a consumer's SQL clauses (type or glob, instance, access verdict, grant) but fails its payload filters count as matched? Facts at ee5753234 (scout E): filters run in JS after the page, on rawPayload; such a row is read once, delivered as nothing and skipped by the cursor jump, and it is never re-read. Consumer filters accept eleven operators (eq, ranges, contains, exists, regex and more), while a consumer compiled from a manifest accepts entry carries eq only. Only eq and exists map cleanly onto jsonb, there is no jsonb index, and a GIN index on raw_payload returns rows unordered by journal_seq.",
      "answer": "Count as matched (Recommended)",
      "value": "filters-matched",
      "provenance": "owner picked \"Count as matched (Recommended)\"",
      "round": 4
    },
    {
      "id": "R3-4",
      "kind": "decision",
      "question": "(O15) C13 asks for a per-agent backlog limit; the lead's default size is 10,000 matching rows (A30), settable per agent. What happens when an agent passes it? Facts at ee5753234 (scout H): durable consumers have no cap, pause, status column, seek or dead-letter store; cursors only move forward (acks refuse a cursor behind the stored one); 'from now' exists only at create; a deleted consumer's cursor is lost. Every option below needs new code.",
      "answer": "Report only (Recommended)",
      "value": "report-only",
      "provenance": "owner picked \"Report only (Recommended)\"",
      "round": 4
    },
    {
      "id": "R4-1",
      "kind": "decision",
      "question": "(O18) R3-1 lets an agent that is bound to an instance switch to subscriber mode. Scout J confirmed at ee5753234 that the dispatcher chooses whom to call through instances.agent_id, which agent_routes can override per chat or per user. It never reads managed call_agent rows (agent-dispatcher.ts:5783, :5098-5122). So a mode switch on its own leaves dispatcher delivery on, and the agent receives each message both ways, which C6 forbids. C7 currently reads: \"agent-dispatcher.ts and call_agent behaviour unchanged under a regression proof\". How does a switch to subscriber mode stop dispatcher delivery?",
      "answer": "Dispatcher mode check (Recommended)",
      "value": "mode-check",
      "provenance": "owner picked \"Dispatcher mode check (Recommended)\"",
      "round": 5
    },
    {
      "id": "R4-2",
      "kind": "decision",
      "question": "(O19, a live exposure; it adds a Scope IN item if fixed ahead of or in this design) Scout J found, and the lead confirmed at ee5753234, the following. When an instance's agent is changed or cleared, PATCH /instances/:id removes the instance from the old agent's auto-provisioned key agent:<name>. When that list becomes empty, it writes instanceIds null (routes/v2/instances.ts:1389), and null means every instance (services/api-keys.ts:978-981, middleware/auth.ts:210). By default the key holds messages:send, turns:close, tts:synthesize and context:read (constants/scopes.ts:13). So unbinding or reassigning an agent's last instance turns a one-instance key into an all-instances key, today and independent of this design. The lead's fix shape (A39) revokes the key instead. An empty list is no substitute, because context.ts:142,195 and connectors.ts:45 read an empty list as unrestricted. The fix comes with a regression test. Whether a later re-bind provisions a fresh key is something the fix verifies. When is it fixed?",
      "answer": "Now, as its own fix (Recommended)",
      "value": "now-own-fix",
      "provenance": "owner picked \"Now, as its own fix (Recommended)\"",
      "round": 5
    },
    {
      "id": "R4-3",
      "kind": "decision",
      "question": "(O14) C9 bounds causation depth. Omni stamps each agent emission's depth from its stored parent (A17). Under the lead's call A38, an emission past the bound is refused at journal time and dead-lettered as causation_depth_exceeded: it is never journaled and never retried, because a retry skips the gates, drops causation and would restart the chain at depth 0. Scout K found one enforced chain bound in Omni: the internal channel's agent-to-agent hop cap of 5 (channel-internal/src/plugin.ts:18). trace's depth of 10 is a display cap only (services/events.ts:70-73), and the automation engine has no chain bound at all. What depth number does C9 enforce?",
      "answer": "5 emissions (Recommended)",
      "value": "depth-5",
      "provenance": "owner picked \"5 emissions (Recommended)\"",
      "round": 5
    },
    {
      "id": "R4-4",
      "kind": "decision",
      "question": "(O16) How does a paired agent reach the bytes of an inbound attachment? The C8 envelope carries the message id, the media type and a has-media marker, never a provider URL (A27). Scout I found at ee5753234 that a key with an active chat allowlist, which R1-3's profile has, is refused outright on GET /media and also by POST /messages/media/download (middleware/scope-enforcer.ts:149-175). So adding media:read to C4 would reach nothing. Presigning exists only in remote mode, and OMNI_MEDIA_MODE unset means local. Without a tenant (the single-owner world of R2-2), a presign has no 60 s clamp and defaults to 3,600 s (services/media-storage.ts:517-522). Every option below except the first needs new code.",
      "answer": "No bytes in v1 (Recommended)",
      "value": "no-bytes",
      "provenance": "owner picked \"No bytes in v1 (Recommended)\"",
      "round": 5
    },
    {
      "id": "R5-1",
      "kind": "decision",
      "question": "(O12, waiting since round 2) An automation's emit_event action, in an automation that no agent manages, can publish core event types such as message.received. C5 reserves connector.*, custom.webhook.* and custom.agent.*, but not core types. Facts at ee5753234 (scout K, round 4): no path, fixture, template, skill or document in the repository emits a core type through emit_event, so only deployed rows could break, and those cannot be listed without the database. A refusal belongs in validateEmitEvent only: inside EventRegistry.validate or publishGeneric it would break replay, dead-letter retry, WhatsApp and webhooks. The dry-run needs the same check. The manifest already allows a core type in publishes. Does refusing core types from emit_event become part of C5?",
      "answer": "Agent emitters only (Recommended)",
      "value": "agent-only",
      "provenance": "owner picked \"Agent emitters only (Recommended)\"",
      "round": 6
    },
    {
      "id": "R5-2",
      "kind": "decision",
      "question": "(O17) C13's 40-consumer benchmark runs at 'one busy GitLab project's journal volume', and no source gives that volume (round 3, scout F). The lead's stand-in (A24) is 1,000 GitLab rows a day, rounded up from about 880 a day over a two-day launch. The journal holds 90 days of them (90,000 rows) inside 900,000 rows of other event families, and a live hour replays one day with one burst of 300 rows in one minute. C13's pass or fail against R1-2 (p95 2 s) and R2-1 (matched rows only) is measured at that volume. Which volume does C13 use?",
      "answer": "Accept A24 (Recommended)",
      "value": "accept-a24",
      "provenance": "owner picked \"Accept A24 (Recommended)\"",
      "round": 6
    },
    {
      "id": "R5-3",
      "kind": "decision",
      "question": "(O20) Scout L confirmed from code at ee5753234, without a runtime reproduction, that the default call mode already delivers some messages twice. The automation engine picks automations only by event type, the enabledAt cutoff and the connector target (core/src/automations/engine.ts:495-510). A compiled managed row carries only the manifest entry's filter and the call_agent action, with no instance, agent or access condition (api/src/services/manifest-compiler.ts:133-148). call_agent runs the agent without checking the dispatcher (api/src/plugins/automation-actions.ts:386-458). So when an agent is bound to an instance and its manifest's accepts names message.received, it runs twice per message. The dispatcher's run replies to the chat. The managed row's run is a second billed provider run, plus whatever tools that run calls. The managed row also runs on messages the dispatcher drops, such as messages filtered as replies and messages from blocked senders, and on every instance. This is live today for any deployed agent in that state; deployed rows cannot be seen from here. C6 says 'no event reaches one agent both ways'. What does the design do about it?",
      "answer": "Refuse the overlap (Recommended)",
      "value": "refuse-overlap",
      "provenance": "owner picked \"Refuse the overlap (Recommended)\"",
      "round": 6
    },
    {
      "id": "R5-4",
      "kind": "decision",
      "question": "(O21, from A36) The dispatcher's access control, which handles pairing requests and blocked senders, does not run for a subscriber agent. A36 therefore gave the consumer compiled for its message.received and reaction events the journal's access clause. Scout M found at ee5753234 that omni_events.access_decision is written only when OMNI_JOURNAL_ACCESS_DECISION=true. That setting is off by default (api/src/plugins/event-persistence.ts:157-164, .env.example:70), and rows written while it was off are never backfilled. The verdict is written when the persistence consumer fills the row and is recomputed if NATS redelivers it. It stays NULL when evaluation throws or the fill never lands. An instance without access control stores 'disabled', which matches neither the 'allowed' nor the 'denied' filter (event-persistence.ts:199; api/src/services/event-consumers.ts:391-426). A consumer's access filter is refused with 400 while the flag is off. R3-1 allowed a bound agent to switch to subscriber mode. How does a subscriber agent keep the instance's access rules?",
      "answer": "Require the journal flag (Recommended)",
      "value": "require-flag",
      "provenance": "owner picked \"Require the journal flag (Recommended)\"",
      "round": 6
    },
    {
      "id": "R6-1",
      "kind": "decision",
      "question": "(O23) R5-3 refuses the overlap for a call-mode agent the dispatcher serves, so what remains is a call-mode agent bound to no instance and named by no route whose manifest accepts message.received, reaction.received or reaction.removed. Its compiled call_agent row runs on every such event on every instance, including messages from senders the instance blocks, because the row carries no access condition. That is today's behaviour, and C7 keeps call_agent unchanged. Scout N found at ee5753234 that the automation engine cannot read an access verdict: conditions are evaluated on the event on the bus, never on the omni_events row, and no access field is on the event (core/src/automations/engine.ts:892-896, conditions.ts:31-38). The persistence consumer that writes the verdict is an independent NATS consumer with no ordering against the engine, and writes it only with OMNI_JOURNAL_ACCESS_DECISION=true (api/src/plugins/event-persistence.ts:157-164, :210-244). call_agent never calls AccessService (api/src/plugins/automation-actions.ts:386-410). So any access check on these rows is new code. What does the design do about an unbound call-mode agent receiving messages from blocked senders?",
      "answer": "Own issue, doctor reports (Recommended)",
      "value": "own-issue",
      "provenance": "owner picked \"Own issue, doctor reports (Recommended)\"",
      "round": 7
    },
    {
      "id": "R6-2",
      "kind": "decision",
      "question": "(O22) Scout O found at ee5753234 that agent delete is a soft delete: DELETE /agents/:id and omni agents delete set agents.is_active=false and remove the agent's compiled automations, and nothing else (api/src/services/agents.ts:215-236). The ON DELETE SET NULL foreign keys on instances.agent_id and agent_routes.agent_id fire only on a hard delete, which no code issues, and the dispatcher's agent lookups never read is_active (agent-dispatcher.ts:2913-2921, :4995-5015, checked by the lead). So a deleted agent bound to an instance keeps answering its chats, and its auto-provisioned key stays active and in use. Round 5 said delete nulls the binding; that was wrong. Rename (PATCH /agents/:id) updates the name and evicts provider caches but leaves the key named agent:<old name>; a turn-based agent's dispatch looks its key up by the new name, logs 'scoped API key not found' and drops the message until a re-bind provisions a key (agent-dispatcher.ts:2933-2946). Neither widens a key, so neither is inside C16. Where are delete and rename fixed?",
      "answer": "Own issue, doctor reports (Recommended)",
      "value": "own-issue",
      "provenance": "owner picked \"Own issue, doctor reports (Recommended)\"",
      "round": 7
    },
    {
      "id": "R7-1",
      "kind": "decision",
      "question": "(O24) Scout P found at ee5753234 that an automation an operator writes by hand, which no agent manages, can still run an agent that has been switched to subscriber mode. Its call_agent action runs config.agentId, or the instance's own agent when that id is empty (api/src/plugins/automation-actions.ts:409, run through agentRunner.runOrStream at :449; core/src/automations/actions.ts:845-905). The chatless variant runs an agent named by id (:85-123). Neither reads a mode, which does not exist yet. C6 removes only the compiler's managed rows at a switch, and C18 refuses only compiled overlaps, so such a row already runs a call-mode agent beside the dispatcher today, and the design leaves that alone. After a switch under R3-1, the same row starts a provider run beside the consumer's delivery. On message.received the agent then gets the event both ways, which C6 says never happens. A paired agent named by id has no provider, so the run fails on every event. C7 keeps call_agent unchanged. What does the design do about owner-written call_agent automations that resolve to a subscriber-mode agent?",
      "answer": "Doctor and notice (Recommended)",
      "value": "doctor-notice",
      "provenance": "owner picked \"Doctor and notice (Recommended)\"",
      "round": 8
    },
    {
      "id": "R8-1",
      "kind": "decision",
      "question": "Should the GitLab connector wait for the slice 7 benchmark? Round 1 read your words \"The GitLab slice waits for the paired-agent slices\" as slices 2 to 5, so the design lets GitLab ship on agent-owned consumers once slice 5 lands. Slice 7 is the 40-consumer benchmark at 1,000 GitLab rows a day. It proves your success item: p95 under 2 s from journal insert to delivery, with each pull reading only matching rows. The benchmark gates nothing today, so GitLab could be in use before anyone has measured the consumers it runs on. What must pass before the GitLab connector ships?",
      "answer": "GitLab ships first",
      "value": "accept-ship-before-c13",
      "provenance": "owner picked \"GitLab ships first\"",
      "round": 9,
      "reopenedBy": "R9-1"
    },
    {
      "id": "R9-1",
      "kind": "decision",
      "question": "Correct R8-1? The mobile app sent the wrong answer, and you re-picked when the question was sent again. Recorded: \"GitLab ships first\" → new: Benchmark gates GitLab (Recommended): slice 7's benchmark (p95 under 2 s, matching rows only, at 1,000 GitLab rows a day) must pass before the GitLab connector ships.",
      "answer": "Benchmark gates GitLab (Recommended)",
      "value": "benchmark-gates-gitlab",
      "provenance": "owner picked \"Benchmark gates GitLab (Recommended)\"",
      "round": 10,
      "reopens": "R8-1"
    },
    {
      "id": "R11-1",
      "kind": "decision",
      "question": "(O25, fix 3, PR #1462) Before fix 3, every time an agent's last instance was unbound or reassigned, its auto-provisioned key agent:<name> was rewritten with instanceIds null, which means every instance. That happened on deployed systems. PR #1462 stops new widenings. Its body says keys already widened are not found or revoked, and its implementer plans to leave them untouched. At ee5753234 no other code path creates such a key (active, created by system:auto-provision, instanceIds null or []), so each one comes from the bug or from a hand edit. Each still works on every instance with messages:send, turns:close, tts:synthesize and context:read. Before the fix, binding the agent again narrowed the key back to that one instance; leaving these keys untouched drops that repair. Whatever you answer, `doctor` will list any such key that remains, with the revoke command (A39, announced). What does fix 3 do with keys that are already widened?",
      "answer": "Revoke and re-provision (Recommended)",
      "value": "revoke-reprovision",
      "provenance": "owner picked \"Revoke and re-provision (Recommended)\"",
      "round": 12
    },
    {
      "id": "R11-2",
      "kind": "decision",
      "question": "(O26, fix 3, PR #1462) PR #1462 also changes how the dispatcher finds a turn-based agent's key (agent-dispatcher.ts:2935-2946). It now takes only an active key created by system:auto-provision that lists the current instance; today it takes the first key with the name. The PR's reason is a leak that exists only with multitenancy on. For a tenant-owned instance, the lookup falls back to the bare name agent:<name>, which is shared across all tenants and may be another tenant's key, and dispatch then writes this chat's turn and chat context onto that key. What you approved says otherwise: C7 \"agent-dispatcher.ts and call_agent behaviour unchanged under a regression proof\" and C17 \"the one approved edit to agent-dispatcher.ts is a per-agent mode check\"; A39 left the lookup alone for that reason. Paired agents are single-owner only (R2-2), but fix 3 is always on. With the check, a turn-based agent stops answering (logged 'scoped API key not found') in four cases: its key was widened to null; a route names it on an instance its key does not list; its instance was created through POST /instances with an agent before the fix, which made no key; or an operator created its agent:<name> key by hand. How far does the dispatcher change go?",
      "answer": "Tenant instances only (Recommended)",
      "value": "tenant-only",
      "provenance": "owner picked \"Tenant instances only (Recommended)\"",
      "round": 12,
      "reopenedBy": "R13-1"
    },
    {
      "id": "R12-1",
      "kind": "review-findings",
      "question": "The design review returned FIX-FIRST after this run's repair (1 of 2 repairs used). Open findings: HIGH-1 (HIGH) Three Scope IN clauses the owner adopted have no success criterion or named proof. C9 (DRAFT.md:2963) has three clauses: the self-drop of the agent's own emissions, the depth bound, and idempotent actions under at-least-once delivery. The design proves only the depth bound. Row 8 describes the self-drop (keyed on the stamped agent_id) and the send idempotency key (first result returned with duplicate: true), and Risks 4 and 5 rely on both as mitigations, yet nothing tests either. C5 (DRAFT.md:2960) requires the producing key and agentId to be stamped on every journaled event and to be filterable. Row 5 says the stamp is taken 'from the key, never the body', and C2 grants and C9 self-drop both rely on it, yet no criterion proves that a body-supplied agentId is ignored, that producing_key_id is written, or that the stamp can be filtered on. An implementation could ship a spoofable provenance stamp, no self-drop or no send idempotency and still pass every listed criterion.. How should the next run go on?",
      "answer": "Repair again (Recommended)",
      "value": "repair",
      "provenance": "owner picked \"Repair again (Recommended)\"",
      "round": 13
    },
    {
      "id": "R13-1",
      "kind": "decision",
      "question": "Fix 3 merged (#1462, then #1469) slightly differently from your R11-2 answer. You picked \"Tenant instances only (Recommended)\", which said an instance with no tenant keeps today's lookup by name. The merged no-tenant lookup still uses the name and checks no instance list, but it now picks only ACTIVE keys created by the system (newest first). Effect: an agent:<name> key an operator made by hand before the fix (creating such names is now refused) is no longer used for dispatch, so that agent stops answering until it is bound again, which makes a fresh system key. Revoked keys are skipped too, so the design's 'rename on revoke' step is unnecessary. Example: you made agent:support by hand last year on a single-owner Omni; after upgrade, support stops replying until you re-run `omni instances update <id> --agent support`. Old → new: \"Tenant instances only (Recommended)\" → Tenant instances only, and the no-tenant lookup uses only active system keys, as merged.",
      "answer": "Accept as merged (Recommended)",
      "value": "accept-merged",
      "provenance": "owner picked \"Accept as merged (Recommended)\"",
      "round": 14,
      "reopens": "R11-2"
    },
    {
      "id": "R13-2",
      "kind": "decision",
      "question": "The merged start-up key repair (#1462) stops Omni from starting if it hits any error. The design (row 3a, Risk 13) said: log the error and keep running. Example: one odd key row makes the repair throw; with the merged code, Omni refuses to boot after the upgrade and every channel is down until someone fixes the row by hand; with the design, Omni boots, the error is logged and doctor shows it, but any widened key the repair did not reach stays active, the same exposure as before the upgrade, not a new one. Which should Omni do?",
      "answer": "Log and keep running (Recommended)",
      "value": "log-continue",
      "provenance": "owner picked \"Log and keep running (Recommended)\"",
      "round": 14
    },
    {
      "id": "R13-3",
      "kind": "decision",
      "question": "The design lets a paired agent receive events that belong to no instance (a GitLab connector, a webhook source, another agent) only through an explicit per-source grant (C2). It never says where a grant is stored or who may create it. If the agent's own key can grant itself any source, the grant isolates nothing: an agent could subscribe itself to another team's GitLab connector in the same tenant. Example: agent 'reviewer' is paired to read connector gitlab-brain; without a rule, it could add gitlab-billing to its own consumer. Where do grants live and who writes them?",
      "answer": "Owner-approved grants table (Recommended)",
      "value": "grants-table-owner",
      "provenance": "owner picked \"Owner-approved grants table (Recommended)\"",
      "round": 14
    }
  ],
  "asked": [],
  "size": [
    {
      "value": "G",
      "by": "lead",
      "round": 1
    }
  ],
  "scopeIn": [
    {
      "item": "C0: durable-consumer pull applies the caller's instance clause exactly as SSE does, with a regression test proving an instance-restricted key cannot pull another instance's rows",
      "by": "lead",
      "round": 1
    },
    {
      "item": "C1: agent-owned durable consumers (nullable agent_id; pull, ack, stream, inspect and delete allowed only to keys bound to that agent or admin/owner-tier keys; agent keys cannot create unowned consumers; agent-less legacy consumers unchanged)",
      "by": "lead",
      "round": 1
    },
    {
      "item": "C2: an explicit per-source grant lets an agent-owned consumer receive instance-less rows (a connector or connector subscription, a webhook source, or a producing agent), proven end to end: a connector.gitlab.* row is delivered to its owning agent and refused to any other key",
      "by": "lead",
      "round": 1
    },
    {
      "item": "C3: agent-bound child key (nullable api_keys.agent_id, parentKeyId lineage never wider than its parent, mandatory expiry, rotation, per-agent revocation, backfill of the name-matched dispatcher keys before any code depends on the FK; never an owner device grant)",
      "by": "lead",
      "round": 1
    },
    {
      "item": "C4: a consume-only scope for consumer pull, ack and stream, separate from events:write and POST /events/trigger, and a paired-agent key profile limited to consume, messages:send under chatAllowlist and outboundRecipientAllowlist, and declared typed actions",
      "by": "lead",
      "round": 1
    },
    {
      "item": "C5: emission guard and provenance (agent-key emissions checked against the manifest's publishes, refusals dead-lettered as publish_not_declared, the producing key and agentId stamped on every journaled event and filterable, custom.webhook.* reserved for verified sources and connector.* published only by connector ingress)",
      "by": "lead",
      "round": 1
    },
    {
      "item": "C6: accepts is the one way to say 'agent X subscribes to Y', and the existing reconciler compiles it to call_agent automations or agent-owned consumers according to a per-agent delivery mode. Recompiling is a no-op, a mode switch removes the other mode's managed rows, and no event reaches one agent both ways",
      "by": "lead",
      "round": 1
    },
    {
      "item": "C8: a fenced delivery envelope carrying ae/1 as a payload profile (untrusted inbound text only in a marked data field with provenance, no credentials or provider secrets), with a test on message.received",
      "by": "lead",
      "round": 1
    },
    {
      "item": "C9: loop guard (an agent-owned consumer drops the agent's own emissions by default, causation depth bounded, agent actions idempotent under at-least-once delivery)",
      "by": "lead",
      "round": 1
    },
    {
      "item": "C10: agent verbs acting on async deliveries name an explicit chat or instance target, or use a per-thread child key, never the key's mutable contextChatId",
      "by": "lead",
      "round": 1
    },
    {
      "item": "C11: pairing UX last, as `omni agents pair`: owner approval shows the declared resources and verbs, mints the narrow C3 key, and a registered agent client class means a new harness needs no per-framework code",
      "by": "lead",
      "round": 1
    },
    {
      "item": "C13: a 40-consumer benchmark at one busy GitLab project's journal volume, reporting pull latency and rows scanned per pull against a stated target, plus per-agent lag on matching rows in `omni agents graph`, a per-agent backlog limit and a 'resume from now' control",
      "by": "lead",
      "round": 1
    },
    {
      "item": "C7 and C12 proof obligations: agent-dispatcher.ts and call_agent behaviour unchanged under a regression proof, and no Brain-specific or harness-specific code path in Omni",
      "by": "lead",
      "round": 1
    },
    {
      "item": "C14: each slice ships behind its own default-off flag with an additive, idempotent migration and a single rollback",
      "by": "lead",
      "round": 1
    },
    {
      "item": "C15 (from R2-3): durable-consumer list, inspect, pull, ack, stream and delete never cross tenants, with a regression test proving a tenant key cannot reach another tenant's consumer; it ships now as its own fix ahead of this design, and every slice keeps that test green",
      "by": "lead",
      "round": 3
    },
    {
      "item": "C16 (from R4-2): unbinding or reassigning an agent's last instance never widens its auto-provisioned agent key to every instance (the key is revoked, never written as null or an empty list), with a regression test covering every writer of the key's instanceIds; it ships now as its own fix ahead of this design, and every slice keeps that test green",
      "by": "lead",
      "round": 5
    },
    {
      "item": "C17 (from R4-1): the one approved edit to agent-dispatcher.ts is a per-agent mode check where the dispatcher resolves the agent, covering the message, reaction and typing gates; C7's regression proof covers call-mode agents unchanged, plus a test that an agent in subscriber mode, bound to an instance or named by a route, gets no dispatcher call on any path and no error reply",
      "by": "lead",
      "round": 5
    },
    {
      "item": "C18 (from R5-3): a call-mode agent served by the dispatcher (bound to an instance or named by a route) may not accept an event type the dispatcher already turns into a run for it; the overlap is refused with the reason at manifest apply, at every write of instances.agent_id or agent_routes, and at a switch from subscriber to call mode, never at run time and never by stopping a boot, and `doctor` lists existing overlaps with the consequence and the fix",
      "by": "lead",
      "round": 6
    },
    {
      "item": "C19 (from R6-1 and R6-2): `doctor` reports, without changing any row, each call-mode agent bound to no instance and named by no route whose manifest accepts message.received, reaction.received or reaction.removed (it runs on every instance, blocked senders included), each inactive agent still bound or routed (it still answers its chats and its key stays active), and each turn-based agent whose current name has no key (it drops its messages), each with the consequence and the fix; the fixes themselves go to their own issues outside this design",
      "by": "lead",
      "round": 7
    },
    {
      "item": "C20 (from R7-1): `doctor` and the switch notice list, without changing any row, each enabled hand-written `call_agent` automation (no managing agent) that resolves to a subscriber-mode agent, by `config.agentId` or, when that id is empty, by the instance's own agent, with the consequence and the fix; no automation write is refused and `call_agent` is unchanged",
      "by": "lead",
      "round": 11
    }
  ],
  "councils": [],
  "reviews": [
    {
      "verdict": "FIX-FIRST",
      "digest": "7a68d8528802d07c4ff997275530d5249641ecb326d37c34889a82b11e4d99b5",
      "round": 8,
      "repaired": false,
      "findings": [
        "C1",
        "C2",
        "C3",
        "C4",
        "C5",
        "C6",
        "C7",
        "C8",
        "C9",
        "HIGH-1",
        "HIGH-2",
        "MEDIUM-1",
        "MEDIUM-2",
        "MEDIUM-3"
      ]
    },
    {
      "verdict": "FIX-FIRST",
      "digest": "4d48c0ca678b08c11c27a8f9ba9bf8e882391578aeab0491d13cca3da0c8c7f0",
      "round": 12,
      "repaired": false,
      "findings": [
        "C1",
        "C2",
        "C3",
        "C4",
        "C5",
        "C6",
        "C7",
        "C8",
        "C9",
        "C10",
        "C11",
        "C12",
        "HIGH-1",
        "MEDIUM-1",
        "MEDIUM-2",
        "MEDIUM-3",
        "MEDIUM-4",
        "LOW-1",
        "LOW-2"
      ]
    },
    {
      "verdict": "FIX-FIRST",
      "digest": "59b09d5ad089c01facdfa55f24fd988ebf4069ec65c3b772ee256c666a9650ac",
      "round": 12,
      "repaired": true,
      "findings": [
        "C1",
        "C2",
        "C3",
        "C4",
        "C5",
        "C6",
        "C7",
        "C8",
        "C9",
        "C10",
        "HIGH-1",
        "MEDIUM-1",
        "MEDIUM-2",
        "LOW-1"
      ]
    },
    {
      "verdict": "FIX-FIRST",
      "digest": "d5eecc797e612f2b5e047cf52f73c0e07a9674ac4c6fe9c14d16b73a1e7d00a8",
      "round": 13,
      "repaired": true,
      "findings": [
        "C1",
        "C2",
        "C3",
        "C4",
        "C5",
        "C6",
        "C7",
        "C8",
        "C9",
        "C10",
        "C11",
        "HIGH-1",
        "HIGH-2",
        "MEDIUM-1",
        "LOW-1"
      ]
    },
    {
      "verdict": "SHIP",
      "digest": "e17098ff1a1967bd10525a7969455203ce9eae9e8257ec555c53f042da41f4cc",
      "round": 15,
      "repaired": false,
      "findings": [
        "C1",
        "C2",
        "C3",
        "C4",
        "C5",
        "C6",
        "C7",
        "C8",
        "C9",
        "C10",
        "C11",
        "C12",
        "C13",
        "C14",
        "MEDIUM-1",
        "MEDIUM-2",
        "MEDIUM-3",
        "MEDIUM-4",
        "MEDIUM-5",
        "LOW-1",
        "LOW-2"
      ]
    }
  ]
}
```
