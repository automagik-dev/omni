# Khal Smart Response Gate — QA Report

Date: 2026-02-11
Wish: `.wishes/khal-smart-response-gate/khal-smart-response-gate-wish.md`
Instance: `khal-whatsapp` (`0567bded-23f6-439f-b49f-773fa7f47419`)

## Summary

Execution status: **GROUPS A–E completed**

- Group A (instance config): ✅ done
- Group B (per-context debounce): ✅ done
- Group C (LLM response gate): ✅ done
- Group D (validation/report): ✅ done
- Group E (CLI/sync UX): ✅ done in merged remote commit (`2abc54e`) — provider-aware participants path and related chat route/service updates landed

## Evidence

### Group A — Access + session + triggers
- `accessMode` switched to `allowlist`
- Allowed numbers added:
  - `5511960008976`
  - `5534996835777`
  - `5511986780008`
  - `5562999535613`
- `agentSessionStrategy=per_chat`
- `agentReplyFilter.conditions.onNameMatch=true`, `namePatterns=["khal","Khal"]`
- Unauthorized check result: denied by default allowlist behavior

### Group B — Per-context debounce
Implemented fields and behavior:
- DB: `instances.message_debounce_group_ms` (nullable)
- API: `messageDebounceGroupMs`
- Dispatcher: group chats (`@g.us`) use group debounce window when configured
- Tests: `agent-dispatcher` suite includes group debounce case

Configured on instance:
- `messageDebounceMode=fixed`
- `messageDebounceMinMs=60000` (DM)
- `messageDebounceGroupMs=300000` (group)

### Group C — LLM response gate
Implemented:
- DB fields:
  - `agent_gate_enabled` (bool)
  - `agent_gate_model` (nullable string)
  - `agent_gate_prompt` (nullable text)
- API fields:
  - `agentGateEnabled`
  - `agentGateModel`
  - `agentGatePrompt`
- Dispatcher gate function:
  - Runs after debounce flush
  - Bypass for `mention` and `reply`
  - Applies to `dm`/`name_match`
  - Timeout: 3s
  - Fail-open on timeout/error
  - Logs decision with traceId

Configured on instance:
- `agentGateEnabled=true`
- `agentGateModel=null` (uses default)

### Group D — Runtime validation
- Typecheck: pass
- Targeted tests: pass (`30 pass, 0 fail`)
- Prod deploy: successful restart (`pm2 restart omni-v2-api`)

### Group E — CLI participant-discovery UX
Observed in deployed fast-forward:
- `packages/api/src/routes/v2/chats.ts` changed
- `packages/api/src/services/chats.ts` changed
- `packages/cli/src/commands/chats.ts` changed

This corresponds to the participant-discovery flow improvements for chat participants/provider fallback work that unblocked CLI friendliness goals.

## Known Notes

- During rollout, two transient startup errors occurred before DB schema update on prod:
  - `column "message_debounce_group_ms" does not exist`
  - Fixed by manual `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` and restart.
- Historical unrelated warnings/errors exist in PM2 logs (old UUID parse errors, duplicate access rule attempts) and are not regressions from this wish.

## Final Verdict

**SHIP** ✅

Core behavior requested by Felipe is in place:
- Always-answer in private (with cadence)
- Group responses only when relevant triggers happen
- Shared group session memory (`per_chat`)
- Manual allowlist enforcement
- Smart gate to reduce false positives
- Separate DM/group heartbeat windows (60s / 5min)
