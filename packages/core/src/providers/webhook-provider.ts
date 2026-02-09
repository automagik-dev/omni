/**
 * WebhookAgentProvider — sends trigger events to a webhook URL
 *
 * Supports two modes:
 * - round-trip: POST event → wait for response → return as AgentTriggerResult
 * - fire-and-forget: POST event → return null immediately (provider calls back via Omni API)
 */

import { createLogger } from '../logger';
import {
  type AgentTrigger,
  type AgentTriggerResult,
  type IAgentProvider,
  ProviderError,
  type WebhookPayload,
  type WebhookProviderConfig,
  type WebhookResponse,
} from './types';

const log = createLogger('provider:webhook');

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 1;

export class WebhookAgentProvider implements IAgentProvider {
  readonly schema = 'webhook' as const;
  readonly mode: 'round-trip' | 'fire-and-forget';

  constructor(
    readonly id: string,
    readonly name: string,
    private config: WebhookProviderConfig,
  ) {
    this.mode = config.mode;
  }

  canHandle(_trigger: AgentTrigger): boolean {
    // Webhook providers can handle all trigger types
    return true;
  }

  async trigger(context: AgentTrigger): Promise<AgentTriggerResult | null> {
    const startTime = Date.now();

    const payload: WebhookPayload = {
      event: {
        id: context.event.id,
        type: context.event.type,
        timestamp: context.event.timestamp,
      },
      instance: {
        id: context.source.instanceId,
        channelType: context.source.channelType,
      },
      chat: { id: context.source.chatId },
      sender: {
        id: context.sender.platformUserId,
        name: context.sender.displayName,
        personId: context.sender.personId,
      },
      content: {
        text: context.content.text,
        emoji: context.content.emoji,
      },
      traceId: context.traceId,
      replyEndpoint: 'POST /api/v2/messages/send',
    };

    log.info('Sending webhook trigger', {
      webhookUrl: this.config.webhookUrl,
      mode: this.mode,
      triggerType: context.type,
      traceId: context.traceId,
    });

    if (this.mode === 'fire-and-forget') {
      // POST and don't wait for meaningful response
      this.postWebhook(payload).catch((error) => {
        log.error('Fire-and-forget webhook failed', {
          error: String(error),
          traceId: context.traceId,
        });
      });
      return null;
    }

    // Round-trip: POST and wait for response
    const response = await this.postWebhookWithRetry(payload);
    const durationMs = Date.now() - startTime;

    if (!response) {
      return {
        parts: [],
        metadata: {
          runId: context.traceId,
          providerId: this.id,
          durationMs,
        },
      };
    }

    // Parse response into parts
    const parts = response.parts ?? (response.reply ? [response.reply] : []);

    return {
      parts,
      metadata: {
        runId: context.traceId,
        providerId: this.id,
        durationMs,
        ...(response.metadata ? {} : {}),
      },
    };
  }

  async checkHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const startTime = Date.now();
    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'HEAD',
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      return {
        healthy: response.ok || response.status === 405, // HEAD might not be supported
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - startTime,
        error: String(error),
      };
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Omni-Provider': 'webhook',
    };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  private async postWebhook(payload: WebhookPayload): Promise<WebhookResponse | null> {
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const response = await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new ProviderError(
        `Webhook returned ${response.status}: ${response.statusText}`,
        response.status >= 500 ? 'SERVER_ERROR' : 'INVALID_RESPONSE',
        response.status,
      );
    }

    // Try to parse JSON response
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as WebhookResponse;
    }

    // Plain text response
    const text = await response.text();
    if (text.trim()) {
      return { reply: text.trim() };
    }

    return null;
  }

  private async postWebhookWithRetry(payload: WebhookPayload): Promise<WebhookResponse | null> {
    const maxRetries = this.config.retries ?? DEFAULT_RETRIES;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.postWebhook(payload);
      } catch (error) {
        lastError = error;
        // Only retry on 5xx errors
        if (error instanceof ProviderError && error.code === 'SERVER_ERROR' && attempt < maxRetries) {
          log.warn('Webhook 5xx error, retrying', {
            attempt: attempt + 1,
            maxRetries,
            error: String(error),
          });
          // Brief backoff before retry
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }
}
