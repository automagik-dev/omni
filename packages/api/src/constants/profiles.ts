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

export type ProfileName = 'cs' | 'personal' | 'scout' | 'coworker' | 'admin';

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
};
