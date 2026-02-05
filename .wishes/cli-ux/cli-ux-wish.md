# WISH: CLI UX Improvements

> Improve CLI help text with examples, grouped options, inline status, and command context.

**Status:** REVIEW
**Created:** 2026-02-05
**Author:** WISH Agent
**Beads:** omni-ndl

---

## Context

The CLI (`packages/cli/`) is functional with 18 commands and 100% SDK coverage, but the help output has UX issues:

1. **No examples** - Just option lists with no usage context
2. **No quick start** - New users don't know where to begin
3. **`send` is overwhelming** - 25+ options shown flat, ungrouped
4. **No current state** - No indication of default instance or connection status
5. **Commands lack context** - No guidance on when to use each command

This wish improves the **help text only** - no command behavior changes.

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | API latency for status call is acceptable (~50-100ms) |
| **ASM-2** | Assumption | Users will benefit from inline examples in help |
| **DEC-1** | Decision | Option A: Group `send` help by message type (no subcommands) |
| **DEC-2** | Decision | Show live status in root help (requires API call) |
| **DEC-3** | Decision | Quick Start shown in root help (configurable later) |
| **DEC-4** | Decision | Use Commander.js built-in help customization |
| **DEC-5** | Decision | No interactive prompts (maintains LLM compatibility) |

---

## Scope

### IN SCOPE

- Root help overhaul (`omni --help`)
  - Quick Start section with common examples
  - Inline status display (instance, connection)
  - Grouped command categories with descriptions
  - Config summary footer
  - Examples section
- `send` command help grouping by message type
- Better command descriptions with context
- Helper utilities for help text formatting

### OUT OF SCOPE

- Subcommand restructuring (`omni send text` etc.) - future wish
- Interactive prompts
- Command behavior changes
- API performance improvements - future wish
- New commands

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| cli | src/index.ts, src/commands/send.ts, new src/help.ts | Help text formatting |

### System Checklist

- [ ] **Events**: No changes
- [ ] **Database**: No changes
- [ ] **SDK**: No changes
- [ ] **CLI**: Help text only
- [ ] **Tests**: Update snapshot tests if any

---

## Desired Output

### Root Help (`omni --help`)

```
Usage: omni [options] [command]

CLI for Omni v2 - Universal Omnichannel Platform

Quick Start:
  omni send --to +5511999999999 --text "Hello"
  omni chats list
  omni events list --limit 10

Status: connected (cezar-personal)

Commands:
  Core:
    send            Send message (text, media, location, poll)
    chats           List and manage conversations
    messages        Message actions (read receipts)

  Management:
    instances       Channel connections (WhatsApp, Discord)
    persons         Contact directory
    automations     Event-driven workflows

  System:
    status          API health and connection info
    config          CLI settings (default instance, format)
    events          Query message history

Config: instance=cezar-personal, format=human

Examples:
  omni send --to +55119999 --text "Hi"              # Send text
  omni send --to +55119999 --media ./pic.jpg        # Send image
  omni chats messages <chat-id>                     # Read conversation
  omni persons search "Felipe"                      # Find contact

Hidden: 3 advanced, 4 debug commands
  Use --all to show all commands
```

### Send Command Help (`omni send --help`)

```
Usage: omni send [options]

Send a message to a recipient

Options:
  --instance <id>       Instance ID (default: cezar-personal)
  --to <recipient>      Recipient (phone, chat ID, or channel ID)

  Text Message:
    --text <text>       Message content
    --reply-to <id>     Reply to specific message

  Media Message:
    --media <path>      Image, video, audio, or document
    --caption <text>    Caption for media
    --voice             Send audio as voice note

  Reaction:
    --reaction <emoji>  React to a message
    --message <id>      Message ID to react to

  Sticker:
    --sticker <url>     Sticker URL or base64

  Contact Card:
    --contact           Send contact
    --name <name>       Contact name (required)
    --phone <phone>     Contact phone
    --email <email>     Contact email

  Location:
    --location          Send location
    --lat <latitude>    Latitude (required)
    --lng <longitude>   Longitude (required)
    --address <text>    Location address

  Poll (Discord):
    --poll <question>   Create poll
    --options <a,b,c>   Poll choices (comma-separated)
    --multi-select      Allow multiple selections
    --duration <hours>  Poll duration

  Embed (Discord):
    --embed             Send embed message
    --title <title>     Embed title
    --description <d>   Embed description
    --color <hex>       Embed color
    --url <url>         Embed URL

  Presence:
    --presence <type>   Send typing/recording/paused indicator

Examples:
  omni send --to +5511999 --text "Hello!"
  omni send --to +5511999 --media ./photo.jpg --caption "Check this"
  omni send --to +5511999 --reaction "👍" --message msg_abc123
  omni send --to +5511999 --poll "Lunch?" --options "Pizza,Sushi,Tacos"
```

---

## Execution Group A: Help Infrastructure

**Goal:** Create reusable help formatting utilities.

**Packages:** cli

