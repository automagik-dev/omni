# Omni CLI - Real-World Examples

Practical workflows and scripts using the Omni CLI, including TTS voice notes, message automation, and analytics.

---

## Message Listening & Monitoring

### Listen for New Messages (Smart Polling)

```bash
#!/bin/bash
# Listen to a chat and execute action when new messages arrive

instance_id="<your-instance>"
chat_id="<recipient-id>@s.whatsapp.net"
last_msg_id=""

echo "👂 Listening for new messages in $chat_id..."

while true; do
  # Get latest message
  latest=$(omni chats messages "$chat_id" --limit 1 --json --instance "$instance_id" 2>/dev/null)

  if [ $? -eq 0 ] && [ -n "$latest" ]; then
    current_id=$(echo "$latest" | jq -r '.[0].id // empty')

    # Check if we have a new message
    if [ -n "$current_id" ] && [ "$current_id" != "$last_msg_id" ]; then
      # Extract message details
      sender=$(echo "$latest" | jq -r '.[0].senderDisplayName')
      text=$(echo "$latest" | jq -r '.[0].textContent // empty')
      type=$(echo "$latest" | jq -r '.[0].messageType')

      echo "[$(date '+%H:%M:%S')] 💬 New $type from $sender"

      # Only show text if it exists
      if [ -n "$text" ]; then
        echo "   📝 $text"
      fi

      # ⚡ DO SOMETHING WITH THE MESSAGE HERE
      # Examples:
      # - Save to database
      # - Trigger webhook
      # - Auto-reply
      # - Send notification

      last_msg_id="$current_id"
    fi
  fi

  sleep 2  # Poll every 2 seconds
done
```

### Watch Multiple Chats

```bash
#!/bin/bash
# Monitor multiple chats for new messages

instance_id="<your-instance>"
declare -A last_ids  # Associative array to track last message per chat

# Add chats to monitor
chats=(
  "<recipient-id>@s.whatsapp.net"
  "555198888888@s.whatsapp.net"
)

echo "👀 Monitoring ${#chats[@]} chats..."

while true; do
  for chat_id in "${chats[@]}"; do
    latest=$(omni chats messages "$chat_id" --limit 1 --json --instance "$instance_id" 2>/dev/null)

    if [ $? -eq 0 ] && [ -n "$latest" ]; then
      current_id=$(echo "$latest" | jq -r '.[0].id // empty')

      # Check if new message for this chat
      if [ -n "$current_id" ] && [ "$current_id" != "${last_ids[$chat_id]}" ]; then
        sender=$(echo "$latest" | jq -r '.[0].senderDisplayName')
        text=$(echo "$latest" | jq -r '.[0].textContent // empty')

        echo "💬 [$chat_id] $sender: $text"

        last_ids[$chat_id]="$current_id"
      fi
    fi
  done

  sleep 3
done
```

### Event Stream Monitor

```bash
#!/bin/bash
# Watch for new events in real-time

instance_id="<your-instance>"
last_check=$(date -u +%s)

echo "📡 Monitoring events..."

while true; do
  current_time=$(date -u +%s)

  # Get events since last check
  events=$(omni events list --instance "$instance_id" \
    --since "${last_check}s" --json 2>/dev/null)

  if [ $? -eq 0 ] && [ -n "$events" ]; then
    count=$(echo "$events" | jq 'length')

    if [ "$count" -gt 0 ]; then
      echo "[$(date '+%H:%M:%S')] ⚡ $count new events"

      # Show event types
      echo "$events" | jq -r '.[] | "  • \(.type) - \(.payload.message.textContent // .payload | tostring | .[0:50])"'
    fi
  fi

  last_check=$current_time
  sleep 5
done
```

### Live Dashboard with `watch`

```bash
# Live updating dashboard (refreshes every 2s)
watch -n 2 'omni analytics --instance <id> 2>/dev/null'

# Watch unread messages
watch -n 3 'omni chats list --unread-only --instance <id>'

# Monitor instance status
watch -n 5 'omni instances get <id> | grep -E "(status|connected|qrCode)"'

# Track message flow
watch -n 2 'omni messages search "" --since 5m --limit 10'
```

### Auto-Reply Bot with Message Detection

