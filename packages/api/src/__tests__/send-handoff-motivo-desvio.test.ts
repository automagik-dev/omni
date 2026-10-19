/**
 * `motivoDesvio` on /send/handoff: an optional audit tag from the calling agent
 * saying whether it had to normalize `motivoHandoff` before sending. `null`
 * means "no normalization needed" and must be accepted: agents send it on most
 * handoffs, and a 400 here would fail the handoff itself.
 */
import { describe, expect, test } from 'bun:test';
import { sendHandoffSchema } from '../schemas/openapi/messages';

const base = {
  instanceId: '00000000-0000-4000-8000-000000000000',
  chatId: 'chat-uuid',
  to: '5511999990000',
  text: 'Vou te conectar.',
  motivoHandoff: 'Gatilho: pediu humano ||| Obs: -',
};

describe('sendHandoffSchema.motivoDesvio', () => {
  test('accepts null (label came ready from the model)', () => {
    const r = sendHandoffSchema.safeParse({ ...base, motivoDesvio: null });
    expect(r.success).toBe(true);
    expect(r.success && r.data.motivoDesvio).toBeNull();
  });

  test('accepts a normalizer key', () => {
    const r = sendHandoffSchema.safeParse({ ...base, motivoDesvio: 'missing_separator' });
    expect(r.success && r.data.motivoDesvio).toBe('missing_separator');
  });

  test('absent stays absent (older agents)', () => {
    const r = sendHandoffSchema.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.success && 'motivoDesvio' in r.data).toBe(false);
  });

  test('rejects free text disguised as a key', () => {
    expect(sendHandoffSchema.safeParse({ ...base, motivoDesvio: 'x'.repeat(41) }).success).toBe(false);
  });
});
