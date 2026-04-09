---
slug: sdk-compliance-test-suite
title: "Create SDK compliance test suite (parameterized per channel)"
status: ready
github_issue: 82
priority: P1
---

## Problem

No contract tests exist to verify that channel plugins comply with the SDK. When the SDK adds a utility or changes a pattern, channels silently drift. The February 2026 compliance audit found 14 inconsistencies across 4 channels -- all preventable with automated compliance checks.

Each channel plugin (WhatsApp, Telegram, Discord, Slack) independently extends `BaseChannelPlugin`, imports SDK utilities, and wraps errors in channel-specific `ChannelError` subclasses. Without a parameterized test suite that programmatically inspects every plugin against the same contract, regressions go undetected until production.

## Architecture Summary

**SDK contract surface** (from `packages/channel-sdk/`):
- `BaseChannelPlugin` abstract class (`src/base/BaseChannelPlugin.ts`) -- requires `id`, `name`, `version`, `capabilities`, `connect()`, `disconnect()`, `sendMessage()`
- `ChannelCapabilities` interface (`src/types/capabilities.ts`) -- 30+ boolean/numeric fields
- `StreamSender` interface (`src/types/streaming.ts`) -- `onThinkingDelta`, `onContentDelta`, `onFinal`, `onError`, `abort`
- `FetchHistoryOptions` / `FetchHistoryResult` types (`src/history.ts`)
- Reliability utilities: `createInboundDedupeCache`, `createDownloadGuard`, `sanitizeMessage`
- Error base: `ChannelError` from `@omni/core/errors` -- all channel errors must extend this

