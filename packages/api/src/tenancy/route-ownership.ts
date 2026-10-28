/**
 * Route ownership coverage gate
 * (wish: omni-full-multitenancy, Group G4).
 *
 * WHAT IT ENFORCES
 * ----------------
 * Every route the application registers must carry an EXPLICIT ownership
 * declaration from a closed set. A route with no declaration is a build
 * failure, not a warning — the failure mode this exists to prevent is a new
 * endpoint shipping with nobody having decided, in writing, who is allowed to
 * reach it and whose data it returns.
 *
 * THE FOUR CLASSES
 * ----------------
 *   * `tenant-scoped` — serves tenant business data. Under enforcement every
 *     read and write reaches the database through `withTenantTransaction`, and
 *     the tenant comes from the authenticated context (ADR-0003/0004).
 *   * `platform-admin` — the ADR-0005 control plane. Reachable only by a
 *     platform-class credential; a tenant credential cannot address it at all.
 *   * `public-by-contract` — deliberately unauthenticated. Each declaration
 *     carries its privacy contract INLINE: what the endpoint may expose and,
 *     more importantly, what it must not. WISH "Public and bootstrap surfaces"
 *     forbids tenant inventory, counts, identifiers, connection state, consumer
 *     offsets, and resource-existence oracles on any of these.
 *   * `control-plane` — auth-plane and platform lifecycle surface that operates
 *     on credentials/host identity rather than on tenant business data
 *     (ADR-0003, ADR-0005). Each declaration says why no tenant context applies.
 *
 * THE RATCHET
 * -----------
 * This is a down-ratchet in the same shape as `tenancy-db-access-guard.ts`:
 * declared routes plus an explicit, SHRINKING `UNDECLARED_ACKNOWLEDGED` list.
 * The list is a committed inventory of exact routes, not a bare count, which is
 * the property that makes a NEWLY ADDED route fail closed immediately — it
 * cannot land in the acknowledged set by accident, only by someone editing this
 * file and writing down the open question. `UNDECLARED_ACKNOWLEDGED_CEILING`
 * only ever decreases and must reach 0 for G4 to be complete.
 *
 * ENUMERATION
 * -----------
 * The registered surface is read from the Hono app itself rather than from a
 * hand-kept list — see `route-enumeration.ts`, which is a separate module so
 * that this one stays a leaf with no import cycle back into the app.
 *
 * DECLARATION IS ALSO ENFORCEMENT
 * ------------------------------
 * This table used to be a build-time gate only, which meant the classes it
 * asserts could be true in the registry and false at runtime. They no longer
 * can: `resolveRouteOwnership` / `isTenantAddressableRoute` are read by the
 * tenancy edge on every request carrying a tenant credential, and
 * `TENANT_ADDRESSABLE_SCOPES` is what `scope-projection.ts` projects FROM. A
 * route declared `platform-admin` or `control-plane` is therefore unreachable
 * by a tenant credential in two independent ways — it is not in the projected
 * scope set, and the edge refuses it by name — so the declaration and the
 * enforcement cannot drift apart again.
 */

import { SCOPE_MAP } from '../constants/scopes';

export type RouteOwnershipClass = 'tenant-scoped' | 'platform-admin' | 'public-by-contract' | 'control-plane';

/** `"METHOD /path"`, exactly as Hono records it. */
export type RouteKey = string;

export interface RouteOwnershipDeclaration {
  readonly route: RouteKey;
  readonly class: RouteOwnershipClass;
  /**
   * Required for every class except `tenant-scoped`. For `public-by-contract`
   * this IS the privacy contract.
   */
  readonly justification?: string;
}

export interface AcknowledgedUndeclaredRoute {
  readonly route: RouteKey;
  /** What has to be answered before this route can be declared. */
  readonly openQuestion: string;
}

export interface RouteOwnershipReport {
  /** Registered routes with no declaration and no acknowledgement. Any entry fails the build. */
  readonly undeclared: RouteKey[];
  /** Registered routes covered only by the shrinking acknowledged list. */
  readonly acknowledged: RouteKey[];
  /** Declarations/acknowledgements whose route no longer exists. Any entry fails the build. */
  readonly stale: RouteKey[];
  /** Non-`tenant-scoped` declarations with no justification. Any entry fails the build. */
  readonly unjustified: RouteKey[];
  /** A route both declared and acknowledged — the acknowledgement must be removed. */
  readonly doubleCounted: RouteKey[];
  readonly counts: Record<RouteOwnershipClass, number>;
}

