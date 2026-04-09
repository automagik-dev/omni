# Wish: Channel Plugin Template/Generator

| Field | Value |
|-------|-------|
| **Status** | PLANNED |
| **Slug** | `channel-plugin-generator` |
| **Date** | 2026-03-11 |
| **Issue** | #92 |
| **Blocked by** | #82 (compliance test suite — soft block, target spec not test suite) |

## Summary

Create a generator script (`scripts/create-channel.ts`) that produces a fully SDK-compliant channel plugin skeleton. New channel implementations currently require copying patterns from existing channels, leading to 14 inconsistencies across 4 channels. The generator ensures every new channel starts compliant with BaseChannelPlugin conventions, reliability utilities, journey timing, and error handling patterns.

**Usage:** `bun run scripts/create-channel.ts --name instagram --display "Instagram"`
**Output:** `packages/channel-instagram/` with a compilable, test-passing skeleton.

## Scope

### IN
- Generator script at `scripts/create-channel.ts`
- BaseChannelPlugin subclass with all required abstract method stubs
- Reliability utilities initialized: createInboundDedupeCache, createDownloadGuard, sanitizeMessage
- Custom error class extending ChannelError from core
- Journey timing hooks (T0, T1, T2, T10, T11) in message handler stubs
- sendTyping stub method
- createStreamSender stub
- Basic test suite (compile check + instantiation)
- CLAUDE.md with channel-specific notes template
- package.json with workspace dependencies
- tsconfig.json inheriting from root
- Overwrite protection (--force flag required to overwrite existing)

