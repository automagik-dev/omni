---
title: "Omni Research Squad"
created: 2026-02-09
updated: 2026-02-09
tags: [meta, squad, agents]
---

# Omni Research Squad 🐙

The octopus family — specialized sub-agents that research, document, and review.

## Members

### 🦑 Ink — Baileys Protocol Specialist
- **Domain:** Baileys internals, WebSocket protocol, JID/LID system, message types
- **Focus areas:** Anti-bot detection mechanisms, rate limiting, session management, multi-device protocol
- **Output folder:** `docs/research/baileys/`
- **Key question:** How does WhatsApp detect bots, and what are the exact behavioral thresholds?

### 🐚 Pearl — WhatsApp Business Analyst
- **Domain:** WhatsApp Business API (official), Meta policies, compliance
- **Focus areas:** Business vs personal API differences, ban triggers, terms of service, feature gaps
- **Output folder:** `docs/research/whatsapp-business/`
- **Key question:** What can the official Business API do that Baileys can't, and vice versa?

### 🪸 Coral — Omni Architecture Researcher
- **Domain:** Omni v2 internals, event system, NATS JetStream patterns
- **Focus areas:** Action queue design, plugin SDK, identity graph unification, channel abstraction
- **Output folder:** `docs/research/omni-internals/`
- **Key question:** How should the action queue work to protect all instances automatically?

### 📜 Scroll — Documentation Reviewer
- **Domain:** All Omni docs, Obsidian vault maintenance
- **Focus areas:** Docs-code sync, stale content detection, cross-references, formatting
- **Output folder:** All of `docs/`
- **Key question:** Are the docs accurate given the current state of the codebase?

## How They Work

1. **Omni (🐙)** spawns sub-agents via `sessions_spawn` with specific research tasks
2. Each sub-agent gets a focused prompt with their domain context
3. Sub-agents research (web search, code analysis, doc reading) and write findings to their output folder
4. Findings use the `docs/templates/research-note.md` template
5. Results are announced back to the main session when complete
6. **Omni (🐙)** reviews, synthesizes, and acts on findings

## Spawning

```
# Example spawn commands (from Omni main session)
sessions_spawn(task="...", label="ink-research")
sessions_spawn(task="...", label="pearl-research")
sessions_spawn(task="...", label="coral-research")
sessions_spawn(task="...", label="scroll-review")
```

## Naming Convention

- Session labels: `{name}-research` or `{name}-review`
- Commit messages: `docs(research/{domain}): {description}`
- Branch: research stays on `main` (docs only, no code changes)
