---
title: "design-eugenia-close-contact"
type: intel
tags: [design, architecture, omni, eugenia, handoff, follow-up, close-contact]
---

# Design: Eugenia Close-Contact — Terminal Conversation Closure (Non-Handoff)

| Field | Value |
|-------|-------|
| **Slug** | `eugenia-close-contact` |
| **Date** | 2026-04-29 |
| **Owner** | Pedro (backend Omni + tool agno-api) |
| **Co-owners** | Aragão (Eugenia prompts) · Henrique/Igor (Gupshup Journey) · Cezar (review) |
| **Refs** | [`automagik-dev/omni#559`](https://github.com/automagik-dev/omni/issues/559) · meeting `2026-04-29-encerramento-contato` · Gupshup partner call `2026-04-29-17h` |
| **Related design** | [[design-eugenia-dual-flow]] |
| **WRS target** | 95/100 |

---

## 1. Problem

Eugenia today has only two terminal flows:

1. **`handoff_humano`** — escalates to a human attendant. Tool sets `chat.settings.agentPaused = true`, which fires `chat.handoff_activated`, which disarms the active follow-up sequence. Audit row in `handoff_logs`. Behaviour: pause + transfer.
2. **Implicit "no terminal"** — Eugenia replies and stays armed. The follow-up scheduler keeps chasing the lead per the configured cadence (`24-48h → 5-7d → 14d` per `follow-up-multi-sessao.md`).

**Operational gap:** there are real conversations that should *end* without escalation to a human:

- **Already-customer who asks for SAC** (the trigger for this design). Eugenia must redirect to the SAC 0800. Today she just sends text — no tool fires — so the chat stays armed and the customer gets sales follow-ups days later. Customer experience defect + LGPD smell (we're nagging an existing customer with a sales cadence).
- **Sale closed via Eugenia** (no handoff path). When a future flow lets Eugenia complete a sale herself, there's no terminal signal — the chat would stay armed.
- **Lead refused 3 strikes** (the 3-reinforcement rule from the meeting). After three "não quero cotação" answers, Eugenia must step away cleanly without scheduling more follow-ups.
- **Lead explicitly disengaged** ("não me manda mais mensagem"). Hard close needed.

Operators currently work around (1) by reusing `handoff_humano`, which leaks SAC requests into the human sales desk and inflates the handoff KPI with non-leads.

**Concrete defects observed (April 2026):**
- Customer messages "preciso falar sobre meu plano que tenho" → Eugenia sends 0800 text → no tool → follow-up cadence keeps firing → customer gets "Oi, lembrei de você porque a campanha tá valendo" 24h later.
- Customer doesn't reply for 14 days → 3rd follow-up sent → no terminal close → row stays "armed" with `disarmReason: null` indefinitely until window expires (28 days).

## 2. Goals & Non-Goals

### Goals

- Provide a **terminal closure primitive** parallel to handoff: distinguishes "human took over" from "this conversation is finished".
- Stop follow-up cadence atomically when terminal closure fires.
- Allow **soft closures** (cliente atual SAC, lead recusou cotação, no-response) to reopen passively if the customer comes back, **with a deterministic loop bound**.
- Allow **hard closures** (won/lost) to refuse all further agent dispatch permanently.
- Coordinate Gupshup-side termination via a new `msg_type` so the Journey closes cleanly without burning the WhatsApp 24h window.
- Give ops a manual reopen escape hatch.
- Keep the handoff path (`/messages/send/handoff`) untouched.

### Non-Goals

- **Not** building a generic intent classifier for inbound traffic.
- **Not** auto-archiving chats (separate concern; handled by archive flow).
- **Not** changing the Welcome Journey routing logic on the Gupshup side beyond the new terminal node.
- **Not** migrating `handoff_humano` from `omni send` CLI to HTTP (out of scope; tracked separately).
- **Not** adding a CRM webhook on close (issue #559 lists it as optional; deferred).

## 3. Investigation findings (existing handoff plumbing)

Mapped end-to-end before designing — this is what the meeting asked Pedro to investigate:

```
Eugenia (LLM)
  └─ tool handoff_humano (apps/agno-api/src/agno_api/tools/hapvida/handoff_humano.py)
       └─ subprocess `omni send …` (legacy) ───────────────────┐
                                                                ▼
                                  POST /messages/send/handoff (packages/api/src/routes/v2/messages.ts:1455)
                                       │
                                       ├─ plugin.gupshup → sendHandoff → client.send({ type: 'HANDOFF', text, dados_lead, motivo_handoff, handoff_fields })
                                       │
                                       ├─ services.chats.update(chatId, { settings: { agentPaused: true } })
                                       │     └─ event 'chat.handoff_activated'
                                       │           └─ subscriber in packages/api/src/plugins/follow-up-hooks.ts:128
                                       │                 └─ services.followUpLifecycle.disarm({ reason: 'handoff' })
                                       │
                                       └─ INSERT handoffLogs (audit)
```

Key observations:

| Finding | Reference |
|---|---|
| The "follow-up stop" happens **via the event chain**, not the HTTP call. Setting `agentPaused: true` is what triggers it. | `routes/v2/messages.ts:1502-1505` |
| `disarmActive` is **idempotent**: race-safe, no-op if already disarmed. | `core/src/automations/follow-up/lifecycle.ts:161` |
| Disarm reasons today: `customer_replied | handoff | archived | window_expired | sequence_complete | agent_error`. | `core/src/events/types.ts:670` |
| The Gupshup `msg_type` literal is `'HANDOFF'` (uppercase). Gupshup Journey routes on this literal. | `channel-gupshup/src/senders/handoff.ts:14` |
| Dispatcher already gates on `agentPaused` (skip + ack remove). | `plugins/agent-dispatcher.ts:2606-2610` |
| Dispatcher drops messages older than `agentResumedAt` to avoid NATS redelivery races. | `plugins/agent-dispatcher.ts:2614-2627` |
| Session-cleaner can flip `agentPaused: false` and stamp `agentResumedAt`. | `plugins/session-cleaner.ts:169-175` |
| **Cleanup of state** = none beyond pause + disarm + audit log. No deletion of chat, person, agent memory, or conversation history. | inspection of `messages.ts:1502-1525` |

Implication: the `agentPaused` + event-chain pattern is reusable verbatim. The new endpoint can flip an additional flag (`closed`) and emit a parallel event (`chat.closed`) without touching mid-pipeline code.

## 4. Gupshup partner alignment (call 2026-04-29 17h)

Confirmed with **Henrique (Gupshup integration owner)** and **Igor**:

| Question | Answer |
|---|---|
| Literal of the new `msg_type`? | Anything we send. Agreed: **`CLOSE_CONTACT`** (matches issue #559). |
| Required Gupshup-side journey work? | One new node casing `msg_type === 'CLOSE_CONTACT'`. **Empty terminal node** — no outbound, no chat-fields update, no template fire. |
| What happens when the lead messages back later? | Journey naturally re-enters at **Welcome Journey** (the entry node). Re-routes from there per existing customer-state logic. |
| Need to populate `chatFields` (origem, dados_lead, motivo)? | **No.** Those are handoff-specific (so the human attendant has context). Close-contact does not have a downstream human, so no fields. |
| Tag de encerramento (used by human agents to close tickets)? | **Out of scope.** That's a human-agent feature set via a separate API. Bot does not touch it. |
| Does sending `CLOSE_CONTACT` burn the 24h WhatsApp window? | No — same channel session as handoff, treated as session message. |
| Co-locate farewell text + msg_type in same payload? | Yes, preferred. Endpoint sends `text` + `msg_type: CLOSE_CONTACT` together. |

Cezar's review note from the call: "*A gente vai tratar diferente do que é um handoff — handoff é contato pausado pra humano, close é contato fechado. Pode reaproveitar o nó com um if extra.*" → consistent with this design.

## 5. Scope

### IN

- New HTTP endpoint `POST /messages/send/close-contact` on Omni, Gupshup-only initially.
- New Gupshup sender + payload type `'CLOSE_CONTACT'`.
- New `canCloseContact: true` channel capability.
- New `chat.settings.closed` and `chat.settings.closeUntil` flags.
- New `chat.settings.closeOutcome` field (last close outcome, plain string).
- New disarm reason `'contact_closed'` (singular, distinct from the `closed` flag to avoid name collision).
- New audit table `close_contact_logs`.
- New event `chat.closed`.
- New follow-up hook subscriber (mirrors `chat.handoff_activated`).
- Dispatcher gate extended with two checks: hard `closed` + soft `closeUntil`.
- Manual ops endpoint `POST /chats/:id/reopen-contact`.
- CLI verb `omni close-contact …`.
- New agno-api tool `encerrar_atendimento`.
- New QA scenario (`regression-005-cliente-atual-sac.yaml`).

### OUT

- Eugenia prompt changes (3-strike rule) — Aragão.
- Gupshup Journey terminal node — Henrique.
- New CRM/webhook on close — deferred.
- Auto-archive on close — deferred (configurable later).
- Multi-channel close (Discord, Telegram) — capability flag is added but only Gupshup wires it in v1.
- Migration of legacy `handoff_humano` from CLI subprocess to HTTP — separate task.

### Explicitly NOT changed

- `/messages/send/handoff` and its callers.
- `handoff_logs` table.
- The follow-up arm/cadence configuration (`follow-up/sweeper.ts`, `resolve-config.ts`).
- Welcome Journey routing logic on Gupshup beyond the new node.

## 6. Architecture

### 6.1 Outcome taxonomy

Every close-contact event carries an `outcome`. Six values:

| Outcome | Meaning | Hard close? | Cooldown | Escalation |
|---|---|---|---|---|
| `won` | Sale completed via Eugenia | yes | n/a | n/a |
| `lost` | Lead explicitly refused / blocked | yes | n/a | n/a |
| `redirected_sac` | Already-customer needing SAC | no (soft) | 24h | 2× in 7d → terminal |
| `unqualified` | 3 refusals in same session, not customer | no (soft) | 7d | 3× in 30d → terminal |
| `no_response` | Cadence exhausted, no inbound | no (soft) | 48h | 3× in 30d → terminal |
| `other` | Catch-all (config-tunable) | no (soft) | 24h | 2× in 14d → terminal |

`won` and `lost` are **hard terminals**: the `closed` flag is set; dispatcher refuses permanently; only manual reopen by ops can revert.

The four soft outcomes use a **cooldown timestamp** (`closeUntil`) plus an **automatic escalation rule**: if the same outcome fires more than `escalation_threshold` times within `escalation_window` for the same chat, the next close becomes a hard terminal. Escalation is what bounds the loop.

### 6.2 State machine (chat.settings)

```
       ┌─────────────────────────────────────────┐
       │                                         │
       │   ACTIVE                                │
       │   { agentPaused: false,                 │
       │     closed: false,                      │
       │     closeUntil: null,                   │
       │     closeOutcome: null }                │
       │                                         │
       └─────┬───────────────┬─────────────┬─────┘
             │               │             │
             │               │             │
   close-contact            handoff       …
   (won/lost)            (existing flow)
             │
             ▼
       ┌─────────────────────────────────────────┐
       │   CLOSED (hard terminal)                │
       │   { agentPaused: true,                  │
       │     closed: true,                       │
       │     closeUntil: null,                   │
       │     closeOutcome: 'won'|'lost' }        │
       │                                         │
       │   dispatcher: REFUSE always.            │
       │   exit: only via /reopen-contact.       │
       └─────────────────────────────────────────┘

       ┌─────────────────────────────────────────┐
       │                                         │
       │   ACTIVE                                │
       │                                         │
       └─────┬───────────────────────────────────┘
             │
   close-contact (soft outcome)
             │
             ▼
       ┌─────────────────────────────────────────┐
       │   COOLDOWN                              │
       │   { agentPaused: true,                  │
       │     closed: false,                      │
       │     closeUntil: <ts>,                   │
       │     closeOutcome: <soft outcome> }      │
       │                                         │
       │   dispatcher: REFUSE while now<closeUntil
       └─────┬───────────────┬───────────────────┘
             │               │
   inbound after closeUntil  another close-contact
   (passive expiry)          within escalation window
             │               │
             ▼               ▼
        ┌────────┐       ┌─────────────────────┐
        │ ACTIVE │       │ CLOSED (terminal,   │
        │  ↑     │       │ via escalation)     │
        │ flips  │       │ closed: true        │
        │ on    │        └─────────────────────┘
        │ disp.  │
        └────────┘
```

### 6.3 Two flags, why

`closed` and `closeUntil` are **mutually exclusive by outcome**:

- `closed: true` → terminal. Set only when (a) outcome is `won`/`lost`, or (b) escalation triggered.
- `closeUntil` set → soft cooldown. Cleared when the dispatcher passively reopens, or on a hard close.

`agentPaused: true` is set in **both** states. This guarantees Eugenia stops responding immediately. The dispatcher distinguishes the two via the new flags.

This split preserves the strong invariant on `closed` that issue #559 wanted ("terminal, never reopens automatically") while still solving the soft-close use case.

### 6.4 Component map

```
                    ┌─ Eugenia LLM ─────────┐
                    │                       │
                    │  3-strike rule        │
                    │       │               │
                    │       ▼               │
                    │  encerrar_atendimento │  agno-api tool (NEW)
                    │       │               │
                    └───────┼───────────────┘
                            │ HTTP POST
                            ▼
            ┌─ Omni ────────────────────────────────────────────┐
            │                                                   │
            │  POST /messages/send/close-contact (NEW)          │
            │       │                                           │
            │       ├─► plugin gupshup                          │
            │       │     └─► sendCloseContact (NEW)            │
            │       │           └─► client.send                 │
            │       │                 { type: 'CLOSE_CONTACT',  │
            │       │                   text, ... }             │
            │       │                                           │
            │       ├─► services.chats.update                   │
            │       │     ({ closed?, closeUntil?,              │
            │       │        agentPaused: true,                 │
            │       │        closeOutcome })                    │
            │       │           │                               │
            │       │           ▼                               │
            │       │     event 'chat.closed' (NEW)             │
            │       │           │                               │
            │       │           ▼                               │
            │       │     follow-up-hooks (subscriber, NEW)     │
            │       │           └─► disarm('contact_closed')    │
            │       │                                           │
            │       └─► INSERT close_contact_logs (NEW table)   │
            │                                                   │
            │  agent-dispatcher (EXTENDED)                      │
            │       │                                           │
            │       ├─ if closed === true → refuse              │
            │       ├─ if closeUntil > now → refuse             │
            │       ├─ if closeUntil <= now → flip & continue   │
            │       └─ existing agentPaused logic               │
            │                                                   │
            │  POST /chats/:id/reopen-contact (NEW, ops only)   │
            │       └─ clears closed/closeUntil/agentPaused     │
            └───────────────────────────────────────────────────┘
                            │ msg_type: CLOSE_CONTACT
                            ▼
            ┌─ Gupshup Journey ─────────────────────────────────┐
            │  if msg_type === 'CLOSE_CONTACT' → empty terminal │
            │  next inbound → re-enters Welcome Journey         │
            └───────────────────────────────────────────────────┘
```

## 7. Detailed component breakdown

### 7.1 Type extensions

**`packages/channel-gupshup/src/types.ts`**
- Add `'CLOSE_CONTACT'` to the `GupshupMsgType` union.
- Extend the outgoing payload schema with optional fields: `close_reason?: string`, `close_outcome?: string`, `close_fields?: Record<string, unknown>`.

**`packages/channel-sdk/src/types.ts`**
- Add `canCloseContact?: boolean` to `ChannelCapabilities`.

**`packages/core/src/events/types.ts`**
- Extend `FollowUpDisarmReason` with `'contact_closed'`.
- Add `ChatClosedPayload`:
  ```ts
  export interface ChatClosedPayload {
    chatId: string;          // DB UUID
    instanceId: string;
    agentId: string | null;
    outcome: CloseContactOutcome;
    reason: string | null;
    escalated: boolean;
    closedFields: Record<string, unknown> | null;
    closedAt: string;        // ISO
  }
  export type CloseContactOutcome =
    | 'won' | 'lost' | 'redirected_sac' | 'unqualified' | 'no_response' | 'other';
  ```
- Add the discriminator `'chat.closed'` event name to the event registry.

**`packages/core/src/schemas/follow-up.ts`**
- Sync `DisarmReasonSchema` zod enum with the union above.
- Add migration if persisted (verify — likely is).

### 7.2 Sender

**`packages/channel-gupshup/src/senders/close-contact.ts`** (new)

```ts
export async function sendCloseContact(
  client: GupshupClient,
  to: string,
  text: string,
  closeReason?: string,
  closeOutcome?: string,
  closeFields?: Record<string, unknown>,
): Promise<GupshupSendResponse> {
  return client.send(to, {
    type: 'CLOSE_CONTACT',
    text,
    close_reason: closeReason,
    close_outcome: closeOutcome,
    close_fields: closeFields,
  });
}
```

Payload shape mirrors `handoff.ts` for consistency.

### 7.3 Plugin dispatch branch

**`packages/channel-gupshup/src/plugin.ts`**

Add a branch parallel to the existing `meta?.isHandoff === true` check:

```ts
if (meta?.isCloseContact === true) {
  const closeReason = meta.closeReason as string | undefined;
  const closeOutcome = meta.closeOutcome as string | undefined;
  const closeFields = meta.closeFields as Record<string, unknown> | undefined;
  return sendCloseContact(client, dest, content.text ?? '', closeReason, closeOutcome, closeFields);
}
```

### 7.4 Capability flag

**`packages/channel-gupshup/src/capabilities.ts`**
- Set `canCloseContact: true`.

Other channels default to `canCloseContact: false`. The HTTP endpoint guards on this capability.

### 7.5 HTTP endpoint

**`packages/api/src/routes/v2/messages.ts`** — append a new route mirroring `/send/handoff`.

Schema (Zod):

```ts
const sendCloseContactSchema = z.object({
  instanceId: z.string().uuid(),
  chatId: z.string().min(1),         // DB UUID of the chat
  to: z.string().min(1),             // recipient JID/phone
  text: z.string().min(1),           // farewell message
  outcome: z.enum([
    'won', 'lost', 'redirected_sac',
    'unqualified', 'no_response', 'other',
  ]),
  reason: z.string().optional(),     // free-text rationale
  closeFields: z.record(z.unknown()).optional(), // structured payload (BI/Gupshup)
});
```

Handler logic (pseudo):

```ts
messagesRoutes.post('/send/close-contact', zValidator('json', sendCloseContactSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');
  const db = c.get('db');
  const channelRegistry = c.get('channelRegistry');
  checkInstanceAccess(c.get('apiKey'), data.instanceId);

  const instance = await services.instances.getById(data.instanceId);
  const plugin = channelRegistry?.get(instance.channel);

  // Capability gate
  if (!plugin?.capabilities?.canCloseContact) {
    return c.json({ error: 'close-contact not supported on this channel' }, 400);
  }

  const resolvedTo = await resolveRecipient(data.to, instance.channel, services);

  // 1. Send Gupshup CLOSE_CONTACT
  const result = await plugin.sendMessage(data.instanceId, {
    to: resolvedTo,
    content: { type: 'text', text: data.text },
    metadata: {
      isCloseContact: true,
      closeReason: data.reason,
      closeOutcome: data.outcome,
      closeFields: data.closeFields,
    },
  });
  handleSendResult(result, { /* ... */ });

  // 2. INSERT audit row (single source of truth for history)
  const inserted = await db.insert(closeContactLogs).values({
    instanceId: data.instanceId,
    chatUuid: data.chatId,
    chatId: data.to,
    toPhone: data.to,
    text: data.text,
    outcome: data.outcome,
    reason: data.reason ?? null,
    closeFields: data.closeFields ?? null,
    agentId: instance.agentId ?? null,
    externalMessageId: result.messageId ?? null,
    sentAt: new Date(),
    escalated: false,            // updated below if applicable
    metadata: { /* ... */ },
  }).returning();

  // 3. Compute terminal state
  const isHardTerminal = data.outcome === 'won' || data.outcome === 'lost';
  let escalated = false;
  let closeUntil: Date | null = null;

  if (!isHardTerminal) {
    const cfg = resolveCloseContactConfig(instance);  // per-instance
    const window = cfg.escalationWindow[data.outcome];
    const threshold = cfg.escalationThreshold[data.outcome];
    const cooldown = cfg.cooldown[data.outcome];

    const recent = await db
      .select({ count: sql<number>`count(*)` })
      .from(closeContactLogs)
      .where(and(
        eq(closeContactLogs.chatUuid, data.chatId),
        eq(closeContactLogs.outcome, data.outcome),
        gte(closeContactLogs.sentAt, new Date(Date.now() - window)),
      ));
    const recentCount = recent[0]?.count ?? 0;

    if (recentCount >= threshold) {
      escalated = true;
      // Mark this row as the escalation event
      await db.update(closeContactLogs)
        .set({ escalated: true })
        .where(eq(closeContactLogs.id, inserted[0].id));
    } else {
      closeUntil = new Date(Date.now() + cooldown);
    }
  }

  const newSettings = {
    agentPaused: true,
    closed: isHardTerminal || escalated,
    closeUntil: closeUntil?.toISOString() ?? null,
    closeOutcome: data.outcome,
  };
  await services.chats.update(data.chatId, { settings: newSettings });

  // 4. chat.closed event chain → follow-up disarm
  // (services.chats.update should emit the event; or emit explicitly here)
  await services.events.emit('chat.closed', {
    chatId: data.chatId,
    instanceId: data.instanceId,
    agentId: instance.agentId ?? null,
    outcome: data.outcome,
    reason: data.reason ?? null,
    escalated: escalated || isHardTerminal,
    closedFields: data.closeFields ?? null,
    closedAt: new Date().toISOString(),
  });

  return c.json({
    data: {
      messageId: result.messageId,
      status: 'closed',
      terminal: newSettings.closed,
      closeUntil: newSettings.closeUntil,
      escalated,
      timestamp: result.timestamp,
    },
  }, 201);
});
```

### 7.6 Audit table

**`packages/db/src/schema.ts`** — new table `close_contact_logs`:

```ts
export const closeContactLogs = pgTable('close_contact_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  instanceId: uuid('instance_id').notNull().references(() => instances.id),
  chatUuid: uuid('chat_uuid').notNull(),         // Omni internal chat UUID
  chatId: text('chat_id').notNull(),             // raw JID/phone on the channel
  toPhone: text('to_phone').notNull(),
  text: text('text').notNull(),
  outcome: text('outcome').notNull(),            // CloseContactOutcome value
  reason: text('reason'),
  closeFields: jsonb('close_fields'),
  agentId: uuid('agent_id'),
  externalMessageId: text('external_message_id'),
  escalated: boolean('escalated').notNull().default(false),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata'),
});
```

Indexes:
- `(chat_uuid, outcome, sent_at DESC)` — for the recent-count query in step 3.
- `(instance_id, sent_at DESC)` — for BI queries.

### 7.7 Follow-up hook subscriber

**`packages/api/src/plugins/follow-up-hooks.ts`** — append a fourth subscriber:

```ts
await eventBus.subscribe(
  'chat.closed',
  async (event) => {
    const payload = event.payload as ChatClosedPayload;
    await services.followUpLifecycle.disarm({
      chatId: payload.chatId,
      instanceId: payload.instanceId,
      agentId: payload.agentId,
      reason: 'contact_closed',
    });
  },
  {
    durable: 'follow-up-hooks-closed',
    queue: 'follow-up-hooks',
    maxRetries: 2,
    retryDelayMs: 500,
    startFrom: 'new',
  },
);
```

Update the log line at the end of `setupFollowUpHooks` to include `chat.closed`.

### 7.8 Dispatcher gate extension

**`packages/api/src/plugins/agent-dispatcher.ts`** — extend the existing handoff gate at line 2601-2611. Inserted **before** the `agentPaused` check:

```ts
const chatRecord = await services.chats.findByExternalIdSmart(instance.id, chatId);
const chatSettings = chatRecord?.settings as {
  agentPaused?: boolean;
  agentResumedAt?: string;
  closed?: boolean;
  closeUntil?: string;
  closeOutcome?: string;
} | null;

// 1. Hard terminal — refuse always
if (chatSettings?.closed === true) {
  log.debug('Chat closed (terminal), skipping dispatch', {
    instanceId: instance.id,
    chatId,
    outcome: chatSettings.closeOutcome,
  });
  ackHandle.remove();
  return;
}

// 2. Soft cooldown — refuse while active, passively reopen on expiry
if (chatSettings?.closeUntil) {
  const closeUntilMs = new Date(chatSettings.closeUntil).getTime();
  if (Date.now() < closeUntilMs) {
    log.debug('Chat in close cooldown, skipping dispatch', {
      instanceId: instance.id,
      chatId,
      closeUntil: chatSettings.closeUntil,
      outcome: chatSettings.closeOutcome,
    });
    ackHandle.remove();
    return;
  }
  // Cooldown expired — flip state in one transaction and proceed.
  await services.chats.update(chatRecord!.id, {
    settings: {
      agentPaused: false,
      closeUntil: null,
      agentResumedAt: new Date().toISOString(),
    },
  });
  log.info('Close cooldown expired, agent reopened', {
    instanceId: instance.id,
    chatId,
    closeOutcome: chatSettings.closeOutcome,
  });
  // Fall through to dispatch normally.
}

// 3. Existing handoff/pause gate — unchanged
const isAgentPaused = chatSettings?.agentPaused === true;
if (isAgentPaused) { /* existing skip logic */ }

// 4. Existing pre-resume drop logic — unchanged
if (chatSettings?.agentResumedAt) { /* existing */ }
```

This is the **only** code path that mutates state on cooldown expiry. Single-writer principle preserved (the dispatcher is also the only reader that cares about the cooldown).

### 7.9 Manual reopen endpoint

**`packages/api/src/routes/v2/chats.ts`** — append:

```ts
chatsRoutes.post('/:id/reopen-contact', async (c) => {
  const services = c.get('services');
  const apiKey = c.get('apiKey');
  // Ops-only: require admin scope or escalated permission
  if (!apiKey?.scopes?.includes('chats:admin')) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const id = c.req.param('id');
  const chat = await services.chats.getById(id);
  if (!chat) return c.json({ error: 'not found' }, 404);

  await services.chats.update(id, {
    settings: {
      agentPaused: false,
      closed: false,
      closeUntil: null,
      closeOutcome: null,
      agentResumedAt: new Date().toISOString(),
    },
  });

  // Emit telemetry — important: this is a manual override, not a regular flow
  await services.events.emit('chat.reopened_manual', {
    chatId: id,
    instanceId: chat.instanceId,
    operatorApiKeyId: apiKey.id,
    at: new Date().toISOString(),
  });

  return c.json({ data: { reopened: true } });
});
```

Why a separate endpoint and not a generic settings PATCH: makes the operator action discoverable in audit logs and gives us a clear telemetry point ("how often does ops manually undo a close?").

### 7.10 CLI verb

**`apps/cli/...`** — add `omni close-contact` verb. Wraps the HTTP endpoint. Required flags: `--instance`, `--chat`, `--to`, `--text`, `--outcome`. Optional: `--reason`, `--close-fields` (JSON file path).

### 7.11 Tool agno-api

**`apps/agno-api/src/agno_api/tools/hapvida/encerrar_atendimento.py`** (new, in `genie-hv-eugenia` repo).

```python
from typing import Any, Literal
import httpx
from agno.tools import tool
from agno_api.config import settings

CloseOutcome = Literal[
    "won", "lost", "redirected_sac",
    "unqualified", "no_response", "other",
]

@tool
def encerrar_atendimento(
    text: str,
    outcome: CloseOutcome,
    reason: str = "",
    close_fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Close the conversation cleanly without escalating to a human.

    Use cases:
      - outcome='redirected_sac' : already-customer needing SAC; soft close, 24h cooldown.
      - outcome='unqualified'    : lead refused 3 strikes; soft close, 7d cooldown.
      - outcome='won'            : Eugenia closed the sale; hard terminal.
      - outcome='lost'           : lead explicitly disengaged; hard terminal.
      - outcome='no_response'    : cadence exhausted; soft close, 48h cooldown.
      - outcome='other'          : catch-all; soft close, 24h cooldown.

    Params:
        text: farewell message shown to the lead (sent to Gupshup).
        outcome: close outcome — drives cooldown/escalation/terminal logic on Omni.
        reason: free-text rationale for audit log.
        close_fields: structured payload for BI/CRM.

    Returns:
        {
            "messageId": str,
            "status": "closed",
            "terminal": bool,
            "closeUntil": str | None,
            "escalated": bool,
        }
    """
    cfg = settings()
    if cfg.close_contact_dry_run:
        return {
            "dry_run": True,
            "outcome": outcome,
            "text": text,
            "reason": reason,
            "close_fields": close_fields,
        }

    payload = {
        "instanceId": cfg.omni_instance_id,
        "chatId": cfg.current_chat_uuid,   # injected by agent runtime
        "to": cfg.current_recipient_jid,
        "text": text,
        "outcome": outcome,
        "reason": reason or None,
        "closeFields": close_fields,
    }
    response = httpx.post(
        f"{cfg.omni_base_url}/messages/send/close-contact",
        headers={"Authorization": f"Bearer {cfg.omni_api_key}"},
        json={k: v for k, v in payload.items() if v is not None},
        timeout=15.0,
    )
    response.raise_for_status()
    return response.json()["data"]
```

Notes:
- Does NOT use `omni send` CLI subprocess (cleaner than `handoff_humano`).
- `CLOSE_CONTACT_DRY_RUN=1` short-circuits for QA fixture.
- Required runtime injections: `current_chat_uuid`, `current_recipient_jid`. Verify that agno-api currently injects these (handoff_humano gets phone from Omni chat scan — for close we want the actual chat UUID, which agno-api should already have in context).

### 7.12 QA scenario

**`apps/qa-system/scenarios/regression-005-cliente-atual-sac.yaml`** (new):

```yaml
id: regression-005-cliente-atual-sac
priority: critical
category: regression-bugfix
title: "Cliente atual buscando SAC dispara close-contact (não handoff)"
description: |
  Lead diz que já é cliente Hapvida e tem dúvida sobre o plano que possui.
  Eugenia deve reforçar 3x antes de encerrar com close_contact + outcome=redirected_sac.
  Após o close, follow-up DEVE estar disarmado.
persona:
  mode: scripted
  turns:
    - text: "Oi, sou cliente Hapvida e queria tirar uma dúvida sobre meu plano"
    - text: "É sobre uma autorização que negaram"
    - text: "Não, não quero cotar plano novo, só preciso resolver isso"
    - text: "Já falei, não é cotação. Preciso de SAC."
deterministic_assertions:
  - name: redirects_to_sac
    rule: response mentions 0800 280 9130 OR "central de atendimento"
  - name: three_reinforcements
    rule: agent reinforces sac path on turns 1, 2, and 3
  - name: close_tool_called
    rule: encerrar_atendimento called with outcome=redirected_sac
  - name: follow_up_disarmed
    rule: follow_up.disarmed event emitted with reason=contact_closed
  - name: not_handoff
    rule: handoff_humano NOT called
non_conformity_checks:
  - NC-9  # forbidden 0800 redirect via text-only (now allowed via tool)
pass_criteria:
  min_score: 9
  deterministic_must_pass: all
```

Add a sibling scenario `regression-006-eugenia-close-da-venda.yaml` for the `outcome=won` path once Eugenia's sale-close flow exists.

## 8. Concrete defaults (cooldown / escalation)

| outcome | cooldown | escalation_threshold | escalation_window | rationale |
|---|---|---|---|---|
| `won` | terminal | n/a | n/a | sale done — pos-sale is a different journey |
| `lost` | terminal | n/a | n/a | explicit refusal — respect lead boundaries |
| `redirected_sac` | 24h | 2 | 7 days | first SAC ask = soft; 2nd within a week = customer is consistently not a sales target |
| `unqualified` | 7 days | 3 | 30 days | aligned with `follow-up-multi-sessao.md` "max 3 follow-ups" |
| `no_response` | 48h | 3 | 30 days | analogous to unqualified but shorter cooldown — silence is often temporary |
| `other` | 24h | 2 | 14 days | conservative default |

Configurable per-instance via `instance.settings.closeContactConfig`. Hardcoded fallback in code matches the table above.

### 8.1 Loop-bounding proof

For the `redirected_sac` worst case:

| t | event | recent_count | escalated? | terminal? |
|---|---|---|---|---|
| 0 | close #1 | 1 | no | no (cooldown 24h) |
| 25h | inbound, dispatcher reopens | — | — | — |
| 25h+ε | close #2 (same outcome, same week) | 2 | **yes** (≥ threshold 2) | **yes** |

Maximum **2** close events for the same chat with the same soft outcome within the escalation window. After that, hard terminal. Loop bounded.

For `unqualified`: maximum 3 closes in 30 days. For `no_response`: maximum 3 in 30 days. Each is bounded.

### 8.2 Escalation reset

There is no explicit "counter reset". The query is windowed (`sentAt > now - window`), so events outside the window are not counted. A lead who had `redirected_sac` 8 months ago and gets `redirected_sac` today shows `recent_count = 1` — back to first soft close. This is correct behavior.

## 9. Use case mapping

| Real scenario | Eugenia action | tool call | resulting state |
|---|---|---|---|
| Cliente atual asks SAC | 3× reinforce → call tool | `encerrar_atendimento(outcome='redirected_sac', text='...0800...')` | COOLDOWN 24h |
| Cliente atual returns next day asking again about SAC | dispatcher reopens after 24h, Eugenia engages, 3× reinforce, call tool | same | escalation → CLOSED |
| Cliente atual returns next day asking about a NEW plan for spouse | dispatcher reopens after 24h, Eugenia engages, normal sales flow | none (new lead path) | ACTIVE (lead row) |
| Lead refuses 3× ("não quero cotar agora") | call tool | `encerrar_atendimento(outcome='unqualified', ...)` | COOLDOWN 7d |
| Lead returns 8d later asking for prices | dispatcher reopens, Eugenia engages | none | ACTIVE |
| Lead refuses 3× again, 3rd time within 30d | call tool | same | escalation → CLOSED |
| Eugenia closes a sale (future flow) | call tool | `encerrar_atendimento(outcome='won', ...)` | CLOSED (terminal) |
| Lead says "não me manda mais mensagem" | call tool | `encerrar_atendimento(outcome='lost', ...)` | CLOSED (terminal) |
| Cadence exhausted, no inbound for 14d | scheduler-triggered call | `encerrar_atendimento(outcome='no_response', ...)` | COOLDOWN 48h |

The `won` path requires Eugenia to have a "close the sale herself" flow first; that's blocked by other work. For now, only `won` from automated agents is rare; humans handle most closes via `handoff_humano`. Tool will accept `won` for forward compatibility.

## 10. Eugenia-side changes (Aragão's scope)

Out of this design's deliverables but documented for coordination:

1. **3-strike rule in `eugenia-seller`**:
   - When intent classified as "cliente atual SAC", reinforce path to SAC up to 2 times.
   - On 3rd insistent contact, call `encerrar_atendimento(outcome='redirected_sac', text=<friendly farewell + 0800>, reason='lead já é cliente — solicitou SAC 3x')`.
   - Include the SAC number `0800 280 9130` (or instance-configured) in the farewell text.

2. **3-refusal rule for non-customer leads**:
   - On 3 explicit refusals within the same session, call `encerrar_atendimento(outcome='unqualified', text=<friendly out>, reason='lead recusou cotação 3x')`.

3. **New KB doc**: `knowledge-base/contexto-relevante/etapas/08-encerramento-sem-handoff.md`:
   - When to call `encerrar_atendimento` vs `handoff_humano`.
   - Outcome decision tree.
   - Examples per outcome.

4. **Update `compliance.md`**:
   - Existing rule "NUNCA sugira o 0800" gets a carve-out: "exceto via tool `encerrar_atendimento(outcome='redirected_sac')` para clientes atuais identificados".

5. **Update `follow-up-multi-sessao.md`**:
   - Add: "leads com `closeOutcome != null` ficam fora da cadência de follow-up até o cooldown expirar; leads com `closed: true` nunca entram na cadência."

6. **Update `07-handoff-humano.md`**:
   - Add cross-reference to `08-encerramento-sem-handoff.md`.
   - Clarify: handoff = pause for human; close = terminal close (no human).

## 11. Gupshup-side changes (Henrique/Igor scope)

Out of this design but coordinated:

1. **Journey new node**: branch on `msg_type === 'CLOSE_CONTACT'`. Empty terminal node — no outbound, no chat-fields update, no template.
2. **Welcome Journey**: no change. Existing re-entry works.
3. **No "tag de encerramento"**: stays on human-agent side only.
4. **Verification**: Gupshup confirms in homolog that `CLOSE_CONTACT` reaches the new node and that re-entry works.

## 12. Implementation phases

### Phase 0 — Pre-call confirmation (DONE before 17h call)
- Investigation report (this document section 3 + 4).
- Question list for Gupshup partner.

### Phase 1 — Omni backend (target: homolog same day or D+1)
1. Schema additions (types, capabilities, disarm reason, event types).
2. Migration: `close_contact_logs` table.
3. Sender + plugin branch.
4. Endpoint `POST /messages/send/close-contact`.
5. Endpoint `POST /chats/:id/reopen-contact`.
6. Follow-up hook subscriber for `chat.closed`.
7. Dispatcher gate extension.
8. Unit tests (sender, lifecycle, hook, dispatcher gate).
9. Integration test: end-to-end close → disarm → cooldown expiry → reopen.
10. CLI verb.

PR target: `automagik-dev/omni#559`. Comment on issue with link to this design and explanation of the divergence (escalation rule + cooldown).

### Phase 2 — Tool agno-api (parallel to Phase 1, target: D+1)
1. `encerrar_atendimento.py` with httpx client.
2. `CLOSE_CONTACT_DRY_RUN` env var.
3. Unit tests mirroring `test_tools_hapvida.py`.
4. Wire-up of `current_chat_uuid` / `current_recipient_jid` runtime injection (verify availability).

### Phase 3 — Eugenia prompts (Aragão, parallel)
- See section 10. Aragão drops in once the tool is registered in agno-api.

### Phase 4 — Gupshup Journey (Henrique, parallel)
- See section 11.

### Phase 5 — QA and validation (after Phase 1 + 2 + 4 land)
1. Run `regression-005-cliente-atual-sac.yaml` end-to-end on homolog.
2. Manual verification of escalation: send the same outcome twice within window, assert second one becomes terminal.
3. Manual verification of cooldown expiry: close → wait → inbound → confirm dispatcher reopens.
4. Verify `/chats/:id/reopen-contact` clears all close fields.

### Phase 6 — Production rollout
1. Feature-flag the dispatcher gate behind `instance.settings.closeContactEnabled` for safe canary.
2. Enable on Hapvida instance first (single instance with the use case).
3. Monitor `close_contact_logs` for 7 days. Watch escalation rate, false positives.
4. Tune defaults if needed.

## 13. Test plan

### Unit
- `senders/close-contact.test.ts` — payload shape correctness.
- `automations/follow-up/lifecycle.test.ts` — extend with `'contact_closed'` reason; assert disarm idempotency.
- `routes/v2/messages.test.ts` — extend with `/send/close-contact` cases:
  - happy path soft close → `closeUntil` set, `closed: false`.
  - happy path hard close (`won`) → `closed: true`, `closeUntil: null`.
  - escalation: 2 `redirected_sac` within 7d → second becomes terminal.
  - escalation reset: 2 `redirected_sac` 10d apart → second still soft.
  - capability gate: non-Gupshup instance → 400.
- `plugins/agent-dispatcher.test.ts` — extend with:
  - `closed: true` → skip permanently.
  - `closeUntil` in future → skip.
  - `closeUntil` in past → flip state and proceed.
- `plugins/follow-up-hooks.test.ts` — `chat.closed` → disarm called with `'contact_closed'`.
- `tools/test_encerrar_atendimento.py` — happy path + dry-run + HTTP error handling.

### Integration
- `e2e/close-contact.test.ts` — full chain: HTTP call → Gupshup mock receives `CLOSE_CONTACT` → DB row exists → event emitted → follow-up disarmed → next inbound respects state.

### Regression / QA-system
- `regression-005-cliente-atual-sac.yaml` (above).
- `regression-006-eugenia-close-da-venda.yaml` (deferred until close-da-venda flow exists).
- `regression-007-close-contact-escalation.yaml` (asserts 2× SAC → terminal).
- `regression-008-close-contact-cooldown-expiry.yaml` (asserts reopen after cooldown).

### Manual QA on homolog
1. Send "sou cliente Hapvida, quero falar sobre meu plano" → expect 3 reinforcements → tool fires → check `close_contact_logs` row → check chat settings show `closeUntil` ≈ now+24h.
2. Wait 25h → send any inbound → check Eugenia responds normally.
3. Repeat scenario 1 within 7 days → check escalation → check `closed: true` → next inbound → no Eugenia response.
4. Manual reopen via `POST /chats/:id/reopen-contact` → next inbound → Eugenia responds.

## 14. Migration / rollback

### Migration
- Drizzle migration adds `close_contact_logs` table + extends enum types.
- Migration is forward-only; no data backfill needed (no historical close events to preserve).
- Existing chats keep `chat.settings` shape; new fields are optional and absent on legacy rows.

### Rollback
- Disable feature flag `closeContactEnabled` on instance settings → endpoint returns 503; tool surfaces "feature unavailable" to Eugenia → falls back to handoff_humano.
- Drop the new dispatcher gate code paths via revert (compile-time decision; no runtime toggle needed because absence of `closed`/`closeUntil` fields is the same as `false`/`null` — gate is a no-op).
- `close_contact_logs` table can stay; doesn't affect anything if unused.

### Compatibility
- No change to existing handoff endpoint, tool, or table.
- Old clients that don't know about `closed` field continue to work — they just miss the new gate (degrade to current behaviour).

## 15. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | LLM hallucinates and calls `encerrar_atendimento` with wrong outcome (`won` when it should be `redirected_sac`) | medium | high (lead locked out permanently) | (a) `won`/`lost` require explicit assertion in prompt; (b) ops `/reopen-contact` escape hatch; (c) telemetry alert on `won`-rate-per-day spike. |
| R2 | Two concurrent calls to `/close-contact` for same chat (race) | low | low | INSERT is atomic; `services.chats.update` is last-write-wins; flag converges; idempotent disarm. |
| R3 | Cooldown expiry races with another close fire (same chat) | low | medium | Dispatcher does state mutation in transaction; recent-count query reads from logs; even if flag is stale, escalation count is right. |
| R4 | `close_contact_logs` recent-count query hot-path under load | low | medium | Index on `(chat_uuid, outcome, sent_at DESC)` makes it O(log n); query is per-close (low frequency). |
| R5 | Welcome Journey routes returning lead back to Eugenia during cooldown → user gets nothing | medium | medium | Document as expected; Gupshup team can later add a soft template "retorno em breve" on returning-during-cooldown if desired. Out of v1. |
| R6 | Escalation defaults wrong for Hapvida (too aggressive / too soft) | medium | low | Per-instance config override; first 7 days post-launch, monitor close_contact_logs and tune. |
| R7 | Tool runs but HTTP call fails (Omni down) | low | high (Eugenia thinks closed but state isn't set) | Tool returns error; Eugenia falls back to a generic "tive um probleminha" message and exits gracefully. Audit log in agno-api. |
| R8 | Manual reopen leaks state (closed cleared but `closeOutcome` stays) | low | low | Reopen endpoint clears all five fields atomically. |
| R9 | Issue #559 author objects to the divergence (closed-conditional + escalation) | medium | low | Comment on PR with rationale; if rejected, fall back to "always closed: true" + add `/reopen-contact` for soft-outcomes (slightly worse UX, still works). |
| R10 | New `'contact_closed'` disarm reason breaks downstream BI consumers | low | medium | Coordinate with BI team; the column is text and existing dashboards should treat unknown values gracefully. |

## 16. Open items requiring user decision

(Already approved as of 2026-04-29 by Pedro)

- [x] Outcome enum: `won | lost | unqualified | no_response | redirected_sac | other`. Approved.
- [x] Solution shape: outcome-conditional `closed` flag + escalation via `close_contact_logs` query. Approved.
- [x] Cooldown defaults from section 8. Approved with placeholder "tunable post-launch".
- [x] Tool uses HTTP, not `omni send` CLI. Approved.
- [x] Manual reopen endpoint included. Approved.
- [ ] PR ownership: Pedro takes #559 directly. Approved (defaulted).
- [ ] Eugenia prompt timing — Aragão starts after tool registered in agno-api. Approved (defaulted).

## 17. Issue #559 alignment statement

This design implements **all acceptance criteria of issue #559**:

| #559 acceptance criterion | Design coverage |
|---|---|
| `POST /messages/send/close-contact` exists and OpenAPI-documented | §7.5 |
| Gupshup payload sent with `msg_type: 'CLOSE_CONTACT'` and close-* fields | §7.2, §7.3 |
| Agent dispatcher refuses runs on closed chats | §7.8 |
| Follow-up lifecycle disarms with new reason | §7.7 (reason renamed `contact_closed`) |
| `close_contact_logs` populated with outcome + structured fields | §7.6 |
| Channel-agnostic side effects | §7.4 (capability flag) |
| CLI verb `omni close-contact ...` | §7.10 |

**Divergence from #559 — explicit and justified:**

1. **Disarm reason renamed** from `'closed'` to `'contact_closed'` (singular, distinct from the `closed` flag) to avoid name collision in code review and logs.
2. **`closed` flag is outcome-conditional**, not always-true. Set on `won`/`lost` (terminal) or via auto-escalation; left `false` on first soft close.
3. **`closeUntil` cooldown timestamp** added to support soft closes that reopen passively. Not in #559.
4. **Auto-escalation rule** based on `close_contact_logs` history. Not in #559.
5. **`/chats/:id/reopen-contact` endpoint** added as ops escape hatch. Not in #559.

The divergence is necessary because #559 alone allows infinite-loop scenarios for the cliente-atual-SAC case (the original meeting trigger): every redirect is terminal in #559, so a returning customer who legitimately wants a new plan is permanently blocked. The cooldown + escalation hybrid solves this without weakening the "terminal" semantics of `closed`.

## 18. Coordination & timeline

| Day | Pedro (Omni + tool) | Aragão (Eugenia) | Henrique (Gupshup) |
|---|---|---|---|
| D0 (today) | Phase 0 ✓ + start Phase 1 | start prompt updates | Journey node mockup |
| D+1 | finish Phase 1 + Phase 2 | finish prompts in homolog | Journey node in homolog |
| D+2 | Phase 5 QA on homolog | review QA results | verify Journey routing |
| D+3-7 | monitor + tune | iterate prompts | — |
| D+7 | promote to prod | promote prompts | promote Journey |

## 19. Appendix — Code references (Omni repo)

| Topic | File | Lines |
|---|---|---|
| Existing handoff route | `packages/api/src/routes/v2/messages.ts` | 1455-1537 |
| Existing handoff sender | `packages/channel-gupshup/src/senders/handoff.ts` | 1-22 |
| Existing handoff plugin branch | `packages/channel-gupshup/src/plugin.ts` | 43-50 |
| Existing follow-up hooks | `packages/api/src/plugins/follow-up-hooks.ts` | 1-171 |
| Existing follow-up lifecycle | `packages/core/src/automations/follow-up/lifecycle.ts` | (full) |
| Existing dispatcher gate | `packages/api/src/plugins/agent-dispatcher.ts` | 2601-2627 |
| Existing session-cleaner reopen | `packages/api/src/plugins/session-cleaner.ts` | 169-175 |
| FollowUpDisarmReason union | `packages/core/src/events/types.ts` | 670 |
| handoff_humano tool (legacy CLI subprocess) | `apps/agno-api/src/agno_api/tools/hapvida/handoff_humano.py` | (full) |
| Eugenia handoff KB | `genie-hv-eugenia/.genie/agents/eugenia-seller/knowledge-base/contexto-relevante/etapas/07-handoff-humano.md` | (full) |
| Eugenia follow-up methodology | `genie-hv-eugenia/.genie/agents/eugenia-seller/knowledge-base/contexto-relevante/metodologia/follow-up-multi-sessao.md` | (full) |
| Eugenia compliance rules | `genie-hv-eugenia/.genie/agents/eugenia-seller/.claude/rules/compliance.md` | (search "0800") |

## 20. Glossary

- **Handoff** — pause Eugenia, transfer to human attendant. Existing.
- **Close-contact** — terminate Eugenia conversation. New (this design).
- **Hard terminal** — `closed: true`. Permanent until manual ops reopen.
- **Soft close** — `closeUntil` set, `closed: false`. Auto-reopens on inbound after cooldown.
- **Escalation** — automatic promotion of soft → hard when count ≥ threshold within window.
- **Cooldown** — duration after a soft close during which inbound is silently dropped.
- **`contact_closed`** — disarm reason for follow-up lifecycle (separate name from the `closed` flag).
- **Welcome Journey** — Gupshup-side entry routing journey; re-entered by returning leads.

---

**Status:** awaiting Pedro's final approval before writing-plans skill is invoked to translate this into an executable implementation plan with task-level breakdown and review checkpoints.
