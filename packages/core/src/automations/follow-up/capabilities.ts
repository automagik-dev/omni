/**
 * Channel-capability helpers for the idle-chat follow-up system.
 *
 * Two concerns handled here:
 *
 * 1. **24h messaging-window guard** — WhatsApp BSP (Cloud API) disallows
 *    template-free outbound messages more than 24h after the customer's last
 *    inbound message. The follow-up sweeper consults
 *    {@link channelHasMessagingWindow} + {@link createMessagingWindowProbe} to
 *    disarm sequences that would violate this window.
 * 2. **Typing indicator** — Most messaging channels support a "typing…"
 *    presence; {@link channelSupportsTypingIndicator} tells the follow-up
 *    flow whether a 2-3s typing burst is worthwhile before the outbound send.
 *    {@link playTypingIndicator} is a DI-friendly helper that user-space
 *    automations can call to emit + await the indicator.
 *
 * Why is this "channel-aware" logic in `core/automations/follow-up/` instead
 * of in each channel package? The sweeper is a single in-process job that
 * runs over rows from every channel and must not pull in
 * `channel-*`/channel-registry code (core would become a plugin consumer).
 * Keeping the per-channel mapping as a small, pure function here matches how
 * other automation-adjacent helpers are organised (debounce, templates,
 * schedule). Plugin authors still signal support via
 * `ChannelCapabilities` on their plugin; this file encodes the known defaults
 * so the sweeper does not have to instantiate the registry to make a
 * sequence-arming decision.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import type { ChannelType } from '../../types/channel';
import type { FollowUpStateRow, MessagingWindowProbe } from './sweeper';

/**
 * WhatsApp BSP / Cloud API enforces a 24-hour window after the customer's
 * most recent inbound message during which free-form outbound messages are
 * allowed. Beyond that window, only approved templates may be sent — and
 * follow-ups with bespoke prompts are not templates, so they must stop.
 */
export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Default typing-burst duration before a follow-up is dispatched.
 * Picked per #404's "2-3s" requirement; tunable by callers.
 */
export const DEFAULT_TYPING_INDICATOR_MS = 2500;

/**
 * Channels that enforce a 24h messaging window after the last inbound
 * customer message. WhatsApp BSPs enforce this window. Baileys
 * (personal WhatsApp) has no such restriction imposed by Meta — the account
 * can message freely.
 */
const CHANNELS_WITH_MESSAGING_WINDOW: ReadonlySet<ChannelType> = new Set<ChannelType>([
  'whatsapp-business',
  'hermes',
  'twilio-whatsapp',
  // ASC is a Meta BSP: the far end of the flow is WhatsApp, so Meta's window
  // applies exactly as it does to the other BSPs above.
  'asc-flow',
]);

/**
 * Channels that can produce a "typing…" or analogous presence indicator
 * before a message. `internal` is a synthetic transport with no user to
 * signal; `a2a` is agent-to-agent and skips presence.
 *
 * NOTE: `whatsapp-business` sends its indicator by marking the newest inbound
 * message as read with `typing_indicator` (Meta couples the two; there is no
 * free-standing presence endpoint). The plugin's `sendTyping` is a silent
 * no-op for chats with no remembered inbound message — the follow-up still
 * sends, just without the indicator, which the runtime already tolerates.
 */
const CHANNELS_WITH_TYPING_INDICATOR: ReadonlySet<ChannelType> = new Set<ChannelType>([
  'whatsapp-baileys',
  'whatsapp-business',
  'twilio-whatsapp',
  'discord',
  'slack',
  'telegram',
]);

/**
 * True if the channel type enforces a bounded messaging window (e.g. the
 * WhatsApp BSP 24h rule). The sweeper uses this to decide whether to apply
 * {@link createMessagingWindowProbe} to a row.
 */
export function channelHasMessagingWindow(channelType: ChannelType | null | undefined): boolean {
  if (!channelType) return false;
  return CHANNELS_WITH_MESSAGING_WINDOW.has(channelType);
}

/**
 * True if the channel type supports a pre-send typing/presence indicator
 * that {@link playTypingIndicator} can drive.
 */
export function channelSupportsTypingIndicator(channelType: ChannelType | null | undefined): boolean {
  if (!channelType) return false;
  return CHANNELS_WITH_TYPING_INDICATOR.has(channelType);
}

/**
 * Probe options for {@link createMessagingWindowProbe}.
 */
export interface CreateMessagingWindowProbeOptions {
  /** Override the 24h window in tests. Defaults to {@link MESSAGING_WINDOW_MS}. */
  windowMs?: number;
}

