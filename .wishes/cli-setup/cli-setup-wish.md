# WISH: CLI Setup

> LLM-optimized command-line interface for managing Omni instances and sending messages.

**Status:** DRAFT
**Created:** 2026-01-29
**Author:** WISH Agent
**Beads:** omni-v2-clg

---

## Context

The CLI is designed for both humans and LLM agents. Output is structured, parseable, and includes clear success/error indicators. Built on top of the generated SDK.

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | SDK is generated and working |
| **ASM-2** | Assumption | API is running |
| **DEC-1** | Decision | Use `commander` for CLI framework |
| **DEC-2** | Decision | JSON output mode for LLM consumption |
| **DEC-3** | Decision | Colorized human-friendly output by default |
| **DEC-4** | Decision | Config file at `~/.omni/config.json` |

---

## Scope

### IN SCOPE

- `packages/cli/` package
- Instance management commands
- Message sending commands
- Event query commands
- Settings commands
- JSON output mode (`--json`)
- Config file management
- Shell completions

### OUT OF SCOPE

- Interactive mode / REPL (future)
- TUI dashboard (future)

---

## Execution Group A: Core CLI

**Goal:** Basic CLI with config and instance commands.

**Deliverables:**
- [ ] `packages/cli/package.json`
- [ ] `packages/cli/tsconfig.json`
- [ ] `packages/cli/src/index.ts` - Entry point
- [ ] `packages/cli/src/config.ts` - Config management
- [ ] `packages/cli/src/output.ts` - Output formatting
- [ ] `packages/cli/src/commands/instances.ts` - Instance commands

**Acceptance Criteria:**
- [ ] `omni --help` shows available commands
- [ ] `omni config set api-url http://localhost:8881` saves config
- [ ] `omni instances list` shows instances
- [ ] `omni instances list --json` outputs JSON
- [ ] `omni instances create --name test --channel whatsapp-baileys` works

**Validation:**
```bash
cd packages/cli && bun run build
./bin/omni --help
./bin/omni instances list --json
```

---

## Execution Group B: Message & Event Commands

**Goal:** Send messages and query events.

**Deliverables:**
- [ ] `packages/cli/src/commands/messages.ts` - Message commands
- [ ] `packages/cli/src/commands/events.ts` - Event commands
- [ ] `packages/cli/src/commands/persons.ts` - Person commands

**Acceptance Criteria:**
- [ ] `omni send --instance my-whatsapp --to +1234567890 --text "Hello"` sends message
- [ ] `omni send --instance my-whatsapp --to +1234567890 --media ./image.jpg` sends media
- [ ] `omni events list --instance my-whatsapp --limit 10` shows events
- [ ] `omni events search "error" --since 24h` searches events
- [ ] `omni persons search "john"` finds persons

**Validation:**
```bash
./bin/omni send --instance test --to +1234567890 --text "Test" --json
./bin/omni events list --limit 5 --json
```

---

## Execution Group C: Polish & DX

**Goal:** Shell completions, nice output, error handling.

**Deliverables:**
- [ ] `packages/cli/src/completions.ts` - Shell completions
- [ ] `packages/cli/src/commands/settings.ts` - Settings commands
- [ ] `packages/cli/src/commands/status.ts` - Status/health commands
- [ ] Better error messages
- [ ] Spinner for long operations
- [ ] Color output (with `--no-color` flag)

**Acceptance Criteria:**
- [ ] `omni completions bash` outputs bash completions
- [ ] `omni status` shows API health
- [ ] Errors show clear message and exit code
- [ ] Long operations show progress spinner
- [ ] `--no-color` disables colors for piping

**Validation:**
```bash
./bin/omni status
./bin/omni completions bash > /tmp/omni-completions.bash
source /tmp/omni-completions.bash
omni <TAB>  # Should show completions
```

---

## Technical Notes

### Command Structure

```
omni
├── config
│   ├── set <key> <value>
│   ├── get <key>
│   └── list
├── instances
│   ├── list [--channel <type>] [--status <status>]
│   ├── get <id>
│   ├── create --name <name> --channel <type>
│   ├── delete <id>
│   ├── status <id>
│   ├── qr <id>
│   ├── connect <id>
│   └── restart <id>
├── send
│   ├── --instance <id> --to <recipient> --text <text>
│   ├── --instance <id> --to <recipient> --media <path>
│   └── --instance <id> --to <recipient> --reaction <emoji> --message <id>
├── events
│   ├── list [--instance <id>] [--since <time>] [--limit <n>]
│   ├── get <id>
│   ├── search <query>
│   └── timeline <person-id>
├── persons
│   ├── search <query>
│   ├── get <id>
│   └── presence <id>
├── settings
│   ├── list
│   ├── get <key>
│   └── set <key> <value>
├── status
└── completions [bash|zsh|fish]
```

### Output Format

```typescript
// Human output
console.log(chalk.green('✓'), 'Message sent');
console.log(chalk.dim('ID:'), result.messageId);

// JSON output (--json flag)
console.log(JSON.stringify({
  success: true,
  data: result,
}, null, 2));
```

### Config File

```json
// ~/.omni/config.json
{
  "apiUrl": "http://localhost:8881",
  "apiKey": "omni_sk_...",
  "defaultInstance": "my-whatsapp",
  "outputFormat": "human"  // or "json"
}
```

### LLM-Friendly Output

```bash
$ omni instances list --json
{
  "success": true,
  "data": {
    "items": [
      { "id": "abc123", "name": "my-whatsapp", "status": "active" }
    ],
    "meta": { "total": 1 }
  }
}

$ omni send --instance abc123 --to +1234567890 --text "Hello" --json
{
  "success": true,
  "data": {
    "messageId": "msg-123",
    "status": "sent"
  }
}
```

---

## Dependencies

- `commander`
- `chalk`
- `ora` (spinner)
- `@omni/sdk`

---

## Depends On

- `sdk-generation`

## Enables

- Human CLI management
- LLM agent integration
- Scripting and automation
