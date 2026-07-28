/**
 * Meta WhatsApp Cloud API client.
 *
 * Wraps Graph API endpoints scoped to a single (phone_number_id, access_token)
 * pair. One instance per WhatsApp Cloud Omni instance.
 *
 * Reference:
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/reference
 */

import type {
  MetaApiError as MetaApiErrorEnvelope,
  MetaOutboundMessage,
  MetaSendResponse,
  MetaTemplatePayload,
} from './types';
import { MetaApiError as MetaApiErrorClass, MetaErrorCode, mapHttpStatusToMetaError } from './utils/errors';

const DEFAULT_TIMEOUT_MS = 30_000;

type MetaTemplateComponent = NonNullable<MetaTemplatePayload['components']>[number];
type MetaTemplateParameter = NonNullable<MetaTemplateComponent['parameters']>[number];

/** Header media descriptor accepted by `buildTemplatePayload`. */
export interface TemplateHeaderMedia {
  type: 'image' | 'video' | 'document';
  link?: string;
  id?: string;
  filename?: string;
}

/** Button parameter descriptor accepted by `buildTemplatePayload`. */
export interface TemplateButtonParameter {
  sub_type: 'quick_reply' | 'url' | 'copy_code';
  index: number;
  payload?: string;
  text?: string;
}

/** Build the `header` template component for a media header. */
function buildHeaderComponent(headerMedia: TemplateHeaderMedia): MetaTemplateComponent {
  return { type: 'header', parameters: [buildHeaderParameter(headerMedia)] };
}

function buildHeaderParameter(headerMedia: TemplateHeaderMedia): MetaTemplateParameter {
  if (headerMedia.type === 'image') {
    return { type: 'image', image: { link: headerMedia.link, id: headerMedia.id } };
  }
  if (headerMedia.type === 'video') {
    return { type: 'video', video: { link: headerMedia.link, id: headerMedia.id } };
  }
  return {
    type: 'document',
    document: { link: headerMedia.link, id: headerMedia.id, filename: headerMedia.filename },
  };
}

/** Build a `button` template component (`url` buttons carry text, the rest a payload). */
function buildButtonComponent(button: TemplateButtonParameter): MetaTemplateComponent {
  const parameter: MetaTemplateParameter =
    button.sub_type === 'url'
      ? { type: 'text', text: button.text ?? '' }
      : { type: 'payload', payload: button.payload ?? button.text ?? '' };
  return { type: 'button', sub_type: button.sub_type, index: String(button.index), parameters: [parameter] };
}

export interface MetaWhatsAppClientOptions {
  phoneNumberId: string;
  accessToken: string;
  /** Default: 'v25.0'. */
  apiVersion?: string;
  /** Optional override for the Graph API base URL (mostly for tests). */
  baseUrl?: string;
  timeoutMs?: number;
}

