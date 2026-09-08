/**
 * HarnessChannelPlugin unit tests
 *
 * Verifies verbatim outbound capture (buttons/lists/metadata survive intact),
 * capability-profile enforcement in sendMessage(), say/tap inbound emission,
 * and transcript mechanics (ordering, per-chat isolation, reset, bounds).
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { OutgoingMessage, PluginContext } from '@omni/channel-sdk';
import { OmniError } from '@omni/core';
import { HarnessChannelPlugin } from '../plugin';
import type { HarnessOutboundEntry } from '../types';

// ─── Mock context (channel-internal precedent) ────────────────

function createMockLogger() {
  const logger = {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(function (this: unknown) {
      return logger;
    }),
  };
  return logger;
}

function createMockEventBus() {
  const calls: Array<{ type: string; payload: Record<string, unknown>; metadata: unknown }> = [];
  return {
    calls,
    connect: mock(async () => {}),
    publish: mock(async (type: string, payload: Record<string, unknown>, metadata: unknown) => {
      calls.push({ type, payload, metadata });
      return { seq: 1 };
    }),
    publishGeneric: mock(async () => ({ seq: 1 })),
    subscribe: mock(async () => ({ unsubscribe: async () => {} })),
    subscribePattern: mock(async () => ({ unsubscribe: async () => {} })),
    subscribeMany: mock(async () => ({ unsubscribe: async () => {} })),
    subscribeAll: mock(async () => ({ unsubscribe: async () => {} })),
    unsubscribe: mock(async () => {}),
    drain: mock(async () => {}),
  };
}

function createMockContext(eventBus = createMockEventBus()): PluginContext {
  return {
    eventBus: eventBus as unknown as PluginContext['eventBus'],
    logger: createMockLogger() as unknown as PluginContext['logger'],
    storage: {
      get: mock(async () => null),
      set: mock(async () => {}),
      delete: mock(async () => true),
      has: mock(async () => false),
      keys: mock(async () => []),
    },
    config: {
      env: 'development',
      apiBaseUrl: 'http://localhost:3000',
      webhookBaseUrl: 'http://localhost:3000',
      mediaStorage: { type: 'local', basePath: '/tmp' },
    },
    db: {
      execute: mock(async () => []),
      getDrizzle: mock(() => null),
    },
  };
}

const INSTANCE = 'harness-inst-1';
const CHAT = 'case-42';

function buttonsMessage(overrides: Partial<OutgoingMessage> = {}): OutgoingMessage {
  return {
    to: CHAT,
    content: {
      type: 'text',
      text: 'Escolha o profissional:',
      buttons: [
        { text: 'Rogerio', data: 'prof-1' },
        { text: 'Aneli', data: 'prof-2' },
      ],
    },
    metadata: { isHandoff: false, partIndex: 0, partCount: 1 },
    ...overrides,
  };
}

describe('HarnessChannelPlugin', () => {
  let plugin: HarnessChannelPlugin;
  let eventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(async () => {
    plugin = new HarnessChannelPlugin();
    eventBus = createMockEventBus();
    await plugin.initialize(createMockContext(eventBus));
  });

  // ─── Verbatim capture ───────────────────────────────────────

  it('captures the full OutgoingMessage verbatim, buttons and metadata included', async () => {
    const message = buttonsMessage();
    const result = await plugin.sendMessage(INSTANCE, message);

    expect(result.success).toBe(true);
    const transcript = plugin.getTranscript(INSTANCE, CHAT);
    expect(transcript.entries).toHaveLength(1);
    const entry = transcript.entries[0] as HarnessOutboundEntry;
    expect(entry.direction).toBe('outbound');
    expect(entry.message).toEqual(message);
    expect(entry.message.content.buttons?.map((b) => b.text)).toEqual(['Rogerio', 'Aneli']);
    expect(entry.message.metadata?.partCount).toBe(1);
    expect(entry.violations).toEqual([]);
  });

  it('captured entry is immune to later mutation of the caller message', async () => {
    const message = buttonsMessage();
    await plugin.sendMessage(INSTANCE, message);
    message.content.text = 'MUTATED';
    message.content.buttons?.pop();

    const entry = plugin.getTranscript(INSTANCE, CHAT).entries[0] as HarnessOutboundEntry;
    expect(entry.message.content.text).toBe('Escolha o profissional:');
    expect(entry.message.content.buttons).toHaveLength(2);
  });

  it('emits message.sent with the verbatim send in rawPayload', async () => {
    await plugin.sendMessage(INSTANCE, buttonsMessage());
    const sent = eventBus.calls.find((c) => c.type === 'message.sent');
    expect(sent).toBeDefined();
    const rawPayload = sent?.payload.rawPayload as { harness: boolean; outgoing: OutgoingMessage };
    expect(rawPayload.harness).toBe(true);
    expect(rawPayload.outgoing.content.buttons).toHaveLength(2);
  });

  // ─── Capability profile ─────────────────────────────────────

  it('refuses buttons when the profile declares canSendButtons: false', async () => {
    await plugin.connect(INSTANCE, {
      instanceId: INSTANCE,
      credentials: {},
      options: { harnessProfile: { canSendButtons: false } },
    });

    const result = await plugin.sendMessage(INSTANCE, buttonsMessage());
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.error).toContain('buttons_not_supported');

    const entry = plugin.getTranscript(INSTANCE, CHAT).entries[0] as HarnessOutboundEntry;
    expect(entry.violations).toEqual(['buttons_not_supported']);
    // Verbatim capture happens even for refused sends.
    expect(entry.message.content.buttons).toHaveLength(2);
    expect(eventBus.calls.some((c) => c.type === 'message.failed')).toBe(true);
    expect(eventBus.calls.some((c) => c.type === 'message.sent')).toBe(false);
  });

  it('a >maxButtons component renders as a list and fails when canSendList: false (the 10-options case)', async () => {
    await plugin.connect(INSTANCE, {
      instanceId: INSTANCE,
      credentials: {},
      options: { harnessProfile: { canSendButtons: true, maxButtons: 3, canSendList: false } },
    });

    const tenOptions = buttonsMessage({
      content: {
        type: 'text',
        text: 'Escolha a clínica:',
        buttons: Array.from({ length: 10 }, (_, i) => ({ text: `Clínica ${i + 1}`, data: `cl-${i + 1}` })),
      },
    });
    const result = await plugin.sendMessage(INSTANCE, tenOptions);
    expect(result.success).toBe(false);
    expect(result.error).toContain('list_not_supported');
  });

  it('enforces maxListRows and maxMessageLength', async () => {
    await plugin.connect(INSTANCE, {
      instanceId: INSTANCE,
      credentials: {},
      options: { harnessProfile: { maxListRows: 5, maxMessageLength: 10 } },
    });

    const longList = buttonsMessage({
      content: {
        type: 'text',
        text: 'Pick:',
        buttons: Array.from({ length: 6 }, (_, i) => ({ text: `Row ${i + 1}` })),
      },
    });
    expect((await plugin.sendMessage(INSTANCE, longList)).error).toContain('list_rows_exceeded');

    const longText: OutgoingMessage = { to: CHAT, content: { type: 'text', text: 'x'.repeat(11) } };
    expect((await plugin.sendMessage(INSTANCE, longText)).error).toContain('text_too_long');
  });

  it('refuses media when canSendMedia: false', async () => {
    await plugin.connect(INSTANCE, {
      instanceId: INSTANCE,
      credentials: {},
      options: { harnessProfile: { canSendMedia: false } },
    });
    const media: OutgoingMessage = {
      to: CHAT,
      content: { type: 'image', mediaUrl: 'https://example.test/x.png', caption: 'cap' },
    };
    expect((await plugin.sendMessage(INSTANCE, media)).error).toContain('media_not_supported');
  });

  it('rejects an invalid profile at connect (strict schema)', async () => {
    await expect(
      plugin.connect(INSTANCE, {
        instanceId: INSTANCE,
        credentials: {},
        options: { harnessProfile: { canSendButtnos: true } },
      }),
    ).rejects.toThrow(OmniError);
  });

  // ─── say ────────────────────────────────────────────────────

  it('say emits message.received and records the inbound', async () => {
    const entry = await plugin.say(INSTANCE, { chatId: CHAT, text: 'quero marcar cardiologista' });
    expect(entry.direction).toBe('inbound');
    expect(entry.kind).toBe('say');
    expect(entry.seq).toBe(1);

    const received = eventBus.calls.find((c) => c.type === 'message.received');
    expect(received).toBeDefined();
    expect(received?.payload.chatId).toBe(CHAT);
    expect((received?.payload.content as { text: string }).text).toBe('quero marcar cardiologista');
  });

  // ─── tap ────────────────────────────────────────────────────

  it('tap converts the chosen option into the inbound a real tap produces', async () => {
    await plugin.say(INSTANCE, { chatId: CHAT, text: 'quero marcar' });
    await plugin.sendMessage(INSTANCE, buttonsMessage());

    const entry = await plugin.tap(INSTANCE, { chatId: CHAT, option: 2 });
    expect(entry.kind).toBe('tap');
    expect(entry.content.text).toBe('Aneli');
    expect(entry.tap).toEqual({ sourceSeq: 2, optionIndex: 2, optionId: 'prof-2', optionText: 'Aneli' });

    const received = eventBus.calls.filter((c) => c.type === 'message.received');
    expect(received).toHaveLength(2);
    expect((received[1]?.payload.content as { text: string }).text).toBe('Aneli');
    expect((received[1]?.payload.rawPayload as { kind: string }).kind).toBe('tap');
  });

  it('tap resolves string options by data then text, and targets messageSeq when given', async () => {
    await plugin.sendMessage(INSTANCE, buttonsMessage());
    await plugin.sendMessage(INSTANCE, {
      to: CHAT,
      content: { type: 'text', text: 'Confirma?', buttons: [{ text: 'Sim' }, { text: 'Não' }] },
    });

    const byData = await plugin.tap(INSTANCE, { chatId: CHAT, option: 'prof-1', messageSeq: 1 });
    expect(byData.content.text).toBe('Rogerio');

    const byText = await plugin.tap(INSTANCE, { chatId: CHAT, option: 'Não' });
    expect(byText.tap?.sourceSeq).toBe(2);
  });

  it('tap refuses when there is no component, the option is unknown, or the send was refused', async () => {
    await expect(plugin.tap(INSTANCE, { chatId: CHAT, option: 1 })).rejects.toThrow(/No rendered outbound/);

    await plugin.sendMessage(INSTANCE, buttonsMessage());
    await expect(plugin.tap(INSTANCE, { chatId: CHAT, option: 7 })).rejects.toThrow(/does not match/);

    await plugin.connect(INSTANCE, {
      instanceId: INSTANCE,
      credentials: {},
      options: { harnessProfile: { canSendButtons: false } },
    });
    await plugin.sendMessage(INSTANCE, buttonsMessage({ to: 'other-chat' }));
    // Without messageSeq, refused sends are simply not tappable…
    await expect(plugin.tap(INSTANCE, { chatId: 'other-chat', option: 1 })).rejects.toThrow(/No rendered outbound/);
    // …and targeting one explicitly says why.
    await expect(plugin.tap(INSTANCE, { chatId: 'other-chat', option: 1, messageSeq: 1 })).rejects.toThrow(
      /never rendered/,
    );
  });

  // ─── transcript mechanics ───────────────────────────────────

  it('keeps chats isolated and ordered, and reset clears one chat', async () => {
    await plugin.say(INSTANCE, { chatId: 'case-a', text: 'a1' });
    await plugin.say(INSTANCE, { chatId: 'case-b', text: 'b1' });
    await plugin.sendMessage(INSTANCE, { to: 'case-a', content: { type: 'text', text: 'reply-a' } });

    const a = plugin.getTranscript(INSTANCE, 'case-a');
    expect(a.entries.map((e) => e.direction)).toEqual(['inbound', 'outbound']);
    expect(a.entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(plugin.getTranscript(INSTANCE, 'case-b').entries).toHaveLength(1);

    plugin.resetTranscript(INSTANCE, 'case-a');
    expect(plugin.getTranscript(INSTANCE, 'case-a').entries).toHaveLength(0);
    expect(plugin.getTranscript(INSTANCE, 'case-b').entries).toHaveLength(1);
  });

  it('transcript echoes the connected profile and defaults when not connected', async () => {
    expect(plugin.getTranscript(INSTANCE, CHAT).profile.maxButtons).toBe(3);
    await plugin.connect(INSTANCE, {
      instanceId: INSTANCE,
      credentials: {},
      options: { harnessProfile: { maxButtons: 2, canSendList: false } },
    });
    const profile = plugin.getTranscript(INSTANCE, CHAT).profile;
    expect(profile.maxButtons).toBe(2);
    expect(profile.canSendList).toBe(false);
    expect(profile.canSendButtons).toBe(true);
  });

  it('bounds the per-chat transcript by dropping oldest entries and counting them', async () => {
    for (let i = 0; i < 1002; i++) {
      await plugin.sendMessage(INSTANCE, { to: CHAT, content: { type: 'text', text: `m${i}` } });
    }
    const transcript = plugin.getTranscript(INSTANCE, CHAT);
    expect(transcript.entries).toHaveLength(1000);
    expect(transcript.droppedEntries).toBe(2);
    expect(transcript.entries[0]?.seq).toBe(3);
  });
});
