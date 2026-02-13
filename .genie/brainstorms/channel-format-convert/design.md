# Design: Channel-Aware Format Conversion & Smart Splitting

## Problem

Agent responses are standard markdown, but each messaging channel has its own formatting syntax and message length limits. Currently, messages either arrive as raw markdown (unformatted) or break when they exceed platform limits. There's no unified conversion layer.

## Scope

### IN
- Markdown → native format conversion per channel (WhatsApp, Telegram, Discord)
- Smart splitting that respects format boundaries (never break mid-code-block or mid-entity)
- Per-instance toggle: `messageFormatMode: 'convert' | 'passthrough'` (default: `convert`)
- Graceful degradation for unsupported features (headers → bold, etc.)
- Existing `enableAutoSplit` (paragraph splitting on `\n\n`) remains as Layer 1
- Format conversion + length splitting is Layer 2 (inside each channel plugin)

### OUT
- Custom emoji support
- Image/media formatting
- Platform-specific features with no markdown equivalent (spoilers, underline)
- Inbound format conversion (channel → markdown) — separate wish
- Changes to agent prompting

## Architecture Decision: Plugin-Owned Conversion

Each channel plugin owns its format conversion. This is consistent with Omni's plugin isolation — the API layer sends markdown, the plugin decides how to render it.

The `channel-sdk` MAY provide a shared markdown parser utility, but plugins are not required to use it.

### Flow

```
Agent output (markdown)
  → Layer 1: Paragraph split on \n\n (API, if enableAutoSplit=true)
  → For each part:
    → Layer 2a: Format convert (markdown → native syntax)
    → Layer 2b: Length split (if converted text > channel max length)
    → Send each chunk via channel API
```

## Channel Formatting Matrix

| Feature | Markdown Input | WhatsApp Output | Telegram HTML Output | Discord Output |
|---------|---------------|-----------------|---------------------|----------------|
| **Bold** | `**text**` | `*text*` | `<b>text</b>` | `**text**` (passthrough) |
| **Italic** | `*text*` / `_text_` | `_text_` | `<i>text</i>` | `*text*` (passthrough) |
| **Strikethrough** | `~~text~~` | `~text~` | `<s>text</s>` | `~~text~~` (passthrough) |
| **Inline code** | `` `code` `` | `` `code` `` | `<code>code</code>` | `` `code` `` (passthrough) |
| **Code block** | ` ```lang\ncode``` ` | ` ```code``` ` | `<pre><code class="lang">code</code></pre>` | ` ```lang\ncode``` ` (passthrough) |
| **Blockquote** | `> text` | `> text` | `<blockquote>text</blockquote>` | `> text` (passthrough) |
| **Link** | `[text](url)` | `url` (text lost, auto-detect) | `<a href="url">text</a>` | `[text](url)` (passthrough) |
| **Bulleted list** | `- item` | `- item` (passthrough) | `- item` (plain text) | `- item` (passthrough) |
| **Numbered list** | `1. item` | `1. item` (passthrough) | `1. item` (plain text) | `1. item` (passthrough) |
| **Headers** | `# H1` | `*H1*` (bold) | `<b>H1</b>` (bold) | `**H1**` (bold) |
| **Underline** | N/A | ❌ strip | `<u>text</u>` (if present) | `__text__` |
| **Spoiler** | N/A | ❌ strip | `<tg-spoiler>text</tg-spoiler>` | `\|\|text\|\|` |

### Platform Limits

| Channel | Max Message Length | Notes |
|---------|-------------------|-------|
| WhatsApp | 65,536 chars | Very generous, splitting rarely needed |
| Telegram | 4,096 chars | Tight limit, splitting common for long responses |
| Discord | 2,000 chars | Tightest limit, splitting almost always needed |

## Key Decisions

1. **Agent always outputs markdown** — conversion is channel's responsibility
2. **Each plugin owns conversion** — no shared "format engine" in core
3. **Per-instance configurable** — `messageFormatMode: 'convert' | 'passthrough'`
4. **Discord is near-passthrough** — markdown is native, minimal conversion needed
5. **Telegram prefers HTML mode** — more reliable than MarkdownV2 (no escape nightmares)
6. **WhatsApp conversion is custom** — different bold syntax, no named links, etc.
7. **Headers degrade to bold** — no platform supports native headers
8. **Code blocks never split mid-block** — splitter is syntax-aware

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Agent outputs non-standard markdown | Parser should be lenient, handle edge cases |
| Nested formatting breaks conversion | Test nested bold+italic+code thoroughly |
| WhatsApp formatting differs by client version | Target current stable (2026), accept older clients may not render all features |
| Telegram HTML escaping | Must escape `<`, `>`, `&` in non-tag text |
| Code blocks with platform-specific chars | Escape within code blocks per platform rules |
| Performance overhead of parsing | Markdown parsing is fast; not a concern at message-send time |

## Acceptance Criteria

1. ✅ Markdown response with code block + bold + headers sent via Telegram → arrives formatted with HTML tags, code block in `<pre>`, headers as `<b>`
2. ✅ Same response via WhatsApp → arrives with `*bold*`, `_italic_`, ` ```code``` `, `> quotes`, headers as `*bold*`
3. ✅ Same response via Discord → passes through mostly unchanged (markdown native)
4. ✅ Response exceeding 4096 chars sent via Telegram → auto-split at safe boundaries, code blocks intact across chunks
5. ✅ Response exceeding 2000 chars sent via Discord → auto-split, code blocks wrapped with ``` in each chunk
6. ✅ Instance with `messageFormatMode: 'passthrough'` → raw text sent unchanged (backward compatible)
7. ✅ `enableAutoSplit` paragraph splitting still works as Layer 1 before format conversion

## Implementation Notes

- Each channel plugin needs a `formatMessage(markdown: string): string` function
- Each channel plugin needs `splitFormattedMessage(formatted: string, maxLen: number): string[]` that is syntax-aware
- The `sendText` path in each plugin calls format → split → send-each
- New DB column: `messageFormatMode` on instances table (enum: 'convert', 'passthrough', default 'convert')
- Discord plugin: minimal work (mostly passthrough, just handle headers and length splitting)
- Telegram plugin: most work (full markdown→HTML converter + HTML-aware splitter)
- WhatsApp plugin: medium work (syntax translation + large limit means less splitting)
