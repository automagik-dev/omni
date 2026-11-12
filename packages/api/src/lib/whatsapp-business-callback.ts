/**
 * The deployment-wide WhatsApp Business webhook address Meta (or a Meta-compatible provider such
 * as Kapso) calls: `server.public_url` (env OMNI_PUBLIC_URL) plus the global webhook path, or null
 * when that origin is unset or cannot serve as a public HTTPS callback. Shared by the Meta webhook
 * setup (routes/v2/channels.ts) and the Kapso connect (routes/v2/whatsapp-business.ts, #1676).
 */

import { BlockList, isIP } from 'node:net';

export const WHATSAPP_BUSINESS_WEBHOOK_PATH = '/api/v2/channels/whatsapp-business/webhook' as const;

// Check parsed literal addresses without resolving DNS. BlockList also applies
// IPv4 subnets to their IPv4-mapped IPv6 representations.
const nonPublicCallbackIps = new BlockList();
for (const [network, prefix, family] of [
  ['0.0.0.0', 8, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'], // IETF protocol assignments; public exceptions below.
  ['192.0.2.0', 24, 'ipv4'], // Documentation.
  ['192.88.99.0', 24, 'ipv4'], // Deprecated relay anycast.
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'], // Benchmarking.
  ['198.51.100.0', 24, 'ipv4'], // Documentation.
  ['203.0.113.0', 24, 'ipv4'], // Documentation.
  ['224.0.0.0', 4, 'ipv4'], // Multicast is not a unicast callback destination.
  ['240.0.0.0', 4, 'ipv4'], // Reserved, including limited broadcast.
  ['::', 96, 'ipv6'], // IPv4-compatible, including unspecified/loopback.
  ['::ffff:0:0:0', 96, 'ipv6'], // SIIT translated, distinct from public IPv4-mapped literals.
  ['64:ff9b::', 96, 'ipv6'], // NAT64.
  ['64:ff9b:1::', 48, 'ipv6'], // Local-use translation.
  ['100::', 64, 'ipv6'], // Discard-only.
  ['100:0:0:1::', 64, 'ipv6'], // Dummy prefix.
  ['2001::', 23, 'ipv6'], // IETF assignments, including Teredo; public exceptions below.
  ['2001:db8::', 32, 'ipv6'], // Documentation.
  ['2002::', 16, 'ipv6'], // 6to4.
  ['3fff::', 20, 'ipv6'], // Documentation.
  ['5f00::', 16, 'ipv6'], // SRv6 SIDs.
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['fec0::', 10, 'ipv6'], // Deprecated site-local (RFC 3879).
  ['ff00::', 8, 'ipv6'], // Multicast.
] as const)
  nonPublicCallbackIps.addSubnet(network, prefix, family);

// IANA special-purpose registries, Globally Reachable=true exceptions within
// the denied protocol-assignment blocks (checked 2026-11-02):
// https://www.iana.org/assignments/iana-ipv4-special-registry/
// https://www.iana.org/assignments/iana-ipv6-special-registry/
// Keep the /32 and /128 anycasts exact; their neighbours remain non-public.
const publicCallbackIpExceptions = new BlockList();
for (const [network, prefix, family] of [
  ['192.0.0.9', 32, 'ipv4'], // PCP anycast.
  ['192.0.0.10', 32, 'ipv4'], // TURN anycast.
  ['2001:1::1', 128, 'ipv6'], // PCP anycast.
  ['2001:1::2', 128, 'ipv6'], // TURN anycast.
  ['2001:1::3', 128, 'ipv6'], // DNS-SD registration anycast.
  ['2001:3::', 32, 'ipv6'], // AMT.
  ['2001:4:112::', 48, 'ipv6'], // AS112.
  ['2001:20::', 28, 'ipv6'], // ORCHIDv2.
  ['2001:30::', 28, 'ipv6'], // Drone Remote ID.
] as const)
  publicCallbackIpExceptions.addSubnet(network, prefix, family);

/** The public HTTPS webhook URL for `publicUrl`, or null when it cannot serve as one. */
export function whatsappBusinessCallbackUrl(publicUrl: string): string | null {
  try {
    const url = new URL(publicUrl);
    const hostname = url.hostname.replace(/\.$/, '');
    const address = hostname.replace(/^\[|\]$/g, '');
    const family = isIP(address);
    const addressType = family === 4 ? 'ipv4' : 'ipv6';
    const nonPublicLiteral =
      family !== 0 &&
      nonPublicCallbackIps.check(address, addressType) &&
      !publicCallbackIpExceptions.check(address, addressType);
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !/^(localhost|.*\.(localhost|local)|127\..*)$/i.test(hostname) &&
      !nonPublicLiteral
    ) {
      return `${url.href.replace(/\/+$/, '')}${WHATSAPP_BUSINESS_WEBHOOK_PATH}`;
    }
  } catch {
    /* An unset or unusable public URL is configuration, never the request host. */
  }
  return null;
}

/** The configured public origin (settings row first, env fallback) and its webhook URL. */
export async function resolveWhatsAppBusinessCallback(settings: {
  getString(key: string, envFallback?: string): Promise<string | undefined>;
}): Promise<{ publicUrl: string; callbackUrl: string | null }> {
  const raw = await settings.getString('server.public_url', 'OMNI_PUBLIC_URL');
  const publicUrl = raw?.trim() ?? '';
  return { publicUrl, callbackUrl: whatsappBusinessCallbackUrl(publicUrl) };
}
