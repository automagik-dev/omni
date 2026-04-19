/**
 * Microsoft Teams Channel Plugin
 *
 * Provides Microsoft Teams messaging via the Bot Framework SDK (`botbuilder`).
 *
 * Scaffold scope (issue #433):
 * - `connect()` creates a CloudAdapter from Azure Bot credentials.
 * - `disconnect()` releases the adapter and clears stored conversation references.
 * - `sendMessage()` uses `adapter.continueConversationAsync` with a stored
 *   ConversationReference keyed by conversation ID.
 * - `handleWebhook()` forwards the incoming activity into `adapter.process`,
 *   captures the ConversationReference, and emits `message.received`.
 *
 * Media, reactions, streaming, and richer Teams features are declared in
 * capabilities but left for follow-up work — this plugin only wires the
 * text-messaging path end-to-end.
 */

import { BaseChannelPlugin } from '@omni/channel-sdk';
import type { ChannelCapabilities, InstanceConfig, OutgoingMessage, SendResult } from '@omni/channel-sdk';
import type { ChannelType } from '@omni/core/types';
import { CloudAdapter, ConfigurationBotFrameworkAuthentication, TurnContext } from 'botbuilder';
import type { Activity, ConversationReference } from 'botbuilder';

import { MSTEAMS_CAPABILITIES } from './capabilities';
import type { MsTeamsConfig } from './types';

interface InstanceState {
  adapter: CloudAdapter;
  appId: string;
  conversationRefs: Map<string, Partial<ConversationReference>>;
}

export class MsTeamsPlugin extends BaseChannelPlugin {
  readonly id: ChannelType = 'msteams';
  readonly name = 'Microsoft Teams (botbuilder)';
  readonly version = '0.1.0';
  readonly capabilities: ChannelCapabilities = MSTEAMS_CAPABILITIES;

  private readonly instanceStates = new Map<string, InstanceState>();

  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    if (this.instanceStates.has(instanceId)) {
      this.logger.warn('Instance already connected', { instanceId });
      return;
    }

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connecting',
      since: new Date(),
    });

    const credentials = this.resolveCredentials(config);

    const auth = new ConfigurationBotFrameworkAuthentication({
      MicrosoftAppId: credentials.appId,
      MicrosoftAppPassword: credentials.appPassword,
      MicrosoftAppType: credentials.appType ?? 'MultiTenant',
      MicrosoftAppTenantId: credentials.tenantId,
    });

    const adapter = new CloudAdapter(auth);

    adapter.onTurnError = async (context, error) => {
      this.logger.error('Teams turn error', {
        instanceId,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await context.sendActivity('The bot encountered an error.');
      } catch {
        // best effort — do not rethrow from error handler
      }
    };

    this.instanceStates.set(instanceId, {
      adapter,
      appId: credentials.appId,
      conversationRefs: new Map(),
    });

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
    });
    await this.emitInstanceConnected(instanceId, {
      ownerIdentifier: credentials.appId,
    });
  }

  async disconnect(instanceId: string): Promise<void> {
    const state = this.instanceStates.get(instanceId);
    if (!state) {
      this.logger.debug('Disconnect called for unknown instance', { instanceId });
      return;
    }

    state.conversationRefs.clear();
    this.instanceStates.delete(instanceId);

    const entry = this.instances.get(instanceId);
    if (entry) {
      await this.updateInstanceStatus(instanceId, entry.config, {
        state: 'disconnected',
        since: new Date(),
      });
    }

    await this.emitInstanceDisconnected(instanceId, 'disconnect requested');
  }

  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const state = this.instanceStates.get(instanceId);
    if (!state) {
      const error = `Instance ${instanceId} is not connected`;
      await this.emitMessageFailed({
        instanceId,
        chatId: message.to,
        error,
        retryable: false,
      });
      return { success: false, error, retryable: false, timestamp: Date.now() };
    }

    const reference = state.conversationRefs.get(message.to);
    if (!reference) {
      const error = `No ConversationReference stored for ${message.to}`;
      await this.emitMessageFailed({
        instanceId,
        chatId: message.to,
        error,
        retryable: false,
      });
      return { success: false, error, retryable: false, timestamp: Date.now() };
    }

    const text = message.content.text ?? '';
    let sentId: string | undefined;

    try {
      await state.adapter.continueConversationAsync(state.appId, reference, async (context) => {
        const response = await context.sendActivity({
          type: 'message',
          text,
        });
        sentId = response?.id;
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.emitMessageFailed({
        instanceId,
        chatId: message.to,
        error,
        retryable: true,
      });
      return { success: false, error, retryable: true, timestamp: Date.now() };
    }

    await this.emitMessageSent({
      instanceId,
      externalId: sentId ?? '',
      chatId: message.to,
      to: message.to,
      content: { type: 'text', text },
      replyToId: message.replyTo,
    });

    return {
      success: true,
      messageId: sentId,
      timestamp: Date.now(),
    };
  }

  async handleWebhook(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = /\/msteams\/([^/]+)\/?$/.exec(url.pathname);
    const instanceId = match?.[1];
    if (!instanceId) {
      return new Response('Not found', { status: 404 });
    }

    const state = this.instanceStates.get(instanceId);
    if (!state) {
      return new Response('Instance not connected', { status: 404 });
    }

    const activity = (await request.json()) as Activity;
    const authHeader = request.headers.get('authorization') ?? '';

    try {
      await state.adapter.processActivityDirect(authHeader, activity, async (context) => {
        await this.handleIncomingActivity(instanceId, state, context);
      });
    } catch (err) {
      this.logger.error('Failed to process Teams activity', {
        instanceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response('Internal error', { status: 500 });
    }

    return new Response(null, { status: 200 });
  }

  private async handleIncomingActivity(instanceId: string, state: InstanceState, context: TurnContext): Promise<void> {
    const activity = context.activity;
    const reference = TurnContext.getConversationReference(activity);
    const chatId = reference.conversation?.id ?? activity.conversation?.id ?? '';

    if (chatId) {
      state.conversationRefs.set(chatId, reference);
    }

    if (activity.type !== 'message') {
      return;
    }

    const cleanText = TurnContext.removeRecipientMention(activity) ?? activity.text ?? '';

    await this.emitMessageReceived({
      instanceId,
      externalId: activity.id ?? '',
      chatId,
      from: activity.from?.id ?? '',
      content: {
        type: 'text',
        text: cleanText,
      },
      rawPayload: activity as unknown as Record<string, unknown>,
    });
  }

  private resolveCredentials(config: InstanceConfig): MsTeamsConfig {
    const source = {
      ...(config.credentials ?? {}),
      ...(config.options ?? {}),
    } as Record<string, unknown>;

    const appId = String(source.appId ?? '');
    const appPassword = String(source.appPassword ?? '');
    const appType = (source.appType as MsTeamsConfig['appType']) ?? undefined;
    const tenantId = source.tenantId ? String(source.tenantId) : undefined;

    if (!appId || !appPassword) {
      throw new Error('Microsoft Teams instance requires appId and appPassword');
    }

    return { appId, appPassword, appType, tenantId };
  }
}
