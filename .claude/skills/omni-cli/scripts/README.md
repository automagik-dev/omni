# Omni CLI Message Listeners

Ready-to-use bash scripts for monitoring messages in real-time.

## Scripts

### 📡 `listen-chat.sh` - Continuous Listener

Listen for new messages continuously and log them.

```bash
./listen-chat.sh <instance-id> <chat-id> [poll-interval]
```

**Example:**
```bash
./listen-chat.sh <instance-id> <chat-id> 2
```

**What it does:**
- Polls chat every N seconds (default: 2)
- Logs every new message with timestamp and sender
- Runs forever until killed
- Shows both incoming (💬) and outgoing (📤) messages

**Customize:** Edit the `# ADD YOUR ACTION HERE` section to trigger actions on new messages.

---

### ⏳ `wait-for-message.sh` - One-Shot Trigger

Wait for ONE new message, then exit (wake up trigger).

```bash
./wait-for-message.sh <chat-id> [poll-interval]
```

**Example:**
```bash
./wait-for-message.sh <chat-id>
```

**What it does:**
- Captures current latest message ID
- Polls until a NEW message arrives
- Exits immediately when new message detected
- Perfect for "wake me up when message arrives" pattern

**Use with background tasks:**
```bash
# In Claude Code, use Bash tool with run_in_background: true
# When message arrives, task completes and you get notified
```

---

## Running in Background (Claude Code)

Use the Bash tool's `run_in_background` parameter:

```python
Bash(
    command="cd .claude/skills/omni-cli/scripts && ./wait-for-message.sh <chat-id>",
    run_in_background=True
)
```

When the script exits (message detected), you'll get a task notification.

---

## Requirements

- **Omni CLI** installed and configured
- **jq** for JSON parsing (`brew install jq` or `apt install jq`)
- Instance must be connected

---

## Tips

### Find Your Chat ID

```bash
# Search by name
omni chats list | grep "Chat Name"

# Or use short ID
omni chats get <short-id>
```

### Customizing Actions (listen-chat.sh)

Edit the script and modify this section:

```bash
# ⚡ ADD YOUR ACTION HERE ⚡
# Examples:
# - Auto-reply: omni send --to "$CHAT_ID" --text "Got it!"
# - Log to file: echo "[$timestamp] $sender: $text" >> log.txt
# - Webhook: curl -X POST https://webhook.com -d "{\"msg\": \"$text\"}"
```

### Debugging

```bash
# Test manually first
omni chats messages <chat-id> --limit 1 --json

# Check if jq is installed
which jq

# Verify instance connection
omni instances list
```

---

**Use case examples:**

- **Continuous monitoring:** Use `listen-chat.sh` to monitor a support chat and log all messages
- **Wake-up trigger:** Use `wait-for-message.sh` in background to get notified when someone replies
- **Custom workflows:** Combine with other tools (webhooks, databases, notifications)