export function evaluateRouteOwnership(
  registered: readonly RouteKey[],
  declarations: readonly RouteOwnershipDeclaration[] = ROUTE_OWNERSHIP,
  acknowledged: readonly AcknowledgedUndeclaredRoute[] = UNDECLARED_ACKNOWLEDGED,
): RouteOwnershipReport {
  const declared = new Map(declarations.map((d) => [d.route, d]));
  const ack = new Set(acknowledged.map((a) => a.route));
  const found = new Set(registered);

  const undeclared = registered.filter((route) => !declared.has(route) && !ack.has(route));
  const acknowledgedPresent = registered.filter((route) => ack.has(route));
  const stale = [...declared.keys(), ...ack].filter((route) => !found.has(route)).sort();
  const unjustified = declarations
    .filter((d) => d.class !== 'tenant-scoped' && (d.justification ?? '').trim().length === 0)
    .map((d) => d.route);
  const doubleCounted = [...ack].filter((route) => declared.has(route)).sort();

  const counts: Record<RouteOwnershipClass, number> = {
    'tenant-scoped': 0,
    'platform-admin': 0,
    'public-by-contract': 0,
    'control-plane': 0,
  };
  for (const d of declarations) counts[d.class] += 1;

  return { undeclared, acknowledged: acknowledgedPresent, stale, unjustified, doubleCounted, counts };
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

/**
 * Deliberately unauthenticated surface.
 *
 * Every entry states what it may expose. WISH "Public and bootstrap surfaces"
 * is the binding constraint: no tenant inventory, counts, identifiers,
 * connection state, consumer offsets, or resource-existence oracle. The G4
 * change to `routes/health.ts` is what makes these contracts true rather than
 * aspirational, and it applies in BOTH worlds — an unauthenticated leak is not
 * something a feature flag may protect.
 */
const PUBLIC_PRIVACY_CONTRACTS: readonly RouteOwnershipDeclaration[] = [
  {
    route: 'GET /health',
    class: 'public-by-contract',
    justification:
      'Liveness probe for external checkers (k8s, load balancers) that cannot present a credential. Exposes ' +
      'process liveness, version, uptime, and per-dependency up/down only. Exposes NO instance counts, ' +
      'per-channel inventory, or connection state — those were a tenant-inventory oracle and G4 removed them.',
  },
  {
    route: 'GET /api/v2/health',
    class: 'public-by-contract',
    justification:
      'Same handler as GET /health, mounted under the API prefix for genie provider probes. Same contract: ' +
      'liveness, version, uptime, dependency up/down; no tenant inventory, counts, or identifiers.',
  },
  {
    route: 'GET /api/v2/health/consumers',
    class: 'public-by-contract',
    justification:
      'Consumer-lag liveness for operators probing a deployment without a credential. Exposes ONLY whether ' +
      'offset tracking is healthy and how stale the oldest tracked consumer is. It does NOT dump consumer ' +
      'names, stream names, sequences, event ids, or timestamps: those identify real event volumes and real ' +
      'event rows to an anonymous caller, which is exactly the offset leak WISH "Public and bootstrap ' +
      'surfaces" names.',
  },
  {
    route: 'GET /api/v2/info',
    class: 'public-by-contract',
    justification:
      'Build/deployment identification for unauthenticated clients. Exposes version, environment name, and ' +
      'uptime. Exposes NO instance totals, active counts, or connected counts — an anonymous caller learning ' +
      'how many instances a deployment serves is tenant inventory.',
  },
  {
    route: 'GET /api/v2/_internal/health',
    class: 'public-by-contract',
    justification:
      'Loopback-only process probe (pid, memory) used by the supervisor. Carries no database access and no ' +
      'tenant-derived value of any kind.',
  },
  {
    route: 'GET /api/v2/docs',
    class: 'public-by-contract',
    justification:
      'Swagger UI. Static documentation shell; renders the schema-only OpenAPI document and reads no data.',
  },
  {
    route: 'GET /api/v2/openapi.json',
    class: 'public-by-contract',
    justification:
      'OpenAPI document. Schema and security-scheme metadata only — it describes the SHAPE of the API and ' +
      'never enumerates tenants, instances, or any row. Credential-class/tenant extensions are surfaced on ' +
      'the authenticated `auth validate` path, not here.',
  },
  {
    route: 'GET /.well-known/agent-card.json',
    class: 'public-by-contract',
    justification:
      'A2A discovery, flag-gated (503 when A2A_ENABLED is not "true"). Resolves at most ONE explicitly ' +
      'addressed agent card and 404s otherwise; it never lists agents, so it cannot be walked to enumerate ' +
      'a deployment. The 404 is shape-identical for "no such agent" and "agent not A2A-enabled".',
  },
  {
    route: 'GET /.well-known/agent.json',
    class: 'public-by-contract',
    justification:
      'Legacy alias of /.well-known/agent-card.json — same handler, same flag gate, same contract: at most one ' +
      'explicitly addressed agent card, no listing, and a shape-identical 404 that cannot be walked to ' +
      'enumerate a deployment.',
  },
  {
    route: 'ALL /a2a/*',
    class: 'public-by-contract',
    justification:
      'Static 503 stub registered only when A2A_ENABLED is not "true". Returns a fixed string, reads nothing, ' +
      'and reveals only that the feature is disabled — which is a deployment configuration fact, not tenant data.',
  },
  {
    route: 'POST /api/v2/instances/:id/telegram/webhook',
    class: 'public-by-contract',
    justification:
      "Telegram callback. Auth-exempt because Telegram's servers send no credential; authenticity comes from " +
      'the X-Telegram-Bot-Api-Secret-Token compared against the secret held server-side for THAT instance. ' +
      'The tenant is established from the instance row the plugin already holds, never from the request body ' +
      'or headers. Responses are fixed shapes and carry no row data back to the caller.',
  },
  {
    route: 'POST /api/v2/channels/gupshup/:instanceId/webhook',
    class: 'public-by-contract',
    justification:
      "Gupshup callback. Auth-exempt for the provider's servers; the plugin verifies the configured token and " +
      'resolves the tenant from the server-side instance record addressed by the path, never from a body or ' +
      'header tenant claim.',
  },
  {
    route: 'POST /api/v2/channels/asc-flow/:instanceId/webhook',
    class: 'public-by-contract',
    justification:
      "ASC platform Flow callback — the flow's api_rest node calls Omni. Auth-exempt because the node sends no " +
      'credential and the platform documents no HMAC/signature mechanism. Authenticity rests on the per-instance ' +
      'path (an unguessable instance UUID, the Gupshup precedent) plus an optional verify token the handler ' +
      'compares when one is configured on the instance. The tenant comes from the server-side instance record ' +
      'addressed by the path, never from a body or header claim. NOTE: unlike the other callbacks here, this ' +
      'route is a POLL — the response body carries the agent reply (resposta/bolhas/hand_off), not a fixed ack. ' +
      'So on an instance with no verify token, possession of the instance UUID is enough to send an arbitrary ' +
      'chatInput and read the agent answer back, each novel input being a billed dispatch. Configure ' +
      'webhookVerifyToken (and echo it from the flow node) on any instance carrying tenant data.',
  },
  {
    route: 'GET /api/v2/slack/oauth/callback',
    class: 'public-by-contract',
    justification:
      'Slack OAuth v2 redirect target (wish: slack-personal-oauth). Auth-exempt because the browser arrives from ' +
      'Slack carrying no Omni credential; rate-limited by IP. Authenticity is the HMAC-signed single-use state ' +
      '(nonce + HMAC-SHA256 under a key derived from the Slack client secret) that names a server-side pending ' +
      'record written by the authenticated POST /api/v2/slack/oauth/start. The tenant comes from that server-side ' +
      'pending record ONLY — never from the query string, headers or body — and the record is consumed before any ' +
      'Slack call, so a replayed, forged, expired or unknown state performs no network call and creates no row. ' +
      'The surface exposes only a 302 redirect to an allowlisted returnTo whose query string is exactly ' +
      '?slack=<nonce>, or a fixed HTML page for the CLI entry: no instance id, name, tenant id, token, team id or ' +
      'connection state; the outcome is read through the authenticated GET /api/v2/slack/oauth/result/:nonce.',
  },
  {
    route: 'ALL /api/auth/*',
    class: 'public-by-contract',
    justification:
      'Better Auth (human login, wish: omni-labs-distribution). Answers 404 when login is off (OMNI_LOGIN_ENABLED=false), and always with multitenancy on. Only an allowlist of Better Auth paths ' +
      'answers (PUBLIC_AUTH_PATHS: the RFC 8628 device flow, passkey ceremonies, get-session, sign-out); ' +
      'every other path is 404. A device code exposes nothing until the signed-in owner approves it; ' +
      "passkey and session endpoints act only on the caller's own session. No tenant data, no other user, " +
      'no instance data.',
  },
  {
    route: 'POST /api/auth/device/code',
    class: 'public-by-contract',
    justification:
      'Better Auth RFC 8628 device authorization request (human login), routed on its own for a stricter ' +
      'per-IP limit. Answers 404 when login is off (OMNI_LOGIN_ENABLED=false), and always with multitenancy on. Only the ' +
      'known client ids are accepted; it returns a device code and user code that grant nothing until the ' +
      'signed-in owner approves them, and reads no tenant data.',
  },
  {
    route: 'GET /api/login/whatsapp',
    class: 'public-by-contract',
    justification:
      "What a device's QR opens (human login): a redirect to the owner's own WhatsApp chat with the device's " +
      'code typed. Answers 404 when login is off (OMNI_LOGIN_ENABLED=false) and a live, pending device request carries that ' +
      "user code; that is the only place the owner's number is given out, and only to someone holding a code " +
      'a device on this Omni just asked for. Rate-limited per IP.',
  },
  {
    route: 'GET /api/login/claim',
    class: 'public-by-contract',
    justification:
      'Static claim page for an unclaimed Omni (human login). Answers 404 when login is off (OMNI_LOGIN_ENABLED=false), and always with multitenancy on. Fixed HTML and script; it reads nothing ' +
      'server-side. What it can do is gated by the claim token on the endpoints it calls.',
  },
  {
    route: 'GET /api/login/app',
    class: 'public-by-contract',
    justification:
      'Static "open Automagik" page (human login). Answers 404 when login is off (OMNI_LOGIN_ENABLED=false), and always with multitenancy on. Fixed HTML and script; its only link is ' +
      "omni://connect with this Omni's own address, which grants nothing: the app then signs in through " +
      "the device page, which needs the owner's own session. With ?grant= (a connect link the owner got in " +
      'their own self chat) it looks the grant up without spending it and puts it in that link, or says the ' +
      'link expired; it reveals only whether that exact grant is live.',
  },
  {
    route: 'GET /api/login/device',
    class: 'public-by-contract',
    justification:
      'Static device-approval page (human login). Answers 404 when login is off (OMNI_LOGIN_ENABLED=false), and always with multitenancy on. Fixed HTML and script naming the known ' +
      "device clients; approving requires the owner's own Better Auth session.",
  },
  {
    route: 'GET /api/market',
    class: 'public-by-contract',
    justification: 'A fixed 301 to /market, where the Automagik marketplace page moved. Reads nothing.',
  },
  {
    route: 'GET /market',
    class: 'public-by-contract',
    justification:
      'The Automagik marketplace page: the catalog of DSH plugins this release carries and the Automagik ' +
      'plugins it was tested with, with the index URL to add to a DSH. Built only from the build-time bundled market ' +
      '(dist/market/market.json) and marketplace/automagik.json, identical for every caller; reads no database, ' +
      'no tenant, instance, user or connection state, and its only input is the request origin when no public ' +
      'URL is configured. Text is inserted with textContent.',
  },
  {
    route: 'GET /api/market/index.json',
    class: 'public-by-contract',
    justification:
      'The Automagik marketplace as a DSH plugin market index (format 1). Lists the plugin names, versions, ' +
      'descriptions and labels fixed at build time (the bundled market and marketplace/automagik.json), the same ' +
      'for every caller; reads no database, and exposes no tenant, instance, user, count of anything live, or ' +
      'configuration beyond the public URL the index points installers at.',
  },
  {
    route: 'GET /api/market/npm/*',
    class: 'public-by-contract',
    justification:
      "The Automagik marketplace's npm registry: the packument and the tarball of each DSH plugin this release " +
      'carries, read only from the build-time bundled market. A tarball is served only when its file name is the ' +
      'one market.json lists for that package, never from a path built from the request; any other package name ' +
      'answers a 302 to the public npm registry. Reads no database and exposes no tenant, instance or user data.',
  },
  {
    route: 'GET /api/v2/login/status',
    class: 'public-by-contract',
    justification:
      'Human login status. Answers 404 when login is off (OMNI_LOGIN_ENABLED=false), and always with ' +
      "multitenancy on. Returns only whether the Omni has an owner, the owner's own WhatsApp number while " +
      "it is connected (so a device can show a QR that opens the owner's self chat, which is the point of " +
      'the feature), and the device-approval URL. No tenant data, counts or other instances.',
  },
  {
    route: 'GET /api/v2/login/claim/accounts',
    class: 'public-by-contract',
    justification:
      'Claim: the connected WhatsApp accounts a person may claim the Omni with. Answers 404 when login is off (OMNI_LOGIN_ENABLED=false), and always with multitenancy on. Only while unclaimed (or the owner has no WhatsApp yet, to link one) and only ' +
      'with the claim token (an HMAC of the server secret printed in the boot log); otherwise the same 404. ' +
      'Numbers are masked (+55 12 •••• 8888).',
  },
  {
    route: 'POST /api/v2/login/claim/whatsapp',
    class: 'public-by-contract',
    justification:
      'Claim: link a first WhatsApp account to an unclaimed Omni. Answers 404 when login is off (OMNI_LOGIN_ENABLED=false), and always with multitenancy on. Only while unclaimed and with the claim ' +
      'token; creates one instance named owner-whatsapp and starts its QR link. Returns only that ' +
      "instance's id.",
  },
  {
    route: 'GET /api/v2/login/claim/whatsapp/:id',
    class: 'public-by-contract',
    justification:
      'Claim: the linking QR (as SVG) and connected state of that instance. Answers 404 when login is off (OMNI_LOGIN_ENABLED=false), and always with multitenancy on. Only while unclaimed and with the ' +
      'claim token; the number is masked once connected.',
  },
  {
    route: 'POST /api/v2/login/claim/send-code',
    class: 'public-by-contract',
    justification:
      'Claim: send a 6-digit code to the self chat of one connected WhatsApp account. Answers 404 when login is off (OMNI_LOGIN_ENABLED=false), and always with multitenancy on. Only while unclaimed, ' +
      'with the claim token, and only to an account connected to this Omni; rate-limited per IP. Returns ' +
      'the masked number.',
  },
  {
    route: 'POST /api/v2/login/claim/token',
    class: 'public-by-contract',
    justification:
      'Claim with the claim token alone: whoever has the token from the boot log runs the server and becomes ' +
      'the only owner, with no WhatsApp. Answers 404 when login is off (OMNI_LOGIN_ENABLED=false, always with ' +
      'multitenancy on), with a wrong token, or once the Omni has an owner. Rate limited per IP; a second owner ' +
      'can never be created (one row in login_users).',
  },
  {
    route: 'POST /api/v2/login/claim/verify',
    class: 'public-by-contract',
    justification:
      'Claim: verify that code; its sender becomes the only owner and gets a session cookie. Answers 404 ' +
      'when login is off (OMNI_LOGIN_ENABLED=false), and always with multitenancy on. Only while ' +
      'unclaimed and with the claim token; Better Auth limits attempts; a second owner can never be created ' +
      '(sign-up closes).',
  },
  {
    route: 'POST /api/v2/login/send-code',
    class: 'public-by-contract',
    justification:
      "Owner sign-in: send a 6-digit code to the owner's own WhatsApp self chat. Answers 404 when login " +
      "is off (OMNI_LOGIN_ENABLED=false), and always with multitenancy on. The number is the owner's and " +
      'is never taken from the request; rate-limited per IP. Returns the masked number.',
  },
  {
    route: 'POST /api/v2/login/verify',
    class: 'public-by-contract',
    justification:
      "Owner sign-in: verify that code and set the owner's session cookie. Answers 404 when login is " +
      'off (OMNI_LOGIN_ENABLED=false), and always with multitenancy on. Better Auth limits attempts; ' +
      'rate-limited per IP; returns nothing but success.',
  },
  {
    route: 'POST /api/v2/login/device-key',
    class: 'public-by-contract',
    justification:
      'Device sign-in: a device trades the one-time token the RFC 8628 device flow gave it (after the owner ' +
      'approved it) for an Omni API key. Answers 404 when login is off (OMNI_LOGIN_ENABLED=false), and ' +
      "always with multitenancy on. Only a Bearer token of the owner's session counts, never a cookie; the " +
      'session ends with the exchange, so one approval mints one key. Scopes come from server config and ' +
      'can never include *, keys:* or platform:*.',
  },
  {
    route: 'POST /api/v2/login/connect',
    class: 'public-by-contract',
    justification:
      'Device sign-in from a connect link: a device trades the one-time grant the owner got by texting ' +
      '"connect" in their own WhatsApp self chat for an Omni API key. Answers 404 when login is off (OMNI_LOGIN_ENABLED=false), and always with multitenancy on. Rate-limited per IP; a grant is 144 random ' +
      'bits stored only as a hash, lives ten minutes and is spent before the key exists, so one link mints ' +
      'one key. Any failure is the same 410. Scopes come from server config and can never include *, keys:* ' +
      'or platform:*.',
  },
  {
    route: 'GET /',
    class: 'public-by-contract',
    justification:
      "What a browser sees at this Omni's address: a fixed page saying this is an Omni, with links to get " +
      'the app and, when human login is on, to open it (omni://connect with the configured public URL, which ' +
      'grants nothing). Reads no database, tenant, instance, user or connection state. Any request not asking ' +
      'for HTML gets the plain JSON 404 it got before.',
  },
  {
    route: 'GET /api',
    class: 'public-by-contract',
    justification:
      "The same fixed page as GET /, for a browser that opens this Omni's /api address. Reads no database, " +
      'tenant, instance, user or connection state; anything not asking for HTML gets the plain JSON 404.',
  },
  {
    route: 'POST /api/v2/channels/twilio-whatsapp/:instanceId/webhook',
    class: 'public-by-contract',
    justification:
      "Twilio callback. Auth-exempt for Twilio's servers; authenticity is the X-Twilio-Signature the plugin " +
      'verifies against the server-held auth token, and the tenant comes from the server-side instance record ' +
      'addressed by the path.',
  },
  {
    route: 'POST /api/v2/channels/hermes/:instanceId/webhook',
    class: 'public-by-contract',
    justification:
      "Hermes (Mutant) gateway callback. Auth-exempt for Mutant's servers, which send no credential and no " +
      'signature — the Hermes API has no HMAC mechanism at all. Authenticity rests on two factors the handler ' +
      'enforces: the per-instance path (an unguessable instance UUID, the Gupshup precedent) and a cross-check ' +
      'of the payload media_id (the Hermes UUID of the WhatsApp line) against the hermes_media_id stored ' +
      'server-side on that instance — a mismatch is dropped with a warn log. The tenant comes from the ' +
      'server-side instance record addressed by the path, never from a body or header claim. Responses are ' +
      'fixed 200 acks with no row data.',
  },
  {
    route: 'GET /api/v2/channels/webchat/:instanceId/:action',
    class: 'public-by-contract',
    justification:
      'Webchat (prototype) widget page and Server-Sent Events stream. Auth-exempt because the caller is an ' +
      'anonymous site visitor with no API key. The plugin answers only for a connected webchat instance addressed ' +
      'by its UUID path, and the event stream returns only the replies Omni sent to the visitorId the browser ' +
      'itself generated; that visitorId is a bearer secret with no server-side signature, origin allowlist or ' +
      'rate limit yet. It withholds every other chat, contact and instance setting.',
  },
  {
    route: 'POST /api/v2/channels/webchat/:instanceId/:action',
    class: 'public-by-contract',
    justification:
      'Webchat (prototype) visitor message ingress. Auth-exempt because the caller is an anonymous site visitor ' +
      'with no API key. The body is Zod-validated (visitorId, optional name, text) and becomes message.received ' +
      'on the instance addressed by the UUID path; the tenant comes from that server-side instance record, never ' +
      'from the body. The response is a fixed 202 ack with the new message id and no row data.',
  },
  {
    route: 'POST /api/v2/channels/asc/:instanceId/webhook',
    class: 'public-by-contract',
    justification:
      "ASC Brazil (ASCWhats GW) gateway callback. Auth-exempt for ASC's servers, which send no credential — " +
      'the ASC API documents no HMAC/signature mechanism. Authenticity rests on the per-instance path (an ' +
      'unguessable instance UUID, the Gupshup precedent) plus an optional verify token (the `chave` registered ' +
      'via ASC setWebhook) that the handler compares when configured on the instance. The tenant comes from the ' +
      'server-side instance record addressed by the path, never from a body or header claim. Responses are ' +
      'fixed 200 acks with no row data.',
  },
  {
    route: 'GET /api/v2/channels/asc/:instanceId/webhook',
    class: 'public-by-contract',
    justification:
      'ASC webhook verification challenge (Meta-style). Auth-exempt because the gateway sends no credential; ' +
      'the handler compares hub.verify_token against the instance-held webhook verify token (when configured) ' +
      'and echoes back the hub.challenge nonce the caller itself supplied. It reveals only whether the token ' +
      'matched — a configuration fact, not tenant data.',
  },
  {
    route: 'POST /api/v2/webhooks/ingress/:source',
    class: 'public-by-contract',
    justification:
      'Generic webhook ingress (issue #928). Auth-exempt because third-party senders (GitHub/Stripe-class) hold ' +
      'no omni credential; authenticity is the per-source signature contract (HMAC over the raw body or token ' +
      'match) verified against the server-held, per-tenant-sealed secret BEFORE anything is published. A source ' +
      'is reachable here only after an administrative act configured its signature_config — sources are never ' +
      'auto-created on this surface. All rejections (unknown source, disabled, unconfigured, bad signature) ' +
      'collapse into a single 401 shape so the endpoint is not a source-name existence oracle, and the surface ' +
      'is IP-rate-limited. The tenant, when one applies, comes from the server-side webhook_sources row, never ' +
      'from a request claim. Responses carry only the generated event id and echo of the source name. ' +
      'ACCEPTED LIMITATION: the signature covers the body only — no timestamp tolerance or delivery-id dedupe — ' +
      'so a captured signed request can be replayed within the rate limit; consumers of custom.webhook.* events ' +
      'must treat deliveries as at-least-once, exactly as they already must for provider-side webhook retries.',
  },
  {
    route: 'GET /api/v2/channels/whatsapp-business/webhook',
    class: 'public-by-contract',
    justification:
      "Meta webhook verification challenge. Auth-exempt because Meta's servers send no credential; the handler " +
      'compares hub.verify_token against the server-held META_VERIFY_TOKEN and echoes back the hub.challenge ' +
      'nonce Meta itself supplied. It reads no rows and reveals only whether the deployment-level verify token ' +
      'matched — a configuration fact, not tenant data.',
  },
  {
    route: 'POST /api/v2/channels/whatsapp-business/webhook',
    class: 'public-by-contract',
    justification:
      "Meta Cloud API callback. Auth-exempt for Meta's servers; authenticity is the X-Hub-Signature-256 HMAC the " +
      'plugin verifies against the server-held META_APP_SECRET over the raw body. The URL is global by Meta design ' +
      '(one callback per app, no :instanceId segment) — the instance, and therefore the tenant, is resolved from ' +
      'the server-side instance record matching the payload phone_number_id, never from a body or header tenant ' +
      'claim. Responses are fixed acks (200/401) and carry no row data; unknown phone_number_id still acks 200 ' +
      'so the surface is not a resource-existence oracle.',
  },
  {
    route: 'POST /api/v2/channels/whatsapp-business/flows/data/:instanceId',
    class: 'public-by-contract',
    justification:
      "WhatsApp Flows data-exchange endpoint. Auth-exempt for Meta's servers; authenticity is double: the " +
      'X-Hub-Signature-256 HMAC verified against the server-held META_APP_SECRET over the raw body (432 on ' +
      'mismatch), and RSA-OAEP payload encryption — only the private key registered for the :instanceId row can ' +
      'decrypt the request (421 otherwise), so a forged path yields nothing. The tenant comes from the ' +
      'server-side instance record addressed by the path (the Gupshup/Twilio per-instance precedent); the ' +
      'private key is unsealed server-side via openCredentialField under that record’s tenant. Responses are ' +
      'AES-GCM-encrypted screen payloads readable only by the requesting WhatsApp client, or bare status codes ' +
      '(404/421/427/432) that reveal no row data.',
  },
  // ── Frozen legacy aliases of the whatsapp-business public surface ──────────
  // The channel was renamed whatsapp-cloud → whatsapp-business; these URLs are
  // pasted into Meta App dashboards (webhook) and registered as flow
  // endpoint_uri values (flows/data) by existing customers, so the old paths
  // stay registered PERMANENTLY, bound to the exact same handlers.
  {
    route: 'GET /api/v2/channels/whatsapp-cloud/webhook',
    class: 'public-by-contract',
    justification:
      'Frozen legacy alias of GET /api/v2/channels/whatsapp-business/webhook (same handler reference, zero added ' +
      'surface). See the canonical entry for the full contract justification.',
  },
  {
    route: 'POST /api/v2/channels/whatsapp-cloud/webhook',
    class: 'public-by-contract',
    justification:
      'Frozen legacy alias of POST /api/v2/channels/whatsapp-business/webhook (same handler reference, zero added ' +
      'surface). See the canonical entry for the full contract justification.',
  },
  {
    route: 'POST /api/v2/channels/whatsapp-cloud/flows/data/:instanceId',
    class: 'public-by-contract',
    justification:
      'Frozen legacy alias of POST /api/v2/channels/whatsapp-business/flows/data/:instanceId (same handler ' +
      'reference, zero added surface). Pre-rename flows carry this path in their Meta-side endpoint_uri.',
  },
  {
    route: 'ALL /api/v2/instances/:instanceId/whatsapp-cloud/*',
    class: 'public-by-contract',
    justification:
      'Legacy REST alias: rewrites the path segment to /whatsapp-business/ and re-dispatches through the full ' +
      'pipeline — the INNER canonical route enforces auth, scopes and ownership; this catch-all only rewrites the ' +
      'URL and can serve nothing by itself. Kept permanently for pre-rename API consumers.',
  },
];

/**
 * ADR-0005 control plane. Mounted only under `OMNI_MULTITENANCY_ENABLED=true`,
 * behind its own platform-class guard, deliberately bypassing the legacy bearer
 * middleware so a tenant or legacy key can never address it.
 */
const PLATFORM_ADMIN_JUSTIFICATION =
  'ADR-0005 platform tenant lifecycle. Requires a platform-class credential; a tenant-class credential ' +
  'cannot reach this surface at all, and per-tenant data access from it goes through the same forced-RLS ' +
  'boundary bound to ONE audited target tenant (platform-target-tenant.ts).';

/**
 * Auth-plane and host-identity surface (ADR-0003). These operate on credentials
 * and host trust records rather than on tenant business data.
 */
const CONTROL_PLANE_ROUTE_JUSTIFICATIONS: readonly RouteOwnershipDeclaration[] = [
  {
    route: 'POST /api/v2/auth/validate',
    class: 'control-plane',
    justification:
      'Credential introspection. Returns ONLY facts about the caller’s own authenticated context — ' +
      'credential class, tenant id/slug, role, scopes, constraints, expiry — and never a secret, hash, or key ' +
      'material, and never another principal’s context. Reads no tenant business data. Also carries the ' +
      'deployment-level tenancy posture (three flags, nothing tenant-enumerating; issue #982), which is why ' +
      'this stays the ONE authenticated surface that says which world the server is in.',
  },
];

const KEY_ROUTE_JUSTIFICATION =
  'ADR-0003 auth plane. Key listing/creation/revocation operates on the credential index, not on tenant ' +
  'business data, and crosses into the auth plane through the transactionally enforced service boundary ' +
  '(tenant-keys.ts, transactional-auth.ts) with actor freshness re-validated under row locks. Child keys are ' +
  'same-tenant only and cannot exceed the parent scope/expiry/role ceiling.';

const TRUST_ROUTE_JUSTIFICATION =
  'Genie host fingerprint trust registry. Host identity is deployment-level infrastructure with no tenant_id ' +
  'column and no ownership spec (it is not one of the G2 tenant tables); it establishes WHICH HOST may sign ' +
  'a request, which is a pre-tenant question by construction.';

/**
 * Tenant-scoped surface: every route that serves tenant business data.
 *
 * Listed as bare route keys because the class itself is the declaration — a
 * tenant-scoped route needs no exception rationale, it needs conversion. The
 * db-access guard's `pending-G4-conversion` count is the companion measure of
 * how much of this list still reaches the database outside the boundary.
 */
const TENANT_SCOPED_ROUTES: readonly RouteKey[] = [
  'DELETE /api/v2/:id',
  'DELETE /api/v2/access/rules/:id',
  'DELETE /api/v2/agent-tasks/:id',
  'DELETE /api/v2/agents/:id',
  'DELETE /api/v2/automations/:id',
  'DELETE /api/v2/channels/harness/:instanceId/transcript',
  'DELETE /api/v2/chats/:id',
  'DELETE /api/v2/chats/:id/label',
  'DELETE /api/v2/chats/:id/participants/:platformUserId',
  'DELETE /api/v2/context',
  'DELETE /api/v2/conversations/:id',
  'DELETE /api/v2/event-ops/replay/:id',
  'DELETE /api/v2/events/:eventId/payloads',
  'DELETE /api/v2/events/consumers/:name',
  'DELETE /api/v2/follow-up/agents/:id',
  'DELETE /api/v2/follow-up/chats/:id',
  'DELETE /api/v2/follow-up/instances/:id',
  'DELETE /api/v2/instances/:id',
  'DELETE /api/v2/instances/:id/block',
  'DELETE /api/v2/instances/:id/guilds/:guildId/config',
  'DELETE /api/v2/instances/:id/profile/picture',
  'DELETE /api/v2/instances/:id/whatsapp-business/connection',
  'DELETE /api/v2/instances/:id/whatsapp-flows/:flowId',
  'DELETE /api/v2/instances/:id/whatsapp-templates/:templateId',
  'DELETE /api/v2/instances/:instanceId/routes/:id',
  'DELETE /api/v2/messages/:id',
  'DELETE /api/v2/messages/:id/reactions',
  'DELETE /api/v2/messages/:id/star',
  'DELETE /api/v2/providers/:id',
  'DELETE /api/v2/scheduled-messages/:id',
  'DELETE /api/v2/settings/:key',
  'DELETE /api/v2/webhook-sources/:id',
  'GET /api/v2',
  'GET /api/v2/:id',
  'GET /api/v2/:id/logs',
  'GET /api/v2/a2a/agents',
  'GET /api/v2/a2a/agents/:agentId/card',
  'GET /api/v2/access',
  'GET /api/v2/access/rules',
  'GET /api/v2/access/rules/:id',
  'GET /api/v2/agent-state/:agentId/:chatId',
  'GET /api/v2/agent-state/stream',
  'GET /api/v2/agent-tasks',
  'GET /api/v2/agent-tasks/:id',
  'GET /api/v2/agents',
  'GET /api/v2/agents/:id',
  'GET /api/v2/agents/:id/identities',
  'GET /api/v2/agents/:id/manifest',
  'GET /api/v2/agents/:id/tasks',
  'GET /api/v2/automation-logs',
  'GET /api/v2/automation-metrics',
  'GET /api/v2/automations',
  'GET /api/v2/automations/:id',
  'GET /api/v2/automations/:id/logs',
  'GET /api/v2/automations/automation-logs',
  'GET /api/v2/automations/automation-metrics',
  'GET /api/v2/batch-jobs',
  'GET /api/v2/batch-jobs/:id',
  'GET /api/v2/batch-jobs/:id/status',
  'GET /api/v2/channels/capabilities',
  'GET /api/v2/channels/harness/:instanceId/transcript',
  'GET /api/v2/chats',
  'GET /api/v2/chats/:id',
  'GET /api/v2/chats/:id/messages',
  'GET /api/v2/chats/:id/participants',
  'GET /api/v2/chats/by-external',
  'GET /api/v2/context',
  'GET /api/v2/conversations',
  'GET /api/v2/conversations/:id',
  'GET /api/v2/conversations/:id/chats',
  'GET /api/v2/dead-letters',
  'GET /api/v2/dead-letters/:id',
  'GET /api/v2/dead-letters/stats',
  'GET /api/v2/event-ops',
  'GET /api/v2/event-ops/metrics',
  'GET /api/v2/event-ops/replay',
  'GET /api/v2/event-ops/replay/:id',
  'GET /api/v2/events',
  'GET /api/v2/events/:eventId/payloads',
  'GET /api/v2/events/:eventId/payloads/:stage',
  'GET /api/v2/events/:id',
  'GET /api/v2/events/:id/trace',
  'GET /api/v2/events/analytics',
  'GET /api/v2/events/by-sender/:senderId',
  'GET /api/v2/events/consumers',
  'GET /api/v2/events/consumers/:name',
  'GET /api/v2/events/consumers/:name/stream',
  'GET /api/v2/events/schemas',
  'GET /api/v2/events/schemas/:eventType',
  'GET /api/v2/events/timeline/:personId',
  'GET /api/v2/events/types',
  'GET /api/v2/follow-up/agents/:id',
  'GET /api/v2/follow-up/chats/:id',
  'GET /api/v2/follow-up/instances/:id',
  'GET /api/v2/handoffs',
  'GET /api/v2/handoffs/:id',
  'GET /api/v2/instances',
  'GET /api/v2/instances/:id',
  'GET /api/v2/instances/:id/blocklist',
  'GET /api/v2/instances/:id/chats/:chatId/invite',
  'GET /api/v2/instances/:id/contacts',
  'GET /api/v2/instances/:id/groups',
  'GET /api/v2/instances/:id/groups/:groupJid/invite',
  'GET /api/v2/instances/:id/groups/:jid/members',
  'GET /api/v2/instances/:id/guilds',
  'GET /api/v2/instances/:id/guilds/:guildId/audit',
  'GET /api/v2/instances/:id/guilds/:guildId/config',
  'GET /api/v2/instances/:id/pairing-requests',
  'GET /api/v2/instances/:id/passkey',
  'GET /api/v2/instances/:id/privacy',
  'GET /api/v2/instances/:id/qr',
  'GET /api/v2/instances/:id/self',
  'GET /api/v2/instances/:id/self/chats',
  'GET /api/v2/instances/:id/status',
  'GET /api/v2/instances/:id/sync',
  'GET /api/v2/instances/:id/sync/:jobId',
  'GET /api/v2/instances/:id/users/:userId/profile',
  'GET /api/v2/instances/:id/whatsapp-business/analytics',
  'GET /api/v2/instances/:id/whatsapp-business/connection',
  'GET /api/v2/instances/:id/whatsapp-business/profile',
  'GET /api/v2/instances/:id/whatsapp-business/quality',
  'GET /api/v2/instances/:id/whatsapp-flows',
  'GET /api/v2/instances/:id/whatsapp-flows/:flowId',
  'GET /api/v2/instances/:id/whatsapp-flows/:flowId/preview',
  'GET /api/v2/instances/:id/whatsapp-flows/keys',
  'GET /api/v2/instances/:id/whatsapp-templates',
  'GET /api/v2/instances/:id/whatsapp-templates/:templateId',
  'GET /api/v2/instances/:instanceId/routes',
  'GET /api/v2/instances/:instanceId/routes/:id',
  'GET /api/v2/instances/supported-channels',
  'GET /api/v2/journeys/:correlationId',
  'GET /api/v2/journeys/summary',
  'GET /api/v2/media/:instanceId/*',
  'GET /api/v2/messages',
  'GET /api/v2/messages/:id',
  'GET /api/v2/messages/:id/permalink',
  'GET /api/v2/messages/by-external',
  'GET /api/v2/messages/tts/voices',
  'GET /api/v2/payload-config',
  'GET /api/v2/payload-stats',
  'GET /api/v2/persons',
  'GET /api/v2/persons/:id',
  'GET /api/v2/persons/:id/presence',
  'GET /api/v2/persons/:id/timeline',
  'GET /api/v2/processed-events',
  'GET /api/v2/providers',
  'GET /api/v2/providers/:id',
  'GET /api/v2/providers/:id/agents',
  'GET /api/v2/providers/:id/teams',
  'GET /api/v2/providers/:id/workflows',
  'GET /api/v2/routes/metrics',
  'GET /api/v2/scheduled-messages',
  'GET /api/v2/scheduled-messages/:id',
  'GET /api/v2/settings',
  'GET /api/v2/settings/:key',
  'GET /api/v2/settings/:key/history',
  'GET /api/v2/slack/app',
  'GET /api/v2/slack/oauth/result/:nonce',
  'GET /api/v2/slack/search',
  'GET /api/v2/turns',
  'GET /api/v2/turns/:id',
  'GET /api/v2/turns/stats',
  'GET /api/v2/voice/sessions',
  'GET /api/v2/voice/sessions/:id',
  'GET /api/v2/webhook-sources',
  'GET /api/v2/webhook-sources/:id',
  'PATCH /api/v2/:id',
  'PATCH /api/v2/access/rules/:id',
  'PATCH /api/v2/agent-tasks/:id',
  'PATCH /api/v2/agents/:id',
  'PATCH /api/v2/automations/:id',
  'PATCH /api/v2/chats/:id',
  'PATCH /api/v2/chats/:id/participants/:platformUserId/role',
  'PATCH /api/v2/conversations/:id',
  'PATCH /api/v2/instances/:id',
  'PATCH /api/v2/instances/:id/groups/:groupJid',
  'PATCH /api/v2/instances/:id/groups/:groupJid/participants',
  'PATCH /api/v2/instances/:instanceId/routes/:id',
  'PATCH /api/v2/messages/:id',
  'PATCH /api/v2/messages/:id/delivery-status',
  'PATCH /api/v2/messages/:id/document-extraction',
  'PATCH /api/v2/messages/:id/image-description',
  'PATCH /api/v2/messages/:id/transcription',
  'PATCH /api/v2/messages/:id/video-description',
  'PATCH /api/v2/persons/:id',
  'PATCH /api/v2/providers/:id',
  'PATCH /api/v2/settings',
  'PATCH /api/v2/webhook-sources/:id',
  'POST /a2a/:instanceId',
  'POST /api/v2',
  'POST /api/v2/:id/disable',
  'POST /api/v2/:id/enable',
  'POST /api/v2/:id/execute',
  'POST /api/v2/:id/test',
  'POST /api/v2/access/check',
  'POST /api/v2/access/rules',
  'POST /api/v2/instances/:id/self/history',
  'POST /api/v2/instances/:id/self/messages',
  'POST /api/v2/instances/:id/self/receipt',
  'POST /api/v2/messages/send-self',
  'POST /api/v2/agent-tasks',
  'POST /api/v2/agents',
  'POST /api/v2/agents/:id/identities/link',
  'POST /api/v2/automations',
  'POST /api/v2/automations/:id/disable',
  'POST /api/v2/automations/:id/enable',
  'POST /api/v2/automations/:id/execute',
  'POST /api/v2/automations/:id/test',
  'POST /api/v2/batch-jobs',
  'POST /api/v2/batch-jobs/:id/cancel',
  'POST /api/v2/batch-jobs/estimate',
  'POST /api/v2/channels/harness/:instanceId/say',
  'POST /api/v2/channels/harness/:instanceId/tap',
  'POST /api/v2/chats',
  'POST /api/v2/chats/:id/archive',
  'POST /api/v2/chats/:id/disappearing',
  'POST /api/v2/chats/:id/hide',
  'POST /api/v2/chats/:id/label',
  'POST /api/v2/chats/:id/mute',
  'POST /api/v2/chats/:id/participants',
  'POST /api/v2/chats/:id/pin',
  'POST /api/v2/chats/:id/read',
  'POST /api/v2/chats/:id/reopen-contact',
  'POST /api/v2/chats/:id/unarchive',
  'POST /api/v2/chats/:id/unhide',
  'POST /api/v2/chats/:id/unmute',
  'POST /api/v2/chats/:id/unpin',
  'POST /api/v2/chats/clear-session',
  'POST /api/v2/chats/sync-names',
  'POST /api/v2/context',
  'POST /api/v2/context/use',
  'POST /api/v2/conversations',
  'POST /api/v2/dead-letters/:id/abandon',
  'POST /api/v2/dead-letters/:id/resolve',
  'POST /api/v2/dead-letters/:id/retry',
  'POST /api/v2/event-ops/replay',
  'POST /api/v2/event-ops/scheduled',
  'POST /api/v2/events/consumers',
  'POST /api/v2/events/consumers/:name/ack',
  'POST /api/v2/events/consumers/:name/pull',
  'POST /api/v2/events/schemas',
  'POST /api/v2/events/schemas/:eventType/validate',
  'POST /api/v2/events/search',
  'POST /api/v2/events/trigger',
  'POST /api/v2/instances',
  'POST /api/v2/instances/:id/block',
  'POST /api/v2/instances/:id/calls/reject',
  'POST /api/v2/instances/:id/check-number',
  'POST /api/v2/instances/:id/connect',
  'POST /api/v2/instances/:id/disconnect',
  'POST /api/v2/instances/:id/groups',
  'POST /api/v2/instances/:id/groups/:groupJid/description',
  'POST /api/v2/instances/:id/groups/:groupJid/invite/revoke',
  'POST /api/v2/instances/:id/groups/:groupJid/leave',
  'POST /api/v2/instances/:id/groups/:groupJid/participants',
  'POST /api/v2/instances/:id/groups/:groupJid/participants/:action',
  'POST /api/v2/instances/:id/groups/:groupJid/settings',
  'POST /api/v2/instances/:id/groups/:groupJid/subject',
  'POST /api/v2/instances/:id/groups/join',
  'POST /api/v2/instances/:id/logout',
  'POST /api/v2/instances/:id/pair',
  'POST /api/v2/instances/:id/passkey/confirm',
  'POST /api/v2/instances/:id/passkey/response',
  'POST /api/v2/instances/:id/pairing-requests/:requestId/action',
  'POST /api/v2/instances/:id/replay',
  'POST /api/v2/instances/:id/restart',
  'POST /api/v2/instances/:id/resync',
  'POST /api/v2/instances/:id/sync',
  'POST /api/v2/instances/:id/sync/:jobId/cancel',
  'POST /api/v2/instances/:id/sync/profile',
  'POST /api/v2/instances/:id/whatsapp-business/connect',
  'POST /api/v2/instances/:id/whatsapp-business/oauth/exchange',
  'POST /api/v2/instances/:id/whatsapp-business/profile/photo',
  'POST /api/v2/instances/:id/whatsapp-business/register',
  'POST /api/v2/instances/:id/whatsapp-business/subscribe-app',
  'POST /api/v2/instances/:id/whatsapp-flows',
  'POST /api/v2/instances/:id/whatsapp-flows/:flowId/deprecate',
  'POST /api/v2/instances/:id/whatsapp-flows/:flowId/publish',
  'POST /api/v2/instances/:id/whatsapp-flows/keys',
  'POST /api/v2/instances/:id/whatsapp-flows/send',
  'POST /api/v2/instances/:id/whatsapp-templates',
  'POST /api/v2/instances/:id/whatsapp-templates/:templateId/send-test',
  'POST /api/v2/instances/:id/whatsapp-templates/:templateName/send',
  'POST /api/v2/instances/:id/whatsapp-templates/upload-header-media',
  'POST /api/v2/instances/:instanceId/routes',
  'POST /api/v2/media/film',
  'POST /api/v2/media/imagine',
  'POST /api/v2/media/music',
  'POST /api/v2/media/stt',
  'POST /api/v2/media/tts',
  'POST /api/v2/media/vision',
  'POST /api/v2/messages',
  'POST /api/v2/messages/:id/edit',
  'POST /api/v2/messages/:id/reactions',
  'POST /api/v2/messages/:id/read',
  'POST /api/v2/messages/:id/star',
  'POST /api/v2/messages/delete-channel',
  'POST /api/v2/messages/edit-channel',
  'POST /api/v2/messages/media/download',
  'POST /api/v2/messages/read',
  'POST /api/v2/messages/send',
  'POST /api/v2/messages/send/close-contact',
  'POST /api/v2/messages/send/contact',
  'POST /api/v2/messages/send/embed',
  'POST /api/v2/messages/send/forward',
  'POST /api/v2/messages/send/handoff',
  'POST /api/v2/messages/send/location',
  'POST /api/v2/messages/send/media',
  'POST /api/v2/messages/send/poll',
  'POST /api/v2/messages/send/presence',
  'POST /api/v2/messages/send/reaction',
  'POST /api/v2/messages/send/sticker',
  'POST /api/v2/messages/send/tts',
  'POST /api/v2/persons/link',
  'POST /api/v2/persons/merge',
  'POST /api/v2/persons/unlink',
  'POST /api/v2/providers',
  'POST /api/v2/providers/:id/health',
  'POST /api/v2/scheduled-messages',
  'POST /api/v2/slack/dm/open',
  'POST /api/v2/slack/oauth/start',
  'POST /api/v2/turns/:id/close',
  'POST /api/v2/turns/close',
  'POST /api/v2/turns/close-all',
  'POST /api/v2/voice/join',
  'POST /api/v2/voice/leave',
  'POST /api/v2/webhook-sources',
  'POST /api/v2/webhook-sources/:id/run-now',
  'POST /api/v2/webhooks/:source',
  'POST /api/v2/webhooks/:source/heartbeat',
  'PUT /api/v2/agent-state/:agentId/:chatId',
  'PUT /api/v2/agents/:id/manifest',
  'PUT /api/v2/follow-up/agents/:id',
  'PUT /api/v2/follow-up/chats/:id',
  'PUT /api/v2/follow-up/instances/:id',
  'PUT /api/v2/instances/:id/groups/:groupJid/description',
  'PUT /api/v2/instances/:id/groups/:groupJid/picture',
  'PUT /api/v2/instances/:id/groups/:groupJid/subject',
  'PUT /api/v2/instances/:id/guilds/:guildId/config',
  'PUT /api/v2/instances/:id/presence',
  'PUT /api/v2/instances/:id/profile/name',
  'PUT /api/v2/instances/:id/profile/picture',
  'PUT /api/v2/instances/:id/profile/status',
  'PUT /api/v2/instances/:id/whatsapp-business/profile',
  'PUT /api/v2/instances/:id/whatsapp-flows/:flowId',
  'PUT /api/v2/payload-config/:eventType',
  'PUT /api/v2/settings/:key',
];

const PLATFORM_ADMIN_ROUTES: readonly RouteKey[] = [
  'GET /api/v2/platform/tenants',
  'GET /api/v2/platform/tenants/:id',
  'GET /api/v2/platform/tenants/:id/memberships',
  'POST /api/v2/platform/tenants',
  'POST /api/v2/platform/tenants/:id/archive',
  'POST /api/v2/platform/tenants/:id/keys/root',
  'POST /api/v2/platform/tenants/:id/memberships',
  'POST /api/v2/platform/tenants/:id/suspend',
  'POST /api/v2/platform/tenants/:tenantId/memberships/:id/disable',
  'POST /api/v2/platform/tenants/:tenantId/memberships/:id/role',
  'POST /api/v2/platform/tenants/:tenantId/memberships/:id/status',
];

const KEY_ROUTES: readonly RouteKey[] = [
  'DELETE /api/v2/keys/:id',
  'GET /api/v2/keys',
  'GET /api/v2/keys/:id',
  'GET /api/v2/keys/:id/audit',
  'PATCH /api/v2/keys/:id',
  'POST /api/v2/keys',
  'POST /api/v2/keys/:id/revoke',
  // Chat keys (wish: omni-chat-threads): a legacy root key's own cs children.
  // Control-plane and never tenant-addressable: a tenant credential is refused
  // here before the route runs.
  'POST /api/v2/keys/children',
  'POST /api/v2/keys/children/self/revoke',
  'POST /api/v2/keys/children/:id/revoke',
];

const TRUST_ROUTES: readonly RouteKey[] = [
  'DELETE /api/v2/trust/hosts/:id',
  'GET /api/v2/trust/hosts',
  'GET /api/v2/trust/hosts/:id',
  'PATCH /api/v2/trust/hosts/:id',
  'POST /api/v2/trust/handshake',
];

/**
 * Observability read surface (OWNERSHIP_MANIFEST `metrics_observability`,
 * disposition: platform). Its evidence list names exactly these implementations
 * — `routes/v2/metrics.ts` and the `core/src/logger/buffer.ts` ring buffer these
 * log routes read — so the disposition is decided at G0, not deferred to G5.
 *
 * What G5 still owns is the SINK: bounded tenant labels, redaction, and the
 * audit/trace tenant context. That is a conversion question. Who may reach the
 * endpoint is an ownership question, and it is this gate's to answer.
 */
const OBSERVABILITY_ROUTES: readonly RouteKey[] = [
  'GET /api/v2/audit',
  'GET /api/v2/audit/:id',
  'GET /api/v2/logs/recent',
  'GET /api/v2/logs/stream',
  'GET /api/v2/metrics',
];

/**
 * This Omni's own version and the updates its owner confirms (system/update.ts). One server
 * binary serves every tenant, so its version and its update are deployment-level, never a
 * tenant's: a tenant credential must not reach them.
 */
const SYSTEM_UPDATE_ROUTES: readonly RouteKey[] = ['GET /api/v2/system/update', 'POST /api/v2/system/update'];

const SYSTEM_UPDATE_JUSTIFICATION =
  "The deployment's own version and its update. GET says what runs, what the update channel publishes and " +
  'whether an update waits or runs; it reads no tenant row. POST needs OMNI_UPDATE_COMMAND set by the operator ' +
  "and the exact published version; it then asks for the owner's yes in their own WhatsApp self chat before the " +
  'operator command runs, except on a loopback-only Omni whose operator set OMNI_UPDATE_CONFIRM=app (a sandbox), ' +
  'where the request is the yes. Deployment-wide by nature, so platform-admin.';

/**
 * The operator's way in (routes/v2/owner.ts): claim the deployment, approve a device, mint a
 * connect link. Deployment-wide, behind auth:admin, which device keys never carry.
 */
const OWNER_ROUTES: readonly RouteKey[] = [
  'POST /api/v2/owner/claim',
  'POST /api/v2/owner/approve',
  'POST /api/v2/owner/connect',
];

const OWNER_JUSTIFICATION =
  "The deployment's human login, run by its operator: make the admin key's holder the owner of an unclaimed " +
  'Omni, approve a waiting device code as that owner, or mint a one-time connect link. Needs auth:admin, which ' +
  'device keys can never carry; answers 409 when login is off (always with multitenancy on). It reads no tenant ' +
  'row. Deployment-wide by nature, so platform-admin.';

const OBSERVABILITY_JUSTIFICATION =
  'Process-level observability aggregated across every tenant the deployment serves: Prometheus counters and ' +
  'the in-process log ring buffer. There is no per-tenant row to scope, and the values themselves are ' +
  'cross-tenant, so `tenant-scoped` would be false and `control-plane` would understate the exposure. ' +
  'OWNERSHIP_MANIFEST class `metrics_observability` fixes the disposition as platform, with verification ' +
  'target "metrics do not leak per-tenant existence" — hence platform-admin: a tenant-class credential ' +
  'cannot address it. G5 still owns the sink-side work (bounded tenant labels, redaction, audit/trace ' +
  'tenant context); this declaration settles reachability, which is what the coverage gate asks.';

/** The committed registry the gate checks against. */
export const ROUTE_OWNERSHIP: readonly RouteOwnershipDeclaration[] = [
  ...TENANT_SCOPED_ROUTES.map((route) => ({ route, class: 'tenant-scoped' as const })),
  ...PLATFORM_ADMIN_ROUTES.map((route) => ({
    route,
    class: 'platform-admin' as const,
    justification: PLATFORM_ADMIN_JUSTIFICATION,
  })),
  ...CONTROL_PLANE_ROUTE_JUSTIFICATIONS,
  ...KEY_ROUTES.map((route) => ({
    route,
    class: 'control-plane' as const,
    justification: KEY_ROUTE_JUSTIFICATION,
  })),
  ...TRUST_ROUTES.map((route) => ({
    route,
    class: 'control-plane' as const,
    justification: TRUST_ROUTE_JUSTIFICATION,
  })),
  ...OBSERVABILITY_ROUTES.map((route) => ({
    route,
    class: 'platform-admin' as const,
    justification: OBSERVABILITY_JUSTIFICATION,
  })),
  ...SYSTEM_UPDATE_ROUTES.map((route) => ({
    route,
    class: 'platform-admin' as const,
    justification: SYSTEM_UPDATE_JUSTIFICATION,
  })),
  ...OWNER_ROUTES.map((route) => ({
    route,
    class: 'platform-admin' as const,
    justification: OWNER_JUSTIFICATION,
  })),
  ...PUBLIC_PRIVACY_CONTRACTS,
];

/**
 * Routes G4 has NOT yet been able to declare honestly, each with the question
 * that has to be answered first.
 *
 * This list EXISTS TO SHRINK. It is an explicit inventory rather than a count
 * so a newly added route cannot fall into it: a new route is simply undeclared,
 * and undeclared is a hard failure.
 *
 * NOW EMPTY: every registered route carries an explicit declaration. The last
 * three entries were the observability read surface (metrics + the two log-ring
 * routes), closed against OWNERSHIP_MANIFEST `metrics_observability`
 * (disposition: platform) rather than deferred — see OBSERVABILITY_JUSTIFICATION.
 *
 * Keep the type and the ceiling even at zero: they are what makes the NEXT
 * unplaceable route state its open question in writing instead of quietly
 * acquiring a wrong class.
 */
export const UNDECLARED_ACKNOWLEDGED: readonly AcknowledgedUndeclaredRoute[] = [];

/**
 * Ceiling for the acknowledged list, fixed at the end of the G4 leg that set it.
 *
 * The gate fails when the acknowledged list EXCEEDS this. It does not fail when
 * the list shrinks: lower the ceiling with it so the ratchet keeps its grip.
 * G4 is complete when this reaches 0.
 *
 * It has reached 0. At zero the ratchet is at its stop: any future acknowledged
 * entry exceeds the ceiling and fails the gate, so an undeclarable route can no
 * longer be parked here — it must be declared or the ceiling must be raised in
 * a reviewed commit, which is exactly the conversation that should happen.
 */
export const UNDECLARED_ACKNOWLEDGED_CEILING = 0;

// ---------------------------------------------------------------------------
// Runtime consumption: what a tenant credential may address
// ---------------------------------------------------------------------------

/**
 * The ONLY non-`tenant-scoped` routes a tenant-class credential may address.
 *
 * Both are control-plane routes that operate on the CALLER'S OWN credential
 * lineage and nothing else, which is why they are exceptions rather than holes:
 *
 *   * `POST /api/v2/auth/validate` returns facts about the caller's own
 *     authenticated context only. A credential that cannot introspect itself
 *     cannot be used by any client that needs to know its own tenant or role.
 *   * `POST /api/v2/keys` is intercepted for a tenant credential and routed to
 *     `handleTenantChildCreate` (routes/v2/keys.ts), which mints a same-tenant
 *     child bounded by the parent's scope/expiry/role ceiling. The legacy
 *     create path is never reached by a tenant credential.
 *
 * Every OTHER `/keys` verb — list, read, patch, revoke, delete, audit — is
 * deliberately absent. Those operate on the deployment-wide `api_keys` table,
 * which has no tenant column and no RLS, so `keys:write` on `POST
 * /keys/:id/revoke` would let a tenant-admin revoke the operator master key.
 * Tenant key lifecycle belongs to the tenant-keys service, not to this router.
 */
const TENANT_ADDRESSABLE_CONTROL_PLANE: readonly RouteKey[] = Object.freeze([
  'POST /api/v2/auth/validate',
  'POST /api/v2/keys',
]);

const OWNERSHIP_BY_ROUTE: ReadonlyMap<RouteKey, RouteOwnershipClass> = new Map(
  ROUTE_OWNERSHIP.map((d) => [d.route, d.class]),
);

const TENANT_ADDRESSABLE_ROUTES: ReadonlySet<RouteKey> = new Set<RouteKey>([
  ...ROUTE_OWNERSHIP.filter((d) => d.class === 'tenant-scoped').map((d) => d.route),
  ...TENANT_ADDRESSABLE_CONTROL_PLANE,
]);

/**
 * The declared class of a route, or `undefined` when the route carries no
 * declaration.
 *
 * `undefined` is not "allowed": callers must treat it as a refusal. The
 * coverage gate holds the undeclared count at zero, so in a passing build the
 * only way to reach `undefined` is a route that was added without a
 * declaration — exactly the case that must fail closed.
 */
export function resolveRouteOwnership(route: RouteKey): RouteOwnershipClass | undefined {
  return OWNERSHIP_BY_ROUTE.get(route);
}

/** Whether a tenant-class credential may address this route at all. */
export function isTenantAddressableRoute(route: RouteKey): boolean {
  return TENANT_ADDRESSABLE_ROUTES.has(route);
}

/**
 * The legacy scope a declared route requires, or `undefined` when the route is
 * outside `SCOPE_MAP` (the A2A surface, the bare `/api/v2` roots, the
 * unauthenticated routes — none of which the scope enforcer consults).
 */
function requiredScopeForRoute(route: RouteKey): string | undefined {
  const space = route.indexOf(' ');
  if (space === -1) return undefined;
  const method = route.slice(0, space);
  const path = route.slice(space + 1);
  if (!path.startsWith('/api/v2')) return undefined;
  const stripped = path.slice('/api/v2'.length);
  return SCOPE_MAP[`${method} ${stripped === '' ? '/' : stripped}`];
}

/**
 * Every legacy scope that a tenant-addressable route actually requires.
 *
 * This is the projection's source of truth (`scope-projection.ts`). Deriving it
 * from the ownership table rather than from all of `SCOPE_MAP` is what stops a
 * tenant credential from being handed authority over a surface this table
 * declares platform-admin or control-plane: `metrics:read`, `logs:read`, and
 * `trust:read`/`trust:write` are required ONLY by such routes, so they simply
 * are not in this set.
 */
export const TENANT_ADDRESSABLE_SCOPES: readonly string[] = Object.freeze(
  [
    ...new Set(
      [...TENANT_ADDRESSABLE_ROUTES].map((route) => requiredScopeForRoute(route)).filter((s): s is string => s != null),
    ),
  ].sort(),
);
