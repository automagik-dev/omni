# Omni v2 - Technical Reference

> Code patterns, refactoring guidelines, and distributed documentation standards.
> For workflow, agents, and commands see @AGENTS.md.

## Code Patterns

### Event Publishing

```typescript
// Always publish events for state changes
await eventBus.publish({
  type: 'message.received',
  payload: {
    instanceId,
    channelType: 'whatsapp',
    message,
  },
  metadata: {
    correlationId: generateId(),
    timestamp: Date.now(),
  },
});
```

### Zod Schema First

```typescript
// Define schema once, derive types
export const MessageSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  sender: PersonReferenceSchema,
  timestamp: z.number(),
});

export type Message = z.infer<typeof MessageSchema>;
```

### Channel Plugin Pattern

```typescript
// Channel plugins implement the ChannelPlugin interface
export const whatsappPlugin: ChannelPlugin = {
  id: 'whatsapp-baileys',
  name: 'WhatsApp (Baileys)',

  async initialize(config) { /* ... */ },
  async sendMessage(instanceId, message) { /* ... */ },
  async handleWebhook(req) { /* ... */ },

  events: {
    'message.received': handleIncoming,
    'message.sent': handleOutgoing,
  },
};
```

### Error Handling

```typescript
// Use typed errors with context
import { OmniError, ErrorCode } from '@omni/core';

throw new OmniError({
  code: ErrorCode.CHANNEL_NOT_CONNECTED,
  message: 'WhatsApp instance not connected',
  context: { instanceId },
  recoverable: true,
});
```

## Refactoring Guidelines

When Biome reports `noExcessiveCognitiveComplexity` or suggests extracting helpers:

### Before Creating New Helpers

**ALWAYS search for existing utilities first:**

```bash
rg "function (format|parse|transform|validate|convert)" packages/
rg "export (function|const)" packages/*/src/utils/
rg "export" packages/core/src/utils/
```

### Common Utility Locations

| Type | Check Here First |
|------|------------------|
| String/formatting | `packages/core/src/utils/` |
| Validation helpers | `packages/core/src/schemas/` |
| Date/time utilities | `packages/core/src/utils/` |
| ID generation | `packages/core/src/identity/` |
| Error helpers | `packages/core/src/errors/` |
| Channel-specific | `packages/channel-*/src/utils/` |

### When Extracting Functions

1. **Search first** - grep/glob for similar existing functions
2. **Reuse if exists** - Import and use the existing helper
3. **Extend if close** - If a helper does 80% of what you need, extend it
4. **Create if truly new** - Only create new helpers when no suitable option exists
5. **Place correctly** - Shared in `@omni/core`, package-specific in local `utils/`

### Refactoring Strategies

- **Early returns** - Reduce nesting by returning early for edge cases
- **Guard clauses** - Handle invalid states at the top of functions
- **Compose small functions** - Prefer many small functions over one large one
- **Single responsibility** - Each function should do one thing well

## Distributed Documentation

Each package/directory should have its own CLAUDE.md with package-specific patterns, local conventions, and integration notes.

```
packages/core/CLAUDE.md      # Core package patterns
packages/api/CLAUDE.md       # API conventions
packages/channel-*/CLAUDE.md # Channel-specific notes
```
