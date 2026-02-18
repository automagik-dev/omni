# Reply Filters Reference

## Whitelist Mode

Only respond to contacts explicitly listed.

```bash
omni instances update <id> --reply-filter '{
  "mode": "whitelist",
  "contacts": [
    "5511999999999@s.whatsapp.net",
    "5511888888888@s.whatsapp.net"
  ]
}'
```

**Behavior:**
- Messages from listed contacts: processed by agent
- Messages from unlisted contacts: silently ignored
- Group messages: processed if any listed contact sent them

## Blacklist Mode

Respond to everyone except listed contacts.

```bash
omni instances update <id> --reply-filter '{
  "mode": "blacklist",
  "contacts": [
    "5511777777777@s.whatsapp.net"
  ]
}'
```

**Behavior:**
- Messages from listed contacts: silently ignored
- Messages from all other contacts: processed by agent
- Group messages from blocked contacts: ignored

## Name Patterns

Filter by contact display name patterns (regex-based):

```bash
omni instances update <id> --reply-filter '{
  "mode": "whitelist",
  "namePatterns": ["^Team.*", "^Support.*"]
}'
```

**Behavior:**
- Contacts whose names match any pattern: included (whitelist) or excluded (blacklist)
- Patterns are case-insensitive regex
- Can combine with `contacts` list — either match triggers

## Removing Filters

```bash
omni instances update <id> --reply-filter '{"mode": "none"}'
```

## Checking Current Filter

```bash
omni instances get <id> --json | jq '.replyFilter'
```
