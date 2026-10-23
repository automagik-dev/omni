/**
 * The scan-to-connect relay as a Cloudflare Worker (connect.automagik.dev).
 *
 *   POST /v1/slots/:slot   { writeHash }         the device registers its slot
 *   PUT  /v1/slots/:slot   { writeToken, box }   the Omni answers it, once
 *   GET  /v1/slots/:slot                         202 pending, 200 { box } once, then 404
 *   GET  /health
 *
 * Each slot is its own Durable Object (src/slot.ts). It keeps no logs of slot contents and
 * no state past ten minutes; it never sees an address or a key in the clear.
 */

import { type SlotStorage, handleSlot } from './slot';

/** The Durable Object and namespace shapes this worker uses (no workers-types dependency). */
type DurableObjectStorageLike = SlotStorage & { get(key: string): Promise<unknown> };
type DurableObjectStateLike = { storage: DurableObjectStorageLike };
type DurableObjectStubLike = { fetch(request: Request): Promise<Response> };
type DurableObjectNamespaceLike = { idFromName(name: string): unknown; get(id: unknown): DurableObjectStubLike };
export type Env = { SLOTS: DurableObjectNamespaceLike };

const ROUTE = /^\/v1\/slots\/([A-Za-z0-9_-]{16})$/;

export class Slot {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const slot = request.headers.get('x-slot') ?? '';
    return handleSlot(this.state.storage, slot, request);
  }

  /** The slot's ten minutes are up. */
  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return new Response('ok', { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
    }
    const match = url.pathname.match(ROUTE);
    if (!match?.[1]) {
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    const slot = match[1];
    const forwarded = new Request(request.url, {
      method: request.method,
      headers: { 'content-type': 'application/json', 'x-slot': slot },
      body: request.method === 'GET' ? undefined : await request.text(),
    });
    return env.SLOTS.get(env.SLOTS.idFromName(slot)).fetch(forwarded);
  },
};
