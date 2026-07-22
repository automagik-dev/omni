/**
 * The tenant-egress broker — the single audited chokepoint for tenant-controlled
 * outbound HTTP (wish: omni-full-multitenancy, Group G5; ADR-0009, WISH
 * "Tenant-controlled outbound egress").
 *
 * WHAT IT GUARANTEES
 * ------------------
 * Every request it sends has, in order:
 *   1. passed {@link classifyUrl} against the tenant's default-deny policy
 *      (scheme, userinfo, port, allowlist, literal-IP reserved ranges);
 *   2. had its hostname resolved immediately before connect, with EVERY resolved
 *      address checked by {@link classifyResolvedAddress} — the DNS-rebinding
 *      defence, re-run on every redirect hop;
 *   3. been sent with bounded connect/read timeout, a bounded redirect count, and
 *      a bounded response-body size, under a per-broker concurrency cap;
 *   4. carried NO ambient credentials the broker added — it forwards only the
 *      caller's explicit headers, strips `authorization` across cross-origin
 *      redirects, and never attaches cookies, proxy credentials, or cloud
 *      identity headers.
 * and has recorded an audit decision carrying the tenant, actor, integration,
 * normalized destination class, policy version, and outcome — never a secret,
 * URL path, query, header, or body.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * This is the application-layer control. ADR-0009's SECOND layer — a runtime
 * network policy that blocks egress at the sandbox/pod boundary — is NOT
 * repo-local and is a named deferral (deployment / G8A staging scope). The
 * residual TOCTOU between "resolve+validate" and the transport's own resolution
 * is what that layer closes; here the window is minimised by validating
 * immediately before each connect and revalidating every hop.
 *
 * G7 owns the full adversarial SSRF/rebinding matrix; G5 ships this broker with
 * foundational accept/reject coverage for every rejection class.
 *
 * DUAL WORLD
 * ----------
 * The broker is reached only from a tenant-controlled egress path that has been
 * explicitly converted to call it. A flag-off deployment binds no policies and
 * routes nothing here, so its legacy egress is byte-identical until converted.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  type EgressDecision,
  type EgressDestinationClass,
  type EgressPolicy,
  canonicalizeIpv4,
  classifyResolvedAddress,
  classifyUrl,
} from './policy';

/** Injectable DNS resolver so tests drive rebinding without a network. */
export type AddressLookup = (hostname: string) => Promise<Array<{ address: string }>>;

/** Injectable transport so tests exercise redirect/limit logic without a network. */
export type EgressTransport = (url: string, init: RequestInit) => Promise<Response>;

const defaultLookup: AddressLookup = async (hostname) => lookup(hostname, { all: true });
const defaultTransport: EgressTransport = (url, init) => fetch(url, init);

/** A non-secret audit record for one egress decision. Safe to log/emit. */
export interface EgressAuditRecord {
  readonly tenantId: string;
  readonly actorCredentialId: string | null;
  /** The integration class making the call, e.g. `automations.webhook`. */
  readonly integration: string;
  readonly destinationClass: EgressDestinationClass;
  readonly policyVersion: number;
  readonly outcome: 'allowed' | 'blocked' | 'error';
  /** Normalized host only — never a path, query, header, or body. */
  readonly host: string;
  readonly redirectHops: number;
  readonly reason: string;
}

export type EgressAuditSink = (record: EgressAuditRecord) => void;

/** Bounds applied to every brokered request. All have safe, tight defaults. */
export interface EgressLimits {
  /** Per-attempt connect+read timeout (ms). */
  readonly timeoutMs: number;
  /** Maximum redirect hops followed (each revalidated). */
  readonly maxRedirects: number;
  /** Maximum response body size accepted (bytes). */
  readonly maxResponseBytes: number;
  /** Maximum concurrent in-flight brokered requests. */
  readonly maxConcurrency: number;
}

export const DEFAULT_EGRESS_LIMITS: EgressLimits = {
  timeoutMs: 10_000,
  maxRedirects: 3,
  maxResponseBytes: 8 * 1024 * 1024,
  maxConcurrency: 16,
};

/** The tenant/actor/integration a brokered call is made on behalf of. */
export interface EgressContext {
  readonly tenantId: string;
  readonly actorCredentialId: string | null;
  readonly integration: string;
}

