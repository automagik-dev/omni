/**
 * Tenant-egress destination policy — the SSRF decision engine (wish:
 * omni-full-multitenancy, Group G5; ADR-0009, WISH "Tenant-controlled outbound
 * egress").
 *
 * WHAT THIS IS
 * -----------
 * A pure, synchronous classifier for a single candidate destination. Given a
 * parsed URL and a tenant-bound {@link EgressPolicy}, it answers one question:
 * may this destination be connected to? It is DEFAULT-DENY — a destination is
 * refused unless the tenant's policy explicitly approves its host AND the
 * destination survives an absolute reserved-range denial that no allowlist can
 * override.
 *
 * The two layers, in order:
 *   1. **Absolute denial** (never overridable): non-approved scheme, a
 *      credential-bearing/userinfo URL, a non-approved port, and — for a literal
 *      IP host or a resolved address — any reserved range (loopback, RFC1918,
 *      CGNAT, link-local, cloud metadata, multicast, unspecified, IPv6 ULA,
 *      IPv4-mapped IPv6). Alternate IPv4 encodings (decimal/octal/hex) are
 *      canonicalised before classification so `0x7f000001` cannot smuggle
 *      loopback past a dotted-quad check.
 *   2. **Default-deny allowlist**: the host must match the tenant policy's
 *      approved host set. No match → refused, even for a public address.
 *
 * DNS lives in the broker, not here: {@link classifyUrl} decides everything that
 * is knowable from the URL text (and classifies a literal-IP host completely),
 * and {@link classifyResolvedAddress} is applied by the broker to every address
 * a hostname resolves to, immediately before connect and again on every redirect
 * hop. That split is what lets the broker defend against DNS rebinding while
 * keeping this module pure and unit-testable without a network.
 *
 * DUAL WORLD
 * ----------
 * This module has no notion of the flag. It is invoked only by the broker, and
 * the broker is invoked only on tenant-controlled egress once a caller routes
 * through it. A flag-off deployment has no tenants and binds no policies; its
 * legacy egress paths are byte-identical until a path is explicitly converted to
 * call the broker.
 */

import { isIP } from 'node:net';

/**
 * The normalized destination class recorded on every egress decision. It never
 * carries the raw host or any secret — it is the *category* of the outcome, safe
 * to log and to use as a bounded metric label.
 */
export type EgressDestinationClass =
  | 'approved-public' // allowed: a public address on the tenant allowlist
  | 'not-approved' // default-deny miss: public but not on the allowlist
  | 'loopback' // 127.0.0.0/8, ::1
  | 'unspecified' // 0.0.0.0/8, ::
  | 'private-rfc1918' // 10/8, 172.16/12, 192.168/16
  | 'cgnat' // 100.64.0.0/10 (RFC 6598)
  | 'link-local' // 169.254.0.0/16, fe80::/10 — includes cloud metadata
  | 'ipv6-ula' // fc00::/7
  | 'multicast' // 224.0.0.0/4, ff00::/8
  | 'reserved' // other reserved/unroutable IPv4 blocks
  | 'ipv4-mapped-ipv6' // ::ffff:a.b.c.d re-projected onto the IPv4 policy
  | 'invalid-ip-encoding' // an all-numeric host that is not a valid IP
  | 'unapproved-scheme' // not http(s) / not an approved scheme
  | 'unapproved-port' // a port outside the approved set
  | 'credentialed-url' // userinfo present (user:pass@host)
  | 'malformed-url'; // host missing/empty, or unparseable

/** Whether a class is a permit. Exactly one class permits. */
export function isAllowedClass(destinationClass: EgressDestinationClass): boolean {
  return destinationClass === 'approved-public';
}

/**
 * A tenant-bound egress policy. Default-deny: an empty `approvedHostSuffixes`
 * approves nothing. A host is approved when it equals, or is a subdomain of, one
 * of the suffixes (case-insensitive). Suffix matching is on label boundaries —
 * `evil-example.com` does NOT match the suffix `example.com`.
 */
export interface EgressPolicy {
  /** Opaque version stamped onto every decision for audit/rollback correlation. */
  readonly policyVersion: number;
  /** Host suffixes the tenant is permitted to reach (label-boundary match). */
  readonly approvedHostSuffixes: readonly string[];
  /** Approved URL schemes. Defaults to `['https:']` when omitted/empty. */
  readonly approvedSchemes?: readonly string[];
  /** Approved ports. Defaults to `[443]` when omitted/empty. */
  readonly approvedPorts?: readonly number[];
}

