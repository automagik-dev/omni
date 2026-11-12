/**
 * Kapso Platform API: the few calls Omni makes to connect a WhatsApp Business number through Kapso
 * by clicks (#1676). Pure functions (no DB, no Hono); the REST surface lives in
 * `packages/api/src/routes/v2/whatsapp-business-kapso.ts`.
 *
 * - A setup link (hung off one Kapso customer per Omni) lets the person connect their number
 *   in Kapso's hosted page, keeping the WhatsApp Business app (coexistence).
 * - The project's numbers give the phone_number_id, WABA id and display number.
 * - The number's Meta-forwarding webhook (kind `meta`) sends Meta's raw payloads to Omni,
 *   signed with a secret Omni generates (`X-Webhook-Signature`).
 *
 * Every call sends the project key as `X-API-Key` and refuses redirects, so the key only
 * reaches the configured Kapso host. Kapso answers errors as `{ "error": "..." }`; that text
 * becomes a {@link KapsoApiError} message, never the key.
 *
 * Reference: https://docs.kapso.ai/api/platform/v1/openapi-platform.yaml
 */

import { z } from 'zod';
import { fetchWithTimeout } from './oauth';

export const DEFAULT_KAPSO_API_BASE_URL = 'https://api.kapso.ai';

/** The Meta Graph version Kapso's Meta-compatible proxy serves. */
export const KAPSO_META_API_VERSION = 'v24.0';

export interface KapsoOptions {
  apiKey: string;
  /** Kapso's origin, e.g. https://api.kapso.ai (default). */
  baseUrl?: string;
}

/** A Kapso refusal or an unreadable reply, in words a person can act on. */
export class KapsoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly operation: string,
  ) {
    super(message);
    this.name = 'KapsoApiError';
  }
}

export interface KapsoPhoneNumber {
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string | null;
  name: string | null;
}

export interface KapsoSetupLink {
  url: string;
  expiresAt: string | null;
}

const CustomerReply = z.object({ data: z.object({ id: z.string().min(1) }) });
const SetupLinkReply = z.object({
  data: z.object({ url: z.string().url(), expires_at: z.string().nullish() }),
});
const PhoneNumbersReply = z.object({
  data: z.array(
    z.object({
      phone_number_id: z.string().min(1),
      business_account_id: z.string().nullish(),
      display_phone_number: z.string().nullish(),
      verified_name: z.string().nullish(),
      display_name: z.string().nullish(),
      name: z.string().nullish(),
    }),
  ),
});
const WebhookShape = z.object({ id: z.string().min(1), kind: z.string().nullish(), url: z.string().nullish() });
const WebhookReply = z.object({ data: WebhookShape });
const WebhookListReply = z.object({ data: z.array(WebhookShape) });
const ErrorReply = z.object({ error: z.string().min(1) });

/** Kapso's origin without a trailing slash or a `/platform/v1` / `/meta/...` suffix. */
export function kapsoOrigin(baseUrl: string = DEFAULT_KAPSO_API_BASE_URL): string {
  return new URL(baseUrl).origin;
}

/** The Meta-compatible API base an instance connected through Kapso talks to. */
export function kapsoMetaApiBaseUrl(baseUrl: string = DEFAULT_KAPSO_API_BASE_URL): string {
  return `${kapsoOrigin(baseUrl)}/meta/whatsapp/${KAPSO_META_API_VERSION}`;
}

async function kapsoRequest<T>(
  options: KapsoOptions,
  operation: string,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const url = `${kapsoOrigin(options.baseUrl)}/platform/v1${path}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      method,
      redirect: 'error',
      headers: {
        'X-API-Key': options.apiKey,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new KapsoApiError('Could not reach Kapso. Try again in a moment.', 0, operation);
  }
  const text = await res.text().catch(() => '');
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const said = ErrorReply.safeParse(json);
    const reason = said.success ? said.data.error.slice(0, 300) : `HTTP ${res.status}`;
    const hint = res.status === 401 ? ' Check the Kapso project API key.' : '';
    throw new KapsoApiError(`Kapso refused to ${operation}: ${reason}.${hint}`, res.status, operation);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new KapsoApiError(`Kapso answered ${operation} in a shape Omni does not know.`, res.status, operation);
  }
  return parsed.data;
}

/** POST /customers: the Kapso customer Omni hangs its setup links off. */
export async function createKapsoCustomer(
  options: KapsoOptions,
  input: { name: string; externalCustomerId: string },
): Promise<{ id: string }> {
  const reply = await kapsoRequest(options, 'create a customer', 'POST', '/customers', CustomerReply, {
    customer: { name: input.name, external_customer_id: input.externalCustomerId },
  });
  return { id: reply.data.id };
}

/**
 * POST /customers/{id}/setup_links: a coexistence link (the person keeps the WhatsApp Business
 * app) that provisions no number. Kapso revokes the customer's previous link.
 */
export async function createKapsoSetupLink(options: KapsoOptions, customerId: string): Promise<KapsoSetupLink> {
  const reply = await kapsoRequest(
    options,
    'create a setup link',
    'POST',
    `/customers/${encodeURIComponent(customerId)}/setup_links`,
    SetupLinkReply,
    { setup_link: { allowed_connection_types: ['coexistence'], provision_phone_number: false } },
  );
  return { url: reply.data.url, expiresAt: reply.data.expires_at ?? null };
}

/** GET /whatsapp/phone_numbers: the project's numbers, most recent first. */
export async function listKapsoPhoneNumbers(options: KapsoOptions): Promise<KapsoPhoneNumber[]> {
  const reply = await kapsoRequest(
    options,
    'list its numbers',
    'GET',
    '/whatsapp/phone_numbers?per_page=100',
    PhoneNumbersReply,
  );
  return reply.data
    .filter((row) => Boolean(row.business_account_id))
    .map((row) => ({
      phoneNumberId: row.phone_number_id,
      wabaId: row.business_account_id as string,
      displayPhoneNumber: row.display_phone_number ?? null,
      name: row.verified_name ?? row.display_name ?? row.name ?? null,
    }));
}

/**
 * The number's Meta-forwarding webhook, pointed at `url` and signed with `secret`. Kapso keeps
 * one `meta` webhook per number: an existing one is updated in place, otherwise one is created.
 */
export async function upsertKapsoMetaWebhook(
  options: KapsoOptions,
  phoneNumberId: string,
  input: { url: string; secret: string },
): Promise<{ id: string; created: boolean }> {
  const base = `/whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}/webhooks`;
  const listed = await kapsoRequest(options, 'list the number webhooks', 'GET', `${base}?kind=meta`, WebhookListReply);
  const existing = listed.data.find((hook) => hook.kind === 'meta' || hook.kind == null);
  const settings = { url: input.url, secret_key: input.secret, active: true };
  if (existing) {
    const reply = await kapsoRequest(
      options,
      'update the number webhook',
      'PATCH',
      `${base}/${encodeURIComponent(existing.id)}`,
      WebhookReply,
      { whatsapp_webhook: settings },
    );
    return { id: reply.data.id, created: false };
  }
  const reply = await kapsoRequest(options, 'create the number webhook', 'POST', base, WebhookReply, {
    whatsapp_webhook: { kind: 'meta', ...settings },
  });
  return { id: reply.data.id, created: true };
}
