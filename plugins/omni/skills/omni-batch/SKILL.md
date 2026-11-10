---
name: omni-batch
description: "Estimate and run authorized bulk media transcription, extraction, redownload and history processing jobs."
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Batch

## When to Use

Backfill transcriptions/descriptions, extract historical media, or redownload media across many messages.

## Flow

1. Read [ground rules](../omni-ops/references/ground-rules.md) and [batch operations](../omni-ops/references/batch.md).
2. Discover current options with `omni batch --help`, `omni batch estimate --help` and `omni batch create --help`.
3. Estimate scope and cost before creating a job. With authorization, create it, monitor status and report processed items/errors.

## Rules

- Jobs consume provider credits. `--no-confirm` skips a prompt; it is not a dry run or permission to spend.
- Use `omni media --help` for ad hoc media operations; preserve the requested instance/chat and processing scope.
