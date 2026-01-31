/**
 * ALL Baileys Event Handlers
 *
 * Comprehensive handler for EVERY Baileys event.
 * Enable DEBUG_PAYLOADS=true to see full payloads.
 */

import type { WASocket } from '@whiskeysockets/baileys';
import type { WhatsAppPlugin } from '../plugin';
import { fromJid } from '../jid';

const DEBUG = process.env.DEBUG_PAYLOADS === 'true';

function log(event: string, data: unknown): void {
  console.log(`[WA Event] ${event}`);
  if (DEBUG) {
    console.log(JSON.stringify(data, null, 2));
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

      console.log(`[WA Call] ${callType} call from=${from} status=${status} id=${call.id}`);

      if (DEBUG) {
        log('call', call);
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
        console.log(`[WA Presence] chat=${chatId} user=${userId} status=${lastKnown}`);
      }

      plugin.handlePresenceUpdate(instanceId, chatId, userId, lastKnown, presence.lastSeen);
    }
  });

  // ============================================================================
  // CHATS - Chat list updates
  // ============================================================================
  sock.ev.on('chats.upsert', (chats) => {
    if (DEBUG) log('chats.upsert', { count: chats.length, chats });
    plugin.handleChatsUpsert(instanceId, chats);
  });

  sock.ev.on('chats.update', (updates) => {
    if (DEBUG) log('chats.update', { count: updates.length, updates });
    plugin.handleChatsUpdate(instanceId, updates);
  });

  sock.ev.on('chats.delete', (chatIds) => {
    if (DEBUG) log('chats.delete', { chatIds });
    plugin.handleChatsDelete(instanceId, chatIds);
  });

  // ============================================================================
  // CONTACTS - Contact list updates
  // ============================================================================
  sock.ev.on('contacts.upsert', (contacts) => {
    if (DEBUG) log('contacts.upsert', { count: contacts.length, contacts });
    plugin.handleContactsUpsert(instanceId, contacts);
  });

  sock.ev.on('contacts.update', (updates) => {
    if (DEBUG) log('contacts.update', { count: updates.length, updates });
    plugin.handleContactsUpdate(instanceId, updates);
  });

  // ============================================================================
  // GROUPS - Group metadata and participant updates
  // ============================================================================
  sock.ev.on('groups.upsert', (groups) => {
    if (DEBUG) log('groups.upsert', { count: groups.length, groups });
    plugin.handleGroupsUpsert(instanceId, groups);
  });

  sock.ev.on('groups.update', (updates) => {
    if (DEBUG) log('groups.update', { count: updates.length, updates });
    plugin.handleGroupsUpdate(instanceId, updates);
  });

  sock.ev.on('group-participants.update', (update) => {
    console.log(`[WA Group] ${update.action} in ${update.id}: ${update.participants.map(p => p.id).join(', ')}`);
    if (DEBUG) log('group-participants.update', update);
    plugin.handleGroupParticipantsUpdate(instanceId, update);
  });

  sock.ev.on('group.join-request', (request) => {
    console.log(`[WA Group] Join request for ${request.id} from ${request.participant}`);
    if (DEBUG) log('group.join-request', request);
    plugin.handleGroupJoinRequest(instanceId, request);
  });

  // ============================================================================
  // MESSAGE RECEIPTS - Delivery/read confirmations
  // ============================================================================
  sock.ev.on('message-receipt.update', (updates) => {
    for (const update of updates) {
      if (DEBUG) {
        console.log(`[WA Receipt] msg=${update.key.id}`);
        log('message-receipt.update', update);
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
        console.log(`[WA Media] msg=${update.key.id} error=${update.error?.message || 'none'}`);
        log('messages.media-update', update);
      }
      plugin.handleMediaUpdate(instanceId, update);
    }
  });

  // ============================================================================
  // HISTORY SYNC - Initial chat/message sync
  // ============================================================================
  sock.ev.on('messaging-history.set', (history) => {
    const { chats, contacts, messages, progress, syncType } = history;
    console.log(`[WA History] chats=${chats.length} contacts=${contacts.length} messages=${messages.length} progress=${progress || 0}% type=${syncType}`);
    if (DEBUG) log('messaging-history.set', { chatCount: chats.length, contactCount: contacts.length, messageCount: messages.length, progress, syncType });
    plugin.handleHistorySync(instanceId, history);
  });

  // ============================================================================
  // BLOCKLIST - Blocked contacts
  // ============================================================================
  sock.ev.on('blocklist.set', (data) => {
    console.log(`[WA Blocklist] Set ${data.blocklist.length} blocked contacts`);
    if (DEBUG) log('blocklist.set', data);
    plugin.handleBlocklistSet(instanceId, data.blocklist);
  });

  sock.ev.on('blocklist.update', (data) => {
    console.log(`[WA Blocklist] ${data.type} ${data.blocklist.length} contacts`);
    if (DEBUG) log('blocklist.update', data);
    plugin.handleBlocklistUpdate(instanceId, data.blocklist, data.type);
  });

  // ============================================================================
  // LABELS - Business labels (for WhatsApp Business)
  // ============================================================================
  sock.ev.on('labels.edit', (label) => {
    if (DEBUG) log('labels.edit', label);
    plugin.handleLabelEdit(instanceId, label);
  });

  sock.ev.on('labels.association', (data) => {
    if (DEBUG) log('labels.association', data);
    plugin.handleLabelAssociation(instanceId, data.association, data.type);
  });

  // ============================================================================
  // NEWSLETTERS (Channels) - WhatsApp Channels/Broadcasts
  // ============================================================================
  sock.ev.on('newsletter.reaction', (data) => {
    if (DEBUG) log('newsletter.reaction', data);
  });

  sock.ev.on('newsletter.view', (data) => {
    if (DEBUG) log('newsletter.view', data);
  });

  sock.ev.on('newsletter-participants.update', (data) => {
    if (DEBUG) log('newsletter-participants.update', data);
  });

  sock.ev.on('newsletter-settings.update', (data) => {
    if (DEBUG) log('newsletter-settings.update', data);
  });

  // ============================================================================
  // LID MAPPING - Phone number to LID mapping
  // ============================================================================
  sock.ev.on('lid-mapping.update', (data) => {
    if (DEBUG) log('lid-mapping.update', data);
  });
}
