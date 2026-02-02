# WISH: CLI Setup

> LLM-optimized command-line interface for managing Omni instances and sending messages.

**Status:** IN_PROGRESS
**Created:** 2026-01-29
**Updated:** 2026-02-02 (SDK methods for presence, read receipts, contacts, groups, profiles)
**Author:** WISH Agent
**Beads:** omni-v2-clg

---

## Context

The CLI is designed for both humans and LLM agents. Key principles:

1. **Non-interactive** - No prompts, confirmations, or multi-turn flows. Agents must run commands without stdin interaction.
2. **SDK-based** - Uses `@omni/sdk` for all API calls. No direct HTTP.
3. **Structured output** - JSON mode (`--json`) for agent consumption.
4. **Auth storage** - API key stored locally so commands don't need `--api-key` every time.

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | SDK is complete with all wrapper methods |
| **ASM-2** | Assumption | API has auth validation endpoint |
| **DEC-1** | Decision | Use `commander` for CLI framework |
| **DEC-2** | Decision | Output format via config (`omni config set format json`) |
| **DEC-3** | Decision | Colorized human-friendly output by default |
| **DEC-4** | Decision | Config file at `~/.omni/config.json` |
| **DEC-5** | Decision | NO interactive prompts - flags only |
| **DEC-6** | Decision | NO clack/inquirer - pure non-interactive |
| **DEC-7** | Decision | Progressive help at every command level |
| **DEC-8** | Decision | TTY auto-detection for output format |

---

## Scope

### IN SCOPE

- `packages/cli/` package
- Auth command (`omni auth`)
- Instance management commands
- Message sending commands
- Chat commands
- Event query commands
- Settings commands
- Output formats (human, json) via config or TTY auto-detection
- Config file management
- Shell completions

### OUT OF SCOPE

- Interactive mode / REPL
- TUI dashboard
- System bootstrap (`omni install`) - future wish
- Confirmation prompts
- Advanced operations (see Phase 2 below):
  - Automations management
  - Webhook sources
  - Dead letters
  - Event replay
  - Payloads
  - Access rules
  - Providers
  - Logs

---

## Execution Group A: Core CLI + Auth

**Goal:** Basic CLI with config, auth, and instance commands.

**Deliverables:**
- [ ] `packages/cli/package.json`
- [ ] `packages/cli/tsconfig.json`
- [ ] `packages/cli/src/index.ts` - Entry point
- [ ] `packages/cli/src/config.ts` - Config management (`~/.omni/config.json`)
- [ ] `packages/cli/src/output.ts` - Output formatting (human/JSON)
- [ ] `packages/cli/src/commands/auth.ts` - Auth commands
- [ ] `packages/cli/src/commands/config.ts` - Config commands (list, get, set)
- [ ] `packages/cli/src/commands/instances.ts` - Instance commands

**Acceptance Criteria:**
- [ ] `omni --help` shows available commands
- [ ] `omni auth login --api-key sk_... --api-url http://localhost:8881` saves config
- [ ] `omni auth status` shows current auth (validates key via API)
- [ ] `omni auth logout` clears stored key
- [ ] `omni config list` shows all config values
- [ ] `omni config get apiUrl` shows specific value
- [ ] `omni config set format json` updates config
- [ ] `omni config set` (no args) shows available keys
- [ ] `omni instances list` shows instances (human format in TTY)
- [ ] `omni instances list | cat` outputs JSON (auto-detect non-TTY)
- [ ] `omni instances create --name test --channel whatsapp-baileys` works
- [ ] `omni instances status <id>` shows connection status
- [ ] `omni instances qr <id>` shows QR code (ASCII or base64)
- [ ] `omni instances pair <id> --phone +5511999999999` requests pairing code (alternative to QR)
- [ ] `omni instances connect <id>` connects instance
- [ ] `omni instances disconnect <id>` disconnects instance
- [ ] `omni instances restart <id>` restarts instance
- [ ] `omni instances logout <id>` logs out and clears session
- [ ] `omni instances sync <id> --type profile` syncs profile
- [ ] `omni instances sync <id> --type messages` starts message sync
- [ ] `omni instances sync <id> --type contacts` starts contact sync
- [ ] `omni instances sync <id> --type all` starts full sync
- [ ] `omni instances syncs <id>` lists sync jobs
- [ ] `omni instances syncs <id> <job-id>` shows sync job status

**Validation:**
```bash
cd packages/cli && bun run build
./bin/omni --help
./bin/omni auth login --api-key test_key --api-url http://localhost:8881
./bin/omni auth status
./bin/omni config set format json
./bin/omni instances list | head  # Should be JSON
```

---

## Execution Group B: Messages & Chats

**Goal:** Send messages and manage chats.

