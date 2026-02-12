# Wish: Instance Roles — Listener vs Actor Mode

**Status:** PRE-WISH (needs brainstorm)
**Slug:** `instance-roles`
**Created:** 2026-02-12
**Beads:** `omni-cqa`

---

## Problem

Today every Omni instance is treated as a "bot that responds to incoming messages." But real-world usage shows a clear split:

- **Listener** (copilot): receives commands from the human, searches info, sweeps contacts, lists pending tasks. The human talks TO the bot.
- **Actor** (proxy/delegate): initiates conversations, sends messages as the human, responds to third parties on behalf of the human. The bot talks AS the human.

Felipe's two WhatsApp numbers demonstrate this perfectly:
- `12982298888` (pessoal) → **Listener**: Felipe sends commands, bot finds info, does sweeps
- `11986780008` (Namastex) → **Actor**: bot acts as Felipe, sends messages to people, responds

## Proposed Solution

1. **`instanceRole`** field on instance schema: `listener` | `actor` | `hybrid` (default: `hybrid` for backward compat)
2. **Dispatcher awareness**: actor instances can initiate outbound messages (not just respond)
3. **Agent context injection**: the agent prompt gets role context so it knows whether to "answer the human" or "act as the human"
4. **API surface**: actor instances get `POST /instances/:id/send` for proactive messaging (already exists, but semantics should be role-aware)

## Open Questions
- Should actor instances also respond to inbound? (hybrid mode)
- How does the agent know which contacts to reach out to?
- Rate limiting / safety guardrails for actor mode (don't spam people)
- Identity: when the actor sends a message, does the recipient see "Namastex Labs" or "Felipe"?

## Success Criteria (Draft)
- [ ] Instance schema has `role` field with migration
- [ ] Agent prompt includes role semantics
- [ ] Dispatcher handles actor-initiated messages
- [ ] Felipe's two instances work as described
