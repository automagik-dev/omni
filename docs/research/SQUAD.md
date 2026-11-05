---
title: "Omni Research Squad"
created: 2026-02-09
updated: 2026-02-09
tags: [meta, squad, agents]
status: current
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
sessions_spawn(task="...", label="scroll-readme-rewrite")
```

## Naming Convention

- Session labels: `{name}-research` or `{name}-review` or `{name}-readme-rewrite`
- Commit messages: `docs(research/{domain}): {description}` or `docs(readme): {description}`
- Branch: research stays on `main` (docs only, no code changes)

## Scroll README Review Protocol

When spawned for a README review, Scroll must:

1. **Read the current README.md**
2. **Scan the codebase** for drift:
   - `packages/*/package.json` — new/removed packages
   - `packages/channel-*/src/capabilities.ts` — channel feature changes
   - `packages/api/src/routes/v2/index.ts` — new API routes
   - `packages/cli/src/index.ts` — new CLI commands
   - `apps/ui/src/App.tsx` — new UI pages
   - Recent `git log --oneline -20` — new features/fixes
3. **Verify all claims** — never claim features that don't exist in code
4. **Rewrite stale sections** — update only what changed, preserve what's accurate
5. **Commit to main** — `docs(readme): {description} 📜`
6. **Report back** — summary of what changed + what's still accurate

### Image Generation (for banners/graphics)

Use Nano Banana Pro (Gemini image gen):
```bash
GEMINI_API_KEY="..." uv run /path/to/nano-banana-pro/scripts/generate_image.py \
  --prompt "..." --filename "out.png" --resolution 1K
```
