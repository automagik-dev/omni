'use client';

/**
 * React access to the logged-in KHAL identity, reduced to the pack's
 * {@link Capability} tiers.
 *
 * `useKhalAuth()` reads the nearest `KhalAuthProvider` (WorkOS on web, Tauri on
 * desktop; the dev harness mounts its own). It returns `null` when there is no
 * provider *or* while the session is still resolving — both are treated as "no
 * session", so every capability is denied until an identity actually resolves.
 */
import { useKhalAuth } from '@khal-os/sdk/app';
import type { KhalAuth, Role } from '@khal-os/sdk/app';
import { useMemo } from 'react';
import { type Capability, can, sessionRole } from './capabilities';

export interface Authz {
  /** Raw host auth, or `null` when no `KhalAuthProvider` is mounted. */
  auth: KhalAuth | null;
  /** Canonical role of a usable session; `null` while loading or when unknown. */
  role: Role | null;
  /** A session exists but has not resolved yet — show "checking", not "denied". */
  loading: boolean;
  /** True only for a resolved session carrying a role slug we recognise. */
  authenticated: boolean;
  can: (capability: Capability) => boolean;
}

export function useAuthz(): Authz {
  const auth = useKhalAuth();
  return useMemo<Authz>(() => {
    const role = sessionRole(auth);
    return {
      auth,
      role,
      loading: auth?.loading === true,
      authenticated: role !== null,
      can: (capability) => can(auth, capability),
    };
  }, [auth]);
}

/** Sugar for a single capability check. */
export function useCan(capability: Capability): boolean {
  return useAuthz().can(capability);
}

/**
 * The identity token the host issued for this session, or `undefined` when the
 * host supplies none (standalone / dev harness). Callers MUST tolerate its
 * absence — the raw JWT exists so pack front-ends can forward
 * `Authorization: Bearer <jwt>` to their BFF, not as a login gate.
 */
export function useKhalToken(): string | undefined {
  return useKhalAuth()?.token;
}
