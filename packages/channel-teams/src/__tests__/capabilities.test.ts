/**
 * Tests for the TEAMS_CAPABILITIES declaration.
 *
 * Locks the capability matrix shape so accidental drift triggers a test
 * failure (the SDK compliance suite also exercises these but here we
 * document the channel-specific intent and the v1 deferrals).
 */

import { describe, expect, it } from 'bun:test';

import { TEAMS_CAPABILITIES } from '../capabilities';

describe('TEAMS_CAPABILITIES', () => {
  it('declares core messaging surface', () => {
    expect(TEAMS_CAPABILITIES.canSendText).toBe(true);
    expect(TEAMS_CAPABILITIES.canSendMedia).toBe(true);
    expect(TEAMS_CAPABILITIES.canSendReaction).toBe(true);
    expect(TEAMS_CAPABILITIES.canSendTyping).toBe(true);
  });

  it('declares conversation surfaces', () => {
    expect(TEAMS_CAPABILITIES.canHandleDMs).toBe(true);
    expect(TEAMS_CAPABILITIES.canHandleGroups).toBe(true);
    expect(TEAMS_CAPABILITIES.canHandleThreads).toBe(true);
    expect(TEAMS_CAPABILITIES.canHandleBroadcast).toBe(false);
  });

  it('declares message-mutation operations', () => {
    // Edit/delete are scoped out for v1: tools.ts stubs throw
    // UNSUPPORTED_ACTIVITY, so the capability flags stay false until the
    // Bot Framework `updateActivity`/`deleteActivity` plumbing lands. See
    // REVIEW.md B.1.
    expect(TEAMS_CAPABILITIES.canEditMessage).toBe(false);
    expect(TEAMS_CAPABILITIES.canDeleteMessage).toBe(false);
    expect(TEAMS_CAPABILITIES.canReplyToMessage).toBe(true);
  });

  it('opts out of receipts (Bot Framework does not surface them to bots)', () => {
    expect(TEAMS_CAPABILITIES.canReceiveDeliveryReceipts).toBe(false);
    expect(TEAMS_CAPABILITIES.canReceiveReadReceipts).toBe(false);
  });

  it('defers streaming to a follow-up wish', () => {
    expect(TEAMS_CAPABILITIES.canStreamResponse).toBe(false);
  });

  it('defers contact / location / sticker / forward (out of v1 scope)', () => {
    expect(TEAMS_CAPABILITIES.canSendContact).toBe(false);
    expect(TEAMS_CAPABILITIES.canSendLocation).toBe(false);
    expect(TEAMS_CAPABILITIES.canSendSticker).toBe(false);
    expect(TEAMS_CAPABILITIES.canForwardMessage).toBe(false);
  });

  it('exposes the Bot Framework limits', () => {
    expect(TEAMS_CAPABILITIES.maxMessageLength).toBeGreaterThan(0);
    expect(TEAMS_CAPABILITIES.maxFileSize).toBeGreaterThan(0);
  });

  it('declares non-empty supportedMediaTypes with valid mime entries', () => {
    expect(Array.isArray(TEAMS_CAPABILITIES.supportedMediaTypes)).toBe(true);
    expect(TEAMS_CAPABILITIES.supportedMediaTypes.length).toBeGreaterThan(0);
    for (const mt of TEAMS_CAPABILITIES.supportedMediaTypes) {
      expect(typeof mt.mimeType).toBe('string');
      expect(mt.mimeType.length).toBeGreaterThan(0);
    }
  });
});
