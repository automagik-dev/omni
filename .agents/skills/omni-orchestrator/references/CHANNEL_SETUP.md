# Channel Setup Reference

## Telegram

**Requirements:** Bot token from @BotFather

```bash
omni channels add --type telegram --name "My Telegram Bot" --bot-token "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
```

**Post-setup:**
1. Instance created automatically
2. Bot starts receiving messages immediately
3. Set default instance: `omni config set defaultInstance <id>`

## Discord

**Requirements:** Bot token + Guild ID

```bash
omni channels add --type discord --name "My Discord Bot" \
  --bot-token "MTIzNDU2Nzg5MDEyMzQ1Njc4.GHIjkl.abcdefghijklmnopqrstuvwxyz" \
  --guild-id "123456789012345678"
```

**Post-setup:**
1. Bot joins the specified guild
2. Invite URL printed for additional guilds
3. Slash commands registered automatically

## Slack

**Requirements:** App token + Bot token

```bash
omni channels add --type slack --name "My Slack Bot" \
  --app-token "<your-slack-app-token>" \
  --bot-token "<your-slack-bot-token>"
```

**Post-setup:**
1. Socket mode connection established
2. Add bot to channels via Slack UI
3. Event subscriptions configured automatically

## WhatsApp

**Requirements:** Phone number with WhatsApp installed

### QR Code Method

```bash
# Create instance
instance_id=$(omni instances create --channel whatsapp --name "My WA" --json | jq -r '.data.id')

# Display QR (auto-refreshes)
omni instances qr "$instance_id" --watch

# Verify connection
omni instances status "$instance_id"
```

### Pairing Code Method

```bash
omni instances pair "$instance_id" --phone +5511999999999
# Enter the 8-digit code in WhatsApp > Linked Devices
```

### Post-setup

```bash
# Set default
omni config set defaultInstance "$instance_id"

# Sync history
omni instances sync "$instance_id" --type messages --depth 30d

# Sync contacts
omni instances sync "$instance_id" --type contacts
```
