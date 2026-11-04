import { afterEach, expect, test } from 'bun:test';
import { createOmniEvent, setEnvelopeProducerResolver } from '@omni/core';
import { currentProducingKeyId, runWithProducingKey } from '../producer-scope';

const KEY = '10000000-0000-4000-8000-000000000001';
afterEach(() => setEnvelopeProducerResolver(null));

test('a real timer inherited from a finished request cannot stamp its key', async () => {
  setEnvelopeProducerResolver(currentProducingKeyId);
  let release = () => {};
  const responseEnded = new Promise<void>((resolve) => {
    release = resolve;
  });
  let complete: (value: ReturnType<typeof createOmniEvent>) => void = () => {};
  const published = new Promise<ReturnType<typeof createOmniEvent>>((resolve) => {
    complete = resolve;
  });
  await runWithProducingKey(KEY, async () => {
    setTimeout(async () => {
      await responseEnded;
      complete(createOmniEvent('message.received', {}, undefined, 'late-channel'));
    }, 0);
  });
  release();
  expect((await published).metadata).not.toHaveProperty('producingKeyId');
});

test('publishes awaited inside an active request still carry its key', async () => {
  setEnvelopeProducerResolver(currentProducingKeyId);
  await runWithProducingKey(KEY, async () => {
    const event = await new Promise<ReturnType<typeof createOmniEvent>>((resolve) => {
      setTimeout(() => resolve(createOmniEvent('custom.awaited', {}, undefined, 'request')), 0);
    });
    expect(event.metadata.producingKeyId).toBe(KEY);
  });
  expect(currentProducingKeyId()).toBeNull();
});

test('a throwing request also revokes its inherited timer holder', async () => {
  let complete: (value: string | null) => void = () => {};
  const observed = new Promise<string | null>((resolve) => {
    complete = resolve;
  });
  await expect(
    runWithProducingKey(KEY, async () => {
      setTimeout(() => complete(currentProducingKeyId()), 0);
      throw new Error('request failed');
    }),
  ).rejects.toThrow('request failed');
  expect(await observed).toBeNull();
});
