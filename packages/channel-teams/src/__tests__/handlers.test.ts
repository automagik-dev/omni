/**
 * Group 3 acceptance tests for the inbound activity handlers.
 *
 * Validates the plain-function parsers in `handlers/` against the wire
 * shapes Bot Framework actually delivers in production:
 *   - 1:1 chats vs team channels vs group chats
 *   - thread replies (channel reply chains)
 *   - mention extraction + body markup stripping
 *   - attachment classification (downloadable media vs Teams cards)
 *   - reaction add / remove
 */

import { describe, expect, it } from 'bun:test';

import {
  classifyConversation,
  deriveChatId,
  extractAttachments,
  parseInboundMessage,
  parseMentions,
  parseReactionActivity,
  stripMentionMarkup,
  toActivityMeta,
} from '../handlers';
import type { InboundActivity } from '../handlers';

function makeBaseActivity(overrides: Partial<InboundActivity> = {}): InboundActivity {
  return {
    type: 'message',
    id: 'activity-id-1',
    timestamp: '2026-04-26T12:34:56Z',
    serviceUrl: 'https://smba.trafficmanager.net/teams/',
    channelId: 'msteams',
    from: { id: '29:user-id', name: 'Ada', aadObjectId: 'aad-ada' },
    conversation: { id: 'conv-1', conversationType: 'personal', tenantId: 'tenant-1' },
    recipient: { id: '28:bot', name: 'Omni' },
    text: 'hello world',
    ...overrides,
  };
}

describe('classifyConversation', () => {
  it('marks personal chats as DMs', () => {
    const activity = makeBaseActivity();
    expect(classifyConversation(activity)).toEqual({
      isDm: true,
      conversationType: 'personal',
    });
  });

  it('flags channel conversations as non-DM', () => {
    const activity = makeBaseActivity({
      conversation: { id: 'c2', conversationType: 'channel' },
    });
    expect(classifyConversation(activity)).toEqual({
      isDm: false,
      conversationType: 'channel',
    });
  });

  it('flags group chats as non-DM', () => {
    const activity = makeBaseActivity({
      conversation: { id: 'c3', conversationType: 'groupChat' },
    });
    expect(classifyConversation(activity)).toEqual({
      isDm: false,
      conversationType: 'groupChat',
    });
  });

  it('returns undefined conversationType for unrecognised values', () => {
    const activity = makeBaseActivity({
      conversation: { id: 'c4', conversationType: 'something-new' },
    });
    expect(classifyConversation(activity).conversationType).toBeUndefined();
    expect(classifyConversation(activity).isDm).toBe(false);
  });
});

describe('toActivityMeta', () => {
  it('flattens the relevant Bot Framework fields into TeamsActivityMeta', () => {
    const activity = makeBaseActivity({
      replyToId: 'parent-1',
      channelData: {
        team: { id: 'team-1' },
        channel: { id: 'chan-1' },
        tenant: { id: 'tenant-2' },
      },
      conversation: { id: 'conv-1', conversationType: 'channel' },
    });

    const meta = toActivityMeta(activity);
    expect(meta).toMatchObject({
      activityId: 'activity-id-1',
      conversationId: 'conv-1',
      replyToId: 'parent-1',
      userId: 'aad-ada',
      userName: 'Ada',
      tenantId: 'tenant-2',
      serviceUrl: 'https://smba.trafficmanager.net/teams/',
      conversationType: 'channel',
      isDm: false,
      isThreadReply: true,
      teamId: 'team-1',
      channelId: 'chan-1',
    });
  });

  it('falls back to from.id when aadObjectId is missing', () => {
    const activity = makeBaseActivity({
      from: { id: '29:fallback' },
    });
    expect(toActivityMeta(activity).userId).toBe('29:fallback');
  });

  it('throws on malformed activities (missing required fields)', () => {
    expect(() => toActivityMeta({ ...makeBaseActivity(), id: undefined })).toThrow(/activity\.id/);
    expect(() => toActivityMeta({ ...makeBaseActivity(), serviceUrl: '' as unknown as string })).toThrow(/serviceUrl/);
  });
});

