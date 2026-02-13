# Wish: Channel-Aware Format Conversion & Smart Splitting

**Status:** DONE
**Slug:** `channel-format-convert`
**Created:** 2026-02-13
**GitHub Issue:** [#28](https://github.com/automagik-dev/omni/issues/28)

---

## Summary

Agent responses are standard markdown, but each messaging channel has its own formatting syntax and message length limits. Messages currently arrive as raw markdown (unformatted) or error when they exceed platform limits. We need a per-channel format conversion layer (markdown → native syntax) and syntax-aware splitting that never breaks code blocks or formatting entities mid-chunk.

---

## Scope

### IN
- Markdown → native format conversion per channel plugin (WhatsApp, Telegram, Discord)
- Syntax-aware smart splitting per channel (respects code blocks, formatting boundaries)
- Per-instance toggle: `messageFormatMode` column (`convert` | `passthrough`, default `convert`)
- Graceful degradation for unsupported features (e.g., `# Header` → bold)
- Telegram uses HTML parse mode (most reliable)
- WhatsApp uses native syntax (`*bold*`, `_italic_`, `` ` ``code`` ` ``, `> quote`, `- list`, `~strike~`)
- Discord near-passthrough (native markdown, just header conversion + length splitting)

### OUT
- Custom emoji translation
- Image/media formatting changes
- Inbound conversion (channel → markdown) — separate wish
- Agent prompt changes (agents already output markdown)
- Spoiler / underline (no markdown equivalent, platform-specific)
- Shared "format engine" in core — plugins own their conversion

---

## Decisions

- **DEC-1:** Each channel plugin owns its format conversion and splitting. No shared engine in `@omni/core`. The `channel-sdk` MAY offer a markdown parser utility but plugins are not required to use it. Rationale: plugin isolation principle — channels are plugins, not core code.
- **DEC-2:** Telegram uses HTML parse mode (`parse_mode: 'HTML'`), not MarkdownV2. Rationale: MarkdownV2 requires escaping 18+ special characters and is fragile. HTML is explicit and reliable.
- **DEC-3:** Headers (`#`, `##`, etc.) degrade to bold text on all platforms. No channel supports native headers.
- **DEC-4:** Markdown links `[text](url)` on WhatsApp degrade to `text: url` (WhatsApp doesn't support named links via API).
- **DEC-5:** The existing `enableAutoSplit` (Layer 1: paragraph split on `\n\n`) is unchanged. Format conversion is Layer 2 (inside each plugin, after Layer 1).

---

## Success Criteria

- [ ] Markdown with bold, italic, code block, headers, blockquote sent via Telegram → arrives with correct HTML formatting
- [ ] Same markdown via WhatsApp → arrives with WhatsApp-native formatting (`*bold*`, `` ```code``` ``, `> quote`)
- [ ] Same markdown via Discord → passes through with headers converted to `**bold**`, rest unchanged
- [ ] A 6000-char response via Telegram → split into 2 messages, code blocks intact across chunks
- [ ] A 4000-char response via Discord → split into 2 messages, code blocks re-wrapped with ``` per chunk
- [ ] Instance with `messageFormatMode: 'passthrough'` → raw text, no conversion (backward compatible)
- [ ] All existing tests pass — no regressions
- [ ] New unit tests for each converter and splitter

---

## Assumptions

- **ASM-1:** Agents output standard markdown (CommonMark). Non-standard output is handled best-effort.
- **ASM-2:** WhatsApp formatting syntax (2026) supports: `*bold*`, `_italic_`, `~strike~`, `` `code` ``, `` ```codeblock``` ``, `> blockquote`, `- bullet list`, `1. numbered list`.
- **ASM-3:** Telegram message limit is 4096 chars, Discord is 2000 chars, WhatsApp is 65536 chars.

## Risks

- **RISK-1:** Nested formatting (bold inside italic inside code) may produce invalid output on some platforms. — Mitigation: test nested cases, strip conflicting nesting if needed.
- **RISK-2:** Telegram HTML requires escaping `<`, `>`, `&` in non-tag text. Missing escapes → API rejects message. — Mitigation: escape all non-tag text in converter.
- **RISK-3:** WhatsApp client versions may render formatting differently. — Mitigation: target current stable (2026), accept minor rendering differences on older clients.

---

## Execution Groups

### Group A: DB Schema + Instance Config

**Goal:** Add `messageFormatMode` column to instances table and expose in API schemas.

**Deliverables:**
- New column `message_format_mode` in `packages/db/src/schema.ts` (varchar, `'convert' | 'passthrough'`, default `'convert'`)
- Add to `createInstanceSchema` and `updateInstanceSchema` in `packages/api/src/routes/v2/instances.ts`
- Add to `@omni/core` instance schema
- Generate/apply Drizzle migration for the new column (`make db-push` for dev)

**Acceptance Criteria:**
- [ ] `messageFormatMode` field accepted in POST/PATCH /instances
- [ ] Default value is `'convert'` for new instances
- [ ] Existing instances get `'convert'` as default (non-breaking)
- [ ] Migration applies cleanly on fresh and existing DBs

**Validation:** `make typecheck && bun test packages/api/`

---

### Group B: Telegram Format Converter + Smart Splitter

**Goal:** Convert markdown → Telegram HTML and split messages at safe boundaries.

**Deliverables:**
- `packages/channel-telegram/src/utils/markdown-to-html.ts` — markdown → Telegram HTML converter
  - Bold: `**text**` → `<b>text</b>`
  - Italic: `*text*` / `_text_` → `<i>text</i>`
  - Strikethrough: `~~text~~` → `<s>text</s>`
  - Inline code: `` `code` `` → `<code>code</code>`
  - Code block: `` ```lang\ncode``` `` → `<pre><code class="lang">code</code></pre>`
  - Blockquote: `> text` → `<blockquote>text</blockquote>`
  - Link: `[text](url)` → `<a href="url">text</a>`
  - Header: `# H` → `<b>H</b>`
  - Escape `<`, `>`, `&` in non-tag text
- Update `packages/channel-telegram/src/utils/formatting.ts` — `splitMessage` becomes HTML-aware (never split inside `<pre>`, `<code>`, `<blockquote>` tags)
- Update `packages/channel-telegram/src/senders/text.ts` — call converter before splitting, use `parse_mode: 'HTML'`
- Update `packages/channel-telegram/src/senders/stream.ts` — apply same conversion on final message
- Unit tests for converter (bold, italic, code, headers, nested, escaping edge cases)
- Unit tests for HTML-aware splitter

**Acceptance Criteria:**
- [ ] Markdown with all supported features → correct Telegram HTML output
- [ ] HTML special chars in content are escaped (no API errors)
- [ ] Messages >4096 chars split without breaking tags
- [ ] Code blocks spanning >4096 chars get re-wrapped with `<pre>` in each chunk
- [ ] `messageFormatMode: 'passthrough'` skips conversion entirely

**Validation:** `bun test packages/channel-telegram/`

---

### Group C: WhatsApp Format Converter + Smart Splitter

**Goal:** Convert markdown → WhatsApp-native syntax and add syntax-aware splitting (rarely needed at 65K limit).

**Deliverables:**
- `packages/channel-whatsapp/src/utils/markdown-to-whatsapp.ts` — markdown → WhatsApp syntax converter
  - Bold: `**text**` → `*text*`
  - Italic: `_text_` → `_text_` (passthrough, same syntax)
  - Strikethrough: `~~text~~` → `~text~`
  - Inline code: `` `code` `` → `` `code` `` (passthrough)
  - Code block: `` ```lang\ncode``` `` → `` ```code``` `` (strip lang hint)
  - Blockquote: `> text` → `> text` (passthrough)
  - Link: `[text](url)` → `text: url` (no named links in WhatsApp)
  - Header: `# H` → `*H*` (bold)
  - Bulleted/numbered lists: passthrough (WhatsApp supports them natively)
- `packages/channel-whatsapp/src/utils/split-message.ts` — syntax-aware splitter (split at newlines/paragraphs, never inside `` ``` `` blocks; 65536 limit)
- Update `packages/channel-whatsapp/src/senders/text.ts` — call converter + splitter
- Unit tests for converter and splitter

**Acceptance Criteria:**
- [ ] Markdown with all features → correct WhatsApp syntax
- [ ] Links degrade to `text: url` format
- [ ] Headers become bold (`*H*`)
- [ ] Messages >65536 chars split at safe boundaries (extremely rare but handled)
- [ ] `messageFormatMode: 'passthrough'` skips conversion

**Validation:** `bun test packages/channel-whatsapp/`

---

### Group D: Discord Format Converter + Smart Splitter

**Goal:** Minimal conversion (Discord is markdown-native) — just headers + improved length splitting.

**Deliverables:**
- `packages/channel-discord/src/utils/markdown-to-discord.ts` — minimal converter
  - Header: `# H` → `**H**` (bold — Discord has no native header rendering in bot messages)
  - Everything else: passthrough (Discord uses markdown natively)
- Update `packages/channel-discord/src/utils/chunking.ts` — make code-block-aware (never split inside ``` blocks; re-wrap with ``` per chunk)
- Update `packages/channel-discord/src/senders/text.ts` — call converter before chunking
- Unit tests for converter and improved chunker

**Acceptance Criteria:**
- [ ] Headers converted to bold, everything else passthrough
- [ ] Code blocks never split mid-block; re-wrapped with ``` fences per chunk
- [ ] Messages >2000 chars split correctly
- [ ] `messageFormatMode: 'passthrough'` skips conversion

**Validation:** `bun test packages/channel-discord/`

---

### Group E: Integration — Wire `messageFormatMode` Through Send Path

**Goal:** Connect the instance config to the send path in each plugin so conversion can be toggled per-instance.

**Propagation path:** The `messageFormatMode` flag flows via `OutgoingMessage.metadata.messageFormatMode`. The API layer (`agent-responder.ts` + `agent-dispatcher.ts`) reads the instance config and sets it on every `OutgoingMessage.metadata` before calling `plugin.sendMessage()`. Each plugin's `sendMessage` text branch reads `message.metadata?.messageFormatMode` and skips conversion when `'passthrough'`.

**Deliverables:**
- Update `packages/channel-sdk/src/types/messaging.ts` — document `messageFormatMode` as a typed metadata key on `OutgoingMessage` (add `MessageMetadata` interface or inline doc)
- Update `packages/channel-sdk/src/types/index.ts` — re-export if new type added
- Update `packages/api/src/plugins/agent-responder.ts` — in `sendTextMessage()`, read instance `messageFormatMode` and set `metadata.messageFormatMode` on the `OutgoingMessage`
- Update `packages/api/src/plugins/agent-dispatcher.ts` — same as responder
- Each plugin's `sendMessage` text branch reads the flag and skips/applies conversion accordingly
- Integration test: send markdown through API → verify formatted output per channel

**Acceptance Criteria:**
- [ ] Instance with `messageFormatMode: 'convert'` → formatted messages
- [ ] Instance with `messageFormatMode: 'passthrough'` → raw markdown
- [ ] Switching mode via PATCH /instances/:id takes effect on next message
- [ ] All existing tests pass (no regressions)

**Validation:** `make check`

---

## Review Results

_Populated by `/review` after execution completes._

---

## Files to Create/Modify

```
# Group A — Schema
packages/db/src/schema.ts                                    (modify)
packages/core/src/schemas/instance.ts                        (modify)
packages/api/src/routes/v2/instances.ts                      (modify)

# Group B — Telegram
packages/channel-telegram/src/utils/markdown-to-html.ts      (create)
packages/channel-telegram/src/utils/formatting.ts            (modify — HTML-aware splitting)
packages/channel-telegram/src/senders/text.ts                (modify)
packages/channel-telegram/src/senders/stream.ts              (modify)
packages/channel-telegram/src/utils/__tests__/markdown-to-html.test.ts  (create)
packages/channel-telegram/src/utils/__tests__/formatting.test.ts        (modify/create)

# Group C — WhatsApp
packages/channel-whatsapp/src/utils/markdown-to-whatsapp.ts  (create)
packages/channel-whatsapp/src/utils/split-message.ts         (create)
packages/channel-whatsapp/src/senders/text.ts                (modify)
packages/channel-whatsapp/src/utils/__tests__/markdown-to-whatsapp.test.ts (create)
packages/channel-whatsapp/src/utils/__tests__/split-message.test.ts        (create)

# Group D — Discord
packages/channel-discord/src/utils/markdown-to-discord.ts    (create)
packages/channel-discord/src/utils/chunking.ts               (modify — code-block-aware)
packages/channel-discord/src/senders/text.ts                 (modify)
packages/channel-discord/src/utils/__tests__/markdown-to-discord.test.ts  (create)
packages/channel-discord/src/utils/__tests__/chunking.test.ts             (modify/create)

# Group E — Integration wiring
packages/channel-sdk/src/types/messaging.ts                  (modify — add MessageMetadata type)
packages/channel-sdk/src/types/index.ts                      (modify — re-export if needed)
packages/api/src/plugins/agent-responder.ts                  (modify)
packages/api/src/plugins/agent-dispatcher.ts                 (modify)
```