```bash
#!/bin/bash
# Auto-reply when specific keywords detected

instance_id="<your-instance>"
last_check_time=$(date -u +%s)

# Keywords to watch for
keywords=("help" "support" "status" "info")

echo "🤖 Auto-reply bot started..."

while true; do
  current_time=$(date -u +%s)

  # Search for keyword messages
  for keyword in "${keywords[@]}"; do
    results=$(omni messages search "$keyword" --since "${last_check_time}s" \
      --json --instance "$instance_id" 2>/dev/null)

    if [ $? -eq 0 ] && [ -n "$results" ]; then
      # Process each matching message
      echo "$results" | jq -c '.[] | select(.isFromMe == false)' | \
        while IFS= read -r msg; do
          chat_id=$(echo "$msg" | jq -r '.chatId')
          msg_text=$(echo "$msg" | jq -r '.textContent')
          sender=$(echo "$msg" | jq -r '.senderDisplayName')

          echo "🔔 Keyword '$keyword' detected from $sender"

          # Auto-reply based on keyword
          case "$keyword" in
            "help")
              reply="[cheerful] Hi! I'm here to help. Please describe your issue and a team member will respond shortly."
              ;;
            "support")
              reply="[professional] Thank you for contacting support. Your request has been logged. Expected response time: 30 minutes."
              ;;
            "status")
              reply="All systems operational. How can I assist you today?"
              ;;
            "info")
              reply="For information, visit our website or send 'help' for assistance."
              ;;
          esac

          # Send TTS reply
          omni send --to "$chat_id" --tts "$reply" --instance "$instance_id"
          echo "✅ Auto-replied to $sender"
        done
    fi
  done

  last_check_time=$current_time
  sleep 10  # Check every 10 seconds
done
```

### Notification Trigger on New Message

```bash
#!/bin/bash
# Send desktop notification when new message arrives

instance_id="<your-instance>"
chat_id="<recipient-id>@s.whatsapp.net"
last_msg_id=""

while true; do
  latest=$(omni chats messages "$chat_id" --limit 1 --json --instance "$instance_id" 2>/dev/null)

  if [ $? -eq 0 ] && [ -n "$latest" ]; then
    current_id=$(echo "$latest" | jq -r '.[0].id // empty')

    if [ -n "$current_id" ] && [ "$current_id" != "$last_msg_id" ]; then
      sender=$(echo "$latest" | jq -r '.[0].senderDisplayName')
      text=$(echo "$latest" | jq -r '.[0].textContent // "(media)"')

      # Desktop notification (macOS)
      osascript -e "display notification \"$text\" with title \"Message from $sender\""

      # Or Linux notify-send
      # notify-send "Message from $sender" "$text"

      # Or log to file
      echo "[$(date)] $sender: $text" >> ~/omni-messages.log

      last_msg_id="$current_id"
    fi
  fi

  sleep 2
done
```

---

## TTS (Text-to-Speech) Workflows

### Send Daily Voice Briefing

```bash
#!/bin/bash
# Send daily briefing as voice note

instance_id="<your-instance>"
recipient="+<phone-number>"

# Generate briefing text
briefing="Good morning! Here's your daily update.
You have 5 new messages and 2 unread chats.
Today's schedule: Team meeting at 10 AM."

# Send as TTS voice note
omni send --to "$recipient" --tts "$briefing" --instance "$instance_id"
```

### Auto-respond with Voice Notes

```bash
#!/bin/bash
# Auto-respond to keywords with TTS

instance_id="<your-instance>"

while true; do
  # Search for "help" messages
  omni messages search "help" --since 5m --json | \
    jq -r '.[] | select(.isFromMe == false) | "\(.chatId)"' | \
    while read -r chat_id; do
      # Respond with voice note
      omni send --to "$chat_id" \
        --tts "Hi! I received your help request. A team member will respond shortly." \
        --instance "$instance_id"
    done

  sleep 60
done
```

### Bulk TTS Notifications

```bash
#!/bin/bash
# Send TTS notifications to multiple recipients

instance_id="<your-instance>"
message="Important system update completed successfully. All services are now online."

# List of recipients
recipients=(
  "+<phone-number>"
  "+<phone-number>"
  "+<phone-number>"
)

for recipient in "${recipients[@]}"; do
  echo "Sending to: $recipient"
  omni send --to "$recipient" --tts "$message" --instance "$instance_id"
  sleep 2  # Rate limiting
done
```

