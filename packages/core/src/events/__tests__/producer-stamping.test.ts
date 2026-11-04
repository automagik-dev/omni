import { afterEach, expect, spyOn, test } from 'bun:test';
import { resolveAmbientProducingKeyId, setEnvelopeProducerResolver } from '../envelope';
import { createOmniEvent } from '../factory';

const KEY = '10000000-0000-4000-8000-000000000001';
const SPOOF = '10000000-0000-4000-8000-000000000002';
afterEach(() => setEnvelopeProducerResolver(null));

test('caller producingKeyId and agentId never reach the envelope; only the ambient key does', () => {
  setEnvelopeProducerResolver(() => KEY);
  const event = createOmniEvent('custom.proof', {}, { producingKeyId: SPOOF, agentId: SPOOF }, 'proof');
  expect(event.metadata.producingKeyId).toBe(KEY);
  expect(event.metadata).not.toHaveProperty('agentId');
});

test('no resolver preserves the legacy envelope byte for byte, even with spoofed metadata', () => {
  const clock = spyOn(Date, 'now').mockReturnValue(123);
  try {
    const event = createOmniEvent(
      'custom.proof',
      { agentId: SPOOF },
      { publishEventId: KEY, producingKeyId: SPOOF, agentId: SPOOF },
      'proof',
    );
    expect(JSON.stringify(event)).toBe(
      JSON.stringify({
        id: KEY,
        type: 'custom.proof',
        payload: { agentId: SPOOF },
        timestamp: 123,
        metadata: { correlationId: KEY, traceId: KEY, source: 'proof' },
      }),
    );
  } finally {
    clock.mockRestore();
  }
});

test('producer resolver validates UUIDs and contains resolver failures', () => {
  for (const value of [undefined, null, '', 'not-a-uuid']) {
    setEnvelopeProducerResolver(() => value);
    expect(resolveAmbientProducingKeyId()).toBeNull();
    expect(createOmniEvent('custom.proof', {}, undefined, 'proof').metadata).not.toHaveProperty('producingKeyId');
  }
  setEnvelopeProducerResolver(() => {
    throw new Error('unavailable');
  });
  expect(resolveAmbientProducingKeyId()).toBeNull();
});
