/**
 * Unit tests for `omni events stream` filter predicates and formatter.
 *
 * Integration-level spawn coverage lives in cli.test.ts (stream smoke test).
 */

import { describe, expect, test } from 'bun:test';
import type { Event } from '@automagik/omni-sdk';
import { formatEventLine, isErrorEvent, isNoisyEvent, passesStreamFilters } from '../commands/events';

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    eventType: 'message.received',
    contentType: 'text',
    instanceId: '00000000-0000-0000-0000-0000000000aa',
    personId: null,
    direction: 'inbound',
    textContent: 'hello world',
    transcription: null,
    imageDescription: null,
    chatUuid: '00000000-0000-0000-0000-0000000000cc',
    agentId: null,
    conversationId: null,
    receivedAt: '2026-04-16T10:00:00.000Z',
    processedAt: null,
    ...overrides,
  };
}

describe('events stream filters', () => {
  test('passes with no filters (non-noisy)', () => {
    expect(passesStreamFilters(makeEvent(), {})).toBe(true);
  });

  test('hides noisy events by default, surfaces them with --all', () => {
    const ev = makeEvent({ eventType: 'presence.typing' });
    expect(passesStreamFilters(ev, {})).toBe(false);
    expect(passesStreamFilters(ev, { all: true })).toBe(true);
  });

  test('instance filter matches on UUID', () => {
    const ev = makeEvent({ instanceId: '00000000-0000-0000-0000-000000000111' });
    expect(passesStreamFilters(ev, { instanceId: '00000000-0000-0000-0000-000000000111' })).toBe(true);
    expect(passesStreamFilters(ev, { instanceId: '00000000-0000-0000-0000-000000000222' })).toBe(false);
  });

  test('type filter is exact match', () => {
    const ev = makeEvent({ eventType: 'message.sent' });
    expect(passesStreamFilters(ev, { type: 'message.sent' })).toBe(true);
    expect(passesStreamFilters(ev, { type: 'message.received' })).toBe(false);
  });

  test('chat-id filter matches chatUuid', () => {
    const ev = makeEvent({ chatUuid: 'chat-xyz' });
    expect(passesStreamFilters(ev, { chatId: 'chat-xyz' })).toBe(true);
    expect(passesStreamFilters(ev, { chatId: 'chat-abc' })).toBe(false);
  });

  test('person-id filter matches personId', () => {
    const ev = makeEvent({ personId: 'person-42' });
    expect(passesStreamFilters(ev, { personId: 'person-42' })).toBe(true);
    expect(passesStreamFilters(ev, { personId: 'person-99' })).toBe(false);
  });

  test('errors-only keeps failure events and drops success', () => {
    expect(passesStreamFilters(makeEvent({ eventType: 'message.failed' }), { errorsOnly: true })).toBe(true);
    expect(passesStreamFilters(makeEvent({ eventType: 'access.denied' }), { errorsOnly: true })).toBe(true);
    expect(passesStreamFilters(makeEvent({ eventType: 'message.received' }), { errorsOnly: true })).toBe(false);
  });

  test('combined filters require all to pass', () => {
    const ev = makeEvent({ eventType: 'message.sent', chatUuid: 'chat-1' });
    expect(passesStreamFilters(ev, { type: 'message.sent', chatId: 'chat-1' })).toBe(true);
    expect(passesStreamFilters(ev, { type: 'message.sent', chatId: 'chat-OTHER' })).toBe(false);
  });
});

describe('events stream classifiers', () => {
  test('isErrorEvent tags failure/denial types', () => {
    expect(isErrorEvent('message.failed')).toBe(true);
    expect(isErrorEvent('sync.failed')).toBe(true);
    expect(isErrorEvent('access.denied')).toBe(true);
    expect(isErrorEvent('media.processing.failed')).toBe(true);
    expect(isErrorEvent('message.received')).toBe(false);
  });

  test('isNoisyEvent tags presence/progress/delivered/read', () => {
    expect(isNoisyEvent('presence.typing')).toBe(true);
    expect(isNoisyEvent('message.delivered')).toBe(true);
    expect(isNoisyEvent('message.read')).toBe(true);
    expect(isNoisyEvent('sync.progress')).toBe(true);
    expect(isNoisyEvent('batch-job.progress')).toBe(true);
    expect(isNoisyEvent('message.received')).toBe(false);
  });
});

describe('events stream formatter', () => {
  test('formatEventLine emits HH:MM:SS + type + instance/chat + direction + summary', () => {
    const line = formatEventLine(makeEvent());
    expect(line).toContain('10:00:00');
    expect(line).toContain('message.received');
    expect(line).toContain('00000000/00000000');
    expect(line).toContain('inbound');
    expect(line).toContain('hello world');
  });

  test('formatEventLine truncates long text content', () => {
    const long = 'x'.repeat(200);
    const line = formatEventLine(makeEvent({ textContent: long }));
    expect(line).toContain('...');
    expect(line.length).toBeLessThan(200);
  });

  test('formatEventLine falls back to transcription/imageDescription/empty', () => {
    const audio = formatEventLine(makeEvent({ textContent: null, transcription: 'said hi' }));
    expect(audio).toContain('said hi');
    const image = formatEventLine(
      makeEvent({ textContent: null, transcription: null, imageDescription: 'a cat photo' }),
    );
    expect(image).toContain('a cat photo');
    const blank = formatEventLine(makeEvent({ textContent: null, transcription: null, imageDescription: null }));
    expect(blank).toContain('message.received');
  });
});
