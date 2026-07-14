/**
 * Code-defined profile templates.
 *
 * A profile is the composition unit for issuing omni API keys: a set of
 * verb buckets plus enforcement locks the scope-enforcer and
 * output-redactor will apply at request time. The five templates
 * (`cs`, `personal`, `scout`, `coworker`, `admin`) map every documented
 * use case from the DESIGN doc. Consumers never author raw scope arrays;
 * the CLI and key-creation route consume these templates and let
 * `verbsToScopes()` derive the flat scope list that lands on the row.
 *
 * Locks and overrides are layered: `requiresLocks` is what the caller
 * MUST supply at create time (enforced by the CLI), `defaultOverrides`
 * are baseline values merged into any tenant-provided overrides, and
 * `lockedOverrides` are values a tenant cannot widen (scout's owner-only
 * recipient allowlist is the canonical case).
 */

import type { Verb, VerbBucket } from './verbs';

export type ProfileName =
  | 'cs'
  | 'personal'
  | 'scout'
  | 'coworker'
  | 'admin'
  | 'console-viewer'
  | 'console-operator'
  | 'console-admin';

/** The lock-free, platform-wide profiles minted for the Omni Admin Console. */
export const CONSOLE_PROFILES = ['console-viewer', 'console-operator', 'console-admin'] as const;

export type LockRequirement = 'chatAllowlist' | 'instanceAllowlist' | 'outboundRecipientAllowlist';

/**
 * Tenant-editable overrides that ride on top of a profile template.
 * Persisted as the `profile_overrides` jsonb column on `agent_keys`.
 */
export interface ProfileOverrides {
  chatAllowlist: string[];
  instanceAllowlist: string[];
  outboundRecipientAllowlist: string[];
  extraBuckets: VerbBucket[];
  extraScopes: string[];
  denylistPresetKey: string | null;
  /**
   * Tenant-specific literal patterns appended to the resolved preset list.
   * Each entry is treated as a case-insensitive literal (regex-escaped).
   */
  denylistExtras: string[];
}

export interface ProfileTemplate {
  /** Verb buckets this profile enables by default. */
  buckets: VerbBucket[];
  /**
   * Per-verb overrides layered on top of `buckets`. `add` pulls in extra
   * verbs that the bucket composition alone would miss; `remove` strips
   * individual verbs so a profile can enable a bucket minus one verb
   * without dropping the whole bucket (canonical case: CS keeps the
   * `context` bucket but removes `use` so the key cannot switch
   * instances). `add` and `remove` MUST be disjoint.
   */
  verbs?: { add?: Verb[]; remove?: Verb[] };
  /** Locks the CLI / route MUST require at key-creation time. */
  requiresLocks: LockRequirement[];
  /**
   * Default overrides merged into tenant-provided overrides. A tenant may
   * still widen or narrow these unless the field is also in `lockedOverrides`.
   */
  defaultOverrides?: Partial<ProfileOverrides>;
  /**
   * Fields the tenant cannot change. When an override attempts to widen a
   * locked field, the override is rejected at key-creation time.
   */
  lockedOverrides?: Array<keyof ProfileOverrides>;
  /**
   * Marks the profile as admin-only: creation is allowed only from an
   * interactive TTY with the `I UNDERSTAND` confirmation prompt.
   */
  adminOnlyFlag?: true;
}

/**
 * Pointer to a denylist preset key. The preset itself is resolved at
 * runtime from tenant config / env (`OMNI_DENYLIST_PRESETS`) so the omni
 * platform repo never ships consumer-specific secret-sauce taxonomies.
 */
export const COWORKER_DEFAULT_DENYLIST_PRESET_KEY = 'khal-os-core';

