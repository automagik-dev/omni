/**
 * Profile-to-columns resolver used by the key-creation route and the CLI
 * admin path. Takes a profile name + caller-supplied allowlists + override
 * payload and returns the exact column values the `apiKeys` row should
 * receive. Centralising the logic means the CLI-only admin path and the
 * HTTP route stay in lockstep on scope resolution, lock validation, and
 * override merging.
 */

import type { ApiKeyProfile, ApiKeyProfileOverrides } from '@omni/db';
import {
  type LockRequirement,
  PROFILES,
  type ProfileName,
  type ProfileOverrides,
  type ProfileTemplate,
} from '../constants/profiles';
import { verbsToScopes } from './verbs-to-scopes';

export interface ResolveProfileInput {
  profile: ProfileName;
  chatAllowlist?: string[];
  instanceAllowlist?: string[];
  /** Caller-supplied outbound recipients (not accepted for locked profiles like scout). */
  outboundRecipientAllowlist?: string[];
  /** Scout's `--owner <jid>` flag — forced into outboundRecipientAllowlist when profile is scout. */
  owner?: string;
  /** Tenant-level override payload persisted in `profile_overrides`. */
  overrides?: ApiKeyProfileOverrides;
  /** Coworker-only: denylist preset key override. Null/undefined falls through to the profile default. */
  denylistPresetKey?: string | null;
}

export interface ResolvedProfileColumns {
  profile: ApiKeyProfile;
  scopes: string[];
  chatAllowlist: string[];
  instanceAllowlist: string[];
  outboundRecipientAllowlist: string[];
  profileOverrides: ApiKeyProfileOverrides;
  template: ProfileTemplate;
}

export class ProfileResolutionError extends Error {
  constructor(
    public readonly code: 'UNKNOWN_PROFILE' | 'MISSING_LOCK' | 'EMPTY_LOCK' | 'LOCKED_OVERRIDE_VIOLATION',
    message: string,
    public readonly lock?: LockRequirement,
  ) {
    super(message);
    this.name = 'ProfileResolutionError';
  }
}

function ensureLockProvided(template: ProfileTemplate, lock: LockRequirement, values: string[] | undefined): string[] {
  if (!template.requiresLocks.includes(lock)) return values ?? [];
  const list = values ?? [];
  if (list.length === 0) {
    throw new ProfileResolutionError('MISSING_LOCK', `profile requires ${lock} to be specified at creation time`, lock);
  }
  return list;
}

function buildEffectiveOverrides(
  defaults: Partial<ProfileOverrides>,
  callerOverrides: ApiKeyProfileOverrides,
  lockedFields: Set<keyof ProfileOverrides>,
  presetFromFlag: string | null | undefined,
): ApiKeyProfileOverrides {
  const out: ApiKeyProfileOverrides = {};
  if (defaults.denylistPresetKey !== undefined && defaults.denylistPresetKey !== null) {
    out.denylistPresetKey = defaults.denylistPresetKey;
  }
  if (defaults.denylistExtras !== undefined) {
    out.denylistExtras = [...defaults.denylistExtras];
  }
  if (callerOverrides.add !== undefined) out.add = callerOverrides.add;
  if (callerOverrides.remove !== undefined) out.remove = callerOverrides.remove;
  if (callerOverrides.denylistExtras !== undefined) {
    if (lockedFields.has('denylistExtras')) {
      throw new ProfileResolutionError(
        'LOCKED_OVERRIDE_VIOLATION',
        'override "denylistExtras" is locked on this profile',
      );
    }
    out.denylistExtras = callerOverrides.denylistExtras;
  }

  const presetFromOverrides = callerOverrides.denylistPresetKey;
  if (presetFromFlag !== undefined || presetFromOverrides !== undefined) {
    if (lockedFields.has('denylistPresetKey')) {
      throw new ProfileResolutionError(
        'LOCKED_OVERRIDE_VIOLATION',
        'override "denylistPresetKey" is locked on this profile',
      );
    }
    const resolved = presetFromFlag !== undefined ? presetFromFlag : presetFromOverrides;
    out.denylistPresetKey = resolved === null ? undefined : resolved;
  }
  return out;
}

/**
 * Resolve a profile name + caller inputs into the exact column values the
 * key-creation path should write. Throws on unknown profile, missing
 * required locks, or attempts to widen a locked override.
 */
export function resolveProfile(input: ResolveProfileInput): ResolvedProfileColumns {
  const template = PROFILES[input.profile];
  if (!template) {
    throw new ProfileResolutionError('UNKNOWN_PROFILE', `unknown profile: ${input.profile}`);
  }

  const defaults: Partial<ProfileOverrides> = template.defaultOverrides ?? {};
  const callerOverrides: ApiKeyProfileOverrides = input.overrides ?? {};
  const lockedFields = new Set<keyof ProfileOverrides>(template.lockedOverrides ?? []);

  const outboundFromInput = [...(input.outboundRecipientAllowlist ?? [])];
  if (input.owner) outboundFromInput.push(input.owner);

  const outboundRecipientAllowlist = ensureLockProvided(template, 'outboundRecipientAllowlist', outboundFromInput);
  const chatAllowlist = ensureLockProvided(template, 'chatAllowlist', input.chatAllowlist);
  const instanceAllowlist = ensureLockProvided(template, 'instanceAllowlist', input.instanceAllowlist);

  const effectiveOverrides = buildEffectiveOverrides(defaults, callerOverrides, lockedFields, input.denylistPresetKey);

  const scopes = verbsToScopes({
    buckets: template.buckets,
    extraScopes: defaults.extraScopes ?? [],
  });

  return {
    profile: input.profile,
    scopes,
    chatAllowlist,
    instanceAllowlist,
    outboundRecipientAllowlist,
    profileOverrides: effectiveOverrides,
    template,
  };
}
