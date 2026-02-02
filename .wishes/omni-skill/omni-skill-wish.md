# WISH: Omni Skill

> Create an "omni skill" for AI assistants (Claude Code, etc.) following SKILLS.md guidelines.

**Status:** DRAFT
**Created:** 2026-02-02
**Author:** WISH Agent
**Beads:** omni-a8p

---

## Context

AI assistants like Claude Code use skills to extend their capabilities. Instead of (or alongside) an MCP server, we'll create an **omni skill** that follows the SKILLS.md specification and uses the omni CLI under the hood.

**Why skill over MCP?**
- Skills are simpler to create and maintain
- Skills follow a standard format (SKILLS.md)
- Skills can leverage the CLI we're already building
- Better integration with Claude Code's workflow

**Architecture:**
```
Claude Code (or other AI assistant)
    ↓
omni skill (SKILLS.md format)
    ↓
omni CLI commands
    ↓
Omni API
```

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | CLI is complete and working |
| **ASM-2** | Assumption | SKILLS.md format is stable |
| **DEC-1** | Decision | Skill wraps CLI, doesn't call API directly |
| **DEC-2** | Decision | Focus on common operations first |

---

## Scope

### IN SCOPE

- Skill definition following SKILLS.md
- Instance management operations
- Message sending operations
- Event querying operations
- Chat/conversation operations
- Status/health checks

### OUT OF SCOPE

- Complex automation workflows
- Provider management (admin task)
- Full API coverage (just common ops)

---

## Execution Group A: Research & Design

**Goal:** Understand SKILLS.md format and design skill structure.

**Deliverables:**
- [ ] Study SKILLS.md specification
- [ ] Design skill command structure
- [ ] Document which CLI commands to expose

**Research Questions:**
- What's the SKILLS.md format?
- How do skills declare capabilities?
- How do skills handle auth/config?
- Best practices for skill design?

---

## Execution Group B: Core Skill

**Goal:** Implement the omni skill with core operations.

**Deliverables:**
- [ ] `skills/omni/skill.md` or equivalent location
- [ ] Instance operations (list, status, connect)
- [ ] Message operations (send text, send media)
- [ ] Event operations (list, search)

**Example Skill Operations:**

```markdown
## omni

Manage Omni messaging platform instances and send messages.

### Commands

#### List Instances
```bash
omni instances list --json
```

#### Send Message
```bash
omni send --instance <id> --to <recipient> --text "message"
```

#### Check Status
```bash
omni status --json
```

#### Search Events
```bash
omni events search "query" --since 24h --json
```
```

---

## Execution Group C: Advanced Operations

**Goal:** Add more sophisticated operations.

**Deliverables:**
- [ ] Chat/conversation context
- [ ] Person search and timeline
- [ ] Bulk operations (if needed)

---

## Technical Notes

### Skill Format (Example)

Based on typical SKILLS.md patterns:

```markdown
---
name: omni
description: Manage Omni messaging platform
version: 1.0.0
requires:
  - omni CLI installed and authenticated
---

# Omni Skill

## Setup

1. Install omni CLI: `bun add -g @omni/cli`
2. Authenticate: `omni auth login --api-key <key>`

## Operations

### Send a message
Use when you need to send a message through a messaging channel.

```bash
omni send --instance {{instance}} --to {{recipient}} --text "{{message}}" --json
```

### List instances
Use when you need to see available messaging instances.

```bash
omni instances list --json
```
```

### Auth Handling

The skill assumes the CLI is already authenticated (`~/.omni/config.json` has API key). The skill doesn't manage credentials directly.

### JSON Output

All CLI commands used by the skill should use `--json` flag for structured, parseable output that AI assistants can work with.

---

## Dependencies

- `cli-setup` - CLI must be complete

## Depends On

- `cli-setup`

## Enables

- AI assistants (Claude Code) can manage Omni
- Automated workflows via AI
- Natural language Omni management
