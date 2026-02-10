#!/usr/bin/env bash
# Baileys update checker — called by cron, notifies via OpenClaw session
set -euo pipefail

SCRIPT="/home/genie/workspace/repos/automagik/omni/scripts/check-baileys-update.sh"
RESULT=$(bash "$SCRIPT" 2>/dev/null)

if echo "$RESULT" | grep -q "^BAILEYS_UPDATE"; then
  CURRENT=$(echo "$RESULT" | cut -d'|' -f2)
  LATEST=$(echo "$RESULT" | cut -d'|' -f3)
  
  # Use openclaw to send a message to the omni session
  openclaw message send --channel telegram --target 1061623284 \
    "🐙 **Baileys Update Available!**

Current: \`$CURRENT\`
Latest: \`$LATEST\`

Time to update \`@whiskeysockets/baileys\` in the WhatsApp channel plugin. Run:
\`\`\`
cd packages/channel-whatsapp && bun add @whiskeysockets/baileys@$LATEST
\`\`\`" 2>/dev/null || true
fi
