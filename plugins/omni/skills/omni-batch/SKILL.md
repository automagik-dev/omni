---
name: omni-batch
description: |
  Run and monitor Omni batch jobs for media/content processing, with cost estimation and cancellation controls.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Batch

## Estimate first

```bash
omni batch estimate --instance <id> --type time_based_batch --days 7 --content-types audio,image --json
omni batch estimate --instance <id> --type targeted_chat_sync --chat <chatId> --limit 200 --json
```

## Create jobs

```bash
# Time-window job
omni batch create --instance <id> --type time_based_batch --days 30 --content-types audio,video --limit 500 --json

# Chat-targeted job
omni batch create --instance <id> --type targeted_chat_sync --chat <chatId> --limit 200 --json

# Media redownload
omni batch create --instance <id> --type media_redownload --days 14 --content-types image,document --force --json
```

## Monitor and control

```bash
omni batch list --instance <id> --status running,failed --limit 50 --json
omni batch status <jobId> --json
omni batch status <jobId> --watch --interval 2000 --json
omni batch cancel <jobId> --json
```

## Notes

- Valid job types: `targeted_chat_sync`, `time_based_batch`, `media_redownload`.
- Use `--no-confirm` in non-interactive scripts.
