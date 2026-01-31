/**
 * Integration tests for condition evaluator using real WhatsApp payloads
 *
 * These tests validate that condition evaluation works correctly with
 * actual WhatsApp message structures captured from Baileys.
 */

import { describe, expect, test } from 'bun:test';
import { evaluateCondition, evaluateConditions, getNestedValue } from '../conditions';
import type { AutomationCondition } from '../types';

// Import real fixtures using relative path
// Note: We use relative path because the workspace packages aren't fully resolved in tests
import fixtures from '../../../../channel-whatsapp/test/fixtures/real-payloads.json';

// Helper to safely get array element with type assertion
function getFixture<T>(arr: T[], index: number): T {
  const item = arr[index];
  if (item === undefined) {
    throw new Error(`Fixture at index ${index} not found`);
  }
  return item;
}

describe('Condition evaluation with real WhatsApp payloads', () => {
  describe('Text messages', () => {
    const textPayload = getFixture(fixtures.messages.text, 0).payload;

    test('matches text message by conversation field existence', () => {
      const condition: AutomationCondition = {
        field: 'message.conversation',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, textPayload)).toBe(true);
    });

    test('matches text message content with contains operator', () => {
      const condition: AutomationCondition = {
        field: 'message.conversation',
        operator: 'contains',
        value: 'Buenas',
      };
      expect(evaluateCondition(condition, textPayload)).toBe(true);
    });

    test('matches sender push name', () => {
      const condition: AutomationCondition = {
        field: 'pushName',
        operator: 'eq',
        value: 'Alice Test',
      };
      expect(evaluateCondition(condition, textPayload)).toBe(true);
    });

    test('matches remoteJid for direct messages', () => {
      const condition: AutomationCondition = {
        field: 'key.remoteJid',
        operator: 'contains',
        value: '@lid',
      };
      expect(evaluateCondition(condition, textPayload)).toBe(true);
    });

    test('identifies incoming message (fromMe = false)', () => {
      const condition: AutomationCondition = {
        field: 'key.fromMe',
        operator: 'eq',
        value: false,
      };
      expect(evaluateCondition(condition, textPayload)).toBe(true);
    });

    test('matches messageTimestamp with numeric comparison', () => {
      const condition: AutomationCondition = {
        field: 'messageTimestamp',
        operator: 'gt',
        value: 0,
      };
      expect(evaluateCondition(condition, textPayload)).toBe(true);
    });

    test('matches remoteJidAlt for phone number filtering', () => {
      const condition: AutomationCondition = {
        field: 'key.remoteJidAlt',
        operator: 'regex',
        value: '^55\\d+@s\\.whatsapp\\.net$',
      };
      expect(evaluateCondition(condition, textPayload)).toBe(true);
    });
  });

  describe('Outgoing text messages', () => {
    const outgoingPayload = getFixture(fixtures.messages.text, 2).payload; // fromMe: true

    test('identifies outgoing message', () => {
      const condition: AutomationCondition = {
        field: 'key.fromMe',
        operator: 'eq',
        value: true,
      };
      expect(evaluateCondition(condition, outgoingPayload)).toBe(true);
    });

    test('matches status field for delivery tracking', () => {
      const condition: AutomationCondition = {
        field: 'status',
        operator: 'eq',
        value: 2,
      };
      expect(evaluateCondition(condition, outgoingPayload)).toBe(true);
    });
  });

  describe('Audio messages', () => {
    const audioPayload = getFixture(fixtures.messages.audio, 0).payload;

    test('identifies audio message by audioMessage existence', () => {
      const condition: AutomationCondition = {
        field: 'message.audioMessage',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, audioPayload)).toBe(true);
    });

    test('identifies voice note (PTT) messages', () => {
      const condition: AutomationCondition = {
        field: 'message.audioMessage.ptt',
        operator: 'eq',
        value: true,
      };
      expect(evaluateCondition(condition, audioPayload)).toBe(true);
    });

    test('matches audio duration for filtering short/long messages', () => {
      const condition: AutomationCondition = {
        field: 'message.audioMessage.seconds',
        operator: 'lte',
        value: 60,
      };
      expect(evaluateCondition(condition, audioPayload)).toBe(true);
    });

    test('matches audio mimetype', () => {
      const condition: AutomationCondition = {
        field: 'message.audioMessage.mimetype',
        operator: 'contains',
        value: 'audio/ogg',
      };
      expect(evaluateCondition(condition, audioPayload)).toBe(true);
    });

    test('does NOT match conversation field (different message type)', () => {
      const condition: AutomationCondition = {
        field: 'message.conversation',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, audioPayload)).toBe(false);
    });
  });

  describe('Image messages', () => {
    const imagePayload = getFixture(fixtures.messages.image, 0).payload;

    test('identifies image message', () => {
      const condition: AutomationCondition = {
        field: 'message.imageMessage',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, imagePayload)).toBe(true);
    });

    test('matches image dimensions for filtering', () => {
      const conditions: AutomationCondition[] = [
        { field: 'message.imageMessage.height', operator: 'gt', value: 100 },
        { field: 'message.imageMessage.width', operator: 'gt', value: 100 },
      ];
      expect(evaluateConditions(conditions, imagePayload)).toBe(true);
    });

    test('matches image mimetype', () => {
      const condition: AutomationCondition = {
        field: 'message.imageMessage.mimetype',
        operator: 'eq',
        value: 'image/jpeg',
      };
      expect(evaluateCondition(condition, imagePayload)).toBe(true);
    });

    test('matches file size for filtering large images', () => {
      // Note: fileLength is stored as a string in WhatsApp payloads
      // We use contains to check if it exists and is non-empty
      const condition: AutomationCondition = {
        field: 'message.imageMessage.fileLength',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, imagePayload)).toBe(true);

      // Alternatively, check specific string value
      const exactCondition: AutomationCondition = {
        field: 'message.imageMessage.fileLength',
        operator: 'eq',
        value: '63502',
      };
      expect(evaluateCondition(exactCondition, imagePayload)).toBe(true);
    });
  });

  describe('Sticker messages', () => {
    const stickerPayload = getFixture(fixtures.messages.sticker, 0).payload;

    test('identifies sticker message', () => {
      const condition: AutomationCondition = {
        field: 'message.stickerMessage',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, stickerPayload)).toBe(true);
    });

    test('identifies non-animated stickers', () => {
      const condition: AutomationCondition = {
        field: 'message.stickerMessage.isAnimated',
        operator: 'eq',
        value: false,
      };
      expect(evaluateCondition(condition, stickerPayload)).toBe(true);
    });

    test('identifies non-AI stickers', () => {
      const condition: AutomationCondition = {
        field: 'message.stickerMessage.isAiSticker',
        operator: 'eq',
        value: false,
      };
      expect(evaluateCondition(condition, stickerPayload)).toBe(true);
    });
  });

  describe('Contact messages', () => {
    const contactPayload = getFixture(fixtures.messages.contact, 0).payload;

    test('identifies contact message', () => {
      const condition: AutomationCondition = {
        field: 'message.contactMessage',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, contactPayload)).toBe(true);
    });

    test('matches contact display name', () => {
      const condition: AutomationCondition = {
        field: 'message.contactMessage.displayName',
        operator: 'eq',
        value: 'Alice Test',
      };
      expect(evaluateCondition(condition, contactPayload)).toBe(true);
    });

    test('matches vcard content with contains', () => {
      const condition: AutomationCondition = {
        field: 'message.contactMessage.vcard',
        operator: 'contains',
        value: 'BEGIN:VCARD',
      };
      expect(evaluateCondition(condition, contactPayload)).toBe(true);
    });
  });

  describe('Location messages', () => {
    const locationPayload = getFixture(fixtures.messages.location, 0).payload;

    test('identifies location message', () => {
      const condition: AutomationCondition = {
        field: 'message.locationMessage',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, locationPayload)).toBe(true);
    });

    test('matches latitude/longitude existence', () => {
      const conditions: AutomationCondition[] = [
        { field: 'message.locationMessage.degreesLatitude', operator: 'exists' },
        { field: 'message.locationMessage.degreesLongitude', operator: 'exists' },
      ];
      expect(evaluateConditions(conditions, locationPayload)).toBe(true);
    });
  });

  describe('Poll messages', () => {
    const pollPayload = getFixture(fixtures.messages.poll, 0).payload;

    test('identifies poll creation message', () => {
      const condition: AutomationCondition = {
        field: 'message.pollCreationMessageV3',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, pollPayload)).toBe(true);
    });

    test('matches poll name', () => {
      const condition: AutomationCondition = {
        field: 'message.pollCreationMessageV3.name',
        operator: 'eq',
        value: 'Quero saber',
      };
      expect(evaluateCondition(condition, pollPayload)).toBe(true);
    });

    test('can check number of poll options', () => {
      // Check that options array exists and has expected structure
      const condition: AutomationCondition = {
        field: 'message.pollCreationMessageV3.options.0.optionName',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, pollPayload)).toBe(true);
    });
  });

  describe('Extended text messages (replies, forwards)', () => {
    const replyPayload = getFixture(fixtures.messages.extendedText, 0).payload;
    const forwardPayload = getFixture(fixtures.messages.extendedText, 1).payload;

    test('identifies extended text message', () => {
      const condition: AutomationCondition = {
        field: 'message.extendedTextMessage',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, replyPayload)).toBe(true);
    });

    test('matches extended text content', () => {
      const condition: AutomationCondition = {
        field: 'message.extendedTextMessage.text',
        operator: 'contains',
        value: 'Quoting',
      };
      expect(evaluateCondition(condition, replyPayload)).toBe(true);
    });

    test('identifies reply (has quotedMessage)', () => {
      const condition: AutomationCondition = {
        field: 'message.extendedTextMessage.contextInfo.quotedMessage',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, replyPayload)).toBe(true);
    });

    test('identifies forwarded message', () => {
      const condition: AutomationCondition = {
        field: 'message.extendedTextMessage.contextInfo.isForwarded',
        operator: 'eq',
        value: true,
      };
      expect(evaluateCondition(condition, forwardPayload)).toBe(true);
    });

    test('checks forwarding score', () => {
      const condition: AutomationCondition = {
        field: 'message.extendedTextMessage.contextInfo.forwardingScore',
        operator: 'gte',
        value: 1,
      };
      expect(evaluateCondition(condition, forwardPayload)).toBe(true);
    });
  });

  describe('Protocol messages (revoke/delete)', () => {
    const revokePayload = getFixture(fixtures.messages.other, 1).payload;

    test('identifies protocol message', () => {
      const condition: AutomationCondition = {
        field: 'message.protocolMessage',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, revokePayload)).toBe(true);
    });

    test('identifies revoke (delete) message type', () => {
      const condition: AutomationCondition = {
        field: 'message.protocolMessage.type',
        operator: 'eq',
        value: 'REVOKE',
      };
      expect(evaluateCondition(condition, revokePayload)).toBe(true);
    });

    test('can reference revoked message ID', () => {
      const condition: AutomationCondition = {
        field: 'message.protocolMessage.key.id',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, revokePayload)).toBe(true);
    });
  });

  describe('Interactive messages', () => {
    const interactivePayload = getFixture(fixtures.messages.other, 2).payload;

    test('identifies interactive message', () => {
      const condition: AutomationCondition = {
        field: 'message.interactiveMessage',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, interactivePayload)).toBe(true);
    });

    test('identifies native flow message', () => {
      const condition: AutomationCondition = {
        field: 'message.interactiveMessage.nativeFlowMessage',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, interactivePayload)).toBe(true);
    });
  });
});

