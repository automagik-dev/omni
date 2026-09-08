---
title: "Omni v2 Knowledge Base"
created: 2025-01-29
updated: 2026-09-08
tags: [index, docs]
status: current
---

# Omni v2 Knowledge Base 🐙

> This folder is an **Obsidian vault**. Open it with [Obsidian](https://obsidian.md) for the best experience.

## Structure

```
docs/
├── api/                    # API design, endpoints, internal routes
├── architecture/           # System architecture (events, identity, plugins, connectors)
├── channels/               # Per-channel setup & internals (Slack, WhatsApp Business, Flows)
├── channel-parity/         # Cross-channel feature parity notes
├── ci/                     # CI / merge-queue decisions
├── cli/                    # CLI design & commands
├── deployment/             # Deployment modes, flags, upgrade checklists
├── design/                 # Design explorations (installer, wireframes)
├── examples/               # Ready-to-use artifacts (event schemas, automations)
├── guides/                 # Task-oriented guides (install, multi-instance, integrations)
├── media/                  # Media processing pipeline
├── migration/              # v1 → v2 migration docs (historical)
├── performance/            # Load tests, baselines
├── research/               # 🔬 Research findings
│   ├── baileys/            # Baileys protocol internals, OpenClaw WhatsApp
│   ├── omni-internals/     # Deep dives into Omni's own systems
│   ├── whatsapp-business/  # WhatsApp Business API, Telegram analysis
│   └── SQUAD.md            # Research squad roster
├── runbooks/               # Operator recipes (webhook sources, consumers, governance)
├── sdk/                    # SDK generation & usage
├── templates/              # Note templates
└── ui/                     # Dashboard components
```

## Document Index

### API

| Document | Description | Status |
|----------|-------------|--------|
| [[api/endpoints\|API Endpoints]] | Complete v2 REST API reference — all route modules | ✅ current |
| [[api/design\|API Design]] | Design principles, auth/scopes, errors, pagination | ✅ current |
| [[api/internal\|Internal API]] | Localhost-only service-to-service endpoints | ✅ current |
| [[api/v1-compatibility-layer\|V1 Compatibility Layer]] | v1 → v2 endpoint mapping for UI migration | 🗄️ historical |

### Architecture

| Document | Description | Status |
|----------|-------------|--------|
| [[overview\|Architecture Overview]] | System components, request flows, deployment | ✅ current |
| [[event-system\|Event System]] | Event journal, schema registry, causality, durable consumers, replay | ✅ current |
| [[connector-contract\|Connector Contract]] | Webhook-source lifecycle: signatures, idempotency, heartbeats | ✅ current |
| [[identity-graph\|Identity Graph]] | Cross-platform identity resolution and merging | ✅ current |
| [[adr-0003-lid-first-identity\|ADR-0003: LID-First Identity]] | Decision record for LID-first identity keying | ✅ current |
| [[actor-model\|Actor Model]] | Actor-based concurrency notes | ✅ current |
| [[a2a-implementation\|A2A Implementation]] | Agent-to-agent channel design | ✅ current |
| [[plugin-system\|Plugin System]] | Channel plugin SDK, lifecycle, capabilities | ✅ current |
| [[provider-system\|Provider System]] | AI agent provider configuration | ✅ current |

### Channels

| Document | Description | Status |
|----------|-------------|--------|
| [[slack\|Slack]] | Slack setup: Agent messaging experience, tokens, threads, scheduling | ✅ current |
| [[channels/whatsapp-business\|WhatsApp Business (Meta)]] | Cloud API setup, webhooks, templates, alerts | ✅ current |
| [[whatsapp-flows\|WhatsApp Flows]] | Meta WhatsApp Flows integration | ✅ current |
| [[telegram-whatsapp\|Telegram ↔ WhatsApp Parity]] | Cross-channel feature parity notes | ✅ current |

### CLI

| Document | Description | Status |
|----------|-------------|--------|
| [[cli/design\|CLI Design]] | All CLI commands, flags, and usage examples | ✅ current |

### Guides

| Document | Description | Status |
|----------|-------------|--------|
| [[install\|Installation Guide]] | Step-by-step install, setup, verify, troubleshoot | ✅ current |
| [[multi-instance\|Multi-Instance Deployments]] | Running multiple isolated Omni servers on one host | ✅ current |
| [[streaming-responses\|Streaming Responses]] | Streaming agent replies into channels | ✅ current |
| [[typing-debounce\|Typing & Debounce]] | Presence and message debouncing behavior | ✅ current |
| [[idle-chat-follow-up\|Idle Chat Follow-Up]] | Automated follow-ups on idle conversations | ✅ current |
| [[openclaw-integration\|OpenClaw Integration]] | Connecting OpenClaw as an agent provider | ✅ current |
| [[openclaw-from-scratch\|OpenClaw From Scratch]] | Full OpenClaw + Omni walkthrough | ✅ current |

### Runbooks

| Document | Description | Status |
|----------|-------------|--------|
| [[github-webhook-source\|GitHub Webhook Source]] | Config-only GitHub → Omni event ingress recipe | ✅ current |
| [[clickup-webhook-source\|ClickUp Webhook Source]] | Config-only ClickUp → Omni event ingress recipe | ✅ current |
| [[durable-consumers\|Durable Consumers]] | Named journal cursors: create, follow, monitor lag | ✅ current |
| [[agent-publish-governance\|Agent Publish Governance]] | Manifest `publishes` allowlist enforcement and DLQ semantics | ✅ current |
| [[identity-reconciliation\|Identity Reconciliation]] | Reconciling split/orphaned identities | ✅ current |

### Deployment

| Document | Description | Status |
|----------|-------------|--------|
| [[single-tenant-mode\|Single-Tenant (Master-Key) Mode]] | Default deployment mode: flags, what changed unconditionally, large-database upgrade checklist | ✅ current |
| [[platform-credential-bootstrap\|Platform Credential Bootstrap]] | First PLATFORM-class credential without direct SQL | ✅ current |

Release/upgrade runbooks (`upgrade-*.md`, `public-launch-readiness.md`) also live in `deployment/` and are maintained by the release process.

### Media

| Document | Description | Status |
|----------|-------------|--------|
| [[processing\|Media Processing]] | Audio transcription, image/video description, document extraction | ✅ current |

### SDK

| Document | Description | Status |
|----------|-------------|--------|
| [[auto-generation\|SDK Auto-Generation]] | OpenAPI → TypeScript/Go/Python SDK generation | ✅ current |
| [[typescript-sdk\|TypeScript SDK]] | TypeScript SDK usage and API | ✅ current |

### Migration

| Document | Description | Status |
|----------|-------------|--------|
| [[plan\|Migration Plan]] | v1 → v2 migration strategy (Strangler Fig) | 🗄️ historical |
| [[ui-reuse\|UI Reuse Strategy]] | Reusing v1 React dashboard with v2 API | 🗄️ historical |
| [[v1-features-analysis\|V1 Features Analysis]] | Feature parity analysis | 🗄️ historical |
| [[nats-genie-sidecar-decommission\|NATS-Genie Sidecar Decommission]] | Sidecar removal notes | 🗄️ historical |

### CI

| Document | Description | Status |
|----------|-------------|--------|
| [[merge-queue\|Merge Queue]] | Why dev uses a merge queue and the settings change | ✅ current |
| [[ci-quality-setup-guide\|CI Quality Setup Guide]] | Quality-gate workflow setup | ✅ current |

### Performance

| Document | Description | Status |
|----------|-------------|--------|
| [[baseline\|Performance Baseline]] | Measured performance benchmarks (2026-02-05) | ✅ current |
| [[load-test-results\|Load Test Results]] | Load test results (2026-02-05) | ✅ current |

### UI

| Document | Description | Status |
|----------|-------------|--------|
| [[components\|UI Components]] | Component specifications for v2 dashboard | 📝 draft |

### Research

| Document | Description | Status |
|----------|-------------|--------|
| [[SQUAD\|Research Squad]] | Research squad roster and mission | ✅ current |
| [[jid-mentions-groups\|Baileys: JIDs, Mentions, Groups]] | WhatsApp identity and messaging reference via Baileys | ✅ current |
| [[openclaw-whatsapp-analysis\|OpenClaw WhatsApp Analysis]] | OpenClaw ↔ WhatsApp integration analysis | ✅ current |
| [[openclaw-integration-design\|OpenClaw Integration Design]] | OpenClaw ↔ Omni architecture design | ✅ current |
| [[openclaw-telegram-analysis\|OpenClaw Telegram Analysis]] | Telegram channel plugin deep analysis | ✅ current |

### Templates

| Document | Description |
|----------|-------------|
| [[api-doc\|API Doc Template]] | Template for new API documentation |
| [[research-note\|Research Note Template]] | Template for research findings |

## Conventions

- **Wikilinks**: Use `[[Page Name]]` for internal links
- **Tags**: Use YAML frontmatter `tags:` — e.g. `[baileys, api, research]`
- **Frontmatter**: Every doc has YAML frontmatter with `title`, `created`, `updated`, `tags`, `status`
- **File naming**: `kebab-case.md`
- **Status**: `current` | `outdated` | `draft`

## Maintained By

Maintained by the Omni development team.
