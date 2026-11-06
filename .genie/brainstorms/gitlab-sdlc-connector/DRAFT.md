# DRAFT: gitlab-sdlc-connector

## What the owner said versus what is assumed (round 1, after scouts)

**The owner said** (the request, verbatim in substance; none of it is Settled yet):

- Build a `gitlab` connector on `packages/connector-sdk`, modeled on `packages/connector-clickup`.
- Events, by lifecycle phase: plan (issues), code (push, merge_request opened), review (notes on MRs),
  CI (pipeline and job failures), integrate (merge_request merged), release (tag_push, release, deployment).
- Typed actions: `add_mr_note`, `set_labels`, `retry_pipeline`, `create_issue`. No merge and no approve
  action: merging stays behind a code merge gate.
- The GitLab token stays sealed in Omni; agents never see it.
- Delivery: a small dispatcher on the owner's Mac (no inbound port) pulls `connector.event` from
  <internal-host> through a durable event consumer (pull/ack) and runs `hc send <terminal>` to the owning
  squad captain. The dispatcher holds the author allowlist and passes comment text as quoted untrusted data.
- Known limits: a subscription has one eventKey, one target automation and one URL, while GitLab multiplexes
  every selected category on one hook URL; filters are exact-match only.
- Target: GitLab 19.5.1 CE, project `khal/brain`, 0 webhooks today. Omni server and CLI 2.261030.9.
- A parallel council is assessing how Omni should change so one specific agent can subscribe to the events it
  cares about; its outcome may reshape the dispatcher.
- Success: reports captains relay by hand today versus events delivered automatically.

**Assumed by round 1, and what the scouts found** (verdicts are evidence, not decisions):

- A1. **Verified (repo).** `connector.event` reaches a durable pull/ack consumer and can be narrowed to one
  connector or one event kind. The journal row's `rawPayload` is the full published payload, with `connectorId`,
  `subscriptionId`, `eventKey`, `provider`, `providerEventId` at top level and the parsed GitLab `data` spread
  beside them (`packages/api/src/services/connectors.ts:974-1008`, payload built at `:180-211`). Consumer filters
  run `evaluateConditions` over that `rawPayload` (`packages/api/src/services/event-consumers.ts:266-271`) with
  eq/neq/contains/regex/exists operators, ANDed, up to 20 (`packages/api/src/schemas/openapi/event-consumers.ts:17-27,78-158`);
  `eventType` matches `connector.event` exactly. Scopes: `events:write` to create, pull and ack
  (`packages/api/src/constants/scopes.ts:200-205`). Consequence: one durable consumer per agent, with filters, is
  already a working "one agent subscribes to the events it cares about" mechanism.
- A2. **Partly verified.** <internal-host> reports `2.261030.10` on its unauthenticated health endpoint (uptime 27s
  at the probe); repo HEAD is `2.261030.11`; the local CLI is `2.261030.9`. Consumer routes landed in
  `v2.260908.12` (commit `c9c419718`), so the deployed server carries them by version inference only: the local
  CLI points at `http://localhost:8882`, not <internal-host>, and no key for that host is configured, so no
  authenticated probe was made. The owner's "update the client too" is a separate request this round did not act on.
- A3. **Corrected.** GitLab 19.x offers an HMAC signing token (introduced 19.0, GA 19.1): header
  `webhook-signature` (`v1,<base64>` entries), signed string = `webhook-id` + `webhook-timestamp` + raw body, key
  `whsec_<base64>` of 32 bytes; the plain `X-Gitlab-Token` compare is documented as weaker and not recommended
  (docs.gitlab.com/user/project/integrations/webhooks/). The SDK's `hmac-sha256` strategy signs the raw body only,
  so GitLab needs `kind: 'custom'`; `verifyDelivery` passes the headers through to a custom verifier
  (`packages/connector-sdk/src/verification.ts:36-42`). **Round 2 (scout S3):** the instance is GitLab 19.5.1,
  `enterprise:false` (CE). The project hooks API accepts `signing_token` (introduced 19.0, flag removed in 19.1, no
  tier restriction shown) and GET exposes `signing_token_present` (docs.gitlab.com/api/project_webhooks/). Not
  confirmed live, because proving it means creating a hook. `X-Gitlab-Token` stays the fallback; the live check moves
  to implementation.
- A4. **Verified (docs).** A project holds several hooks, each with its own URL, token or signing token, trigger
  set and branch filter; project hooks exist on every tier. Hook add and test are rate-limited to 5/min per user per
  project and need Maintainer or Owner (docs.gitlab.com/api/project_webhooks/).
- A5. **False.** Actions can be invoked outside automations: `POST /api/v2/connectors/:id/actions/:action`
  (`packages/api/src/routes/v2/connectors.ts:184-193`), `client.connectors.invoke` in the SDK and
  `omni connectors invoke` in the CLI. The caller needs an Omni key with `connectors:invoke`; the provider token
  stays sealed server-side. That scope is tenant-wide: no per-connector or per-action narrowing, and
  instance-restricted keys are refused (`packages/api/src/routes/v2/connectors.ts:39-57`). A key that can post an
  MR note can run every action on every connector in the tenant.
- A6. **Unchanged.** The owning captain is resolvable from event data (project path, labels, `eventKey`) plus a
  routing table; where it lives is the owner's call (Open O2). New fact: `hc` terminal names are optional, unique
  only among live terminals, and most current terminals have none, so any routing table needs captains launched
  with a fixed `hc run --name`.
- A7. **New, assumed.** `set_labels` adds and removes labels (GitLab `add_labels`/`remove_labels`) and never
  replaces the whole set, because a replace clobbers labels humans set. Waiting under Open O4 for the owner.

## Round 2: what the Settled answers change

- **R1-1 makes the multiplexing item an Omni server change inside this design.** Connectors take over
  credentialed webhook ingress: one ingress URL per connector, a typed event name per delivery
  (`gitlab.merge_request.merged`), subscriptions that match an event glob plus filters with the target automation
  optional, and unmatched deliveries counted and shown by doctor. The omni-design council
  (`council-omni-design-2026-11-01.md`) had recommended the opposite: GitLab as a webhook source, with the connector
  deferred. The owner's answer supersedes that recommendation. Only the guards R1-1 names carry over: the no-target
  branch fires nothing before the target becomes optional, ClickUp is unchanged, and unmatched deliveries are visible.
- **R1-2: no actions in v1.** Scope IN still lists the four typed actions. Dropping them is a change to Scope IN, so it
  is asked as its own question (O9). While actions stay out, O4 (`set_labels` semantics) and the token-role half of O7
  are moot; A5 and A7 are kept for a later actions slice.
- **With no actions, the connector's only certain secret is the hook verification secret.** It holds a GitLab token
  too only if it registers the hook through the GitLab API itself (fact O14, for this round's scouts).
- **R1-3: wait for paired agents.** The owner's note `owner-decisions-2026-11-01.md` (outside the ledger, read as
  evidence) adds three points: the GitLab slice waits for the paired-agent slices, there is no interim bridge over
  unowned consumers, and the delivery mode is set per agent. The paired-agent council
  (`council-paired-agents-2026-11-01.md`) set conditions C0 to C14. No brainstorm or wish for paired agents exists
  under `.genie/` (checked 2026-11-01), so the dependency has no home yet (O11). The two Mac-dispatcher items in Scope
  IN describe exactly the interim bridge the owner ruled out, so reshaping them is a question (O10). Routing (old O2)
  moves into each agent's own paired declaration.
- **R1-4: the baseline is derived from GitLab history.** The lead proposes a counting method (A8), which needs the
  owner's confirmation of the window (O12).
- **Proposed Scope IN additions from R1-1** (the lead proposes them; only the ledger records them, and it does not
  yet): (1) Omni connector ingress per connector, with typed event names journaled, subscriptions matching an event
  glob plus filters, and an optional target automation; (2) a counter for unmatched deliveries plus a connector doctor
  line. Until the ledger carries them, the existing item "mapping GitLab's one-URL hook multiplexing onto Omni
  subscriptions" covers this work.

## Round 2: what the scouts found (S1 Omni ingress, S2 SDK and paired-agent groundwork, S3 GitLab live)

Evidence, not decisions. Paths are in `<omni-checkout>` at HEAD `ee5753234`.

- **F1. A `gitlab.*` event type is refused today (O15).** `publishGeneric` calls `eventRegistry.validate`, which
  passes core types, `custom.*`, `system.*` and the literal `connector.event`, and fails anything else with
  "Unknown event type" (`packages/core/src/events/nats/registry.ts:105-135`, `client.ts:246-258`). `register()` refuses
  schemas outside `custom.`/`system.` (`registry.ts:62-74`). The `EventType` union is Core | `custom.${string}` |
  `system.${string}` | `'connector.event'` (`packages/core/src/events/types.ts:139-195`). Stream routing goes by the
  first dotted token and defaults to the CUSTOM stream, whose only subject is `custom.>` (`streams.ts:99-107,141-165`),
  so `gitlab.merge_request.merged.internal.global` matches no stream subject. The journal subscriber already listens on
  `connector.>` but not on any `gitlab.>` (`packages/api/src/plugins/event-persistence.ts:662-692`). Consequence: the
  name R1-1 approved as an example needs a registry widening, an `EventType` member, a stream subject and a persistence
  subscriber per provider namespace. `connector.gitlab.*` needs only the registry widening and a stream subject.
  `custom.gitlab.*` collides with paired-agent C5, which reserves it for verified webhook sources, and any
  `events:write` key can forge it through `/events/trigger`. This is asked as a reopen of R1-1 (Asked, naming).
- **F2. Consumer globs work for any journaled type.** A durable consumer's `eventType` and `excludeTypes` take an exact
  value or a trailing-`*` prefix glob; exclusion wins (`packages/api/src/services/events.ts:19-49`). `omni_events.event_type`
  is `varchar(255)` with no CHECK (`packages/db/src/schema.ts:1994`), and the API schema does not restrict the prefix.
  So `connector.gitlab.merge_request.*` or `gitlab.merge_request.*` both match once the type is journaled.
- **F3. The no-target branch fans out today.** `connectorTargetMatches` returns true for a `connector.event` whose
  payload has no `targetAutomationId`, so every loaded automation triggered by `connector.event` fires
  (`packages/core/src/automations/engine.ts:46-52`; a test asserts it, `connector-action.test.ts:132-139`). Whether
  `this.automations` is tenant-filtered at that point is unverified (O18). This is the hazard behind R1-1's council
  condition. Binding today also requires the target's trigger to be exactly `connector.event`
  (`packages/api/src/services/connectors.ts:552-566`).
- **F4. The R1-1 change map (S1).** Ingress is `POST /api/v2/connectors/events/:subscriptionId`
  (`packages/api/src/app.ts:599-606`); everything downstream is keyed by subscription id: the per-subscription sealed
  `verification_secret` (`connectors.ts:862-912`), the SECURITY DEFINER tenant lookup `omni_connector_ingress_tenant(uuid)`
  and its RLS GUC (`packages/db/src/tenancy-rls.ts:380-410`), the idempotency key `connector:{subscriptionId}:{providerEventId}`
  (`connectors.ts:170-176`), and the 0090 trigger that derives the event's tenant from `metadata.subscriptionId`
  (`packages/db/drizzle/0090_connector_event_ownership.sql:58-75`). A per-connector URL therefore needs: a
  connector-level secret column, a connector-keyed twin of the tenant lookup and policy, an idempotency key scoped to
  the connector (one delivery may match several subscriptions), a tenant trigger that reads a connector id, migration
  `0091` (next free number) dropping NOT NULL on `target_automation_id`, and a unique index that survives a NULL target
  (`binding_uq` treats NULLs as distinct). TS touch points: the create/update zod schemas, `assertTargetAutomation`,
  `buildConnectorEventPayload`, the exact `eventKey` check at `connectors.ts:905`, the CLI, the SDK and the OpenAPI types.
- **F5. Nothing counts the 202 ignored outcome, and there is no connector doctor line.** The paused, key-mismatch and
  filter-mismatch branches return without a write (`connectors.ts:886-909`); `packages/cli/src/commands/doctor.ts`
  has no connector, webhook or liveness check. Both parts of R1-1 (4) are new code.
- **F6. ClickUp URLs can stay as they are (O16).** The subscription-id route and its lookup are untouched by adding a
  connector-level route beside them; both ids are UUIDs (S1 f). Recorded as A10.
- **F7. v1 needs no GitLab API token (O14).** The ClickUp connector does not register its webhook through the provider
  API: the operator creates it in ClickUp and pastes the secret (`packages/connector-clickup/src/manifest.ts:10-12,460-461`).
  The verification secret lives on the subscription, not in `credentialFields` (`connectors.ts:591,870-881`). With no
  actions and a hand-registered hook, a v1 GitLab connector holds only the hook secret, so the Scope IN item "GitLab
  token sealed in Omni and never exposed to agents" has nothing to seal in v1. It is kept as an invariant for the
  actions slice.
- **F8. The SDK cannot express an events-only connector yet.** The registry refuses empty `actions`
  (`packages/connector-sdk/src/registry.ts:82-84`) and needs at least one credential field, which may be
  `optional: true` (`registry.ts:48-61`, `types.ts:27`). Slice 2 therefore includes a small SDK rule change, or a
  placeholder action (A11).
- **F9. Custom verification fits GitLab.** A `kind: 'custom'` verifier receives the raw body, the lowercased headers
  and the opened secret (`verification.ts:36-42`, `app.ts:602-603`). `timingSafeEqual` is not exported by the SDK, but
  a verifier can import it from `node:crypto`.
- **F10. Paired-agent groundwork in the repo (for slice 3).** `durable_consumers.owner_key_id` exists (migration 0082,
  `schema.ts:3778`); there is no `agent_id` on `durable_consumers` or `api_keys` (`api_keys` has only `parent_key_id`,
  0088). `omni_events.agent_id` and `platform_identities.agent_id` exist (0001), as do `agents.event_manifest` (0062) and
  `automations.managed_by_agent_id` (0063). Branches `feat/985-agent-subscription-manifest` and `feat/989-durable-consumers`
  are merged into dev; no branch carries agent-owned consumers. No brainstorm or wish for paired agents exists under
  `.genie/`.
- **F11. GitLab history for khal/brain (S3, for O12).** Project id 42 was created 2026-10-30, so the 30- and 90-day
  windows are the same ~2 days. Counts: issues opened 267, MRs opened 178, MRs merged 168, branch push events 531
  (81, 297, 153 per day; the last day partial), MR comment events 378 (plus 245 on issues), failed pipelines 0, failed
  jobs 0, tags 0, releases 0, deployments 0. The project has 2 pipelines in total and no runners, so the CI and release
  phases produce no events today. Endpoints: `/projects/42/issues`, `/merge_requests` (`state=merged`, filtered on
  `merged_at`), `/events` (pushes, notes; counts events, not commits), `/pipelines?status=failed`, `/jobs?scope[]=failed`
  (no date filter), `/repository/tags`, `/releases`, `/deployments`. Event counts exceed list counts by 2 issues and 1 MR.

## Round 3: what the lead found (no scouts; read from the repo at HEAD `ee5753234`)

Evidence, not decisions.

- **The round 2 questions were never asked.** Round 2 dispatched scouts, so its question list stayed empty, and the
  ledger's `asked` is `[]`. O9, O10, O13 and O15 were marked "asked this round" in this DRAFT, but the owner never saw
  them. They are asked now, for the first time.
- **F12. No JetStream stream holds `connector.>` (closes O17 as a code reading; not probed live).** `streams.ts`
  defines subjects for `message`, `reaction`, `instance`, `identity`, `media`, `access`, `session`, `custom.>`,
  the SYSTEM list (`system.>`, `sync.>`, `batch-job.>`, `presence.>`, `chat.>`, `follow_up.>`, `flow.>`,
  `template.>`, `channel.>`) and `agent.>` (`packages/core/src/events/nats/streams.ts:45-133`). `getStreamForEventType`
  sends any unmapped prefix, `connector` included, to CUSTOM, whose only subject is `custom.>` (`:141-165`, `:101`).
  A connector delivery publishes `connector.event.internal.global` (`client.ts:279-286`). The file's own comment records
  what that pattern did before: "template./channel. had NO stream before (publishes failed with 503 no-responders)"
  (`streams.ts:116-117`). When the publish throws, the ingress deletes its journal claim, records the failure and
  rethrows, so the provider gets 500 (`connectors.ts:1026-1051`, runbook `docs/runbooks/connectors-clickup.md:139`). The
  `connector.>` persistence subscriber (`event-persistence.ts:676`) resolves to the CUSTOM stream the same way
  (`client.ts:416-428`). Every connector test runs on the in-memory bus. **Caveat:** this is inferred from code. The
  local CLI is unauthenticated and <internal-host> was not probed. If ClickUp deliveries succeed in production today,
  something outside the repo adds the subject. The live check is stream info on the production NATS, or one
  authenticated test delivery (O21).
- **F13. The no-target fan-out crosses tenants (closes O18).** The automation service loads
  `this.list({ enabled: true })` with no tenant predicate (`packages/api/src/services/automations.ts:143-167`, reload
  at `:184-186`); its comment says `automations` is G2-unowned, with `tenant_id` NULL until the G6 backfill
  (`:152-158`). `handleEvent` filters only on trigger type, `enabledAt` and the connector target
  (`packages/core/src/automations/engine.ts:493-505`). So a `connector.event` with no `targetAutomationId` fires every
  enabled `connector.event` automation of every tenant. This raises the stakes of the existing guard item in Scope IN;
  it adds no new item.
- **F14. Two engine touch points are missing from F4's change map.** `handleEvent` matches
  `a.triggerEventType === eventType` exactly, with no glob (`engine.ts:501-503`). `connectorTargetMatches` returns true
  for any type other than the literal `connector.event` (`engine.ts:46-47`), so a typed event such as
  `connector.gitlab.merge_request.merged` would skip the D7 target gate entirely. Slice 1 has to redefine both: the
  gate applies to every connector-namespace type, and an automation trigger either takes a glob or stays on exact names.

## Round 4: what the Settled answers change (no scouts; read from the repo at HEAD `ee5753234`)

- **R3-1 (namespace `connector.gitlab.*`).** Typed connector events live under `connector.`, so slice 1 needs only
  the registry widening (accept `connector.<provider>.<...>`, not just the literal `connector.event`), the stream subject
  already in Scope IN, and the gate rule of F14. No new `EventType` namespace, no per-provider persistence subscriber:
  the `connector.>` subscriber covers it (F1). It also removes the clash with paired-agent C5: `custom.gitlab.*` is no
  longer involved, and `/events/trigger` cannot forge a `connector.*` row unless the registry widening lets it, which the
  design must refuse (only the ingress publishes `connector.*`).
- **The slice-1 to slice-3 handoff.** Paired-agent C2 proves its per-source grant with "a custom.gitlab.* row". Under
  R3-1 that row is `connector.gitlab.*`, and the grant names a connector or a connector subscription. Which of the two
  depends on what enters the journal (asked this round, O22). This is the contract this design hands to paired agents.
- **R3-2 (Omni work now, GitLab waits).** Slice 1 is designed for delivery now. Slice 2 (the GitLab connector) and
  slice 4 (measurement) are designed here but start only when the paired-agent slices land; slice 3 is built
  elsewhere. The gate needs a home for paired agents to point at (O11, asked this round).
- **R3-3 and R3-4 (two scope drops).** The actions item and the Mac-dispatcher item leave Scope IN. The lead returns the
  Scope IN list without them this round. If the ledger still shows them after this round, that is a ledger fault, not
  a pending question.
