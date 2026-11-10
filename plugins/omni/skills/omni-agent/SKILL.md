---
name: omni-agent
description: "Send and reply across Omni channels, browse conversations, use media and voice, and close agent turns."
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Agent

## When to Use

Communicate through Omni, find conversation context, send media or voice, or finish a bridge-delivered turn.

## Flow

1. Read `omni --help`, then the relevant command's help. Read [ground rules](../omni-ops/references/ground-rules.md); use [communication examples](references/communication.md) and [message browsing and voices](references/messages.md) only after checking installed options.
2. Resolve the authorized server, channel instance and recipient. For an out-of-turn send, confirm the intended instance is connected. For a bridge-delivered turn, preserve its preset context instead of changing the active instance or chat.
3. Read only the conversation context needed for the task. Use installed help to choose the appropriate communication command and its flags; resolve message IDs before quoting or reacting. Audio, generated media and scheduled delivery need the same target authorization as text.
4. Perform the requested communication and inspect its receipt. Exit 0 confirms command success; claim channel delivery only when a receipt or an observed message confirms it.
5. In a turn-based dispatch, make `omni done` the last action: use `omni done "<final>"` for the final message or `omni done --skip --reason "<reason>"` to close silently. Inspect `omni done --help` for other supported final responses.

## Rules

- The bridge supplies `OMNI_INSTANCE`, `OMNI_CHAT`, `OMNI_MESSAGE` and `OMNI_TURN_ID`. Inside that context, use Omni verbs for replies; bare assistant output does not reach the channel. Never change the active instance or chat mid-turn.
- Every turn-based dispatch must close its turn; otherwise it remains open until timeout. Multiple mid-turn messages may precede the final action.
- Out of turn, explicitly establish and check context using the installed CLI before sending; never inherit an unrelated recipient from a prior task.
- Add `--json` to parsed output, preserve credential scopes and return only needed personal fields. Empty results do not authorize broader access.
- Discovery and conversation history do not authorize outbound actions. Confirm the intended scope before destructive message actions or terminal contact outcomes.
