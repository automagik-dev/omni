'use client';

/**
 * Full-width auth-failure banner. When the BFF `/diag` reports the backend key
 * is missing/invalid (or upstream 401s), every `/omni` call will fail — so
 * rather than let each page show a lonely error, we surface one loud, actionable
 * banner at the top of the app telling the operator exactly what to fix.
 *
 * The detection lives in {@link shouldShowAuthBanner}; the presentational
 * {@link AuthBannerView} takes the diag result as a prop so both are unit-tested
 * without a live backend (the BFF diag logic itself is covered in bff.test.ts).
 */
import { T } from '../components/tokens';
import type { DiagResult } from '../hooks/useDiag';
import { useDiag } from '../hooks/useDiag';

/** Show the banner only once diag has resolved and reports a non-ok auth state. */
export function shouldShowAuthBanner(diag: DiagResult | undefined): boolean {
  return diag != null && diag.auth !== 'ok';
}

/** A short, specific reason appended after the primary instruction. */
export function authBannerReason(diag: DiagResult | undefined): string {
  if (!diag) return '';
  if (diag.auth === 'invalid') {
    return diag.upstreamStatus
      ? `Key rejected by the backend (HTTP ${diag.upstreamStatus}).`
      : 'Key rejected by the backend.';
  }
  if (diag.auth === 'error') {
    return diag.reason ?? diag.message ?? 'Could not reach the backend to validate the key.';
  }
  return '';
}

const MESSAGE = 'Backend auth failed — check OMNI_API_KEY in apps/khal-ui/.env';

export function AuthBannerView({ diag }: { diag: DiagResult | undefined }) {
  if (!shouldShowAuthBanner(diag)) return null;
  const reason = authBannerReason(diag);
  return (
    <div
      role="alert"
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: '10px 16px',
        background: T.danger,
        color: '#fff',
        fontSize: 13,
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontWeight: 600 }}>{MESSAGE}</span>
      {reason && <span style={{ opacity: 0.9 }}>{reason}</span>}
    </div>
  );
}

/** Container: reads live diag and renders the banner (nothing when auth is ok). */
export function AuthBanner() {
  const { diag } = useDiag();
  return <AuthBannerView diag={diag} />;
}
