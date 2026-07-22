/**
 * The egress destination-policy rejection matrix (wish: omni-full-multitenancy,
 * Group G5; ADR-0009).
 *
 * One assertion per rejection CLASS the ADR names, plus the accept case. These
 * are pure and need no network — they prove the decision, not the connection.
 * The broker suite proves the connection is never even attempted for a rejected
 * class (against real local listeners).
 */

import { describe, expect, test } from 'bun:test';
import { type EgressPolicy, canonicalizeIpv4, classifyResolvedAddress, classifyUrl, isAllowedClass } from '../policy';

/** A policy that approves `example.com` over https:443 — the happy destination. */
const policy: EgressPolicy = {
  policyVersion: 7,
  approvedHostSuffixes: ['example.com', '93.184.216.34'],
};

function classify(url: string, p: EgressPolicy = policy) {
  return classifyUrl(new URL(url), p);
}

describe('egress policy — accepts exactly the approved public destination', () => {
  test('an approved https host on the default port is allowed (pending DNS)', () => {
    const d = classify('https://api.example.com/webhook');
    expect(d.allowed).toBe(true);
    expect(d.destinationClass).toBe('approved-public');
    expect(isAllowedClass(d.destinationClass)).toBe(true);
    expect(d.policyVersion).toBe(7);
  });

  test('the decision carries the policy version for audit correlation', () => {
    expect(classify('https://example.com').policyVersion).toBe(7);
  });
});

describe('egress policy — default-deny', () => {
  test('a public host NOT on the allowlist is refused', () => {
    const d = classify('https://not-approved.org/');
    expect(d.allowed).toBe(false);
    expect(d.destinationClass).toBe('not-approved');
  });

  test('a lookalike suffix does not match on a non-label boundary', () => {
    // evil-example.com must NOT match the suffix example.com.
    expect(classify('https://evilexample.com/').allowed).toBe(false);
    expect(classify('https://notexample.com/').destinationClass).toBe('not-approved');
  });

  test('an empty allowlist approves nothing', () => {
    const empty: EgressPolicy = { policyVersion: 1, approvedHostSuffixes: [] };
    expect(classify('https://example.com/', empty).allowed).toBe(false);
  });
});

describe('egress policy — scheme, port, and userinfo', () => {
  test('a non-http(s) scheme is refused even for an approved host', () => {
    expect(classify('file:///etc/passwd').destinationClass).toBe('unapproved-scheme');
    expect(classify('gopher://example.com/').destinationClass).toBe('unapproved-scheme');
    expect(classify('unix:/var/run/docker.sock').destinationClass).toBe('unapproved-scheme');
  });

  test('http is refused when only https is approved (default)', () => {
    expect(classify('http://example.com/').destinationClass).toBe('unapproved-scheme');
  });

  test('a non-approved port is refused', () => {
    expect(classify('https://example.com:8443/').destinationClass).toBe('unapproved-port');
  });

  test('a credential-bearing URL (userinfo confusion) is refused', () => {
    expect(classify('https://user:pass@example.com/').destinationClass).toBe('credentialed-url');
    expect(classify('https://attacker@example.com/').destinationClass).toBe('credentialed-url');
  });
});

describe('egress policy — literal reserved ranges (each class)', () => {
  const approveAny: EgressPolicy = {
    policyVersion: 1,
    // Approve everything by suffix so the ONLY thing that can refuse is the
    // absolute reserved-range denial — proving the denial is not overridable.
    approvedHostSuffixes: [
      '.',
      'com',
      'org',
      'net',
      'internal',
      'local',
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ],
    approvedPorts: [80, 443],
    approvedSchemes: ['http:', 'https:'],
  };
  const c = (url: string) => classify(url, approveAny).destinationClass;

  test('loopback IPv4 and IPv6', () => {
    expect(c('https://127.0.0.1/')).toBe('loopback');
    expect(c('https://[::1]/')).toBe('loopback');
  });
  test('unspecified', () => {
    expect(c('https://0.0.0.0/')).toBe('unspecified');
    expect(c('https://[::]/')).toBe('unspecified');
  });
  test('RFC1918 private', () => {
    expect(c('https://10.0.0.5/')).toBe('private-rfc1918');
    expect(c('https://172.16.4.4/')).toBe('private-rfc1918');
    expect(c('https://192.168.1.1/')).toBe('private-rfc1918');
  });
  test('CGNAT (RFC 6598)', () => {
    expect(c('https://100.64.0.1/')).toBe('cgnat');
  });
  test('link-local and cloud metadata', () => {
    expect(c('https://169.254.0.1/')).toBe('link-local');
    expect(c('https://169.254.169.254/')).toBe('link-local'); // AWS/GCP metadata
    expect(c('https://[fe80::1]/')).toBe('link-local');
  });
  test('IPv6 ULA', () => {
    expect(c('https://[fc00::1]/')).toBe('ipv6-ula');
    expect(c('https://[fd12:3456::1]/')).toBe('ipv6-ula');
  });
  test('multicast', () => {
    expect(c('https://224.0.0.1/')).toBe('multicast');
    expect(c('https://[ff02::1]/')).toBe('multicast');
  });
  test('IPv4-mapped IPv6 re-projects onto the IPv4 policy', () => {
    expect(c('https://[::ffff:127.0.0.1]/')).toBe('loopback');
    expect(c('https://[::ffff:10.0.0.1]/')).toBe('private-rfc1918');
    expect(c('https://[::ffff:169.254.169.254]/')).toBe('link-local');
  });
  test('6to4 (2002::/16) literal embedding an internal IPv4 is rejected', () => {
    expect(c('https://[2002:7f00:1::]/')).toBe('loopback'); // 127.0.0.1
    expect(c('https://[2002:a9fe:a9fe::]/')).toBe('link-local'); // 169.254.169.254 metadata
  });
  test('6to4 relay anycast 192.88.99.0/24 is reserved', () => {
    expect(c('https://192.88.99.1/')).toBe('reserved');
  });
});