describe('Condition evaluation with real WhatsApp events', () => {
  describe('Presence events', () => {
    const composingPresence = getFixture(fixtures.events.presence, 0);
    const recordingPresence = getFixture(fixtures.events.presence, 2);
    const groupPresence = getFixture(fixtures.events.presence, 3);

    test('matches composing status', () => {
      const condition: AutomationCondition = {
        field: 'status',
        operator: 'eq',
        value: 'composing',
      };
      expect(evaluateCondition(condition, composingPresence as Record<string, unknown>)).toBe(true);
    });

    test('matches recording status', () => {
      const condition: AutomationCondition = {
        field: 'status',
        operator: 'eq',
        value: 'recording',
      };
      expect(evaluateCondition(condition, recordingPresence as Record<string, unknown>)).toBe(true);
    });

    test('identifies presence in group chat', () => {
      const condition: AutomationCondition = {
        field: 'chatId',
        operator: 'contains',
        value: '@g.us',
      };
      expect(evaluateCondition(condition, groupPresence as Record<string, unknown>)).toBe(true);
    });

    test('identifies presence in direct chat', () => {
      const condition: AutomationCondition = {
        field: 'chatId',
        operator: 'contains',
        value: '@lid',
      };
      expect(evaluateCondition(condition, composingPresence as Record<string, unknown>)).toBe(true);
    });
  });

  describe('Call events', () => {
    const videoCallOffer = getFixture(fixtures.events.call, 0);
    const voiceCallOffer = getFixture(fixtures.events.call, 3);
    const callTerminate = getFixture(fixtures.events.call, 2);

    test('matches call offer status', () => {
      const condition: AutomationCondition = {
        field: 'status',
        operator: 'eq',
        value: 'offer',
      };
      expect(evaluateCondition(condition, videoCallOffer as Record<string, unknown>)).toBe(true);
    });

    test('identifies video call', () => {
      const condition: AutomationCondition = {
        field: 'isVideo',
        operator: 'eq',
        value: true,
      };
      expect(evaluateCondition(condition, videoCallOffer as Record<string, unknown>)).toBe(true);
    });

    test('identifies voice call (not video)', () => {
      const condition: AutomationCondition = {
        field: 'isVideo',
        operator: 'eq',
        value: false,
      };
      expect(evaluateCondition(condition, voiceCallOffer as Record<string, unknown>)).toBe(true);
    });

    test('matches call terminate status', () => {
      const condition: AutomationCondition = {
        field: 'status',
        operator: 'eq',
        value: 'terminate',
      };
      expect(evaluateCondition(condition, callTerminate as Record<string, unknown>)).toBe(true);
    });

    test('identifies non-group call', () => {
      const condition: AutomationCondition = {
        field: 'isGroup',
        operator: 'eq',
        value: false,
      };
      expect(evaluateCondition(condition, videoCallOffer as Record<string, unknown>)).toBe(true);
    });
  });

  describe('Group participant events', () => {
    const addEvent = getFixture(fixtures.events.groupParticipantsUpdate, 0);
    const promoteEvent = getFixture(fixtures.events.groupParticipantsUpdate, 1);
    const removeEvent = getFixture(fixtures.events.groupParticipantsUpdate, 2);

    test('matches add action', () => {
      const condition: AutomationCondition = {
        field: 'action',
        operator: 'eq',
        value: 'add',
      };
      expect(evaluateCondition(condition, addEvent as Record<string, unknown>)).toBe(true);
    });

    test('matches promote action', () => {
      const condition: AutomationCondition = {
        field: 'action',
        operator: 'eq',
        value: 'promote',
      };
      expect(evaluateCondition(condition, promoteEvent as Record<string, unknown>)).toBe(true);
    });

    test('matches remove action', () => {
      const condition: AutomationCondition = {
        field: 'action',
        operator: 'eq',
        value: 'remove',
      };
      expect(evaluateCondition(condition, removeEvent as Record<string, unknown>)).toBe(true);
    });

    test('identifies group by JID', () => {
      const condition: AutomationCondition = {
        field: 'id',
        operator: 'contains',
        value: '@g.us',
      };
      expect(evaluateCondition(condition, addEvent as Record<string, unknown>)).toBe(true);
    });

    test('checks participant in array via index', () => {
      const condition: AutomationCondition = {
        field: 'participants.0.id',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, addEvent as Record<string, unknown>)).toBe(true);
    });
  });

  describe('Message receipt updates', () => {
    const receiptUpdate = getFixture(fixtures.events.messageReceiptUpdate, 0);

    test('matches read receipt', () => {
      const condition: AutomationCondition = {
        field: 'receipt.readTimestamp',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, receiptUpdate as Record<string, unknown>)).toBe(true);
    });

    test('identifies receipt user', () => {
      const condition: AutomationCondition = {
        field: 'receipt.userJid',
        operator: 'contains',
        value: '@lid',
      };
      expect(evaluateCondition(condition, receiptUpdate as Record<string, unknown>)).toBe(true);
    });

    test('can reference original message key', () => {
      const condition: AutomationCondition = {
        field: 'key.id',
        operator: 'exists',
      };
      expect(evaluateCondition(condition, receiptUpdate as Record<string, unknown>)).toBe(true);
    });
  });
});

