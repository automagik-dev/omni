# Brainstorm: teams-channel

**Status:** Simmering
**Started:** 2026-04-26
**Requested by:** @claudecodehapvida2 (via genie orchestrator)

## Goal

Add Microsoft Teams as a first-class channel plugin under `packages/channel-teams`,
using the existing `@omni/channel-sdk` abstraction (`BaseChannelPlugin` + `channelRegistry`).

The work has three explicit phases the user called out:

1. **Design / document the current channel abstraction** — produce a concise reference of
   what every channel plugin must implement (lifecycle, capabilities, event emitters,
   handlers, senders, config, manifest). Treat existing channels as the source of truth.
2. **Study Microsoft Teams platform docs** — understand which Teams surface area
   makes sense to integrate (Bot Framework, Graph API, Webhooks, App SSO, etc.) and pick
   the one that maps cleanest to omni's outbound + inbound message model.
3. **Apply the integration on top of the abstraction** — implement `packages/channel-teams`
   that conforms to the SDK contract. No bespoke abstractions; reuse what slack/discord
   already established.

## Existing channel inventory (reference implementations)

```
packages/channel-sdk        # the abstraction (BaseChannelPlugin, channelRegistry, types, base/, helpers/, discovery/)
packages/channel-slack      # closest analog to Teams (workspace + channels + threads + bots)
packages/channel-discord    # bot-style, slash commands, DMs
packages/channel-telegram   # bot API + webhooks
packages/channel-whatsapp   # baileys (WA Web)
packages/channel-gupshup    # WA Business via Gupshup (recently rewritten — see gupshup-channel-rewrite wish)
packages/channel-a2a        # agent-to-agent
packages/channel-internal   # internal/system channel
```

Slack is the **primary reference** — Teams is the closest in shape (workspace = tenant,
channels, threads, bots, DMs, OAuth/app install flow).

Slack package layout for reference:
```
packages/channel-slack/src/
├── __tests__/
├── components/
├── config/
├── connection/
├── handlers/
├── senders/
├── capabilities.ts   # what the plugin can do (canSendMedia, etc.)
├── dm-policy.ts      # DM behavior
├── index.ts          # plugin entry
├── manifest.ts       # plugin metadata
├── markdown.ts       # message formatting
├── plugin.ts         # main BaseChannelPlugin subclass (~48KB)
├── tools.ts          # exposed tools/capabilities
└── types.ts          # plugin-local types
```

Channel SDK (`packages/channel-sdk/src/`):
```
base/                 # BaseChannelPlugin
discovery/            # auto-discovery for channel-* packages
helpers/              # shared helpers (consumed by base only)
types/                # plugin/capability/message types
dedupe.ts             # cross-channel dedupe
download-guard.ts
history.ts            # history sync support
index.ts              # public surface
reaction-ack.ts       # reaction acknowledgment
sanitize.ts
thread-cache.ts
```

## Phase 1 deliverable — Abstraction Reference

A markdown doc (proposed: `docs/channel-parity/abstraction.md` or
`packages/channel-sdk/README.md`) covering:
- BaseChannelPlugin contract: lifecycle methods (`connect`, `disconnect`,
  `sendMessage`, history sync hooks, etc.)
- Capabilities matrix and `DEFAULT_CAPABILITIES`
- Event emitters (`emitInstanceConnected`, `emitMessageSent`, etc.) and what each
  upstream subscriber expects
- Message types: incoming/outgoing payload shapes
- Manifest + discovery: how `channel-*` packages are auto-loaded
- Helpers available (history, dedupe, reaction-ack, sanitize, thread-cache, download-guard)
- Configuration model: `InstanceConfig`, per-instance secrets, capability negotiation
- Test/compliance expectations (see `sdk-compliance-test-suite` wish)

Use slack + discord as worked examples. Keep it tight — this is a reference, not a tutorial.

## Phase 2 deliverable — Teams Platform Decision

Investigate and decide between (at minimum):

- **Microsoft Bot Framework + Azure Bot Service** — official path for chat bots in Teams,
  supports DMs, channel posts, reactions, adaptive cards, mentions, file uploads. Auth via
  `MicrosoftAppId` + `MicrosoftAppPassword`. Webhook-style activities. **Likely the right pick.**
- **Microsoft Graph API** — for tenant-wide message sync, but needs admin consent and is
  closer to a "read-everything" surface than a bot.
- **Incoming Webhooks / Outgoing Webhooks** — too limited (one-way, single channel).
- **Teams Toolkit / App SSO** — useful for app install flows but not the messaging core.

Document the decision in `DESIGN.md` along with:
- Auth + onboarding flow (per-tenant install, what credentials are stored on `InstanceConfig`)
- Inbound activity → omni `IncomingMessage` mapping (text, attachments, mentions,
  reactions, channel vs DM, threads/replies)
- Outbound `OutgoingMessage` → Teams activity mapping
- Capability matrix (canSendMedia, canSendReaction, canSendTyping, threading, etc.)
- Required dependencies (`botbuilder`, `botframework-connector`, etc.)
- Webhook endpoint exposure (does omni already have a webhook router channels plug into?
  See gupshup + telegram for the pattern.)

## Phase 3 deliverable — `packages/channel-teams`

Implementation that matches the slack package layout (see above). Must:

- Subclass `BaseChannelPlugin`, register via `channelRegistry`
- Pass `sdk-compliance-test-suite` if applicable (check that wish — it may gate plugin acceptance)
- Include `__tests__/` covering connect, send, inbound parsing, error paths
- Wire into discovery (just being named `channel-teams` should be enough — confirm via SDK docs)
- Add example `InstanceConfig` to `.env.example` and any docs
- Run `bun test` and `bun run typecheck` clean

## Open questions for the agent to resolve

- [ ] Where should the abstraction reference live? (docs/channel-parity/ vs channel-sdk/README.md vs both)
- [ ] Does omni already have a unified webhook ingress channels share, or does each plugin
      stand up its own HTTP listener? (Check telegram + gupshup for the pattern.)
- [ ] What's the right Teams auth model — single bot app shared across tenants, or
      per-tenant app registration? Default should be per-instance.
- [ ] Adaptive Cards — in scope for v1 or follow-up?
- [ ] How does omni handle bot mentions vs direct addressing? (Check slack `dm-policy.ts`.)

## Lifecycle the dispatched agent should drive

1. **Brainstorm** (this doc → DESIGN.md) — answer the open questions, lock the Teams
   surface choice, draft the abstraction reference outline.
2. **Wish** — graduate to `.genie/wishes/teams-channel/WISH.md` with execution groups:
   - Group A: write the abstraction reference (Phase 1)
   - Group B: scaffold `packages/channel-teams` skeleton matching slack layout
   - Group C: implement connect/disconnect + inbound webhook parsing
   - Group D: implement outbound senders (text, media, etc. per capability matrix)
   - Group E: tests + compliance + docs
3. **Work** — execute the wish via `/work` or `genie team create`. Honor the
   sdk-compliance-test-suite gate.
4. **Review + ship** — standard review → SHIP path.

## Non-goals

- Reworking the SDK itself. If the abstraction has gaps that block Teams, raise them
  back to the user before extending the SDK.
- Building a Teams app marketplace listing — that's product work, out of scope.
- SSO / admin consent flows beyond what's needed to send/receive messages.
