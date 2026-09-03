/**
 * Per-instance handoff options for the Gupshup Custom Integration.
 *
 * Two gaps this closes, both seen on real deployments:
 *
 * 1. System-initiated handoffs reach the channel with no `handoff_fields`.
 *    The agent-dispatch error path, a silence watchdog, any emitter that is
 *    not the agent itself — none of them know the operator's queue layout.
 *    On the Gupshup side the Journey routes on exactly those fields, so a
 *    handoff without them lands outside every queue and nobody picks it up.
 *    `defaultFields` and `fieldsByPhonePrefix` let the operator declare
 *    routing defaults on the instance. They are applied UNDER whatever the
 *    emitter sent: an explicit field always wins.
 *
 * 2. The Custom Integration accepts a `customerFields` array of
 *    `{ apiKey, value }` that the Journey writes onto the contact record.
 *    Which keys a given Journey expects is per account, so this is a template
 *    the operator owns rather than something the channel can hardcode.
 *
 * Both are validated with Zod when the instance connects. Bad config fails the
 * connect, not the first handoff at 3 a.m.
 */

import { z } from 'zod';

const fieldValue = z.string().max(2048);
const fieldKey = z.string().min(1).max(128);
const fieldMap = z.record(fieldKey, fieldValue);

export const gupshupHandoffOptionsSchema = z
  .object({
    /** Fields merged under every HANDOFF that lacks them. */
    defaultFields: fieldMap.optional(),

    /**
     * Ordered prefix rules, matched against the destination phone with all
     * non-digits stripped. The first rule with a matching prefix wins and its
     * fields override `defaultFields`. Country codes, area codes and number
     * ranges are all just prefixes here.
     */
    fieldsByPhonePrefix: z
      .array(
        z.object({
          prefixes: z.array(z.string().min(1).max(15).regex(/^\d+$/, 'prefixes must be digits only')).min(1).max(256),
          fields: fieldMap,
        }),
      )
      .max(64)
      .optional(),

    /**
     * Ordered template for the Custom Integration `customerFields` array.
     * Each entry is either a literal (`value`) or a reference to a key of the
     * resolved handoff fields (`from`). Entries whose source resolves to an
     * empty value are skipped, so a missing optional field never produces a
     * blank customer field on the contact.
     */
    customerFields: z
      .array(
        z
          .object({
            apiKey: fieldKey,
            value: fieldValue.optional(),
            from: fieldKey.optional(),
          })
          .refine((entry) => (entry.value === undefined) !== (entry.from === undefined), {
            message: 'each customerFields entry needs exactly one of `value` or `from`',
          }),
      )
      .max(64)
      .optional(),
  })
  .strict();

export type GupshupHandoffOptions = z.infer<typeof gupshupHandoffOptionsSchema>;

export interface GupshupCustomerField {
  apiKey: string;
  value: string;
}

/**
 * Values that must never reach the Journey as a field value. LLM-driven
 * emitters occasionally serialise an absent value as the literal string.
 */
const EMPTY_SENTINELS = new Set(['', 'undefined', 'null']);

function cleanValue(value: unknown): string {
  const text = String(value ?? '').trim();
  return EMPTY_SENTINELS.has(text.toLowerCase()) ? '' : text;
}

/**
 * Validate raw instance options. Returns `undefined` when nothing is
 * configured; throws a `ZodError` when the shape is wrong so the caller can
 * surface a precise message at connect time.
 */
export function parseHandoffOptions(raw: unknown): GupshupHandoffOptions | undefined {
  if (raw === undefined || raw === null) return undefined;
  return gupshupHandoffOptionsSchema.parse(raw);
}

/**
 * Merge routing defaults under the fields an emitter provided.
 *
 * Precedence, lowest to highest: `defaultFields` → matching
 * `fieldsByPhonePrefix` rule → explicit fields from the emitter. A key the
 * emitter sent as empty (or as an empty sentinel) counts as "not sent" and is
 * filled from the defaults — a blank routing key is exactly the failure this
 * exists to prevent.
 *
 * Returns the explicit fields untouched when no options are configured, so
 * instances without options behave byte-for-byte as before.
 */
export function resolveHandoffFields(
  phone: string,
  explicit: Record<string, unknown> | undefined,
  options: GupshupHandoffOptions | undefined,
): Record<string, unknown> | undefined {
  if (!options) return explicit;

  const defaults: Record<string, string> = { ...(options.defaultFields ?? {}) };
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits && options.fieldsByPhonePrefix) {
    const rule = options.fieldsByPhonePrefix.find((r) => r.prefixes.some((p) => digits.startsWith(p)));
    if (rule) Object.assign(defaults, rule.fields);
  }
  if (Object.keys(defaults).length === 0) return explicit;

  const out: Record<string, unknown> = { ...(explicit ?? {}) };
  for (const [key, value] of Object.entries(defaults)) {
    if (cleanValue(out[key]) === '') out[key] = value;
  }
  return out;
}

/**
 * Render the `customerFields` template against the resolved handoff fields.
 * Template order is preserved; entries that resolve to an empty value are
 * dropped. Returns `undefined` when there is nothing to send, so the wire
 * payload stays unchanged for instances without a template.
 */
export function buildCustomerFields(
  handoffFields: Record<string, unknown> | undefined,
  template: GupshupHandoffOptions['customerFields'],
): GupshupCustomerField[] | undefined {
  if (!template || template.length === 0) return undefined;

  const out: GupshupCustomerField[] = [];
  for (const entry of template) {
    const value =
      entry.value !== undefined ? cleanValue(entry.value) : cleanValue(handoffFields?.[entry.from as string]);
    if (value === '') continue;
    out.push({ apiKey: entry.apiKey, value });
  }
  return out.length > 0 ? out : undefined;
}