### Different Voices for Different Contexts

```bash
#!/bin/bash
# Use different voices based on message type

instance_id="<your-instance>"
recipient="+<phone-number>"

# Friendly voice for greetings
friendly_voice="xWdpADtEio43ew1zGxUQ"
omni send --to "$recipient" --tts "Welcome back! How can I help you today?" \
  --voice-id "$friendly_voice" --instance "$instance_id"

# Professional voice for updates
professional_voice="pNInz6obpgDQGcFmaJgB"
omni send --to "$recipient" --tts "Your order has been processed and will ship tomorrow." \
  --voice-id "$professional_voice" --instance "$instance_id"
```

---

## WhatsApp Automation

### Auto-respond to Keywords

```bash
#!/bin/bash
# Monitor for "help" messages and auto-respond

instance_id="<your-instance-id>"

while true; do
  # Search for recent "help" messages
  omni messages search "help" --since 5m --json | \
    jq -r '.[] | select(.isFromMe == false) | "\(.chatId)|\(.id)"' | \
    while IFS='|' read -r chat_id msg_id; do
      # Reply with help text
      omni send --to "$chat_id" \
        --text "👋 Hi! I'm here to help. Type 'support' to talk to a human." \
        --reply-to "$msg_id" \
        --instance "$instance_id"
    done

  sleep 60
done
```

### Broadcast to Multiple Chats

```bash
#!/bin/bash
# Send announcement to all active chats

instance_id="<your-instance-id>"
message="🚀 System maintenance tonight at 10 PM. Service will be down for 1 hour."

# Get all chats with activity in last 7 days
omni chats list --instance "$instance_id" --json | \
  jq -r --arg since "$(date -d '7 days ago' +%s)000" \
  '.[] | select(.lastMessageAt > ($since | tonumber)) | .id' | \
  while read -r chat_id; do
    echo "Sending to: $chat_id"
    omni send --to "$chat_id" --text "$message" --instance "$instance_id"
    sleep 2  # Rate limiting
  done
```

### Export Chat with Media and Transcriptions

```bash
#!/bin/bash
# Export chat messages with media and audio transcriptions

chat_id="<chat-id>"
instance_id="<instance-id>"
output_dir="./export_${chat_id}"

mkdir -p "$output_dir"

# Export messages with proper field names
echo "Exporting messages..."
omni chats messages "$chat_id" --limit 10000 --json > "$output_dir/messages.json"

# Create readable summary with transcriptions
jq -r '.[] | {
  sender: .senderDisplayName,
  type: .messageType,
  text: .textContent,
  transcription: .transcription,
  time: .platformTimestamp
}' "$output_dir/messages.json" > "$output_dir/messages_readable.json"

# Extract and download media
echo "Downloading media..."
jq -r '.[] | select(.mediaUrl != null) | "\(.id)|\(.mediaUrl)"' "$output_dir/messages.json" | \
  while IFS='|' read -r msg_id url; do
    filename="${msg_id}_media"
    echo "Downloading: $filename"
    curl -s "$url" -o "$output_dir/$filename"
  done

# Extract TTS voice notes
echo "Extracting voice note transcriptions..."
jq -r '.[] | select(.messageType == "audio" and .transcription != null) |
  "\(.senderDisplayName): \(.transcription)"' "$output_dir/messages.json" \
  > "$output_dir/transcriptions.txt"

echo "Export complete: $output_dir"
```

---

## Chat Analysis

### Message Frequency Heatmap

```bash
#!/bin/bash
# Analyze message frequency by hour of day

instance_id="<instance-id>"

omni events analytics --instance "$instance_id" --since 30d --json | \
  jq -r '.messagesByHour // {} | to_entries[] | "\(.key): \(.value)"' | \
  sort -t: -k1 -n | \
  while IFS=: read -r hour count; do
    printf "%02d:00 " "$hour"
    printf '█%.0s' $(seq 1 $(($count / 10)))
    echo " ($count)"
  done
```

### Top Contacts by Message Count