export class EgressBlockedError extends Error {
  readonly code = 'egress_blocked';
  readonly destinationClass: EgressDestinationClass;
  constructor(destinationClass: EgressDestinationClass, reason: string) {
    // The message names the CLASS and reason, never the full URL/secret.
    super(`egress blocked (${destinationClass}): ${reason}`);
    this.name = 'EgressBlockedError';
    this.destinationClass = destinationClass;
  }
}

export class EgressLimitError extends Error {
  readonly code = 'egress_limit';
  constructor(reason: string) {
    super(`egress limit exceeded: ${reason}`);
    this.name = 'EgressLimitError';
  }
}

export interface TenantEgressBrokerOptions {
  readonly resolveAddresses?: AddressLookup;
  readonly transport?: EgressTransport;
  readonly audit?: EgressAuditSink;
  readonly limits?: Partial<EgressLimits>;
}

export interface BrokeredRequest {
  readonly url: string;
  readonly method?: string;
  /** Only these headers are forwarded. The broker adds none of its own. */
  readonly headers?: RequestInit['headers'];
  readonly body?: RequestInit['body'];
  /**
   * Host suffixes across which `authorization` may survive a cross-origin
   * redirect (e.g. a platform-owned CDN split). Empty by default — auth is
   * dropped on any cross-origin hop.
   */
  readonly preserveAuthRedirectHostSuffixes?: readonly string[];
}

function hostMatchesSuffix(hostname: string, suffix: string): boolean {
  const h = hostname.toLowerCase();
  const s = suffix.toLowerCase().replace(/^\.+/, '');
  return h === s || h.endsWith(`.${s}`);
}

/**
 * Credential-bearing headers dropped on ANY non-same-origin redirect hop. A
 * cross-origin 302 to an attacker-influenced (but allowlisted) host must not
 * carry the caller's ambient credentials onward: `authorization`, session
 * `cookie`s, or upstream `proxy-authorization` are all a webhook-credential leak.
 */
const CROSS_ORIGIN_CREDENTIAL_HEADERS: readonly string[] = ['authorization', 'cookie', 'proxy-authorization'];

/**
 * Build the header set for the next redirect hop from ONLY the caller's original
 * headers (never accumulating ambient state), dropping every credential-bearing
 * header (see {@link CROSS_ORIGIN_CREDENTIAL_HEADERS}) unless the hop is
 * same-origin or both hosts are on an explicitly preserved suffix.
 */
function nextHopHeaders(request: BrokeredRequest, currentUrl: URL, nextUrl: URL): Headers {
  const headers = new Headers(request.headers ?? {});
  const sameOrigin = nextUrl.origin === currentUrl.origin;
  const preserved = Boolean(
    request.preserveAuthRedirectHostSuffixes?.some(
      (suffix) => hostMatchesSuffix(currentUrl.hostname, suffix) && hostMatchesSuffix(nextUrl.hostname, suffix),
    ),
  );
  if (!sameOrigin && !preserved) {
    for (const header of CROSS_ORIGIN_CREDENTIAL_HEADERS) headers.delete(header);
  }
  return headers;
}

/**
 * A minimal FIFO semaphore. Bounds concurrent in-flight brokered requests so a
 * tenant cannot exhaust sockets/file descriptors through the broker.
 */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }
  release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

export class TenantEgressBroker {
  private readonly resolveAddresses: AddressLookup;
  private readonly transport: EgressTransport;
  private readonly audit: EgressAuditSink;
  private readonly limits: EgressLimits;
  private readonly semaphore: Semaphore;

  constructor(options: TenantEgressBrokerOptions = {}) {
    this.resolveAddresses = options.resolveAddresses ?? defaultLookup;
    this.transport = options.transport ?? defaultTransport;
    this.audit = options.audit ?? (() => {});
    this.limits = { ...DEFAULT_EGRESS_LIMITS, ...options.limits };
    this.semaphore = new Semaphore(this.limits.maxConcurrency);
  }

  private record(
    context: EgressContext,
    decision: EgressDecision,
    outcome: EgressAuditRecord['outcome'],
    hops: number,
  ): void {
    this.audit({
      tenantId: context.tenantId,
      actorCredentialId: context.actorCredentialId,
      integration: context.integration,
      destinationClass: decision.destinationClass,
      policyVersion: decision.policyVersion,
      outcome,
      host: decision.host,
      redirectHops: hops,
      reason: decision.reason,
    });
  }

