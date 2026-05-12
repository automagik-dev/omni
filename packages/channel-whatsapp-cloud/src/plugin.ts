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
import { handleMetaWebhook } from './handlers/webhook';
import {
  sendContact,
  sendLocation,
  sendMedia,
  sendReaction,
  sendTemplate,
  sendText,
  type SendTemplateButton,
  type SendTemplateHeaderMedia,
} from './senders';
import type { MetaSendResponse, WhatsAppCloudConfig } from './types';
import { MetaApiError, MetaErrorCode } from './utils/errors';

const META_MEDIA_TYPES: ReadonlySet<string> = new Set(['image', 'audio', 'video', 'document', 'sticker']);

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

    const { client } = state;
    const { content, to, replyTo, metadata } = message;

    try {
      let response: MetaSendResponse;
      if (content.type === 'text') {
        response = await sendText(client, to, content.text ?? '', replyTo);
      } else if (META_MEDIA_TYPES.has(content.type)) {
        response = await sendMedia(
          client,
          to,
          content.mediaUrl ?? '',
          content.mimeType,
          content.caption ?? content.text,
          content.filename,
          replyTo,
        );
      } else if (content.type === 'location' && content.location) {
        const { latitude, longitude, name, address } = content.location;
        response = await sendLocation(client, to, latitude, longitude, name, address, replyTo);
      } else if (content.type === 'contact' && content.contact) {
        response = await sendContact(
          client,
          to,
          [
            {
              name: content.contact.name,
              phones: content.contact.phone ? [content.contact.phone] : undefined,
              emails: content.contact.email ? [content.contact.email] : undefined,
            },
          ],
          replyTo,
        );
      } else if (content.type === 'reaction') {
        response = await sendReaction(client, to, content.targetMessageId ?? '', content.emoji ?? '');
      } else if (content.type === 'template') {
        // Template descriptor is carried via `metadata.template`. Senders/templates wire
        // this via the routes/v2/templates.ts handler when the user hits send-template;
        // for direct sendMessage calls, callers populate metadata.template themselves.
        const tpl = (metadata?.template ?? {}) as {
          name?: string;
          language?: string;
          bodyParameters?: string[];
          headerMedia?: SendTemplateHeaderMedia;
          buttonParameters?: SendTemplateButton[];
        };
        if (!tpl.name) {
          return {
            success: false,
            error: 'template send requires metadata.template.name',
            retryable: false,
            timestamp: Date.now(),
          };
        }
        response = await sendTemplate(
          client,
          to,
          tpl.name,
          tpl.language ?? 'pt_BR',
          tpl.bodyParameters,
          tpl.headerMedia,
          tpl.buttonParameters,
          replyTo,
        );
      } else {
        return {
          success: false,
          error: `Unsupported content.type=${content.type} for whatsapp-cloud`,
          retryable: false,
          timestamp: Date.now(),
        };
      }

      const messageId = response.messages?.[0]?.id;
      await this.emitMessageSent({
        instanceId,
        externalId: messageId ?? crypto.randomUUID(),
        chatId: to,
        to,
        content: {
          type: content.type,
          text: content.text,
          mediaUrl: content.mediaUrl,
        },
        replyToId: replyTo,
        senderAgentId: metadata?.senderAgentId as string | undefined,
      });

      return { success: true, messageId, timestamp: Date.now() };
    } catch (err) {
      const isMeta = err instanceof MetaApiError;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const retryable = isMeta ? err.retryable : false;

      await this.emitMessageFailed({ instanceId, chatId: to, error: errorMessage, retryable });

      return {
        success: false,
        error: errorMessage,
        errorCode: isMeta ? err.code : undefined,
        retryable,
        timestamp: Date.now(),
      };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Inbound webhook (full implementation in Group 4 — handlers/webhook.ts)
  // ─────────────────────────────────────────────────────────────

  async handleWebhook(request: Request): Promise<Response> {
    const appSecret = process.env.META_APP_SECRET ?? '';
    const verifyToken = process.env.META_VERIFY_TOKEN ?? '';

    if (!appSecret || !verifyToken) {
      this.logger.error('META_APP_SECRET or META_VERIFY_TOKEN missing — refusing to handle webhook', {
        method: request.method,
      });
      // 200 to avoid Meta disabling the app; the env misconfiguration is on us.
      return new Response('Webhook misconfigured server-side', { status: 200 });
    }

    return handleMetaWebhook(request, this, appSecret, verifyToken);
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