export class MetaWhatsAppClient {
  readonly phoneNumberId: string;
  readonly wabaId?: string;
  readonly apiVersion: string;

  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: MetaWhatsAppClientOptions, wabaId?: string) {
    this.phoneNumberId = opts.phoneNumberId;
    this.accessToken = opts.accessToken;
    this.apiVersion = opts.apiVersion ?? 'v25.0';
    this.wabaId = wabaId;
    this.baseUrl = opts.baseUrl ?? `https://graph.facebook.com/${this.apiVersion}`;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ─────────────────────────────────────────────────────────────
  // Messages
  // ─────────────────────────────────────────────────────────────

  /** POST /{phone_number_id}/messages */
  async sendMessage(message: MetaOutboundMessage): Promise<MetaSendResponse> {
    return this.post<MetaSendResponse>(`/${this.phoneNumberId}/messages`, message);
  }

  /** Convenience for marking an inbound message as read. */
  async markAsRead(messageId: string): Promise<void> {
    await this.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
  }

  /**
   * Show the typing indicator for a conversation. Meta couples it to marking
   * the referenced INBOUND message as read (`status: "read"` is mandatory in
   * the same call), so `messageId` must be a received wamid. The indicator
   * self-dismisses when we reply or after ~25s — there is no cancel endpoint.
   */
  async sendTypingIndicator(messageId: string): Promise<void> {
    await this.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
      typing_indicator: { type: 'text' },
    });
  }

  /** GET /{media_id} — returns a temporary download URL for inbound media. */
  async getMediaUrl(mediaId: string): Promise<{ url: string; mime_type: string; sha256?: string; file_size?: number }> {
    return this.get(`/${mediaId}`);
  }

  /** Download bytes from a media URL (must include Bearer auth — URL is short-lived). */
  async downloadMedia(downloadUrl: string): Promise<ArrayBuffer> {
    const res = await this.fetchWithTimeout(downloadUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw await this.errorFromResponse(res, 'GET media');
    return res.arrayBuffer();
  }

  // ─────────────────────────────────────────────────────────────
  // Templates (HSM)
  // ─────────────────────────────────────────────────────────────

  /** Helper to construct a `template` outbound payload from a template name + variables. */
  buildTemplatePayload(opts: {
    name: string;
    language: string;
    bodyParameters?: string[];
    headerMedia?: TemplateHeaderMedia;
    buttonParameters?: TemplateButtonParameter[];
  }): MetaTemplatePayload {
    const components: NonNullable<MetaTemplatePayload['components']> = [];

    if (opts.headerMedia) {
      components.push(buildHeaderComponent(opts.headerMedia));
    }

    if (opts.bodyParameters && opts.bodyParameters.length > 0) {
      components.push({
        type: 'body',
        parameters: opts.bodyParameters.map((text) => ({ type: 'text', text })),
      });
    }

    for (const button of opts.buttonParameters ?? []) {
      components.push(buildButtonComponent(button));
    }

    return {
      name: opts.name,
      language: { code: opts.language, policy: 'deterministic' },
      components: components.length > 0 ? components : undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Phone number / profile / quality
  // ─────────────────────────────────────────────────────────────

  /** GET /{phone_number_id} — returns quality_rating, messaging_limit, etc. */
  async getPhoneNumberInfo(): Promise<Record<string, unknown>> {
    return this.get(`/${this.phoneNumberId}?fields=verified_name,quality_rating,messaging_limit_tier,throughput`);
  }

  /** GET /{phone_number_id}/whatsapp_business_profile */
  async getBusinessProfile(): Promise<Record<string, unknown>> {
    return this.get(
      `/${this.phoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,vertical,websites`,
    );
  }

  /** POST /{phone_number_id}/whatsapp_business_profile */
  async updateBusinessProfile(profile: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.post(`/${this.phoneNumberId}/whatsapp_business_profile`, { messaging_product: 'whatsapp', ...profile });
  }

  /** POST /{phone_number_id}/register — required for new numbers via Embedded Signup. */
  async registerPhoneNumber(pin?: string): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = { messaging_product: 'whatsapp' };
    if (pin) payload.pin = pin;
    return this.post(`/${this.phoneNumberId}/register`, payload);
  }

  // ─────────────────────────────────────────────────────────────
  // HTTP helpers
  // ─────────────────────────────────────────────────────────────

  async get<T = unknown>(path: string): Promise<T> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (!res.ok) throw await this.errorFromResponse(res, `GET ${path}`);
    return res.json() as Promise<T>;
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.errorFromResponse(res, `POST ${path}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  async delete<T = unknown>(path: string): Promise<T> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw await this.errorFromResponse(res, `DELETE ${path}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async errorFromResponse(res: Response, op: string): Promise<MetaApiErrorClass> {
    let envelope: MetaApiErrorEnvelope | undefined;
    let bodyText = '';
    try {
      bodyText = await res.text();
      envelope = bodyText ? (JSON.parse(bodyText) as MetaApiErrorEnvelope) : undefined;
    } catch {
      /* leave envelope undefined */
    }
    const apiError = envelope?.error;
    const code =
      apiError?.code !== undefined ? mapHttpStatusToMetaError(apiError.code) : mapHttpStatusToMetaError(res.status);
    const message =
      apiError?.message ?? `HTTP ${res.status} from ${op}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`;
    return new MetaApiErrorClass(code, message, {
      httpStatus: res.status,
      operation: op,
      metaErrorCode: apiError?.code,
      metaErrorSubcode: apiError?.error_subcode,
      fbtraceId: apiError?.fbtrace_id,
      raw: envelope ?? bodyText,
    });
  }

  /** True when the underlying access_token is still valid (used by getHealth). */
  async ping(): Promise<boolean> {
    try {
      await this.getPhoneNumberInfo();
      return true;
    } catch (err) {
      if (err instanceof MetaApiErrorClass && err.code === MetaErrorCode.AUTH_FAILED) return false;
      // Network errors → treat as unhealthy but not as auth failure.
      return false;
    }
  }
}
