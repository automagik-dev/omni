/**
 * Tests using real-world anonymized payloads
 *
 * These fixtures were captured from actual WhatsApp interactions
 * and anonymized (phone numbers, names, locations, etc.)
 */

import { describe, expect, it } from 'bun:test';
import { fromJid, isGroupJid } from '../jid';
import type {
  WAAudioMessage,
  WAContactMessage,
  WADocumentMessage,
  WAExtendedTextMessage,
  WAFullMessage,
  WAImageMessage,
  WALocationMessage,
  WAReactionMessage,
  WAStickerMessage,
  WAVideoMessage,
} from '../types';

// Load fixtures
import fixtures from '../../test/fixtures/real-payloads.json';

describe('Real Payload Fixtures', () => {
  describe('Message Payloads', () => {
    describe('Text Messages', () => {
      it('should have valid text message structure', () => {
        const textMessages = fixtures.messages.text;
        expect(textMessages.length).toBeGreaterThan(0);

        for (const { payload } of textMessages) {
          const msg = payload as WAFullMessage;

          // Key structure
          expect(msg.key).toBeDefined();
          expect(msg.key.id).toBeDefined();
          expect(msg.key.remoteJid).toBeDefined();
          expect(typeof msg.key.fromMe).toBe('boolean');

          // Message content
          expect(msg.message).toBeDefined();
          expect(msg.message?.conversation).toBeDefined();

          // Metadata
          expect(msg.messageTimestamp).toBeDefined();
          expect(msg.pushName).toBeDefined();
        }
      });

      it('should extract sender info from JID', () => {
        const msg = fixtures.messages.text[0].payload as WAFullMessage;
        const { id, isGroup } = fromJid(msg.key.remoteJid);

        expect(id).toBeDefined();
        expect(isGroup).toBe(false);
      });

      it('should have remoteJidAlt for LID-addressed messages', () => {
        const msg = fixtures.messages.text[0].payload as WAFullMessage;

        // LID messages have remoteJidAlt with phone number
        if (msg.key.addressingMode === 'lid') {
          expect(msg.key.remoteJidAlt).toBeDefined();
          expect(msg.key.remoteJidAlt).toContain('@s.whatsapp.net');
        }
      });
    });

    describe('Extended Text Messages', () => {
      it('should have valid extended text structure', () => {
        const extMessages = fixtures.messages.extendedText;
        expect(extMessages.length).toBeGreaterThan(0);

        for (const { payload } of extMessages) {
          const msg = payload as WAFullMessage;

          expect(msg.message?.extendedTextMessage).toBeDefined();
          const extText = msg.message?.extendedTextMessage as WAExtendedTextMessage;

          // Extended text has text property
          expect(extText.text).toBeDefined();
        }
      });

      it('should support context info for replies', () => {
        const extMessages = fixtures.messages.extendedText;

        // Find a reply message (has contextInfo with quotedMessage)
        const replyMsg = extMessages.find(({ payload }) => {
          const msg = payload as WAFullMessage;
          return msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        });

        if (replyMsg) {
          const msg = replyMsg.payload as WAFullMessage;
          const extText = msg.message?.extendedTextMessage as WAExtendedTextMessage;

          expect(extText.contextInfo).toBeDefined();
          expect(extText.contextInfo?.stanzaId).toBeDefined();
          expect(extText.contextInfo?.quotedMessage).toBeDefined();
        }
      });
    });

    describe('Audio Messages', () => {
      it('should have valid audio message structure', () => {
        const audioMessages = fixtures.messages.audio;
        expect(audioMessages.length).toBeGreaterThan(0);

        for (const { payload } of audioMessages) {
          const msg = payload as WAFullMessage;

          expect(msg.message?.audioMessage).toBeDefined();
          const audio = msg.message?.audioMessage as WAAudioMessage;

          // Audio properties
          expect(audio.mimetype).toBeDefined();
          expect(audio.seconds).toBeDefined();
          expect(typeof audio.ptt).toBe('boolean');
        }
      });

      it('should distinguish voice notes (ptt) from audio files', () => {
        const audioMessages = fixtures.messages.audio;

        for (const { payload } of audioMessages) {
          const audio = (payload as WAFullMessage).message?.audioMessage as WAAudioMessage;

          // ptt = push-to-talk (voice note)
          expect(typeof audio.ptt).toBe('boolean');
        }
      });
    });

    describe('Image Messages', () => {
      it('should have valid image message structure', () => {
        const imageMessages = fixtures.messages.image;
        expect(imageMessages.length).toBeGreaterThan(0);

        for (const { payload } of imageMessages) {
          const msg = payload as WAFullMessage;

          expect(msg.message?.imageMessage).toBeDefined();
          const image = msg.message?.imageMessage as WAImageMessage;

          expect(image.mimetype).toBeDefined();
          expect(image.height).toBeDefined();
          expect(image.width).toBeDefined();
        }
      });
    });

    describe('Video Messages', () => {
      it('should have valid video message structure', () => {
        const videoMessages = fixtures.messages.video;
        if (videoMessages.length === 0) return; // Skip if no video fixtures

        for (const { payload } of videoMessages) {
          const msg = payload as WAFullMessage;

          expect(msg.message?.videoMessage).toBeDefined();
          const video = msg.message?.videoMessage as WAVideoMessage;

          expect(video.mimetype).toBeDefined();
          expect(video.seconds).toBeDefined();
        }
      });
    });

    describe('Document Messages', () => {
      it('should have valid document message structure', () => {
        const docMessages = fixtures.messages.document;
        if (docMessages.length === 0) return; // Skip if no document fixtures

        for (const { payload } of docMessages) {
          const msg = payload as WAFullMessage;

          expect(msg.message?.documentMessage).toBeDefined();
          const doc = msg.message?.documentMessage as WADocumentMessage;

          expect(doc.mimetype).toBeDefined();
          expect(doc.fileName).toBeDefined();
        }
      });
    });

    describe('Sticker Messages', () => {
      it('should have valid sticker message structure', () => {
        const stickerMessages = fixtures.messages.sticker;
        expect(stickerMessages.length).toBeGreaterThan(0);

        for (const { payload } of stickerMessages) {
          const msg = payload as WAFullMessage;

          expect(msg.message?.stickerMessage).toBeDefined();
          const sticker = msg.message?.stickerMessage as WAStickerMessage;

          expect(sticker.mimetype).toBeDefined();
          expect(typeof sticker.isAnimated).toBe('boolean');
        }
      });
    });

    describe('Contact Messages', () => {
      it('should have valid contact message structure', () => {
        const contactMessages = fixtures.messages.contact;
        expect(contactMessages.length).toBeGreaterThan(0);

        for (const { payload } of contactMessages) {
          const msg = payload as WAFullMessage;

          expect(msg.message?.contactMessage).toBeDefined();
          const contact = msg.message?.contactMessage as WAContactMessage;

          expect(contact.displayName).toBeDefined();
          expect(contact.vcard).toBeDefined();
        }
      });
    });

    describe('Location Messages', () => {
      it('should have valid location message structure', () => {
        const locationMessages = fixtures.messages.location;
        expect(locationMessages.length).toBeGreaterThan(0);

        for (const { payload } of locationMessages) {
          const msg = payload as WAFullMessage;

          expect(msg.message?.locationMessage).toBeDefined();
          const location = msg.message?.locationMessage as WALocationMessage;

          expect(location.degreesLatitude).toBeDefined();
          expect(location.degreesLongitude).toBeDefined();
        }
      });

      it('should have anonymized coordinates (Null Island)', () => {
        const locationMessages = fixtures.messages.location;

        for (const { payload } of locationMessages) {
          const location = (payload as WAFullMessage).message?.locationMessage as WALocationMessage;

          // Fixtures should be anonymized to Null Island (0, 0)
          expect(location.degreesLatitude).toBe(0);
          expect(location.degreesLongitude).toBe(0);
        }
      });
    });

    describe('Poll Messages', () => {
      it('should have valid poll creation structure', () => {
        const pollMessages = fixtures.messages.poll;
        expect(pollMessages.length).toBeGreaterThan(0);

        for (const { payload } of pollMessages) {
          const msg = payload as WAFullMessage;

          expect(msg.message?.pollCreationMessage || msg.message?.pollCreationMessageV3).toBeDefined();
        }
      });

      it('should have valid poll update structure', () => {
        const pollUpdates = fixtures.messages.pollUpdate;
        expect(pollUpdates.length).toBeGreaterThan(0);

        for (const { payload } of pollUpdates) {
          const msg = payload as WAFullMessage;

          expect(msg.message?.pollUpdateMessage).toBeDefined();
        }
      });
    });

    describe('Reaction Messages', () => {
      it('should have valid reaction structure', () => {
        const reactionMessages = fixtures.messages.reaction;
        if (reactionMessages.length === 0) return; // Skip if no reaction fixtures

        for (const { payload } of reactionMessages) {
          const msg = payload as WAFullMessage;

          expect(msg.message?.reactionMessage).toBeDefined();
          const reaction = msg.message?.reactionMessage as WAReactionMessage;

          expect(reaction.key).toBeDefined();
          expect(reaction.text).toBeDefined(); // emoji or empty for removal
        }
      });
    });
  });

  describe('Event Payloads', () => {
    describe('Call Events', () => {
      it('should have valid call event structure', () => {
        const callEvents = fixtures.events.call;
        expect(callEvents.length).toBeGreaterThan(0);

        for (const call of callEvents) {
          expect(call.id).toBeDefined();
          expect(call.from).toBeDefined();
          expect(call.status).toBeDefined();
          expect(typeof call.isVideo).toBe('boolean');
          expect(typeof call.isGroup).toBe('boolean');
        }
      });

      it('should have call lifecycle events', () => {
        const callEvents = fixtures.events.call;
        const statuses = callEvents.map((call) => call.status);

        // Should have various call statuses
        expect(statuses.some((s) => s === 'offer' || s === 'ringing' || s === 'terminate')).toBe(true);
      });
    });

    describe('Presence Events', () => {
      it('should have valid presence update structure', () => {
        const presenceEvents = fixtures.events.presence;
        expect(presenceEvents.length).toBeGreaterThan(0);

        for (const presence of presenceEvents) {
          expect(presence.chatId).toBeDefined();
          expect(presence.userId).toBeDefined();
          expect(presence.status).toBeDefined();
        }
      });

      it('should have presence statuses', () => {
        const presenceEvents = fixtures.events.presence;

        for (const presence of presenceEvents) {
          // Valid presence values
          expect(['available', 'unavailable', 'composing', 'recording', 'paused']).toContain(presence.status);
        }
      });
    });

    describe('Group Participant Events', () => {
      it('should have valid group participant update structure', () => {
        const groupEvents = fixtures.events.groupParticipantsUpdate;
        expect(groupEvents.length).toBeGreaterThan(0);

        for (const update of groupEvents) {
          expect(update.id).toBeDefined(); // group JID
          expect(update.action).toBeDefined();
          expect(update.participants).toBeDefined();
          expect(Array.isArray(update.participants)).toBe(true);
        }
      });

      it('should have group JIDs', () => {
        const groupEvents = fixtures.events.groupParticipantsUpdate;

        for (const update of groupEvents) {
          expect(isGroupJid(update.id)).toBe(true);
        }
      });

      it('should have valid action types', () => {
        const groupEvents = fixtures.events.groupParticipantsUpdate;
        const actions = groupEvents.map((update) => update.action);

        // Valid group actions
        for (const action of actions) {
          expect(['add', 'remove', 'promote', 'demote', 'invite', 'leave']).toContain(action);
        }
      });
    });

    describe('Message Receipt Events', () => {
      it('should have valid receipt update structure', () => {
        const receiptEvents = fixtures.events.messageReceiptUpdate;
        expect(receiptEvents.length).toBeGreaterThan(0);

        for (const receipt of receiptEvents) {
          expect(receipt.key).toBeDefined();
          expect(receipt.key.id).toBeDefined();
        }
      });
    });

    describe('Chat Update Events', () => {
      it('should have valid chat update structure', () => {
        const chatUpdateBatches = fixtures.events.chatsUpdate;
        expect(chatUpdateBatches.length).toBeGreaterThan(0);

        for (const batch of chatUpdateBatches) {
          expect(batch.count).toBeDefined();
          expect(batch.updates).toBeDefined();
          expect(Array.isArray(batch.updates)).toBe(true);

          for (const chat of batch.updates) {
            expect(chat.id).toBeDefined();
          }
        }
      });
    });

    describe('Contact Update Events', () => {
      it('should have valid contact update structure', () => {
        const contactUpdateBatches = fixtures.events.contactsUpdate;
        expect(contactUpdateBatches.length).toBeGreaterThan(0);

        for (const batch of contactUpdateBatches) {
          expect(batch.count).toBeDefined();
          expect(batch.updates).toBeDefined();
          expect(Array.isArray(batch.updates)).toBe(true);

          for (const contact of batch.updates) {
            expect(contact.id).toBeDefined();
          }
        }
      });
    });
  });

  describe('Data Anonymization', () => {
    it('should have anonymized phone numbers', () => {
      const json = JSON.stringify(fixtures);

      // Check for anonymized phone pattern (5511999990xxx)
      expect(json).toContain('5511999990');

      // Should not contain real phone patterns (we can't know all, but check common BR patterns)
      // Real numbers would be like 5551... 5548... etc, our fake ones are 5511999990xxx
      const phoneMatches = json.match(/55\d{10,11}/g) || [];
      for (const phone of phoneMatches) {
        // All phones should be our fake pattern
        expect(phone.startsWith('5511999990')).toBe(true);
      }
    });

    it('should have anonymized LIDs', () => {
      const json = JSON.stringify(fixtures);

      // Check for anonymized LID pattern (100000000000xxx)
      expect(json).toContain('100000000000');
    });

    it('should have anonymized names', () => {
      const testNames = ['Alice Test', 'Bob Test', 'Charlie Test'];
      const json = JSON.stringify(fixtures);

      // Should contain our fake names
      expect(testNames.some((name) => json.includes(name))).toBe(true);
    });
  });
});
