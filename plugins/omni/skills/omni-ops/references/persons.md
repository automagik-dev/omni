# Persons — Contact Directory

Persons are auto-created from incoming messages — no manual creation. One person can hold multiple platform identities (WhatsApp + Telegram + ...).

## Commands

```bash
omni persons search "Example User" --json
omni persons search "+5511999" --limit 5 --json
omni persons get <personId> --json
omni persons presence <personId> --json                  # online status / last seen
omni persons update <personId> --name "Ana Souza" --json # also --phone, --email, --avatar, --metadata
omni persons merge <sourceId> <targetId> --reason "duplicate"   # source is DELETED — confirm first
omni persons link <identityA> <identityB>                # bind two platform identities to one person
omni persons unlink <identityId>
```

## Patterns

```bash
# Find a person and check presence
omni persons search "Example User" --json | jq '.[0] | {id, name, phone}'
omni persons presence <personId> --json | jq '{online: .online, lastSeen: .lastSeen}'

# All persons matching a phone prefix
omni persons search "+5511" --limit 100 --json | jq '.[] | {id, name, phone}'
```

Use `omni persons --help` and the leaf command's help for installed options. Search/presence are reads; merge deletes the source and link/unlink change identity associations. Confirm identities and the intended mutation before applying them; don't treat an identity merge as a messaging retry.
