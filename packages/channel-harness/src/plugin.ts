/**
 * Harness Channel Plugin (issue #953)
 *
 * A real channel whose "platform" is the test itself. channel-internal's
 * sibling: no external transport, but where internal ROUTES (re-emitting only
 * content.text), the harness CAPTURES — sendMessage() records the FULL
 * OutgoingMessage verbatim, buttons/lists/metadata included, before any
 * narrowing — and EXPOSES it per chatId for assertions.
 *
 * Three drives, all surfaced by the API routes in @omni/api:
 *  - say():  inject an inbound exactly as a real channel webhook would
 *  - tap():  convert a component option the agent actually sent back into the
 *    inbound a real tap produces (the WAB/hermes parser precedent: the reply
 *    text is the tapped option's title)
 *  - transcript(): the ordered verbatim record of both directions
 *
 * Everything between say() and sendMessage() is the production path — the
 * dispatcher, the agent provider, message.received / message.sent — which is
 * the point: the bugs this exists to catch live there, not in any platform.
 */

import { BaseChannelPlugin, DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import type { ChannelCapabilities, InstanceConfig, OutgoingMessage, SendResult } from '@omni/channel-sdk';
import { ERROR_CODES, OmniError, generateId } from '@omni/core';
import { HarnessTranscriptStore } from './transcript-store';
import type {
  HarnessCapabilityProfile,
  HarnessInboundEntry,
  HarnessOutboundEntry,
  HarnessSayRequest,
  HarnessTapRequest,
  HarnessTranscript,
  HarnessViolation,
} from './types';
import { DEFAULT_HARNESS_PROFILE, HarnessCapabilityProfileSchema } from './types';

/**
 * Plugin-level capabilities are deliberately permissive: an agent-side
 * allowlist reading these must ATTEMPT components on the harness (the
 * silent-degrade-to-text failure in #953 came from exactly such an allowlist).
 * The per-instance profile then decides what actually renders.
 */
const HARNESS_CAPABILITIES: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,
  canSendText: true,
  canSendMedia: true,
  canSendButtons: true,
  canSendSelectMenu: true,
  canReplyToMessage: true,
  supportedMediaTypes: [{ mimeType: '*/*' }],
};

const MEDIA_CONTENT_TYPES = new Set(['image', 'audio', 'video', 'document', 'sticker']);

export class HarnessChannelPlugin extends BaseChannelPlugin {
  readonly id = 'harness' as const;
  readonly name = 'E2E Test Harness';
  readonly version = '0.1.0';
  readonly capabilities = HARNESS_CAPABILITIES;

  private readonly transcripts = new HarnessTranscriptStore();
  private readonly profiles = new Map<string, HarnessCapabilityProfile>();

