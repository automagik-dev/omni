/**
 * The address a request reached this Omni on, for the links login hands back when no fixed
 * public URL is configured (login/config.ts). A link built this way goes only to whoever
 * asked on that address, so a forged Host header points nobody but the forger elsewhere.
 * Links that go out on their own (the WhatsApp "connect" reply, the boot claim line) are
 * never built from a request.
 */

import type { LoginConfig } from './config';

/** A host with an optional port: a name, an IPv4 address or a bracketed IPv6 one. */
const HOST = /^(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(:\d{1,5})?$/i;

/**
 * The request's own origin (`http(s)://host[:port]`), or null when it does not look like
 * one. Behind a proxy the API trusts (TRUSTED_PROXY_HEADER set), X-Forwarded-Proto says
 * whether people came in over https.
 */
export function requestOrigin(request: Request, env: NodeJS.ProcessEnv = process.env): string | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  const host = request.headers.get('host')?.trim() || url.host;
  if (!HOST.test(host)) return null;
  const forwarded = env.TRUSTED_PROXY_HEADER?.trim()
    ? request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
    : undefined;
  const protocol = forwarded === 'https' || forwarded === 'http' ? forwarded : url.protocol.replace(/:$/, '');
  if (protocol !== 'http' && protocol !== 'https') return null;
  return `${protocol}://${host.toLowerCase()}`;
}

/** Where people reach this Omni: the configured public URL, else the address this request came in on. */
export function publicOrigin(config: Pick<LoginConfig, 'publicUrl'>, request: Request): string | null {
  return config.publicUrl ?? requestOrigin(request);
}

/** Both schemes on the request's own host: the origins a browser on this address may post from. */
export function sameHostOrigins(request: Request): string[] {
  const origin = requestOrigin(request);
  if (!origin) return [];
  const host = origin.replace(/^https?:\/\//, '');
  return [`https://${host}`, `http://${host}`];
}
