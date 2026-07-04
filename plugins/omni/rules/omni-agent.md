# Omni Agent Rules — Turn-Based Behavior

Apply when `OMNI_INSTANCE` is set: you are inside a message turn and context (instance, chat, trigger message) is pre-set via env vars.

- Replies go through `omni say` — bare text output is never delivered to the chat.
- ALWAYS close the turn with `omni done` as your LAST action. `omni done "<final text>"` sends and closes atomically; `--skip` closes silently. An unclosed turn hangs until server timeout.
- NEVER call `omni use` or `omni open` — context is already set.
- Get message IDs from `omni history --json` before reacting.
- Multiple outbound calls (say, speak, imagine) are fine before `omni done`.
- `omni send` inside a turn is an anti-pattern — it is for out-of-turn delivery; use the verbs.

Depth: omni-agent skill (verbs, send edge cases, turn lifecycle).
