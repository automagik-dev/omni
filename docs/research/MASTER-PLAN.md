---
title: "The Octopus Plan — Omni Absorbs Everything"
created: 2026-02-09
updated: 2026-02-09
author: "Omni 🐙 (synthesized from Ink 🦑, Pearl 🐚, Coral 🪸, Scroll 📜)"
tags: [strategy, architecture, master-plan, openclaw]
status: draft
---

# The Octopus Plan 🐙

> Omni doesn't integrate WITH anything. Omni ABSORBS what works and becomes the universal messaging backbone that any agent — including OpenClaw — can plug into.

---

## The Vision

```
┌─────────────────────────────────────────────────┐
│              AGENT LAYER (not ours)              │
│  OpenClaw │ AutoGen │ CrewAI │ LangGraph │ Any  │
└──────────────────────┬──────────────────────────┘
                       │ Standard API
                       ▼
┌─────────────────────────────────────────────────┐
│                 OMNI 🐙 (ours)                   │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Identity  │ │ Routing  │ │ Agent Protocol   │ │
│  │ Graph     │ │ Engine   │ │ (MCP/OpenAI/etc) │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Media    │ │ Event    │ │ Humanized        │ │
│  │ Pipeline │ │ Bus      │ │ Action Queue     │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────────────────────────────────────┐   │
│  │        Channel Plugin SDK                 │   │
│  └──────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────┘
                       │ Plugin per channel
                       ▼
┌─────────────────────────────────────────────────┐
│              CHANNEL LAYER (tentacles)           │
│  WhatsApp │ Telegram │ Discord │ Slack │ Signal  │
│  iMessage │ Matrix │ SMS │ Email │ Voice │ Web   │
└─────────────────────────────────────────────────┘
```

**OpenClaw's job:** Be a great personal AI agent (Pi).
**Omni's job:** Be the nervous system that connects Pi (or any agent) to every human on every channel.

---

## What We Learned (Research Synthesis)

### From 🦑 Ink (Baileys Analysis)
- OpenClaw's WhatsApp is **thin** (3 files) — ours is **5x deeper** (2400+ lines, 17 outgoing methods)
- **Critical gap: LID resolution** — we can't map `@lid` addresses to phone numbers. OpenClaw has 3-layer resolution.
- Our `humanDelay()` is better than theirs — they have zero anti-bot protection
- We need: creds backup, save queue serialization, message dedup

### From 🐚 Pearl (Telegram Deep-Dive)
- OpenClaw's Telegram is their **crown jewel** — 100+ config options, 20 adapter interfaces
- **Killer features we need:** draft streaming, inline buttons, forum topics, sticker lifecycle, action gating
- Their **adapter decomposition** pattern is genius — don't have one fat ChannelPlugin interface, have 20 focused ones
- Their **agent tools** let the AI send/react/edit/delete/search stickers — we need the same

### From 🪸 Coral (Integration Architecture)
- OpenClaw extensions register via `OpenClawPluginApi` — channels, tools, hooks, HTTP routes
- Their message pipeline: listener → normalize → security → route → agent → reply
- **Omni as OpenClaw extension** is the cleanest bridge (for now)
- Long-term: Omni IS the platform, OpenClaw plugs into us

### From 📜 Scroll (Docs Audit)
- Our docs were 60% wrong — endpoints.md listed routes that don't exist, CLI docs had wrong syntax
- All 25 docs now updated with frontmatter, wikilinks, accurate content
- Obsidian vault is ready for the team

---

## The Architecture We Need to Build

### Layer 1: Channel Plugin SDK v2

**Absorb OpenClaw's adapter decomposition pattern.** Instead of one monolithic plugin interface:

