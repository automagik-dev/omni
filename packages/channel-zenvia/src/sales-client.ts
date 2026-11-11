import type { ZodType } from 'zod';

import {
  type ZenviaSalesGroups,
  ZenviaSalesGroupsSchema,
  type ZenviaSalesProspect,
  ZenviaSalesProspectSchema,
  ZenviaSalesTransferResponseSchema,
} from './types';
import { ZenviaApiError, ZenviaErrorCode } from './utils/errors';
import { parseJsonOrUndefined, readBodyText, zenviaErrorFromResponse, zenviaFetch } from './utils/http';

const DEFAULT_TIMEOUT_MS = 30_000;

export const DEFAULT_ZENVIA_SALES_BASE_URL = 'https://sales.zenvia.com/api/v1';

export interface ZenviaSalesClientOptions {
  baseUrl?: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface ZenviaTransferTarget {
  group: string;
  user?: string;
}

interface SalesRequestInit {
  method: 'GET' | 'POST';
  path: string;
  operation: string;
  query?: Record<string, string>;
  body?: unknown;
}

function isNotFound(err: unknown): boolean {
  return err instanceof ZenviaApiError && err.httpStatus === 404;
}

function isRejectedLookup(err: unknown): boolean {
  return (
    err instanceof ZenviaApiError && (err.httpStatus === 404 || err.channelCode === ZenviaErrorCode.INVALID_REQUEST)
  );
}

export class ZenviaSalesClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: ZenviaSalesClientOptions) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_ZENVIA_SALES_BASE_URL).replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async listGroups(): Promise<ZenviaSalesGroups> {
    const text = await this.request({ method: 'GET', path: '/groups', operation: 'listGroups' });
    return this.parse(text, ZenviaSalesGroupsSchema, 'listGroups');
  }

  async findProspectByPhone(phone: string): Promise<ZenviaSalesProspect | null> {
    const digits = phone.replace(/\D/g, '');
    if (!digits) return null;
    const candidates = [`+${digits}`, digits];
    for (const [index, candidate] of candidates.entries()) {
      const isLast = index === candidates.length - 1;
      try {
        const text = await this.request({
          method: 'GET',
          path: '/prospect-by',
          query: { phoneNumber: candidate },
          operation: 'findProspectByPhone',
        });
        return this.parse(text, ZenviaSalesProspectSchema, 'findProspectByPhone');
      } catch (err) {
        if (isLast && isNotFound(err)) return null;
        if (!isLast && isRejectedLookup(err)) continue;
        throw err;
      }
    }
    return null;
  }

  async transferProspect(prospectId: string, target: ZenviaTransferTarget): Promise<void> {
    const text = await this.request({
      method: 'POST',
      path: `/prospect/${encodeURIComponent(prospectId)}/transfer`,
      operation: 'transferProspect',
      body: target.user ? { user: target.user, group: target.group } : { group: target.group },
    });
    const parsed = ZenviaSalesTransferResponseSchema.safeParse(parseJsonOrUndefined(text));
    if (parsed.success && parsed.data.success === false) {
      throw new ZenviaApiError(ZenviaErrorCode.REFUSED, 'Zenvia did not confirm the transfer (success=false)', {
        operation: 'transferProspect',
      });
    }
  }

  async createNote(prospectId: string, content: string): Promise<void> {
    await this.request({
      method: 'POST',
      path: `/prospect/${encodeURIComponent(prospectId)}/interactions`,
      operation: 'createNote',
      body: { type: 'note', content },
    });
  }

  private async request(init: SalesRequestInit): Promise<string> {
    const url = new URL(`${this.baseUrl}${init.path}`);
    url.searchParams.set('api-key', this.apiKey);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);

    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await zenviaFetch(
      url.toString(),
      {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      },
      { timeoutMs: this.timeoutMs, operation: `Sales ${init.operation}` },
    );
    if (!res.ok) {
      throw await zenviaErrorFromResponse(res, `Sales ${init.operation}`);
    }
    return readBodyText(res, `Sales ${init.operation}`);
  }

  private parse<T>(text: string, schema: ZodType<T>, operation: string): T {
    const parsed = schema.safeParse(parseJsonOrUndefined(text));
    if (!parsed.success) {
      throw new ZenviaApiError(
        ZenviaErrorCode.UPSTREAM_ERROR,
        `Zenvia Sales ${operation} returned an unexpected payload`,
        { operation },
      );
    }
    return parsed.data;
  }
}
