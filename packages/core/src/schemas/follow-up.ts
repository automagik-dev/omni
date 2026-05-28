/**
 * Follow-up sequence configuration schemas.
 *
 * When a customer goes idle after an agent reply, a configurable sequence of
 * follow-ups can be fired. The config lives on agents/instances/chats (closest
 * wins) and the runtime state lives on `chat_follow_up_state`.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import { z } from 'zod';

/**
 * Reasons a sequence was disarmed. Null means the sequence is still armed.
 *
 * - `customer_replied` — inbound message from the customer cancelled follow-ups.
 * - `handoff` — chat was handed off to a human operator / another agent.
 * - `archived` — chat was archived or muted.
 * - `window_expired` — WhatsApp BSP/Cloud 24h messaging window elapsed.
 * - `sequence_complete` — all configured follow-ups fired.
 * - `agent_error` — agent failed while generating a follow-up.
 * - `send_failed` — outbound send failed after render.
 * - `session_cleared` — user cleared the agent session (e.g. trash emoji).
 * - `human_active` — pre-fire probe detected a human agent handling the
 *   chat out-of-band (operator took over in the channel inbox without
 *   `human_handoff`). Re-arm is allowed on the next genuine agent reply.
 */
export const DisarmReasonSchema = z.enum([
  'customer_replied',
  'handoff',
  'archived',
  'window_expired',
  'sequence_complete',
  'agent_error',
  'send_failed',
  'session_cleared',
  'human_active',
]);

export type DisarmReason = z.infer<typeof DisarmReasonSchema>;

/**
 * Fixed-list schedule: cycles through `intervalsMinutes` in order.
 * The first follow-up fires `intervalsMinutes[0]` after the agent reply;
 * the second fires `intervalsMinutes[1]` after the first, etc.
 * Once the list is exhausted, the sequence completes (unless `maxFollowUps`
 * ends it first).
 */
export const FixedScheduleSchema = z.object({
  kind: z.literal('fixed'),
  intervalsMinutes: z
    .array(z.number().positive().finite())
    .min(1, 'intervalsMinutes must contain at least one interval'),
});

export type FixedSchedule = z.infer<typeof FixedScheduleSchema>;

/**
 * Exponential schedule: fires at `initialMinutes`, then multiplies by `factor`
 * each subsequent iteration, capped at `maxMinutes`.
 */
export const ExponentialScheduleSchema = z.object({
  kind: z.literal('exponential'),
  initialMinutes: z.number().positive().finite(),
  factor: z.number().gt(1, 'factor must be greater than 1').finite(),
  maxMinutes: z.number().positive().finite(),
});

export type ExponentialSchedule = z.infer<typeof ExponentialScheduleSchema>;

export const FollowUpScheduleSchema = z.discriminatedUnion('kind', [FixedScheduleSchema, ExponentialScheduleSchema]);

export type FollowUpSchedule = z.infer<typeof FollowUpScheduleSchema>;

/**
 * Full follow-up sequence configuration.
 *
 * Stored on agents/instances/chats (closest wins). When enabled is false,
 * the sequence is disabled at this scope even if a broader scope enables it.
 */
export const FollowUpSequenceConfigSchema = z
  .object({
    /** Master switch — when false, no follow-ups arm at this scope. */
    enabled: z.boolean().default(true),
    /** Schedule definition (fixed-list or exponential). */
    schedule: FollowUpScheduleSchema,
    /**
     * Hard cap on the number of follow-ups fired for a single sequence.
     * Sequence completes with `sequence_complete` once reached.
     */
    maxFollowUps: z.number().int().positive().max(50),
    /**
     * Template for the synthetic prompt sent to the agent. Supports the
     * following placeholders rendered by `packages/core/src/automations/templates.ts`:
     *   - `{{syntheticPrompt}}` — this template string itself
     *   - `{{minutes}}` — minutes since the last agent reply
     *   - `{{sequenceIndex}}` — zero-based follow-up index about to fire
     *   - `{{chatName}}` — chat display name if known
     */
    promptTemplate: z.string().min(1, 'promptTemplate must be a non-empty string'),
    /**
     * On WhatsApp BSP/Cloud instances, disarm any sequence whose last
     * inbound customer message is older than 24 hours. Default: true.
     */
    stopOutsideMessagingWindow: z.boolean().default(true),
    /**
     * Emit a 2-3s typing / presence indicator before sending the follow-up
     * on channels that support it. Silent no-op on channels that don't.
     * Default: true.
     */
    showTypingIndicator: z.boolean().default(true),
  })
  .strict();

export type FollowUpSequenceConfig = z.infer<typeof FollowUpSequenceConfigSchema>;