```typescript
// OLD: One fat interface
interface ChannelPlugin {
  sendMessage(), deleteMessage(), editMessage(), // ... 30 methods
}

// NEW: Decomposed adapters (OpenClaw pattern)
interface ChannelPlugin {
  id: string;
  meta: ChannelMeta;
  
  // Adapters — implement what you support
  outbound?: OutboundAdapter;       // sendText, sendMedia, sendReaction, editMessage, deleteMessage
  inbound?: InboundAdapter;         // message normalization, media download
  security?: SecurityAdapter;       // allowlists, rate limits, pairing
  status?: StatusAdapter;           // health checks, connection state
  config?: ConfigAdapter;           // schema, validation, migration
  threading?: ThreadingAdapter;     // reply context, forum topics
  presence?: PresenceAdapter;       // typing, online/offline, read receipts
  identity?: IdentityAdapter;       // contact resolution, JID/LID mapping
  actions?: ActionAdapter;          // agent tools (what an AI can do)
  streaming?: StreamingAdapter;     // draft streaming, live typing
  buttons?: ButtonAdapter;          // inline buttons, quick replies
  gateway?: GatewayAdapter;         // lifecycle hooks, WS methods
}
```

### Layer 2: Agent Protocol (Universal)

**Any agent framework can plug in.** Not just OpenClaw:

```
┌─────────────────────────────────┐
│     Agent Protocol Adapters     │
├─────────┬───────────┬───────────┤
│ OpenClaw│  OpenAI   │   MCP     │
│ (webhook│ (Realtime │ (tools +  │
│  + WS)  │  API)     │ resources)│
├─────────┼───────────┼───────────┤
│ AutoGen │  CrewAI   │  Custom   │
│ (REST)  │ (webhook) │ (SDK)     │
└─────────┴───────────┴───────────┘
```

**How it works:**
1. Omni receives message on any channel
2. Omni routes to the right agent based on rules (instance config, chat, sender)
3. Agent processes via its native protocol (OpenAI API, MCP, webhook, etc.)
4. Omni delivers the response back through the channel, humanized

**OpenClaw becomes just another agent provider** — not the orchestrator of channels.

### Layer 3: Identity Graph (Our Killer Feature)

OpenClaw has zero cross-channel identity. We have it. This is our moat:

```
Person: "Felipe Rosa"
├── WhatsApp: +5512982298888
├── WhatsApp: 54958418317348@lid (same person!)
├── Telegram: @feliperosa (id: 1061623284)
├── Discord: feliperosa#1234
├── Email: felipe@namastex.ai
└── Omni UUID: cdbb6ca3-...

One person. Multiple tentacles. Omni knows they're the same human.
```

**Agent superpower:** "Send Felipe a message" → Omni picks the best channel based on presence, preference, time of day.

### Layer 4: Humanized Action Queue (Anti-Bot)

What we started with `humanDelay()` becomes a first-class system:

```
┌────────────┐    ┌─────────────────┐    ┌──────────┐
│ API/Agent  │───▶│  Action Queue   │───▶│ Channel  │
│ Request    │    │  (per instance) │    │ Plugin   │
└────────────┘    │                 │    └──────────┘
                  │ • Random delay  │
                  │ • Typing sim    │
                  │ • Rate limit    │
                  │ • Priority      │
                  │ • Retry/DLQ     │
                  └─────────────────┘
```

NATS JetStream consumers per instance. Configurable delays. Priority queue for urgent messages. Dead letter queue for failures.

### Layer 5: Webhook/Event System

Omni emits events. Anyone can subscribe:

```
POST /api/v2/webhooks
{
  "url": "https://my-openclaw.example.com/omni/webhook",
  "events": ["message.received", "message.sent", "presence.update"],
  "instanceIds": ["cdbb6ca3"],
  "secret": "whsec_..."
}
```

This is how OpenClaw (or any agent) receives inbound messages from Omni.

---

## Implementation Roadmap

### Phase 0: Fix the Foundation (NOW — Week 1)
_Before building new, fix what's broken._

