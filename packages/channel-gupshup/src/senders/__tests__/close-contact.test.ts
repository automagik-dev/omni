/**
 * Tests for sendCloseContact — payload-shape correctness.
 *
 * The sender is a thin adapter: takes the route's logical args and posts
 * them to the Gupshup client as the literal `msg_type: 'CLOSING'`. These
 * tests assert that the payload is built correctly with all combinations
 * of optional fields, and that the literal type string is stable
 * (Gupshup's Journey routes on it).
 */
import { describe, expect, test } from 'bun:test';
import type { GupshupClient } from '../../client';
import type { GupshupOutboundMessage, GupshupSendResponse } from '../../types';
import { GUPSHUP_CLOSE_MSG_TYPE, sendCloseContact } from '../close-contact';

interface CapturedSend {
  to: string;
  message: GupshupOutboundMessage;
}

function makeFakeClient(): { client: GupshupClient; captured: CapturedSend[] } {
  const captured: CapturedSend[] = [];
  const client = {
    async send(to: string, message: GupshupOutboundMessage): Promise<GupshupSendResponse> {
      captured.push({ to, message });
      return { messageId: 'fake-msg-id', timestamp: 1700000000 };
    },
  } as unknown as GupshupClient;
  return { client, captured };
}

describe('sendCloseContact', () => {
  test('GUPSHUP_CLOSE_MSG_TYPE is "CLOSING" — partner contract', () => {
    expect(GUPSHUP_CLOSE_MSG_TYPE).toBe('CLOSING');
  });

  test('emits CLOSING type literal and the farewell text', async () => {
    const { client, captured } = makeFakeClient();
    const result = await sendCloseContact(client, '5511987654321', 'Tudo certo!');
    expect(result.messageId).toBe('fake-msg-id');
    expect(captured).toHaveLength(1);
    expect(captured[0]?.to).toBe('5511987654321');
    expect(captured[0]?.message.type).toBe('CLOSING');
    expect(captured[0]?.message.text).toBe('Tudo certo!');
  });

  test('forwards optional close_reason / close_outcome / close_fields', async () => {
    const { client, captured } = makeFakeClient();
    await sendCloseContact(client, '5511987654321', 'Bye!', 'lead já é cliente', 'redirected_sac', {
      plan_interest: 'NP-AHO',
      value_brl: 487.3,
    });
    expect(captured[0]?.message.close_reason).toBe('lead já é cliente');
    expect(captured[0]?.message.close_outcome).toBe('redirected_sac');
    expect(captured[0]?.message.close_fields).toEqual({ plan_interest: 'NP-AHO', value_brl: 487.3 });
  });

  test('omits optional fields when not provided', async () => {
    const { client, captured } = makeFakeClient();
    await sendCloseContact(client, '5511987654321', 'Bye!');
    const msg = captured[0]?.message;
    expect(msg?.close_reason).toBeUndefined();
    expect(msg?.close_outcome).toBeUndefined();
    expect(msg?.close_fields).toBeUndefined();
  });

  test('does NOT emit handoff fields (separate primitive)', async () => {
    const { client, captured } = makeFakeClient();
    await sendCloseContact(client, '5511987654321', 'Bye!', 'reason', 'won');
    const msg = captured[0]?.message;
    // Sanity: close-contact must never accidentally populate handoff fields.
    expect(msg?.dados_lead).toBeUndefined();
    expect(msg?.motivo_handoff).toBeUndefined();
    expect(msg?.handoff_fields).toBeUndefined();
  });
});