- **A12 now binds.** It was waiting on O13 (now R3-2) and O15 (now R3-1); it moves from Assumed into the criteria.
- **F15. Where the unmatched counter lives.** Omni has no metrics library in `packages/api/src`; delivery stats are
  columns on the row they describe: `connector_subscriptions` carries `last_delivery_at`, `last_failure_at`,
  `consecutive_failures`, `total_deliveries`, `total_duplicates`, `last_error` (`packages/db/src/schema.ts:3574-3579`),
  and webhook sources carry `last_received_at`/`total_received` (`:3144-3145`). The natural home for the unmatched
  counter is a connector-level column set (`total_unmatched`, `last_unmatched_at`, last unmatched typed name) beside the
  connector-level secret, in the same migration. `omni doctor` today is local-only (pm2, pgserve, ports; it reads only
  `/api/v2/health`, `packages/cli/src/commands/doctor.ts:10-21,318-344`), so the doctor line needs a server-side read,
  either a connectors health block in `/api/v2/health` or a connectors API call from the CLI.
- **F16.** The next free migration is still `0091` (`packages/db/drizzle/` ends at `0090_connector_event_ownership.sql`).
- **Lead additions to Scope IN this round (they add scrutiny, so they are taken and announced):** (1) the D7 target gate
  covers every connector-namespace event type, so a typed connector event reaches an automation only as its
  subscription's named target (F14, A13); (2) the connector-level hook verification secret is sealed, never returned by
  the API and never present in a journaled row or delivered event (F4, F7). Item (2) carries the live half of the token
  item, which is asked as a drop (O20).

## Round 5: what the Settled answers change (no scouts; read from the repo at HEAD `ee5753234`, unchanged since round 2)

- **R4-1 (matched only).** A verified delivery enters the journal only when at least one subscription of the connector
  matches its typed name (glob plus filters, target optional). A subscription with no target is therefore how a category
  is opted in to the journal. Consequences the design carries:
  - **One row per delivery, keyed on the connector.** The idempotency key becomes `connector:{connectorId}:{providerEventId}`
    for the per-connector route; the row records every matched subscription id (A12(e): a delivery matching two
    subscriptions journals once). The 0090 tenant trigger derives the tenant from the connector id; all matched
    subscriptions belong to that connector, so the tenant is unambiguous. ClickUp's route and key stay as they are (A10).
  - **The unmatched counter keeps no payload.** An unmatched delivery bumps the connector-level columns (F15):
    `total_unmatched`, `last_unmatched_at` and the last unmatched typed name, and nothing else. Push payloads (commit
    messages, author emails) of categories nobody subscribed to are never stored. A12(d) takes this wording.
  - **The contract handed to paired agents.** Paired-agent C2 lets an agent-owned consumer receive NULL-instance rows
    through a per-source grant that names "a webhook source id, a connector subscription or key, or a producing agent"
    (`council-paired-agents-2026-11-01.md:260`). Under R3-1 and R4-1, every `connector.gitlab.*` row carries its connector
    id and at least one matched subscription id, so a grant can name either. C2's proof row is `connector.gitlab.*`, not
    `custom.gitlab.*`. This is written into the design as the interface; the paired-agents brainstorm decides which of
    the two its grant names.
- **R4-2 (own brainstorm).** `.genie/brainstorms/paired-agents/DRAFT.md` now exists (created 2026-11-01, 314 bytes): a
  skeleton with nothing settled, sized or scoped. O11 is closed. The gate that starts slices 2 and 4 now has a home to
  point at, but "paired agents land" still has no testable meaning; that is asked this round (O23).
- **R4-3 and R4-4 (two scope drops).** The allowlist item and the token item leave Scope IN; the lead returns the list
  without them. Fencing and the allowlist now live with paired-agent C8 and the agent's own consumer filter. The token
  invariant returns with any later actions slice; the live secret is covered by the sealed hook-secret item.
- **Facts moved out of Open (not owner decisions).** O21 (does production NATS hold `connector.>` today) becomes a
  pre-cutover check in A12(h); slice 1 adds the subject either way. O8 (authenticated probe of <internal-host> consumer
  routes) concerns delivery only and is handed to the paired-agents brainstorm. Both are recorded, not dropped.
- **Lead defaults taken this round (they add scrutiny or fix detail; recorded under Assumed):** A14, the doctor line
  reads connector counters through an authenticated connectors API call, never the unauthenticated `/api/v2/health`;
  A15, the typed-name vocabulary for GitLab.

## Round 6: what the Settled answers change, and what the lead found (no scouts; omni HEAD `ee5753234`)

- **R5-1 (delivery minimum).** Slices 2 and 4 start when the O23 set is merged and live on <internal-host>: C0, C1, C2
  (proven with a `connector.gitlab.*` row), C3, C4, C8 and a C12 drain for at least one captain. The gate is written into
  the design as those conditions' tests (A16). The paired-agents brainstorm is still asking its own R1-1 (when C0 lands)
  and R1-3 (whether C4 keeps typed connector actions); neither changes the gate, because the gate needs C0 merged
  whenever it lands, and v1 has no actions under either C4 wording.
- **R5-2 (7 days each) and R5-3 (99%, misses explained).** Slice 4's ratio now has a window and a bar. The lead fixes the
  window anchors and what "explained" means as defaults (A17, A18).
- **R5-4 (test-hook proof) cannot be carried out as the owner approved it. Asked as a reopen (O27).** O25 described it as
  "project hooks offer a per-trigger test". GitLab's test-hook code says otherwise for three of the five zero-event
  categories. F17 below has the evidence.
- **F17. What a GitLab test hook can send (read from GitLab source, mirror `gitlabhq/gitlabhq` master `d7b9a6176ab4`,
  not from the 19.5.1 tag; the `no_data_error` pattern below is long-standing, but it is unconfirmed on 19.5.1).**
  `TestHooks::ProjectService#data` (`app/services/test_hooks/project_service.rb`) dispatches by trigger to
  `Integrations::ProjectTestData` (`app/services/concerns/integrations/project_test_data.rb`):
  - `push_events` and `tag_push_events` build a **sample** (`Gitlab::DataBuilder::Push.build_sample`, `:13-19`). They work
    in a project with no tags.
  - `pipeline_events` and `job_events` replay the **latest real** pipeline or job (`:45-59`), with its real status, and
    fail with "Ensure the project has CI pipelines." / "CI jobs." when there is none. A test cannot produce a *failed*
    pipeline or job. khal/brain has 2 pipelines, 0 failed pipelines, 0 failed jobs and no runners (F11), so the test sends
    `connector.gitlab.pipeline.<whatever status the latest has>` (A15). If the owning agent subscribes to `.failed`, that
    delivery is unmatched and only counted (R4-1).
  - `releases_events` replays the latest release and fails with "Ensure the project has releases." (`:77-81`). khal/brain
    has 0 releases.
  - Deployments cannot be tested at all on a project hook. `deployment_events_data` exists (`:69-73`), but the project-hook
    dispatcher has no `deployment_events` branch, and the API's `POST /projects/:id/hooks/:hook_id/test/:trigger` does not
    list it as a trigger (docs.gitlab.com/api/project_webhooks/).
  - Neither doc page says whether a test delivery carries `webhook-id` and `Idempotency-Key`, or whether it is signed with
    the signing token (docs.gitlab.com/user/project/integrations/webhooks/). That is an implementation check (A19).
  - Releases and deployments can be created through the GitLab API without a runner. A failed job needs a runner, and
    khal/brain has none (F11).
- **F18. Signed webhook sources exist today (for O26).** The generic webhook ingress verifies `hmac-sha256`, `hmac-sha1` or
  `token-match` with a sealed per-source `signature_secret` (`packages/db/src/schema.ts:2988-3008,3105-3108`;
  `packages/api/src/services/webhooks.ts:243-250`). The CLI ships a GitHub preset that sets one up
  (`packages/cli/src/commands/sources.ts:4,28-31,64-65`, runbook `docs/runbooks/github-webhook-source.md`). R1-1 (as
  reopened by R3-1) says "merge webhook sources into connectors" and "webhook sources remain only for credential-less
  ingress". A9 has read that as "nothing migrated, existing sources unchanged". Signed sources are credentialed ingress,
  so A9 decides what this design does to them. That makes it load-bearing, and it is asked (O26) rather than assumed.
- **F19. Drift in the paired-agents DRAFT, handed to that brainstorm's lead (not edited here).**
  `.genie/brainstorms/paired-agents/DRAFT.md` still names `custom.gitlab.*` at lines 179, 256 and 261 (its A9: Brain's
  swarm consumer). R3-1 settled `connector.gitlab.*`, and that DRAFT's own line 29 says so too. The C2 grant and the
  proof row in R5-1's gate are `connector.gitlab.*`. A consumer filtered on `custom.gitlab.*` would match nothing.
- **Not part of this brainstorm.** The run that started this round relayed a t16r report about the token-meter
  measurement (ccusage, Codex rollouts, advisor iterations). It bears on no question here and was not acted on.

## Round 7: what the Settled answers change (scouts dispatched; omni HEAD still `ee5753234`)

- **R6-2 (migrate signed webhook sources in this design).** The owner chose against the lead's recommendation (leave them
  unchanged, migrate in a later design). A9's reading, "nothing migrated", no longer holds; it is superseded. The
  migration is now part of this design, but nothing in this DRAFT maps it yet: F18 is a single paragraph. Unknown so far:
  which event type a verified webhook-source delivery publishes today (`custom.*` is likely: paired-agent C5 reserves
  `custom.<provider>.*` for verified webhook sources), who consumes those types (automations, durable consumers, the
  GitHub runbook), what a signed source becomes under R1-1's connector model (a `github` connector, or a generic signed
  connector carrying `hmac-sha256`, `hmac-sha1` and `token-match`), and whether the cutover keeps existing URLs and type
  names. These are repository facts first, so this round sends scouts (S4 to S7 below). The owner questions they raise
  (cutover model, event names, URL continuity) are written after the scouts report.
- **Lead addition to Scope IN this round (it follows R6-2, so it is taken and announced):** "existing signed webhook
  sources (hmac-sha256, hmac-sha1, token-match) and the CLI GitHub preset migrate into connectors per R6-2; webhook
  sources keep only credential-less ingress". The last clause restates R1-1's own sentence; whether new signed sources are
  refused at once or after the cutover is part of the cutover question.
- **R6-1 (real objects via API).** Slice 4 proves tag_push, release and deployment with real objects created through the
  GitLab API and delivered live by GitLab. Two consequences are written down rather than left implicit:
  - **A GitLab API token reappears, outside Omni (A20).** Creating a tag, a release and a deployment needs a token with
    `api` scope. R4-4 dropped "GitLab token sealed in Omni" because v1 holds none (F7). The proof keeps that true: the
    token is held by the operator running the proof, is never stored in Omni and never reaches the connector or an agent.
  - **The runner-less fallback (A21).** The ledger keeps only the picked option's label. Its description, the lead's O27
    recommendation, said pipeline and job failures need a runner and, without one, fall back to a signed replay of
    GitLab's documented payload with `status: failed`, reported as a replay. The lead takes that as the option's content.
    Scout S7 checks whether GitLab can produce a real failed pipeline or job without a runner (for example a pipeline
    that fails on a CI config error, or an external commit status set to `failed`); if it can, the replay is not needed
    for that category, which only adds proof.
- **Sequencing.** R3-2 lets Omni-side work proceed now and holds GitLab until paired agents land. The migration is Omni
  work, so by R3-2's reading it can proceed now; whether it widens slice 1 or becomes its own slice 5 waits on the scouts
  (provisional: slice 5, see Size triage).

**Scouts dispatched this round** (evidence returns next round):

- **S4 (worker).** Webhook sources end to end at HEAD: tables and columns, ingress route and service, verification
  strategies and whether a signature is optional per source, tenant lookup and RLS, idempotency, counters, the exact event
  type each verified delivery publishes and journals, every automation, consumer, runbook, CLI, SDK and OpenAPI surface
  that names sources or their event types, and the tests that cover them.
- **S5 (worker).** The paired-agents DRAFT (now 41 KB): what it has settled since round 6, whether F19's
  `custom.gitlab.*` drift is fixed, whether the R5-1 gate conditions (C0, C1, C2, C3, C4, C8, C12) or the C2 grant
  contract changed, and what it says about webhook sources and C5's `custom.<provider>.*` reservation.
- **S6 (reasoner).** The migration's shape, read from the same code: what a signed source becomes as a connector, what
  dual-run versus cutover costs, what breaks for an existing GitHub-preset sender and its consumers, and which of those
  choices only the owner can make.
- **S7 (worker).** GitLab facts for R6-1: whether creating a release with a new `tag_name` also fires a `tag_push` hook,
  whether a deployment created through the API fires a deployment hook without a runner, and whether a failed pipeline or
  job can be produced without a runner (config-error pipeline, external commit status) and which hook each fires.

## Round 7: what the scouts found (S4 to S7; omni HEAD `ee5753234`, GitLab source at `v19.5.0-ee`)

**Correction to the round 7 text above.** Paired-agent C5 reserves `custom.webhook.*` for verified sources, not
`custom.<provider>.*` (S5, paired-agents DRAFT:360). A verified GitHub delivery today is typed `custom.github.<event>`,
which C5 as written does not reserve.

- **F20. What a signed source is.** One table, `webhook_sources` (`packages/db/src/schema.ts:3095-3192`). `name` is
  globally unique (`:3185`) and is also the ingress URL segment and the event-type namespace. Signing is
  `signature_config` jsonb `{algorithm, header, prefix?}` (algorithms are a TypeScript constant, `:2989-3015`) plus a
  sealed `signature_secret`, never returned (`hasSignatureSecret` only). A signature is optional per source; the public
  ingress requires one (`requireSignature: true`, `packages/api/src/app.ts:540-590`, `services/webhooks.ts:408-415`), so
  an unsigned source is reachable only on the authenticated `POST /api/v2/webhooks/:source`. Per-row features beside
  signing: an idempotency key template and an across-types flag, `event_type_mapping`, `strict_schemas`, `poll_config`,
  `expectedHeaders`, liveness (`expected_interval_seconds`, heartbeat, `liveness_status`) and counters
  (`last_received_at` and `total_received` on a new delivery only, `total_duplicates` on a redelivery).
- **F21. What a verified delivery publishes and journals.** `custom.webhook.<name>`, or `custom.<name>.<token>` when
  `event_type_mapping` resolves (`webhooks.ts:124-155`); subject `<type>.internal.global` on the `CUSTOM` stream
  (`custom.>`, 7 days; `packages/core/src/events/nats/streams.ts:99-106,143-166`). A journal claim row is written first
  (metadata `webhookSource: <name>`), under the same id as the published event. The payload is `{source: <name>,
  ...body}`: no source id, provider, raw body or headers, and a body with its own top-level `source` overrides the name
  (`webhooks.ts:446-450`). Every verified delivery is journaled; there is no subscription step, so GitHub's `ping` lands
  as `custom.github.ping`. Before the journal, a schema gate refuses a payload that violates its registered schema (400
  plus dead letter), and `strict_schemas` refuses an unregistered type (`webhooks.ts:632-690`).
