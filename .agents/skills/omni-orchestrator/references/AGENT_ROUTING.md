# Agent Routing Reference

## Assign Provider

Set AI provider for an instance:

```bash
omni instances update <id> --agent-routing '{"providerId":"<provider-id>","model":"gpt-4o"}'
```

Create a provider first:

```bash
omni providers create --name "openai" --type openai --api-key sk_xxx
omni providers test <provider-id>
```

## Reply Filters

Control which contacts the bot responds to.

### Whitelist Mode

Only respond to listed contacts:

```bash
omni instances update <id> --reply-filter '{
  "mode": "whitelist",
  "contacts": ["5511999@s.whatsapp.net", "5511888@s.whatsapp.net"]
}'
```

### Blacklist Mode

Respond to everyone except listed contacts:

```bash
omni instances update <id> --reply-filter '{
  "mode": "blacklist",
  "contacts": ["5511777@s.whatsapp.net"]
}'
```

### No Filter

Remove all filters:

```bash
omni instances update <id> --reply-filter '{"mode": "none"}'
```

## Debounce

Prevent rapid-fire responses in group chats.

### Group Debounce

Wait for silence before responding:

```bash
omni instances update <id> --debounce '{"type":"group","delay":5000}'
```

### Delay Debounce

Fixed delay per message:

```bash
omni instances update <id> --debounce '{"type":"delay","delay":2000}'
```

### No Debounce

```bash
omni instances update <id> --debounce '{"type":"none"}'
```

## Access Modes

| Mode | Behavior |
|------|----------|
| `public` | Anyone can interact with the bot |
| `private` | Only whitelisted contacts |
| `disabled` | Bot does not respond |

```bash
omni instances update <id> --access-mode "public"
omni instances update <id> --access-mode "private"
omni instances update <id> --access-mode "disabled"
```
