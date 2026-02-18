# Replay Patterns Reference

## Start Replay

```bash
# Replay events from the last 7 days
omni events replay --start --since 7d

# Replay with time boundaries
omni events replay --start --since 7d --until 1d

# Replay at 2x speed
omni events replay --start --since 24h --speed 2.0

# Filter by event types
omni events replay --start --since 7d --types message.received
```

## Monitor Progress

```bash
# Check replay status
omni events replay --status <session-id>

# JSON output for scripting
omni events replay --status <session-id> --json | jq '{state, progress, eventsProcessed}'
```

## Cancel

```bash
omni events replay --cancel <session-id>
```

## Dry Run

Preview what would be replayed without executing:

```bash
omni events replay --start --since 7d --dry-run
```

Output shows:
- Total events that would be replayed
- Event type breakdown
- Estimated duration at given speed

## Pitfalls

### Duplicate Processing

Replayed events go through the full pipeline. If automations are enabled,
they will trigger again. Disable automations before replay if you don't want
duplicate actions:

```bash
omni automations disable <id>
omni events replay --start --since 7d
omni automations enable <id>
```

### Speed vs Accuracy

- `--speed 1.0` — real-time pacing (most accurate)
- `--speed 2.0` — double speed (good for testing)
- No speed flag — events fire as fast as possible (may overwhelm consumers)

### Time Window Too Large

Replaying months of events can take hours. Start with `--dry-run` to check volume:

```bash
omni events replay --start --since 90d --dry-run
# If too many events, narrow the window
omni events replay --start --since 7d --types message.received
```

### Session Cleanup

Old replay sessions don't auto-delete. Cancel stuck sessions:

```bash
omni events replay --cancel <session-id>
```
