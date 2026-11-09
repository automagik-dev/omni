import { isIP } from 'node:net';

import { type ZenviaOutboundMessage, type ZenviaSendResponse, ZenviaSendResponseSchema } from './types';
import { ZenviaApiError, ZenviaErrorCode } from './utils/errors';
import { parseJsonOrUndefined, readBodyText, zenviaErrorFromResponse, zenviaFetch } from './utils/http';
import { type HostResolver, assertPublicHost, resolveHostAddresses } from './utils/public-host';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_DOWNLOAD_REDIRECTS = 5;

export const DEFAULT_ZENVIA_BASE_URL = 'https://api.zenvia.com/v2';

const ZENVIA_HOST = 'zenvia.com';

export interface ZenviaClientOptions {
  baseUrl?: string;
  apiToken: string;
  timeoutMs?: number;
  downloadTimeoutMs?: number;
  resolveHost?: HostResolver;
}

interface ZenviaRequestInit {
  method: 'GET' | 'POST';
  body?: string;
  operation: string;
}

function isZenviaHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === ZENVIA_HOST || host.endsWith(`.${ZENVIA_HOST}`);
}

function assertFetchableFileUrl(url: URL): void {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== 'https:') {
    throw new ZenviaApiError(ZenviaErrorCode.INVALID_REQUEST, 'Refusing to download a non-https file URL', {
      operation: 'downloadFile',
    });
  }
  if (isIP(host) !== 0 || host === 'localhost' || host.endsWith('.localhost')) {
    throw new ZenviaApiError(ZenviaErrorCode.INVALID_REQUEST, 'Refusing to download a file from an address host', {
      operation: 'downloadFile',
    });
  }
}

export class ZenviaClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;
  private readonly downloadTimeoutMs: number;
  private readonly resolveHost: HostResolver;

  constructor(opts: ZenviaClientOptions) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_ZENVIA_BASE_URL).replace(/\/+$/, '');
    this.apiToken = opts.apiToken;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.downloadTimeoutMs = opts.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
    this.resolveHost = opts.resolveHost ?? resolveHostAddresses;
  }

  async sendMessage(message: ZenviaOutboundMessage): Promise<ZenviaSendResponse> {
    const res = await this.request('/channels/whatsapp/messages', {
      method: 'POST',
      body: JSON.stringify(message),
      operation: 'sendMessage',
    });
    const parsed = ZenviaSendResponseSchema.safeParse(
      parseJsonOrUndefined(await readBodyText(res, 'sendMessage')) ?? {},
    );
    return parsed.success ? parsed.data : {};
  }

  async downloadFile(fileUrl: string): Promise<Response> {
    let currentUrl = new URL(fileUrl);
    assertFetchableFileUrl(currentUrl);
    let sendToken = isZenviaHost(currentUrl);

    for (let redirects = 0; redirects <= MAX_DOWNLOAD_REDIRECTS; redirects++) {
      await assertPublicHost(currentUrl.hostname, this.resolveHost);
      const headers: Record<string, string> = sendToken ? { 'X-API-TOKEN': this.apiToken } : {};
      const res = await zenviaFetch(
        currentUrl.toString(),
        { method: 'GET', headers, redirect: 'manual' },
        { timeoutMs: this.downloadTimeoutMs, operation: 'downloadFile' },
      );

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await readBodyText(res, 'downloadFile');
        if (!location) {
          throw new ZenviaApiError(ZenviaErrorCode.UPSTREAM_ERROR, 'Zenvia file redirect without a location', {
            httpStatus: res.status,
            operation: 'downloadFile',
          });
        }
        const nextUrl = new URL(location, currentUrl);
        assertFetchableFileUrl(nextUrl);
        sendToken = sendToken && isZenviaHost(nextUrl);
        currentUrl = nextUrl;
        continue;
      }

      if (!res.ok) {
        throw await zenviaErrorFromResponse(res, 'downloadFile');
      }
      return res;
    }

    throw new ZenviaApiError(ZenviaErrorCode.UPSTREAM_ERROR, 'Zenvia file download followed too many redirects', {
      operation: 'downloadFile',
    });
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.request('/subscriptions', { method: 'GET', operation: 'ping' });
      await readBodyText(res, 'ping');
      return true;
    } catch {
      return false;
    }
  }

  private async request(path: string, init: ZenviaRequestInit): Promise<Response> {
    const headers: Record<string, string> = { 'X-API-TOKEN': this.apiToken };
    if (init.body) headers['Content-Type'] = 'application/json';

    const res = await zenviaFetch(
      `${this.baseUrl}${path}`,
      { method: init.method, headers, body: init.body },
      { timeoutMs: this.timeoutMs, operation: init.operation },
    );

    if (!res.ok) {
      throw await zenviaErrorFromResponse(res, init.operation);
    }
    return res;
  }
}
