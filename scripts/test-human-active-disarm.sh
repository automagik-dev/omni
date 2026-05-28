#!/usr/bin/env bash
# Smoke test: out-of-band human takeover → follow-up sweeper should disarm
# with reason 'human_active' (after PR #667 merges).
#
# Before PR #667: shows the bug — sweeper fires `chat.idle_timeout` despite
# the human reply, no disarm happens.
# After PR #667: shows the fix — within ~15s the row is disarmed with reason
# `human_active` and no `chat.idle_timeout` is published.
#
# Usage:
#   PGURL=postgresql://postgres:postgres@localhost:18432/omni \
#   OMNI_URL=http://localhost:8882 \
#   ./scripts/test-human-active-disarm.sh
#
# Optional:
#   CHAT_ID=<uuid>          Use this chat instead of auto-picking one.
#   SWEEP_WAIT_SECONDS=25   Override the wait (default 25s = sweeper tick + margin).

set -euo pipefail

PGURL="${PGURL:?PGURL must be set, e.g. postgresql://postgres:postgres@localhost:18432/omni}"
OMNI_URL="${OMNI_URL:-http://localhost:8882}"
SWEEP_WAIT_SECONDS="${SWEEP_WAIT_SECONDS:-25}"

step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
sql()  { psql "$PGURL" -At -F'|' -c "$1"; }

step '1. Pick a chat to test'
if [[ -z "${CHAT_ID:-}" ]]; then
  CHAT_ID=$(sql "SELECT id FROM chats WHERE channel = 'gupshup' ORDER BY last_message_at DESC NULLS LAST LIMIT 1")
  if [[ -z "$CHAT_ID" ]]; then
    echo "ERR: No gupshup chats found in DB. Set CHAT_ID=<uuid> explicitly." >&2
    exit 1
  fi
fi
echo "chatId = $CHAT_ID"
sql "SELECT id, name, last_message_at, last_message_from_me FROM chats WHERE id = '$CHAT_ID'"

step '2. Ensure a follow-up row exists and is armed'
EXISTING_ROW=$(sql "SELECT id, disarm_reason, next_fire_at, last_agent_message_at FROM chat_follow_up_state WHERE chat_id = '$CHAT_ID' LIMIT 1")
if [[ -n "$EXISTING_ROW" ]]; then
  echo "Existing follow-up row: $EXISTING_ROW"
  # Reset the row to armed, set lastAgentMessageAt to 5min ago, nextFireAt to now
  # so the sweeper will pick it up on the next tick.
  sql "UPDATE chat_follow_up_state
       SET disarm_reason = NULL,
           disarmed_at = NULL,
           next_fire_at = NOW(),
           last_agent_message_at = NOW() - INTERVAL '5 minutes',
           updated_at = NOW()
       WHERE chat_id = '$CHAT_ID'"
  echo "Re-armed existing row, nextFireAt=NOW, lastAgentMessageAt=5min ago"
else
  echo "No follow-up row exists for this chat. The sweeper has nothing to act on."
  echo "Pick a chat that has had agent activity (use omni chats list to find one)."
  exit 2
fi

step '3. Inject out-of-band human takeover'
# Simulates an operator replying to the chat directly in the channel inbox.
# The probe needs: lastMessageAt > lastAgentMessageAt + graceMs AND lastMessageFromMe = true.
sql "UPDATE chats
     SET last_message_at = NOW(),
         last_message_from_me = true,
         last_message_preview = '[SMOKE TEST] simulated operator reply',
         updated_at = NOW()
     WHERE id = '$CHAT_ID'"
echo "Set chats.lastMessageAt = NOW, lastMessageFromMe = true"

step "4. Wait $SWEEP_WAIT_SECONDS s for the sweeper tick"
for i in $(seq 1 "$SWEEP_WAIT_SECONDS"); do
  printf '.'
  sleep 1
done
echo

step '5. Observe the result'
AFTER=$(sql "SELECT disarm_reason, disarmed_at, next_fire_at FROM chat_follow_up_state WHERE chat_id = '$CHAT_ID' LIMIT 1")
echo "After sweep tick: $AFTER"

DISARM_REASON=$(echo "$AFTER" | cut -d'|' -f1)
if [[ "$DISARM_REASON" == "human_active" ]]; then
  echo
  echo "✅ PASS — sweeper detected the out-of-band takeover and disarmed with 'human_active'."
  echo "   This means PR #667 (or equivalent) is live."
elif [[ -z "$DISARM_REASON" ]]; then
  echo
  echo "❌ FAIL — row is still armed (disarm_reason IS NULL). The sweeper either"
  echo "   didn't run yet, or this build doesn't include PR #667. Expected behaviour"
  echo "   on origin/main BEFORE the merge."
elif [[ "$DISARM_REASON" == "sequence_complete" || "$DISARM_REASON" == "window_expired" ]]; then
  echo
  echo "⚠️  Row disarmed but with a different reason: $DISARM_REASON"
  echo "   Probably the sweeper fired and advanced normally before the probe could see"
  echo "   the takeover. Re-run with SWEEP_WAIT_SECONDS=10 or after another tick."
else
  echo
  echo "⚠️  Unexpected disarm reason: $DISARM_REASON"
fi

step '6. Optional: verify re-arm semantics'
echo "To verify that a future agent reply re-arms the sequence, run:"
echo
echo "  omni say --chat $CHAT_ID --text 'follow-up re-arm probe' --agent eugenia"
echo
echo "Then check chat_follow_up_state.disarmReason returns to NULL with a fresh nextFireAt."
