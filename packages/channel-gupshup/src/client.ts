/**
 * Gupshup Custom Integration client
 *
 * Posts outbound messages to the Gupshup Custom Integration callback URL.
 * Auth: Authorization header with the provided auth token.
 */

import type { GupshupOutboundMessage, GupshupSendResponse } from './types';
import { GupshupError, GupshupErrorCode } from './utils/errors';

/** Copy close-contact classification keys; callers must only pass CLOSING messages. */
function addCloseFields(payload: Record<string, unknown>, msg: GupshupOutboundMessage): void {
  if (msg.close_reason) payload.close_reason = msg.close_reason;
  if (msg.close_outcome) payload.close_outcome = msg.close_outcome;
  if (msg.close_fields) payload.close_fields = msg.close_fields;
}

/** Reply buttons / list / flow — each maps to its own Journey node. */
function addInteractiveFields(payload: Record<string, unknown>, msg: GupshupOutboundMessage): void {
  if (msg.type === 'BUTTONS' && msg.buttons) payload.buttons = msg.buttons;
  if (msg.type === 'LIST' && msg.list) payload.list = msg.list;
  if (msg.type === 'FLOW' && msg.flow) payload.flow = msg.flow;
}

function addLocationFields(payload: Record<string, unknown>, msg: GupshupOutboundMessage): void {
  payload.latitude = String(msg.latitude);
  payload.longitude = String(msg.longitude);
  if (msg.name) payload.name = msg.name;
  if (msg.address) payload.address = msg.address;
}

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
    if (msg.type === 'LOCATION') addLocationFields(payload, msg);
    if (msg.dados_lead) payload.dados_lead = msg.dados_lead;
    if (msg.motivo_handoff) payload.motivo_handoff = msg.motivo_handoff;
    if (msg.handoff_fields) payload.handoff_fields = msg.handoff_fields;
    if (msg.customer_fields && msg.customer_fields.length > 0) payload.customerFields = msg.customer_fields;
    // Close-contact classification (CLOSING only). Forwarded so the Journey can
    // record why and how the conversation ended; omitted when not provided.
    if (msg.type === 'CLOSING') addCloseFields(payload, msg);
    addInteractiveFields(payload, msg);

    // POST to callback URL
    const res = await fetch(this.callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: this.authToken },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new GupshupError(GupshupErrorCode.AUTH_FAILED, `HTTP ${res.status}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as GupshupSendResponse;
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
