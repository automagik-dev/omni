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

Use `omni prompts --help` / `omni prompts set --help` for installed options. Read the current prompt before replacing or resetting it; `set` and `reset` affect future processing and aren't dry runs. Voice generation/discovery lives under `omni speak --help`, `omni tts --help` and `omni voice --help`.
