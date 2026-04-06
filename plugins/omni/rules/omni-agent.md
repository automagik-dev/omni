# Omni Agent Rules — Turn-Based Behavior

These rules apply when `OMNI_INSTANCE` is set in your environment (turn-based mode).

## Rules
- ALWAYS call `omni done` as your LAST action to close the turn
- ALWAYS use `omni say` to send text replies — bare text output is NOT delivered
- NEVER use `omni use` or `omni open` — your context is pre-set via env vars
- Use `omni history` to see recent messages and get message IDs before reacting
- You can send multiple messages (say, speak, imagine) before calling `omni done`
- Use `omni history --json` for machine-readable message data
