---
slug: teams-channel
title: "Add Microsoft Teams as a first-class channel plugin (packages/channel-teams)"
status: DRAFT
priority: P2
---

## Summary

Omni currently ships 8 channel plugins (`packages/channel-{slack,discord,telegram,whatsapp,gupshup,a2a,internal,sdk}`) built on top of `@omni/channel-sdk`'s `BaseChannelPlugin` + `channelRegistry` abstraction. This wish adds Microsoft Teams as a 9th channel by:

1. Documenting the current channel abstraction (no source of truth doc exists today — Slack is the closest analog and de-facto reference).
2. Picking the right Teams platform surface (Bot Framework vs Graph API vs Webhooks) and designing the integration on top of the existing abstraction.
3. Implementing `packages/channel-teams` matching the `channel-slack` package layout.

No SDK rework. If a real abstraction gap blocks Teams, the leader pauses and surfaces it back to the orchestrator before extending the SDK.

---

## Scope

**IN:**
- New package `packages/channel-teams/` matching `packages/channel-slack/` layout (config/, connection/, handlers/, senders/, components/, capabilities.ts, manifest.ts, plugin.ts, types.ts, __tests__/, index.ts, markdown.ts, dm-policy.ts, tools.ts)
- Subclass of `BaseChannelPlugin` registered via `channelRegistry`
- Inbound: parse Teams activities → `IncomingMessage` (text, attachments, mentions, reactions, channel-vs-DM, threads/replies)
- Outbound: `OutgoingMessage` → Teams activity (text + media to start; adaptive cards may be deferred)
- Connect-time credential validation (per-tenant bot install)
- Compliance with `sdk-compliance-test-suite` if applicable
- Abstraction reference doc (proposed location: `docs/channel-parity/abstraction.md` OR `packages/channel-sdk/README.md` — leader decides in DESIGN.md)

**OUT:**
- Reworking `@omni/channel-sdk` itself (escalate to orchestrator if needed)
- Teams app marketplace listing / store submission
- Admin SSO consent flows beyond what messaging requires
- Adaptive Cards advanced flows (decision deferred to DESIGN.md — may be follow-up wish)
- Tenant-wide message sync via Graph API (out of v1 scope)

---

## Decisions (locked in DRAFT)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Reference channel | `channel-slack` | Closest shape: tenant=workspace, channels, threads, bots, DMs, OAuth/app install |
| Abstraction doc location | TBD by leader (DESIGN.md) | Either `docs/channel-parity/` or `packages/channel-sdk/README.md` — both valid |
| Platform surface | TBD by leader (DESIGN.md) | Bot Framework strongly preferred; document in DESIGN.md why |
| Auth model | per-tenant (per-instance config) | Matches existing channels' multi-tenant model |
| SDK gaps | escalate, don't extend silently | Orchestrator decides on SDK changes |

---

## Execution Groups

### Group 1: Abstraction Reference + Teams Platform Decision (DESIGN.md)

**Goal:** Crystallize Phase 1 of the brainstorm into a locked design doc.

**Deliverables:**
- `.genie/brainstorms/teams-channel/DESIGN.md` covering:
  - Abstraction reference outline: `BaseChannelPlugin` lifecycle (`connect`, `disconnect`, `sendMessage`, history sync hooks), `DEFAULT_CAPABILITIES`, event emitters (`emitInstanceConnected`, `emitMessageSent`, etc.), helpers (history, dedupe, reaction-ack, sanitize, thread-cache, download-guard), manifest + auto-discovery, `InstanceConfig` model, sdk-compliance expectations
  - Teams platform decision (Bot Framework vs Graph API vs Webhooks) with justification
  - Auth + onboarding flow (per-tenant install, what credentials live on `InstanceConfig`)
  - Inbound activity → `IncomingMessage` mapping (text, attachments, mentions, reactions, channel/DM, threads)
  - Outbound `OutgoingMessage` → Teams activity mapping (per capability)
  - Capability matrix (canSendMedia, canSendReaction, canSendTyping, threading, mentions, etc.)
  - Required dependencies (`botbuilder`, `botframework-connector`, etc.)
  - Webhook ingress decision (does omni have a unified router? Check telegram + gupshup for the pattern)
- (Optional but preferred) Promote the abstraction reference outline into a real doc at the chosen location — either `docs/channel-parity/abstraction.md` or `packages/channel-sdk/README.md`. If creating now feels premature, defer to Group 2 but capture the outline in DESIGN.md.

**Acceptance criteria:**
- All open questions in `DRAFT.md` are resolved or explicitly deferred with rationale
- Platform surface choice is final and justified
- Capability matrix is concrete enough to scaffold from

**Validation:**
```bash
test -s .genie/brainstorms/teams-channel/DESIGN.md
```

---

### Group 2: Scaffold `packages/channel-teams`

**Goal:** Create the package skeleton matching `channel-slack` layout. No real Teams logic yet — types, manifest, capabilities, empty handlers.