describe('Complex multi-condition scenarios', () => {
  const textPayload = getFixture(fixtures.messages.text, 0).payload;
  const audioPayload = getFixture(fixtures.messages.audio, 0).payload;

  test('filters incoming text messages from specific contact', () => {
    const conditions: AutomationCondition[] = [
      { field: 'key.fromMe', operator: 'eq', value: false },
      { field: 'message.conversation', operator: 'exists' },
      { field: 'pushName', operator: 'eq', value: 'Alice Test' },
    ];
    expect(evaluateConditions(conditions, textPayload)).toBe(true);
  });

  test('filters voice notes under 30 seconds', () => {
    const conditions: AutomationCondition[] = [
      { field: 'message.audioMessage', operator: 'exists' },
      { field: 'message.audioMessage.ptt', operator: 'eq', value: true },
      { field: 'message.audioMessage.seconds', operator: 'lte', value: 30 },
    ];
    expect(evaluateConditions(conditions, audioPayload)).toBe(true);
  });

  test('excludes messages when any condition fails', () => {
    const conditions: AutomationCondition[] = [
      { field: 'message.conversation', operator: 'exists' },
      { field: 'pushName', operator: 'eq', value: 'Bob Test' }, // Won't match Alice
    ];
    expect(evaluateConditions(conditions, textPayload)).toBe(false);
  });

  test('filters non-forwarded messages', () => {
    const conditions: AutomationCondition[] = [
      { field: 'message.extendedTextMessage.contextInfo.isForwarded', operator: 'not_exists' },
    ];
    expect(evaluateConditions(conditions, textPayload)).toBe(true);
  });
});

