---
name: omni-instances
description: |
  Manage Omni channel instances — list, connect, disconnect, restart, QR codes, status checks, and sync operations for WhatsApp, Discord, Slack, and Telegram.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Instances

Manage channel connections (WhatsApp, Discord, Slack, Telegram) via `omni instances`.

## List Instances

```bash
omni instances list
omni instances list --json | jq '.[] | {id, name, channelType, status}'
```

## Create Instance

```bash
omni instances create --channel whatsapp --name "My WhatsApp"
```

## QR Code (WhatsApp)

```bash
omni instances qr <id>
omni instances qr <id> --watch
omni instances qr <id> --base64
```

## Pairing Code

```bash
omni instances pair <id> --phone <number>
```

## Connection Management

```bash
omni instances connect <id>
omni instances disconnect <id>
omni instances restart <id>
omni instances logout <id>
```

## Status & Info

```bash
omni instances status <id>
omni instances whoami <id>
```

## Sync Operations

```bash
omni instances sync <id> --type messages --depth 7d
omni instances sync <id> --type messages --depth 7d --download-media
omni instances sync <id> --type all
omni instances syncs <id>
omni instances syncs <id> <job-id>
```

## Contacts & Groups

```bash
omni instances contacts <id> --limit 100
omni instances contacts <id> --search "Name"
omni instances groups <id>
omni instances groups <id> --search "team"
```

## Profile & Privacy

```bash
omni instances profile <id> <user-id>
omni instances check <id> +<phone-number>
omni instances update-bio <id> "Available"
omni instances privacy <id>
```

## Blocking

```bash
omni instances block <id> <contact-id>
omni instances unblock <id> <contact-id>
omni instances blocklist <id>
```

## Group Management

```bash
omni instances group-create <id> --name "Team Chat" --participants "+55119999,+55118888"
omni instances group-invite <id> <group-jid>
omni instances group-revoke-invite <id> <group-jid>
omni instances group-join <id> <invite-code>
```

## Tips

- Use smart ID resolution: prefix, name substring, or full UUID.
- Set default instance: `omni config set defaultInstance <id>` to skip `--instance`.
