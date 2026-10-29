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
 */
/**
 * Keep in sync with:
 *   - `packages/core/src/events/types.ts` → `FollowUpDisarmReason` type union
 *   - `packages/db/src/schema.ts` → `followUpDisarmReasons` const tuple
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
  'contact_closed',
]);

export type DisarmReason = z.infer<typeof DisarmReasonSchema>;

/**
 * Optional random spread on every interval of a schedule (#1261), so chats armed
 * together don't all fire on the same tick: on unofficial WhatsApp channels,
 * outbound at fixed intervals and in bursts raises the risk of a ban. Each
 * interval moves by a uniform random offset within `±minutes`, or within
 * `±ratio` of the interval, and never drops below the smaller of the interval
 * and one minute. Absent: the schedule is exact, as before.
 */
export const FollowUpJitterSchema = z.union([
  z.object({ minutes: z.number().positive().finite() }).strict(),
  z.object({ ratio: z.number().gt(0).max(1) }).strict(),
]);

export type FollowUpJitter = z.infer<typeof FollowUpJitterSchema>;

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
  jitter: FollowUpJitterSchema.optional(),
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
  jitter: FollowUpJitterSchema.optional(),
});

export type ExponentialSchedule = z.infer<typeof ExponentialScheduleSchema>;

export const FollowUpScheduleSchema = z.discriminatedUnion('kind', [FixedScheduleSchema, ExponentialScheduleSchema]);

export type FollowUpSchedule = z.infer<typeof FollowUpScheduleSchema>;

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTES_PER_DAY = 24 * 60;

export function timeOfDayToMinutes(time: string): number {
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const FollowUpQuietHoursSchema = z
  .object({
    start: z.string().regex(TIME_OF_DAY_PATTERN, 'start must be HH:MM (24-hour)'),
    end: z.string().regex(TIME_OF_DAY_PATTERN, 'end must be HH:MM (24-hour)'),
    timezone: z.string().refine(isTimeZone, 'timezone must be an IANA time zone, e.g. America/Sao_Paulo'),
    spreadMinutes: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!TIME_OF_DAY_PATTERN.test(value.start) || !TIME_OF_DAY_PATTERN.test(value.end)) return;
    const quietMinutes =
      (timeOfDayToMinutes(value.end) - timeOfDayToMinutes(value.start) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    if (quietMinutes === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end'], message: 'start and end must differ' });
      return;
    }
    if ((value.spreadMinutes ?? 0) >= MINUTES_PER_DAY - quietMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['spreadMinutes'],
        message: 'spreadMinutes must be shorter than the time between end and start',
      });
    }
  });

export type FollowUpQuietHours = z.infer<typeof FollowUpQuietHoursSchema>;

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
    quietHours: FollowUpQuietHoursSchema.optional(),
  })
  .strict();

export type FollowUpSequenceConfig = z.infer<typeof FollowUpSequenceConfigSchema>;