**Deliverables:**
- [ ] `packages/cli/src/commands/send.ts` - Send commands
- [ ] `packages/cli/src/commands/chats.ts` - Chat commands

**Acceptance Criteria:**

*Send commands (all SDK message types):*
- [ ] `omni send --instance <id> --to <recipient> --text "Hello"` sends text
- [ ] `omni send --instance <id> --to <recipient> --media ./image.jpg` sends media
- [ ] `omni send --instance <id> --to <recipient> --media ./audio.mp3 --voice` sends voice note
- [ ] `omni send --instance <id> --to <recipient> --reaction <emoji> --message <id>` sends reaction
- [ ] `omni send --instance <id> --to <recipient> --sticker <url>` sends sticker
- [ ] `omni send --instance <id> --to <recipient> --contact --name "John" --phone "+1234"` sends contact
- [ ] `omni send --instance <id> --to <recipient> --location --lat 40.7 --lng -74.0` sends location
- [ ] `omni send --instance <id> --to <recipient> --poll "Question?" --options "A,B,C"` sends poll (Discord)
- [ ] `omni send --instance <id> --to <recipient> --embed --title "Title" --description "Desc"` sends embed (Discord)
- [ ] `omni send --instance <id> --to <recipient> --presence typing` shows typing (requires api-completeness)
- [ ] `omni send --instance <id> --to <recipient> --presence recording` shows recording (WhatsApp)

*Chat commands (full CRUD + participants):*
- [ ] `omni chats list --instance <id>` lists chats
- [ ] `omni chats get <id>` shows chat details
- [ ] `omni chats create --instance <id> --external-id <ext>` creates chat record
- [ ] `omni chats update <id> --name "New Name"` updates chat
- [ ] `omni chats delete <id>` deletes chat
- [ ] `omni chats archive <id>` archives chat
- [ ] `omni chats unarchive <id>` unarchives chat
- [ ] `omni chats messages <id> --limit 20` shows messages
- [ ] `omni chats participants <id>` lists participants
- [ ] `omni chats participants <id> --add <user-id>` adds participant
- [ ] `omni chats participants <id> --remove <user-id>` removes participant

**Validation:**
```bash
./bin/omni send --instance test --to +1234567890 --text "Test"
./bin/omni chats list --instance test
./bin/omni chats archive <chat-id>
```

---

## Execution Group C: Events & Persons

**Goal:** Query events and search persons.

**Deliverables:**
- [ ] `packages/cli/src/commands/events.ts` - Event commands
- [ ] `packages/cli/src/commands/persons.ts` - Person commands

**Acceptance Criteria:**
- [ ] `omni events list --instance <id> --limit 10` shows events
- [ ] `omni events search "error" --since 24h` searches events
- [ ] `omni events timeline <person-id>` shows person timeline
- [ ] `omni persons search "john"` finds persons
- [ ] `omni persons get <id>` shows person details
- [ ] `omni persons presence <id>` shows presence info

**Validation:**
```bash
./bin/omni events list --limit 5
./bin/omni persons search "test"
```

---

## Execution Group D: Polish & DX

**Goal:** Shell completions, nice output, error handling.

**Deliverables:**
- [ ] `packages/cli/src/completions.ts` - Shell completions
- [ ] `packages/cli/src/commands/settings.ts` - Settings commands
- [ ] `packages/cli/src/commands/status.ts` - Status/health commands
- [ ] Better error messages with exit codes
- [ ] Spinner for long operations (non-blocking, just visual)
- [ ] Color output (with `--no-color` flag)

**Acceptance Criteria:**
- [ ] `omni completions bash` outputs bash completions
- [ ] `omni completions zsh` outputs zsh completions
- [ ] `omni status` shows API health and connection info
- [ ] `omni settings list` shows all settings
- [ ] `omni settings get <key>` shows setting value
- [ ] `omni settings set <key> <value>` updates setting
- [ ] Errors show clear message and non-zero exit code
- [ ] `--no-color` disables colors for piping
- [ ] TTY auto-detection outputs JSON when piped

**Validation:**
```bash
./bin/omni status
./bin/omni completions bash > /tmp/omni.bash
source /tmp/omni.bash
```

---

## Technical Notes

### Progressive Help Design

Every command level provides contextual guidance:

```bash
$ omni
# Shows: all top-level commands with descriptions

$ omni instances
# Shows: all instance subcommands (list, get, create, etc.)

$ omni instances create
# Shows: required flags, available options, examples

$ omni instances create --channel
# Shows: available channel types (whatsapp-baileys, discord, etc.)
```

**Principles:**
- No dead ends - every incomplete command shows what's missing
- Show available options/values when argument is missing
- Include examples at every level
- Guide users to the right command

### Output Format

