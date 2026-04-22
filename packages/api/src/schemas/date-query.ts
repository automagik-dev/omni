/**
 * Shared validators for date inputs that arrive via query parameters
 * or JSON body fields.
 *
 * Why this module exists
 * ----------------------
 * Multiple v2 routes used to hand-roll the same pattern:
 *
 *   z.string().optional().transform((v) => (v ? new Date(v) : undefined))
 *
 * That pattern silently accepts unparseable input (e.g. a UUID, garbage,
 * an empty trimmed value) and produces an `Invalid Date` instance. The
 * Invalid Date then flows into a downstream Drizzle `gte`/`lte`
 * comparison and surfaces as a 500 INTERNAL_ERROR instead of the
 * 400 VALIDATION_ERROR the caller deserves.
 *
 * Centralising here gives one source of truth for:
 *   - rejecting malformed input at the edge (HTTP 400 via zValidator)
 *   - producing a uniform, parameter-named error message
 *   - returning a real `Date` to handlers, never `Invalid Date`
 *
 * @see https://github.com/automagik-dev/omni/issues/462 — original chats bug
 * @see https://github.com/automagik-dev/omni/issues/487 — extract & propagate
 */

import { z } from 'zod';

function parseDateOrIssue(paramName: string, v: string, ctx: z.RefinementCtx): Date | typeof z.NEVER {
  const parsed = new Date(v);
  if (Number.isNaN(parsed.getTime())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `invalid ${paramName} parameter: expected ISO 8601 date string, got "${v}"`,
    });
    return z.NEVER;
  }
  return parsed;
}

/**
 * Optional date parameter. Returns `undefined` when the input is absent
 * or an empty string; otherwise returns a parsed `Date` or fails
 * validation with a 400.
 */
export const optionalDateParam = (paramName: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return undefined;
      return parseDateOrIssue(paramName, v, ctx);
    });

/**
 * Required date parameter. Fails validation with a 400 when the input
 * is missing, empty, or unparseable as a date.
 */
export const requiredDateParam = (paramName: string) =>
  z
    .string({
      required_error: `${paramName} is required`,
      invalid_type_error: `${paramName} must be a string`,
    })
    .transform((v, ctx) => {
      if (v === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${paramName} is required`,
        });
        return z.NEVER;
      }
      return parseDateOrIssue(paramName, v, ctx);
    });
