# Batch — Media Processing Jobs

Bulk transcription, text extraction, and media redownload. Job types: `time_based_batch` (last N days), `targeted_chat_sync` (one chat), `media_redownload`. Estimate before creating — jobs consume provider credits.

## Commands

```bash
# 1. Estimate scope and cost (creates nothing)
omni batch estimate --instance <id> --type time_based_batch --days 7 --content-types audio,image --json
omni batch estimate --instance <id> --type targeted_chat_sync --chat <chatId> --limit 200 --json

# 2. Create
omni batch create --instance <id> --type time_based_batch --days 30 --content-types audio,video --limit 500 --json
omni batch create --instance <id> --type targeted_chat_sync --chat <chatId> --limit 200 --json
omni batch create --instance <id> --type media_redownload --days 14 --content-types image,document --force --json

# 3. Monitor and control
omni batch list --instance <id> --status running,failed --json
omni batch status <jobId> --watch --interval 2000
omni batch cancel <jobId> --json
```

Content types: `audio,image,video,document`. `--force` re-processes items that already have content. Pace with `--delay-min`/`--delay-max` (ms); `--no-confirm` skips the prompt.

## Pattern — estimate, create, watch

```bash
omni batch estimate --instance <id> --type time_based_batch --days 7 --content-types audio --json | jq '{items: .estimatedItems, cost: .estimatedCost}'
omni batch create --instance <id> --type time_based_batch --days 7 --content-types audio --json
omni batch status <jobId> --json | jq '{status, done: .processedItems, total: .totalItems, errors: .errorCount}'
```
