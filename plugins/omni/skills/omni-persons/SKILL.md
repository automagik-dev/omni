---
name: omni-persons
description: |
  Search and inspect contacts in the Omni person directory: search by name/phone, get full profile, and check online presence.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Persons

## Search

```bash
omni persons search "Felipe" --json
omni persons search "+5511999" --limit 5 --json
omni persons search "partial name" --limit 50 --json
```

## Get details

```bash
omni persons get <personId> --json
```

## Presence check

```bash
omni persons presence <personId> --json
```

## Notes

- Persons are auto-created from incoming messages; no manual creation needed.
- Search supports partial name and phone number matches.
- `--limit` defaults to 20; increase for broader results.
- Presence returns online status and last activity info for the person.