### OUT
- Auto-modification of ChannelType enum in core (manual step, documented)
- Template engine (Handlebars, EJS) — plain string templates suffice
- Feature flags for optional capabilities (streaming, history, reactions) — keep minimal
- Auth/credential logic — channel-specific, not templatable
- Actual platform SDK integration code — just stubs
- Handler subdirectories with empty files — add as needed
- Compliance test suite execution (#82 — separate issue)

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Template approach | String interpolation | Only 5-10 variables; no engine dependency needed |
| ChannelType enum | Manual step (documented) | Generator stays decoupled from core; 1-line change |
| Generated code size | ~600 LOC across all files | Minimal viable skeleton, not production stubs |
| Optional features | Not pre-generated | Developers add streaming/history/reactions on demand |
| Package structure | Mirror channel-whatsapp layout | Proven production pattern, most consistent |
| Workspace registration | Automatic via glob | bun workspace already discovers `packages/*` |
| Overwrite behavior | Warn + require `--force` | Safety against accidental regeneration |
| package.json markers | `_generated: true`, `_templateVersion` | Track generated vs hand-written packages |

## Success Criteria

- [ ] `bun run scripts/create-channel.ts --name example --display "Example"` produces `packages/channel-example/`
- [ ] Generated package compiles: `cd packages/channel-example && bun run build`
- [ ] Generated tests pass: `cd packages/channel-example && bun test`
- [ ] Generated plugin class extends BaseChannelPlugin correctly
- [ ] Plugin initializes createInboundDedupeCache in constructor/onInitialize
- [ ] Plugin initializes createDownloadGuard in constructor/onInitialize
- [ ] Plugin uses sanitizeMessage in inbound message handler stub
- [ ] Custom error class extends ChannelError from @omni/core
- [ ] Journey timing hooks (captureT0, captureInboundTimings, captureT2, captureT10, captureT11) present in message handler stubs
- [ ] sendTyping method stub exists
- [ ] createStreamSender method stub exists
- [ ] CLAUDE.md generated with channel-specific template
- [ ] Running without --force on existing package shows error
- [ ] `make check` green (no lint/type errors introduced)

## Assumptions & Risks

| Risk | Mitigation |
|------|-----------|
| Template drifts from BaseChannelPlugin evolution | Track `_templateVersion` in generated package.json; document sync process |
| #82 (compliance suite) not yet merged | Target the compliance spec from issue description, not the test suite |
| ChannelType enum not auto-updated | Document as manual step in generator output; print reminder |
| Generated code compiles but isn't useful | Keep minimal — stubs with TODO comments guiding next steps |
| New abstract methods added to BaseChannelPlugin | Generator fails to compile → forces template update |

---

## Execution Groups

### Group 1: Generator Script Core

**Goal:** Create the generator script that produces the package directory structure with all template files.

**Deliverables:**
- [ ] New file `scripts/create-channel.ts` with:
  - CLI argument parsing: `--name <name>` (required, lowercase kebab), `--display <display>` (required, human-readable)
  - Validation: name must be lowercase alphanumeric + hyphens, no spaces
  - Overwrite check: if `packages/channel-{name}/` exists, error unless `--force` passed
  - Directory creation: `packages/channel-{name}/src/`, `packages/channel-{name}/src/__tests__/`
  - Template rendering: string interpolation for all generated files
  - Post-generation: print success message with next steps (add ChannelType to core, implement connect/disconnect/sendMessage)
- [ ] Generated `packages/channel-{name}/package.json`:
  ```json
  {
    "name": "@omni/channel-{name}",
    "version": "1.0.0",
    "type": "module",
    "main": "src/index.ts",
    "types": "src/index.ts",
    "_generated": true,
    "_templateVersion": "1.0.0",
    "scripts": {
      "build": "bun build src/index.ts --outdir dist --target bun",
      "test": "bun test",
      "lint": "biome check src/"
    },
    "dependencies": {
      "@omni/channel-sdk": "workspace:*",
      "@omni/core": "workspace:*"
    },
    "devDependencies": {
      "@types/bun": "latest"
    }
  }
  ```
- [ ] Generated `packages/channel-{name}/tsconfig.json`:
  ```json
  {
    "extends": "../../tsconfig.json",
    "compilerOptions": {
      "outDir": "dist",
      "rootDir": "src"
    },
    "include": ["src"]
  }
  ```

**Acceptance:**
- Script runs without errors
- Generated directory structure matches spec
- package.json has correct workspace dependencies

**Validation:**
```bash
bun run scripts/create-channel.ts --name test-gen --display "Test Generator" && ls -la packages/channel-test-gen/
```

---

### Group 2: Plugin Class Template

**Goal:** Generate the main plugin class extending BaseChannelPlugin with all required stubs.

**Depends on:** Group 1 (generator infrastructure)

**Deliverables:**
- [ ] Generated `packages/channel-{name}/src/plugin.ts`:
  - Class `{Display}Plugin extends BaseChannelPlugin`
  - Abstract properties: `id` (string literal), `name` (display name), `version` ('1.0.0'), `capabilities` (from local capabilities.ts)
  - `private dedupeCache` initialized via `createInboundDedupeCache()`
  - `private downloadGuard` initialized via `createDownloadGuard()`
  - `async onInitialize()` — TODO stub for platform client setup
  - `async connect(instanceId, config)` — TODO stub with `emitInstanceConnected()` call
  - `async disconnect(instanceId)` — TODO stub with `emitInstanceDisconnected()` call
  - `async sendMessage(instanceId, message)` — stub with:
    - `captureT10(correlationId)` before platform call
    - TODO for actual send
    - `captureT11(correlationId)` after platform call
    - `emitMessageSent()` call
    - Return `SendResult` shape
  - `async handleInboundMessage(instanceId, rawMessage)` — stub with:
    - `dedupeCache.isDuplicate()` check
    - `sanitizeMessage()` call
    - `captureT0()` + `captureInboundTimings()` calls
    - `emitMessageReceived()` call
    - `captureT2()` call
  - `async sendTyping(instanceId, chatId, duration?)` — TODO stub
  - `createStreamSender(instanceId, chatId, replyToMessageId?, chatType?, options?)` — TODO stub returning minimal StreamSender
  - `async onDestroy()` — cleanup stub

- [ ] Generated `packages/channel-{name}/src/capabilities.ts`:
  ```typescript
  import { DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
  import type { ChannelCapabilities } from '@omni/channel-sdk';

  export const CAPABILITIES: ChannelCapabilities = {
    ...DEFAULT_CAPABILITIES,
    canSendText: true,
    canSendMedia: false,       // TODO: enable when media sending is implemented
    canSendReaction: false,    // TODO: enable when reactions are implemented
    canSendTyping: true,
    canStreamResponse: false,  // TODO: enable when streaming is implemented
    maxMessageLength: 4096,    // TODO: adjust per platform limits
  };
  ```

- [ ] Generated `packages/channel-{name}/src/errors.ts`:
  ```typescript
  import { ChannelError } from '@omni/core';
  import type { ErrorCode } from '@omni/core';

  export class {Display}Error extends ChannelError {
    constructor(
      code: ErrorCode,
      message: string,
      instanceId?: string,
      options?: { cause?: Error; recoverable?: boolean },
    ) {
      super(code, message, '{name}', instanceId, options);
    }
  }
  ```

**Acceptance:**
- Plugin class compiles without errors
- All BaseChannelPlugin abstract methods are implemented
- Reliability utilities (dedupe, download guard, sanitize) are initialized
- Journey timing hooks are present in message stubs
- Error class extends ChannelError correctly

**Validation:**
```bash
cd packages/channel-test-gen && bun run build
```

---

### Group 3: Index, Types, and Exports

**Goal:** Generate the public API surface and type definitions.

**Depends on:** Group 2 (plugin class exists)

**Deliverables:**
- [ ] Generated `packages/channel-{name}/src/index.ts`:
  ```typescript
  import { {Display}Plugin } from './plugin';

  const plugin = new {Display}Plugin();
  export default plugin;

  export { {Display}Plugin } from './plugin';
  export { CAPABILITIES } from './capabilities';
  export { {Display}Error } from './errors';
  export type * from './types';
  ```

- [ ] Generated `packages/channel-{name}/src/types.ts`:
  ```typescript
  /**
   * {Display} channel-specific types.
   *
   * Add platform-specific message types, config schemas, and
   * API response types here.
   */

  /** Configuration for a {Display} instance */
  export interface {Display}InstanceConfig {
    // TODO: Add platform-specific config fields
    // e.g., apiKey: string; botToken: string;
  }

  /** Raw inbound message from {Display} platform */
  export interface {Display}RawMessage {
    // TODO: Add platform-specific message fields
    id: string;
    text?: string;
    timestamp: number;
    senderId: string;
    chatId: string;
  }
  ```

**Acceptance:**
- Default export is a plugin instance (for auto-discovery)
- Named exports include plugin class, capabilities, error class, types
- All exports compile

**Validation:**
```bash
cd packages/channel-test-gen && bun run build
```

---

### Group 4: Test Suite Template

**Goal:** Generate a basic test suite that validates the plugin compiles and instantiates.

**Depends on:** Group 3 (exports exist)

**Deliverables:**
- [ ] Generated `packages/channel-{name}/src/__tests__/plugin.test.ts`:
  ```typescript
  import { describe, expect, it } from 'bun:test';
  import plugin, { {Display}Plugin, CAPABILITIES } from '../index';

  describe('{Display} Plugin', () => {
    it('exports a default plugin instance', () => {
      expect(plugin).toBeInstanceOf({Display}Plugin);
    });

    it('has correct plugin metadata', () => {
      expect(plugin.id).toBe('{name}');
      expect(plugin.name).toBe('{display}');
      expect(plugin.version).toBe('1.0.0');
    });

    it('exports capabilities', () => {
      expect(CAPABILITIES).toBeDefined();
      expect(CAPABILITIES.canSendText).toBe(true);
    });

    it('has required methods', () => {
      expect(typeof plugin.connect).toBe('function');
      expect(typeof plugin.disconnect).toBe('function');
      expect(typeof plugin.sendMessage).toBe('function');
    });

    it('has sendTyping method', () => {
      expect(typeof plugin.sendTyping).toBe('function');
    });

    it('has createStreamSender method', () => {
      expect(typeof plugin.createStreamSender).toBe('function');
    });
  });
  ```

**Acceptance:**
- Tests pass with `bun test`
- Tests verify: instantiation, metadata, required methods, optional methods
- No external dependencies or mocking needed for basic tests

**Validation:**
```bash
cd packages/channel-test-gen && bun test
```

---

### Group 5: CLAUDE.md Template

**Goal:** Generate channel-specific documentation for AI agents working on the channel.

**Depends on:** Group 1 (generator infrastructure)

**Deliverables:**
- [ ] Generated `packages/channel-{name}/CLAUDE.md`:
  ```markdown
  # Channel: {Display}

  > Generated by `scripts/create-channel.ts` (template v1.0.0)

  ## Overview

  {Display} channel plugin for Omni v2. Extends `BaseChannelPlugin` from `@omni/channel-sdk`.

  ## Getting Started

  1. Add `'{name}'` to the `ChannelType` union in `packages/core/src/types/channel.ts`
  2. Implement `connect()` with platform SDK client initialization
  3. Implement `disconnect()` with graceful client teardown
  4. Implement `sendMessage()` with platform API calls
  5. Wire `handleInboundMessage()` to platform webhook/event listener

  ## Key Files

  | File | Purpose |
  |------|---------|
  | `src/plugin.ts` | Main plugin class — all channel logic starts here |
  | `src/capabilities.ts` | Declare what this channel supports |
  | `src/errors.ts` | Channel-specific error class |
  | `src/types.ts` | Platform-specific type definitions |
  | `src/__tests__/plugin.test.ts` | Basic plugin tests |

  ## SDK Utilities (already initialized)

  - `createInboundDedupeCache()` — Prevents duplicate inbound messages
  - `createDownloadGuard()` — Size-checks media before download
  - `sanitizeMessage()` — Strips unsafe characters from inbound text

  ## Journey Timing

  Timing hooks are already placed in stubs:
  - **T0**: Platform timestamp capture (`captureT0`)
  - **T1**: Omni receive time (`captureInboundTimings`)
  - **T2**: Event published time (`captureT2`)
  - **T10**: Send initiated time (`captureT10`)
  - **T11**: Platform delivery confirmed (`captureT11`)

  ## Patterns to Follow

  - See `packages/channel-discord/src/plugin.ts` for streaming example
  - See `packages/channel-whatsapp/src/plugin.ts` for media handling example
  - See `packages/channel-telegram/src/plugin.ts` for webhook example
  ```

**Acceptance:**
- CLAUDE.md generated with correct channel name substituted
- Links to relevant example channels
- Documents the getting-started steps

**Validation:**
```bash
cat packages/channel-test-gen/CLAUDE.md | head -5
```

---

### Group 6: Integration Validation

**Goal:** Verify the complete generator output compiles, tests pass, and make check is green.

**Depends on:** Groups 1-5

**Deliverables:**
- [ ] Generate test channel: `bun run scripts/create-channel.ts --name test-example --display "Test Example"`
- [ ] Verify compilation: `cd packages/channel-test-example && bun run build`
- [ ] Verify tests: `cd packages/channel-test-example && bun test`
- [ ] Verify lint: `cd packages/channel-test-example && bunx biome check src/`
- [ ] Verify `make check` passes at repo root
- [ ] Clean up: remove `packages/channel-test-example/` (test artifact, not committed)
- [ ] Verify `--force` flag works on existing directory
- [ ] Verify error shown when running without `--force` on existing directory

**Acceptance:**
- Generated channel compiles, tests pass, lint clean
- `make check` green at repo root
- Overwrite protection works correctly
- Test artifacts cleaned up

**Validation:**
```bash
bun run scripts/create-channel.ts --name test-example --display "Test Example"
cd packages/channel-test-example && bun run build && bun test
cd ../.. && make check
rm -rf packages/channel-test-example
```

---

## Dependencies

```
Group 1 (script core) ← independent, start first
Group 2 (plugin class) ← depends on Group 1
Group 3 (index/types) ← depends on Group 2
Group 4 (test suite) ← depends on Group 3
Group 5 (CLAUDE.md) ← depends on Group 1 (parallel with 2-4)
Group 6 (validation) ← depends on all previous groups
```

**Execution order:**
- **Wave 1:** Group 1
- **Wave 2:** Group 2 + Group 5 (parallel)
- **Wave 3:** Group 3 (after Group 2)
- **Wave 4:** Group 4 (after Group 3)
- **Final:** Group 6 (integration validation)

In practice, Groups 1-5 are all part of the single `scripts/create-channel.ts` file — the groups represent logical sections of the template output, not separate implementation steps. The generator itself is one script; groups organize the generated output.

---

## Rollback

**Full removal:**
1. Delete `scripts/create-channel.ts`
2. Delete any generated `packages/channel-*/` directories that haven't been customized

No other files are modified by the generator. It's fully additive.