/**
 * Build a {@link MessagingWindowProbe} that honours the per-channel 24h
 * messaging window.
 *
 * Return values:
 * - `'expired'` — channel enforces a window AND `lastInboundCustomerMessageAt`
 *   is older than `windowMs`. Sweeper must disarm with `window_expired`.
 * - `'within'` — channel enforces a window AND the last inbound is recent.
 *   Sweeper may fire.
 * - `'unknown'` — channel does not enforce a window, or the row lacks the
 *   metadata needed to decide (null `channelType` / null
 *   `lastInboundCustomerMessageAt`). Sweeper proceeds as if unguarded.
 *
 * Rationale for `'unknown'` vs. `'within'` on missing data: returning
 * `'unknown'` makes the sweeper's behaviour equivalent to "no probe provided"
 * — the safest default when we cannot decide. Otherwise we'd need to encode
 * the "no constraint" branch inside the probe itself.
 */
export function createMessagingWindowProbe(options: CreateMessagingWindowProbeOptions = {}): MessagingWindowProbe {
  const windowMs = options.windowMs ?? MESSAGING_WINDOW_MS;

  return (row: FollowUpStateRow, now: Date) => {
    if (!channelHasMessagingWindow(row.channelType ?? null)) {
      return 'unknown';
    }
    const lastInbound = row.lastInboundCustomerMessageAt ?? null;
    if (!lastInbound) {
      return 'unknown';
    }
    const elapsedMs = now.getTime() - lastInbound.getTime();
    return elapsedMs > windowMs ? 'expired' : 'within';
  };
}

/**
 * Minimal contract a channel plugin must satisfy to drive a typing
 * indicator. Matches the shape of `ChannelPlugin.sendTyping` in
 * `@omni/channel-sdk` so the registry's plugin object can be passed
 * directly.
 */
export interface TypingIndicatorSender {
  sendTyping(instanceId: string, chatId: string, duration?: number): Promise<void>;
}

/**
 * Lookup function that resolves a {@link TypingIndicatorSender} for a given
 * channel type. Returning `null` means "no sender available, skip
 * silently". User-space automations wire this to the channel registry.
 */
export type TypingIndicatorResolver = (channelType: ChannelType) => TypingIndicatorSender | null | undefined;

/**
 * Options for {@link playTypingIndicator}.
 */
export interface PlayTypingIndicatorOptions {
  /** Channel type of the instance. If null/undefined, the helper is a no-op. */
  channelType: ChannelType | null | undefined;
  /** Instance id passed through to the sender. */
  instanceId: string;
  /** Chat id passed through to the sender. */
  chatId: string;
  /** Whether the config requests a typing indicator (default true if undefined). */
  showTypingIndicator?: boolean;
  /**
   * Resolver that returns a {@link TypingIndicatorSender} for the channel
   * type, or `null` to skip silently. Passing a direct sender is also
   * supported via {@link PlayTypingIndicatorOptions.sender}.
   */
  resolver?: TypingIndicatorResolver;
  /** Direct sender — takes precedence over `resolver`. */
  sender?: TypingIndicatorSender | null;
  /** Burst duration in ms. Defaults to {@link DEFAULT_TYPING_INDICATOR_MS}. */
  durationMs?: number;
  /** Inject `setTimeout`-based wait; lets tests skip the real delay. */
  wait?: (ms: number) => Promise<void>;
  /** Optional logger for silent-failure diagnostics. */
  logger?: { debug?: (msg: string, ctx?: Record<string, unknown>) => void };
}

/**
 * Emit a typing / presence indicator for 2-3s before the follow-up is
 * dispatched.
 *
 * Silent no-op when any of the following is true:
 * - `showTypingIndicator === false` on the resolved config.
 * - `channelType` is unknown / falsy.
 * - The channel does not support typing indicators.
 * - No sender can be resolved.
 * - The sender throws (errors are swallowed — typing is best-effort).
 *
 * Returns the ms waited (0 when skipped) for observability.
 */
export async function playTypingIndicator(options: PlayTypingIndicatorOptions): Promise<number> {
  const {
    channelType,
    showTypingIndicator = true,
    instanceId,
    chatId,
    resolver,
    sender: directSender,
    durationMs = DEFAULT_TYPING_INDICATOR_MS,
    wait,
    logger,
  } = options;

  if (!showTypingIndicator) return 0;
  if (!channelType) return 0;
  if (!channelSupportsTypingIndicator(channelType)) return 0;

  const sender = directSender ?? (resolver ? resolver(channelType) : null);
  if (!sender) return 0;

  try {
    await sender.sendTyping(instanceId, chatId, durationMs);
  } catch (err) {
    logger?.debug?.('follow-up typing indicator failed (ignored)', {
      channelType,
      instanceId,
      chatId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }

  const pause = wait ?? defaultWait;
  try {
    await pause(durationMs);
  } catch {
    // ignore — the message send should still happen even if our wait is interrupted
  }
  return durationMs;
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
