/**
 * Egress architecture guard (wish: omni-full-multitenancy, Group G5; ADR-0009,
 * WISH "Tenant-controlled outbound egress").
 *
 * The machine-checkable half of ADR-0009's first enforcement layer: it fails the
 * build when a direct `fetch`/socket call site appears in a tenant-controlled
 * path outside the {@link TenantEgressBroker}. It is the exact sibling of the
 * database-access guard (`@omni/db` `tenancy-db-access-guard.ts`): a scanner, a
 * hand-classified registry, and a ratchet ceiling that may shrink but never grow.
 *
 * WHY A REGISTRY RATHER THAN A BAN
 * --------------------------------
 * The repository has raw `fetch` in three honestly-different situations:
 *   * TENANT-CONTROLLED egress (an automation's `config.url`, a provider
 *     `baseUrl`, a per-instance callback) — the SSRF surface. These must move
 *     behind the broker. Until they do they are `pending-egress-broker` DEBT,
 *     capped by {@link PENDING_EGRESS_CEILING}.
 *   * PLATFORM-VENDOR egress to a compile-time-fixed first-party/vendor host
 *     (Discord/Slack/Telegram/Twilio APIs, OpenAI/Groq/Gemini vendors, AWS STS).
 *     The tenant cannot influence the destination, so it is not the broker's
 *     concern — but it is named, not waved through.
 *   * The MEDIA guard (`safe-media-fetch.ts`), a transitional SSRF guard for
 *     channel-payload media URLs, and platform INFRA (the inbound Bun server
 *     handler, which is not egress at all).
 *
 * A site the scanner finds that the registry does not list fails the build. That
 * is the whole point: a new raw `fetch` in a tenant path cannot land silently.
 *
 * SCANNING PRECISION
 * ------------------
 * Only the GLOBAL `fetch(` counts — a method call like `client.channels.fetch()`
 * (discord.js) or `app.fetch(req)` (Hono) is a library call to a fixed API, not
 * outbound egress this guard governs, so the match requires no `.`/word char
 * before `fetch`. Comments are blanked first (English prose says "fetch the
 * user"), mirroring the db-guard's `stripComments`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export type EgressClass =
  /** Compile-time-fixed first-party/vendor host; tenant cannot influence it. */
  | 'platform-vendor'
  /** The transitional SSRF-guarded media fetch (`safe-media-fetch.ts`). */
  | 'media-guard'
  /** Not egress: the inbound server request handler. */
  | 'infra'
  /** Tenant-controlled egress not yet behind the broker — capped debt. */
  | 'pending-egress-broker';

export interface EgressSite {
  /** Repo-relative path. */
  readonly file: string;
  /** Number of global egress call sites found in the file. */
  readonly sites: number;
}

export interface RegisteredEgress {
  readonly file: string;
  readonly class: EgressClass;
  /** Expected number of global egress call sites — a new one bumps this. */
  readonly sites: number;
  readonly justification?: string;
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', '__tests__', 'coverage']);

/**
 * Files that DEFINE the egress primitives being measured, not call sites subject
 * to the policy. `broker.ts` is the one place the global `fetch` legitimately
 * lives — it is the broker. This guard's own source mentions `fetch(` in strings.
 */
const SKIP_FILES = new Set(['packages/core/src/egress/broker.ts', 'packages/core/src/egress/egress-access-guard.ts']);

/** The package roots that contain tenant-reachable egress. */
const EGRESS_SCAN_ROOTS = [
  'packages/core/src',
  'packages/api/src',
  'packages/channel-discord/src',
  'packages/channel-slack/src',
  'packages/channel-telegram/src',
  'packages/channel-gupshup/src',
  'packages/channel-twilio-whatsapp/src',
  'packages/channel-whatsapp/src',
  'packages/channel-sdk/src',
] as const;

function isTestFile(path: string): boolean {
  return path.includes('/__tests__/') || /\.(test|spec)\.ts$/.test(path);
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // a root that does not exist in this checkout is simply skipped
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !isTestFile(full)) out.push(full);
  }
}

/** Blank `//` and block comments, preserving offsets/newlines (see db-guard). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/**
 * Global outbound-egress call sites:
 *   * `fetch(` NOT preceded by `.` or a word char (excludes `.fetch(` methods);
 *   * `new WebSocket(`;
 *   * `net.connect` / `net.createConnection` / `tls.connect`;
 *   * `http.request` / `https.request`.
 */