describe('deriveChatId', () => {
  it('uses the Teams channelId when in a channel', () => {
    const activity = makeBaseActivity({
      conversation: { id: 'conv-1', conversationType: 'channel' },
      channelData: { team: { id: 'team-1' }, channel: { id: 'chan-x' } },
    });
    const meta = toActivityMeta(activity);
    expect(deriveChatId(meta)).toBe('chan-x');
  });

  it('falls back to conversationId for personal chats', () => {
    const meta = toActivityMeta(makeBaseActivity());
    expect(deriveChatId(meta)).toBe('conv-1');
  });
});

describe('parseMentions', () => {
  it('extracts mention entities and flags bot mentions', () => {
    const activity = makeBaseActivity({
      text: '<at>Omni</at> hello team',
      entities: [
        {
          type: 'mention',
          text: '<at>Omni</at>',
          mentioned: { id: '28:bot', name: 'Omni', aadObjectId: 'aad-bot' },
        },
        {
          type: 'mention',
          text: '<at>Cynthia</at>',
          mentioned: { id: '29:user-cynthia', name: 'Cynthia' },
        },
      ],
    });

    const result = parseMentions(activity);
    expect(result.mentions).toHaveLength(2);
    expect(result.mentions[0]?.userId).toBe('aad-bot');
    expect(result.mentions[0]?.isBot).toBe(true);
    expect(result.mentions[1]?.isBot).toBe(false);
    expect(result.mentionsBot).toBe(true);
    expect(result.cleanedText).toBe('Omni hello team');
  });

  it('ignores non-mention entities', () => {
    const activity = makeBaseActivity({
      entities: [{ type: 'clientInfo', locale: 'en-US' }],
    });
    expect(parseMentions(activity).mentions).toHaveLength(0);
  });
});

describe('stripMentionMarkup', () => {
  it('replaces <at>X</at> tags with their visible label', () => {
    expect(stripMentionMarkup('<at>Omni</at> please look at this')).toBe('Omni please look at this');
  });

  it('handles malformed tags by leaving the text intact', () => {
    expect(stripMentionMarkup('hello <at>foo')).toBe('hello <at>foo');
  });

  it('returns an empty string for missing input', () => {
    expect(stripMentionMarkup('')).toBe('');
  });
});

describe('extractAttachments', () => {
  it('returns an empty result when there are no attachments', () => {
    const activity = makeBaseActivity();
    expect(extractAttachments(activity)).toEqual({ cards: [], all: [] });
  });

  it('classifies an image as media', () => {
    const activity = makeBaseActivity({
      attachments: [
        {
          contentType: 'image/png',
          contentUrl: 'https://files.example.com/photo.png',
          name: 'photo.png',
        },
      ],
    });
    const result = extractAttachments(activity);
    expect(result.media).toMatchObject({
      type: 'image',
      mediaUrl: 'https://files.example.com/photo.png',
      mimeType: 'image/png',
      filename: 'photo.png',
    });
    expect(result.cards).toHaveLength(0);
  });

  it('routes Adaptive Cards to the cards bucket only', () => {
    const activity = makeBaseActivity({
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: { type: 'AdaptiveCard', body: [] },
        },
      ],
    });
    const result = extractAttachments(activity);
    expect(result.media).toBeUndefined();
    expect(result.cards).toHaveLength(1);
  });

  it('maps audio / video / generic mime types correctly', () => {
    const cases: Array<[string, 'audio' | 'video' | 'document']> = [
      ['audio/mpeg', 'audio'],
      ['video/mp4', 'video'],
      ['application/pdf', 'document'],
    ];
    for (const [mime, expected] of cases) {
      const activity = makeBaseActivity({
        attachments: [{ contentType: mime, contentUrl: 'https://example/file' }],
      });
      expect(extractAttachments(activity).media?.type).toBe(expected);
    }
  });
});

