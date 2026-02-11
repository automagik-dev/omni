# Wish: CLI — Instance Sessions Debugging (`omni instances sessions`)

**Status:** DRAFT
**Slug:** `instances-sessions-cli`
**Created:** 2026-02-10

---

## Summary

Add CLI commands for debugging agent session state per instance/chat. This enables quick inspection of session keys, provider assignment, and (for OpenClaw) the mapped OpenClaw `sessionKey`.

---

## Scope

### IN
- `omni instances sessions <instanceId>`
  - lists recent chats with session identifiers and provider info
- Optional: `--chat-id <id>` to show the computed session key
- For OpenClaw instances: show `agent:<agentId>:omni-<chatId>` mapping

### OUT
- Full session observatory UI (separate wish)

---

## Acceptance Criteria

- [ ] Command exists and is discoverable in `--help`
- [ ] Lists at least: instanceId, agentProviderId, agentId, chatId, computed sessionId/sessionKey
- [ ] Handles missing provider gracefully
- [ ] Works on dev + prod

---

## Notes

Identified as a follow-up item during OpenClaw provider planning as a pragmatic debugging tool.
