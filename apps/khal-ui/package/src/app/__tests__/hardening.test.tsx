import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DiagResult } from '../../hooks/useDiag';
import { AuthBannerView, authBannerReason, shouldShowAuthBanner } from '../AuthBanner';
import { ErrorFallback, RouteErrorBoundary } from '../RouteErrorBoundary';

describe('RouteErrorBoundary', () => {
  test('getDerivedStateFromError captures the error', () => {
    const err = new Error('kaboom');
    expect(RouteErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
  });

  test('ErrorFallback shows the message and a retry + reload control (not a white screen)', () => {
    const html = renderToStaticMarkup(
      <ErrorFallback error={new Error('boom in InstancesListPage')} onRetry={() => {}} />,
    );
    expect(html).toContain('boom in InstancesListPage');
    expect(html).toContain('Try again');
    expect(html).toContain('Reload');
    expect(html).toContain('role="alert"');
  });
});

describe('AuthBanner', () => {
  const ok: DiagResult = { auth: 'ok', version: '2.260710.3' };
  const invalid: DiagResult = { auth: 'invalid', upstreamStatus: 401 };
  const errored: DiagResult = { auth: 'error', reason: 'OMNI_API_KEY is not set' };

  test('shouldShowAuthBanner is false for ok/undefined, true for invalid/error', () => {
    expect(shouldShowAuthBanner(ok)).toBe(false);
    expect(shouldShowAuthBanner(undefined)).toBe(false);
    expect(shouldShowAuthBanner(invalid)).toBe(true);
    expect(shouldShowAuthBanner(errored)).toBe(true);
  });

  test('authBannerReason surfaces the upstream status / reason', () => {
    expect(authBannerReason(invalid)).toContain('401');
    expect(authBannerReason(errored)).toContain('OMNI_API_KEY');
    expect(authBannerReason(ok)).toBe('');
  });

  test('renders nothing when auth is ok', () => {
    expect(renderToStaticMarkup(<AuthBannerView diag={ok} />)).toBe('');
    expect(renderToStaticMarkup(<AuthBannerView diag={undefined} />)).toBe('');
  });

  test('renders the actionable banner when the key is rejected', () => {
    const html = renderToStaticMarkup(<AuthBannerView diag={invalid} />);
    expect(html).toContain('Backend auth failed');
    expect(html).toContain('OMNI_API_KEY in apps/khal-ui/.env');
    expect(html).toContain('401');
    expect(html).toContain('role="alert"');
  });
});
