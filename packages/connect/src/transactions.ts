/**
 * Pending sign-ins live in bounded process memory and are never persisted; a restart loses them.
 * Ten-minute TTL, at most 128 entries (a new start is refused while full of live entries, so a
 * flood cannot evict a real pending login), one active entry per browser (a new start drops the
 * browser's previous one) and consume-once: the callback removes the entry before any exchange.
 */
import type { IssuePurpose } from './store-port';

export interface PendingTransaction {
  /** The transaction cookie value. */
  readonly id: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly purpose: IssuePurpose;
  /** The installation generation snapshotted before the provider redirect. */
  readonly generation: number;
  /** Epoch ms; the ID token's iat may not be older than this minus the allowed skew. */
  readonly startedAt: number;
  /** Seconds; set only when the flow sends max_age, which then requires auth_time. */
  readonly maxAge?: number;
}
export type TransactionLimits = { ttlMs: number; capacity: number };
export const TRANSACTION_LIMITS: TransactionLimits = { ttlMs: 10 * 60 * 1000, capacity: 128 };

export function randomToken(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
}

export class TransactionStore {
  readonly #entries = new Map<string, PendingTransaction>();
  readonly #limits: TransactionLimits;
  readonly #now: () => number;

  constructor(limits: TransactionLimits = TRANSACTION_LIMITS, now: () => number = Date.now) {
    this.#limits = limits;
    this.#now = now;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Starts a transaction, dropping the browser's previous one; null while full of live entries. */
  begin(previousId: string | null, fields: Omit<PendingTransaction, 'id' | 'startedAt'>): PendingTransaction | null {
    if (previousId !== null) this.#entries.delete(previousId);
    const now = this.#now();
    for (const [id, tx] of this.#entries) if (now - tx.startedAt >= this.#limits.ttlMs) this.#entries.delete(id);
    if (this.#entries.size >= this.#limits.capacity) return null;
    const tx: PendingTransaction = { ...fields, id: randomToken(), startedAt: now };
    this.#entries.set(tx.id, tx);
    return tx;
  }

  /** Removes and returns the live entry; a second call for the same id gets null. */
  consume(id: string | null): PendingTransaction | null {
    const tx = id === null ? undefined : this.#entries.get(id);
    if (!tx) return null;
    this.#entries.delete(tx.id);
    return this.#now() - tx.startedAt < this.#limits.ttlMs ? tx : null;
  }
}

/** A fixed-window counter: `take` succeeds at most `limit` times per `windowMs`. */
export function rateLimiter(limit: number, windowMs: number, now: () => number): { take(): boolean } {
  let windowStart = Number.NEGATIVE_INFINITY;
  let count = 0;
  return {
    take() {
      if (now() - windowStart >= windowMs) [windowStart, count] = [now(), 0];
      count += 1;
      return count <= limit;
    },
  };
}

/** A request body as text, or null when larger than `maxBytes`; reading stops at the cap. */
export async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declared) || declared > maxBytes) return null;
  const bytes = await readCapped(request.body, maxBytes);
  // Buffer UTF-8 decoding of the whole body: a leading BOM stays U+FEFF, invalid bytes become U+FFFD.
  return bytes === null ? null : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
}

/**
 * A stream's bytes in one ArrayBuffer-backed array, or null once they exceed `maxBytes`; reading
 * stops and the stream is cancelled at the cap. The reader is released on every path (end, cap,
 * stream error, cancel failure), as async iteration did. Uses a reader, not async iteration, so it
 * compiles under any consumer lib set (DOM included).
 */
export async function readCapped(stream: ByteStream | null, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = stream?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader?.releaseLock();
    } catch {
      // Never let releasing the lock replace the result or the real error.
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** The part of a byte stream readCapped uses; the DOM, Node and Bun stream types all satisfy it. */
type ByteStream = {
  getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void>; releaseLock(): void };
};