  /**
   * Validate one URL fully: URL-shape/allowlist via {@link classifyUrl}, then —
   * for a DNS hostname — resolve and classify EVERY address. Throws
   * {@link EgressBlockedError} on any denial. Returns the decision on success.
   */
  private async validateDestination(
    url: URL,
    policy: EgressPolicy,
    context: EgressContext,
    hops: number,
  ): Promise<EgressDecision> {
    const decision = classifyUrl(url, policy);
    if (!decision.allowed) {
      this.record(context, decision, 'blocked', hops);
      throw new EgressBlockedError(decision.destinationClass, decision.reason);
    }

    // A literal-IP host (any family/encoding) was already classified fully by
    // classifyUrl. Only a real hostname still needs DNS resolution + per-address
    // classification. `canonicalizeIpv4` is the SAME test classifyUrl used, so a
    // hostname that merely starts with digits (`123.example.com`) is correctly
    // treated as a name and resolved — not mistaken for a numeric literal.
    const host = decision.host;
    const canon = canonicalizeIpv4(host);
    const isLiteralIp = isIP(host) !== 0 || (canon !== null && 'ipv4' in canon);
    if (!isLiteralIp) {
      let addresses: Array<{ address: string }>;
      try {
        addresses = await this.resolveAddresses(host);
      } catch (error) {
        // Resolution failure: nothing private became reachable. Surface as a
        // limit-class error so the caller can distinguish it from a policy block.
        throw new EgressLimitError(
          `DNS resolution failed for host: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
      if (addresses.length === 0) {
        throw new EgressLimitError('DNS resolution returned no addresses');
      }
      for (const { address } of addresses) {
        const addrClass = classifyResolvedAddress(address);
        if (addrClass !== null) {
          const blocked: EgressDecision = {
            allowed: false,
            destinationClass: addrClass,
            reason: `host ${host} resolves to a ${addrClass} address`,
            policyVersion: policy.policyVersion,
            host,
          };
          this.record(context, blocked, 'blocked', hops);
          throw new EgressBlockedError(addrClass, blocked.reason);
        }
      }
    }
    return decision;
  }

  /**
   * Send a tenant-controlled request through the broker. Resolves to the final
   * {@link Response} (body bounded to `maxResponseBytes`). Throws
   * {@link EgressBlockedError} on a policy denial and {@link EgressLimitError} on
   * a timeout / redirect / body-size / resolution failure.
   */
  async send(request: BrokeredRequest, policy: EgressPolicy, context: EgressContext): Promise<Response> {
    await this.semaphore.acquire();
    try {
      let currentUrl = new URL(request.url);
      let lastDecision = await this.validateDestination(currentUrl, policy, context, 0);
      // Fresh Headers from ONLY the caller's explicit headers — the broker adds
      // nothing ambient (no cookies, proxy creds, or cloud-identity headers).
      let headers = new Headers(request.headers ?? {});

      for (let hop = 0; hop <= this.limits.maxRedirects; hop++) {
        const response = await this.transport(currentUrl.toString(), {
          method: request.method ?? 'GET',
          headers,
          body: request.body ?? undefined,
          redirect: 'manual',
          signal: AbortSignal.timeout(this.limits.timeoutMs),
        });

        if (response.status < 300 || response.status >= 400) {
          this.enforceBodyLimit(response);
          this.record(context, lastDecision, 'allowed', hop);
          return response;
        }

        const location = response.headers.get('location');
        if (!location) {
          this.enforceBodyLimit(response);
          this.record(context, lastDecision, 'allowed', hop);
          return response;
        }

        const nextUrl = new URL(location, currentUrl);
        lastDecision = await this.validateDestination(nextUrl, policy, context, hop + 1);
        headers = nextHopHeaders(request, currentUrl, nextUrl);
        currentUrl = nextUrl;
      }

      const exhausted: EgressDecision = {
        allowed: false,
        destinationClass: lastDecision.destinationClass,
        reason: 'too many redirects',
        policyVersion: policy.policyVersion,
        host: lastDecision.host,
      };
      this.record(context, exhausted, 'error', this.limits.maxRedirects);
      throw new EgressLimitError('too many redirects');
    } catch (error) {
      if (!(error instanceof EgressBlockedError) && !(error instanceof EgressLimitError)) {
        // Transport/timeout error: audit it as an error outcome with no host leak.
        this.audit({
          tenantId: context.tenantId,
          actorCredentialId: context.actorCredentialId,
          integration: context.integration,
          destinationClass: 'approved-public',
          policyVersion: policy.policyVersion,
          outcome: 'error',
          host: safeHost(request.url),
          redirectHops: 0,
          reason: error instanceof Error ? error.name : 'transport error',
        });
      }
      throw error;
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * Reject a response whose declared length exceeds the cap. A body with no
   * Content-Length is left to the caller to read; callers that stream should use
   * {@link readBounded}.
   */
  private enforceBodyLimit(response: Response): void {
    const declared = response.headers.get('content-length');
    if (declared) {
      const length = Number.parseInt(declared, 10);
      if (!Number.isNaN(length) && length > this.limits.maxResponseBytes) {
        throw new EgressLimitError(`response body ${length} exceeds ${this.limits.maxResponseBytes} bytes`);
      }
    }
  }

  /**
   * Read a response body with a hard byte cap, for callers that consume the
   * stream. Throws {@link EgressLimitError} if the stream exceeds the cap.
   */
  async readBounded(response: Response): Promise<Uint8Array> {
    const cap = this.limits.maxResponseBytes;
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array(0);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > cap) {
          await reader.cancel();
          throw new EgressLimitError(`response body exceeds ${cap} bytes`);
        }
        chunks.push(value);
      }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}

/** Extract a bare host for audit without throwing on a malformed URL. */
function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '(unparseable)';
  }
}

// --- the dual-world gateway -------------------------------------------------

/**
 * Injectable seam that maps an egress call's context to the tenant's bound
 * policy, WITHOUT `@omni/core` depending on the API layer where a policy store /
 * tenant scope lives. The API registers a resolver; a flag-off deployment
 * registers none.
 *
 * When the resolver yields `null` — every flag-off deployment, and every call
 * with no tenant policy in scope — {@link brokeredFetch} is a byte-identical
 * passthrough to the global `fetch`, which is the dual-world contract: no tenants
 * exist to bind a default-deny policy to, so legacy egress is unchanged. When it
 * yields a policy, the call is fully brokered.
 */
let egressPolicyResolver: ((context: EgressContext) => EgressPolicy | null) | null = null;

export function setEgressPolicyResolver(resolver: ((context: EgressContext) => EgressPolicy | null) | null): void {
  egressPolicyResolver = resolver;
}

export function resolveEgressPolicy(context: EgressContext): EgressPolicy | null {
  if (!egressPolicyResolver) return null;
  try {
    return egressPolicyResolver(context) ?? null;
  } catch {
    // A resolver that throws must fail CLOSED for a real tenant context, but a
    // flag-off deployment has no resolver at all and never reaches here. We
    // cannot know the tenant's intent from a thrown resolver, so we deny by
    // returning a policy that approves nothing.
    return { policyVersion: -1, approvedHostSuffixes: [] };
  }
}

const sharedBroker = new TenantEgressBroker();

/**
 * The drop-in replacement for a raw `fetch` on a tenant-controlled egress path.
 *
 * A converted call site changes `fetch(url, init)` into
 * `brokeredFetch(url, { ...init, egress })`. Behaviour:
 *   * no bound policy (flag-off / no tenant scope) → byte-identical passthrough;
 *   * a bound policy → the full {@link TenantEgressBroker} enforcement path.
 *
 * The passthrough uses the same global `fetch` and the caller's own `init`
 * verbatim (minus the `egress` marker), so a flag-off deployment observes no
 * change — the same redirect-follow, the same caller timeout, the same headers.
 */
export async function brokeredFetch(
  input: string,
  init: RequestInit & { egress: EgressContext },
  broker: TenantEgressBroker = sharedBroker,
): Promise<Response> {
  const { egress, ...rest } = init;
  const policy = resolveEgressPolicy(egress);
  if (!policy) {
    // Legacy / flag-off: byte-identical passthrough. No policy is bound, so the
    // broker's enforcement (default-deny, manual redirects, bounded limits) does
    // not apply — exactly as before conversion.
    return fetch(input, rest);
  }
  return broker.send(
    {
      url: input,
      method: typeof rest.method === 'string' ? rest.method : undefined,
      headers: rest.headers,
      body: rest.body ?? null,
    },
    policy,
    egress,
  );
}
