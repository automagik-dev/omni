/**
 * Fixture-driven tests — exercise the inbound parsers against the synthetic
 * Bot Framework activity samples in `test/fixtures/real-payloads.json`.
 *
 * Cezar's PR #543 audit flagged the absence of a `real-payloads.json` for the
 * Teams channel: discord and whatsapp ship 2k+ lines of captured payloads, the
 * Teams package shipped only hand-authored inline samples. The risk is that the
 * tests cover what the developer imagined the wire shape to be, not the actual
 * Bot Framework Activity protocol.
 *
 * The fixture file is currently SYNTHETIC (derived from the published Bot
 * Framework v3 schema and Teams channel-data extensions). It should be replaced
 * with real captures after the first deployed bot — see `test/fixtures/real-payloads.json`
 * `_meta.source` for the exact schema references.
 *
 * What this test proves:
 *   1. The fixture file is well-formed JSON.
 *   2. Each fixture group is non-empty.
 *   3. The parsers (`parseInboundMessage`, `parseReactionActivity`) accept
 *      every fixture in the categories they cover, and produce non-empty
 *      results — i.e. the parsers don't silently throw or return undefined
 *      when presented with the canonical Bot Framework wire shapes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { parseInboundMessage, parseReactionActivity } from '../handlers';

interface FixturePayload {
  id: string;
  description?: string;
  payload: Record<string, unknown>;
}

interface RealPayloadsFile {
  _meta: {
    source: string;
    schema_references: string[];
    anonymisation: Record<string, string>;
  };
  [activityKind: string]: unknown;
}

const FIXTURE_PATH = join(__dirname, '..', '..', 'test', 'fixtures', 'real-payloads.json');
const fixtures = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as RealPayloadsFile;

const PARSEABLE_AS_MESSAGE = [
  'message.text.dm',
  'message.text.channel.mention',
  'message.text.channel.threadReply',
  'message.attachment.image',
  'message.attachment.file',
] as const;

const PARSEABLE_AS_REACTION = ['messageReaction.added', 'messageReaction.removed'] as const;

const NON_MESSAGE_NON_REACTION = [
  'conversationUpdate.botAdded',
  'messageUpdate.edit',
  'messageDelete.softDelete',
] as const;

describe('real-payloads.json fixture file', () => {
  it('is well-formed JSON with the documented anonymisation contract', () => {
    expect(fixtures._meta).toBeDefined();
    expect(fixtures._meta.source).toContain('Bot Framework');
    expect(fixtures._meta.schema_references.length).toBeGreaterThan(0);
    expect(fixtures._meta.anonymisation.tenantId).toBe('00000000-0000-0000-0000-000000000001');
    expect(fixtures._meta.anonymisation.appId).toBe('00000000-0000-0000-0000-000000000099');
  });

  for (const kind of [...PARSEABLE_AS_MESSAGE, ...PARSEABLE_AS_REACTION, ...NON_MESSAGE_NON_REACTION]) {
    it(`has at least one sample for "${kind}"`, () => {
      const group = fixtures[kind] as FixturePayload[] | undefined;
      expect(Array.isArray(group)).toBe(true);
      expect((group ?? []).length).toBeGreaterThan(0);
    });
  }
});

describe('parseInboundMessage against fixture payloads', () => {
  for (const kind of PARSEABLE_AS_MESSAGE) {
    const group = fixtures[kind] as FixturePayload[];
    for (const fixture of group) {
      it(`parses "${kind}" — ${fixture.id}`, () => {
        const parsed = parseInboundMessage(fixture.payload as never);
        expect(parsed).toBeDefined();
        // every parsed message must surface a chatId + activityId for downstream routing
        expect(parsed?.chatId).toBeTruthy();
        expect(parsed?.meta.activityId).toBeTruthy();
        expect(parsed?.meta.conversationId).toBeTruthy();
      });
    }
  }
});

describe('parseReactionActivity against fixture payloads', () => {
  for (const kind of PARSEABLE_AS_REACTION) {
    const group = fixtures[kind] as FixturePayload[];
    for (const fixture of group) {
      it(`parses "${kind}" — ${fixture.id}`, () => {
        const events = parseReactionActivity(fixture.payload as never);
        // Must produce at least one event (added or removed)
        expect(Array.isArray(events)).toBe(true);
        expect(events.length).toBeGreaterThan(0);
        for (const ev of events) {
          expect(ev.meta.activityId).toBeTruthy();
          expect(ev.targetActivityId).toBeTruthy();
          expect(typeof ev.reaction).toBe('string');
          expect(typeof ev.added).toBe('boolean');
        }
        // The fixture id encodes whether the event should be added or removed
        const expectAdded = kind === 'messageReaction.added';
        expect(events.every((e) => e.added === expectAdded)).toBe(true);
      });
    }
  }
});