**Deliverables:**
- [ ] `packages/cli/src/help.ts` - Help formatting utilities
  - `formatSection(title: string, content: string)` - Indented section
  - `formatOptionGroup(title: string, options: OptionDef[])` - Grouped options
  - `formatExamples(examples: Example[])` - Example formatting
  - `formatKeyValue(pairs: Record<string, string>)` - Config display
- [ ] `packages/cli/src/status.ts` - Status fetching for help
  - `getInlineStatus(): Promise<string>` - "connected (instance-name)" or "not configured"

**Acceptance Criteria:**
- [ ] Helper functions are well-typed with TypeScript
- [ ] Helpers respect `--no-color` flag
- [ ] Status fetching handles API errors gracefully (shows "unknown" not crash)
- [ ] Status fetching respects timeout (max 2s)

**Validation:**
```bash
make typecheck
bun test packages/cli
```

---

## Execution Group B: Root Help Overhaul

**Goal:** Transform root help output to match desired design.

**Packages:** cli

**Deliverables:**
- [ ] Update `packages/cli/src/index.ts`
  - Add Quick Start section before commands
  - Add inline status after Quick Start
  - Group commands by purpose (Core, Management, System)
  - Add Config summary footer
  - Add Examples section
  - Keep hidden command hint

**Acceptance Criteria:**
- [ ] `omni --help` shows Quick Start section with 3 examples
- [ ] `omni --help` shows live status (or graceful fallback)
- [ ] `omni --help` groups commands by purpose
- [ ] `omni --help` shows current config summary
- [ ] `omni --help` shows Examples section
- [ ] `omni --help` still shows hidden command count
- [ ] `omni --all --help` shows all commands
- [ ] Help works when not authenticated (status shows "not configured")
- [ ] Non-TTY output remains clean (no ANSI codes when piped)

**Validation:**
```bash
omni --help
omni --help | cat  # Verify no ANSI codes
omni --all --help
# Without auth:
omni config unset apiKey && omni --help  # Should show "not configured"
```

---

## Execution Group C: Send Command Help

**Goal:** Group send options by message type.

**Packages:** cli

**Deliverables:**
- [ ] Update `packages/cli/src/commands/send.ts`
  - Override default help with grouped options
  - Add examples section
  - Show default instance in help text

**Acceptance Criteria:**
- [ ] `omni send --help` shows options grouped by message type
- [ ] Groups: Text, Media, Reaction, Sticker, Contact, Location, Poll, Embed, Presence
- [ ] Each group has its related options together
- [ ] Shows examples at bottom
- [ ] Default instance shown in `--instance` option description
- [ ] Help works with and without default instance configured

**Validation:**
```bash
omni send --help
# Verify options are grouped, not flat list
# Verify examples are shown
```

---

## Technical Notes

### Commander.js Help Customization

Commander.js supports several help customization methods:

```typescript
// Add text before/after help
program.addHelpText('before', 'Quick Start:...');
program.addHelpText('after', 'Examples:...');

// Custom help display
program.helpInformation = function() {
  return customHelpString;
};

// Configure help options
program.configureHelp({
  sortSubcommands: true,
  subcommandTerm: (cmd) => cmd.name(),
});
```

### Status Display Implementation

```typescript
// src/status.ts
export async function getInlineStatus(): Promise<string> {
  try {
    const config = loadConfig();
    if (!config.apiKey) {
      return chalk.dim('not configured');
    }

    const client = getOptionalClient();
    if (!client) {
      return chalk.dim('not configured');
    }

    // Timeout after 2s to not block help
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    try {
      const status = await client.status.get();
      clearTimeout(timeout);

      const instance = config.defaultInstance || 'none';
      const connected = status.database && status.nats;

      return connected
        ? chalk.green(`connected (${instance})`)
        : chalk.yellow(`disconnected (${instance})`);
    } catch {
      clearTimeout(timeout);
      return chalk.dim('unknown');
    }
  } catch {
    return chalk.dim('not configured');
  }
}
```

### Grouped Options for Send

Options are grouped manually since Commander doesn't support native option groups:

```typescript
// Override help output
send.configureHelp({
  formatHelp: (cmd, helper) => {
    // Build custom help string with groups
    return buildGroupedSendHelp(cmd, helper);
  },
});
```

### Color Handling

All help output must respect `--no-color`:

```typescript
import { isColorEnabled } from '../output.js';

function formatSection(title: string, content: string): string {
  if (isColorEnabled()) {
    return `${chalk.bold(title)}:\n${indent(content)}`;
  }
  return `${title}:\n${indent(content)}`;
}
```

---

## Dependencies

- None (CLI already exists)

## Enables

- Better CLI onboarding experience
- Reduced learning curve for new users
- Improved discoverability of commands

---

## Testing Strategy

1. **Manual testing** - Run help commands and verify output
2. **Snapshot tests** - Capture expected help output (optional)
3. **Edge cases**:
   - No auth configured
   - API unreachable
   - `--no-color` flag
   - Non-TTY output (piped)
   - `--all` flag
