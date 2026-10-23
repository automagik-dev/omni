import { describe, expect, test } from 'bun:test';
import {
  SLOT_TTL_MS,
  isPairing,
  newPairing,
  open,
  pairingInMessage,
  pairingMessage,
  seal,
  writeHashOf,
  writeTokenOf,
} from '../protocol';
import { type SlotRecord, type SlotStorage, handleSlot } from '../slot';
import worker, { Slot } from '../worker';

const payload = {
  url: 'https://omni.example.test',
  apiKey: 'omni_sk_example',
  keyId: 'key-1',
  scopes: ['messages:read'],
  keyExpiresAt: null,
};

function memoryStorage(): SlotStorage & { record(): SlotRecord | undefined; alarm: number | null } {
  let value: SlotRecord | undefined;
  const storage = {
    alarm: null as number | null,
    record: () => value,
    get: async () => (value ? structuredClone(value) : undefined),
    put: async (_key: 'slot', next: SlotRecord) => {
      value = structuredClone(next);
    },
    deleteAll: async () => {
      value = undefined;
    },
    setAlarm: async (at: number) => {
      storage.alarm = at;
    },
  };
  return storage;
}

const req = (method: string, body?: unknown) =>
  new Request('https://relay.test/v1/slots/x', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe('the protocol', () => {
  test('a pairing is two random strings the QR can carry, and a message gives it back', () => {
    const pairing = newPairing();
    expect(isPairing(pairing)).toBe(true);
    expect(newPairing().slot).not.toBe(pairing.slot);
    expect(pairingInMessage(pairingMessage(pairing))).toEqual(pairing);
    expect(pairingInMessage(`omni-connect:${pairing.slot}.${pairing.key}`)).toEqual(pairing);
    // Quoted inside a longer message, it is not a pairing.
    expect(pairingInMessage(`look at this omni-connect:${pairing.slot}.${pairing.key} please`)).toBeNull();
    expect(pairingInMessage(`a\nb\nomni-connect:${pairing.slot}.${pairing.key}`)).toBeNull();
  });

  test('a sealed box opens with its pairing and nothing else', async () => {
    const pairing = newPairing();
    const box = await seal(pairing, payload);
    expect(box).not.toContain('omni_sk_example');
    expect(await open(pairing, box)).toEqual(payload);
    await expect(open(newPairing(), box)).rejects.toThrow();
    // The slot is the associated data: the same key under another slot does not open it.
    await expect(open({ slot: newPairing().slot, key: pairing.key }, box)).rejects.toThrow();
  });

  test('the write token comes from the key; the relay holds only its hash', async () => {
    const pairing = newPairing();
    const token = await writeTokenOf(pairing);
    expect(await writeTokenOf(pairing)).toBe(token);
    expect(await writeHashOf(pairing)).not.toBe(token);
    expect(await writeTokenOf({ ...pairing, key: newPairing().key })).not.toBe(token);
  });
});

describe('a slot', () => {
  test('is created once, answered once by the token holder, read once, then gone', async () => {
    const storage = memoryStorage();
    const pairing = newPairing();
    const now = 1_000_000;
    const created = await handleSlot(
      storage,
      pairing.slot,
      req('POST', { writeHash: await writeHashOf(pairing) }),
      now,
    );
    expect(created.status).toBe(201);
    expect(storage.alarm).toBe(now + SLOT_TTL_MS);
    expect(
      (await handleSlot(storage, pairing.slot, req('POST', { writeHash: await writeHashOf(pairing) }), now)).status,
    ).toBe(409);
    expect((await handleSlot(storage, pairing.slot, req('GET'), now)).status).toBe(202);

    const box = await seal(pairing, payload);
    const forged = await handleSlot(
      storage,
      pairing.slot,
      req('PUT', { writeToken: await writeTokenOf(newPairing()), box }),
      now,
    );
    expect(forged.status).toBe(403);
    const answered = await handleSlot(
      storage,
      pairing.slot,
      req('PUT', { writeToken: await writeTokenOf(pairing), box }),
      now,
    );
    expect(answered.status).toBe(204);
    expect(
      (await handleSlot(storage, pairing.slot, req('PUT', { writeToken: await writeTokenOf(pairing), box }), now))
        .status,
    ).toBe(409);

    const read = await handleSlot(storage, pairing.slot, req('GET'), now);
    expect(read.status).toBe(200);
    expect(await open(pairing, ((await read.json()) as { box: string }).box)).toEqual(payload);
    expect(storage.record()).toBeUndefined();
    expect((await handleSlot(storage, pairing.slot, req('GET'), now)).status).toBe(404);
  });

  test('expires after ten minutes whatever happened, and refuses what is not a slot', async () => {
    const storage = memoryStorage();
    const pairing = newPairing();
    await handleSlot(storage, pairing.slot, req('POST', { writeHash: await writeHashOf(pairing) }), 0);
    expect((await handleSlot(storage, pairing.slot, req('GET'), SLOT_TTL_MS)).status).toBe(404);
    const late = await handleSlot(
      storage,
      pairing.slot,
      req('PUT', { writeToken: await writeTokenOf(pairing), box: 'x' }),
      SLOT_TTL_MS + 1,
    );
    expect(late.status).toBe(404);
    expect((await handleSlot(storage, 'short', req('GET'))).status).toBe(400);
    expect((await handleSlot(storage, pairing.slot, req('POST', { writeHash: 'nope' }))).status).toBe(400);
    expect(
      (await handleSlot(storage, pairing.slot, req('PUT', { writeToken: 'x', box: 'y'.repeat(9000) }))).status,
    ).toBe(400);
    expect((await handleSlot(storage, pairing.slot, req('DELETE'))).status).toBe(405);
  });
});

describe('the worker', () => {
  test('routes a slot to its own Durable Object, and answers /health', async () => {
    const objects = new Map<string, Slot>();
    const env = {
      SLOTS: {
        idFromName: (name: string) => name,
        get: (id: unknown) => {
          const name = String(id);
          if (!objects.has(name)) objects.set(name, new Slot({ storage: memoryStorage() as never }));
          return objects.get(name) as Slot;
        },
      },
    };
    const pairing = newPairing();
    const at = (method: string, body?: unknown) =>
      worker.fetch(
        new Request(`https://connect.example/v1/slots/${pairing.slot}`, {
          method,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        env,
      );
    expect((await at('POST', { writeHash: await writeHashOf(pairing) })).status).toBe(201);
    expect(
      (await at('PUT', { writeToken: await writeTokenOf(pairing), box: await seal(pairing, payload) })).status,
    ).toBe(204);
    expect((await at('GET')).status).toBe(200);
    expect(objects.size).toBe(1);
    expect((await worker.fetch(new Request('https://connect.example/health'), env)).status).toBe(200);
    expect((await worker.fetch(new Request('https://connect.example/v1/slots/bad'), env)).status).toBe(404);
  });
});