```bash
#!/bin/bash
# Find most active conversations

instance_id="<instance-id>"

omni chats list --instance "$instance_id" --json | \
  jq -r 'sort_by(.messageCount) | reverse | .[0:10] |
    .[] | "\(.messageCount)\t\(.name // .id)"' | \
  column -t -s $'\t'
```

### Unread Message Report

```bash
#!/bin/bash
# Generate daily unread summary

instance_id="<instance-id>"

echo "📊 Unread Messages Report - $(date '+%Y-%m-%d %H:%M')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

total_unread=$(omni chats list --instance "$instance_id" --unread --json | \
  jq '[.[].unreadCount] | add // 0')

echo "Total unread: $total_unread"
echo ""
echo "Top 5 chats:"

omni chats list --instance "$instance_id" --unread --json | \
  jq -r 'sort_by(.unreadCount) | reverse | .[0:5] |
    .[] | "\(.unreadCount)\t\(.name // "Unknown")"' | \
  column -t -s $'\t'
```

---

## Batch Operations

### Transcribe All Voice Notes in Chat

```bash
#!/bin/bash
# Batch transcribe voice messages

chat_id="<chat-id>"
instance_id="<instance-id>"

# Create batch job
job_id=$(omni batch create \
  --instance "$instance_id" \
  --chat "$chat_id" \
  --type transcribe \
  --content-types audio \
  --days 30 \
  --json | jq -r .data.id)

echo "Batch job created: $job_id"
echo "Monitoring progress..."

# Watch progress
omni batch status "$job_id" --watch --interval 5000
```

### Bulk Mark as Read

```bash
#!/bin/bash
# Mark all messages in specific chats as read

instance_id="<instance-id>"
chat_ids=("chat-id-1" "chat-id-2" "chat-id-3")

for chat_id in "${chat_ids[@]}"; do
  echo "Marking $chat_id as read..."

  # Get unread message IDs
  msg_ids=$(omni chats messages "$chat_id" --json | \
    jq -r '.[] | select(.isRead == false) | .id' | \
    tr '\n' ',' | \
    sed 's/,$//')

  if [ -n "$msg_ids" ]; then
    omni messages read --batch --instance "$instance_id" --ids "$msg_ids"
    echo "✓ Marked as read"
  else
    echo "• No unread messages"
  fi
done
```

---

## Instance Management

### Multi-Instance Status Dashboard

```bash
#!/bin/bash
# Display status of all instances

echo "📱 Instance Status Dashboard"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

omni instances list --json | \
  jq -r '.[] | "\(.name)|\(.channelType)|\(.status)|\(.phoneNumber // "N/A")"' | \
  while IFS='|' read -r name channel status phone; do
    # Color code status
    case "$status" in
      connected) status_icon="🟢" ;;
      disconnected) status_icon="🔴" ;;
      connecting) status_icon="🟡" ;;
      *) status_icon="⚪" ;;
    esac

    printf "%-30s %-12s %s %-10s %s\n" "$name" "$channel" "$status_icon" "$status" "$phone"
  done
```

### Auto-reconnect Disconnected Instances

```bash
#!/bin/bash
# Monitor and reconnect instances

while true; do
  omni instances list --json | \
    jq -r '.[] | select(.status == "disconnected") | .id' | \
    while read -r instance_id; do
      echo "$(date): Reconnecting $instance_id..."
      omni instances connect "$instance_id"
    done

  sleep 300  # Check every 5 minutes
done
```

### Sync All Instances

```bash
#!/bin/bash
# Trigger sync on all connected instances

omni instances list --json | \
  jq -r '.[] | select(.status == "connected") | .id' | \
  while read -r instance_id; do
    echo "Syncing: $instance_id"
    omni instances sync "$instance_id" --type messages --depth 7d &
  done

wait
echo "All syncs complete"
```

---

## Event Processing

### Event Replay for Testing