Format is determined by (in order of precedence):
1. `OMNI_FORMAT` environment variable
2. Config file (`~/.omni/config.json` → `format` key)
3. TTY auto-detection (terminal → human, piped → json)

```bash
# Set format in config (persists)
omni config set format json

# Or via environment (per-session/script)
export OMNI_FORMAT=json

# Or rely on TTY detection (default)
omni instances list        # human output in terminal
omni instances list | jq . # json output when piped
```

### Command Structure

```
omni
├── auth
│   ├── login --api-key <key> [--api-url <url>]
│   ├── status
│   └── logout
├── config
│   ├── list
│   ├── get <key>
│   └── set <key> [<value>]   # Shows available values if <value> omitted
├── instances
│   ├── list [--channel <type>] [--status <status>]
│   ├── get <id>
│   ├── create --name <name> --channel <type>
│   ├── delete <id>
│   ├── status <id>
│   ├── qr <id>
│   ├── pair <id> --phone <number>
│   ├── connect <id> [--force-new-qr] [--token <discord-token>]
│   ├── disconnect <id>
│   ├── restart <id>
│   ├── logout <id>
│   ├── sync <id> --type <profile|messages|contacts|groups|all>
│   └── syncs <id> [<job-id>]
├── send
│   ├── --instance <id> --to <recipient> --text <text>
│   ├── --instance <id> --to <recipient> --media <path> [--caption <text>] [--voice]
│   ├── --instance <id> --to <recipient> --reaction <emoji> --message <id>
│   ├── --instance <id> --to <recipient> --sticker <url|base64>
│   ├── --instance <id> --to <recipient> --contact --name <n> --phone <p>
│   ├── --instance <id> --to <recipient> --location --lat <lat> --lng <lng>
│   ├── --instance <id> --to <recipient> --poll <question> --options <a,b,c>
│   ├── --instance <id> --to <recipient> --embed --title <t> --description <d>
│   └── --instance <id> --to <recipient> --presence <typing|recording|paused>
├── chats
│   ├── list [--instance <id>] [--archived]
│   ├── get <id>
│   ├── create --instance <id> --external-id <ext>
│   ├── update <id> [--name <n>] [--description <d>]
│   ├── delete <id>
│   ├── archive <id>
│   ├── unarchive <id>
│   ├── messages <id> [--limit <n>] [--before <cursor>]
│   └── participants <id> [--add <user>] [--remove <user>]
├── events
│   ├── list [--instance <id>] [--since <time>] [--limit <n>]
│   ├── get <id>
│   ├── search <query> [--since <time>]
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

### Config File

```json
// ~/.omni/config.json
{
  "apiUrl": "http://localhost:8881",
  "apiKey": "omni_sk_...",
  "defaultInstance": "my-whatsapp",
  "format": "human"  // human | json
}
```

### Output Modes

```typescript
// Determine format: ENV > Config > TTY detection
const format = process.env.OMNI_FORMAT
  ?? config.format
  ?? (process.stdout.isTTY ? 'human' : 'json');

// Human output (terminal default)
if (format === 'human') {
  console.log(chalk.green('✓'), 'Message sent');
  console.log(chalk.dim('ID:'), result.messageId);
}

// JSON output (piped/scripted default)
if (format === 'json') {
  console.log(JSON.stringify({ success: true, data: result }, null, 2));
}
```

### Error Handling

```typescript
// Always exit with proper codes
process.exit(0);  // Success
process.exit(1);  // General error
process.exit(2);  // Auth error
process.exit(3);  // Not found
```

### Non-Interactive Principle

```typescript
// WRONG - requires stdin
const answer = await inquirer.prompt([...]);

// RIGHT - use flags
if (!options.force) {
  console.error('Use --force to confirm deletion');
  process.exit(1);
}
```

---

## Dependencies

- `commander` - CLI framework
- `chalk` - Colors
- `ora` - Spinner (non-blocking)
- `@omni/sdk` - API client

---

## Depends On

- `sdk-expansion` - SDK must have all wrapper methods ✅
- `api-completeness` - For presence/typing commands (Group A)

## Enables

- Human CLI management
- LLM agent integration (non-interactive)
- Scripting and automation
- `omni-skill` - AI assistant skill that wraps the CLI

---

## Phase 2 (Future Wish)

The following SDK features are **out of scope** for this wish and will be covered in `cli-advanced`:

- `omni automations` - Automation CRUD, enable/disable, test, logs
- `omni webhooks` - Webhook sources CRUD, trigger events
- `omni dead-letters` - List, stats, retry, resolve, abandon
- `omni event-ops` - Metrics, replay sessions
- `omni payloads` - Event payload inspection
- `omni access` - Access rules CRUD
- `omni providers` - Agent provider listing
- `omni logs` - Recent logs viewing
