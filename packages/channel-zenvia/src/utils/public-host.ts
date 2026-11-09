import { lookup } from 'node:dns/promises';

import { classifyResolvedAddress } from '@omni/core';

import { ZenviaApiError, ZenviaErrorCode } from './errors';

export interface ResolvedAddress {
  address: string;
  family?: number;
}

export type HostResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export const resolveHostAddresses: HostResolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

function unresolvedHost(): ZenviaApiError {
  return new ZenviaApiError(ZenviaErrorCode.UPSTREAM_ERROR, 'Zenvia downloadFile host did not resolve', {
    operation: 'downloadFile',
  });
}

export async function assertPublicHost(hostname: string, resolve: HostResolver): Promise<void> {
  let resolved: readonly ResolvedAddress[];
  try {
    resolved = await resolve(hostname);
  } catch {
    throw unresolvedHost();
  }
  if (resolved.length === 0) throw unresolvedHost();

  for (const { address } of resolved) {
    if (classifyResolvedAddress(address) !== null) {
      throw new ZenviaApiError(
        ZenviaErrorCode.INVALID_REQUEST,
        'Refusing to download a file from a host that resolves to a non-public address',
        { operation: 'downloadFile' },
      );
    }
  }
}