| Task | Priority | Effort |
|------|----------|--------|
| LID resolution (phone ↔ LID mapping) | 🔴 Critical | 2-3 days |
| Creds save queue (race condition fix) | 🟡 High | 1 day |
| Message dedup on reconnect | 🟡 High | 1 day |
| Archive/pin/mute QA (participant fix deployed) | 🟢 Medium | 0.5 day |
| `api_key_audit_logs` table migration | 🟢 Medium | 0.5 day |
| CI/CD auto-deploy fix | 🟢 Medium | 0.5 day |

### Phase 1: Channel SDK v2 (Weeks 2-3)
_Decompose the plugin interface._

- Refactor `WhatsAppPlugin` into adapter pattern
- Define adapter interfaces (outbound, inbound, security, identity, actions, streaming, buttons)
- Add `ActionAdapter` — what an AI agent can do (the Telegram tools pattern)
- Add `StreamingAdapter` — draft/live typing support
- Backward compatible — old plugins still work

### Phase 2: Agent Protocol Layer (Weeks 3-4)
_Let any agent plug in._

- Webhook system (Omni → external agent)
- Agent provider abstraction (OpenAI, MCP, OpenClaw, custom)
- Route engine: message → agent based on rules
- Response delivery with humanized queue

### Phase 3: Telegram Channel (Weeks 4-5)
_Second tentacle._

- `packages/channel-telegram/` — using grammY (like OpenClaw)
- Implement all adapters: outbound, inbound, threading, buttons, streaming
- Forum topic support
- Inline buttons with action gating
- Draft streaming

### Phase 4: Identity Graph v2 (Week 5-6)
_Cross-channel intelligence._

- LID resolution for WhatsApp
- Cross-channel person linking (WhatsApp + Telegram + Discord)
- Presence aggregation
- Smart routing ("send to Felipe" picks best channel)
- Person timeline API

### Phase 5: OpenClaw Extension (Week 6-7)
_They plug into us, not the other way around._

- `extensions/omni/` package for OpenClaw
- Bridges OpenClaw's `ChannelPlugin` → Omni API
- Agent tools: identity search, timeline, presence
- Config: map OpenClaw accounts → Omni instances
- Published to npm/clawhub

### Phase 6: More Tentacles (Week 7+)
_Keep growing._

- Discord channel (`packages/channel-discord/`)
- Slack channel
- Signal channel
- Matrix channel
- Email channel
- Voice (ElevenLabs/Twilio integration)
- Web chat widget

---

## What We DON'T Build

| Don't Build | Why | Use Instead |
|-------------|-----|-------------|
| Agent orchestration (sessions, memory, tools) | OpenClaw/LangGraph/etc do this better | Agent Protocol Layer |
| LLM inference | Not our domain | Provider pass-through |
| Frontend framework | React ecosystem exists | Simple dashboard |
| Auth/SSO system | Commodity | Existing solutions |

---

## The Octopus Metaphor (Real)

```
BRAIN (cortex) = Agent Layer (OpenClaw, etc.)
  └── Makes decisions, has memory, uses tools

NERVOUS SYSTEM = Omni
  └── Routes signals, resolves identity, manages channels
  └── Each arm has its own neurons (channel plugins think locally)
  └── Central brain coordinates (event bus, routing engine)

ARMS (tentacles) = Channel Plugins
  └── Each adapts to its environment independently
  └── Each can catch prey (receive messages) on its own
  └── All report back to the nervous system

SUCKERS (sensors) = Adapters
  └── Each sucker on each arm detects something different
  └── Touch, taste, grip = outbound, inbound, security, identity
```

The octopus doesn't need to BE the brain. It needs to be the body that the brain lives in. Any brain. Every brain.

**That's the plan. That's the octopus way.** 🐙

---

_Synthesized from 107KB of research by the Omni Squad:_
- _🦑 Ink: Baileys protocol analysis (22KB)_
- _🐚 Pearl: OpenClaw Telegram deep-dive (33KB)_
- _🪸 Coral: Integration architecture design (41KB)_
- _📜 Scroll: Full docs audit & rewrite (25 files)_