  // ─── Lifecycle ────────────────────────────────────────────────

  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    const parsed = HarnessCapabilityProfileSchema.safeParse(config.options?.harnessProfile ?? {});
    if (!parsed.success) {
      throw new OmniError({
        code: ERROR_CODES.VALIDATION,
        message: `Invalid harness capability profile: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ')}`,
        context: { instanceId },
        recoverable: false,
      });
    }
    this.profiles.set(instanceId, parsed.data);
    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
      message: 'Harness channel ready',
    });
  }

  async disconnect(instanceId: string): Promise<void> {
    // Transcripts survive a disconnect on purpose: inspecting a conversation
    // after tearing the instance down is a legitimate test flow. They are
    // dropped only via resetTranscript() or process exit (in-memory store).
    this.profiles.delete(instanceId);
    const entry = this.instances.get(instanceId);
    if (entry) {
      await this.updateInstanceStatus(instanceId, entry.config, {
        state: 'disconnected',
        since: new Date(),
      });
    }
  }

  // ─── Outbound capture ─────────────────────────────────────────

  /**
   * Capture the message VERBATIM, validate it against the instance's
   * capability profile, then emit message.sent (or message.failed on a
   * profile violation) like any other channel.
   */
  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    // Deep-clone FIRST: the transcript must hold what sendMessage was handed,
    // immune to later mutation by the caller and to any narrowing below.
    const verbatim = structuredClone(message);
    const chatId = message.to;
    const profile = this.profileFor(instanceId);
    const violations = evaluateProfile(profile, message);
    const timestamp = Date.now();

    if (violations.length > 0) {
      const error = `Harness profile violation: ${violations.join(', ')}`;
      this.appendEntry(instanceId, chatId, {
        direction: 'outbound',
        at: timestamp,
        message: verbatim,
        violations,
        result: { success: false, error },
      });
      await this.emitMessageFailed({
        instanceId,
        chatId,
        error,
        errorCode: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
        retryable: false,
      });
      return { success: false, error, errorCode: ERROR_CODES.CAPABILITY_NOT_SUPPORTED, retryable: false, timestamp };
    }

    const externalId = `harness-${generateId()}`;
    this.appendEntry(instanceId, chatId, {
      direction: 'outbound',
      at: timestamp,
      externalId,
      message: verbatim,
      violations,
      result: { success: true },
    });
    await this.emitMessageSent({
      instanceId,
      externalId,
      chatId,
      to: message.to,
      content: {
        type: message.content.type,
        text: message.content.text,
        caption: message.content.caption,
        mediaUrl: message.content.mediaUrl,
        mimeType: message.content.mimeType,
        filename: message.content.filename,
      },
      replyToId: message.replyTo,
      // The event's content projection drops components; carry the verbatim
      // send here so the harness's own message.sent is self-describing.
      rawPayload: { harness: true, outgoing: structuredClone(verbatim) },
      systemNotice: message.metadata?.systemNotice === true,
    });
    return { success: true, messageId: externalId, timestamp };
  }

  // ─── Drives ──────────────────────────────────────────────────

  /** Inject an inbound message exactly as a real channel webhook would. */
  async say(instanceId: string, request: HarnessSayRequest): Promise<HarnessInboundEntry> {
    const from = request.from ?? `user:${request.chatId}`;
    const externalId = `harness-say-${generateId()}`;
    const entry = this.appendEntry(instanceId, request.chatId, {
      direction: 'inbound',
      at: Date.now(),
      kind: 'say',
      externalId,
      from,
      content: { type: 'text', text: request.text },
    }) as HarnessInboundEntry;
    await this.emitMessageReceived({
      instanceId,
      externalId,
      chatId: request.chatId,
      from,
      senderName: request.senderName,
      content: { type: 'text', text: request.text },
      rawPayload: { harness: true, kind: 'say' },
    });
    return entry;
  }

  /**
   * Simulate tapping a button/list row the agent actually sent: resolve the
   * chosen option from the captured component and inject the inbound a real
   * tap produces — text = the option's title, the WAB/hermes precedent.
   */
  async tap(instanceId: string, request: HarnessTapRequest): Promise<HarnessInboundEntry> {
    const { chatId } = request;
    const source = this.resolveTapSource(instanceId, request);
    const buttons = source.message.content.buttons ?? [];

    const optionIndex =
      typeof request.option === 'number'
        ? request.option
        : buttons.findIndex((b) => b.data === request.option || b.text === request.option) + 1;
    const button = buttons[optionIndex - 1];
    if (!button) {
      throw new OmniError({
        code: ERROR_CODES.NOT_FOUND,
        message: `Option ${JSON.stringify(request.option)} does not match any of the ${buttons.length} option(s) on outbound seq ${source.seq}`,
        context: { instanceId, chatId, messageSeq: source.seq },
        recoverable: false,
      });
    }

    const from = `user:${chatId}`;
    const externalId = `harness-tap-${generateId()}`;
    const entry = this.appendEntry(instanceId, chatId, {
      direction: 'inbound',
      at: Date.now(),
      kind: 'tap',
      externalId,
      from,
      content: { type: 'text', text: button.text },
      tap: { sourceSeq: source.seq, optionIndex, optionId: button.data, optionText: button.text },
    }) as HarnessInboundEntry;
    await this.emitMessageReceived({
      instanceId,
      externalId,
      chatId,
      from,
      content: { type: 'text', text: button.text },
      replyToId: source.externalId,
      rawPayload: {
        harness: true,
        kind: 'tap',
        sourceSeq: source.seq,
        sourceExternalId: source.externalId,
        optionIndex,
        optionId: button.data,
      },
    });
    return entry;
  }

  // ─── Inspection ──────────────────────────────────────────────

  getTranscript(instanceId: string, chatId: string): HarnessTranscript {
    const { entries, droppedEntries } = this.transcripts.read(instanceId, chatId);
    return { chatId, profile: this.profileFor(instanceId), entries, droppedEntries };
  }

  resetTranscript(instanceId: string, chatId?: string): void {
    this.transcripts.reset(instanceId, chatId);
  }

  getCapabilityProfile(instanceId: string): HarnessCapabilityProfile {
    return this.profileFor(instanceId);
  }

  // ─── Internals ───────────────────────────────────────────────

  private profileFor(instanceId: string): HarnessCapabilityProfile {
    return this.profiles.get(instanceId) ?? DEFAULT_HARNESS_PROFILE;
  }

  private appendEntry(
    instanceId: string,
    chatId: string,
    entry: Omit<HarnessInboundEntry, 'seq'> | Omit<HarnessOutboundEntry, 'seq'>,
  ) {
    try {
      return this.transcripts.append(instanceId, chatId, entry);
    } catch (error) {
      throw new OmniError({
        code: ERROR_CODES.CHANNEL_RATE_LIMITED,
        message: error instanceof Error ? error.message : 'Harness transcript store limit reached',
        context: { instanceId, chatId },
        recoverable: true,
      });
    }
  }

  private resolveTapSource(instanceId: string, request: HarnessTapRequest): HarnessOutboundEntry {
    const { chatId, messageSeq } = request;
    if (messageSeq !== undefined) {
      const entry = this.transcripts.findBySeq(instanceId, chatId, messageSeq);
      if (!entry || entry.direction !== 'outbound') {
        throw new OmniError({
          code: ERROR_CODES.NOT_FOUND,
          message: `No outbound entry with seq ${messageSeq} in chat ${chatId}`,
          context: { instanceId, chatId, messageSeq },
          recoverable: false,
        });
      }
      if (entry.violations.length > 0) {
        throw new OmniError({
          code: ERROR_CODES.CONFLICT,
          message: `Outbound seq ${messageSeq} was refused by the capability profile (${entry.violations.join(', ')}) — it never rendered, so it cannot be tapped`,
          context: { instanceId, chatId, messageSeq },
          recoverable: false,
        });
      }
      return entry;
    }

    const latest = this.transcripts.findLast(
      instanceId,
      chatId,
      (entry) =>
        entry.direction === 'outbound' &&
        entry.violations.length === 0 &&
        (entry.message.content.buttons?.length ?? 0) > 0,
    );
    if (!latest || latest.direction !== 'outbound') {
      throw new OmniError({
        code: ERROR_CODES.NOT_FOUND,
        message: `No rendered outbound with a component to tap in chat ${chatId}`,
        context: { instanceId, chatId },
        recoverable: false,
      });
    }
    return latest;
  }
}