describe('egress policy — IPv6 transition encodings cannot smuggle an internal IPv4', () => {
  test('6to4 (2002::/16) re-projects the embedded IPv4', () => {
    expect(classifyResolvedAddress('2002:7f00:1::')).toBe('loopback'); // 127.0.0.1
    expect(classifyResolvedAddress('2002:a00:1::')).toBe('private-rfc1918'); // 10.0.0.1
    expect(classifyResolvedAddress('2002:a9fe:a9fe::')).toBe('link-local'); // 169.254.169.254 metadata
    expect(classifyResolvedAddress('2002:808:808::')).toBeNull(); // 8.8.8.8 stays public
  });
  test('NAT64 (64:ff9b::/96) re-projects the embedded IPv4', () => {
    expect(classifyResolvedAddress('64:ff9b::7f00:1')).toBe('loopback'); // 127.0.0.1
    expect(classifyResolvedAddress('64:ff9b::a9fe:a9fe')).toBe('link-local'); // 169.254.169.254 metadata
    expect(classifyResolvedAddress('64:ff9b::a00:1')).toBe('private-rfc1918'); // 10.0.0.1
  });
  test('Teredo (2001:0::/32) re-projects the server and obfuscated client IPv4', () => {
    // Internal IPv4 in the plain server field (hextets 2-3).
    expect(classifyResolvedAddress('2001:0:7f00:1::')).toBe('loopback'); // server 127.0.0.1
    // Internal IPv4 in the obfuscated client field (last two hextets, XOR 0xffff),
    // with a realistic public server field (65.54.227.120 = 4136:e378).
    expect(classifyResolvedAddress('2001:0:4136:e378::80ff:fffe')).toBe('loopback'); // client 127.0.0.1
    expect(classifyResolvedAddress('2001:0:4136:e378::5601:5601')).toBe('link-local'); // client 169.254.169.254
  });
});

describe('egress policy — alternate IPv4 encodings cannot smuggle a reserved address', () => {
  const approveAny: EgressPolicy = {
    policyVersion: 1,
    approvedHostSuffixes: Array.from({ length: 10 }, (_, i) => String(i)),
    approvedPorts: [443],
  };
  const c = (url: string) => classify(url, approveAny).destinationClass;

  test('decimal integer form of 127.0.0.1', () => {
    expect(canonicalizeIpv4('2130706433')).toEqual({ ipv4: '127.0.0.1' });
    expect(c('https://2130706433/')).toBe('loopback');
  });
  test('hex form of 127.0.0.1', () => {
    expect(c('https://0x7f000001/')).toBe('loopback');
  });
  test('octal dotted form of 127.0.0.1', () => {
    expect(c('https://0177.0.0.1/')).toBe('loopback');
  });
  test('short form 127.1 expands to 127.0.0.1', () => {
    expect(canonicalizeIpv4('127.1')).toEqual({ ipv4: '127.0.0.1' });
    expect(c('https://127.1/')).toBe('loopback');
  });
  test('decimal form of metadata 169.254.169.254', () => {
    expect(c('https://2852039166/')).toBe('link-local');
  });
  test('canonicalizeIpv4 fails a malformed numeric address closed (defence in depth)', () => {
    // The WHATWG URL parser already rejects `https://999.1.1.1/` at construction,
    // so classifyUrl rarely sees these; canonicalizeIpv4 is the belt to that
    // suspenders for any numeric host that reaches it un-canonicalised.
    expect(canonicalizeIpv4('999.1.1.1')).toEqual({ invalid: true });
    expect(canonicalizeIpv4('0x1.0x2.0x3.0x4.0x5')).toEqual({ invalid: true });
    expect(canonicalizeIpv4('256')).toEqual({ ipv4: '0.0.1.0' });
    expect(canonicalizeIpv4('4294967296')).toEqual({ invalid: true }); // > 32 bits
  });
  test('a real hostname with a numeric label is still a hostname (falls to DNS)', () => {
    // Not all-numeric parts → not an IPv4 literal → default-deny miss, not an
    // encoding error (the broker would resolve it).
    expect(canonicalizeIpv4('123.example.com')).toBeNull();
    expect(classify('https://123.example.com/').allowed).toBe(true); // on allowlist
  });
});

describe('egress policy — resolved-address classification (the DNS-hop check)', () => {
  test('public addresses pass', () => {
    expect(classifyResolvedAddress('93.184.216.34')).toBeNull();
    expect(classifyResolvedAddress('2606:2800:220:1:248:1893:25c8:1946')).toBeNull();
  });
  test('reserved addresses are caught', () => {
    expect(classifyResolvedAddress('127.0.0.1')).toBe('loopback');
    expect(classifyResolvedAddress('10.1.2.3')).toBe('private-rfc1918');
    expect(classifyResolvedAddress('169.254.169.254')).toBe('link-local');
    expect(classifyResolvedAddress('::1')).toBe('loopback');
  });
  test('a non-IP string is refused, never treated as public', () => {
    expect(classifyResolvedAddress('not-an-ip')).toBe('invalid-ip-encoding');
  });
});