- **F22. Who depends on those types, and how they match.** Nothing rewrites any of these on a rename:
  - automations: `trigger_event_type` by exact string, one durable NATS consumer per trigger filtered on `<type>.>`
    (`packages/core/src/automations/engine.ts:283-326`);
  - durable consumers: exact type or trailing-`*` glob (`services/events.ts:126-128`);
  - `event_schemas` rows keyed by type (the GitHub preset registers four `custom.github.*` schemas,
    `packages/cli/src/commands/sources.ts:278`);
  - agent manifest `accepts` entries, compiled to automations (`services/manifest-compiler.ts:138`), and the publish
    allowlist;
  - idempotency keys, which embed the type for any non-default template (`lib/ingress-idempotency.ts:141-144`);
  - the heartbeat route and the liveness events `system.connector.stalled|recovered`, keyed on the source name
    (`packages/core/src/connectors/liveness.ts:196-233`);
  - runbooks (`docs/runbooks/github-webhook-source.md`, `clickup-webhook-source.md`), the CLI, OpenAPI and the TS, Go
    and Python SDKs.
  Two hard limits sit in the way of a rename. Agent manifests refuse any type outside core, `custom.*` and `system.*`
  (`packages/core/src/schemas/agent-manifest.ts:34-43`, read by the lead), so an `accepts` entry cannot name
  `connector.github.*` today. A connector subscription's target automation must have `triggerEventType =
  'connector.event'` (`services/connectors.ts:554-566`).
- **F23. The sender side.** A GitHub-preset sender uses two URLs: `/api/v2/webhooks/ingress/<name>` and the heartbeat
  `/api/v2/webhooks/<name>/heartbeat` (called by the runbook's Actions cron, runbook:189). The CLI finds the GitHub hook by
  its payload URL (`sources.ts:80-85,248`), so re-running the preset with a new URL creates a second hook. Every refusal on
  the public ingress (unknown or disabled source, no signature config, bad signature, unopenable secret) is one 401 whose
  reason is only logged (`app.ts:573-590`): a broken migration shows up at the sender, not in Omni.
- **F24. Verification coverage.** The connector SDK has two kinds, `hmac-sha256` and `custom`, and refuses any other
  (`packages/connector-sdk/src/verification.ts:19-51`, `registry.ts:100-116`); `verify()` and `parseDelivery()` receive no
  connector config. In the webhook path, `hmac-sha256` is tested end to end; `token-match` has one unit test
  (`services/__tests__/webhooks.test.ts:709-712`); `hmac-sha1` has no test, no preset and no runbook. The SDK lowercases
  the provided hex; the webhook path compares it exactly. How many live sources use each algorithm is unknown (O32).
  **Two signed recipes ship, not one:** the GitHub CLI preset, and the ClickUp runbook
  (`docs/runbooks/clickup-webhook-source.md:18-23,87-91`: `hmac-sha256` over `X-Signature`, hex, no prefix, published as
  `custom.clickup.*`). The existing `clickup` connector's manifest verifies exactly that
  (`packages/connector-clickup/src/manifest.ts:409-413`, read by the lead), so a ClickUp signed source fits it. But
  `connectors.credentials` is NOT NULL (`schema.ts:3520`) and a webhook source holds only the hook secret, so a
  ClickUp source that moves into the `clickup` connector needs either the account credential or a hook-secret-only
  connector, the same question A11 answers for GitLab. R1-1's "ClickUp is unchanged" and A12(c) cover the existing
  ClickUp *subscriptions*; a migrated ClickUp *source* would newly publish `connector.clickup.*`.
- **F25. Tenancy: a migrated source has no tenant to copy.** The 0041 trigger sets `webhook_sources.tenant_id` to NULL on
  every insert (`packages/db/drizzle/0041_tenant_ownership_columns.sql:2705-2722`, re-read by the lead), and the ownership
  manifest classes the table `unowned` until G6 (`packages/db/src/tenancy-ownership.ts:367-379`). The public ingress finds
  the source with an unscoped `getByName`, with no SECURITY DEFINER function; the db-access guard records that under
  forced RLS the tenant predicate would match no row, an open G6 question (`tenancy-db-access-guard.ts:1786-1796`).
  Connectors are tenant-keyed: names unique per tenant (`schema.ts:3540`), ingress through the SECURITY DEFINER tenant
  lookup. Sealing binds to the tenant only (`packages/core/src/secrets/tenant-secret-box.ts:166`): a ciphertext moves
  as-is within one tenant, while a NULL-tenant or unsealed secret is plaintext and must be sealed by the app, not by SQL.
- **F26. What does not line up across a cutover.**
  - Idempotency: the old key is `custom.github.push:github:<X-GitHub-Delivery>`; slice 1's is
    `connector:{connectorId}:{providerEventId}`. A redelivery that straddles the cutover journals twice unless the
    migration bridges the keys.
  - Payload: a connector payload is `{...data}` plus reserved keys plus `rawPayload = data`
    (`services/connectors.ts:185-211`). The body is carried twice and there is no `source` key. Templates on
    `payload.repository.*` survive; anything reading `payload.source` does not. The effective NATS ceiling is about half
    of `max_payload`. This applies to GitLab push payloads in slice 2 as well (constraint added to the gap map).
  - Guards: the connector path has no schema gate, and `register()` accepts only `custom.` and `system.` schemas (F1). It
    also has no liveness or heartbeat (`grep` in `services/connectors.ts`: no hits).
  - Dual-publish: `custom.>` and `connector.>` each have a journal subscriber (`plugins/event-persistence.ts:662,676`),
    so publishing both names writes two rows, and a consumer on both namespaces acks twice.
- **F27. Nothing names this migration yet.** `docs/architecture/connectors.md:12-17` and
  `docs/runbooks/connectors-clickup.md:3-8` say webhook sources and connectors coexist. Those docs change with the
  migration.
- **F28. GitLab facts for R6-1 (S7; source reading at `v19.5.0-ee`, Gitaly at master; nothing run live).**
  - `POST /projects/:id/releases` with a new `tag_name` fires a release hook synchronously and a `tag_push` hook
    asynchronously through PostReceive (`app/services/releases/create_service.rb:27,43-45,73`;
    `app/services/git/tag_push_service.rb:7-17`). One call gives two proof deliveries, in no guaranteed order. An existing
    tag gives the release hook only.
  - `POST /projects/:id/deployments` needs no runner and fires a deployment hook with the posted status (`running`,
    `success`, `failed`, `canceled`); `PUT` fires again on each real transition (`lib/api/deployments.rb:124-215`,
    `app/models/deployment.rb:78-146`). An identical repeat create returns the existing deployment with no hook.
  - A real failed pipeline without a runner: push a commit whose `.gitlab-ci.yml` is invalid. The pipeline is saved as
    failed with `failure_reason: config_error` and fires a pipeline hook (`lib/gitlab/ci/pipeline/chain/config/process.rb:28`,
    `helpers.rb:46-53`, `app/models/ci/pipeline.rb:342-357`). `POST /projects/:id/pipeline` does not work for this: it
    saves nothing on a config error (`lib/api/ci/pipelines.rb:110-120`).
  - An external commit status set to `failed` creates a pipeline (source `external`) and fires a pipeline hook, but no
    job hook: job hooks come only from `Ci::Build`, and the external status is a `GenericCommitStatus`
    (`app/services/ci/create_commit_status_service.rb:120-198`, `app/models/ci/build.rb:973-979`). A real `job.failed`
    still needs a runner.
  - Token: `api` scope. Developer covers a tag, a deployment and a commit status. For a release, the API doc says Developer
    and the permissions table says Maintainer (`doc/api/releases/_index.md:461` against `doc/user/permissions.md:360`).
    A protected-tag rule must allow the proof tag's name.
- **F29. Paired-agents DRAFT (S5).** Its ledger now settles R1-1 (the C0 fix ships first, on its own), R1-2 (p95 2 s), R1-3
  (typed connector action grants deferred, no `connectors:invoke`) and R1-4 (`custom.agent.*` for agent-emitted types).
  F19 is **not** fixed: `custom.gitlab.*` is at its lines 179, 309 (A7) and 314 (A9), against its own line 29 and C2's
  `connector.gitlab.*` proof row. C2 still names "a connector or connector subscription, a webhook source, or a producing
  agent". C5 is `custom.webhook.*` for verified sources, and `connector.*` is published only by connector ingress. Nothing
  there addresses this migration. **Handed to that brainstorm's lead (not edited here):** (i) the F19 lines; (ii) after
  the migration no signed source publishes `custom.*`, so C2's "a webhook source" clause either names a key for unsigned
  sources only or becomes the connector clause for migrated ones; (iii) C5's `connector.*` reservation then also covers
  migrated sources, and its `custom.webhook.*` reservation covers only credential-less sources.

**What these facts change in this DRAFT.**

- The migration now has a change map (F20 to F26) and its owner choices are askable: O29 (what a signed source becomes),
  O28 (cutover model), O30 (URL and type continuity) and the new O31 (what a migrated source journals under R4-1).
- Lead defaults added this round, each adding scrutiny: A23 (no tenant, no migration), A24 (no per-source feature dropped
  silently), A25 (slice 5 ship evidence). A22 is revised: slice 5 follows slice 1. A16, A20 and A21 are updated from F28
  and F29.
- O32 (fact, not for the owner): a production inventory of signed sources and their dependants, read before the
  migration runs (A25(f)).

## Round 8: what the Settled answers change (no scouts; omni HEAD still `ee5753234`, no commits since)

The owner answered all four round 7 questions with the recommended option. The ledger keeps only the picked label;
the content of each option is the recommendation written under Open in round 7 (O28 to O31), taken as the option's
content the same way A21 was. Nothing is open after this round.

- **R7-1 (per-provider connectors).** Slice 5 builds a new `github` connector: a manifest, a static `hmac-sha256`
  verification over `X-Hub-Signature-256` with the `sha256=` prefix, which the SDK takes unchanged (F24), `parseDelivery`
  to `connector.github.<event>[.<action>]` from `X-GitHub-Event` and the body's `action`, and `X-GitHub-Delivery` as
  `providerEventId`. ClickUp signed sources move into the existing `clickup` connector, whose manifest already verifies
  that recipe (F24). On its per-connector route the `clickup` connector gains typed names (`connector.clickup.<event>`),
  while the existing ClickUp subscriptions keep `connector.event` byte-for-byte (A10, A12(c)). Both connectors run with
  only a hook secret and no account credential (A11, extended in round 8). The SDK keeps its two verification kinds. A
  generic signed connector is built only on the condition the option named (A27).
- **R7-2 (cutover per source).** A source moves in one step: its connector, its old-URL alias, its catch-all
  subscription and the rewrite of every dependant land together, or the migration refuses that source and names what
  blocks it (A23, A24, A25(a), A25(e)). Nothing is dual-published (F26). When new signed sources are refused is A26.
- **R7-3 (aliases, rename types).** Both old URLs, `/api/v2/webhooks/ingress/<name>` and `/api/v2/webhooks/<name>/heartbeat`,
  stay as permanent aliases of the migrated connector. Types become `connector.<provider>.*`, and every dependant in F22 is
  rewritten in the same change. Webhook source names are globally unique while connector names are unique per tenant
  (F20, F25), so the alias is keyed on the old source name, globally unique, and resolved through a SECURITY DEFINER lookup
  like the connector ingress lookup (F4). Each alias keeps the old type names, so a later reference to one fails loud (A28).
- **R7-4 (catch-all subscription).** Each migrated source gets one no-target subscription matching
  `connector.<provider>.*`, so its journal keeps today's contents, GitHub's `ping` included (`connector.github.ping`). A
  no-target subscription fires no automation (A12(b)). A25(b) takes its final wording.
- **How an automation dependant is rewritten under the D7 gate.** Today an automation on `custom.github.push` fires on
  every verified push, with no target. After the rename, the D7 gate (Scope IN, A13) lets a `connector.*` event reach an
  automation only as a subscription's named target. So the rewrite of one automation is a new subscription on its new
  type with that automation as target, beside the catch-all. A delivery that matches both journals once (A12(e)). The
  automation's own trigger value follows A13's design-time choice (`connector.event` or the typed name). Agent `accepts`
  entries compile to automations (F22), so they are rewritten the same way once the manifest namespace takes
  `connector.*`.
- **What the relayed message bears on.** The run that started this round relayed a status message: an Omni Bun bump PR is
  open (automagik-dev/omni#1458), and "C0 has been rebased onto chore/bun-1.4.4", with its checks being re-run before a
  stacked PR. Paired-agent C0 is part of R5-1's gate. The message shows C0 in progress, not merged or live on
  <internal-host>, so the gate stands as A16 states it. Nothing else in it bears on this design.
- **Open is empty.** O28 to O31 are closed by R7-1 to R7-4. O32 leaves Open as a fact: it is the pre-migration check
  A25(f), as O21 became A12(h), and A27 says what each finding leads to.

## Round 11: what R10-1 changes, and the lead's fixes for the rest of the review (no scouts; omni HEAD still `ee5753234`)

- **What happened in rounds 9 and 10.** The design was written and reviewed. The round 9 repair (R8-1, "Repair again")
  closed the R8-1 publisher finding. The second review of the repaired design (digest `ab0aed04…`) still returned
  FIX-FIRST, with HIGH-1, HIGH-2, MEDIUM-1, MEDIUM-2, LOW-1 and LOW-2. Both repairs were spent, so the run asked R10-1.
- **R10-1 (split it out).** The owner picked "Split it out (Recommended)". The ledger keeps only the label. The option's
  description, read from the round 10 question file as evidence, said: "Reopens R6-2 ('Migrate in this design' →
  'Migrate in its own brainstorm'): slice 5 moves to a new brainstorm, and row 13 (accepts on connector.*) is dropped,
  since paired agents get GitLab events through their durable consumers instead. The remaining design (ingress slice 1,
  slices 2 and 4) is repaired for MEDIUM-1/2 and the LOWs and re-reviewed with a fresh repair budget." The lead takes
  that as the option's content, as A21 was taken in round 7.
- **What the ledger has not recorded yet.** R10-1 has no `reopens` field, and its value (`split-slice5-drop-row13`) is
  not a `scope-drop:` value. So the ledger still holds R6-2 as "Migrate in this design", and the round 7 migration item
  is still in Scope IN. The design cannot leave slice 5 out while both still bind, because the review checks Scope IN
  against the ratchet (review C2). Both records are asked this round, each as the owner's R10-1 choice restated: O33
  reopens R6-2 and O34 drops the item. This only records R10-1; it is not a new decision. The design is written after
  both answers are in.
- **What leaves with slice 5, if O33 and O34 agree.** Rows 8 to 14 of the reviewed design: the `github` connector, the
  `clickup` connector taking migrated sources, the URL aliases, connector liveness and a schema gate over `connector.*`,
  the per-source cutover, the old-name and new-signed-source refusals, and the docs. Row 7 stays (A31). Their settled
  shape and evidence go to a new brainstorm. The proposed slug is `signed-source-migration` under `.genie/brainstorms/`.
  This round does not create it, because it edits only this DRAFT. What it inherits:
  - R6-2 as reopened, and R7-1 to R7-4. These stay Settled in this ledger, and they bind that brainstorm, not this design.
  - The facts F18 and F20 to F28, the defaults A22 to A28, and O32.
  - The two review HIGHs. HIGH-1: the preset's action-bearing types (`custom.github.pull_request`, `issues`, `release`)
    have no single exact new name under `connector.github.<event>[.<action>]`. HIGH-2: a `connector.*` `accepts`
    entry loses its targeted subscription whenever the manifest recompiles. The compiled row's name hashes event plus
    filter (`packages/api/src/services/manifest-compiler.ts:100-138`), and the subscription's target cascades on delete
    (`packages/db/src/schema.ts:3567-3569`).
- **What stays here, and how it changes.**
  - **Two credentialed paths coexist for a while.** R1-1's sentence "webhook sources remain only for credential-less
    ingress" stays Settled and is reached in the new brainstorm. Until then, signed webhook sources keep working
    unchanged beside connectors. This design refuses no new signed source. A26 leaves with slice 5, because a refusal
    before a `github` connector exists would leave a GitHub sender with nowhere to go. The design says this under Risks.
    It is the trade-off the R10-1 option named.
  - **Row 13 is dropped, and agent manifests stay as they are.** They refuse every type outside core, `custom.*` and
    `system.*` in both `accepts` and `publishes` (`packages/core/src/schemas/agent-manifest.ts:34-43`). No
    `ManifestEventTypeSchema` split is needed. Today's schema already keeps `publishes` off `connector.*`, which was the
    manifest half of the R8-1 repair (Decision #29). An agent receives `connector.gitlab.*` rows only through a durable
    consumer, which is the path of paired-agent C1 and C2 (the R5-1 gate). HIGH-2 has no surface left here.
  - **Decision #29's bus rule stays as written.** `publishGeneric` refuses every `connector.*` type. `publishConnector`
    is the one path for those types. `emit_event` refuses `connector.*`, and `/events/trigger` keeps refusing anything
    outside `custom.`. A29 adds the dead-letter provenance check that MEDIUM-1 asked for.
  - **This design has no schema gate over `connector.*` and no connector liveness.** Both were A24 equivalents for
    migrated sources. GitLab rows get no schema gate, the same as ClickUp rows today.
- **Lead fixes for the other four findings.** The reviewer marked each one `ownerDecision: false`. Each adds scrutiny
  and none narrows an owner answer. They are recorded as A29 (MEDIUM-1, dead-letter provenance), A30 (MEDIUM-2, the
  subscription discriminator), A31 (LOW-1, where the SDK rule lands) and A32 (LOW-2, reserved keys on typed rows only).
- **Checked this round in the code at `ee5753234`.**
  - `connector_event_subscriptions.verification_secret` and `target_automation_id` are both NOT NULL. The target is
    `onDelete: 'cascade'` (`packages/db/src/schema.ts:3555-3580`).
  - `CONNECTOR_RESERVED_KEYS` is at `packages/api/src/services/connectors.ts:60` and is applied at `:196-210`.
  - Dead-letter manual retry and auto-retry both republish the stored payload through `publishGeneric`
    (`packages/api/src/services/dead-letters.ts:284`, `:407`). `create()` is at `:143`.
- **Size.** Still G (see Size triage).

## Round 12: what R11-1 and R11-2 change (no scouts; omni HEAD still `ee5753234`, no commits since)

- **R11-1 (reopens R6-2: "Migrate in this design" → "Migrate in its own brainstorm").** The owner picked "Own brainstorm
  (Recommended)". The signed-source migration (slice 5, and the conditional slice 5b) leaves this design. Row 13 (agent
  manifests accepting `connector.*`) is dropped: manifests keep refusing `connector.*` in `accepts` and `publishes`, and
  agents get `connector.gitlab.*` rows through durable consumers (paired-agent C1 and C2, the R5-1 gate). Until the new
  brainstorm lands, signed webhook sources keep working unchanged beside connectors, and this design refuses no new one.
- **R11-2 (scope-drop).** The owner picked "Drop it (Recommended)". The item "existing signed webhook sources
  (hmac-sha256, hmac-sha1, token-match) and the CLI GitHub preset migrate into connectors per R6-2; webhook sources keep
  only credential-less ingress" leaves Scope IN. Nine live items remain, and the lead returns the list without it.
- **Settled answers this design deliberately does not implement, and where each binds.** A reviewer checking Settled
  answers against the design rows should read this list as intended, not as a gap:
  - R6-2 as reopened by R11-1: the migration is designed in its own brainstorm.
  - R7-1 (per-provider connectors), R7-2 (cutover per source), R7-3 (aliases, rename types) and R7-4 (catch-all
    subscription): they stay Settled in this ledger and bind the migration brainstorm, not this design.
  - R1-1's sentence "webhook sources remain only for credential-less ingress": it is reached by the migration brainstorm.
    R11-1's own text gives it its gate here: "Until that brainstorm lands, signed webhook sources keep working unchanged
    beside connectors, and new ones are not refused." The design states the coexistence of two credentialed ingress
    paths under Risks.
  - R10-1's "drop row 13": no agent-manifest change in this design.
- **What goes with the migration.** R6-2 as reopened, R7-1 to R7-4, the facts F18 and F20 to F28, the defaults A22 to A28,
  the fact O32, and the round 10 review's HIGH-1 (action-bearing GitHub types have no single exact new name) and HIGH-2
  (a `connector.*` `accepts` entry loses its targeted subscription on manifest recompile). F29 (ii) and (iii) wait on that
  brainstorm too. The proposed slug is `signed-source-migration`.
- **Fact: the receiving brainstorm does not exist yet.** `.genie/brainstorms/` at `ee5753234` holds
  `gitlab-sdlc-connector`, `omni-local-daemon`, `omni-plugin-revamp`, `paired-agents` and `slack-personal-oauth`
  (checked 2026-11-01). The handoff names a slug with no home yet, as paired agents had none before R4-2. This round edits
  only this DRAFT, so it does not create it. Nothing in slices 1, 2 or 4 depends on it: R11-1 already fixes what holds
  until it lands.
- **What stays.** Slice 1 (Omni connector ingress, now, with the SDK rule from A31), slice 2 (GitLab connector) and slice 4
  (measurement), both after slice 1 merges and the R5-1 gate passes (A16). Slice 3 is built in the paired-agents
  brainstorm. The design carries A12 (a) to (h), A13 to A21 and A29 to A32. Decision #29's bus rule stays as round 11
  wrote it.
- **Nothing is open.** O33 is closed by R11-1 and O34 by R11-2. No other owner decision is pending, so this run
  crystallizes: the design covers the nine live Scope IN items and is reviewed against them.

## Size triage (round 3, unchanged in rounds 4 to 6)

**Round 12:** still G. R11-1 and R11-2 confirm the round 11 split: slices 1 (with A31), 2 and 4 stay here; slice 5 and
slice 5b go to `signed-source-migration`. No lower size is proposed, for the round 11 reasons.

**Round 11:** still G. If O33 and O34 agree, three slices stay here:
1. Omni connector ingress, now. It is M leaning G, and it gains the small SDK rule from A31.
2. The GitLab connector (M).
4. Measurement (P).
Slices 2 and 4 start after the R5-1 gate. Slice 3 is still built in the paired-agents brainstorm. Slice 5, and the
conditional slice 5b, go to the new `signed-source-migration` brainstorm. The lead keeps G: slice 1 alone leans G and
touches tenancy, the bus and the engine, and the slices are separated by an external gate. No lower size is proposed.

**Round 8:** still G, in five slices: 1 (Omni connector ingress, now), 5 (webhook-source migration, after slice 1 merges
and before paired agents land, A22), 2 and 4 (GitLab connector and measurement, after the R5-1 gate), and 3 (delivery,
built in the paired-agents brainstorm). Slice 5 is M leaning G: two connectors (`github` new, `clickup` widened),
the alias table and lookup, connector liveness with the heartbeat alias, a schema gate over `connector.*`, the
agent-manifest namespace, the per-source migration with dependant rewrites, the old-name and new-signed-source
refusals (A26, A28) and the docs. A generic signed connector (A27) is a conditional slice 5b, built only when the O32
read requires it.

**Round 7, after the scouts:** still G. **5. Webhook-source migration** is M leaning G and its own slice, after slice 1
merges (A22). It reuses slice 1's per-connector route, tenant lookup, connector-level secret column, connector-keyed
idempotency key and unmatched counters. What it adds: a `github` connector manifest and `parseDelivery` (O29), the old
URLs routed to connectors (O30), connector-level equivalents of the per-source features a migrated source uses (A24),
the agent-manifest namespace widened to `connector.*` (F22), a data migration that assigns tenants (A23) and rewrites or
refuses dependants, and the docs (F27). Slice 1's schema review agrees slice 5's columns, so slice 1's 0091 migration
does not wait.

**Round 7 (at dispatch, kept for the record):** still G. R6-2 adds a fifth piece of work: **5. Webhook-source migration** (M, size pending
S4 and S6). It is Omni-side and provider-neutral like slice 1, so under R3-2 it may proceed before paired agents land.
Whether it is its own slice or a widening of slice 1 is decided once S4 and S6 show how much of slice 1's per-connector
ingress it reuses.

**Still G, and it splits into four slices**, one of them outside this design:

1. **Omni connector ingress** (M, leaning G). This is the R1-1 change: a per-connector ingress route, typed event
   naming at journal time, subscription glob and optional target (a migration), an unmatched counter plus a doctor
   line, and the no-target branch fix with a ClickUp regression proof. Its change map is F4 plus, from round 3, a
   JetStream stream subject for the connector namespace (F12) and the two engine touch points (F14: the D7 gate must
   cover every connector-namespace type, and automation triggers need a decision on globs). F4 shows it touches tenancy
   (a connector-keyed lookup, policy and trigger) as well as the route. This slice is provider-neutral: the stream
   subject and the no-target guard repair the existing ClickUp path as well.
2. **GitLab connector, events only** (M). The manifest, `parseDelivery` to typed names (never throws), a custom HMAC
   verifier with an `X-Gitlab-Token` fallback, `webhook-id` as `providerEventId`, and the SDK rule change that lets a
   connector declare no actions (F8). No GitLab API token (F7).
3. **Captain delivery** (dependency). This rides on the paired-agent slices (C0 to C14): an agent-owned consumer, the
   C2 grant for rows with no instance, and the C8 fenced envelope. It is built elsewhere.
4. **Measurement** (P). The GitLab-history baseline against journal deliveries.

**Round 4:** R3-2 settled the sequencing: slice 1 proceeds now; slices 2 and 4 are designed here and start when the
paired-agent slices land; slice 3 is built elsewhere (its home is O11).

**Round 5:** slice 3's home is `.genie/brainstorms/paired-agents/` (R4-2). What "land" means is O23.

## WRS bar (round 12)

| Dimension | Score | Why |
|---|---|---|
| Problem | 20/20 | Unchanged. Every problem left in the design is stated from the code at `ee5753234` (HEAD has not moved): slice 1 (F4, F5, F12 to F15), slice 2 (F7 to F9, A15) and slice 4 (F11, F17, F28). R11-1 removes the migration's problem from this design and adds none. |
| Scope | 20/20 | R11-2 dropped the migration item. Nine live items remain, each with a change map and a slice: the ingress, no-target guard, stream subject, D7 gate and sealed hook-secret items in slice 1 (F4, F12, F14, F15, A30, A31); the connector package, event keys and multiplexing in slice 2, on slice 1's per-connector route (A15, A19); measurement in slice 4 (A17, A18, A20, A21). Row 13 is gone (R11-1). |
| Decisions | 20/20 | O33 and O34 are closed by R11-1 and R11-2; nothing is asked or open. Settled answers this design does not implement are named with where they bind (round 12 section). A29 to A32 are lead defaults the reviewer marked as needing no owner decision, and each adds scrutiny. |
| Risks | 20/20 | HIGH-1 and HIGH-2 leave with slice 5 (R11-1). MEDIUM-1, MEDIUM-2, LOW-1 and LOW-2 each have a mechanism and a test (A29 to A32). The coexistence of two credentialed ingress paths is stated, and its end now has a gate in a Settled answer: R11-1's "until that brainstorm lands". Slice 1 and 2 constraints are in the gap map. |
| Criteria | 20/20 | Slice 1: A12 (a) to (h), plus the A29 (forged dead letter refused), A30 (route discriminator and CHECK) and A32 (ClickUp byte-for-byte, no exception) tests. Slices 2 and 4: start gate A16, window A17, bar and explained misses A18, proof A19 to A21. The criteria set is fixed now that R11-1 and R11-2 are settled. |
| **Total** | **100/100** | |

**Round 11 (kept for the record):**

| Dimension | Score | Why |
|---|---|---|
| Problem | 20/20 | Unchanged. Every problem left in the design is stated from the code at `ee5753234`: slice 1 (F4, F5, F12 to F15), slice 2 (F7 to F9, A15) and slice 4 (F11, F17, F28). R10-1 narrows what the design must solve and adds no new problem. |
| Scope | 17/20 | The owner's R10-1 choice moves the migration out, but the ledger still lists the migration item and R6-2 still reads "Migrate in this design" (O33, O34). Once both are answered, nine live items remain, each with a change map and a slice. Row 13 is gone, and row 7 has a home (A31). |
| Decisions | 16/20 | Two bookkeeping questions are asked: O33 reopens R6-2 and O34 drops the item, each restating R10-1. Everything else is Settled. A29 to A32 are lead defaults the reviewer marked as needing no owner decision, and each adds scrutiny. |
| Risks | 19/20 | HIGH-1 and HIGH-2 leave with slice 5. MEDIUM-1, MEDIUM-2, LOW-1 and LOW-2 each have a named mechanism (A29 to A32). The coexistence of two credentialed ingress paths is stated, with its end in another brainstorm. Short of 20 because that end has no date or gate in this design. |
| Criteria | 19/20 | Slice 1: A12 (a) to (h), plus tests from A29 (a forged dead letter is refused), A30 (route discriminator and CHECK) and A32 (ClickUp byte-for-byte with no exception). Slices 2 and 4: A16 to A21. A25 to A28 leave with slice 5. Short of 20 until O33 and O34 settle which criteria the design carries. |
| **Total** | **91/100** | |

**Round 8 (kept for the record):**

| Dimension | Score | Why |
|---|---|---|
| Problem | 20/20 | Twenty-two Settled answers. Every problem in the design is stated from the code at `ee5753234`, which has not moved: slice 1 (F4, F5, F12 to F15), slice 2 (F7 to F9, A15), slice 4 (F11, F17, F28) and slice 5 (F20 to F26). |
| Scope | 20/20 | Eleven live items, each with a change map and a slice. Slice 5's boundary is fixed by R7-1 to R7-4: two per-provider connectors, aliases, renamed types, a catch-all, cutover per source. What production holds (O32) changes only which branch of A27 runs, and both branches are written. |
| Decisions | 20/20 | O28 to O31 are closed by R7-1 to R7-4; nothing is open or asked. The round 8 lead defaults (A26 to A28) follow from Settled answers and each adds scrutiny; none narrows what the owner approved. |
| Risks | 20/20 | Slice 1 and 2 risks are carried as constraints (gap map). Slice 5 risks each have a test: dependants left matching nothing (A25(a), A28), sender breakage (A25(c)), duplicates across the cutover and lost guards (A25(d)), no tenant or no equivalent feature (A25(e)), the D7 gate on rewritten automations (round 8), and unknown production contents (A25(f), A27). |
| Criteria | 20/20 | Slice 1: A12 (a) to (h). Slice 2 and 4: A16 to A21. Slice 5: A25 (a) to (g), with (b) now in final wording. The start gates are testable: slice 5 after slice 1 merges (A22), slices 2 and 4 after R5-1 (A16). |
| **Total** | **100/100** | |

**Round 7, after the scouts (kept for the record):**

| Dimension | Score | Why |
|---|---|---|
| Problem | 20/20 | The migration's problem is now stated from the code: what a signed source is (F20), what it publishes and journals (F21), who depends on its types and URLs and how they match (F22, F23), and what does not line up on a move (F26). |
| Scope | 18/20 | The migration has a change map and a slice (slice 5, after slice 1, A22). Short of 20: which sources exist and what they use is a pre-migration fact (O32), and A23 and A24 bound the item by refusal until that inventory is read. |
| Decisions | 16/20 | The four owner choices are asked: O29, O28, O30 and the new O31. A20 to A25 are stated lead defaults. Each answer fixes part of slice 5's change map, so they all stay open this round. |
| Risks | 18/20 | Assessed and named, each with a test (A25): dependants left matching nothing (F22), a second GitHub hook or 401s at the sender (F23), duplicates across the cutover and lost schema, liveness and heartbeat guards (F26), sources with no tenant (F25), and the body carried twice, which halves the payload ceiling for GitLab pushes too. Unknown until O32: live algorithms and dependants. |
| Criteria | 18/20 | Slice 5 has draft ship evidence (A25 (a) to (f)). Slice 4's zero-event proof is now real for tag_push, release, deployment and pipeline failure (F28, A21); only `job.failed` is a replay. A25's (b) wording waits on O31. |
| **Total** | **90/100** | |

**Round 7 at dispatch (kept for the record):**

| Dimension | Score | Why |
|---|---|---|
| Problem | 19/20 | Eighteen Settled answers. R6-2 adds a problem the DRAFT has not yet stated from the code: what existing signed webhook sources are, who depends on them and what they become as connectors (F18 only). |
| Scope | 16/20 | Ten live items. The new migration item has no change map, no boundary (which sources, the GitHub preset, when new signed sources are refused) and no slice placement yet. |
| Decisions | 15/20 | O26 and O27 are closed by R6-2 and R6-1. The migration opens owner choices not yet askable without facts: cutover versus dual-run, event-type continuity for existing consumers, URL continuity for existing senders (O28 to O30). A20 and A21 are stated lead defaults. |
| Risks | 16/20 | Slice 1 risks stay carried (F12, F13, F14, forgery, unmatched payloads). New and unassessed: a migration that renames a type existing consumers or automations filter on, or changes a URL a sender (GitHub) posts to, breaks them silently. A GitLab API token reappears for the proof (A20). |
| Criteria | 16/20 | Slice 1: A12 (a) to (h). Slice 4: window, bar, explained misses, start gate, and now a method for the zero-event categories (R6-1, A21). The migration has no ship evidence yet. |
| **Total** | **82/100** | |

**Round 6 (kept for the record):**

| Dimension | Score | Why |
|---|---|---|
| Problem | 20/20 | Sixteen Settled answers fix the direction, namespace, order, journal contents, where delivery is designed, and now a testable start gate (R5-1). The code confirms each problem (F4, F5, F12, F13, F14). |
| Scope | 19/20 | Nine live items, each with a change map. One boundary is still open: whether this design touches existing signed webhook sources, which R1-1's "merge webhook sources into connectors" leaves open (F18, O26). |
| Decisions | 18/20 | R5-1 to R5-4 closed O12, O23, O24 and O25. Open: the reopen of R5-4, because its method cannot run for releases, deployments or failed pipelines and jobs (F17, O27), and O26. A13 to A19 are stated lead defaults. |
| Risks | 19/20 | Carried as constraints: F12, F13, F14, `connector.*` forgery, no payload kept for unmatched deliveries, and now a zero-event proof that could pass on a non-failed pipeline status (F17). Also F19, a cross-brainstorm namespace drift that would make Brain's consumer match nothing. It is handed over, not fixed here. |
| Criteria | 18/20 | Slice 1: A12 (a) to (h). Slice 4: the window (R5-2, A17), the bar and what counts as an explained miss (R5-3, A18), and the start gate (R5-1, A16). The proof for the five zero-event categories is reopened (O27), so it has no executable criterion yet. |
| **Total** | **94/100** | |

**Round 5 (kept for the record):**

| Dimension | Score | Why |
|---|---|---|
| Problem | 19/20 | Twelve Settled answers fix the direction, the namespace (R3-1), the order (R3-2), what enters the journal (R4-1) and where delivery is designed (R4-2). The code confirms the problem (F4, F5, F12, F13). The one soft edge: the delivery end is a brainstorm with nothing settled yet. |
| Scope | 19/20 | Every item a Settled answer contradicted is dropped (R3-3, R3-4, R4-3, R4-4); nine items remain, each with a change map in the repo (F4, F12, F14, F15, F16) and a boundary with paired agents written as an interface (round 5). Short of 20 only because slices 2 and 4 have no start condition yet (O23). |
| Decisions | 17/20 | R4-1 fixed the data model, the idempotency key and the counter's contents. Asked now: the gate (O23), the window (O12), the pass bar (O24) and the zero-event phases (O25). A13, A14 and A15 are stated lead defaults. |
| Risks | 18/20 | Carried as constraints: cross-tenant no-target fan-out (F13), typed names escaping the D7 gate (F14), publishes failing with 500 for lack of a stream (F12), the tenancy surface of a per-connector URL (F4), `connector.*` forgery through `/events/trigger`, and now no payload kept for unmatched deliveries (R4-1). F12 in production is unverified; it is a pre-cutover check (A12(h)), and slice 1 fixes it either way. |
| Criteria | 15/20 | A12 (a) to (h) is slice 1's ship evidence, with (d) and (e) now in final wording. Slice 4 has a method (A8) and endpoints (F11) but no window (O12), no pass bar (O24) and no rule for CI and release phases that produce zero events today (O25). Slices 2 and 4 have no testable start condition (O23). |
| **Total** | **88/100** | |

## Gap map

**Round 12 view (supersedes the earlier views below where they differ):**

- **Settled:** everything through R11-2. R11-1 records R10-1's reopen of R6-2 ("Migrate in its own brainstorm"), and
  R11-2 records its scope drop.
- **Closed this round:** O33 (R11-1), O34 (R11-2).
- **Open:** nothing. **Asked:** nothing.
- **Blocks what:** nothing blocks writing the design. It covers slices 1, 2 and 4 against the nine live Scope IN items.
  R10-1's option promised a fresh repair budget for the re-review; the workflow script owns that budget.
- **Delivery order:** slice 1 now, with the SDK rule (A31). Slices 2 and 4 after slice 1 merges and the R5-1 gate passes
  (A16; C0 was last seen in progress, not live). Slice 3 in the paired-agents brainstorm.
- **Handed elsewhere:** the migration, with R7-1 to R7-4, F18, F20 to F28, A22 to A28, O32, HIGH-1 and HIGH-2, to
  `signed-source-migration`, which does not exist yet (round 12 section). F19 and F29 (i) stay with paired agents; F29
  (ii) and (iii) wait on the migration brainstorm.

**Round 11 view (kept for the record):**

- **Settled:** everything through R8-1, plus R10-1 (split it out). The ledger records R10-1's label but not the
  reopen or the scope drop its option described.
- **Asked this round:** O33 reopens R6-2 ("Migrate in this design" → "Migrate in its own brainstorm"). O34 drops the
  migration item from Scope IN. Both restate the owner's R10-1 pick.
- **Lead defaults this round:** A29 to A32, for MEDIUM-1, MEDIUM-2, LOW-1 and LOW-2.
- **Blocks what:** O33 and O34 block writing the design, because Scope IN and R6-2 still name slice 5. Nothing else
  blocks it. When both agree, the run can crystallize: slices 1, 2 and 4, a fresh repair budget, and a review against
  the nine remaining items.
- **Delivery order after the split:** slice 1 now, including the SDK rule (A31). Slices 2 and 4 come after slice 1
  merges and the R5-1 gate passes (A16; C0 is in progress, not live). Slice 3 is built in the paired-agents brainstorm.
- **Handed elsewhere:** the migration goes to a new `signed-source-migration` brainstorm with R7-1 to R7-4, F18, F20
  to F28, A22 to A28, O32 and the round 10 HIGH-1 and HIGH-2. That brainstorm is not created here. F19 and the C2 and
  C5 items of F29 stay with paired agents. F29 (ii) and (iii) now wait on the new brainstorm, not on this design.

**Round 8 view (kept for the record):**

- **Settled:** everything through R7-4.
- **Closed this round:** O28 (R7-2), O29 (R7-1), O30 (R7-3), O31 (R7-4).
- **Moved out of Open as a fact:** O32 is the pre-migration check A25(f); A27 says what each finding leads to.
- **Open:** nothing. **Asked:** nothing.
- **Blocks what:** nothing blocks writing the design. Delivery order: slice 1 now; slice 5 after slice 1 merges and
  before paired agents land (R3-2, A22); slices 2 and 4 after the R5-1 gate (A16; C0 is in progress, not live); slice 3
  in the paired-agents brainstorm; slice 5b only if A27 calls for it.
- **Handed elsewhere:** F19 and the C2 and C5 items of F29 stay with the paired-agents brainstorm, as does O8.

**Round 7 view, after the scouts (kept for the record):**

- **Settled:** unchanged (everything through R6-2).
- **Asked this round:** O29 (what a signed source becomes), O28 (cutover model), O30 (URL and type continuity) and O31
  (what a migrated source journals under R4-1).
- **Fact pending, not for the owner:** O32, the production inventory of signed sources and their dependants. It becomes
  the pre-migration check A25(f).
- **Blocks what:** O29 fixes the slice 5 manifest work and whether the SDK needs config-aware verification. O28 and O30
  fix the data migration, the alias routing and A25 (a), (c) and (d). O31 fixes A25(b). They do not block slice 1's data
  model, gate rule, stream subject or no-target guard. Slice 1's connector-level secret column has to hold a copied
  same-tenant ciphertext (F25); that is agreed in slice 1's schema review, whatever O29 says. F28 unblocks slice 4's
  zero-event criterion (A20, A21).
- **Handed elsewhere:** F19 is still open in the paired-agents DRAFT, and two new items about C2 and C5 go with it (F29).
  O8 stays there.

**Round 7 view at dispatch (kept for the record):**

- **Settled:** everything through R5-3, R5-4 as reopened by R6-1 (real objects via API), and R6-2 (migrate signed
  webhook sources in this design).
- **Closed this round:** O26 (R6-2), O27 (R6-1).
- **Open, facts pending scouts:** O28 (cutover model), O29 (what a signed source becomes as a connector), O30 (event-type
  and URL continuity for existing senders and consumers). They are asked after S4 and S6 report.
- **Blocks what:** O28 to O30 block the migration's change map, criteria and slice placement. They do not block slice 1's
  data model, gate rule, stream subject or no-target guard, unless S6 finds the migration should reuse slice 1's
  per-connector route and secret column, in which case slice 1's schema waits for O29. S7 can only add proof to slice 4's
  zero-event criterion; it blocks nothing.
- **Handed elsewhere:** F19 and O8 stay with the paired-agents brainstorm; S5 checks whether F19 is fixed.

**Round 6 view (kept for the record):**

- **Settled:** everything through R4-4, plus R5-1 (delivery minimum), R5-2 (7-day windows), R5-3 (99%, misses
  explained) and R5-4 (test-hook proof, now asked as a reopen).
- **Closed this round:** O12 (R5-2), O23 (R5-1), O24 (R5-3), O25 (R5-4; reopened as O27 on F17's evidence).
- **Asked this round:** O27, which reopens R5-4 on how the five zero-event categories are proven, and O26, what this
  design does to existing signed webhook sources (A9).
- **Blocks what:** O27 blocks slice 4's criterion for pipeline and job failures, tag_push, release and deployment. O26
  blocks the scope boundary of slice 1: whether it leaves the webhook-source ingress alone (A9), refuses new signed
  sources, or migrates them. Nothing open blocks slice 1's data model, gate rule, stream subject or no-target guard.
- **Handed elsewhere:** F19 (`custom.gitlab.*` drift) goes to the paired-agents brainstorm. O8 and A2 are delivery-side
  and stay there.

**Round 5 view (kept for the record):**

- **Settled:** R1-1 as reopened by R3-1, R1-2, R1-3, R1-4, R3-2, R3-3, R3-4, and this round R4-1 (matched deliveries
  only), R4-2 (paired agents get their own brainstorm), R4-3 (allowlist item dropped), R4-4 (token item dropped).
- **Closed this round:** O11 (R4-2), O19 (R4-3), O20 (R4-4), O22 (R4-1).
- **Moved out of Open as facts, visibly:** O21 becomes the pre-cutover check A12(h); O8 is handed to the paired-agents
  brainstorm, since it concerns delivery only.
- **Asked this round:** O23 (what "paired agents land" means for starting slices 2 and 4), O12 (the measurement
  window), O24 (the pass bar), O25 (CI and release phases with zero events today).
- **Blocks what:** O23 blocks the start condition of slices 2 and 4. O12, O24 and O25 block slice 4's criteria only.
  Nothing open blocks slice 1: its data model, key, counter, gate rule, stream subject, registry widening and no-target
  guard are fixed by Settled answers and A12 to A15.

**Round 4 view (kept for the record):**

- **Settled:** R1-1 as reopened by R3-1 (ingress design, typed names under `connector.<provider>.*`), R1-2 (no actions
  in v1), R1-3 (wait for paired agents), R1-4 (baseline source), R3-2 (Omni work now, GitLab waits), R3-3 (actions item
  dropped), R3-4 (Mac-dispatcher item dropped).
- **Closed by those answers:** O1 and O10 (R3-4), O2 (R1-3), O5 (R1-1), O6 and O9 (R3-3, R1-2), O13 (R3-2), O15
  (R3-1), and the baseline source half of O3.
- **Moot while actions stay out:** O4 and the token-role half of O7.
- **Closed by facts:** O14 (no GitLab token in v1, F7), O16 (ClickUp URLs stay, F6, A10), O7 on the docs side (A3),
  O17 (no stream subject for `connector.>`, F12, from code), O18 (no tenant filter, F13), the counter's home (F15) and
  the migration number (F16).
- **Asked this round:** O22 (what enters the journal), O11 (where paired agents are designed), O19 (drop the allowlist
  item), O20 (drop the token item).
- **Added to Scope IN this round by the lead (adds scrutiny; the ledger records it after this round):** the D7 gate
  over every connector-namespace type, and the sealed connector-level hook secret (round 4 section).
- **Blocks what:** O22 blocks slice 1's data model (whether an unmatched delivery gets a journal row or only a counter
  bump), A12(d) and A12(e), the idempotency key's scope and what paired-agent C2's grant names. O11 blocks the gate
  that starts slices 2 and 4. O19 and O20 block a clean Scope IN. None of them blocks the stream subject, the registry
  widening, the D7 gate rule or the no-target guard, which are fixed now.
- **Open, blocking criteria:** O12 (window), waiting because go-live waits on paired agents; asked next round.
- **Open, waiting:** O21 (live check of F12; implementation or a scout with a key).
- **Open, blocking delivery (outside this design):** the paired-agent programme, and O8 (an authenticated probe of
  <internal-host>).

**Note on the constraints below:** the `hc send` constraints now belong to the paired-agent delivery side (C12: drain
at hook boundaries or through a supervisor, never by polling inside a session). The `set_labels` and token-role
constraints are parked with the actions slice. The rest bind slices 1 and 2.

**Constraints the design must carry** (facts, not questions):

- GitLab disables a hook temporarily after 4 consecutive non-2xx responses and permanently after 40. Omni returns
  500 when `parseDelivery` throws (`packages/api/src/services/connectors.ts:886-902`), so the GitLab
  `parseDelivery` must never throw on an unexpected `object_kind`; a non-matching key gets a 202 ignored ack
  (`:904-909`), which GitLab counts as success. **Round 3:** a failed bus publish also returns 500 (F12), so the
  stream subject must exist before a GitLab hook points at Omni, or 40 deliveries disable the hook for good.
- Deduplication: GitLab's `webhook-id` (also sent as `Idempotency-Key`) stays constant across retries and resends;
  using it as `providerEventId` lets Omni's per-subscription idempotency key absorb duplicates
  (`packages/api/src/services/connectors.ts:164-178`). **Round 2:** under per-connector ingress the key must be scoped
  to the connector, since one delivery can match several subscriptions (F4). The exact GitLab header names are
  still from docs, not the repo.
- Event-key facts: an MR merge is `object_attributes.action = 'merge'` with `state = 'merged'`; job events are
  `object_kind = 'build'`, not `job`; pipeline failure is `object_attributes.status = 'failed'`; release carries a
  top-level `action`; push and tag push carry no `action`. Subscription filters are exact-match over `data`
  (`connectors.ts:142-162`), so per-action keys need either distinct event keys or `action` filters.
- A subscription's `eventKey` must be declared in the manifest (`connectors.ts:577-580`) and its target automation
  must exist with `triggerEventType = 'connector.event'` (`:552-565`). The check does not look at whether the
  automation is enabled, and the journal insert does not depend on it, so a dispatcher-only subscription can point
  at a disabled placeholder automation. (Read from code; not exercised.) **Superseded by R1-1** once the target is
  optional; until then it describes today's code only.
- The D7 target gate covers only the literal `connector.event` and automation triggers match exact names (F14); a
  typed connector event must not reach an automation by escaping the gate.
- Consumers have no max-deliver, no dead-letter and no attempt counter
  (`packages/api/src/services/event-consumers.ts`). A fan-out consumer re-pulls an unacked page forever; the
  dispatcher must skip and record a poison event itself.
- `omni events follow --consumer` acks right after printing a page, which is at-most-once if `hc send` fails
  afterwards (`packages/cli/src/commands/events.ts:1106-1165`). A dispatcher that wants at-least-once calls pull and
  ack over HTTP and acks only after a successful send.
- `hc send` pastes text into the agent's TUI and submits it. It refuses a `blocked` terminal unless `--force`, can
  drop a send to a booting agent, has no idempotency, and exits 3 (`not_found`) or 11 (`finished`) for gone
  terminals. Its size limit and how pasted newlines or slash commands in untrusted comment text behave are
  unverified; writing the body to a file and sending the path avoids both.
- Tokens: all four write endpoints need a token with `api` scope (`read_api` covers GET/HEAD only). Project access
  tokens work on Self-Managed with any license and reach only their project. The minimum role per action is not
  documented on the endpoint pages; no guess is recorded here.
- `set_labels` maps to `PUT /projects/:id/merge_requests/:iid` or `/issues/:iid` with `add_labels` and
  `remove_labels`; unknown labels are created as project labels. On issues, `add_labels`/`remove_labels` do not
  satisfy the "at least one parameter" rule on their own per the docs; this needs a live check.
- **Round 7 (F26): payload size.** A connector event carries the body twice (`{...data}` plus `rawPayload`,
  `services/connectors.ts:185-211`), so a typed row reaches NATS `max_payload` at about half the body size a webhook
  source allows. A large GitLab push (many commits) is the likely case. Any non-2xx answer (413 as much as 500)
  counts toward the 40 that disable the hook for good. Slice 1 either carries the body once in typed rows (ClickUp's
  `connector.event` rows stay byte-for-byte, A12(c)), or has a test with a push near the ceiling that shows which
  answer GitLab gets and how the miss is counted and shown (A18's "refused by Omni").


## Open

Round 12: nothing is open. O33 is closed by R11-1 (R6-2 reopened to "Migrate in its own brainstorm") and O34 by R11-2
(the migration item dropped). O32 goes to `signed-source-migration` with the migration.

Round 11: O33 and O34 are asked (at the end of this list). They record the owner's R10-1 pick in the ledger. No other
decision is open.

Round 8: nothing is open. O28 is closed by R7-2, O29 by R7-1, O30 by R7-3 and O31 by R7-4. O32 leaves Open as a fact: it
is the pre-migration check A25(f), and A27 says what each finding leads to.

Round 7, after the scouts: O28, O29 and O30 are asked, with the new O31. O32 is a fact for a pre-migration read, not for
the owner (all at the end of this list).

Round 7 at dispatch: O26 is closed by R6-2 and O27 by R6-1. Open, facts pending scouts, not asked yet: O28, O29, O30 (at the end of
this list).

Round 6: O12, O23, O24 and O25 are closed by R5-1 to R5-4. Open, both asked this round: O26 and O27 (at the end of this
list).

Round 5: O11, O19, O20 and O22 are closed by R4-1 to R4-4; O8 and O21 move out of Open as facts (see each entry).
Still open, all asked this round: O12, O23, O24, O25.

Round 4: O1, O9, O10, O13 and O15 are closed by R3-1 to R3-4 (kept below for the record).

- O1. **Closed by R3-4**: no dispatcher; delivery goes through paired agents.
- O2. **Closed by R1-3**: routing is each paired agent's own declaration.
- O3. **Half closed by R1-4** (the source is GitLab history). The rest is O12.
- O4. `set_labels` add/remove versus replace. **Parked** with the actions slice (R1-2); A7 is the recorded default.
- O5. **Closed by R1-1.**
- O6. **Closed by R1-2.**
- O7. **Closed on the docs side (S3):** CE 19.5.1 accepts `signing_token`; a live check waits for implementation,
  since it needs a hook. The token-role half is moot under R1-2.
- O8. **Moved out of Open (round 5):** an authenticated `GET /api/v2/events/consumers` against <internal-host>. It needs a
  key for that host and concerns delivery only, so it is handed to the paired-agents brainstorm (R4-2).
- O9. **Closed by R3-3**: the actions item is dropped.
- O10. **Closed by R3-4**: the Mac-dispatcher item is dropped.
- O11. Where the paired-agent design is made: its own brainstorm that this one depends on (lead's recommendation),
  folded into this one, or somewhere the owner already has in mind. Still no brainstorm or wish for paired agents under
  `.genie/` (checked round 4). **Closed by R4-2**: its own brainstorm, now at `.genie/brainstorms/paired-agents/`.
- O12. The baseline window under A8. (Owner.) Go-live waits on paired agents and the project is days old (F11), so the
  window is a rule relative to go-live: equal windows before and after. At F11's rate (~750 in-scope events a day) a
  7-day window holds thousands of events and covers one weekly cycle. **Asked in round 5.**
- O13. **Closed by R3-2**: Omni work now, GitLab waits.
- O14. **Closed (fact, S2, F7):** no GitLab API token in v1; the operator registers the hook by hand, as for ClickUp.
- O15. **Closed by R3-1**: typed names are `connector.gitlab.*`.
- O16. **Closed (fact, S1, F6):** the subscription-id route stays beside a new connector route; see A10.
- O17. **Closed by code reading (F12):** no stream holds `connector.>`; the live half is O21.
- O18. **Closed (F13):** the engine's automation list is not tenant-filtered; the no-target fan-out crosses tenants.
- O19. Where "dispatcher author allowlist and comment text passed as quoted untrusted data" lives once the dispatcher
  is gone: fencing is paired-agent C8 (a server-side fenced envelope), and an author allowlist can be the paired
  agent's consumer filter (A1: eq/neq/contains/regex over the journaled payload). **Asked in round 4** as a scope-drop,
  with the alternative of keeping it as a connector-side duty. **Closed by R4-3**: dropped.
- O20. The Scope IN item "GitLab token sealed in Omni and never exposed to agents" has nothing to seal in v1 (F7,
  R1-2, R3-3). The secret v1 does hold, the connector-level hook secret, is now its own Scope IN item (round 4).
  **Asked in round 4** as a scope-drop; the token invariant returns with any later actions slice. **Closed by R4-4**:
  dropped.
- O21. (Fact, implementation or the next scout with a key.) Whether production NATS has a stream holding `connector.>`
  today, read as stream info or one authenticated test delivery. It decides whether F12 is a live ClickUp outage or a
  gap something outside the repo already covers; slice 1 adds the subject either way. **Moved out of Open (round 5):**
  it is the pre-cutover check A12(h).
- O22. What enters the journal under per-connector ingress. R1-1(2) journals each event under its typed name so a
  consumer can glob it; R1-1(4) makes unmatched deliveries "visible (counter plus a doctor line), never silently
  dropped". It does not say whether a verified delivery matching no subscription gets a journal row. Either (a) only
  matched deliveries are journaled, a no-target subscription is how a category is opted in, and unmatched ones are
  counted on the connector (F15) without keeping the payload; or (b) every verified delivery is journaled, subscriptions
  only bind automations, and the counter tracks deliveries no subscription claimed. It decides the data model, A12(d)
  and (e), the idempotency key's scope, what paired-agent C2's grant names, and how much GitLab payload (push payloads
  carry commit messages and author emails) Omni keeps. **Closed by R4-1**: (a), matched only.
- O23. What "paired agents land" means, so the start of slices 2 and 4 is testable. R3-2 holds GitLab until paired
  agents land; the paired-agent council lists C0 to C14. The lead's minimum is the set a single agent-owned consumer
  needs to receive `connector.gitlab.*` rows safely: C0 (pull applies the instance clause), C1 (consumer ownership), C2
  (per-source grant for NULL-instance rows, proven with a `connector.gitlab.*` row), C3 (agent-bound child key), C4
  (consume-only scope), C8 (fenced envelope, no secrets in delivered rows) and a C12 drain for at least one captain,
  merged and deployed on <internal-host>. C5 (emission guard), C9 (loop guard) and C10 (verb targets) matter once agents
  emit or act, which v1 does not (R1-2); C11 (pairing UX) and C13 (40-agent benchmark) are rollout, not first delivery.
  **Asked in round 5.** No option lets GitLab work start before delivery lands, which would change R3-2.
- O24. The pass bar for the measurement ratio (A8: events journaled and acked by an owning agent's consumer, divided
  by in-scope events in GitLab history over the same window). **Asked in round 5.**
- O25. CI and release phases produce zero events today: khal/brain has no runners, 2 pipelines, no tags, releases or
  deployments (F11), so their ratio is 0/0. **Asked in round 5.** The lead's recommendation proves each such category
  with one GitLab test-hook delivery (project hooks offer a per-trigger test; 5 per minute, A4) journaled and acked,
  and reports it as "no live events" rather than counting it in the ratio.
- **Round 6:** O12 is closed by R5-2, O23 by R5-1, O24 by R5-3 and O25 by R5-4.
- O26. What this design does to existing **signed** webhook sources (F18). R1-1 says "merge webhook sources into
  connectors" and "webhook sources remain only for credential-less ingress". The generic ingress already verifies
  HMAC and token-match with a sealed secret, and the CLI's GitHub preset uses it. A9 assumed nothing changes for them.
  **Asked in round 6.** The lead recommends leaving them unchanged and giving the migration its own later design. Two
  credentialed paths then coexist for a while, which the design states.
- O27. **Reopens R5-4.** F17 shows the approved test-hook proof cannot cover deployments (no project-hook test trigger)
  or releases (khal/brain has none). For pipelines and jobs it replays the latest real status, never a failure. **Asked
  in round 6.** The lead recommends real objects created through the GitLab API (a release with its tag, and a deployment
  in a throwaway environment), delivered live by GitLab. Pipeline and job failures need a runner. Without one, they fall
  back to a signed replay of GitLab's documented payload with `status: failed`, reported as such.
- **Round 7:** O26 is closed by R6-2 (migrate in this design) and O27 by R6-1 (real objects via API).
- O28. **Cutover model for signed webhook sources (owner, after S4 and S6).** Whether existing signed sources move in one
  cutover, or run side by side as connector and source for a period with a stated end, and when new signed sources are
  refused. It sets the migration's risk and its criteria.
- O29. **What a signed source becomes (owner where it is a product choice, after S4 and S6).** A per-provider connector
  (a `github` connector beside `gitlab`), a generic signed connector carrying the source's strategy (`hmac-sha256`,
  `hmac-sha1`, `token-match`), or both. It decides whether the migration reuses slice 1's per-connector route and
  connector-level secret.
- O30. **Continuity for existing senders and consumers (owner, after S4).** Whether a migrated source keeps its URL and
  the event type existing automations and consumers match on, or moves to the connector URL and a `connector.<provider>.*`
  type with every dependant updated in the same change. A rename that leaves a filter matching nothing is the silent
  failure the doctrine forbids, so whichever is chosen, the design proves no dependant is left unmatched.
- **Round 7, after the scouts:** O28 to O30 are asked, with the facts in F20 to F26. The recommendations come from S6's
  reading of the code:
  - O29: per-provider connectors. A new `github` connector takes the preset, whose static `hmac-sha256` fits the SDK
    unchanged (F24), and ClickUp signed sources go into the existing `clickup` connector, whose manifest verification
    already matches (F24). A generic signed connector is built only if O32 finds signed sources from other providers,
    because it needs config-aware `verify` and `parseDelivery` and event names read from config, which works against
    R1-1's typed events.
  - O28: cutover per source, by a migration that refuses to run while a dependant it cannot rewrite remains.
  - O30: both old URLs stay as permanent aliases, and types are renamed to `connector.github.<event>[.<action>]` with
    every dependant rewritten. Keeping `custom.github.*` is not offered, because it would reverse R3-1 and break C5.
- O31. **What a migrated source journals (owner, asked in round 7).** Today every verified delivery is journaled
  (F21). Under R4-1, a connector journals only deliveries a subscription matches. The lead recommends that the migration
  create one no-target catch-all subscription (`connector.github.*`) per migrated source, which stays inside R4-1 and
  keeps today's journal contents. The alternative is no catch-all: categories nobody subscribes to stop being journaled
  and are only counted, a behaviour change that is announced to existing consumers.
- O32. **Production inventory (fact, for an authenticated read; not for the owner).** How many signed sources exist,
  which algorithm and tenant each has, whether any sets `poll_config`, `expectedHeaders`, `strict_schemas` or the
  across-types flag, and which automations, durable consumers, agent manifests and schemas name `custom.<src>.*` or
  `custom.webhook.<src>`. Also, for each ClickUp signed source, whether its header and encoding match the `clickup`
  manifest (F24). No scout could read a database. Like O21, it becomes a pre-migration check (A25(f)).
  **Round 11:** if O34 drops the migration item, O32 goes to the new brainstorm with it.
- O33. **Reopens R6-2 (asked in round 11).** R10-1's picked option said "Reopens R6-2 ('Migrate in this design' →
  'Migrate in its own brainstorm')". The ledger records a reopen only from a question that names it. The lead
  recommends recording it: the migration moves to its own brainstorm, and row 13 goes. The other option keeps R6-2,
  which brings back HIGH-1 and HIGH-2 as questions for the owner.
- O34. **Drops the migration item from Scope IN (asked in round 11).** The item is "existing signed webhook sources
  (hmac-sha256, hmac-sha1, token-match) and the CLI GitHub preset migrate into connectors per R6-2; webhook sources keep
  only credential-less ingress". It leaves this design only through a `scope-drop:` answer. It is asked separately
  from O33 so that the drop does not ride along with the reopen.

## Assumed

- A2 (the deployed routes, inferred from the version) is still an assumption; it blocks only the delivery dependency.
- A6 is superseded by R1-3 and R3-4.
- A7 is parked with the actions slice.
- **A8 (load-bearing, so it became O12).** khal/brain has 0 webhooks today, so every in-scope GitLab event in a
  window reached a captain only by hand relay or not at all. Baseline = the count of in-scope events per category over
  window W, from the GitLab API. Success = events journaled and delivered automatically, divided by in-scope events,
  over an equal window after go-live, read from the Omni journal and consumer acks. **Round 2:** the denominator counts
  push events, not commits, because one push is one hook delivery; MR comments come from the events API, since GitLab
  has no project-wide notes counter (F11). The window is O12.
- **A10 (from F6).** Existing ClickUp subscriptions keep `POST /api/v2/connectors/events/:subscriptionId` with
  their per-subscription secrets, lookup and idempotency key; the per-connector route is added beside it. This is what
  R1-1's "ClickUp is unchanged" requires; nothing is migrated.
- **A11 (from F8).** The SDK registry stops requiring at least one action, so an events-only connector registers
  without a placeholder action. The rule is relaxed only for actions; at least one event stays required.
- **A9.** "Merge webhook sources into connectors" changes only credentialed ingress. Existing webhook sources
  and the GitHub recipe keep working unchanged, as R1-1's last sentence says. Nothing is migrated.
- **A12 (binds from round 4: slice 1's ship evidence, now that R3-1 and R3-2 are settled).** (a) A real-NATS test, not
  the in-memory bus, publishes `connector.event` and one typed connector name (`connector.gitlab.merge_request.merged`)
  and reads each back from a durable consumer and the journal. (b) The no-target guard: a `connector.event` and a
  typed connector event with no target fire no automation, in a test with two tenants. (c) A ClickUp regression: an
  existing subscription, its URL, secret, idempotency key and bound automation behave byte-for-byte as before. (d) An
  unmatched delivery increments the connector's counter and shows in `omni doctor`. (e) A delivery matching two
  subscriptions journals once. Round 4 adds: (f) `POST /events/trigger` refuses a `connector.*` type; (g) no journaled
  row or delivered event contains the hook secret. Items (d) and (e) take their final wording from O22.
  **Round 5 (R4-1):** (d) a verified delivery that matches no subscription writes no journal row and no payload; it
  increments `total_unmatched`, sets `last_unmatched_at` and the last unmatched typed name on the connector, and the
  authenticated doctor read (A14) shows them. (e) A delivery matching two subscriptions writes one row under
  `connector:{connectorId}:{providerEventId}`, carrying both subscription ids; a GitLab retry with the same
  `webhook-id` writes nothing new. (h) Before any provider hook points at the per-connector route in production, stream
  info on the production NATS (or one authenticated test delivery) shows a stream holding `connector.>` (from O21).
- **A13 (lead default, from F14, read from R1-1(3) "today's one-key-one-automation rule stays a special case").**
  Automation triggers stay exact-match in v1; a typed connector event reaches an automation only through a
  subscription that names it as target, and the D7 gate applies to every `connector.*` type, not only the literal
  `connector.event`. Consumers get globs (F2). This keeps the engine change to the gate. Whether a targeted
  automation's trigger is `connector.event` or the typed name is a design detail, fixed in the design with a ClickUp
  regression proof.
- **A14 (lead default, round 5; adds scrutiny).** The doctor line reads the connector counters through an authenticated
  connectors API call from the CLI. They never go into `/api/v2/health`, which answers without a key (A2), so a tenant's
  connector names and unmatched counts are never public.
- **A15 (lead default, round 5; design detail).** GitLab typed names are `connector.gitlab.<kind>[.<verb>]`, read from the
  payload facts already recorded: `issue.opened|updated|closed|reopened`, `push`, `tag_push`,
  `merge_request.opened|updated|merged|closed`, `note.merge_request` (and `note.issue` etc. by `noteable_type`),
  `pipeline.<status>`, `job.<status>` (from `object_kind = 'build'`), `release.<action>`, `deployment.<status>`.
  `parseDelivery` never throws: an unknown `object_kind` gets a typed name too (`connector.gitlab.<object_kind>`) and is
  counted as unmatched unless a subscription matches it.
- **A9 (round 6): load-bearing, so it became O26.** Until O26 is answered, the design keeps A9's reading: existing
  webhook sources, signed ones included, are untouched.
- **A16 (round 6, from R5-1; design detail).** The gate that starts slices 2 and 4 is the merged and deployed tests of
  C0, C1, C2 (with a `connector.gitlab.*` row), C3, C4, C8 and one C12 drain, each checked on <internal-host> by an
  authenticated probe (O8, handed to paired agents). The gate names the conditions, not their final wording, so the
  paired-agents brainstorm's open R1-1 and R1-3 do not change it.
- **A17 (round 6, from R5-2; design detail).** Go-live is when the GitLab hook first points at the per-connector URL while
  the owning agent's consumer is live. The baseline window is the 7 days just before go-live, read from the F11 GitLab
  endpoints. The measured window is the 7 days just after it, read from the journal and consumer acks.
- **A18 (round 6, from R5-3; adds scrutiny).** "Misses explained" means every in-scope GitLab event in the measured window
  without a journaled and acked row is listed with one cause: not sent (GitLab hook log), refused by Omni (non-2xx, with
  the ingress log line), unmatched (connector counter) or journaled but not acked (consumer). An unexplained miss fails the
  bar even when the ratio is 99% or higher.
- **A19 (round 6, from F17; implementation check).** `providerEventId` is `webhook-id`, then `Idempotency-Key` when the
  first is absent, then a SHA-256 of the raw body. Before cutover, one real delivery and one test delivery are captured.
  The capture shows whether each carries `webhook-id` and whether each is signed with the signing token. A test delivery
  that is not signed is refused under signing-token verification, so the zero-event proof does not depend on it.

- **A9 (round 7): superseded by R6-2.** Existing signed webhook sources migrate in this design; how is O28 to O30.
- **A20 (round 7, from R6-1; adds scrutiny).** The real-object proof (a tag, a release, a deployment in a throwaway
  environment, created through the GitLab API) runs with a GitLab token held by the operator running the proof, with the
  smallest role and scope that can create those objects, revoked or expired after the proof. It is never stored in Omni,
  never given to the connector and never reaches an agent, so R4-4 and F7 (Omni holds no GitLab token in v1) stay true.
- **A21 (round 7, from R6-1; the picked option's description).** Pipeline and job failures need a runner, and khal/brain
  has none (F11). Without one, each falls back to a replay of GitLab's documented payload with `status: failed`, signed
  with the hook's signing token, sent to the per-connector URL and reported as a replay, not a live event. If S7 shows
  GitLab can produce a real failed pipeline or job without a runner, that category uses the real object instead.
- **A22 (round 7, provisional).** The migration is Omni-side and provider-neutral, so under R3-2 it proceeds before paired
  agents land, as its own slice 5 until S4 and S6 show whether it is better as a widening of slice 1.

**Round 7, after the scouts:**

- **A16 (round 7 update, from F29).** The paired-agents brainstorm has now settled its R1-1 (the C0 fix ships first, on
  its own) and R1-3 (no typed connector actions, no `connectors:invoke`). As expected, neither changes the gate. Its C2
  wording is unchanged, and its proof row is still a `connector.gitlab.*` row.
- **A20 (round 7 update, from F28; adds scrutiny).** The proof token has `api` scope and the Developer role on khal/brain
  only. A protected-tag rule allows the proof tag pattern (`omni-proof-*`). If creating the release is refused with
  Developer (the docs disagree, F28), that one call is made with a Maintainer token held the same way. The proof objects
  are named for the proof (tag `omni-proof-*`, environment `omni-proof`, branch `omni-proof/*`). They are reported in the
  zero-event proof and listed apart from the measurement ratio, so a proof object never counts as an in-scope event.
- **A21 (round 7 update, from F28).** Four of the five categories are now live GitLab deliveries:
  - tag_push and release come from one `POST /releases` with a new tag;
  - deployment comes from `POST /deployments`, then a `PUT` to `failed` in a throwaway environment;
  - pipeline failure comes from a push of an invalid `.gitlab-ci.yml` to a throwaway branch, with an external commit
    status set to `failed` as a second route.
  Only `job.failed` stays a signed replay of GitLab's documented `build` payload, reported as a replay, because a real
  job hook comes only from a `Ci::Build`, which needs a runner. The harness never assumes the order of the release and
  tag_push deliveries.
- **A22 (round 7 revision, from S6).** The migration is its own slice 5, after slice 1 merges. It reuses slice 1's route,
  tenant lookup, secret column, idempotency key and counters. Folding it into slice 1 would bring GitHub parsing and
  dependant rewrites into a provider-neutral slice that already leans G. Slice 1's schema review agrees the columns
  slice 5 needs, so slice 1 does not wait for O28 to O31.
- **A23 (round 7, from F25; adds scrutiny).** No tenant, no migration. A signed source moves only to a connector of a
  named tenant. Until G6 gives `webhook_sources` an owner, the tenant comes from an explicit operator mapping per source,
  and the migration refuses an unmapped source by name. A NULL-tenant or unsealed secret is sealed by the app under the
  assigned tenant, never copied as plaintext. Implementation check: whether the connector ingress SECURITY DEFINER
  lookup accepts a NULL-tenant connector (it must not be needed).
- **A24 (round 7, from F20 and F26; adds scrutiny).** No per-source feature is dropped silently. For each feature a source
  uses (schema gate and `strict_schemas`, liveness and heartbeat, `expectedHeaders`, the idempotency template and
  across-types flag, `poll_config`), either the migrated connector gets an equivalent or the migration refuses that
  source and names the feature. The GitHub preset uses liveness (86400 s) and four registered schemas, so slice 5 builds
  at least connector liveness with the heartbeat alias, and a schema gate over `connector.*`, which means widening
  `register()` beyond `custom.` and `system.` (F1).
- **A25 (round 7, provisional ship evidence for slice 5, from S6; against real NATS, not the in-memory bus).**
  - (a) A fixture with one automation, one durable consumer, one agent `accepts` entry and one schema on
    `custom.github.push`. After the migration, a signed push to the old URL fires each of them under its new type.
    Otherwise the migration refused to run and named the leftover reference, including any template that reads
    `payload.source`.
  - (b) A migrated source with no subscription of its own gets a push and a `ping`. Each lands as O31 decides: a journal
    row from the catch-all subscription, or `total_unmatched` shown by the authenticated doctor read.
  - (c) The sender side:
    - a GitHub fixture delivery, signed with the original secret and sent to the old ingress URL, gets a 2xx and is
      journaled once;
    - re-running `omni sources add github` leaves exactly one provider hook;
    - the heartbeat alias resets liveness, and `system.connector.stalled` does not fire.
  - (d) Across the cutover:
    - a delivery id seen before the cutover and redelivered after it journals once and returns a duplicate 200;
    - a schema-violating payload is still refused and dead-lettered;
    - a push near the payload ceiling is handled as the gap-map constraint says.
  - (e) The migration refuses an unmapped-tenant source (A23) and a source using a feature that has no equivalent (A24),
    naming each.
  - (f) Before it runs in production, the O32 inventory is read, and every dependant it finds is covered by (a) or
    listed for its owner.

**Round 8, after R7-1 to R7-4:**

- **A11 (round 8 extension, from R7-1 and F24).** The `github` connector and a `clickup` connector that receives a migrated
  source hold only a hook secret, with no account credential, through optional credential fields (F8). The design states
  what `connectors.credentials` (NOT NULL, F24) holds for such a connector; it does not drop the NOT NULL silently.
- **A22 (round 8): confirmed.** Slice 5 follows slice 1 and proceeds before paired agents land.
- **A25(b) (round 8, final wording from R7-4).** A migrated GitHub source with only its catch-all subscription gets a push
  and a `ping`. Each writes one journal row, typed `connector.github.push` and `connector.github.ping`, that carries the
  catch-all subscription id and fires no automation, and `total_unmatched` stays 0. A push that also matches a
  rewritten automation's targeted subscription still writes one row, fires that automation once, and carries both
  subscription ids (A12(e)).
- **A25(g) (round 8, adds scrutiny).** A test for each refusal A26 and A28 add: a new signed webhook source is refused
  once slice 5 ships, and a new reference to a migrated source's old type name is refused with the new name.
- **A26 (round 8, from R1-1 and R7-2; adds scrutiny).** "Webhook sources remain only for credential-less ingress" takes
  effect for new sources in the release that ships slice 5: creating a webhook source with a signature config or
  secret, or adding one to an existing source, is refused with an error that names the connector to use. It cannot be
  earlier, because no connector takes a GitHub sender before slice 5. In the same release the CLI GitHub preset
  (`omni sources add github`) creates a `github` connector, and re-running it leaves one provider hook (A25(c)).
  Unsigned sources on the authenticated route are unchanged. A signed source that has not migrated yet keeps working
  and is listed by the authenticated doctor read as not migrated, with the reason (A24, A27).
- **A27 (round 8, the content of R7-1's picked option, with fail-loud handling added).** A generic signed connector (a
  configured `hmac-sha256`, `hmac-sha1` or `token-match` verification, which needs config-aware `verify` and
  `parseDelivery`) is built only if the O32 read finds a signed source on <internal-host> that neither the `github` nor the
  `clickup` connector fits. It is then slice 5b, proven with the A25 tests against a fixture of that algorithm. If the
  read finds none, slice 5b is not built and the design records that `hmac-sha1` and `token-match` have no live user.
  On any other deployment, a source that no connector fits is refused by name under A24's rule, keeps working as a
  webhook source, and shows as not migrated (A26). Nothing in this design removes the webhook-source verification code
  while an unmigrated signed source can exist.
- **A28 (round 8, from R7-3; adds scrutiny).** Old type names fail loud. Each alias keeps its source's old type names
  (`custom.<name>.*` and `custom.webhook.<name>`). After the source migrates, creating an automation, a durable consumer,
  an event schema or an agent `accepts` entry on an old name is refused, and the error gives the new name. An agent
  that re-sends a stored manifest naming `custom.github.*` therefore gets an error instead of a subscription that
  matches nothing.

**Round 11, after R10-1 (A22 to A28 go to the new brainstorm if O33 and O34 agree; A29 to A32 bind slice 1):**

- **A22 to A28 (round 11): handed over.** They describe slice 5 and go with it to `signed-source-migration`. A26's
  refusal of new signed sources is not in effect in this design, for the reason given in the round 11 section.
- **A29 (round 11, from review MEDIUM-1; adds scrutiny). Dead letters need ingress provenance.**
  - `publishConnector` never takes routing from its caller. On a manual retry, auto-retry or replay of a stored
    `connector.*` event, it rebuilds `subscriptionIds[]` and `targetAutomationIds[]` (and `targetAutomationId` for
    `connector.event`) from the journal row the connector ingress wrote under the same event id. It never uses the
    dead letter's payload.
  - A stored `connector.*` dead letter with no such ingress-written journal row is refused on manual retry and skipped
    by auto-retry. The refusal reason is written on the dead-letter row, and nothing is published or fired.
  - The check runs at retry time, so it also covers dead letters stored before slice 1 lands, and no data migration is
    needed. It covers every writer of a dead-letter row, including `DeadLetterService.create()`
    (`packages/api/src/services/dead-letters.ts:143`), whatever produced the row.
  - Test: a `connector.event` dead letter written by `emit_event`'s `publish_not_declared` gate, carrying a chosen
    `targetAutomationId`, is refused on manual retry and on auto-retry, and fires nothing in either of two tenants. A
    dead letter from a real ingress delivery retries and fires only its journaled targets.
- **A30 (round 11, from review MEDIUM-2; adds scrutiny). Each subscription states which route it belongs to.**
  - Migration 0091 adds an explicit `ingress` column, `'subscription' | 'connector'`, NOT NULL with default
    `'subscription'`. Every existing ClickUp row therefore reads `'subscription'` without a rewrite. The column is
    set by the create route that made the row and is never updated.
  - 0091 also drops NOT NULL on `verification_secret` and adds a CHECK: a `'subscription'` row holds a sealed secret,
    and a `'connector'` row holds NULL, because its secret is the connector-level column.
  - A `'connector'` row's `provider_event_key` holds a `connector.<provider>.` typed name. It holds a glob only when
    the row has no target (Decision #26).
  - The per-subscription route `POST /api/v2/connectors/events/:subscriptionId`, and its subscription-keyed tenant
    lookup, treat a `'connector'` id exactly like an unknown id. The per-connector route matches `'connector'` rows
    only.
  - `assertTargetAutomation` branches on `ingress`: `connector.event` for `'subscription'`, and the row's exact typed
    name for `'connector'`.
  - Tests:
    - A12(c) also shows that existing rows read `'subscription'` and keep their secret.
    - Posting a `'connector'` subscription id, such as a no-target row, to the per-subscription route journals
      nothing and fires nothing.
    - The CHECK refuses a `'connector'` row with a secret and a `'subscription'` row without one.
- **A31 (round 11, from review LOW-1). The SDK rule moves to slice 1.** It was row 7: the registry stops requiring an
  action (an event stays required), and a connector may hold only a hook secret, with `connectors.credentials` kept
  NOT NULL and holding the sealed empty object. It lands in slice 1, not slice 5, for two reasons. It is
  provider-neutral Omni work, which R3-2 lets proceed now. And slice 1's real-NATS test (A12(a)) can then run on an
  events-only, hook-secret-only fixture connector, the shape `gitlab` will have. Slice 2 then depends only on slice 1
  having merged and on the R5-1 gate.
- **A32 (round 11, from review LOW-2). The two new keys are reserved on typed rows only.** `subscriptionIds` and
  `targetAutomationIds` are minted and reserved only on typed rows from the per-connector route. `connector.event`
  rows from the per-subscription route keep today's `CONNECTOR_RESERVED_KEYS` behaviour
  (`packages/api/src/services/connectors.ts:60,196-210`), so a ClickUp body field with either name passes through as
  it does today. A12(c) holds byte-for-byte with no exception. This opens no gap: the D7 gate reads
  `targetAutomationIds[]` only on typed `connector.<provider>.*` rows, and reads the single reserved
  `targetAutomationId` on `connector.event`. Test: a ClickUp `connector.event` body that carries `targetAutomationIds`
  is journaled unchanged and fires only its bound automation.

**Round 12, after R11-1 and R11-2:**

- **A22 to A28: handed over (confirmed).** R11-1 and R11-2 agree, so they go to `signed-source-migration` with slice 5. A26
  is not in effect in this design: no new signed webhook source is refused here.
- **A29 to A32 bind slice 1 (confirmed).** A31 places the SDK rule in slice 1.
- **A9 stays superseded,** now by R11-1's own wording: signed webhook sources keep working unchanged beside connectors
  until the migration brainstorm lands. This is a Settled answer, not an assumption.

A1, A4 and A5 are verified facts; A3 is settled by the docs and keeps only a live check for implementation.

## Settled

- **R1-1** (round 2, decision): GitLab sends every selected event category to one hook URL, while an Omni subscription has one URL and one event key, and ignores (202) any other key. How should the gitlab connector handle this? — owner said: "Owner is willing to change Omni and approved ('r1-1 ok') this design: merge webhook sources into connectors. (1) One ingress URL per connector, not per subscription, so one GitLab hook covers every category. (2) parseDelivery derives a typed name (e.g. gitlab.merge_request.merged, gitlab.pipeline.failed) and the event is journaled under it, so a consumer can subscribe to gitlab.merge_request.* directly. (3) Subscriptions match an event glob plus filters, with the target automation optional; today's one-key-one-automation rule stays a special case, so ClickUp is unchanged. (4) Deliveries no subscription matches become visible (counter plus a doctor line), never silently dropped. Connector = credential + typed events + typed actions; webhook sources remain only for credential-less ingress. Council condition: before targetAutomationId becomes optional, connectorTargetMatches' no-target branch must fire nothing." · reopened by R3-1
- **R1-2** (round 2, decision): Captains can already call connector actions through `omni connectors invoke` or the REST route, and the GitLab token stays sealed. But the required `connectors:invoke` scope covers the whole tenant: a key that can post an MR note can run every action on every connector. How do captains reach add_mr_note, set_labels, retry_pipeline and create_issue in v1? — owner said: "No actions in v1 (Recommended)"
- **R1-4** (round 2, decision): Success is 'reports captains relay by hand today versus events delivered automatically'. No repository records hand relays. How is the baseline counted? — owner said: "Derive from GitLab history (Recommended)"
- **R1-3** (round 2, decision): Where is the 'which captain owns this event' routing configured, and who owns it? The parallel council may change the answer, but it shapes the dispatcher either way. — owner said: "omni probably needs to recognice / pair agents. the old omni agent method (focused on integratoins)  is outdated. we need the other way around, like you, this specific claude code, registering as an omni thats consuming specific resources, something like this /council the current way agent works needs to be rethink (not removing the old) but extending it so that it can work with anything, i dont want future omni to have direct agent integrations at all... sync calls with agent callbacks are so 2023 — then, after that council: Wait for paired agents"
- **R3-1** (round 4, decision): Settled R1-1 names typed events like gitlab.merge_request.merged, but Omni refuses that namespace today: the event registry rejects it, no JetStream stream holds it and no journal subscriber listens on it (F1). Reopen R1-1: "Owner is willing to change Omni and approved ('r1-1 ok') this design: merge webhook sources into connectors. (1) One ingress URL per connector, not per subscription, so one GitLab hook covers every category. (2) parseDelivery derives a typed name (e.g. gitlab.merge_request.merged, gitlab.pipeline.failed) and the event is journaled under it, so a consumer can subscribe to gitlab.merge_request.* directly. (3) Subscriptions match an event glob plus filters, with the target automation optional; today's one-key-one-automation rule stays a special case, so ClickUp is unchanged. (4) Deliveries no subscription matches become visible (counter plus a doctor line), never silently dropped. Connector = credential + typed events + typed actions; webhook sources remain only for credential-less ingress. Council condition: before targetAutomationId becomes optional, connectorTargetMatches' no-target branch must fire nothing." → "Owner is willing to change Omni and approved ('r1-1 ok') this design: merge webhook sources into connectors. (1) One ingress URL per connector, not per subscription, so one GitLab hook covers every category. (2) parseDelivery derives a typed name under the connector namespace (e.g. connector.gitlab.merge_request.merged, connector.gitlab.pipeline.failed) and the event is journaled under it, so a consumer can subscribe to connector.gitlab.merge_request.* directly. (3) Subscriptions match an event glob plus filters, with the target automation optional; today's one-key-one-automation rule stays a special case, so ClickUp is unchanged. (4) Deliveries no subscription matches become visible (counter plus a doctor line), never silently dropped. Connector = credential + typed events + typed actions; webhook sources remain only for credential-less ingress. Council condition: before targetAutomationId becomes optional, connectorTargetMatches' no-target branch must fire nothing." Which namespace should typed connector events use? — owner picked "connector.gitlab.* (Recommended)" · reopens R1-1
- **R3-2** (round 4, decision): R1-3 says "Wait for paired agents" and your note says "The GitLab slice waits for the paired-agent slices". The Omni-side ingress work (slice 1: per-connector URL, typed names, optional target, unmatched counter, the no-target guard, and the missing connector stream subject) is provider-neutral and repairs the existing ClickUp path too (F12, F13). What may proceed before paired agents land? — owner picked "Omni work now, GitLab waits (Recommended)"
- **R3-3** (round 4, decision): R1-2 settled "No actions in v1". Scope IN still lists "typed actions add_mr_note, set_labels, retry_pipeline, create_issue; no merge or approve action". Drop that item from this design's Scope IN? — owner picked "Drop it (Recommended)"
- **R3-4** (round 4, decision): Your note rules out an interim bridge with unowned consumers, and R1-3 sends delivery through paired agents. Scope IN still lists "dispatcher on the owner's Mac: durable pull/ack consumer of connector.event, hc send to the owning squad captain, no inbound port". Drop that item? — owner picked "Drop it (Recommended)"
- **R4-1** (round 5, decision): Settled R1-1 (as reopened by R3-1) says each delivery is journaled under its typed name so a consumer can subscribe to connector.gitlab.merge_request.* directly, and that deliveries no subscription matches become visible as a counter plus a doctor line, never silently dropped. It does not say whether a verified delivery that matches no subscription gets a journal row. This choice sets the data model, what paired-agent C2's per-source grant names, and how much GitLab payload Omni keeps (push payloads carry commit messages and author emails). Which deliveries enter the journal? — owner picked "Matched only (Recommended)"
- **R4-2** (round 5, decision): R3-2 lets the Omni ingress work proceed now and holds the GitLab connector and measurement until paired agents land (council conditions C0-C14). No brainstorm or wish for paired agents exists under .genie/ (checked 2026-11-01, HEAD ee5753234), so the gate that starts the GitLab slice has nothing to point at. Where is the paired-agent programme designed? — owner picked "Own brainstorm (Recommended)"
- **R4-3** (round 5, decision): R3-4 dropped the Mac dispatcher. Scope IN still lists "dispatcher author allowlist and comment text passed as quoted untrusted data". Fencing is paired-agent C8 (a server-side fenced delivery envelope), and an author allowlist can be the paired agent's own consumer filter (consumer filters support eq/neq/contains/regex over the journaled payload). Drop that item from this design's Scope IN? — owner picked "Drop it (Recommended)"
- **R4-4** (round 5, decision): Scope IN lists "GitLab token sealed in Omni and never exposed to agents". v1 holds no GitLab API token: the hook is registered by hand as for ClickUp (F7), and there are no actions (R1-2, R3-3). The secret v1 does hold, the connector-level hook verification secret, is now its own Scope IN item (sealed, never returned, never in a journaled row). Drop the token item from this design's Scope IN? — owner picked "Drop it (Recommended)"
- **R5-1** (round 6, decision): R3-2 settled "Omni work now, GitLab waits": the GitLab connector (slice 2) and measurement (slice 4) start only when paired agents land. The paired-agent council set conditions C0 to C14; its own brainstorm now exists at .genie/brainstorms/paired-agents/ but has nothing settled. What must be merged and live on <internal-host> before slices 2 and 4 start? — owner picked "Delivery minimum (Recommended)"
- **R5-2** (round 6, decision): Success is counted from GitLab history (R1-4): in-scope events per category over a window before go-live (all relayed by hand or not at all, since khal/brain has no webhooks) against events journaled and acked by an owning agent over an equal window after go-live. khal/brain produces about 750 in-scope events a day (F11). How long is each window? — owner picked "7 days each (Recommended)"
- **R5-3** (round 6, decision): The measurement ratio is events journaled and acked by the owning agent's consumer divided by in-scope GitLab events over the post-go-live window. What ratio counts as success? — owner picked "99%, misses explained (Recommended)"
- **R5-4** (round 6, decision): The CI and release phases produce no events in khal/brain today: no runners, 2 pipelines in total, no tags, releases or deployments (F11), so their ratio is 0/0. How does slice 4 cover pipeline and job failures, tag_push, release and deployment? — owner picked "Test-hook proof (Recommended)" · reopened by R6-1
- **R6-1** (round 7, decision): Reopen R5-4: "Test-hook proof (Recommended)" → "Real objects via API (Recommended)" (or another option below). GitLab's own test-hook code (gitlabhq master d7b9a6176ab4, DRAFT F17) cannot do what R5-4 assumed for three of the five zero-event categories. Project hooks have no deployment test at all. The release test fails with "Ensure the project has releases." because khal/brain has none. Pipeline and job tests replay the latest real pipeline or job with its real status, never a failure. Only tag_push is built from sample data. How does slice 4 prove pipeline and job failures, tag_push, release and deployment? — owner picked "Real objects via API (Recommended)" · reopens R5-4
- **R6-2** (round 7, decision): Settled R1-1 (as reopened by R3-1) says "merge webhook sources into connectors" and "webhook sources remain only for credential-less ingress". Omni's webhook sources already accept signed deliveries: hmac-sha256, hmac-sha1 or token-match, each with a sealed per-source secret (packages/db/src/schema.ts:2988-3108). The CLI ships a GitHub preset that sets one up (packages/cli/src/commands/sources.ts). The draft has assumed (A9) that this design leaves them untouched. What does this design do with existing signed webhook sources? — owner picked "Migrate in this design" · reopened by R11-1
- **R7-1** (round 8, decision): Settled R6-2 moves signed webhook sources into connectors. Two signed recipes ship today. The GitHub CLI preset uses hmac-sha256 over X-Hub-Signature-256 with a sha256= prefix. The ClickUp runbook uses hmac-sha256 over X-Signature, which the existing clickup connector's manifest already verifies (DRAFT F24). The connector SDK verifies hmac-sha256 or a custom function. It has no hmac-sha1 or token-match kind, and it gives verify and parseDelivery no per-connector config. In the repo, hmac-sha1 has no test and no user, and token-match has one unit test. How many live sources use each algorithm is not known until a production read (O32). What does a migrated signed source become? — owner picked "Per-provider connectors (Recommended)"
- **R7-2** (round 8, decision): Today a signed source's deliveries are journaled as custom.<name>.<event>. Automations match that type as an exact string, durable consumers as a glob, schemas by key, and agent manifests through accepts entries. Nothing rewrites any of them when a type changes (F22). The idempotency key includes the type (F26). Publishing both the old and the new name would write two journal rows per delivery, and a consumer of both namespaces would ack twice. How do existing signed sources move, and when are new signed sources refused? — owner picked "Cutover per source (Recommended)"
- **R7-3** (round 8, decision): A GitHub-preset sender posts to /api/v2/webhooks/ingress/<name>, and a cron calls /api/v2/webhooks/<name>/heartbeat (F23). The CLI finds the GitHub hook by its URL, so a new URL creates a second hook. Every refusal is the same 401, and only the sender sees it. Keeping custom.github.* as the published type is not offered, because it would reverse Settled R3-1 (typed names under connector.<provider>.*) and break paired-agent C5. How do migrated sources keep their senders and dependants working? — owner picked "Aliases, rename types (Recommended)"
- **R7-4** (round 8, decision): Today every verified webhook delivery is journaled, GitHub's ping included (F21). Settled R4-1 says a connector journals only the deliveries a subscription matches; the others are only counted. A migrated source has no subscription unless the migration creates one. What does a migrated source journal? — owner picked "Catch-all subscription (Recommended)"
- **R8-1** (round 9, review-findings): The design review returned FIX-FIRST after this run's repair (1 of 2 repairs used). Open findings: HIGH-1 (HIGH) The design says only connector ingress publishes connector.* (Scope IN row 4: the registry 'accepts connector.<provider>.<...> names from connector ingress only'; Risk 4: 'Only connector ingress publishes connector.*'). The only guard it names is the custom.-only rule on POST /events/trigger. A second publisher is left open: the automation emit_event action. Its eventType is a free, templated string cast to CustomEventType, with no namespace check. Its emission gate checks only an agent's publishes list and schema validity, and strict schemas are off by default. publishGeneric checks only eventRegistry.validate, which takes no caller identity, already admits connector.event, and will admit connector.<provider>.* once row 4 widens it. 'From connector ingress only' therefore names no mechanism; it is a placeholder standing in for a decision. Decision #26 makes the D7 gate authorize by membership in the payload's targetAutomationIds[], and the engine's automation list is not tenant-filtered (DRAFT F13). So any automation can emit a typed connector.* event that carries a chosen id list and fire a targeted automation, including another tenant's when its id is known. The event is also journaled through the connector.> persistence subscriber, so paired-agent consumers that trust connector.gitlab.* rows as GitLab-originated would receive it. Row 13 widens the agent manifest for accepts. accepts and publishes share ManifestEventTypeSchema, so publishes would admit connector.* too. Provenance: code read at ee5753234. The cross-tenant consequence rests on DRAFT F13 (O18 closed); no exploit was run.. How should the next run go on? — owner picked "Repair again (Recommended)"
- **R10-1** (round 11, decision): The GitLab connector design is blocked: 2 of 2 repairs spent, review still FIX-FIRST. HIGH-1: the signed-source migration (slice 5, from your R6-2 'Migrate in this design') can't rename GitHub's action-bearing types (pull_request, issues, release) because triggers, subscriptions and schemas are exact-match and connector.github.<event>.<action> splits one old type into many. HIGH-2: letting agent manifests accept connector.* (row 13) silently matches nothing, because the targeted subscription that must name the compiled automation is cascade-deleted whenever the manifest recompiles. Also open: MEDIUM-1 (pre-existing dead letters could be retried as forged connector.* events), MEDIUM-2 (no stated way to tell per-subscription from per-connector subscriptions), two LOWs. How do we unblock it? — owner picked "Split it out (Recommended)"
- **R11-1** (round 12, decision): In R10-1 you picked 'Split it out'. Its description said it reopens R6-2 and moves the signed-webhook-source migration (slice 5) to its own brainstorm. The ledger can only record a reopen from a question that names it, so R6-2 still reads as before. Reopen R6-2: "Migrate in this design" → "Migrate in its own brainstorm". With it, R7-1 to R7-4, the migration evidence and the round 10 review's HIGH-1 and HIGH-2 go to a new signed-source-migration brainstorm. Row 13 (agent manifests accepting connector.*) is dropped: manifests keep refusing connector.* as they do today, and agents get GitLab events through durable consumers. Until that brainstorm lands, signed webhook sources keep working unchanged beside connectors, and new ones are not refused. Which answer stands for R6-2? — owner picked "Own brainstorm (Recommended)" · reopens R6-2
- **R11-2** (round 12, decision): Scope IN still lists "existing signed webhook sources (hmac-sha256, hmac-sha1, token-match) and the CLI GitHub preset migrate into connectors per R6-2; webhook sources keep only credential-less ingress". Your R10-1 pick moves this work to its own brainstorm, but the ledger drops a Scope IN item only through an answer that says so. Drop it from this design's Scope IN? — owner picked "Drop it (Recommended)"

## Asked

_No open questions._

## Size

- **G** · raised by lead · round 1

## Scope ratchet

- gitlab connector package on packages/connector-sdk (manifest, client, parseDelivery, verification), modeled on connector-clickup · added by lead · round 1
- event keys for plan, code, review, CI, integrate and release: issues, push, merge_request opened, notes on MRs, pipeline and job failures, merge_request merged, tag_push, release, deployment · added by lead · round 1
- ~~typed actions add_mr_note, set_labels, retry_pipeline, create_issue; no merge or approve action~~ · added by lead · round 1 · dropped by lead · round 4 · approved by R3-3
- ~~GitLab token sealed in Omni and never exposed to agents~~ · added by lead · round 1 · dropped by owner · round 5 · approved by R4-4
- mapping GitLab's one-URL hook multiplexing onto Omni subscriptions · added by lead · round 1
- ~~dispatcher on the owner's Mac: durable pull/ack consumer of connector.event, hc send to the owning squad captain, no inbound port~~ · added by lead · round 1 · dropped by lead · round 4 · approved by R3-4
- ~~dispatcher author allowlist and comment text passed as quoted untrusted data~~ · added by lead · round 1 · dropped by owner · round 5 · approved by R4-3
- measurement: reports captains relay by hand versus events delivered automatically · added by lead · round 1
- Omni connector ingress per R1-1: one ingress URL per connector, a typed event name journaled per delivery, subscriptions matching an event glob plus filters with the target automation optional, and unmatched deliveries counted and shown by doctor · added by lead · round 2
- connectorTargetMatches' no-target branch fires nothing before targetAutomationId becomes optional, with existing ClickUp subscriptions and automations proven unchanged · added by lead · round 2
- a JetStream stream subject for the connector event namespace, so connector.event and the typed connector events publish in production, proven against a real NATS server · added by lead · round 3
- the D7 target gate covers every connector-namespace event type, so a typed connector event reaches an automation only as its subscription's named target · added by lead · round 4
- the connector-level hook verification secret is sealed, never returned by the API and never present in a journaled row or delivered event · added by lead · round 4
- ~~existing signed webhook sources (hmac-sha256, hmac-sha1, token-match) and the CLI GitHub preset migrate into connectors per R6-2; webhook sources keep only credential-less ingress~~ · added by lead · round 7 · dropped by owner · round 12 · approved by R11-2

## Councils

_None convened._

## Ledger

```ledger
{
  "settled": [
    {
      "id": "R1-1",
      "kind": "decision",
      "question": "GitLab sends every selected event category to one hook URL, while an Omni subscription has one URL and one event key, and ignores (202) any other key. How should the gitlab connector handle this?",
      "answer": "Owner is willing to change Omni and approved ('r1-1 ok') this design: merge webhook sources into connectors. (1) One ingress URL per connector, not per subscription, so one GitLab hook covers every category. (2) parseDelivery derives a typed name (e.g. gitlab.merge_request.merged, gitlab.pipeline.failed) and the event is journaled under it, so a consumer can subscribe to gitlab.merge_request.* directly. (3) Subscriptions match an event glob plus filters, with the target automation optional; today's one-key-one-automation rule stays a special case, so ClickUp is unchanged. (4) Deliveries no subscription matches become visible (counter plus a doctor line), never silently dropped. Connector = credential + typed events + typed actions; webhook sources remain only for credential-less ingress. Council condition: before targetAutomationId becomes optional, connectorTargetMatches' no-target branch must fire nothing.",
      "value": null,
      "provenance": "owner said: \"Owner is willing to change Omni and approved ('r1-1 ok') this design: merge webhook sources into connectors. (1) One ingress URL per connector, not per subscription, so one GitLab hook covers every category. (2) parseDelivery derives a typed name (e.g. gitlab.merge_request.merged, gitlab.pipeline.failed) and the event is journaled under it, so a consumer can subscribe to gitlab.merge_request.* directly. (3) Subscriptions match an event glob plus filters, with the target automation optional; today's one-key-one-automation rule stays a special case, so ClickUp is unchanged. (4) Deliveries no subscription matches become visible (counter plus a doctor line), never silently dropped. Connector = credential + typed events + typed actions; webhook sources remain only for credential-less ingress. Council condition: before targetAutomationId becomes optional, connectorTargetMatches' no-target branch must fire nothing.\"",
      "round": 2,
      "reopenedBy": "R3-1"
    },
    {
      "id": "R1-2",
      "kind": "decision",
      "question": "Captains can already call connector actions through `omni connectors invoke` or the REST route, and the GitLab token stays sealed. But the required `connectors:invoke` scope covers the whole tenant: a key that can post an MR note can run every action on every connector. How do captains reach add_mr_note, set_labels, retry_pipeline and create_issue in v1?",
      "answer": "No actions in v1 (Recommended)",
      "value": null,
      "provenance": "owner said: \"No actions in v1 (Recommended)\"",
      "round": 2
    },
    {
      "id": "R1-4",
      "kind": "decision",
      "question": "Success is 'reports captains relay by hand today versus events delivered automatically'. No repository records hand relays. How is the baseline counted?",
      "answer": "Derive from GitLab history (Recommended)",
      "value": null,
      "provenance": "owner said: \"Derive from GitLab history (Recommended)\"",
      "round": 2
    },
    {
      "id": "R1-3",
      "kind": "decision",
      "question": "Where is the 'which captain owns this event' routing configured, and who owns it? The parallel council may change the answer, but it shapes the dispatcher either way.",
      "answer": "omni probably needs to recognice / pair agents. the old omni agent method (focused on integratoins)  is outdated. we need the other way around, like you, this specific claude code, registering as an omni thats consuming specific resources, something like this /council the current way agent works needs to be rethink (not removing the old) but extending it so that it can work with anything, i dont want future omni to have direct agent integrations at all... sync calls with agent callbacks are so 2023 — then, after that council: Wait for paired agents",
      "value": null,
      "provenance": "owner said: \"omni probably needs to recognice / pair agents. the old omni agent method (focused on integratoins)  is outdated. we need the other way around, like you, this specific claude code, registering as an omni thats consuming specific resources, something like this /council the current way agent works needs to be rethink (not removing the old) but extending it so that it can work with anything, i dont want future omni to have direct agent integrations at all... sync calls with agent callbacks are so 2023 — then, after that council: Wait for paired agents\"",
      "round": 2
    },
    {
      "id": "R3-1",
      "kind": "decision",
      "question": "Settled R1-1 names typed events like gitlab.merge_request.merged, but Omni refuses that namespace today: the event registry rejects it, no JetStream stream holds it and no journal subscriber listens on it (F1). Reopen R1-1: \"Owner is willing to change Omni and approved ('r1-1 ok') this design: merge webhook sources into connectors. (1) One ingress URL per connector, not per subscription, so one GitLab hook covers every category. (2) parseDelivery derives a typed name (e.g. gitlab.merge_request.merged, gitlab.pipeline.failed) and the event is journaled under it, so a consumer can subscribe to gitlab.merge_request.* directly. (3) Subscriptions match an event glob plus filters, with the target automation optional; today's one-key-one-automation rule stays a special case, so ClickUp is unchanged. (4) Deliveries no subscription matches become visible (counter plus a doctor line), never silently dropped. Connector = credential + typed events + typed actions; webhook sources remain only for credential-less ingress. Council condition: before targetAutomationId becomes optional, connectorTargetMatches' no-target branch must fire nothing.\" → \"Owner is willing to change Omni and approved ('r1-1 ok') this design: merge webhook sources into connectors. (1) One ingress URL per connector, not per subscription, so one GitLab hook covers every category. (2) parseDelivery derives a typed name under the connector namespace (e.g. connector.gitlab.merge_request.merged, connector.gitlab.pipeline.failed) and the event is journaled under it, so a consumer can subscribe to connector.gitlab.merge_request.* directly. (3) Subscriptions match an event glob plus filters, with the target automation optional; today's one-key-one-automation rule stays a special case, so ClickUp is unchanged. (4) Deliveries no subscription matches become visible (counter plus a doctor line), never silently dropped. Connector = credential + typed events + typed actions; webhook sources remain only for credential-less ingress. Council condition: before targetAutomationId becomes optional, connectorTargetMatches' no-target branch must fire nothing.\" Which namespace should typed connector events use?",
      "answer": "connector.gitlab.* (Recommended)",
      "value": "connector-ns",
      "provenance": "owner picked \"connector.gitlab.* (Recommended)\"",
      "round": 4,
      "reopens": "R1-1"
    },
    {
      "id": "R3-2",
      "kind": "decision",
      "question": "R1-3 says \"Wait for paired agents\" and your note says \"The GitLab slice waits for the paired-agent slices\". The Omni-side ingress work (slice 1: per-connector URL, typed names, optional target, unmatched counter, the no-target guard, and the missing connector stream subject) is provider-neutral and repairs the existing ClickUp path too (F12, F13). What may proceed before paired agents land?",
      "answer": "Omni work now, GitLab waits (Recommended)",
      "value": "omni-first",
      "provenance": "owner picked \"Omni work now, GitLab waits (Recommended)\"",
      "round": 4
    },
    {
      "id": "R3-3",
      "kind": "decision",
      "question": "R1-2 settled \"No actions in v1\". Scope IN still lists \"typed actions add_mr_note, set_labels, retry_pipeline, create_issue; no merge or approve action\". Drop that item from this design's Scope IN?",
      "answer": "Drop it (Recommended)",
      "value": "scope-drop:typed actions add_mr_note, set_labels, retry_pipeline, create_issue; no merge or approve action",
      "provenance": "owner picked \"Drop it (Recommended)\"",
      "round": 4
    },
    {
      "id": "R3-4",
      "kind": "decision",
      "question": "Your note rules out an interim bridge with unowned consumers, and R1-3 sends delivery through paired agents. Scope IN still lists \"dispatcher on the owner's Mac: durable pull/ack consumer of connector.event, hc send to the owning squad captain, no inbound port\". Drop that item?",
      "answer": "Drop it (Recommended)",
      "value": "scope-drop:dispatcher on the owner's Mac: durable pull/ack consumer of connector.event, hc send to the owning squad captain, no inbound port",
      "provenance": "owner picked \"Drop it (Recommended)\"",
      "round": 4
    },
    {
      "id": "R4-1",
      "kind": "decision",
      "question": "Settled R1-1 (as reopened by R3-1) says each delivery is journaled under its typed name so a consumer can subscribe to connector.gitlab.merge_request.* directly, and that deliveries no subscription matches become visible as a counter plus a doctor line, never silently dropped. It does not say whether a verified delivery that matches no subscription gets a journal row. This choice sets the data model, what paired-agent C2's per-source grant names, and how much GitLab payload Omni keeps (push payloads carry commit messages and author emails). Which deliveries enter the journal?",
      "answer": "Matched only (Recommended)",
      "value": "journal-matched",
      "provenance": "owner picked \"Matched only (Recommended)\"",
      "round": 5
    },
    {
      "id": "R4-2",
      "kind": "decision",
      "question": "R3-2 lets the Omni ingress work proceed now and holds the GitLab connector and measurement until paired agents land (council conditions C0-C14). No brainstorm or wish for paired agents exists under .genie/ (checked 2026-11-01, HEAD ee5753234), so the gate that starts the GitLab slice has nothing to point at. Where is the paired-agent programme designed?",
      "answer": "Own brainstorm (Recommended)",
      "value": "own-brainstorm",
      "provenance": "owner picked \"Own brainstorm (Recommended)\"",
      "round": 5
    },
    {
      "id": "R4-3",
      "kind": "decision",
      "question": "R3-4 dropped the Mac dispatcher. Scope IN still lists \"dispatcher author allowlist and comment text passed as quoted untrusted data\". Fencing is paired-agent C8 (a server-side fenced delivery envelope), and an author allowlist can be the paired agent's own consumer filter (consumer filters support eq/neq/contains/regex over the journaled payload). Drop that item from this design's Scope IN?",
      "answer": "Drop it (Recommended)",
      "value": "scope-drop:dispatcher author allowlist and comment text passed as quoted untrusted data",
      "provenance": "owner picked \"Drop it (Recommended)\"",
      "round": 5
    },
    {
      "id": "R4-4",
      "kind": "decision",
      "question": "Scope IN lists \"GitLab token sealed in Omni and never exposed to agents\". v1 holds no GitLab API token: the hook is registered by hand as for ClickUp (F7), and there are no actions (R1-2, R3-3). The secret v1 does hold, the connector-level hook verification secret, is now its own Scope IN item (sealed, never returned, never in a journaled row). Drop the token item from this design's Scope IN?",
      "answer": "Drop it (Recommended)",
      "value": "scope-drop:GitLab token sealed in Omni and never exposed to agents",
      "provenance": "owner picked \"Drop it (Recommended)\"",
      "round": 5
    },
    {
      "id": "R5-1",
      "kind": "decision",
      "question": "R3-2 settled \"Omni work now, GitLab waits\": the GitLab connector (slice 2) and measurement (slice 4) start only when paired agents land. The paired-agent council set conditions C0 to C14; its own brainstorm now exists at .genie/brainstorms/paired-agents/ but has nothing settled. What must be merged and live on <internal-host> before slices 2 and 4 start?",
      "answer": "Delivery minimum (Recommended)",
      "value": "gate-min",
      "provenance": "owner picked \"Delivery minimum (Recommended)\"",
      "round": 6
    },
    {
      "id": "R5-2",
      "kind": "decision",
      "question": "Success is counted from GitLab history (R1-4): in-scope events per category over a window before go-live (all relayed by hand or not at all, since khal/brain has no webhooks) against events journaled and acked by an owning agent over an equal window after go-live. khal/brain produces about 750 in-scope events a day (F11). How long is each window?",
      "answer": "7 days each (Recommended)",
      "value": "w7",
      "provenance": "owner picked \"7 days each (Recommended)\"",
      "round": 6
    },
    {
      "id": "R5-3",
      "kind": "decision",
      "question": "The measurement ratio is events journaled and acked by the owning agent's consumer divided by in-scope GitLab events over the post-go-live window. What ratio counts as success?",
      "answer": "99%, misses explained (Recommended)",
      "value": "bar-99",
      "provenance": "owner picked \"99%, misses explained (Recommended)\"",
      "round": 6
    },
    {
      "id": "R5-4",
      "kind": "decision",
      "question": "The CI and release phases produce no events in khal/brain today: no runners, 2 pipelines in total, no tags, releases or deployments (F11), so their ratio is 0/0. How does slice 4 cover pipeline and job failures, tag_push, release and deployment?",
      "answer": "Test-hook proof (Recommended)",
      "value": "zero-testhook",
      "provenance": "owner picked \"Test-hook proof (Recommended)\"",
      "round": 6,
      "reopenedBy": "R6-1"
    },
    {
      "id": "R6-1",
      "kind": "decision",
      "question": "Reopen R5-4: \"Test-hook proof (Recommended)\" → \"Real objects via API (Recommended)\" (or another option below). GitLab's own test-hook code (gitlabhq master d7b9a6176ab4, DRAFT F17) cannot do what R5-4 assumed for three of the five zero-event categories. Project hooks have no deployment test at all. The release test fails with \"Ensure the project has releases.\" because khal/brain has none. Pipeline and job tests replay the latest real pipeline or job with its real status, never a failure. Only tag_push is built from sample data. How does slice 4 prove pipeline and job failures, tag_push, release and deployment?",
      "answer": "Real objects via API (Recommended)",
      "value": "real-objects",
      "provenance": "owner picked \"Real objects via API (Recommended)\"",
      "round": 7,
      "reopens": "R5-4"
    },
    {
      "id": "R6-2",
      "kind": "decision",
      "question": "Settled R1-1 (as reopened by R3-1) says \"merge webhook sources into connectors\" and \"webhook sources remain only for credential-less ingress\". Omni's webhook sources already accept signed deliveries: hmac-sha256, hmac-sha1 or token-match, each with a sealed per-source secret (packages/db/src/schema.ts:2988-3108). The CLI ships a GitHub preset that sets one up (packages/cli/src/commands/sources.ts). The draft has assumed (A9) that this design leaves them untouched. What does this design do with existing signed webhook sources?",
      "answer": "Migrate in this design",
      "value": "ws-migrate",
      "provenance": "owner picked \"Migrate in this design\"",
      "round": 7,
      "reopenedBy": "R11-1"
    },
    {
      "id": "R7-1",
      "kind": "decision",
      "question": "Settled R6-2 moves signed webhook sources into connectors. Two signed recipes ship today. The GitHub CLI preset uses hmac-sha256 over X-Hub-Signature-256 with a sha256= prefix. The ClickUp runbook uses hmac-sha256 over X-Signature, which the existing clickup connector's manifest already verifies (DRAFT F24). The connector SDK verifies hmac-sha256 or a custom function. It has no hmac-sha1 or token-match kind, and it gives verify and parseDelivery no per-connector config. In the repo, hmac-sha1 has no test and no user, and token-match has one unit test. How many live sources use each algorithm is not known until a production read (O32). What does a migrated signed source become?",
      "answer": "Per-provider connectors (Recommended)",
      "value": "per-provider",
      "provenance": "owner picked \"Per-provider connectors (Recommended)\"",
      "round": 8
    },
    {
      "id": "R7-2",
      "kind": "decision",
      "question": "Today a signed source's deliveries are journaled as custom.<name>.<event>. Automations match that type as an exact string, durable consumers as a glob, schemas by key, and agent manifests through accepts entries. Nothing rewrites any of them when a type changes (F22). The idempotency key includes the type (F26). Publishing both the old and the new name would write two journal rows per delivery, and a consumer of both namespaces would ack twice. How do existing signed sources move, and when are new signed sources refused?",
      "answer": "Cutover per source (Recommended)",
      "value": "cutover-per-source",
      "provenance": "owner picked \"Cutover per source (Recommended)\"",
      "round": 8
    },
    {
      "id": "R7-3",
      "kind": "decision",
      "question": "A GitHub-preset sender posts to /api/v2/webhooks/ingress/<name>, and a cron calls /api/v2/webhooks/<name>/heartbeat (F23). The CLI finds the GitHub hook by its URL, so a new URL creates a second hook. Every refusal is the same 401, and only the sender sees it. Keeping custom.github.* as the published type is not offered, because it would reverse Settled R3-1 (typed names under connector.<provider>.*) and break paired-agent C5. How do migrated sources keep their senders and dependants working?",
      "answer": "Aliases, rename types (Recommended)",
      "value": "alias-rename",
      "provenance": "owner picked \"Aliases, rename types (Recommended)\"",
      "round": 8
    },
    {
      "id": "R7-4",
      "kind": "decision",
      "question": "Today every verified webhook delivery is journaled, GitHub's ping included (F21). Settled R4-1 says a connector journals only the deliveries a subscription matches; the others are only counted. A migrated source has no subscription unless the migration creates one. What does a migrated source journal?",
      "answer": "Catch-all subscription (Recommended)",
      "value": "catch-all",
      "provenance": "owner picked \"Catch-all subscription (Recommended)\"",
      "round": 8
    },
    {
      "id": "R8-1",
      "kind": "review-findings",
      "question": "The design review returned FIX-FIRST after this run's repair (1 of 2 repairs used). Open findings: HIGH-1 (HIGH) The design says only connector ingress publishes connector.* (Scope IN row 4: the registry 'accepts connector.<provider>.<...> names from connector ingress only'; Risk 4: 'Only connector ingress publishes connector.*'). The only guard it names is the custom.-only rule on POST /events/trigger. A second publisher is left open: the automation emit_event action. Its eventType is a free, templated string cast to CustomEventType, with no namespace check. Its emission gate checks only an agent's publishes list and schema validity, and strict schemas are off by default. publishGeneric checks only eventRegistry.validate, which takes no caller identity, already admits connector.event, and will admit connector.<provider>.* once row 4 widens it. 'From connector ingress only' therefore names no mechanism; it is a placeholder standing in for a decision. Decision #26 makes the D7 gate authorize by membership in the payload's targetAutomationIds[], and the engine's automation list is not tenant-filtered (DRAFT F13). So any automation can emit a typed connector.* event that carries a chosen id list and fire a targeted automation, including another tenant's when its id is known. The event is also journaled through the connector.> persistence subscriber, so paired-agent consumers that trust connector.gitlab.* rows as GitLab-originated would receive it. Row 13 widens the agent manifest for accepts. accepts and publishes share ManifestEventTypeSchema, so publishes would admit connector.* too. Provenance: code read at ee5753234. The cross-tenant consequence rests on DRAFT F13 (O18 closed); no exploit was run.. How should the next run go on?",
      "answer": "Repair again (Recommended)",
      "value": "repair",
      "provenance": "owner picked \"Repair again (Recommended)\"",
      "round": 9
    },
    {
      "id": "R10-1",
      "kind": "decision",
      "question": "The GitLab connector design is blocked: 2 of 2 repairs spent, review still FIX-FIRST. HIGH-1: the signed-source migration (slice 5, from your R6-2 'Migrate in this design') can't rename GitHub's action-bearing types (pull_request, issues, release) because triggers, subscriptions and schemas are exact-match and connector.github.<event>.<action> splits one old type into many. HIGH-2: letting agent manifests accept connector.* (row 13) silently matches nothing, because the targeted subscription that must name the compiled automation is cascade-deleted whenever the manifest recompiles. Also open: MEDIUM-1 (pre-existing dead letters could be retried as forged connector.* events), MEDIUM-2 (no stated way to tell per-subscription from per-connector subscriptions), two LOWs. How do we unblock it?",
      "answer": "Split it out (Recommended)",
      "value": "split-slice5-drop-row13",
      "provenance": "owner picked \"Split it out (Recommended)\"",
      "round": 11
    },
    {
      "id": "R11-1",
      "kind": "decision",
      "question": "In R10-1 you picked 'Split it out'. Its description said it reopens R6-2 and moves the signed-webhook-source migration (slice 5) to its own brainstorm. The ledger can only record a reopen from a question that names it, so R6-2 still reads as before. Reopen R6-2: \"Migrate in this design\" → \"Migrate in its own brainstorm\". With it, R7-1 to R7-4, the migration evidence and the round 10 review's HIGH-1 and HIGH-2 go to a new signed-source-migration brainstorm. Row 13 (agent manifests accepting connector.*) is dropped: manifests keep refusing connector.* as they do today, and agents get GitLab events through durable consumers. Until that brainstorm lands, signed webhook sources keep working unchanged beside connectors, and new ones are not refused. Which answer stands for R6-2?",
      "answer": "Own brainstorm (Recommended)",
      "value": "ws-own-brainstorm",
      "provenance": "owner picked \"Own brainstorm (Recommended)\"",
      "round": 12,
      "reopens": "R6-2"
    },
    {
      "id": "R11-2",
      "kind": "decision",
      "question": "Scope IN still lists \"existing signed webhook sources (hmac-sha256, hmac-sha1, token-match) and the CLI GitHub preset migrate into connectors per R6-2; webhook sources keep only credential-less ingress\". Your R10-1 pick moves this work to its own brainstorm, but the ledger drops a Scope IN item only through an answer that says so. Drop it from this design's Scope IN?",
      "answer": "Drop it (Recommended)",
      "value": "scope-drop:existing signed webhook sources (hmac-sha256, hmac-sha1, token-match) and the CLI GitHub preset migrate into connectors per R6-2; webhook sources keep only credential-less ingress",
      "provenance": "owner picked \"Drop it (Recommended)\"",
      "round": 12
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
      "item": "gitlab connector package on packages/connector-sdk (manifest, client, parseDelivery, verification), modeled on connector-clickup",
      "by": "lead",
      "round": 1
    },
    {
      "item": "event keys for plan, code, review, CI, integrate and release: issues, push, merge_request opened, notes on MRs, pipeline and job failures, merge_request merged, tag_push, release, deployment",
      "by": "lead",
      "round": 1
    },
    {
      "item": "typed actions add_mr_note, set_labels, retry_pipeline, create_issue; no merge or approve action",
      "by": "lead",
      "round": 1,
      "dropped": {
        "by": "lead",
        "round": 4,
        "approvedBy": "R3-3"
      }
    },
    {
      "item": "GitLab token sealed in Omni and never exposed to agents",
      "by": "lead",
      "round": 1,
      "dropped": {
        "by": "owner",
        "round": 5,
        "approvedBy": "R4-4"
      }
    },
    {
      "item": "mapping GitLab's one-URL hook multiplexing onto Omni subscriptions",
      "by": "lead",
      "round": 1
    },
    {
      "item": "dispatcher on the owner's Mac: durable pull/ack consumer of connector.event, hc send to the owning squad captain, no inbound port",
      "by": "lead",
      "round": 1,
      "dropped": {
        "by": "lead",
        "round": 4,
        "approvedBy": "R3-4"
      }
    },
    {
      "item": "dispatcher author allowlist and comment text passed as quoted untrusted data",
      "by": "lead",
      "round": 1,
      "dropped": {
        "by": "owner",
        "round": 5,
        "approvedBy": "R4-3"
      }
    },
    {
      "item": "measurement: reports captains relay by hand versus events delivered automatically",
      "by": "lead",
      "round": 1
    },
    {
      "item": "Omni connector ingress per R1-1: one ingress URL per connector, a typed event name journaled per delivery, subscriptions matching an event glob plus filters with the target automation optional, and unmatched deliveries counted and shown by doctor",
      "by": "lead",
      "round": 2
    },
    {
      "item": "connectorTargetMatches' no-target branch fires nothing before targetAutomationId becomes optional, with existing ClickUp subscriptions and automations proven unchanged",
      "by": "lead",
      "round": 2
    },
    {
      "item": "a JetStream stream subject for the connector event namespace, so connector.event and the typed connector events publish in production, proven against a real NATS server",
      "by": "lead",
      "round": 3
    },
    {
      "item": "the D7 target gate covers every connector-namespace event type, so a typed connector event reaches an automation only as its subscription's named target",
      "by": "lead",
      "round": 4
    },
    {
      "item": "the connector-level hook verification secret is sealed, never returned by the API and never present in a journaled row or delivered event",
      "by": "lead",
      "round": 4
    },
    {
      "item": "existing signed webhook sources (hmac-sha256, hmac-sha1, token-match) and the CLI GitHub preset migrate into connectors per R6-2; webhook sources keep only credential-less ingress",
      "by": "lead",
      "round": 7,
      "dropped": {
        "by": "owner",
        "round": 12,
        "approvedBy": "R11-2"
      }
    }
  ],
  "councils": [],
  "reviews": [
    {
      "verdict": "FIX-FIRST",
      "digest": "31ff67611fea50b3ba44ad24bf7b85851a66cf61b51aa727c454d1453c8be178",
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
        "MEDIUM-1",
        "MEDIUM-2",
        "MEDIUM-3",
        "LOW-1"
      ]
    },
    {
      "verdict": "FIX-FIRST",
      "digest": "f132f7a31dfaf4b901097867bb5a01c429e11b357199c6dbca140e15ed86f64c",
      "round": 8,
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
        "C12",
        "C13",
        "HIGH-1",
        "MEDIUM-1",
        "MEDIUM-2",
        "MEDIUM-3",
        "LOW-1",
        "LOW-2"
      ]
    },
    {
      "verdict": "FIX-FIRST",
      "digest": "ab0aed040c777062131033005415cbaa9ef70c0fb3c2dbf3a9c588216c310332",
      "round": 9,
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
        "C12",
        "C13",
        "HIGH-1",
        "HIGH-2",
        "MEDIUM-1",
        "MEDIUM-2",
        "LOW-1",
        "LOW-2"
      ]
    },
    {
      "verdict": "SHIP",
      "digest": "c367154a4d08af5f6e251b73d58c98eee2e72b1d839e1d1716147e08e39ded8a",
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
        "MEDIUM-1",
        "MEDIUM-2",
        "MEDIUM-3",
        "LOW-1",
        "LOW-2"
      ]
    }
  ]
}
```