const EGRESS_CALL =
  /(?<![.\w])fetch\s*\(|new\s+WebSocket\s*\(|(?<![.\w])(?:net|tls)\.(?:connect|createConnection)\s*\(|(?<![.\w])https?\.request\s*\(/g;

/** Scan the egress roots; returns one {@link EgressSite} per file with ≥1 site. */
export function scanEgressSites(repoRoot: string, roots: readonly string[] = EGRESS_SCAN_ROOTS): EgressSite[] {
  const files: string[] = [];
  for (const root of roots) walk(join(repoRoot, root), files);

  const out: EgressSite[] = [];
  for (const file of files) {
    const rel = relative(repoRoot, file).split('\\').join('/');
    if (SKIP_FILES.has(rel)) continue;
    const source = stripComments(readFileSync(file, 'utf-8'));
    const matches = source.match(EGRESS_CALL);
    EGRESS_CALL.lastIndex = 0;
    if (matches && matches.length > 0) out.push({ file: rel, sites: matches.length });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

export interface EgressGuardReport {
  /** Files the scan found that the registry does not list. Any entry fails. */
  readonly unregistered: EgressSite[];
  /** Registry entries whose file no longer has an egress site. Any entry fails. */
  readonly stale: RegisteredEgress[];
  /** Registered files whose scanned site count differs from the recorded one. */
  readonly countDrift: Array<{ file: string; registered: number; scanned: number }>;
  /** Non-broker entries missing a justification. */
  readonly unjustified: RegisteredEgress[];
  readonly counts: Record<EgressClass, number>;
}

export function evaluateEgressGuard(
  scanned: readonly EgressSite[],
  registry: readonly RegisteredEgress[] = REGISTERED_EGRESS,
): EgressGuardReport {
  const registered = new Map(registry.map((e) => [e.file, e]));
  const found = new Map(scanned.map((s) => [s.file, s]));

  const unregistered = scanned.filter((s) => !registered.has(s.file));
  const stale = registry.filter((e) => !found.has(e.file));
  const countDrift: EgressGuardReport['countDrift'] = [];
  for (const entry of registry) {
    const site = found.get(entry.file);
    if (site && site.sites !== entry.sites) {
      countDrift.push({ file: entry.file, registered: entry.sites, scanned: site.sites });
    }
  }
  const unjustified = registry.filter((e) => (e.justification ?? '').trim().length === 0);

  const counts: Record<EgressClass, number> = {
    'platform-vendor': 0,
    'media-guard': 0,
    infra: 0,
    'pending-egress-broker': 0,
  };
  for (const entry of registry) counts[entry.class] += 1;

  return { unregistered, stale, countDrift, unjustified, counts };
}

/**
 * Ceiling on the `pending-egress-broker` class — the number of FILES still doing
 * tenant-controlled egress with a raw `fetch`/socket rather than through the
 * broker.
 *
 * Opened by G5 at 10. The classifier found 11 tenant-controlled egress files;
 * `automations/actions.ts` — ADR-0009's canonical example — was converted to the
 * broker (`brokeredFetch`) in the same change. A brokered file has NO raw
 * `fetch`/socket, so it is ABSENT from the scan entirely — conversion is proven
 * by this ceiling falling and by the file dropping out of the inventory, not by a
 * registry class. The class therefore opens at the remaining 10. Like the
 * db-access ceiling this is a ratchet: it may fall as files move behind the
 * broker, never rise. The ten are named individually below with the
 * tenant-configured field that supplies each destination.
 */
export const PENDING_EGRESS_CEILING = 10;

/**
 * Committed inventory of every global outbound-egress call site in the scanned
 * roots. Hand-classified. A site the scanner finds that is absent here fails the
 * guard test — the mechanism that stops a new raw tenant `fetch` from landing
 * silently.
 */
export const REGISTERED_EGRESS: readonly RegisteredEgress[] = [
  // NOTE: `packages/core/src/automations/actions.ts` — ADR-0009's canonical
  // tenant webhook action — was converted to `brokeredFetch` in this change and
  // therefore has NO raw egress site; it is intentionally ABSENT here.

  // --- pending-egress-broker: tenant-controlled debt (capped) --------------
  {
    file: 'packages/core/src/providers/webhook-provider.ts',
    class: 'pending-egress-broker',
    sites: 2,
    justification:
      'ADR-0009 tenant-controlled egress: destination is the tenant-configured provider `config.webhookUrl`. Not ' +
      'yet routed through the TenantEgressBroker — pending-egress-broker debt, capped by the ratchet.',
  },
  {
    file: 'packages/core/src/providers/a2a-client.ts',
    class: 'pending-egress-broker',
    sites: 3,
    justification:
      'ADR-0009 tenant-controlled egress: destination is the tenant-configured agent provider `config.baseUrl`. ' +
      'Pending broker routing.',
  },
  {
    file: 'packages/core/src/providers/ag-ui-client.ts',
    class: 'pending-egress-broker',
    sites: 2,
    justification:
      'ADR-0009 tenant-controlled egress: destination is the tenant-configured agent provider `config.baseUrl`. ' +
      'Pending broker routing.',
  },
  {
    file: 'packages/core/src/providers/agno-client.ts',
    class: 'pending-egress-broker',
    sites: 2,
    justification:
      'ADR-0009 tenant-controlled egress: the fetch primitive behind every Agno REST call builds its URL from the ' +
      'tenant-configured `config.baseUrl`, and one path fetches a request-supplied `file.url`. Pending broker routing.',
  },
  {
    file: 'packages/core/src/providers/openclaw/client.ts',
    class: 'pending-egress-broker',
    sites: 1,
    justification:
      'ADR-0009 tenant-controlled egress: a `new WebSocket(config.url)` to the tenant-configured Openclaw endpoint. ' +
      'A long-lived socket rather than a fetch; broker WebSocket support is pending.',
  },
  {
    file: 'packages/api/src/services/providers.ts',
    class: 'pending-egress-broker',
    sites: 1,
    justification:
      'ADR-0009 tenant-controlled egress: a health probe to `new URL("/health", provider.baseUrl)`, where baseUrl is ' +
      'the tenant-configured agentProviders row. Pending broker routing.',
  },
  {
    file: 'packages/channel-gupshup/src/client.ts',
    class: 'pending-egress-broker',
    sites: 2,
    justification:
      'ADR-0009 tenant-controlled egress: despite the vendor name the destination is the per-instance tenant ' +
      'credential `gupshupCallbackUrl`, not a fixed Gupshup host. Pending broker routing.',
  },
  {
    file: 'packages/channel-discord/src/senders/media.ts',
    class: 'pending-egress-broker',
    sites: 2,
    justification:
      'ADR-0009 tenant-controlled egress: a raw download of an agent/tenant-chosen outbound `mediaUrl`. Pending ' +
      'routing through the broker or safe-media-fetch (media-download-shaped).',
  },
  {
    file: 'packages/channel-slack/src/senders/media.ts',
    class: 'pending-egress-broker',
    sites: 1,
    justification:
      'ADR-0009 tenant-controlled egress: a raw download of an agent/tenant-chosen outbound media `options.url`. ' +
      'Pending routing through the broker or safe-media-fetch.',
  },
  {
    file: 'packages/channel-whatsapp/src/utils/audio-converter.ts',
    class: 'pending-egress-broker',
    sites: 1,
    justification:
      'ADR-0009 tenant-controlled egress: a raw download of an agent/tenant-chosen audio `url` for conversion. ' +
      'Pending routing through the broker or safe-media-fetch.',
  },

  // --- media-guard: the transitional SSRF-guarded media fetch --------------
  {
    file: 'packages/api/src/utils/safe-media-fetch.ts',
    class: 'media-guard',
    sites: 1,
    justification:
      'The existing SSRF-guarded media fetch primitive: deny-lists private/reserved ranges and revalidates every ' +
      'redirect hop. Transitional; the broker generalises it. ITS ESCAPE HATCH IS NOW SUBSUMED FOR TENANT ' +
      'CONTEXTS (G5 deliverable (b)): `OMNI_MEDIA_URL_GUARD=off` is ignored when a `trustedTenantId` is supplied, ' +
      'on the initial URL and on every redirect hop, so no per-deployment flag can open private ranges to a ' +
      'tenant-controlled media URL. All three production callers thread that tenant from persisted ownership or ' +
      'the request scope (media-storage `storeFromUrl`, the dispatcher history-media chain, routes/v2/messages). ' +
      'A caller passing NO tenant keeps the pre-G5 hatch, which is the single-tenant deployment the hatch was ' +
      'written for. Proven in media-guard-tenant-subsumption.test.ts.',
  },

  // --- platform-vendor: compile-time-fixed vendor/first-party hosts --------
  {
    file: 'packages/api/src/routes/v2/whatsapp-cloud.ts',
    class: 'platform-vendor',
    sites: 1,
    justification:
      'Compile-time graph.facebook.com host (WABA conversation_analytics GET). The path interpolates the ' +
      'instance-stored waba_id and the query is server-built from validated numeric params — the tenant cannot ' +
      'redirect the host.',
  },
  {
    file: 'packages/api/src/providers/openai/imagegen.ts',
    class: 'platform-vendor',
    sites: 2,
    justification:
      'Fixed OpenAI image API constant, plus a download of OpenAI’s own returned image URL. Not tenant-influenceable.',
  },
  {
    file: 'packages/api/src/providers/openai/tts.ts',
    class: 'platform-vendor',
    sites: 1,
    justification: 'Compile-time OpenAI speech endpoint constant. Not tenant-influenceable.',
  },
  {
    file: 'packages/api/src/providers/openai/stt.ts',
    class: 'platform-vendor',
    sites: 2,
    justification: 'Compile-time OpenAI chat/transcription endpoint constants. Not tenant-influenceable.',
  },
  {
    file: 'packages/api/src/providers/groq/stt.ts',
    class: 'platform-vendor',
    sites: 1,
    justification: 'Compile-time Groq transcription endpoint constant. Not tenant-influenceable.',
  },
  {
    file: 'packages/api/src/providers/deepseek/vision.ts',
    class: 'platform-vendor',
    sites: 1,
    justification:
      'Vendor base URL from the platform-admin `deepseek.anthropic_url` setting/env, not a per-tenant value; a ' +
      'tenant cannot influence the destination.',
  },
  {
    file: 'packages/api/src/providers/gemini/videogen.ts',
    class: 'platform-vendor',
    sites: 1,
    justification: 'Downloads a URI returned by Gemini’s own Veo API. Destination fixed by the vendor, not the tenant.',
  },
  {
    file: 'packages/api/src/services/tts.ts',
    class: 'platform-vendor',
    sites: 2,
    justification: 'Hard-coded ElevenLabs API base constants. Not tenant-influenceable.',
  },
  {
    file: 'packages/api/src/plugins/agent-dispatcher.ts',
    class: 'platform-vendor',
    sites: 1,
    justification: 'Hard-coded Google generativelanguage endpoint for a Gemini gate check. Not tenant-influenceable.',
  },
  {
    file: 'packages/channel-twilio-whatsapp/src/client.ts',
    class: 'platform-vendor',
    sites: 3,
    justification: 'Hard-coded api.twilio.com / messaging.twilio.com hosts; only path segments are interpolated.',
  },
  {
    file: 'packages/channel-telegram/src/utils/media-download.ts',
    class: 'platform-vendor',
    sites: 1,
    justification:
      'Fixed api.telegram.org file host; additionally passes the channel-sdk downloadGuard response check.',
  },
  {
    file: 'packages/channel-slack/src/handlers/files.ts',
    class: 'platform-vendor',
    sites: 1,
    justification:
      'Slack private-file download with its own manual-redirect and slack.com host guard. Source URL from Slack’s API.',
  },
  {
    file: 'packages/channel-discord/src/handlers/forwarded-attachments.ts',
    class: 'platform-vendor',
    sites: 1,
    justification:
      'Discord CDN attachment URL taken from an inbound Discord message object. Destination is the Discord CDN.',
  },
  {
    file: 'packages/channel-sdk/src/media-backends/web-identity.ts',
    class: 'platform-vendor',
    sites: 1,
    justification:
      'AWS STS AssumeRoleWithWebIdentity token exchange to the fixed STS endpoint. Platform infra credential exchange.',
  },

  // --- infra: not egress ----------------------------------------------------
  {
    file: 'packages/api/src/index.ts',
    class: 'infra',
    sites: 1,
    justification:
      'The Bun server INBOUND request handler (`fetch(req, server)`), not an outbound call. No tenant-influenced destination.',
  },
];
