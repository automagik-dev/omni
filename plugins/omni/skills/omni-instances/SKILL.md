---
name: omni-instances
description: |
  Operate Omni channel instances: lifecycle, QR/pairing, sync jobs, contacts/groups, profile/privacy, and history backfill via resync.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Instances

## Discovery and lifecycle

```bash
omni instances list --json
omni instances list --channel whatsapp-baileys --status connected --json
omni instances get <id> --json
omni instances create --name "Ops WA" --channel whatsapp-baileys --json
omni instances update <id> --name "Ops WA Prod" --json
omni instances delete <id> --json

omni instances status <id> --json
omni instances whoami <id> --json
omni instances connect <id> --json
omni instances disconnect <id> --json
omni instances restart <id> --force-new-qr --json
omni instances logout <id> --json
```

## WhatsApp connect

```bash
omni instances qr <id> --watch --json
omni instances qr <id> --base64 --json
omni instances pair <id> --phone +5511999999999 --json
```

## Sync and backfill

```bash
omni instances sync <id> --type messages --depth 30d --download-media --json
omni instances syncs <id> --limit 20 --json
omni instances syncs <id> <jobId> --json

omni resync --instance <id> --since 2h --json
omni resync --all --since 1h --dry-run --json
```

## Contacts, groups, profile

```bash
omni instances contacts <id> --limit 100 --search "Felipe" --json
omni instances groups <id> --search "team" --json
omni instances profile <id> <userId> --json
omni instances check <id> +5511999 --json
omni instances update-bio <id> "Available" --json
omni instances privacy <id> --json
```

## Moderation and group ops

```bash
omni instances block <id> <contactId> --json
omni instances unblock <id> <contactId> --json
omni instances blocklist <id> --json

omni instances group-create <id> --subject "Team" --participants +5511999 +5511888 --json
omni instances group-invite <id> <groupJid> --json
omni instances group-revoke-invite <id> <groupJid> --json
omni instances group-join <id> <inviteCode> --json
```