```bash
#!/bin/bash
# Replay events to test automation changes

# Dry run first to see what would happen
echo "Dry run - checking events to replay..."
omni events replay --start --since 1h --dry-run

read -p "Proceed with replay? (y/n) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
  # Start replay
  session_id=$(omni events replay --start --since 1h --json | jq -r .data.sessionId)

  echo "Replay started: $session_id"
  echo "Monitoring..."

  # Monitor progress
  while true; do
    status=$(omni events replay --status "$session_id" --json | jq -r .data.status)
    echo "Status: $status"

    if [[ "$status" == "completed" || "$status" == "failed" ]]; then
      break
    fi

    sleep 5
  done

  echo "Replay complete"
  omni events replay --status "$session_id"
fi
```

### Timeline Analysis

```bash
#!/bin/bash
# Analyze person activity timeline

person_id="<person-id>"

echo "📅 Activity Timeline for $person_id"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

omni events timeline "$person_id" --json | \
  jq -r '.[] | "\(.timestamp | tonumber / 1000 | strftime("%Y-%m-%d %H:%M"))\t\(.type)\t\(.summary // "")"' | \
  column -t -s $'\t'
```

---

## Automation Management

### Create Support Routing Automation

```bash
#!/bin/bash
# Auto-route messages to support agent based on keywords

omni automations create \
  --name "Support Router" \
  --trigger message.received \
  --action call_agent \
  --agent-id support-agent \
  --response-as agentResponse \
  --condition '[
    {
      "field": "messageContent",
      "operator": "contains_any",
      "value": ["help", "support", "issue", "problem"]
    },
    {
      "field": "isFromMe",
      "operator": "equals",
      "value": false
    }
  ]' \
  --condition-logic "and"
```

### Automation Health Check

```bash
#!/bin/bash
# Check all automations and their recent activity

echo "🤖 Automation Health Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

omni automations list --json | \
  jq -r '.[] | "\(.id)|\(.name)|\(.status)|\(.executionCount // 0)"' | \
  while IFS='|' read -r id name status count; do
    status_icon="⚪"
    case "$status" in
      enabled) status_icon="🟢" ;;
      disabled) status_icon="🔴" ;;
      error) status_icon="⚠️" ;;
    esac

    printf "%-40s %s %-10s Runs: %d\n" "$name" "$status_icon" "$status" "$count"

    # Show recent errors
    if [ "$status" == "error" ]; then
      echo "  Last error:"
      omni automations logs "$id" --json | \
        jq -r '.[0].error' | \
        sed 's/^/    /'
    fi
  done
```

---

## Monitoring & Alerting

### Health Check Script

```bash
#!/bin/bash
# Comprehensive system health check

check_api() {
  echo -n "API: "
  if omni status --json &>/dev/null; then
    echo "✓ Reachable"
    return 0
  else
    echo "✗ Unreachable"
    return 1
  fi
}

check_instances() {
  echo -n "Instances: "
  disconnected=$(omni instances list --json | \
    jq '[.[] | select(.status == "disconnected")] | length')

  if [ "$disconnected" -eq 0 ]; then
    echo "✓ All connected"
    return 0
  else
    echo "⚠️  $disconnected disconnected"
    return 1
  fi
}

check_automations() {
  echo -n "Automations: "
  errors=$(omni automations list --json | \
    jq '[.[] | select(.status == "error")] | length')

  if [ "$errors" -eq 0 ]; then
    echo "✓ All running"
    return 0
  else
    echo "⚠️  $errors with errors"
    return 1
  fi
}

echo "🏥 Health Check - $(date)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

status=0
check_api || status=1
check_instances || status=1
check_automations || status=1

exit $status
```

### Slack Alert on Errors

```bash
#!/bin/bash
# Monitor for errors and send Slack alerts

slack_webhook="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"

while true; do
  # Check for recent errors in events
  errors=$(omni events search "error" --since 5m --json)
  error_count=$(echo "$errors" | jq length)

  if [ "$error_count" -gt 0 ]; then
    message="🚨 $error_count errors in last 5 minutes"

    curl -X POST "$slack_webhook" \
      -H 'Content-Type: application/json' \
      -d "{\"text\":\"$message\"}"
  fi

  sleep 300
done
```

---

## Data Export & Backup

### Full Instance Backup

