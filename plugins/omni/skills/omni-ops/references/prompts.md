# Prompts — LLM Prompt Overrides

Server-side prompt templates for media description, reply gating, and TTS. Prompt names: `audio`, `image`, `video`, `document`, `gate`, `tts-openai`, `tts-gemini`.

## Commands

```bash
omni prompts list --json                # every prompt with override status
omni prompts get gate --json
omni prompts set image "Describe this image in detail, including any visible text." --reason "More detail" --json
omni prompts set document < /path/to/prompt.txt     # no value = read stdin (multiline)
omni prompts reset image --json         # revert to code default
```

## Patterns

```bash
# Which prompts are overridden?
omni prompts list --json | jq '.[] | select(.customized == true) | {name, updatedAt}'

# View the active gate prompt
omni prompts get gate --json | jq '.prompt'
```
