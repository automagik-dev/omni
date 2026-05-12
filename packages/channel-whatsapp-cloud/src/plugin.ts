/**
 * WhatsApp Cloud (Meta) channel plugin.
 *
 * Implements `BaseChannelPlugin` for the official Meta WhatsApp Cloud API:
 *   - Outbound via REST (Graph API v25.0 by default).
 *   - Inbound via webhook with HMAC-SHA256 (`X-Hub-Signature-256`) verification.
 *   - 24h messaging window enforced by Meta — only HSM templates ship outside it.
 *
 * Per-instance state: `MetaWhatsAppClient` (scoped to one phone_number_id +
 * access_token) + dedupe cache keyed by `wamid`.
 */

import { BaseChannelPlugin, createInboundDedupeCache } from '@omni/channel-sdk';
import type {
  ChannelCapabilities,
  DedupeCache,
  FetchHistoryOptions,
  FetchHistoryResult,
  HealthCheck,
  InstanceConfig,
  OutgoingMessage,
  PluginContext,
  SendResult,
} from '@omni/channel-sdk';
import type { Logger } from '@omni/core';
import type { ChannelType } from '@omni/core/types';

import { WHATSAPP_CLOUD_CAPABILITIES } from './capabilities';
import { MetaWhatsAppClient } from './client';
import type { WhatsAppCloudConfig } from './types';
import { MetaApiError, MetaErrorCode } from './utils/errors';

interface WhatsAppCloudInstanceState {
  client: MetaWhatsAppClient;
  config: WhatsAppCloudConfig;
  dedupeCache: DedupeCache;
}

export class WhatsAppCloudPlugin extends BaseChannelPlugin {
  readonly id = 'whatsapp-cloud' as ChannelType;
  readonly name = 'WhatsApp (Meta Cloud API)';
  readonly version = '1.0.0';
  readonly capabilities: ChannelCapabilities = WHATSAPP_CLOUD_CAPABILITIES;

  /** instanceId → live state */
  private waCloudInstances = new Map<string, WhatsAppCloudInstanceState>();

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────

  protected override async onInitialize(_context: PluginContext): Promise<void> {
    this.logger.info('WhatsApp Cloud plugin initialized');
  }

  protected override async onDestroy(): Promise<void> {
    for (const [, state] of this.waCloudInstances) {
      state.dedupeCache.dispose();
    }
    this.waCloudInstances.clear();
    this.logger.info('WhatsApp Cloud plugin destroyed');
  }

  // ─────────────────────────────────────────────────────────────
  // Connection
  // ─────────────────────────────────────────────────────────────

  /**
   * Connect an instance using the persisted Meta config.
   *
   * `config.credentials` is expected to carry:
   *   - metaAccessToken (required)
   *   - metaPhoneNumberId (required)
   *   - metaWabaId (required)
   *   - metaAppId / metaBusinessId / metaApiVersion / metaDisplayPhoneNumber /
   *     metaConnectionMethod (optional)
   *
   * The OAuth flow that populates these values lives in Group 5
   * (packages/api/src/routes/v2/whatsapp-cloud.ts → exchange/connect routes).
   */
  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    const creds = (config.credentials ?? {}) as Record<string, unknown>;
    const opts = (config.options ?? {}) as Record<string, unknown>;

    const accessToken = (creds.metaAccessToken ?? opts.metaAccessToken) as string | undefined;
    const phoneNumberId = (creds.metaPhoneNumberId ?? opts.metaPhoneNumberId) as string | undefined;
    const wabaId = (creds.metaWabaId ?? opts.metaWabaId) as string | undefined;

    if (!accessToken) {
      throw new MetaApiError(MetaErrorCode.AUTH_FAILED, 'metaAccessToken is required to connect a whatsapp-cloud instance');
    }
    if (!phoneNumberId) {
      throw new MetaApiError(
        MetaErrorCode.PHONE_NOT_FOUND,
        'metaPhoneNumberId is required to connect a whatsapp-cloud instance',
      );
    }
    if (!wabaId) {
      throw new MetaApiError(
        MetaErrorCode.INVALID_REQUEST,
        'metaWabaId is required to connect a whatsapp-cloud instance',
      );
    }

    const apiVersion = ((creds.metaApiVersion ?? opts.metaApiVersion) as string | undefined) ?? 'v25.0';
    const appId = (creds.metaAppId ?? opts.metaAppId) as string | undefined;
    const businessId = (creds.metaBusinessId ?? opts.metaBusinessId) as string | undefined;
    const displayPhoneNumber = (creds.metaDisplayPhoneNumber ?? opts.metaDisplayPhoneNumber) as string | undefined;
    const connectionMethod = ((creds.metaConnectionMethod ?? opts.metaConnectionMethod) as string | undefined) ?? 'manual';

    this.logger.info('Connecting WhatsApp Cloud instance', { instanceId, phoneNumberId, wabaId, connectionMethod });

    const client = new MetaWhatsAppClient(
      {
        phoneNumberId,
        accessToken,
        apiVersion,
      },
      wabaId,
    );

    // Validate the token by hitting GET /{phone_number_id}.
    const reachable = await client.ping();
    if (!reachable) {
      throw new MetaApiError(
        MetaErrorCode.AUTH_FAILED,
        'Meta access token rejected or phone_number_id unreachable — check credentials',
        { operation: 'connect' },
      );
    }

