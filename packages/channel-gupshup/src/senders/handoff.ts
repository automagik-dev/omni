/**
 * Gupshup HANDOFF message sender
 */

import type { GupshupClient } from '../client';
import type { GupshupCustomerField } from '../handoff-options';
import type { GupshupSendResponse } from '../types';

export async function sendHandoff(
  client: GupshupClient,
  to: string,
  text: string,
  dadosLead?: string,
  motivoHandoff?: string,
  handoffFields?: Record<string, unknown>,
  customerFields?: GupshupCustomerField[],
): Promise<GupshupSendResponse> {
  return client.send(to, {
    type: 'HANDOFF',
    text,
    dados_lead: dadosLead,
    motivo_handoff: motivoHandoff,
    handoff_fields: handoffFields,
    ...(customerFields ? { customer_fields: customerFields } : {}),
  });
}
