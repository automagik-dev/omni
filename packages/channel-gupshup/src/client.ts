/**
 * Gupshup Custom Integration client
 *
 * Posts outbound messages to the Gupshup Custom Integration callback URL.
 * Auth: Authorization header with the provided auth token.
 */

import type { GupshupOutboundMessage, GupshupSendResponse } from './types';
import { GupshupError, GupshupErrorCode } from './utils/errors';

export class GupshupClient {
  constructor(
    private readonly callbackUrl: string,
    private readonly authToken: string,
    private readonly eventId: string,
  ) {}

  async send(phone: string, msg: GupshupOutboundMessage): Promise<GupshupSendResponse> {
    // Build payload
    const payload: Record<string, unknown> = {
      customer_id: phone,
      user: { phone },
      event_id: this.eventId,
      event_time: new Date().toISOString(),
      msg_type: msg.type,
      message_text: msg.text ?? '',
    };
    if (msg.url) payload.media_url = msg.url;
    if (msg.caption) payload.caption = msg.caption;
    if (msg.filename) payload.filename = msg.filename;
    if (msg.type === 'LOCATION') {
      payload.latitude = String(msg.latitude);
      payload.longitude = String(msg.longitude);
      if (msg.name) payload.name = msg.name;
      if (msg.address) payload.address = msg.address;
    }

    // POST to callback URL
    const res = await fetch(this.callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: this.authToken },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new GupshupError(GupshupErrorCode.AUTH_FAILED, `HTTP ${res.status}`);
    return res.json() as Promise<GupshupSendResponse>;
  }

  async validateCredentials(): Promise<boolean> {
    // POST a minimal test payload — 403 = bad auth
    try {
      const res = await fetch(this.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: this.authToken },
        body: JSON.stringify({
          customer_id: 'test',
          user: { phone: 'test' },
          event_id: this.eventId,
          event_time: new Date().toISOString(),
          msg_type: 'TEXT',
          message_text: '',
        }),
      });
      return res.status !== 401 && res.status !== 403;
    } catch {
      return false;
    }
  }
}