describe('parseInboundMessage', () => {
  it('builds an IncomingMessage envelope for plain text', () => {
    const activity = makeBaseActivity();
    const parsed = parseInboundMessage(activity);
    expect(parsed).not.toBeNull();
    expect(parsed?.content.type).toBe('text');
    expect(parsed?.content.text).toBe('hello world');
    expect(parsed?.from).toBe('aad-ada');
    expect(parsed?.fromName).toBe('Ada');
    expect(parsed?.platformTimestamp).toBe(Date.parse('2026-04-26T12:34:56Z'));
  });

  it('returns null when the activity carries neither text nor media', () => {
    const activity = makeBaseActivity({ text: '', attachments: [] });
    expect(parseInboundMessage(activity)).toBeNull();
  });

  it('returns null for non-message activity types', () => {
    const activity = makeBaseActivity({ type: 'typing' });
    expect(parseInboundMessage(activity)).toBeNull();
  });

  it('promotes a Teams channel activity to channel-vs-DM correctly', () => {
    const activity = makeBaseActivity({
      conversation: { id: 'conv-channel', conversationType: 'channel' },
      channelData: { team: { id: 'team-1' }, channel: { id: 'chan-x' } },
      replyToId: 'thread-root',
    });
    const parsed = parseInboundMessage(activity);
    expect(parsed?.meta.isDm).toBe(false);
    expect(parsed?.meta.isThreadReply).toBe(true);
    expect(parsed?.replyToId).toBe('thread-root');
    expect(parsed?.chatId).toBe('chan-x');
  });

  it('strips <at> markup from the body so the LLM sees plain text', () => {
    const activity = makeBaseActivity({
      text: '<at>Omni</at> please respond',
      entities: [{ type: 'mention', mentioned: { id: '28:bot', name: 'Omni' } }],
    });
    const parsed = parseInboundMessage(activity);
    expect(parsed?.content.text).toBe('Omni please respond');
  });

  it('captures attachment + caption when present', () => {
    const activity = makeBaseActivity({
      text: 'check this out',
      attachments: [
        {
          contentType: 'image/jpeg',
          contentUrl: 'https://example/image.jpg',
          name: 'image.jpg',
        },
      ],
    });
    const parsed = parseInboundMessage(activity);
    expect(parsed?.content.type).toBe('image');
    expect(parsed?.content.mediaUrl).toBe('https://example/image.jpg');
    expect(parsed?.content.text).toBe('check this out');
  });
});

describe('parseReactionActivity', () => {
  it('returns one event per added reaction', () => {
    const activity: InboundActivity = {
      type: 'messageReaction',
      id: 'reaction-1',
      serviceUrl: 'https://example/',
      from: { id: '29:user', aadObjectId: 'aad-user', name: 'User' },
      conversation: { id: 'conv', conversationType: 'channel' },
      replyToId: 'target-msg',
      reactionsAdded: [{ type: 'like' }, { type: 'heart' }],
    };
    const events = parseReactionActivity(activity);
    expect(events).toHaveLength(2);
    expect(events[0]?.added).toBe(true);
    expect(events[0]?.reaction).toBe('like');
    expect(events[1]?.reaction).toBe('heart');
    expect(events[0]?.targetActivityId).toBe('target-msg');
  });

  it('returns one event per removed reaction with added=false', () => {
    const activity: InboundActivity = {
      type: 'messageReaction',
      id: 'reaction-2',
      serviceUrl: 'https://example/',
      from: { id: '29:user' },
      conversation: { id: 'conv' },
      replyToId: 'target-msg',
      reactionsRemoved: [{ type: 'sad' }],
    };
    const events = parseReactionActivity(activity);
    expect(events).toHaveLength(1);
    expect(events[0]?.added).toBe(false);
    expect(events[0]?.reaction).toBe('sad');
  });

  it('returns an empty list when the activity is not a reaction', () => {
    const activity = makeBaseActivity();
    expect(parseReactionActivity(activity)).toEqual([]);
  });

  it('returns an empty list when replyToId is missing', () => {
    const activity: InboundActivity = {
      type: 'messageReaction',
      id: 'reaction-3',
      serviceUrl: 'https://example/',
      from: { id: '29:user' },
      conversation: { id: 'conv' },
      reactionsAdded: [{ type: 'like' }],
    };
    expect(parseReactionActivity(activity)).toEqual([]);
  });
});