/**
 * Which profile rules a send breaks. Rendering rule (documented in README):
 * a component renders as a LIST when content.list.forceList is set or the
 * option count exceeds maxButtons, otherwise as reply BUTTONS — mirroring
 * channel-sdk/interactive-plan's count-decides split.
 */
function evaluateProfile(profile: HarnessCapabilityProfile, message: OutgoingMessage): HarnessViolation[] {
  return [
    ...checkText(profile, message.content),
    ...checkMedia(profile, message.content),
    ...checkComponent(profile, message.content),
  ];
}

function checkText(profile: HarnessCapabilityProfile, content: OutgoingMessage['content']): HarnessViolation[] {
  const text = content.text ?? content.caption;
  if (text === undefined || text.length === 0) return [];
  if (!profile.canSendText) return ['text_not_supported'];
  if (profile.maxMessageLength > 0 && text.length > profile.maxMessageLength) return ['text_too_long'];
  return [];
}

function checkMedia(profile: HarnessCapabilityProfile, content: OutgoingMessage['content']): HarnessViolation[] {
  const isMedia = MEDIA_CONTENT_TYPES.has(content.type) || content.mediaUrl !== undefined;
  return isMedia && !profile.canSendMedia ? ['media_not_supported'] : [];
}

function checkComponent(profile: HarnessCapabilityProfile, content: OutgoingMessage['content']): HarnessViolation[] {
  const optionCount = content.buttons?.length ?? 0;
  if (optionCount === 0) return [];
  const rendersAsList = content.list?.forceList === true || optionCount > profile.maxButtons;
  if (!rendersAsList) return profile.canSendButtons ? [] : ['buttons_not_supported'];
  if (!profile.canSendList) return ['list_not_supported'];
  return optionCount > profile.maxListRows ? ['list_rows_exceeded'] : [];
}