**Deliverables:**
- `packages/channel-teams/package.json` (name `@omni/channel-teams`, deps from DESIGN.md decision)
- `packages/channel-teams/tsconfig.json`
- `packages/channel-teams/src/index.ts` — plugin entry + register
- `packages/channel-teams/src/plugin.ts` — `BaseChannelPlugin` subclass skeleton
- `packages/channel-teams/src/manifest.ts` — plugin metadata
- `packages/channel-teams/src/capabilities.ts` — capability matrix from DESIGN.md
- `packages/channel-teams/src/types.ts` — config + plugin-local types
- `packages/channel-teams/src/config/`, `connection/`, `handlers/`, `senders/`, `components/`, `__tests__/` (directories with placeholder index files)
- `packages/channel-teams/src/markdown.ts`, `dm-policy.ts`, `tools.ts` (stubs matching slack)
- Auto-discovery confirmed working (package name `channel-teams` should be enough — verify via SDK docs)

**Acceptance criteria:**
- `bun run typecheck` clean for the new package
- Package compiles and registers without throwing

**Validation:**
```bash
cd packages/channel-teams && bunx tsc --noEmit
bun test packages/channel-teams
```

---

### Group 3: Connect / Disconnect / Inbound

**Goal:** Real Teams connection + webhook activity ingestion.

**Deliverables:**
- `src/connection/` — Bot Framework adapter (or Graph webhook subscription) wiring; per-tenant auth using credentials from `InstanceConfig`
- `src/handlers/` — activity handlers for incoming messages, reactions, mentions, attachments, channel-vs-DM routing, thread/reply mapping
- `src/plugin.ts` — `connect()`, `disconnect()`, `handleWebhook()` implemented
- Connect-time credential validation (lightweight check; document choice)
- Webhook endpoint exposure aligned with how telegram + gupshup do it

**Acceptance criteria:**
- Bad credentials → `connect()` throws a typed `TeamsError(AUTH_FAILED)` (see channel-gupshup error taxonomy)
- Inbound text + attachment events emit correct `IncomingMessage` shape
- Mentions, reactions, channel/DM, threads parsed correctly

**Validation:**
```bash
bun test packages/channel-teams/src/__tests__/handlers.test.ts
bun test packages/channel-teams/src/__tests__/connection.test.ts
```

---

### Group 4: Outbound Senders

**Goal:** Implement outbound paths for every capability the matrix declares.

**Deliverables:**
- `src/senders/text.ts`
- `src/senders/media.ts` (image, audio, video, document — whichever the matrix supports)
- `src/senders/reaction.ts` (if `canSendReaction`)
- `src/senders/typing.ts` (if `canSendTyping`)
- `src/plugin.ts` — `sendMessage()` dispatch wired to senders
- (Adaptive cards: optional v1 — document in DESIGN.md)

**Acceptance criteria:**
- Each sender produces correct Teams activity shape
- `sendMessage()` returns `{ success, messageId, timestamp }` matching SDK contract
- Outbound failures emit `emitMessageFailed` with typed error

**Validation:**
```bash
bun test packages/channel-teams/src/__tests__/senders.test.ts
```

---

### Group 5: Tests, Compliance, Docs

**Goal:** Quality gate + observability.

**Deliverables:**
- `__tests__/` covers connect/disconnect, inbound parsing, outbound senders, error paths, capability negotiation
- `sdk-compliance-test-suite` passes (check `.genie/wishes/sdk-compliance-test-suite/WISH.md` for what it asserts and how to opt in)
- `.env.example` updated with Teams config variables
- Quick docs section (in package README or docs/channel-parity/teams.md) documenting auth setup
- Channel reference doc from Group 1 finalized

**Acceptance criteria:**
- `bun test packages/channel-teams` — all tests pass, no skips
- `bun run typecheck` clean across the whole repo
- sdk-compliance suite green for `channel-teams`

**Validation:**
```bash
bun test packages/channel-teams --reporter verbose
make typecheck
make lint
bunx knip
```

---

## Assumptions & Risks

- **Bot Framework is the right surface** — likely true; if leader picks differently in DESIGN.md, the execution groups still hold but adapter wiring changes.
- **Webhook ingress** — assumes omni already has a way to expose plugin-owned HTTP endpoints (check telegram + gupshup); if not, that's an SDK gap and should escalate.
- **Adaptive Cards in v1** — defaulting to NO; treat outbound as plain text + media unless DESIGN.md upgrades scope.
- **Per-tenant install** — assumes operators register one bot per tenant and store credentials per-instance. Single shared bot across tenants is OUT.
- **SDK compliance suite is the gate** — if it doesn't yet cover plugin acceptance, leader notes it but still ships if everything else is green.

---

## References

- Brainstorm seed: `.genie/brainstorms/teams-channel/DRAFT.md`
- Reference channel: `packages/channel-slack/`
- Channel SDK: `packages/channel-sdk/`
- Sibling wishes: `.genie/wishes/gupshup-channel-rewrite/` (recent rewrite, good template), `.genie/wishes/channel-plugin-generator/` (related generator), `.genie/wishes/sdk-compliance-test-suite/` (compliance gate)
- Microsoft Teams platform docs: https://learn.microsoft.com/en-us/microsoftteams/platform/
- Bot Framework SDK (Node): https://learn.microsoft.com/en-us/azure/bot-service/?view=azure-bot-service-4.0
