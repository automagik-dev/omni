---
name: omni-prompts
description: |
  View and override LLM prompt templates used for media description (image/video/document) and gating decisions.
allowed-tools: Bash(omni prompts *), Bash(jq *)
---

# Omni Prompts

## List prompts

```bash
omni prompts list --json
```

## Get prompt

```bash
omni prompts get image --json
omni prompts get video --json
omni prompts get document --json
omni prompts get gate --json
```

## Set custom prompt

```bash
# Set inline
omni prompts set image "Describe this image in detail, including any text visible." --reason "More detail needed" --json

# Set from a file using stdin (for multiline prompts)
omni prompts set document < /path/to/prompt.txt --json

# Set gate prompt
omni prompts set gate "Reply YES if the message is a support request, NO otherwise." --json
```

## Reset to default

```bash
omni prompts reset image --json
omni prompts reset video --json
omni prompts reset document --json
omni prompts reset gate --json
```

## Notes

- Prompts control how Omni describes media attachments to LLMs and how gate decisions are made.
- Valid prompt names are: `image`, `video`, `document`, `gate`.
- `reset` clears the override and reverts to the built-in code default.
- `set` reads from stdin if no inline value is provided, enabling multiline prompt editing.
- `--reason` documents why the prompt was changed (stored for audit purposes).
