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
    route: 'GET /favicon.svg',
    class: 'public-by-contract',
    justification:
      'Static browser icon from the built UI bundle (registered only when apps/ui/dist exists, or under the ' +
      'enumeration-only OMNI_FORCE_UI_ROUTES override). Serves a fixed asset file byte-for-byte. Exposes NO ' +
      'tenant data, inventory, identifiers, or connection state — the response is identical for every caller.',
  },
  {
    route: 'GET /favicon.ico',
    class: 'public-by-contract',
    justification:
      'Static browser icon from the built UI bundle (registered only when apps/ui/dist exists, or under the ' +
      'enumeration-only OMNI_FORCE_UI_ROUTES override). Serves a fixed asset file byte-for-byte. Exposes NO ' +
      'tenant data, inventory, identifiers, or connection state — the response is identical for every caller.',
  },
  {
    route: 'GET /*',
    class: 'public-by-contract',
    justification:
      'SPA fallback for the built UI: serves the static index.html for any non-/api path so client-side ' +
      'routing works, and returns a plain 404 JSON for unmatched /api paths. Registered only when apps/ui/dist ' +
      'exists (or under the enumeration-only OMNI_FORCE_UI_ROUTES override). The HTML is the same fixed bundle ' +
      'for every caller; it embeds NO tenant data, counts, identifiers, connection state, or existence oracle — ' +
      'all data the UI shows is fetched later through the authenticated /api surface.',
  },
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
    route: 'POST /api/v2/channels/twilio-whatsapp/:instanceId/webhook',
    class: 'public-by-contract',
    justification:
      "Twilio callback. Auth-exempt for Twilio's servers; authenticity is the X-Twilio-Signature the plugin " +
      'verifies against the server-held auth token, and the tenant comes from the server-side instance record ' +
      'addressed by the path.',
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
      'material, and never another principal’s context. Reads no tenant business data.',
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
  'DELETE /api/v2/chats/:id',
  'DELETE /api/v2/chats/:id/label',
  'DELETE /api/v2/chats/:id/participants/:platformUserId',
  'DELETE /api/v2/context',
  'DELETE /api/v2/conversations/:id',
  'DELETE /api/v2/event-ops/replay/:id',
  'DELETE /api/v2/events/:eventId/payloads',
  'DELETE /api/v2/follow-up/agents/:id',
  'DELETE /api/v2/follow-up/chats/:id',
  'DELETE /api/v2/follow-up/instances/:id',
  'DELETE /api/v2/instances/:id',
  'DELETE /api/v2/instances/:id/block',
  'DELETE /api/v2/instances/:id/guilds/:guildId/config',
  'DELETE /api/v2/instances/:id/profile/picture',
  'DELETE /api/v2/instances/:instanceId/routes/:id',
  'DELETE /api/v2/messages/:id',
  'DELETE /api/v2/messages/:id/reactions',
  'DELETE /api/v2/messages/:id/star',
  'DELETE /api/v2/providers/:id',
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
  'GET /api/v2/events/analytics',
  'GET /api/v2/events/by-sender/:senderId',
  'GET /api/v2/events/timeline/:personId',
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
  'GET /api/v2/instances/:id/privacy',
  'GET /api/v2/instances/:id/qr',
  'GET /api/v2/instances/:id/status',
  'GET /api/v2/instances/:id/sync',
  'GET /api/v2/instances/:id/sync/:jobId',
  'GET /api/v2/instances/:id/users/:userId/profile',
  'GET /api/v2/instances/:instanceId/routes',
  'GET /api/v2/instances/:instanceId/routes/:id',
  'GET /api/v2/instances/supported-channels',
  'GET /api/v2/journeys/:correlationId',
  'GET /api/v2/journeys/summary',
  'GET /api/v2/media/:instanceId/*',
  'GET /api/v2/messages',
  'GET /api/v2/messages/:id',
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
  'GET /api/v2/settings',
  'GET /api/v2/settings/:key',
  'GET /api/v2/settings/:key/history',
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
  'POST /api/v2/instances/:id/pairing-requests/:requestId/action',
  'POST /api/v2/instances/:id/replay',
  'POST /api/v2/instances/:id/restart',
  'POST /api/v2/instances/:id/resync',
  'POST /api/v2/instances/:id/sync',
  'POST /api/v2/instances/:id/sync/profile',
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
  'POST /api/v2/turns/:id/close',
  'POST /api/v2/turns/close',
  'POST /api/v2/turns/close-all',
  'POST /api/v2/voice/join',
  'POST /api/v2/voice/leave',
  'POST /api/v2/webhook-sources',
  'POST /api/v2/webhooks/:source',
  'PUT /api/v2/agent-state/:agentId/:chatId',
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
  'PUT /api/v2/payload-config/:eventType',
  'PUT /api/v2/settings/:key',
];

const PLATFORM_ADMIN_ROUTES: readonly RouteKey[] = [
  'GET /api/v2/platform/tenants',
  'GET /api/v2/platform/tenants/:id',
  'GET /api/v2/platform/tenants/:id/memberships',
  'POST /api/v2/platform/tenants',
  'POST /api/v2/platform/tenants/:id/archive',
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
  'GET /api/v2/logs/recent',
  'GET /api/v2/logs/stream',
  'GET /api/v2/metrics',
];

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