/**
 * ── Console profiles ────────────────────────────────────────────────────────
 *
 * The four agent profiles above are *messaging-agent* profiles: they compose
 * verb buckets and every one of them requires a lock (instance / chat /
 * recipient allowlist). The Omni Admin Console is not an agent — it is a
 * platform-wide operator surface with no single instance or chat to lock to,
 * so console profiles are authored as raw scope sets with `requiresLocks: []`
 * and no verb buckets. They ride the existing `defaultOverrides.extraScopes`
 * path, so `resolveProfile()` / `verbsToScopes()` need no changes.
 *
 * The three scope tiers below are DERIVED from the machine-readable capability
 * inventory (`apps/khal-ui/package/src/capabilities/capabilities.json`, itself
 * generated from `SCOPE_MAP`). Their union is exactly the 59 distinct scopes the
 * admin console can invoke — no more, no less; the coverage test in
 * `routes/v2/__tests__/console-profile-scope-coverage.test.ts` enforces both
 * directions against the inventory, so a new console route that lands in
 * SCOPE_MAP fails the suite until it is placed in a tier here.
 *
 * Tier placement for the trust / handoffs / voice / follow-up families
 * (mapped into SCOPE_MAP alongside this change) mirrors the pack's own
 * affordance gating in `apps/khal-ui/package/src/auth/capabilities.ts`:
 *   - reads (`trust:read`, `handoffs:read`, `voice:read`, `follow-up:read`) →
 *     viewer, so a read view never 403s for the role the pack shows it to;
 *   - operational writes (`voice:write`, `follow-up:write`) → operator;
 *   - `trust:write` (managing which genie hosts may connect — tenant
 *     administration) → admin only, matching the pack's `ADMIN_ROUTES`
 *     classification of the `/trust-hosts` page as `administer`.
 */

/**
 * Tier 1 — read-only console. Every read scope the console invokes, plus
 * `auth:validate` (the BFF validates its own minted key). `keys:read` is
 * deliberately NOT here: the key inventory is a credential-administration
 * surface and belongs to `console-admin` only. `turns:admin` is also absent —
 * that single scope covers both `GET /turns` and `POST /turns/:id/close`, so
 * granting read access to turns would hand a viewer a close button.
 */
const CONSOLE_READ_SCOPES = [
  'access:read',
  'agent-state:read',
  'agent-tasks:read',
  'agents:read',
  'auth:validate',
  'automations:read',
  'batch-jobs:read',
  'chats:read',
  'context:read',
  'conversations:read',
  'dead-letters:read',
  'event-ops:read',
  'events:read',
  'follow-up:read',
  'handoffs:read',
  'instances:read',
  'journeys:read',
  'logs:read',
  'media:read',
  'messages:read',
  'metrics:read',
  'payloads:read',
  'persons:read',
  'providers:read',
  'routes:read',
  'settings:read',
  'trust:read',
  'voice:read',
  'webhooks:read',
] as const;

/**
 * Tier 2 — day-2 operational writes layered on top of the read tier: send
 * messages, drive chats and instances, close turns, run automations / batch
 * jobs, retry dead letters, replay events, edit routes. Explicitly EXCLUDES
 * every administration scope (see `CONSOLE_ADMINISTRATION_SCOPES`).
 */
const CONSOLE_OPERATE_SCOPES = [
  'agent-state:write',
  'agent-tasks:write',
  'automations:write',
  'batch-jobs:write',
  'chats:write',
  'context:write',
  'conversations:write',
  'dead-letters:write',
  'event-ops:write',
  'events:write',
  'follow-up:write',
  'instances:write',
  'media:write',
  'messages:send',
  'messages:write',
  'persons:write',
  'routes:write',
  'tts:synthesize',
  'turns:admin',
  'turns:close',
  'voice:write',
] as const;

/**
 * Tier 3 — administration: credentials (`keys:*`), authorization rules,
 * platform settings, the provider and agent registries, webhook sources, and
 * payload retention. Only `console-admin` (KHAL `platform-admin` /
 * `platform-owner`) gets these.
 */
const CONSOLE_ADMINISTRATION_SCOPES = [
  'access:write',
  'agents:write',
  'keys:read',
  'keys:write',
  'payloads:write',
  'providers:write',
  'settings:write',
  'trust:write',
  'webhooks:write',
] as const;

/** Resolved scope set per console profile (each tier is cumulative). */
export const CONSOLE_VIEWER_SCOPES: string[] = [...CONSOLE_READ_SCOPES];
export const CONSOLE_OPERATOR_SCOPES: string[] = [...CONSOLE_READ_SCOPES, ...CONSOLE_OPERATE_SCOPES];
export const CONSOLE_ADMIN_SCOPES: string[] = [
  ...CONSOLE_READ_SCOPES,
  ...CONSOLE_OPERATE_SCOPES,
  ...CONSOLE_ADMINISTRATION_SCOPES,
];