describe('Message type detection pattern', () => {
  test('can create message type discriminator', () => {
    const payloads = [
      { type: 'text', payload: getFixture(fixtures.messages.text, 0).payload },
      { type: 'audio', payload: getFixture(fixtures.messages.audio, 0).payload },
      { type: 'image', payload: getFixture(fixtures.messages.image, 0).payload },
      { type: 'sticker', payload: getFixture(fixtures.messages.sticker, 0).payload },
      { type: 'contact', payload: getFixture(fixtures.messages.contact, 0).payload },
      { type: 'location', payload: getFixture(fixtures.messages.location, 0).payload },
      { type: 'poll', payload: getFixture(fixtures.messages.poll, 0).payload },
    ];

    const typeConditions: Record<string, AutomationCondition> = {
      text: { field: 'message.conversation', operator: 'exists' },
      audio: { field: 'message.audioMessage', operator: 'exists' },
      image: { field: 'message.imageMessage', operator: 'exists' },
      sticker: { field: 'message.stickerMessage', operator: 'exists' },
      contact: { field: 'message.contactMessage', operator: 'exists' },
      location: { field: 'message.locationMessage', operator: 'exists' },
      poll: { field: 'message.pollCreationMessageV3', operator: 'exists' },
    };

    for (const { type, payload } of payloads) {
      const condition = typeConditions[type];
      if (!condition) {
        throw new Error(`Missing condition for type: ${type}`);
      }
      expect(evaluateCondition(condition, payload)).toBe(true);

      // Ensure other type conditions don't match
      for (const [otherType, otherCondition] of Object.entries(typeConditions)) {
        if (otherType !== type) {
          expect(evaluateCondition(otherCondition, payload)).toBe(false);
        }
      }
    }
  });
});

describe('Deep nested value access with getNestedValue', () => {
  const textPayload = getFixture(fixtures.messages.text, 0).payload;
  const extendedPayload = getFixture(fixtures.messages.extendedText, 0).payload;

  test('accesses deeply nested device metadata', () => {
    const value = getNestedValue(textPayload, 'message.messageContextInfo.deviceListMetadata.senderKeyHash');
    expect(value).toBe('[HASH]');
  });

  test('accesses quoted message content', () => {
    const value = getNestedValue(extendedPayload, 'message.extendedTextMessage.contextInfo.quotedMessage.conversation');
    expect(value).toBe('Buenas como q tão as coisas aí');
  });

  test('returns undefined for non-existent deep path', () => {
    const value = getNestedValue(textPayload, 'message.nonExistent.deeply.nested.field');
    expect(value).toBeUndefined();
  });
});
