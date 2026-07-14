'use client';

/**
 * Route- and affordance-level gates over the KHAL identity.
 *
 * `RequireCapability` wraps a *view*: below the required role the page never
 * renders, the operator gets a plain explanation instead. `Gate` wraps a
 * *control*: below the required role the affordance is simply not offered (or a
 * caller-supplied fallback is). Both fail closed — no session, or a session we
 * cannot read a role from, denies.
 *
 * Neither replaces the BFF check. The BFF is the boundary; these keep the UI
 * from offering an operator a button that would come back 403.
 */
import type { ReactNode } from 'react';
import { T } from '../components/tokens';
import { type Capability, ROLE_LABEL, requirementReason } from './capabilities';
import { useAuthz } from './useAuthz';
import type { Authz } from './useAuthz';

/** Presentational denial panel — exported so it can be asserted without a host. */
export function AccessDeniedView({ capability, authz }: { capability: Capability; authz: Pick<Authz, 'role'> }) {
  const held = authz.role ? ROLE_LABEL[authz.role] : 'no signed-in KHAL session';
  return (
    <div
      role="alert"
      style={{
        margin: 'auto',
        maxWidth: 520,
        padding: '24px 28px',
        borderRadius: T.radius,
        border: `1px solid ${T.border}`,
        background: T.surface,
        color: T.fg,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        textAlign: 'center',
      }}
    >
      <span style={{ fontWeight: 600, fontSize: 15 }}>Access denied</span>
      <span style={{ fontSize: 13, color: T.muted }}>{requirementReason(capability)}</span>
      <span style={{ fontSize: 12, color: T.muted }}>You are signed in as: {held}.</span>
    </div>
  );
}

/** Neutral placeholder while the host resolves the session — never a denial. */
export function CheckingAccessView() {
  return (
    <div style={{ margin: 'auto', padding: 24, fontSize: 13, color: T.muted }} aria-busy="true">
      Checking access…
    </div>
  );
}

export function RequireCapability({ capability, children }: { capability: Capability; children: ReactNode }) {
  const authz = useAuthz();
  if (authz.loading) return <CheckingAccessView />;
  if (!authz.can(capability)) return <AccessDeniedView capability={capability} authz={authz} />;
  return <>{children}</>;
}

/**
 * Hide (or replace) a control the current role may not use. Default fallback is
 * nothing at all: an affordance the operator cannot exercise is noise.
 */
export function Gate({
  capability,
  children,
  fallback = null,
}: {
  capability: Capability;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useAuthz().can(capability) ? <>{children}</> : <>{fallback}</>;
}