export const PROFILES: Record<ProfileName, ProfileTemplate> = {
  /**
   * Customer-service turn agent — locked to one customer chat on one
   * instance. Multimodal buckets are intentionally omitted; enterprises
   * opt in via `extraBuckets` in their overrides.
   */
  cs: {
    buckets: ['outgoing', 'read', 'context', 'turn'],
    // CS keys are locked to one instance via instanceAllowlist. The `use`
    // verb would let the key switch active instance at runtime and defeat
    // that lock, so it is surgically removed from the `context` bucket.
    verbs: { remove: ['use'] },
    requiresLocks: ['chatAllowlist', 'instanceAllowlist'],
  },

  /**
   * Operator-owned permissive profile. Instance lock is required so the
   * key cannot silently cross into another tenant's instances.
   */
  personal: {
    buckets: ['outgoing', 'read', 'context', 'turn', 'multimodal_in', 'multimodal_out'],
    requiresLocks: ['instanceAllowlist'],
  },

  /**
   * Autonomous observer. Can read everywhere the instance sees, but the
   * only thing it can send is an alert to its owner JID. The
   * `outboundRecipientAllowlist` is locked — a tenant cannot widen it.
   */
  scout: {
    buckets: ['read', 'context', 'multimodal_in'],
    // Scout must locate the current chat (`where`) but must NEVER ingest
    // prior conversation history — data-exfil prevention per DESIGN.
    // `where` and `history` both map to `chats:read` today, so the
    // resolved scope set is identical by count, but the structural
    // commitment survives a future split (e.g. `chats:history:read`).
    verbs: { add: ['where'], remove: ['history'] },
    requiresLocks: ['outboundRecipientAllowlist'],
    defaultOverrides: {
      extraScopes: ['messages:send'],
    },
    lockedOverrides: ['outboundRecipientAllowlist'],
  },

  /**
   * Peer-to-employees PM agent. Has the full verb surface but every
   * outbound message runs through the output-redactor against the
   * profile's denylist preset. Instance lock scopes it to one tenant.
   */
  coworker: {
    buckets: ['outgoing', 'read', 'context', 'turn', 'multimodal_in', 'multimodal_out'],
    requiresLocks: ['instanceAllowlist'],
    defaultOverrides: {
      denylistPresetKey: COWORKER_DEFAULT_DENYLIST_PRESET_KEY,
    },
  },

  /**
   * God key. Full verb surface, no locks, redactor bypassed. Creation is
   * gated behind interactive TTY + `I UNDERSTAND` prompt and emits a
   * `key.admin_created` audit event (handled by Group 7).
   */
  admin: {
    buckets: ['outgoing', 'read', 'context', 'turn', 'multimodal_in', 'multimodal_out'],
    requiresLocks: [],
    adminOnlyFlag: true,
  },

  /**
   * Console tier 1 — KHAL `member`. Read-only admin console. No locks: the
   * console is platform-wide, so there is no instance/chat to lock it to.
   */
  'console-viewer': {
    buckets: [],
    requiresLocks: [],
    defaultOverrides: {
      extraScopes: CONSOLE_VIEWER_SCOPES,
    },
  },

  /**
   * Console tier 2 — KHAL `platform-dev`. Read + operate (send, turn, instance
   * and chat operations). No key or tenant administration.
   */
  'console-operator': {
    buckets: [],
    requiresLocks: [],
    defaultOverrides: {
      extraScopes: CONSOLE_OPERATOR_SCOPES,
    },
  },

  /**
   * Console tier 3 — KHAL `platform-admin` / `platform-owner`. The full admin
   * console surface, including key management. NOT the `admin` god key: it
   * carries no `*` wildcard, so any route outside SCOPE_MAP stays denied.
   */
  'console-admin': {
    buckets: [],
    requiresLocks: [],
    defaultOverrides: {
      extraScopes: CONSOLE_ADMIN_SCOPES,
    },
  },
};
