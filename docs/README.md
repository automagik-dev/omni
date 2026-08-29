---
title: "Omni v2 Knowledge Base"
created: 2025-01-29
updated: 2026-02-09
tags: [index, docs]
status: current
---

# Omni v2 Knowledge Base 🐙

> This folder is an **Obsidian vault**. Open it with [Obsidian](https://obsidian.md) for the best experience.

## Structure

```
docs/
├── api/                    # API design, endpoints, internal routes
├── architecture/           # System architecture (events, identity, plugins)
├── cli/                    # CLI design & commands
├── deployment/             # Deployment modes, flags, upgrade checklists
├── media/                  # Media processing pipeline
├── migration/              # v1 → v2 migration docs
├── performance/            # Load tests, baselines
├── research/               # 🔬 Research findings
│   ├── baileys/            # Baileys protocol internals, OpenClaw WhatsApp
│   ├── omni-internals/     # Deep dives into Omni's own systems
│   ├── whatsapp-business/  # WhatsApp Business API, Telegram analysis
│   └── SQUAD.md            # Research squad roster
├── sdk/                    # SDK generation & usage
├── templates/              # Note templates
└── ui/                     # Dashboard components
```

## Document Index

### API

| Document | Description | Status |
|----------|-------------|--------|
| [[endpoints\|API Endpoints]] | Complete v2 REST API reference — all route modules | ✅ current |
| [[design\|API Design]] | Design principles, versioning strategy | ✅ current |
| [[internal\|Internal API]] | Localhost-only service-to-service endpoints | ✅ current |
| [[v1-compatibility-layer\|V1 Compatibility Layer]] | v1 → v2 endpoint mapping for UI migration | ✅ current |

### Architecture

| Document | Description | Status |
|----------|-------------|--------|
| [[overview\|Architecture Overview]] | System components, request flows, deployment | ✅ current |
| [[event-system\|Event System]] | NATS JetStream events, types, handlers, replay | ✅ current |
| [[identity-graph\|Identity Graph]] | Cross-platform identity resolution and merging | ✅ current |
| [[plugin-system\|Plugin System]] | Channel plugin SDK, lifecycle, capabilities | ✅ current |
| [[provider-system\|Provider System]] | AI agent provider configuration | ✅ current |

### CLI

| Document | Description | Status |
|----------|-------------|--------|
| [[design\|CLI Design]] | All CLI commands, flags, and usage examples | ✅ current |

### Deployment

| Document | Description | Status |
|----------|-------------|--------|
| [[single-tenant-mode\|Single-Tenant (Master-Key) Mode]] | Default deployment mode: flags, what changed unconditionally, large-database upgrade checklist | ✅ current |

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