    const cloudConfig: WhatsAppCloudConfig = {
      accessToken,
      phoneNumberId,
      wabaId,
      appId,
      businessId,
      apiVersion,
      connectionMethod,
      displayPhoneNumber,
    };
    const dedupeCache = createInboundDedupeCache();

    this.waCloudInstances.set(instanceId, { client, config: cloudConfig, dedupeCache });

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
      message: `Connected via Meta Cloud API (${connectionMethod})`,
    });

    await this.emitInstanceConnected(instanceId, {
      profileName: displayPhoneNumber ?? 'WhatsApp Cloud',
      ownerIdentifier: phoneNumberId,
    });

    this.logger.info('WhatsApp Cloud instance connected', { instanceId, phoneNumberId });
  }

  async disconnect(instanceId: string): Promise<void> {
    this.logger.info('Disconnecting WhatsApp Cloud instance', { instanceId });

    const state = this.waCloudInstances.get(instanceId);
    if (state) {
      state.dedupeCache.dispose();
      this.waCloudInstances.delete(instanceId);
    }

    this.instances.setInstance(instanceId, {} as InstanceConfig, {
      state: 'disconnected',
      since: new Date(),
      message: 'Disconnected',
    });

    await this.emitInstanceDisconnected(instanceId, 'Manual disconnect');
  }

  // ─────────────────────────────────────────────────────────────
  // Outbound (full implementation in Group 3 — senders/*)
  // ─────────────────────────────────────────────────────────────

  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const state = this.waCloudInstances.get(instanceId);
    if (!state) {
      return {
        success: false,
        error: 'WhatsApp Cloud instance not connected',
        retryable: false,
        timestamp: Date.now(),
      };
    }

    // NOTE: Group 3 wires up the sender dispatcher (text/media/location/contact/
    // reaction/template). Until then, this is a stub that errors loudly so the
    // bundled-server-entry doesn't silently mis-route messages.
    this.logger.warn('WhatsApp Cloud sendMessage stub — Group 3 senders not yet wired', {
      instanceId,
      contentType: message.content.type,
    });
    return {
      success: false,
      error: `WhatsApp Cloud senders not implemented (Group 3 pending) — content.type=${message.content.type}`,
      retryable: false,
      timestamp: Date.now(),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Inbound webhook (full implementation in Group 4 — handlers/webhook.ts)
  // ─────────────────────────────────────────────────────────────

  async handleWebhook(request: Request): Promise<Response> {
    // NOTE: Group 4 implements the full webhook handler with HMAC-SHA256
    // verification, payload parsing, idempotency, and event emission. For now
    // we 503 explicitly so Meta retries land in observability.
    this.logger.warn('WhatsApp Cloud webhook stub hit — Group 4 handler not yet wired', {
      method: request.method,
      url: request.url,
    });
    return new Response('whatsapp-cloud webhook handler not yet implemented', { status: 503 });
  }

  // ─────────────────────────────────────────────────────────────
  // Health
  // ─────────────────────────────────────────────────────────────

  async getHealth(instanceId?: string): Promise<HealthStatus> {
    const checks: HealthCheck[] = [];
    const states = instanceId
      ? this.waCloudInstances.has(instanceId)
        ? [[instanceId, this.waCloudInstances.get(instanceId)!] as const]
        : []
      : Array.from(this.waCloudInstances.entries());

    for (const [id, state] of states) {
      const ok = await state.client.ping();
      checks.push({
        name: `whatsapp-cloud:${id}`,
        status: ok ? 'pass' : 'fail',
        message: ok
          ? `Phone ${state.config.phoneNumberId} reachable`
          : `Phone ${state.config.phoneNumberId} unreachable — token rejected or network error`,
        lastChecked: new Date(),
      });
    }

    return {
      status: checks.length === 0 || checks.every((c) => c.status === 'pass') ? 'healthy' : 'unhealthy',
      checks,
      lastChecked: new Date(),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // History (not supported — Meta does not expose backfill).
  // ─────────────────────────────────────────────────────────────

  async fetchHistory(_instanceId: string, _options: FetchHistoryOptions): Promise<FetchHistoryResult> {
    return { totalFetched: 0, messages: [] };
  }

  // ─────────────────────────────────────────────────────────────
  // Public accessors used by the webhook handler (Group 4)
  // ─────────────────────────────────────────────────────────────

  /** Look up the live state for an instance — used by the webhook handler. */
  getInstanceState(instanceId: string): WhatsAppCloudInstanceState | undefined {
    return this.waCloudInstances.get(instanceId);
  }

  /** Iterate all connected instance ids — used by webhook for phone_number_id → instance resolution. */
  getConnectedInstanceIds(): string[] {
    return Array.from(this.waCloudInstances.keys());
  }

  /**
   * Reverse lookup: given a phone_number_id from a webhook payload, find the
   * matching instance. Returns `[instanceId, state]` or `undefined`.
   *
   * The Meta webhook is global — there's no path-based instance id — so this
   * is the resolution mechanism used by `handleWebhook` after signature
   * verification.
   */
  findInstanceByPhoneNumberId(phoneNumberId: string): readonly [string, WhatsAppCloudInstanceState] | undefined {
    for (const [id, state] of this.waCloudInstances) {
      if (state.config.phoneNumberId === phoneNumberId) return [id, state] as const;
    }
    return undefined;
  }

  getLogger(): Logger {
    return this.logger;
  }
}

/** Re-export so tests / public health typing don't need to dig into channel-sdk. */
type HealthStatus = import('@omni/channel-sdk').HealthStatus;
