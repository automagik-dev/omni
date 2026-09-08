/**
 * Harness channel types
 *
 * The capability profile is harness-local per-instance configuration (issue
 * #953): there is no platform-wide getCapabilities(instanceId) seam, so the
 * profile lives on the instance (profileMetadata.harnessProfile) and is
 * enforced by the plugin's sendMessage() only.
 */

import type { OutgoingMessage } from '@omni/channel-sdk';
import type { ContentType } from '@omni/core/types';
import { z } from 'zod';

/**
 * What the simulated platform can render, per instance.
 *
 * Defaults are permissive with WhatsApp Cloud-shaped ceilings
 * (MAX_REPLY_BUTTONS=3 / MAX_LIST_ROWS=10 from channel-sdk/interactive-plan),
 * so an unconfigured harness instance accepts everything the dispatcher can
 * produce. `.strict()` so a typo in a test's profile fails loudly instead of
 * silently validating nothing.
 */
export const HarnessCapabilityProfileSchema = z
  .object({
    canSendText: z.boolean().default(true),
    canSendMedia: z.boolean().default(true),
    canSendButtons: z.boolean().default(true),
    canSendList: z.boolean().default(true),
    maxButtons: z.number().int().min(1).max(10).default(3),
    maxListRows: z.number().int().min(1).max(100).default(10),
    /** 0 = unlimited */
    maxMessageLength: z.number().int().min(0).default(0),
  })
  .strict();

export type HarnessCapabilityProfile = z.infer<typeof HarnessCapabilityProfileSchema>;

export const DEFAULT_HARNESS_PROFILE: HarnessCapabilityProfile = HarnessCapabilityProfileSchema.parse({});

/** Machine-readable reasons a send violated the instance's profile. */
export type HarnessViolation =
  | 'text_not_supported'
  | 'text_too_long'
  | 'media_not_supported'
  | 'buttons_not_supported'
  | 'list_not_supported'
  | 'list_rows_exceeded';

/** An inbound the harness injected (POST say / POST tap). */
export interface HarnessInboundEntry {
  seq: number;
  direction: 'inbound';
  at: number;
  kind: 'say' | 'tap';
  externalId: string;
  from: string;
  content: { type: ContentType; text?: string };
  /** Present on kind 'tap': which component option produced this inbound. */
  tap?: {
    /** seq of the outbound entry whose component was tapped */
    sourceSeq: number;
    /** 1-based index into that outbound's buttons */
    optionIndex: number;
    /** button.data when set (the callback payload a real platform echoes) */
    optionId?: string;
    /** button.text — what the person saw and what comes back as message text */
    optionText: string;
  };
}

/** An outbound captured VERBATIM from sendMessage(), before any narrowing. */
export interface HarnessOutboundEntry {
  seq: number;
  direction: 'outbound';
  at: number;
  /** harness-assigned message id (absent when the send was refused) */
  externalId?: string;
  /** The full OutgoingMessage exactly as the dispatcher handed it over. */
  message: OutgoingMessage;
  /** Empty when the send passed the instance's capability profile. */
  violations: HarnessViolation[];
  result: { success: boolean; error?: string };
}

export type HarnessTranscriptEntry = HarnessInboundEntry | HarnessOutboundEntry;

/** What GET transcript returns for one chat. */
export interface HarnessTranscript {
  chatId: string;
  profile: HarnessCapabilityProfile;
  entries: HarnessTranscriptEntry[];
  /** Oldest entries evicted by the per-chat bound (0 in any sane test). */
  droppedEntries: number;
}

export const HarnessSayRequestSchema = z
  .object({
    chatId: z.string().min(1).max(256),
    text: z.string().min(1).max(65536),
    /** Sender id on the simulated platform; defaults to `user:<chatId>`. */
    from: z.string().min(1).max(256).optional(),
    senderName: z.string().min(1).max(256).optional(),
  })
  .strict();

export type HarnessSayRequest = z.infer<typeof HarnessSayRequestSchema>;

export const HarnessTapRequestSchema = z
  .object({
    chatId: z.string().min(1).max(256),
    /**
     * Which option to tap: a 1-based index into the component's buttons, or a
     * string matched against button.data (then button.text).
     */
    option: z.union([z.number().int().min(1), z.string().min(1).max(256)]),
    /**
     * seq of the outbound entry to tap. Defaults to the most recent outbound
     * in the chat that carries a component and was not refused.
     */
    messageSeq: z.number().int().min(1).optional(),
  })
  .strict();

export type HarnessTapRequest = z.infer<typeof HarnessTapRequestSchema>;
