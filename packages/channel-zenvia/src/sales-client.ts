import type { ZodType } from 'zod';

import {
  type ZenviaSalesGroups,
  ZenviaSalesGroupsSchema,
  type ZenviaSalesProspect,
  ZenviaSalesProspectSchema,
  ZenviaSalesTransferResponseSchema,
} from './types';
import { ZenviaApiError, ZenviaErrorCode } from './utils/errors';
import { zenviaErrorFromResponse } from './utils/http-error';

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
  allowNotFound?: boolean;
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
    const res = await this.request({ method: 'GET', path: '/groups', operation: 'listGroups' });
    return this.parse(res, ZenviaSalesGroupsSchema, 'listGroups');
  }

  async findProspectByPhone(phone: string): Promise<ZenviaSalesProspect | null> {
    const digits = phone.replace(/\D/g, '');
    for (const candidate of [`+${digits}`, digits]) {
      const res = await this.request({
        method: 'GET',
        path: '/prospect-by',
        query: { phoneNumber: candidate },
        operation: 'findProspectByPhone',
        allowNotFound: true,
      });
      if (res) return this.parse(res, ZenviaSalesProspectSchema, 'findProspectByPhone');
    }
    return null;
  }

  async transferProspect(prospectId: string, target: ZenviaTransferTarget): Promise<void> {
    const res = await this.request({
      method: 'POST',
      path: `/prospect/${encodeURIComponent(prospectId)}/transfer`,
      operation: 'transferProspect',
      body: target.user ? { user: target.user, group: target.group } : { group: target.group },
    });
    const parsed = await this.parse(res, ZenviaSalesTransferResponseSchema, 'transferProspect');
    if (!parsed.success) {
      throw new ZenviaApiError(ZenviaErrorCode.UNKNOWN, 'Zenvia did not confirm the transfer (success=false)', {
        operation: 'transferProspect',
      });
    }
  }

  async createNote(prospectId: string, content: string): Promise<void> {
    const res = await this.request({
      method: 'POST',
      path: `/prospect/${encodeURIComponent(prospectId)}/interactions`,
      operation: 'createNote',
      body: { type: 'note', content },
    });
    await res.text();
  }

  private async request(init: SalesRequestInit & { allowNotFound: true }): Promise<Response | null>;
  private async request(init: SalesRequestInit): Promise<Response>;
  private async request(init: SalesRequestInit): Promise<Response | null> {
    const url = new URL(`${this.baseUrl}${init.path}`);
    url.searchParams.set('api-key', this.apiKey);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);

    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: ctrl.signal,
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'request failed';
      throw new ZenviaApiError(ZenviaErrorCode.UPSTREAM_ERROR, `Zenvia Sales ${init.operation} ${reason}`, {
        operation: init.operation,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 404 && init.allowNotFound) {
      await res.text();
      return null;
    }
    if (!res.ok) {
      throw await zenviaErrorFromResponse(res, init.operation);
    }
    return res;
  }

  private async parse<T>(res: Response, schema: ZodType<T>, operation: string): Promise<T> {
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new ZenviaApiError(ZenviaErrorCode.UPSTREAM_ERROR, `Zenvia Sales ${operation} returned invalid JSON`, {
        operation,
      });
    }
    const parsed = schema.safeParse(json);
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
