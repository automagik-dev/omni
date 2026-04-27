/**
 * Bot Framework Connector REST client.
 *
 * Outbound activities go to `{serviceUrl}/v3/conversations/{conversationId}/activities`
 * with a Bearer token acquired via the AAD client-credentials flow.
 *
 * We deliberately speak the wire protocol directly (instead of pulling in
 * `botbuilder` + `botframework-connector`) for two reasons:
 *
 * 1. The official SDK adds ~7 MB of transitive dependencies and an Express
 *    runtime adapter we don't use; Omni already owns its HTTP router.
 * 2. The wire protocol is small and documented (just JSON activities + a
 *    Bearer token) — the only state we need is the service URL per
 *    conversation, which the inbound handler captures.
 *
 * If a future requirement needs the SDK's TurnContext middleware stack we
 * can drop it in behind this thin facade.
 */

import type { TeamsConnectionOptions } from '../types';
import { type TeamsAccessToken, acquireAccessToken } from './auth';

/** Outbound Bot Framework activity payload — type-only mirror of the SDK shape. */
export interface BotActivityPayload {
  type: 'message' | 'typing' | 'messageReaction';
  text?: string;
  textFormat?: 'plain' | 'markdown' | 'xml';
  attachments?: Array<{
    contentType: string;
    contentUrl?: string;
    name?: string;
    content?: unknown;
  }>;
  replyToId?: string;
  reactionsAdded?: Array<{ type: string }>;
  reactionsRemoved?: Array<{ type: string }>;
  /** Optional `Activity.entities` (mentions etc.) */
  entities?: Array<Record<string, unknown>>;
  /** Optional summary for accessibility */
  summary?: string;
  /** Conversation reference (set by the client) */
  conversation?: { id: string };
  from?: { id: string; name?: string };
  recipient?: { id: string; name?: string };
}

export interface SendActivityResult {
  /** Service-assigned activity ID — `id` field of the connector response */
  activityId: string;
}

export interface BotFrameworkClientOptions {
  options: TeamsConnectionOptions;
  /** Override fetch (used in tests) */
  fetchImpl?: typeof fetch;
  /** Skew (ms) subtracted from token expiry to refresh proactively */
  refreshSkewMs?: number;
}

/**
 * Per-instance Bot Framework client. Caches the AAD token until ~1 minute
 * before expiry; re-acquires lazily.
 */
export class BotFrameworkClient {
  private readonly options: TeamsConnectionOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly refreshSkewMs: number;
  private cachedToken: TeamsAccessToken | null = null;
  private inflight: Promise<TeamsAccessToken> | null = null;

  constructor(opts: BotFrameworkClientOptions) {
    this.options = opts.options;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.refreshSkewMs = opts.refreshSkewMs ?? 60_000;
  }

  /**
   * Acquire (or reuse) a valid Bearer token.
   */
  async getToken(): Promise<TeamsAccessToken> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt - this.refreshSkewMs > now) {
      return this.cachedToken;
    }
    if (this.inflight) return this.inflight;

    this.inflight = acquireAccessToken(this.options, this.fetchImpl).then((token) => {
      this.cachedToken = token;
      this.inflight = null;
      return token;
    });
    try {
      return await this.inflight;
    } catch (err) {
      this.inflight = null;
      throw err;
    }
  }

  /**
   * Send an activity to a conversation.
   */
  async sendActivity(
    serviceUrl: string,
    conversationId: string,
    activity: BotActivityPayload,
  ): Promise<SendActivityResult> {
    const token = await this.getToken();
    const url = `${trimTrailingSlash(serviceUrl)}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `${token.tokenType} ${token.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(activity),
    });

    if (!response.ok) {
      const detail = await safeRead(response);
      throw new BotFrameworkRequestError(response.status, detail);
    }

    const json = (await response.json()) as { id?: string };
    return { activityId: json.id ?? '' };
  }

  /**
   * Reply to an existing activity in a conversation. Used for thread replies.
   */
  async replyToActivity(
    serviceUrl: string,
    conversationId: string,
    activityId: string,
    activity: BotActivityPayload,
  ): Promise<SendActivityResult> {
    const token = await this.getToken();
    const url = `${trimTrailingSlash(serviceUrl)}/v3/conversations/${encodeURIComponent(
      conversationId,
    )}/activities/${encodeURIComponent(activityId)}`;

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `${token.tokenType} ${token.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...activity, replyToId: activityId }),
    });

    if (!response.ok) {
      const detail = await safeRead(response);
      throw new BotFrameworkRequestError(response.status, detail);
    }

    const json = (await response.json()) as { id?: string };
    return { activityId: json.id ?? '' };
  }
}

export class BotFrameworkRequestError extends Error {
  readonly httpStatus: number;
  constructor(httpStatus: number, detail: string) {
    super(`Bot Framework request failed (${httpStatus}): ${detail}`);
    this.name = 'BotFrameworkRequestError';
    this.httpStatus = httpStatus;
  }
}

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

async function safeRead(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 512);
  } catch {
    return '';
  }
}