export interface EgressDecision {
  readonly allowed: boolean;
  readonly destinationClass: EgressDestinationClass;
  /** Non-secret human reason. Never contains credentials or payloads. */
  readonly reason: string;
  /** The policy version this decision was taken under. */
  readonly policyVersion: number;
  /** Lower-cased hostname (or canonical IP) the decision was about. */
  readonly host: string;
}

const DEFAULT_SCHEMES: readonly string[] = ['https:'];
const DEFAULT_PORTS: readonly number[] = [443];

function schemesFor(policy: EgressPolicy): readonly string[] {
  return policy.approvedSchemes && policy.approvedSchemes.length > 0 ? policy.approvedSchemes : DEFAULT_SCHEMES;
}

function portFor(url: URL): number | null {
  if (url.port) {
    const parsed = Number.parseInt(url.port, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  // No explicit port — the scheme default.
  if (url.protocol === 'https:') return 443;
  if (url.protocol === 'http:') return 80;
  return null;
}

function portsFor(policy: EgressPolicy): readonly number[] {
  return policy.approvedPorts && policy.approvedPorts.length > 0 ? policy.approvedPorts : DEFAULT_PORTS;
}

/**
 * Label-boundary suffix match. `host` matches `suffix` when it equals it or ends
 * with `.suffix`. Both are lower-cased by the caller.
 */
function hostMatchesSuffix(host: string, suffix: string): boolean {
  const s = suffix.toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
  if (s.length === 0) return false;
  return host === s || host.endsWith(`.${s}`);
}

function isApprovedHost(host: string, policy: EgressPolicy): boolean {
  return policy.approvedHostSuffixes.some((suffix) => hostMatchesSuffix(host, suffix));
}

// --- IPv4 encoding canonicalisation ----------------------------------------

/**
 * Parse a single IPv4 part in any of the encodings a permissive resolver would
 * accept: decimal (`10`), hex (`0x0a`), or octal (`012`). Returns `null` for
 * anything that is not a valid numeric part, which the caller treats as "this is
 * not an IPv4 literal after all".
 */
function parseIpv4Part(part: string): number | null {
  if (part.length === 0) return null;
  let value: number;
  if (/^0x[0-9a-f]+$/i.test(part)) value = Number.parseInt(part.slice(2), 16);
  else if (/^0[0-7]+$/.test(part)) value = Number.parseInt(part, 8);
  else if (/^[0-9]+$/.test(part)) value = Number.parseInt(part, 10);
  else return null;
  return Number.isNaN(value) ? null : value;
}

/**
 * Canonicalise an all-numeric / dotted host to a dotted-quad IPv4 string, or
 * return a marker telling the caller whether the host even looks like an IPv4
 * literal.
 *
 *   * `{ ipv4: 'a.b.c.d' }`     — a valid IPv4 in some encoding.
 *   * `{ invalid: true }`       — looks like an IPv4 literal (all parts numeric,
 *                                 or a bare integer) but is out of range /
 *                                 malformed. FAIL CLOSED: this must be refused,
 *                                 not treated as a DNS name.
 *   * `null`                    — not an IPv4 literal at all; treat as a hostname.
 *
 * Handles the classic SSRF encodings: `2130706433` (a bare 32-bit integer),
 * `0x7f.0.0.1`, `0177.0.0.1`, `0x7f000001`.
 */
export function canonicalizeIpv4(host: string): { ipv4: string } | { invalid: true } | null {
  const parts = host.split('.');
  // A host is "numeric-shaped" only if EVERY dot-part is a numeric token. A real
  // hostname like `api.example.com` has non-numeric parts and falls through to
  // DNS. `1e2` is not matched by any numeric form below, so it stays a hostname.
  const looksNumeric = parts.every((p) => /^(0x[0-9a-f]+|[0-9]+)$/i.test(p));
  if (!looksNumeric) return null;
  if (parts.length > 4) return { invalid: true };

  const values = parts.map(parseIpv4Part);
  if (values.some((v) => v === null)) return { invalid: true };
  const nums = values as number[];

  // Compress the trailing part per inet_aton: with fewer than 4 parts the last
  // part spans the remaining low-order bytes (e.g. `127.1` => 127.0.0.1).
  let ip32: number;
  if (nums.length === 1) {
    ip32 = nums[0] as number;
    if (ip32 > 0xffffffff) return { invalid: true };
  } else {
    const leading = nums.slice(0, -1);
    const last = nums[nums.length - 1] as number;
    if (leading.some((n) => n > 0xff)) return { invalid: true };
    const maxLast = 2 ** (8 * (4 - leading.length));
    if (last >= maxLast) return { invalid: true };
    ip32 = last;
    for (let i = 0; i < leading.length; i++) {
      ip32 += (leading[i] as number) * 2 ** (8 * (3 - i));
    }
  }
  if (ip32 < 0 || ip32 > 0xffffffff) return { invalid: true };
  const a = (ip32 >>> 24) & 0xff;
  const b = (ip32 >>> 16) & 0xff;
  const c = (ip32 >>> 8) & 0xff;
  const d = ip32 & 0xff;
  return { ipv4: `${a}.${b}.${c}.${d}` };
}

// --- reserved-range classification -----------------------------------------

/** Parse a dotted-quad to its 32-bit integer, or null when malformed. */
function ipv4ToInt(address: string): number | null {
  const octets = address.split('.');
  if (octets.length !== 4) return null;
  let value = 0;
  for (const octet of octets) {
    if (!/^[0-9]{1,3}$/.test(octet)) return null;
    const n = Number.parseInt(octet, 10);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

/** `base/prefixBits` → inclusive `[lo, hi]` of the block, as 32-bit ints. */
function cidr(base: string, bits: number): [number, number] {
  const lo = ipv4ToInt(base) as number;
  const size = 2 ** (32 - bits);
  return [lo, lo + size - 1];
}

/**
 * Reserved IPv4 blocks, in longest-prefix-irrelevant order (they are disjoint).
 * First containing block wins; a `null` result means public/routable.
 */
const RESERVED_IPV4: ReadonlyArray<readonly [number, number, EgressDestinationClass]> = [
  [...cidr('0.0.0.0', 8), 'unspecified'],
  [...cidr('10.0.0.0', 8), 'private-rfc1918'],
  [...cidr('127.0.0.0', 8), 'loopback'],
  [...cidr('100.64.0.0', 10), 'cgnat'],
  [...cidr('169.254.0.0', 16), 'link-local'], // includes cloud metadata 169.254.169.254
  [...cidr('172.16.0.0', 12), 'private-rfc1918'],
  [...cidr('192.168.0.0', 16), 'private-rfc1918'],
  [...cidr('192.88.99.0', 24), 'reserved'], // 6to4 relay anycast (RFC 7526)
  [...cidr('192.0.0.0', 24), 'reserved'],
  [...cidr('192.0.2.0', 24), 'reserved'], // TEST-NET-1
  [...cidr('198.18.0.0', 15), 'reserved'], // benchmarking
  [...cidr('198.51.100.0', 24), 'reserved'], // TEST-NET-2
  [...cidr('203.0.113.0', 24), 'reserved'], // TEST-NET-3
  [...cidr('224.0.0.0', 4), 'multicast'],
  [...cidr('240.0.0.0', 4), 'reserved'], // includes 255.255.255.255
] as const;

function classifyIpv4(address: string): EgressDestinationClass | null {
  const value = ipv4ToInt(address);
  if (value === null) return 'invalid-ip-encoding';
  for (const [lo, hi, cls] of RESERVED_IPV4) {
    if (value >= lo && value <= hi) return cls;
  }
  return null; // public
}

/**
 * Convert the suffix of an IPv4-mapped/compatible IPv6 address to dotted IPv4.
 * Handles both serializations the WHATWG URL parser may emit: dotted
 * (`::ffff:127.0.0.1`) and two hex hextets (`::ffff:7f00:1`).
 */
function mappedSuffixToIpv4(suffix: string): string | null {
  if (suffix.includes('.')) return isIP(suffix) === 4 ? suffix : null;
  const hextets = suffix.split(':');
  if (hextets.length !== 2) return null;
  const hi = Number.parseInt(hextets[0] as string, 16);
  const lo = Number.parseInt(hextets[1] as string, 16);
  if (Number.isNaN(hi) || Number.isNaN(lo) || hi > 0xffff || lo > 0xffff) return null;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/** Two 16-bit hextets → dotted-quad IPv4 (high hextet is the top two octets). */
function hextetsToIpv4(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * Expand a valid IPv6 literal (as accepted by `isIP`) to its eight 16-bit
 * hextets, resolving `::` compression and any trailing embedded dotted IPv4.
 * Returns `null` for anything that does not expand to exactly eight hextets.
 */
function ipv6ToHextets(normalized: string): number[] | null {
  const parseGroups = (groups: string[]): number[] | null => {
    const out: number[] = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i] as string;
      if (g.includes('.')) {
        if (i !== groups.length - 1) return null; // dotted IPv4 only as the last group
        const octets = g.split('.').map((o) => Number.parseInt(o, 10));
        if (octets.length !== 4 || octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
        out.push(((octets[0] as number) << 8) | (octets[1] as number));
        out.push(((octets[2] as number) << 8) | (octets[3] as number));
      } else {
        const n = Number.parseInt(g, 16);
        if (Number.isNaN(n) || n < 0 || n > 0xffff) return null;
        out.push(n);
      }
    }
    return out;
  };

  const dc = normalized.indexOf('::');
  if (dc >= 0) {
    const before = normalized.slice(0, dc);
    const after = normalized.slice(dc + 2);
    const head = before === '' ? [] : before.split(':');
    const tail = after === '' ? [] : after.split(':');
    const h = parseGroups(head);
    const t = parseGroups(tail);
    if (h === null || t === null) return null;
    const fill = 8 - h.length - t.length;
    if (fill < 0) return null;
    return [...h, ...new Array<number>(fill).fill(0), ...t];
  }
  const g = parseGroups(normalized.split(':'));
  if (g === null || g.length !== 8) return null;
  return g;
}

/**
 * Re-project an IPv6 transition-encoding (6to4, Teredo, NAT64) onto the IPv4
 * classifier so an internal IPv4 embedded in one of them cannot slip through as
 * "public IPv6". Returns the reserved class when an embedded IPv4 is reserved,
 * `null` when every embedded IPv4 is public, or `undefined` when `normalized` is
 * not one of these transition encodings (caller continues its own checks).
 */
function classifyIpv6Transition(normalized: string): EgressDestinationClass | null | undefined {
  const hextets = ipv6ToHextets(normalized);
  if (hextets === null) return undefined;
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets as [number, number, number, number, number, number, number, number];

  // 6to4 — 2002::/16: the embedded IPv4 is hextets 1-2 (2002:AABB:CCDD::/48).
  if (h0 === 0x2002) {
    return classifyIpv4(hextetsToIpv4(h1, h2));
  }

  // NAT64 well-known prefix — 64:ff9b::/96: embedded IPv4 is the last two hextets.
  if (h0 === 0x0064 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return classifyIpv4(hextetsToIpv4(h6, h7));
  }

  // Teredo — 2001:0000::/32: the server IPv4 is hextets 2-3 (plain) and the
  // client IPv4 is the last two hextets obfuscated by XOR 0xffff. Reject if
  // EITHER embedded IPv4 is reserved; fail closed.
  if (h0 === 0x2001 && h1 === 0x0000) {
    const server = classifyIpv4(hextetsToIpv4(h2, h3));
    if (server !== null) return server;
    const client = classifyIpv4(hextetsToIpv4(h6 ^ 0xffff, h7 ^ 0xffff));
    if (client !== null) return client;
    return null;
  }

  return undefined;
}

function classifyIpv6(address: string): EgressDestinationClass | null {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === '::' || normalized === '::0' || normalized === '0:0:0:0:0:0:0:0') return 'unspecified';
  if (normalized === '::1') return 'loopback';
  // IPv4-mapped (::ffff:*) and the deprecated IPv4-compatible (::*) forms:
  // re-project onto the IPv4 policy so a mapped private/loopback/metadata
  // address cannot slip through as "public IPv6".
  const mappedFfff = /^::ffff:([0-9a-f:.]+)$/.exec(normalized);
  const compat = /^::([0-9a-f]{1,4}:[0-9a-f]{1,4}|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(normalized);
  const suffix = mappedFfff?.[1] ?? compat?.[1];
  if (suffix) {
    const v4 = mappedSuffixToIpv4(suffix);
    if (v4) {
      const inner = classifyIpv4(v4);
      return inner ?? 'ipv4-mapped-ipv6';
    }
  }
  // 6to4 / Teredo / NAT64 transition encodings: re-project any embedded IPv4.
  const transition = classifyIpv6Transition(normalized);
  if (transition !== undefined) return transition;
  const firstHextet = normalized.split(':', 1)[0] ?? '';
  if (firstHextet.startsWith('fc') || firstHextet.startsWith('fd')) return 'ipv6-ula'; // fc00::/7
  if (/^fe[89ab]/.test(firstHextet)) return 'link-local'; // fe80::/10
  if (firstHextet.startsWith('ff')) return 'multicast'; // ff00::/8
  return null; // public
}

/**
 * Classify a canonical IP literal (v4 or v6). `null` means public/routable.
 * Applied by the broker to every resolved address, and by {@link classifyUrl} to
 * a literal-IP host.
 */
export function classifyResolvedAddress(address: string): EgressDestinationClass | null {
  const family = isIP(address);
  if (family === 4) return classifyIpv4(address);
  if (family === 6) return classifyIpv6(address);
  return 'invalid-ip-encoding';
}

function decide(
  allowed: boolean,
  destinationClass: EgressDestinationClass,
  reason: string,
  policy: EgressPolicy,
  host: string,
): EgressDecision {
  return { allowed, destinationClass, reason, policyVersion: policy.policyVersion, host };
}

/**
 * Decide everything knowable from the URL text.
 *
 *   * Rejects non-approved schemes, credential-bearing URLs, non-approved ports.
 *   * For a literal-IP host (in any encoding), classifies the address fully — an
 *     allowed literal IP still has to be a public address AND on the allowlist.
 *   * For a hostname, applies the default-deny allowlist. The broker then
 *     resolves it and applies {@link classifyResolvedAddress} to every address
 *     before connecting.
 *
 * A permit here for a hostname means "the URL shape and allowlist are fine";
 * it is NOT a permit to connect until DNS is checked. The broker enforces that.
 */
export function classifyUrl(url: URL, policy: EgressPolicy): EgressDecision {
  // Scheme first: a `file:`/`unix:`/`gopher:` scheme is refused before anything
  // else, and this is the one check with no allowlist escape.
  if (!schemesFor(policy).includes(url.protocol)) {
    return decide(false, 'unapproved-scheme', `scheme ${url.protocol} is not approved`, policy, url.hostname);
  }

  // Credentials in the URL (user:pass@ / user@) are refused outright: they are a
  // userinfo-confusion vector and must never be forwarded.
  if (url.username !== '' || url.password !== '') {
    return decide(false, 'credentialed-url', 'URL carries userinfo credentials', policy, url.hostname);
  }

  const port = portFor(url);
  if (port === null || !portsFor(policy).includes(port)) {
    return decide(false, 'unapproved-port', `port ${url.port || '(default)'} is not approved`, policy, url.hostname);
  }

  // Strip IPv6 brackets for classification; keep a lower-cased host for matching.
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host.length === 0) {
    return decide(false, 'malformed-url', 'URL has no host', policy, host);
  }
  return classifyHost(host, policy);
}

/**
 * Classify a URL's host after the URL-shape checks have passed: a literal IP (any
 * family/encoding) is classified fully; a hostname is subjected to the
 * default-deny allowlist and left for the broker to resolve.
 */
function classifyHost(host: string, policy: EgressPolicy): EgressDecision {
  if (isIP(host) !== 0) {
    const literalClass = classifyResolvedAddress(host);
    if (literalClass !== null) {
      return decide(false, literalClass, `literal IP ${host} is in a ${literalClass} range`, policy, host);
    }
    // Public literal IP: still default-deny — approved only if the tenant listed
    // that exact address.
    return approvedOrDenied(isApprovedHost(host, policy), 'literal IP', host, policy);
  }

  // Not an IP by `isIP`, but it may be an alternate IPv4 encoding a resolver would
  // accept (decimal/octal/hex). Canonicalise and re-check; a numeric-shaped host
  // that is not a valid IP fails closed.
  const canon = canonicalizeIpv4(host);
  if (canon !== null) {
    if ('invalid' in canon) {
      return decide(false, 'invalid-ip-encoding', `host ${host} is a malformed numeric address`, policy, host);
    }
    const literalClass = classifyResolvedAddress(canon.ipv4);
    if (literalClass !== null) {
      return decide(false, literalClass, `host ${host} canonicalises to ${canon.ipv4} (${literalClass})`, policy, host);
    }
    const approved = isApprovedHost(canon.ipv4, policy) || isApprovedHost(host, policy);
    return approvedOrDenied(approved, 'numeric IP', host, policy);
  }

  // A real hostname. Default-deny by allowlist; DNS classification is the broker's
  // job before connect.
  return approvedOrDenied(isApprovedHost(host, policy), 'host', host, policy);
}

function approvedOrDenied(approved: boolean, kind: string, host: string, policy: EgressPolicy): EgressDecision {
  return approved
    ? decide(true, 'approved-public', `approved ${kind} (allowlist match; DNS pending for names)`, policy, host)
    : decide(false, 'not-approved', `${kind} ${host} is not on the tenant allowlist`, policy, host);
}