**Channel plugins** (5 total, 4 in scope for issue #82):
| Channel   | Plugin class         | Error class      | Extends ChannelError | Dedupe | DownloadGuard | sanitizeMessage | StreamSender | fetchHistory | T10/T11 |
|-----------|----------------------|------------------|----------------------|--------|---------------|-----------------|--------------|--------------|---------|
| WhatsApp  | `WhatsAppPlugin`     | `WhatsAppError`  | Yes                  | Yes    | Yes           | Yes             | Yes          | Yes          | Yes     |
| Telegram  | `TelegramPlugin`     | `TelegramError`  | Yes                  | Yes    | Yes           | (handler)       | Yes          | Yes (stub)   | Yes     |
| Discord   | `DiscordPlugin`      | `DiscordError`   | Yes                  | Yes    | Yes           | Yes             | Yes          | Yes          | Yes     |
| Slack     | `SlackPlugin`        | `SlackError`     | Yes                  | Yes    | Yes (2x)      | Yes             | Yes          | Yes          | Yes     |

## Acceptance Criteria

- [ ] Test suite lives at `packages/channel-sdk/src/__tests__/compliance.test.ts`
- [ ] Parameterized across all 4 channel packages (telegram, discord, whatsapp, slack)
- [ ] Validates required contract (extends BaseChannelPlugin, required methods, event emitters)
- [ ] Validates reliability utility adoption (dedupe, download guard, sanitize)
- [ ] Validates optional capability consistency (stream sender, fetchHistory, sendTyping)
- [ ] Validates error class hierarchy (extends core ChannelError)
- [ ] Validates journey timing checkpoints (T10, T11 in sendMessage paths)
- [ ] CI integration: `make test` includes it (already true -- `bun test` runs all `*.test.ts`)
- [ ] Documents what "SDK compliance" means via test descriptions
- [ ] `make check` green after implementation

## Design Approach

### Static analysis over runtime instantiation

The compliance tests should NOT instantiate the channel plugins (they require real credentials, network connections, and complex dependencies like Baileys, Grammy, Discord.js, Bolt.js). Instead, they should use **static analysis**:

1. **Class/prototype inspection** -- Import the plugin class, check `prototype` for required methods, check that it extends `BaseChannelPlugin`.
2. **Source code scanning** -- Use `fs.readFileSync` to read the plugin source files and grep for required patterns (e.g., `createInboundDedupeCache`, `captureT10`, `sanitizeMessage`).
3. **Type/export inspection** -- Import the error classes and verify `instanceof ChannelError`.
4. **Capabilities cross-check** -- Import the capabilities constant and verify that optional methods exist when capabilities declare support.

This approach avoids mocking entire platform SDKs and keeps tests fast (<1s total).

### Channel descriptor

Each channel under test is described by a descriptor:

```typescript
interface ChannelDescriptor {
  name: string;                    // 'telegram', 'discord', etc.
  packageName: string;             // '@omni/channel-whatsapp'
  pluginClass: typeof BaseChannelPlugin;
  errorClass: new (...args: any[]) => Error;
  capabilities: ChannelCapabilities;
  pluginSourcePath: string;        // Absolute path to plugin.ts
  handlerSourcePaths: string[];    // Paths to handler files (for sanitize/dedupe grep)
  errorSourcePath: string;         // Path to errors.ts (for ChannelError check)
}
```

### Test structure

```typescript
const channels: ChannelDescriptor[] = [
  { name: 'telegram', ... },
  { name: 'discord', ... },
  { name: 'whatsapp', ... },
  { name: 'slack', ... },
];

for (const channel of channels) {
  describe(`${channel.name} SDK compliance`, () => {
    // Group 1: Required Contract
    // Group 2: Reliability Utilities
    // Group 3: Optional Capabilities
    // Group 4: Error Hierarchy
    // Group 5: Journey Timing
  });
}
```

## Execution Groups

### Group 1: Test infrastructure and channel descriptors
**Files:**
- `packages/channel-sdk/src/__tests__/compliance.test.ts` (create)

**Changes:**
- Create the parameterized test file with channel descriptors
- Import plugin classes: `WhatsAppPlugin`, `TelegramPlugin`, `DiscordPlugin`, `SlackPlugin`
- Import error classes: `WhatsAppError`, `TelegramError`, `DiscordError`, `SlackError`
- Import capabilities: `WHATSAPP_CAPABILITIES`, `TELEGRAM_CAPABILITIES`, `DISCORD_CAPABILITIES`, `SLACK_CAPABILITIES`
- Define `ChannelDescriptor` interface and populate the array
- Use `readFileSync` to load plugin source for pattern matching

**Tests:**
- Verify all 4 descriptors are defined
- Verify source files exist and are readable

### Group 2: Required contract tests
**Files:** Same test file

**Changes:** Add test cases for each channel:

1. **Extends BaseChannelPlugin** -- `channel.pluginClass.prototype instanceof BaseChannelPlugin` (or check prototype chain)
2. **Has required abstract properties** -- Instantiate-free check: verify `id`, `name`, `version`, `capabilities` are declared (check prototype or class definition source)
3. **Implements required methods** -- Check that `connect`, `disconnect`, `sendMessage` exist on prototype as functions
4. **Implements lifecycle methods** -- Check `initialize`, `destroy` exist (inherited from base)
5. **Implements health methods** -- Check `getHealth`, `getConnectedInstances`, `getStatus` exist

**Tests:**
```
it('extends BaseChannelPlugin')
it('implements connect()')
it('implements disconnect()')
it('implements sendMessage()')
it('has id, name, version, capabilities properties')
```

### Group 3: Reliability utility tests
**Files:** Same test file

**Changes:** Source-scan the plugin and handler files for required SDK utility usage:

1. **Inbound dedup** -- `createInboundDedupeCache` appears in plugin.ts source
2. **Download guard** -- `createDownloadGuard` appears in plugin.ts or handler source files
3. **Sanitize** -- `sanitizeMessage` appears in handler source files
4. **Event emitters** -- `emitMessageReceived`, `emitMessageSent`, `emitMessageFailed` appear in plugin.ts source

**Tests:**
```
it('uses createInboundDedupeCache for deduplication')
it('uses createDownloadGuard for media downloads')
it('uses sanitizeMessage for inbound text')
it('calls emitMessageReceived for inbound messages')
it('calls emitMessageSent on successful send')
it('calls emitMessageFailed on send failure')
```

### Group 4: Optional capability consistency tests
**Files:** Same test file

**Changes:** Cross-reference capabilities with method existence:

1. **canStreamResponse** -- If `capabilities.canStreamResponse === true`, verify `createStreamSender` exists on prototype
2. **fetchHistory** -- If `fetchHistory` method exists, verify it's typed correctly (method on prototype)
3. **sendTyping** -- If `capabilities.canSendTyping === true`, verify `sendTyping` exists on prototype
4. **react/unreact** -- If plugin source contains `react` method, verify both `react` and `unreact` exist

**Tests:**
```
it('has createStreamSender when canStreamResponse is declared')
it('has fetchHistory method')
it('has sendTyping when canSendTyping is declared')
it('has react/unreact pair when reactions are supported')
```

### Group 5: Error hierarchy tests
**Files:** Same test file

**Changes:** Verify error class compliance:

1. **Extends ChannelError** -- Instantiate error class, verify `instanceof ChannelError`
2. **Has channelCode** -- Verify error instances have `channelCode` property
3. **Has name** -- Verify `error.name` matches expected pattern (e.g., `'WhatsAppError'`)

**Tests:**
```
it('error class extends ChannelError from @omni/core')
it('error instances have channelCode property')
it('error.name matches channel-specific pattern')
```

### Group 6: Journey timing tests
**Files:** Same test file

**Changes:** Source-scan sendMessage paths for timing checkpoints:

1. **T10 checkpoint** -- `captureT10` appears in plugin.ts source (called before platform send)
2. **T11 checkpoint** -- `captureT11` appears in plugin.ts source (called after platform confirms)
3. **Inbound timing** -- `captureInboundTimings` or `captureT2` appears in plugin.ts source

**Tests:**
```
it('captures T10 (pluginSentAt) in sendMessage path')
it('captures T11 (platformDeliveredAt) in sendMessage path')
it('captures inbound timing checkpoints (T0/T1/T2)')
```

### Group 7: Capabilities shape validation
**Files:** Same test file

**Changes:** Verify each channel's capabilities object conforms to the full `ChannelCapabilities` interface:

1. **Required boolean fields** -- All 15 required boolean fields are present and are booleans
2. **Required numeric fields** -- `maxMessageLength`, `maxFileSize` are numbers >= 0
3. **Required array field** -- `supportedMediaTypes` is a non-empty array
4. **Media type shape** -- Each entry has `mimeType` string

**Tests:**
```
it('capabilities has all required boolean fields')
it('capabilities has valid maxMessageLength')
it('capabilities has valid supportedMediaTypes')
```

## Dependencies

- No ordering constraints between Groups 2-7 (all are independent test groups within one file)
- Group 1 must be implemented first (it provides the infrastructure for all other groups)
- **External blockers from issue #82:**
  - `omni-61v` (Slack utils) -- if not yet resolved, Slack may have partial compliance; tests should document gaps rather than skip
  - `omni-9am` (fetchHistory) -- all 4 channels already implement fetchHistory; no longer blocking
  - `omni-vpw` (error classes) -- all 4 channels already extend ChannelError; resolved
  - `omni-3kq` (Discord streaming) -- Discord has `DiscordStreamSender`; resolved
  - `omni-opa` (sendTyping) -- Telegram, Discord, and WhatsApp implement sendTyping; Slack has thread-only support. Tests should reflect actual state.

## Risks

1. **Import side effects** -- Importing channel packages may trigger module-level side effects (e.g., `const plugin = new WhatsAppPlugin()` in `index.ts`). Mitigation: Import the plugin **class** directly from `./plugin.ts` rather than the package index. Alternatively, import only the class and error exports without triggering default exports.

2. **Source path brittleness** -- Hardcoded paths to source files for pattern scanning break if files move. Mitigation: Use `require.resolve()` or `import.meta.resolve()` to locate package entry points, then derive relative paths. Include a meta-test that verifies all source paths exist.

3. **False positives on pattern matching** -- Grepping for `createInboundDedupeCache` in source could match comments or disabled code. Mitigation: Require the pattern to appear as a function call (e.g., `createInboundDedupeCache(`) and not inside a comment.

4. **Circular dependency / bundler issues** -- The channel-sdk test importing channel packages creates a reverse dependency. Mitigation: These are devDependencies for test-only usage. The channel packages already depend on channel-sdk at runtime; adding them as devDeps of channel-sdk for testing is a standard pattern in monorepos. Alternatively, run the test from a separate test package.

5. **New channels missed** -- If a new channel is added (e.g., `channel-linkedin`, `channel-internal`), it won't be tested until added to the descriptor array. Mitigation: Add a discovery test that scans `packages/channel-*` directories and warns if any are not in the compliance suite. The `channel-a2a` and `channel-internal` packages may be excluded with documented rationale.

## Implementation Notes

- Use `bun:test` (`describe`, `it`, `expect`) consistent with existing SDK tests
- All source scanning uses `node:fs` `readFileSync` -- no external dependencies needed
- Total expected test count: ~4 channels x ~15 checks = ~60 test cases
- Expected runtime: <500ms (no network, no instantiation, just prototype inspection + file reads)
- File location matches the issue's acceptance criteria: `packages/channel-sdk/src/__tests__/compliance.test.ts`
