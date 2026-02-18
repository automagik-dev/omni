---
name: omni-batch
description: |
  Run batch media processing jobs in Omni — transcribe audio, extract text from images/videos/documents, monitor job status, estimate costs, and cancel running jobs.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Batch

Batch media processing operations using `omni batch`.

## Create Batch Job

### Transcription

```bash
omni batch create --instance <id> --type transcribe \
  --chat <chat-id> --days 30 --limit 100
```

### Text Extraction

```bash
omni batch create --instance <id> --type extract-text \
  --content-types audio,image,video --days 7

omni batch create --instance <id> --type extract-text \
  --content-types document --chat <chat-id>
```

Content types: `audio`, `image`, `video`, `document`

## Cost Estimation

```bash
omni batch estimate --instance <id> --type transcribe --days 7
```

Returns estimated item count, cost, and processing time.

## Monitor Jobs

```bash
# Get job status
omni batch status <job-id>

# Auto-refresh status
omni batch status <job-id> --watch --interval 2000

# List all jobs
omni batch list

# Cancel running job
omni batch cancel <job-id>
```

## JSON Output

```bash
omni batch list --json | jq '.[] | {id, type, status, progress}'
omni batch status <job-id> --json
```

## Tips

- Always run `estimate` before creating large batch jobs.
- Use `--watch` to monitor long-running transcription jobs.
- Combine `--chat` with `--days` to scope jobs to specific conversations.
