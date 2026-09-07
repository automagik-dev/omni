/**
 * Harness transcript store
 *
 * In-memory, per (instanceId, chatId) ordered capture of everything the
 * harness channel saw: inbounds injected via say/tap and outbounds handed to
 * sendMessage(). Modeled on channel-a2a's stream-store bounds: hard caps per
 * instance and per chat so a runaway test loop cannot grow without bound.
 *
 * Bounds (documented behavior, not tunables):
 *  - MAX_CHATS_PER_INSTANCE: a NEW chat beyond the cap is refused with an
 *    error — silently evicting another chat would corrupt a running scenario.
 *  - MAX_ENTRIES_PER_CHAT: the OLDEST entries are dropped and counted in
 *    `droppedEntries`, so a transcript read can tell it is truncated.
 */

import type { HarnessTranscriptEntry } from './types';

const MAX_CHATS_PER_INSTANCE = 500;
const MAX_ENTRIES_PER_CHAT = 1000;

interface ChatTranscript {
  entries: HarnessTranscriptEntry[];
  droppedEntries: number;
  nextSeq: number;
}

export class HarnessTranscriptStore {
  private readonly instances = new Map<string, Map<string, ChatTranscript>>();

  /**
   * Append an entry (its `seq` is assigned here) and return the stored entry.
   * Throws when the chat would exceed MAX_CHATS_PER_INSTANCE.
   */
  append(instanceId: string, chatId: string, entry: Omit<HarnessTranscriptEntry, 'seq'>): HarnessTranscriptEntry {
    const chat = this.getOrCreateChat(instanceId, chatId);
    const stored = { ...entry, seq: chat.nextSeq } as HarnessTranscriptEntry;
    chat.nextSeq += 1;
    chat.entries.push(stored);
    if (chat.entries.length > MAX_ENTRIES_PER_CHAT) {
      chat.entries.splice(0, chat.entries.length - MAX_ENTRIES_PER_CHAT);
      chat.droppedEntries += 1;
    }
    return stored;
  }

  /** Ordered entries for one chat (empty transcript when the chat is unknown). */
  read(instanceId: string, chatId: string): { entries: HarnessTranscriptEntry[]; droppedEntries: number } {
    const chat = this.instances.get(instanceId)?.get(chatId);
    if (!chat) return { entries: [], droppedEntries: 0 };
    return { entries: [...chat.entries], droppedEntries: chat.droppedEntries };
  }

  /** Newest-first search over one chat's entries. */
  findLast(
    instanceId: string,
    chatId: string,
    predicate: (entry: HarnessTranscriptEntry) => boolean,
  ): HarnessTranscriptEntry | undefined {
    const chat = this.instances.get(instanceId)?.get(chatId);
    if (!chat) return undefined;
    for (let i = chat.entries.length - 1; i >= 0; i--) {
      const entry = chat.entries[i];
      if (entry && predicate(entry)) return entry;
    }
    return undefined;
  }

  findBySeq(instanceId: string, chatId: string, seq: number): HarnessTranscriptEntry | undefined {
    return this.instances
      .get(instanceId)
      ?.get(chatId)
      ?.entries.find((entry) => entry.seq === seq);
  }

  /** Drop one chat's transcript, or every transcript of the instance. */
  reset(instanceId: string, chatId?: string): void {
    if (chatId === undefined) {
      this.instances.delete(instanceId);
      return;
    }
    this.instances.get(instanceId)?.delete(chatId);
  }

  private getOrCreateChat(instanceId: string, chatId: string): ChatTranscript {
    let chats = this.instances.get(instanceId);
    if (!chats) {
      chats = new Map();
      this.instances.set(instanceId, chats);
    }
    let chat = chats.get(chatId);
    if (!chat) {
      if (chats.size >= MAX_CHATS_PER_INSTANCE) {
        throw new Error(
          `Harness chat limit reached for instance ${instanceId} (${MAX_CHATS_PER_INSTANCE}); reset transcripts to continue`,
        );
      }
      chat = { entries: [], droppedEntries: 0, nextSeq: 1 };
      chats.set(chatId, chat);
    }
    return chat;
  }
}
