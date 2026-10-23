/**
 * One scan-to-connect slot on the relay: created by the device with a write-token hash,
 * written once by the Omni that holds the token, read once by the device, gone after
 * SLOT_TTL_MS whatever happens. One Durable Object per slot keeps every step consistent:
 * the device and the Omni may reach the relay through different locations.
 */

import { MAX_BOX_CHARS, SLOT_PATTERN, SLOT_TTL_MS, sha256 } from './protocol';

export type SlotRecord = { writeHash: string; box: string | null; expiresAt: number };

/** The part of Durable Object storage a slot uses. */
export interface SlotStorage {
  get(key: 'slot'): Promise<SlotRecord | undefined>;
  put(key: 'slot', value: SlotRecord): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(at: number): Promise<void>;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
const failure = (status: number, code: string, message: string) => json(status, { error: { code, message } });

const HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;

async function body(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BOX_CHARS + 1024) return null;
  const text = await request.text().catch(() => '');
  if (text.length > MAX_BOX_CHARS + 1024) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Live record, or undefined once expired (the alarm clears it; this covers the gap). */
async function current(storage: SlotStorage, now: number): Promise<SlotRecord | undefined> {
  const record = await storage.get('slot');
  if (!record) return undefined;
  if (record.expiresAt <= now) {
    await storage.deleteAll();
    return undefined;
  }
  return record;
}

async function create(storage: SlotStorage, request: Request, now: number): Promise<Response> {
  const writeHash = (await body(request))?.writeHash;
  if (typeof writeHash !== 'string' || !HASH_PATTERN.test(writeHash)) {
    return failure(400, 'BODY', 'Body must be { writeHash }');
  }
  if (await current(storage, now)) return failure(409, 'EXISTS', 'This slot is taken');
  const expiresAt = now + SLOT_TTL_MS;
  await storage.put('slot', { writeHash, box: null, expiresAt });
  await storage.setAlarm(expiresAt);
  return json(201, { expiresAt: new Date(expiresAt).toISOString() });
}

async function answer(storage: SlotStorage, request: Request, now: number): Promise<Response> {
  const { writeToken, box } = (await body(request)) ?? {};
  if (typeof writeToken !== 'string' || typeof box !== 'string' || box.length === 0 || box.length > MAX_BOX_CHARS) {
    return failure(400, 'BODY', 'Body must be { writeToken, box }');
  }
  const record = await current(storage, now);
  if (!record) return failure(404, 'GONE', 'No such slot, or it expired');
  if ((await sha256(writeToken)) !== record.writeHash) return failure(403, 'FORBIDDEN', 'Wrong write token');
  if (record.box !== null) return failure(409, 'WRITTEN', 'This slot was already answered');
  await storage.put('slot', { ...record, box });
  return new Response(null, { status: 204 });
}

async function read(storage: SlotStorage, now: number): Promise<Response> {
  const record = await current(storage, now);
  if (!record) return failure(404, 'GONE', 'No such slot, or it expired');
  if (record.box === null) return json(202, { status: 'pending', expiresAt: new Date(record.expiresAt).toISOString() });
  // Read once: the box leaves the relay with this answer.
  await storage.deleteAll();
  return json(200, { box: record.box });
}

/** Handle one request for the slot `slot`; `now` is injected for tests. */
export async function handleSlot(
  storage: SlotStorage,
  slot: string,
  request: Request,
  now = Date.now(),
): Promise<Response> {
  if (!SLOT_PATTERN.test(slot)) return failure(400, 'SLOT', 'Not a slot id');
  if (request.method === 'POST') return create(storage, request, now);
  if (request.method === 'PUT') return answer(storage, request, now);
  if (request.method === 'GET') return read(storage, now);
  return failure(405, 'METHOD', 'POST, PUT or GET');
}
