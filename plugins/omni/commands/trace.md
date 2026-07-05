---
description: Trace a message journey through the Omni platform. Use when debugging where a message went, which stage failed, or what is slow.
arguments:
  - name: args
    description: Correlation ID (from omni events list/search) to trace
    required: false
---

# /omni:trace — Message Journey

Use to debug delivery and latency — per-message stage timeline plus aggregated metrics.

## Usage

$ARGUMENTS

## Examples (verified)

```bash
omni journey show <correlationId>
omni journey summary --since 24h
omni events timeline <personId>
```

Correlation IDs come from `omni events list` / `omni events search`. Replay and analytics: omni-ops skill § Events.
