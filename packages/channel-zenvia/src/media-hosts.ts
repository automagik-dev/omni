import { classifyUrl, isAllowedClass } from '@omni/core';
import { z } from 'zod';

import { ZenviaApiError, ZenviaErrorCode } from './utils/errors';

export const MAX_MEDIA_HOSTS = 64;

const HOST_LABEL = '(?!-)[a-z0-9-]{1,63}(?<!-)';
const MEDIA_HOST_PATTERN = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})+$`);
const NUMERIC_LABEL = /^\d+$/;

export const zenviaMediaHostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(MEDIA_HOST_PATTERN, 'must be a host name such as files.example.com, without scheme, port, path or wildcard')
  .refine((host) => !NUMERIC_LABEL.test(host.slice(host.lastIndexOf('.') + 1)), 'must be a host name, not an address');

export const zenviaMediaHostsSchema = z
  .array(zenviaMediaHostSchema)
  .max(MAX_MEDIA_HOSTS)
  .describe(
    'Hosts the inbound media of the instance may be downloaded from, each covering its subdomains. Empty or absent accepts any public host',
  );

export function parseMediaHosts(raw: unknown): readonly string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const parsed = zenviaMediaHostsSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
      .join('; ');
    throw new ZenviaApiError(ZenviaErrorCode.INVALID_REQUEST, `zenviaMediaHosts is invalid — ${detail}`);
  }
  const hosts = [...new Set(parsed.data)];
  return hosts.length > 0 ? hosts : undefined;
}

export function isAllowedMediaHost(url: URL, hosts: readonly string[]): boolean {
  return isAllowedClass(classifyUrl(url, { policyVersion: 1, approvedHostSuffixes: hosts }).destinationClass);
}
