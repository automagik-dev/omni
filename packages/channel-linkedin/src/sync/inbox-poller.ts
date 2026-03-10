/**
 * Inbox Poller — periodic inbox sync with in-memory diffing.
 *
 * Replaces scan_raw.py's manual polling with automated continuous sync.
 *
 * On each tick:
 * 1. Scrape conversations via scrapeConversations()
 * 2. Diff against previously known conversations (in-memory cache)
 * 3. For NEW messages: emit message.received events
 * 4. Update the in-memory cache
 */

import type { Logger } from '@omni/channel-sdk';
import type { Page } from 'playwright';
import { scrapeConversations } from '../scrapers/inbox';
import type { LinkedInConversation, LinkedInMessage } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InboxPollerConfig {
  /** Playwright Page instance (must be navigable to /messaging/) */
  page: Page;
  /** Instance ID */
  instanceId: string;
  /** Logger instance */
  logger: Logger;
  /** Callback for emitting message.received events */
  onMessageReceived?: (message: LinkedInMessage, conversation: LinkedInConversation) => Promise<void>;
}

// ---------------------------------------------------------------------------
// InboxPoller
// ---------------------------------------------------------------------------

export class InboxPoller {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly config: InboxPollerConfig;
  private running = false;

  /**
   * In-memory cache of last known conversation previews, keyed by
   * participant name(s) concatenated. Used for diffing to detect new messages.
   */
  private lastKnown = new Map<string, string>();

  constructor(config: InboxPollerConfig) {
    this.config = config;
  }

  /**
   * Start periodic inbox polling.
   *
   * @param intervalMs - Polling interval in milliseconds (default: 5 min)
   */
  start(intervalMs = 5 * 60 * 1000): void {
    if (this.intervalHandle) {
      this.config.logger.warn('InboxPoller already running, skipping start');
      return;
    }

    this.config.logger.info('InboxPoller started', { intervalMs });

    // Run immediately on start, then on interval
    void this.tick();
    this.intervalHandle = setInterval(() => void this.tick(), intervalMs);
  }

  /**
   * Stop the periodic polling.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.config.logger.info('InboxPoller stopped');
    }
  }

  /**
   * Whether the poller is currently running.
   */
  isRunning(): boolean {
    return this.intervalHandle !== null;
  }

  /**
   * Ensure the page is on the messaging URL, navigating if needed.
   */
  private async ensureOnMessaging(): Promise<void> {
    const currentUrl = this.config.page.url();
    if (currentUrl.includes('/messaging')) return;

    await this.config.page.goto('https://www.linkedin.com/messaging/', {
      waitUntil: 'domcontentloaded',
    });
    await new Promise((r) => setTimeout(r, 3000));
  }

  /**
   * Extract new lines from a conversation preview compared to the cached version.
   */
  private extractNewLines(currentPreview: string, previousPreview: string): string[] {
    const previousLines = new Set(
      previousPreview
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    );
    const currentLines = currentPreview
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    return currentLines.filter((line) => !previousLines.has(line));
  }

  /**
   * Diff a single conversation against the cache and emit new messages.
   * Returns the number of new messages emitted.
   */
  private async diffConversation(convo: LinkedInConversation): Promise<number> {
    const key = convo.participantNames.join(', ');
    const currentPreview = convo.lastMessagePreview ?? '';
    const previousPreview = this.lastKnown.get(key);

    // First run: seed the cache without emitting events
    if (previousPreview === undefined) {
      this.lastKnown.set(key, currentPreview);
      return 0;
    }

    if (currentPreview === previousPreview || currentPreview.length === 0) return 0;

    const newLines = this.extractNewLines(currentPreview, previousPreview);
    if (newLines.length === 0) return 0;

    for (let i = 0; i < newLines.length; i++) {
      const line = newLines[i] as string;
      const message: LinkedInMessage = {
        externalId: `${key}-${Date.now()}-${i}`,
        conversationId: convo.externalId,
        senderName: convo.participantNames[0] ?? 'Unknown',
        body: line,
        timestamp: Date.now(),
        isOutgoing: false,
      };

      if (this.config.onMessageReceived) {
        await this.config.onMessageReceived(message, convo);
      }
    }

    this.lastKnown.set(key, currentPreview);
    return newLines.length;
  }

  /**
   * Execute a single sync cycle.
   */
  private async tick(): Promise<void> {
    if (this.running) {
      this.config.logger.debug('InboxPoller tick skipped (previous tick still running)');
      return;
    }

    this.running = true;
    const start = Date.now();

    try {
      this.config.logger.debug('InboxPoller tick starting');
      await this.ensureOnMessaging();

      const conversations = await scrapeConversations(this.config.page, {
        limit: 20,
        maxMessagesPerConvo: 15,
      });

      let newMessageCount = 0;
      for (const convo of conversations) {
        newMessageCount += await this.diffConversation(convo);
      }

      const elapsed = Date.now() - start;
      this.config.logger.info('InboxPoller tick complete', {
        conversationsScanned: conversations.length,
        newMessages: newMessageCount,
        elapsedMs: elapsed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.config.logger.error('InboxPoller tick failed', { error: message });
    } finally {
      this.running = false;
    }
  }
}
