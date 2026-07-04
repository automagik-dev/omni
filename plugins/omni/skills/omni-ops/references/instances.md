# Instances & Access

One instance = one connected channel account (WhatsApp, Telegram, Discord, ...). Add `--json` to any command you parse.

## Lifecycle

```bash
omni instances list --json
omni instances list --channel whatsapp-baileys --status connected --json
omni instances get <id> --json
omni instances create --name "Ops WA" --channel whatsapp-baileys --json
omni instances delete <id> --json        # irreversible — confirm with the user first
```

## Connection

```bash
omni instances status <id> --json
omni instances connect <id> --json
omni instances disconnect <id> --json
omni instances restart <id> --force-new-qr --json
omni instances logout <id>               # wipes session data — re-pairing required
```

## WhatsApp pairing

Pairing code is preferred over QR:

```bash
omni instances pair <id> --phone +5511999999999 --json   # user enters code: WhatsApp > Linked Devices > Link with phone number
omni instances qr <id> --json                            # QR fallback (~60s lifetime)
omni instances whoami <id> --json                        # connected phone number + identity
omni instances check <id> +5511999 --json                # is this number on WhatsApp?
```

## Sync and backfill

```bash
omni instances sync <id> --type messages --depth 30d --download-media --json
#   --type: profile|messages|contacts|groups|all   --depth: 7d|30d|90d|1y|all
omni instances syncs <id> --limit 20 --status <status> --json   # list sync jobs; append <jobId> for one job
omni resync --instance <id> --since 2h --json   # trigger history backfill
omni resync --all --since 1h --dry-run --json
```

## Contacts, groups, profile

```bash
omni instances contacts <id> --limit 100 --search "Name" --json
omni instances groups <id> --search "team" --json
omni instances group-members <id> <groupJid>
omni instances profile <id> <userId>
```

More channel-side ops in `omni instances --help`: `update-bio`, `update-picture`/`remove-picture`, `block`/`unblock`/`blocklist`, `privacy`, `reject-call`, plus WhatsApp group management (`group-create`, `group-invite`, `group-revoke-invite`, `group-join`, `group-update-picture`).

## Instance config (debounce, ack, sessions, reply filter)

```bash
omni instances update <id> --reaction-ack on --json                            # on|off
omni instances update <id> --debounce-mode fixed --debounce-min 3000 --json    # disabled|fixed|randomized|presence
omni instances update <id> --agent-session-strategy per_user_per_chat --json   # per_user|per_chat|per_user_per_chat
omni instances update <id> --reply-filter-mode filtered --reply-on-dm --json
omni instances update <id> --agent-fk-id <agent-uuid> --json                   # "null" clears
```

Assigning an agent to an instance with no reply filter auto-defaults the filter to `{mode:"all", onDm:true}` so messages dispatch instead of silently dropping (omni#443). Full agent-connect flow lives in the omni-setup skill.

## Access control

```bash
omni access list --instance <id> --json
omni access create --type allow --instance <id> --phone "+5511*" --reason "VIP" --json   # --phone supports * wildcard
omni access create --type deny --instance <id> --phone +5511888 --action silent_block --reason "spam" --json
omni access mode <instanceId> --json           # show mode; pass a mode value to set it
omni access check --instance <id> --user <platformUserId> --json
omni access pending <instanceId> --json        # pairing requests awaiting review
omni access approve <instanceId> <requestId> --json
omni access deny <instanceId> <requestId> --json
```
