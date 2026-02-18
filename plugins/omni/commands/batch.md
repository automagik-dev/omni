---
description: Batch processing orchestrator for transcription and text extraction
arguments:
  - name: args
    description: Batch operation (e.g., create --type transcribe --instance <id> --days 30)
    required: false
---

# /omni:batch — Batch Processing

Orchestrate batch media processing jobs — transcription, text extraction, status monitoring, and cost estimation.

## Usage

$ARGUMENTS

## Examples

```bash
omni batch estimate --instance my-wa --type transcribe --days 7
omni batch create --instance my-wa --type transcribe --chat <chat-id> --days 30 --limit 100
omni batch status <job-id> --watch --interval 2000
omni batch cancel <job-id>
```
