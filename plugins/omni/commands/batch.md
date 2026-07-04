---
description: Bulk media processing over chat history — transcription, extraction, redownload. Use when the user wants old audio/images/documents processed at scale.
arguments:
  - name: args
    description: Batch operation (e.g., create --type time_based_batch --instance <id> --days 30)
    required: false
---

# /omni:batch — Batch Processing

Use for backfilling transcriptions and descriptions across many messages. Always estimate cost before creating. Job types: `targeted_chat_sync`, `time_based_batch`, `media_redownload`.

## Usage

$ARGUMENTS

## Examples (verified)

```bash
omni batch estimate --instance <id> --type time_based_batch --days 7 --content-types audio --json
omni batch create --instance <id> --type targeted_chat_sync --chat <chatId> --limit 200 --json
omni batch status <jobId> --watch --interval 2000
```

Estimate-then-create pattern, content types, list/cancel: omni-ops skill § Batch.
