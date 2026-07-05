/**
 * SSRF-guarded fetch for caller-influenced media URLs.
 *
 * `storeFromUrl` (media ingest) and the agent dispatcher's history-sync
 * download fetch URLs that originate from channel payloads. Today those URLs
 * come from platform CDNs (WhatsApp, Telegram, Slack), but nothing in the
 * pipeline guaranteed that — a crafted URL could point the API at cloud
 * metadata (169.254.169.254), RFC1918 services, or loopback. This module
 * centralizes the deny-list and a redirect-safe fetch that re-applies the
 * policy on every hop.
 *
 * Policy (deny before connecting):
 * - non-http(s) schemes — always rejected, even when the guard is disabled
 *   (Bun's fetch can read `file://`).
 * - IPv4: 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16 (link-local /
 *   cloud metadata), 172.16.0.0/12, 192.168.0.0/16.
 * - IPv6: `::` (unspecified), `::1` (loopback), fc00::/7 (ULA), fe80::/10
 *   (link-local), plus IPv4-mapped forms re-checked as IPv4.
 * - Hostnames are resolved via DNS and every resolved address is checked. A
 *   failed resolution passes through — fetch performs the same lookup and
 *   fails identically, so failing open here adds no reachability while keeping
 *   offline unit runs (mocked fetch) deterministic.
 *
 * Redirects: Bun's auto-follow cannot inspect intermediate hops, so
 * {@link fetchMediaUrl} always follows redirects manually (`redirect:
 * "manual"`, ≤5 hops) and validates each Location target before requesting it.
 *
 * Escape hatch: `OMNI_MEDIA_URL_GUARD=off` disables the private-range checks
 * (NOT the scheme check) for deployments that intentionally fetch media from
 * private hosts (e.g. a lab MinIO serving media URLs on RFC1918). Default is
 * enforced.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class UnsafeMediaUrlError extends Error {
  constructor(url: string, reason: string) {
    super(`Refusing to fetch media URL: ${reason} (${url})`);
    this.name = 'UnsafeMediaUrlError';
  }
}

/** Injectable resolver so tests can simulate DNS without network. */
export type AddressLookup = (hostname: string) => Promise<Array<{ address: string }>>;

const defaultLookup: AddressLookup = async (hostname) => lookup(hostname, { all: true });

/** Private-range checks are on unless explicitly switched off. */
export function isMediaUrlGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OMNI_MEDIA_URL_GUARD?.trim().toLowerCase() !== 'off';
}

function isDeniedIpv4(address: string): boolean {
  const octets = address.split('.').map((part) => Number.parseInt(part, 10));
  const [a, b] = octets;
  if (a === undefined || b === undefined) return true;
  if (a === 0) return true; // 0.0.0.0/8 ("this network", incl. 0.0.0.0)
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

function isDeniedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true; // unspecified / loopback
  // IPv4-mapped (::ffff:a.b.c.d) — apply the IPv4 policy to the embedded address.
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isDeniedIpv4(mapped[1]);
  const firstHextet = normalized.split(':', 1)[0] ?? '';
  if (firstHextet.startsWith('fc') || firstHextet.startsWith('fd')) return true; // fc00::/7 ULA
  if (/^fe[89ab]/.test(firstHextet)) return true; // fe80::/10 link-local
  return false;
}

/** Whether a literal IP address falls in a denied (private/reserved) range. */
export function isPrivateOrReservedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isDeniedIpv4(address);
  if (family === 6) return isDeniedIpv6(address);
  return true; // not an IP at all — callers only pass resolved addresses
}

/**
 * Validate a single URL against the SSRF policy. Throws
 * {@link UnsafeMediaUrlError} when the URL must not be fetched.
 */
export async function assertSafeMediaUrl(
  url: URL,
  resolveAddresses: AddressLookup = defaultLookup,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeMediaUrlError(url.toString(), `scheme ${url.protocol} is not allowed`);
  }

  if (!isMediaUrlGuardEnabled(env)) return;

  // URL keeps IPv6 literals bracketed ([::1]) — strip for the family check.
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  if (isIP(hostname) !== 0) {
    if (isPrivateOrReservedAddress(hostname)) {
      throw new UnsafeMediaUrlError(url.toString(), `address ${hostname} is in a private or reserved range`);
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await resolveAddresses(hostname);
  } catch {
    // Resolution failure: fetch will perform the same lookup and fail with its
    // own error — nothing private became reachable by passing here.
    return;
  }
  for (const { address } of addresses) {
    if (isPrivateOrReservedAddress(address)) {
      throw new UnsafeMediaUrlError(url.toString(), `host ${hostname} resolves to private address ${address}`);
    }
  }
}

export interface MediaFetchOptions extends RequestInit {
  /**
   * Host suffixes where Authorization should be preserved across manual
   * redirects. Fetch strips Authorization on cross-origin redirects; some
   * private media URLs redirect inside the platform-owned domain and still
   * require the same token.
   */
  preserveAuthRedirectHostSuffixes?: string[];
}

const MAX_MEDIA_REDIRECTS = 5;

function hostMatchesSuffix(hostname: string, suffix: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const normalizedSuffix = suffix.toLowerCase();
  return normalizedHost === normalizedSuffix || normalizedHost.endsWith(`.${normalizedSuffix}`);
}

function shouldPreserveAuthForRedirect(url: URL, suffixes: string[] | undefined): boolean {
  return Boolean(suffixes?.some((suffix) => hostMatchesSuffix(url.hostname, suffix)));
}

function headersWithOptionalAuthorization(
  headers: RequestInit['headers'] | undefined,
  preserveAuthorization: boolean,
): Headers {
  const nextHeaders = new Headers(headers);
  if (!preserveAuthorization) nextHeaders.delete('authorization');
  return nextHeaders;
}

/**
 * Fetch a media URL with the SSRF policy applied to the initial URL AND every
 * redirect hop. Redirects are followed manually so no hop escapes the check.
 *
 * Authorization is preserved across a hop when the redirect stays same-origin
 * (standard fetch semantics) or when both hop hosts match
 * `preserveAuthRedirectHostSuffixes` (platform-owned domains like Slack's
 * files.slack.com → files-pri.slack.com).
 */
export async function fetchMediaUrl(url: string, fetchOptions?: MediaFetchOptions): Promise<Response> {
  const { preserveAuthRedirectHostSuffixes, ...init } = fetchOptions ?? {};

  let currentUrl = new URL(url);
  await assertSafeMediaUrl(currentUrl);
  let currentHeaders = new Headers(init.headers);

  for (let redirects = 0; redirects <= MAX_MEDIA_REDIRECTS; redirects++) {
    const response: Response = await fetch(currentUrl.toString(), {
      ...init,
      headers: currentHeaders,
      redirect: 'manual',
    });

    if (response.status < 300 || response.status >= 400) return response;

    const location: string | null = response.headers.get('location');
    if (!location) return response;

    const nextUrl: URL = new URL(location, currentUrl);
    await assertSafeMediaUrl(nextUrl);

    const preserveAuthorization =
      nextUrl.origin === currentUrl.origin ||
      (shouldPreserveAuthForRedirect(currentUrl, preserveAuthRedirectHostSuffixes) &&
        shouldPreserveAuthForRedirect(nextUrl, preserveAuthRedirectHostSuffixes));

    currentHeaders = headersWithOptionalAuthorization(init.headers, preserveAuthorization);
    currentUrl = nextUrl;
  }

  throw new Error('Failed to download media: too many redirects');
}
