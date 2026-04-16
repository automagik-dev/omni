/**
 * Regression tests for #374 — LID/JID canonicalization in WhatsApp message
 * handlers. Baileys can route messages from the same human under both
 * `<lid>@lid` and `<phone>@s.whatsapp.net`, which fragments the debounce
 * buffer and per-chat / per-user sessions. The handlers must collapse both
 * forms onto the LID canonical form before the event is published.
 */

import { describe, expect, it } from 'bun:test';
import type { WAMessage } from 'baileys';
import { resolveChatId, resolveSenderJid } from '../handlers/messages';
import { WhatsAppPlugin } from '../plugin';

const LID_JID = '217046273028329@lid';
const PHONE_JID = '555197285829@s.whatsapp.net';
const GROUP_JID = '120363000000000000@g.us';
const PARTICIPANT_LID = '217046273028329@lid';
const PARTICIPANT_PHONE = '555197285829@s.whatsapp.net';

function buildPlugin(opts?: { lidFirstEnabled?: boolean }): WhatsAppPlugin {
  const plugin = new WhatsAppPlugin();
  // Plugin defers logger creation until init(); stub it for unit tests.
  (plugin as unknown as { logger: Record<string, (...args: unknown[]) => void> }).logger = {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  };
  if (opts?.lidFirstEnabled === false) {
    (plugin as unknown as { lidFirstEnabledMap: Map<string, boolean> }).lidFirstEnabledMap.set('inst', false);
  }
  return plugin;
}

function buildMessage(opts: {
  remoteJid: string;
  remoteJidAlt?: string;
  participant?: string;
  participantAlt?: string;
  fromMe?: boolean;
}): WAMessage {
  const key: Record<string, unknown> = {
    remoteJid: opts.remoteJid,
    fromMe: opts.fromMe ?? false,
    id: '3EB0AAAA',
  };
  if (opts.remoteJidAlt) key.remoteJidAlt = opts.remoteJidAlt;
  if (opts.participant) key.participant = opts.participant;
  if (opts.participantAlt) key.participantAlt = opts.participantAlt;
  return { key, message: { conversation: 'hi' } } as unknown as WAMessage;
}

describe('LID/JID canonicalization (#374)', () => {
  describe('storeLidMapping', () => {
    it('stores both lid→phone and phone→lid in the same cache', () => {
      const plugin = buildPlugin();
      plugin.storeLidMapping('inst', LID_JID, PHONE_JID);

      const cache = plugin.getLidMappingCache('inst');
      expect(cache.get(LID_JID)).toBe(PHONE_JID);
      expect(cache.get(PHONE_JID)).toBe(LID_JID);
    });
  });

  describe('resolveChatId — LID-first mode', () => {
    it('keeps a LID chatId unchanged and stamps the raw chatId', () => {
      const plugin = buildPlugin();
      const msg = buildMessage({ remoteJid: LID_JID, remoteJidAlt: PHONE_JID });

      const { chatId, rawChatId } = resolveChatId(plugin, 'inst', msg);

      expect(chatId).toBe(LID_JID);
      expect(rawChatId).toBe(LID_JID);
    });

    it('upgrades a phone chatId to LID via remoteJidAlt', () => {
      const plugin = buildPlugin();
      const msg = buildMessage({ remoteJid: PHONE_JID, remoteJidAlt: LID_JID });

      const { chatId, rawChatId } = resolveChatId(plugin, 'inst', msg);

      expect(chatId).toBe(LID_JID);
      expect(rawChatId).toBe(PHONE_JID);
    });

    it('collapses two messages from the same human onto a single chatId', () => {
      const plugin = buildPlugin();
      // First message arrives via @lid with the phone JID as alt — populates
      // the bidirectional cache.
      const first = buildMessage({ remoteJid: LID_JID, remoteJidAlt: PHONE_JID });
      const second = buildMessage({ remoteJid: PHONE_JID });

      const a = resolveChatId(plugin, 'inst', first);
      const b = resolveChatId(plugin, 'inst', second);

      expect(a.chatId).toBe(LID_JID);
      expect(b.chatId).toBe(LID_JID);
      // Same canonical chatId means a single debounce buffer for this human.
      expect(a.chatId).toBe(b.chatId);
    });

    it('falls back to the phone JID when no mapping is known yet', () => {
      const plugin = buildPlugin();
      const msg = buildMessage({ remoteJid: PHONE_JID });

      const { chatId } = resolveChatId(plugin, 'inst', msg);

      expect(chatId).toBe(PHONE_JID);
    });

    it('leaves group chat IDs unchanged', () => {
      const plugin = buildPlugin();
      // Pre-seed cache to prove canonicalization does not touch group JIDs.
      plugin.storeLidMapping('inst', LID_JID, PHONE_JID);
      const msg = buildMessage({ remoteJid: GROUP_JID, participant: PARTICIPANT_PHONE });

      const { chatId, rawChatId } = resolveChatId(plugin, 'inst', msg);

      expect(chatId).toBe(GROUP_JID);
      expect(rawChatId).toBe(GROUP_JID);
    });
  });

  describe('resolveChatId — legacy (lidFirstEnabled=false)', () => {
    it('still downconverts LID to phone (no regression)', () => {
      const plugin = buildPlugin({ lidFirstEnabled: false });
      const msg = buildMessage({ remoteJid: LID_JID, remoteJidAlt: PHONE_JID });

      const { chatId, rawChatId } = resolveChatId(plugin, 'inst', msg);

      expect(chatId).toBe(PHONE_JID);
      expect(rawChatId).toBe(LID_JID);
    });
  });

  describe('resolveSenderJid — LID-first mode', () => {
    it('canonicalizes a phone-form sender to LID for stable per_user sessions', () => {
      const plugin = buildPlugin();
      // Group chat where the same human has been seen as a LID before.
      plugin.storeLidMapping('inst', PARTICIPANT_LID, PARTICIPANT_PHONE);
      const msg = buildMessage({
        remoteJid: GROUP_JID,
        participant: PARTICIPANT_PHONE,
      });

      const sender = resolveSenderJid(plugin, 'inst', msg, GROUP_JID);

      expect(sender).toBe(PARTICIPANT_LID);
    });

    it('collapses LID and phone sender forms onto one identity', () => {
      const plugin = buildPlugin();
      // Sender first arrives as a LID with participantAlt pointing to the
      // phone JID — populates the bidirectional cache.
      const lidMsg = buildMessage({
        remoteJid: GROUP_JID,
        participant: PARTICIPANT_LID,
        participantAlt: PARTICIPANT_PHONE,
      });
      const phoneMsg = buildMessage({
        remoteJid: GROUP_JID,
        participant: PARTICIPANT_PHONE,
      });

      const a = resolveSenderJid(plugin, 'inst', lidMsg, GROUP_JID);
      const b = resolveSenderJid(plugin, 'inst', phoneMsg, GROUP_JID);

      expect(a).toBe(PARTICIPANT_LID);
      expect(b).toBe(PARTICIPANT_LID);
      expect(a).toBe(b);
    });
  });
});
