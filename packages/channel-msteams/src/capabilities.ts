/**
 * Microsoft Teams channel capabilities declaration.
 *
 * HONEST scaffold values (issue #433 / PR #916): only what the plugin
 * actually implements today is declared. Teams itself supports media,
 * reactions, message edits, Adaptive Cards and typing indicators — those are
 * follow-up work and stay `false` here until the code exists, because the
 * runtime adapts behavior (e.g. follow-up typing bursts, media pipelines) to
 * these flags.
 */

import { DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import type { ChannelCapabilities } from '@omni/channel-sdk';

export const MSTEAMS_CAPABILITIES: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,
  canSendText: true,

  // Inbound activities arrive from personal (DM), group chat and channel
  // conversations alike; replies continue whatever conversation the
  // ConversationReference points at, so both are genuinely handled.
  canHandleDMs: true,
  canHandleGroups: true,

  // The Azure Bot appPassword is accepted at connect time only and never
  // persisted (no sealed column yet) — the platform cannot rebuild this
  // connection on its own: no auto-reconnect, restart rejected up front.
  requiresConnectTimeCredentials: true,

  // Teams caps a message at ~28 KB of content.
  maxMessageLength: 28_000,
  // Text-only scaffold: no media path yet (an empty list is the honest
  // declaration — same as asc-flow before its media support landed).
  supportedMediaTypes: [],
  maxFileSize: 0,
};
