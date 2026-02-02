/**
 * ALL Baileys Event Handlers
 *
 * Comprehensive handler for EVERY Baileys event.
 * Enable DEBUG_PAYLOADS=true to see full payloads.
 */

import { createLogger } from '@omni/core';
import type { WASocket } from '@whiskeysockets/baileys';
import { fromJid } from '../jid';
import type { WhatsAppPlugin } from '../plugin';

const waLog = createLogger('whatsapp:events');
const DEBUG = process.env.DEBUG_PAYLOADS === 'true';

function logEvent(event: string, data: unknown): void {
  waLog.debug('Event received', { event });
  if (DEBUG) {
    waLog.debug('Event payload', { event, data });
  }
}

/**
 * Set up handlers for ALL Baileys events
 * This captures everything for debugging and future feature development
 */
export function setupAllEventHandlers(sock: WASocket, plugin: WhatsAppPlugin, instanceId: string): void {
  // ============================================================================
  // CALLS - Voice/Video calls
  // ============================================================================
  sock.ev.on('call', (calls) => {
    for (const call of calls) {
      const { id: from } = fromJid(call.from);
      const callType = call.isVideo ? 'video' : 'voice';
      const status = call.status;

      waLog.info('Call received', { from, callType, status, callId: call.id });

      if (DEBUG) {
        logEvent('call', call);
      }

      // Emit call event
      plugin.handleCallReceived(instanceId, call.id, from, callType, status, call);
    }
  });

  // ============================================================================
  // PRESENCE - Typing indicators, online/offline status
  // ============================================================================
  sock.ev.on('presence.update', (update) => {
    const chatId = update.id;
    for (const [participant, presence] of Object.entries(update.presences)) {
      const { id: userId } = fromJid(participant);
      const lastKnown = presence.lastKnownPresence; // 'available', 'unavailable', 'composing', 'recording', 'paused'

      if (DEBUG) {
        waLog.debug('Presence update', { chatId, userId, status: lastKnown });
      }

      plugin.handlePresenceUpdate(instanceId, chatId, userId, lastKnown, presence.lastSeen);
    }
  });

  // ============================================================================
  // CHATS - Chat list updates
  // ============================================================================
  sock.ev.on('chats.upsert', (chats) => {
    if (DEBUG) logEvent('chats.upsert', { count: chats.length, chats });
    plugin.handleChatsUpsert(instanceId, chats);
  });

  sock.ev.on('chats.update', (updates) => {
    if (DEBUG) logEvent('chats.update', { count: updates.length, updates });
    plugin.handleChatsUpdate(instanceId, updates);
  });

  sock.ev.on('chats.delete', (chatIds) => {
    if (DEBUG) logEvent('chats.delete', { chatIds });
    plugin.handleChatsDelete(instanceId, chatIds);
  });

  // ============================================================================
  // CONTACTS - Contact list updates
  // ============================================================================
  sock.ev.on('contacts.upsert', (contacts) => {
    if (DEBUG) logEvent('contacts.upsert', { count: contacts.length, contacts });
    plugin.handleContactsUpsert(instanceId, contacts);
  });

  sock.ev.on('contacts.update', (updates) => {
    if (DEBUG) logEvent('contacts.update', { count: updates.length, updates });
    plugin.handleContactsUpdate(instanceId, updates);
  });

  // ============================================================================
  // GROUPS - Group metadata and participant updates
  // ============================================================================
  sock.ev.on('groups.upsert', (groups) => {
    if (DEBUG) logEvent('groups.upsert', { count: groups.length, groups });
    plugin.handleGroupsUpsert(instanceId, groups);
  });

  sock.ev.on('groups.update', (updates) => {
    if (DEBUG) logEvent('groups.update', { count: updates.length, updates });
    plugin.handleGroupsUpdate(instanceId, updates);
  });

  sock.ev.on('group-participants.update', (update) => {
    waLog.info('Group participants update', {
      action: update.action,
      groupId: update.id,
      participants: update.participants.map((p) => p.id),
    });
    if (DEBUG) logEvent('group-participants.update', update);
    plugin.handleGroupParticipantsUpdate(instanceId, update);
  });

  sock.ev.on('group.join-request', (request) => {
    waLog.info('Group join request', { groupId: request.id, participant: request.participant });
    if (DEBUG) logEvent('group.join-request', request);
    plugin.handleGroupJoinRequest(instanceId, request);
  });

  // ============================================================================
  // MESSAGE RECEIPTS - Delivery/read confirmations
  // ============================================================================
  sock.ev.on('message-receipt.update', (updates) => {
    for (const update of updates) {
      if (DEBUG) {
        waLog.debug('Message receipt update', { msgId: update.key.id });
        logEvent('message-receipt.update', update);
      }
      plugin.handleMessageReceiptUpdate(instanceId, update);
    }
  });

  // ============================================================================
  // MEDIA UPDATES - Media download/upload progress
  // ============================================================================
  sock.ev.on('messages.media-update', (updates) => {
    for (const update of updates) {
      if (DEBUG) {
        waLog.debug('Media update', { msgId: update.key.id, error: update.error?.message || 'none' });
        logEvent('messages.media-update', update);
      }
      plugin.handleMediaUpdate(instanceId, update);
    }
  });

  // ============================================================================
  // HISTORY SYNC - Initial chat/message sync
  // ============================================================================
  sock.ev.on('messaging-history.set', async (history) => {
    const { chats, contacts, messages, progress, syncType } = history;
    waLog.info('History sync', {
      chats: chats.length,
      contacts: contacts.length,
      messages: messages.length,
      progress: progress || 0,
      syncType,
    });
    if (DEBUG)
      logEvent('messaging-history.set', {
        chatCount: chats.length,
        contactCount: contacts.length,
        messageCount: messages.length,
        progress,
        syncType,
      });
    await plugin.handleHistorySync(instanceId, history);
  });

  // ============================================================================
  // BLOCKLIST - Blocked contacts
  // ============================================================================
  sock.ev.on('blocklist.set', (data) => {
    waLog.info('Blocklist set', { count: data.blocklist.length });
    if (DEBUG) logEvent('blocklist.set', data);
    plugin.handleBlocklistSet(instanceId, data.blocklist);
  });

  sock.ev.on('blocklist.update', (data) => {
    waLog.info('Blocklist update', { type: data.type, count: data.blocklist.length });
    if (DEBUG) logEvent('blocklist.update', data);
    plugin.handleBlocklistUpdate(instanceId, data.blocklist, data.type);
  });

  // ============================================================================
  // LABELS - Business labels (for WhatsApp Business)
  // ============================================================================
  sock.ev.on('labels.edit', (label) => {
    if (DEBUG) logEvent('labels.edit', label);
    plugin.handleLabelEdit(instanceId, label);
  });

  sock.ev.on('labels.association', (data) => {
    if (DEBUG) logEvent('labels.association', data);
    plugin.handleLabelAssociation(instanceId, data.association, data.type);
  });

  // ============================================================================
  // NEWSLETTERS (Channels) - WhatsApp Channels/Broadcasts
  // ============================================================================
  sock.ev.on('newsletter.reaction', (data) => {
    if (DEBUG) logEvent('newsletter.reaction', data);
  });

  sock.ev.on('newsletter.view', (data) => {
    if (DEBUG) logEvent('newsletter.view', data);
  });

  sock.ev.on('newsletter-participants.update', (data) => {
    if (DEBUG) logEvent('newsletter-participants.update', data);
  });

  sock.ev.on('newsletter-settings.update', (data) => {
    if (DEBUG) logEvent('newsletter-settings.update', data);
  });

  // ============================================================================
  // LID MAPPING - Phone number to LID mapping
  // ============================================================================
  sock.ev.on('lid-mapping.update', (data) => {
    if (DEBUG) logEvent('lid-mapping.update', data);
  });
}
