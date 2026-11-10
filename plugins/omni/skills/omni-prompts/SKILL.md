---
name: omni-prompts
description: "Inspect and manage LLM prompts for reply gates, media descriptions, image generation and TTS."
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Prompts

## When to Use

Inspect or change a platform prompt used for gates, descriptions, image generation or voice.

## Flow

1. Read [ground rules](../omni-ops/references/ground-rules.md) and [prompt operations](../omni-ops/references/prompts.md).
2. Read `omni --help`, then `omni prompts --help` and the relevant action's help before using a reference example; inspect the current prompt before editing.
3. Apply the authorized change and read it back; use only authorized tests for generated content or sends.

## Rules

- Preserve the requested prompt's scope and report the saved value separately from observed runtime behavior.
