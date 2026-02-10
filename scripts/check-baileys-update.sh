#!/usr/bin/env bash
# Baileys version checker — runs periodically via cron
# Compares installed version with latest on npm
# Notifies Felipe via OpenClaw if there's an update

CURRENT="7.0.0-rc.9"
STATE_FILE="/home/genie/workspace/repos/automagik/omni/memory/baileys-version-state.json"

# Get latest from npm
LATEST=$(curl -s "https://registry.npmjs.org/@whiskeysockets/baileys" | python3 -c "
import json, sys
d = json.load(sys.stdin)
tags = d.get('dist-tags', {})
latest = tags.get('latest', '?')
versions = list(d.get('versions', {}).keys())
# Get the highest version (last in the list)
print(versions[-1] if versions else latest)
" 2>/dev/null)

if [ -z "$LATEST" ]; then
  exit 0  # npm unreachable, skip silently
fi

# Check if we already notified about this version
LAST_NOTIFIED=""
if [ -f "$STATE_FILE" ]; then
  LAST_NOTIFIED=$(python3 -c "import json; print(json.load(open('$STATE_FILE')).get('last_notified',''))" 2>/dev/null)
fi

if [ "$LATEST" != "$CURRENT" ] && [ "$LATEST" != "$LAST_NOTIFIED" ]; then
  # New version found! Save state and notify
  echo "{\"current\": \"$CURRENT\", \"latest\": \"$LATEST\", \"last_notified\": \"$LATEST\", \"checked_at\": \"$(date -Iseconds)\"}" > "$STATE_FILE"
  
  # Get changelog/release info
  CHANGELOG=$(curl -s "https://api.github.com/repos/WhiskeySockets/Baileys/releases" | python3 -c "
import json, sys
releases = json.load(sys.stdin)
for r in releases[:3]:
    tag = r.get('tag_name','')
    body = r.get('body','')[:200]
    print(f'{tag}: {body}')
    print()
" 2>/dev/null)

  echo "BAILEYS_UPDATE|$CURRENT|$LATEST|$CHANGELOG"
else
  # No update or already notified — update check timestamp
  echo "{\"current\": \"$CURRENT\", \"latest\": \"$LATEST\", \"last_notified\": \"$LAST_NOTIFIED\", \"checked_at\": \"$(date -Iseconds)\"}" > "$STATE_FILE"
fi
