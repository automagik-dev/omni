import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../types';
import { genieSignatureMiddleware } from '../genie-signature';

function mountWithoutGenieHosts(): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {} as AppVariables['services']);
    await next();
  });
  app.use('*', genieSignatureMiddleware);
  app.get('/protected', (c) => c.json({ ok: true }));
  return app;
}

describe('genie-signature middleware — verifier service availability', () => {
  test('bearer-only request without signature headers still passes through', async () => {
    const res = await mountWithoutGenieHosts().request('/protected');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('request with X-Genie signature headers fails closed when genieHosts is unavailable', async () => {
    const res = await mountWithoutGenieHosts().request('/protected', {
      headers: {
        'x-genie-host-id': 'unverified-host',
        'x-genie-timestamp': '2026-07-17T00:00:00.000Z',
        'x-genie-signature': 'unverified-signature',
      },
    });

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('GENIE_SIGNATURE_SERVICE_UNAVAILABLE');
  });

  test('partial X-Genie signature headers also fail closed when genieHosts is unavailable', async () => {
    const res = await mountWithoutGenieHosts().request('/protected', {
      headers: { 'x-genie-host-id': 'unverified-host' },
    });

    expect(res.status).toBe(503);
  });

  for (const headerName of ['x-genie-host-id', 'x-genie-timestamp', 'x-genie-signature']) {
    test(`present-but-empty ${headerName} fails closed when genieHosts is unavailable`, async () => {
      const headers = new Headers();
      headers.set(headerName, '');
      expect(headers.has(headerName)).toBe(true);
      expect(headers.get(headerName)).toBe('');

      const res = await mountWithoutGenieHosts().request('/protected', { headers });

      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('GENIE_SIGNATURE_SERVICE_UNAVAILABLE');
    });
  }
});
