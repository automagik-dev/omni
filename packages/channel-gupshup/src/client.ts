/**
 * Gupshup REST API client
 *
 * Typed HTTP client for outbound messages via the Gupshup WhatsApp BSP API.
 * Base URL: https://api.gupshup.io/wa/api/v1/msg
 * Auth: apikey header
 * Body: application/x-www-form-urlencoded
 */

import type { GupshupErrorResponse, GupshupInteractiveContent, GupshupSendResponse } from './types';
import { GupshupError, GupshupErrorCode, mapGupshupError } from './utils/errors';

const GUPSHUP_API_URL = 'https://api.gupshup.io/wa/api/v1/msg';
const GUPSHUP_BALANCE_URL = 'https://api.gupshup.io/wa/api/v1/users/balance';

export class GupshupClient {
  constructor(
    private readonly apiKey: string,
    private readonly appName: string,
    private readonly sourcePhone: string,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Outbound message methods
  // ─────────────────────────────────────────────────────────────

  async sendText(to: string, text: string): Promise<GupshupSendResponse> {
    const message = JSON.stringify({ type: 'text', text });
    return this.post(to, message);
  }

  async sendMedia(
    to: string,
    type: 'image' | 'audio' | 'video' | 'file',
    url: string,
    caption?: string,
  ): Promise<GupshupSendResponse> {
    const message = JSON.stringify({ type, url, ...(caption ? { caption } : {}) });
    return this.post(to, message);
  }

  async sendTemplate(to: string, templateId: string, params: Record<string, string>): Promise<GupshupSendResponse> {
    const message = JSON.stringify({
      type: 'template',
      template: {
        id: templateId,
        params: Object.values(params),
      },
    });
    return this.post(to, message);
  }

  async sendInteractive(to: string, interactive: GupshupInteractiveContent): Promise<GupshupSendResponse> {
    const message = JSON.stringify({ type: 'interactive', interactive });
    return this.post(to, message);
  }

  async sendLocation(
    to: string,
    lat: number,
    lng: number,
    name?: string,
    address?: string,
  ): Promise<GupshupSendResponse> {
    const message = JSON.stringify({
      type: 'location',
      location: {
        latitude: String(lat),
        longitude: String(lng),
        ...(name ? { name } : {}),
        ...(address ? { address } : {}),
      },
    });
    return this.post(to, message);
  }

  async sendContact(to: string, contact: { name: string; phone: string }): Promise<GupshupSendResponse> {
    const message = JSON.stringify({
      type: 'contact',
      contact: {
        name: { formatted_name: contact.name },
        phones: [{ phone: contact.phone, type: 'CELL' }],
      },
    });
    return this.post(to, message);
  }

  /**
   * Validate credentials via a lightweight balance check.
   * Returns true if the API key is valid.
   */
  async validateCredentials(): Promise<boolean> {
    try {
      const res = await fetch(GUPSHUP_BALANCE_URL, {
        method: 'GET',
        headers: { apikey: this.apiKey },
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────

  private async post(destination: string, message: string): Promise<GupshupSendResponse> {
    const body = new URLSearchParams({
      channel: 'whatsapp',
      source: this.sourcePhone,
      destination,
      'src.name': this.appName,
      message,
    });

    let res: Response;
    try {
      res = await fetch(GUPSHUP_API_URL, {
        method: 'POST',
        headers: {
          apikey: this.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
    } catch (err) {
      throw mapGupshupError(err);
    }

    if (!res.ok) {
      let errorBody: GupshupErrorResponse | null = null;
      try {
        errorBody = (await res.json()) as GupshupErrorResponse;
      } catch {
        // ignore parse failures
      }
      const message = errorBody?.message ?? `HTTP ${res.status}`;
      throw mapGupshupError(new Error(message), res.status);
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new GupshupError(GupshupErrorCode.UNKNOWN, 'Failed to parse Gupshup API response', false);
    }

    return data as GupshupSendResponse;
  }
}