```bash
#!/bin/bash
# Backup all data for an instance

instance_id="<instance-id>"
backup_dir="./backup_$(date +%Y%m%d_%H%M%S)"

mkdir -p "$backup_dir"

echo "📦 Backing up instance: $instance_id"

# Export instance config
echo "Exporting instance config..."
omni instances get "$instance_id" --json > "$backup_dir/instance.json"

# Export all chats
echo "Exporting chats..."
omni chats list --instance "$instance_id" --json > "$backup_dir/chats.json"

# Export messages from each chat
echo "Exporting messages..."
jq -r '.[].id' "$backup_dir/chats.json" | \
  while read -r chat_id; do
    echo "  Chat: $chat_id"
    omni chats messages "$chat_id" --limit 10000 --json > "$backup_dir/messages_${chat_id}.json"
  done

# Export contacts
echo "Exporting contacts..."
omni instances contacts "$instance_id" --limit 10000 --json > "$backup_dir/contacts.json"

# Export groups
echo "Exporting groups..."
omni instances groups "$instance_id" --json > "$backup_dir/groups.json"

echo "✓ Backup complete: $backup_dir"
tar -czf "${backup_dir}.tar.gz" "$backup_dir"
echo "✓ Archive created: ${backup_dir}.tar.gz"
```

### Export Analytics Report

```bash
#!/bin/bash
# Generate analytics report

instance_id="<instance-id>"
report_file="analytics_$(date +%Y%m%d).json"

echo "📊 Generating analytics report..."

# Combine multiple analytics
jq -n \
  --argjson events "$(omni events analytics --instance "$instance_id" --since 30d --json)" \
  --argjson chats "$(omni chats list --instance "$instance_id" --json)" \
  '{
    generatedAt: (now | strftime("%Y-%m-%d %H:%M:%S")),
    period: "30d",
    events: $events,
    totalChats: ($chats | length),
    unreadChats: ($chats | map(select(.unreadCount > 0)) | length),
    totalMessages: ($chats | map(.messageCount // 0) | add),
    topChats: ($chats | sort_by(.messageCount) | reverse | .[0:10])
  }' > "$report_file"

echo "✓ Report saved: $report_file"

# Pretty print summary
jq '{
  generatedAt,
  period,
  totalChats,
  unreadChats,
  totalMessages,
  topChatNames: .topChats[].name
}' "$report_file"
```

---

## Integration Examples

### Webhook to Omni

```bash
#!/bin/bash
# Webhook endpoint that sends messages via Omni

# In your webhook handler:
payload='{"to": "+<phone-number>", "message": "Alert: New order received!"}'

instance_id="<instance-id>"
to=$(echo "$payload" | jq -r .to)
message=$(echo "$payload" | jq -r .message)

omni send --to "$to" --text "$message" --instance "$instance_id" --json
```

### Calendar Reminders

```bash
#!/bin/bash
# Send WhatsApp reminders from calendar events

instance_id="<instance-id>"

# Example: Read from calendar (adjust to your calendar system)
# For now, simulate with a simple format
reminders_file="./reminders.txt"

while IFS='|' read -r time recipient message; do
  current_time=$(date +%s)
  reminder_time=$(date -d "$time" +%s)

  if [ "$current_time" -ge "$reminder_time" ]; then
    echo "Sending reminder to $recipient..."
    omni send --to "$recipient" --text "⏰ Reminder: $message" --instance "$instance_id"

    # Remove from file
    sed -i "/$time|$recipient|$message/d" "$reminders_file"
  fi
done < "$reminders_file"
```

---

## Performance Optimization

### Parallel Message Sending

```bash
#!/bin/bash
# Send messages in parallel for better throughput

instance_id="<instance-id>"
recipients_file="recipients.txt"  # One phone number per line
message="📢 Important update: System maintenance tonight"

# Use GNU parallel if available
if command -v parallel &> /dev/null; then
  cat "$recipients_file" | \
    parallel -j 5 "omni send --to {} --text '$message' --instance '$instance_id'"
else
  # Fallback: background jobs
  while read -r recipient; do
    omni send --to "$recipient" --text "$message" --instance "$instance_id" &

    # Limit concurrent jobs
    while [ $(jobs -r | wc -l) -ge 5 ]; do
      sleep 0.1
    done
  done < "$recipients_file"

  wait
fi

echo "✓ All messages sent"
```

---

These examples demonstrate real-world usage patterns. Adapt them to your specific needs and integrate with your existing systems!
