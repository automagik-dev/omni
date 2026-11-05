/**
 * Pairing with nothing configured (wish: omni-labs-distribution): the address a request
 * came in on, the secret the API keeps for itself, and the operator routes' guard rails.
 * The flows run against real PostgreSQL in services/__tests__/login-operator-postgres.test.ts.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { SCOPE_MAP } from '../../constants/scopes';
import { ownerRoutes } from '../../routes/v2/owner';
import { ApiKeyService } from '../../services/api-keys';
import type { AppVariables } from '../../types';
import { DEFAULT_DEVICE_KEY_SCOPES, DEVICE_KEY_OPT_IN_NAMESPACES, FORBIDDEN_SCOPE } from '../config';
import { publicOrigin, requestOrigin, sameHostOrigins } from '../origin';
import { AUTH_SECRET_SETTING, resolveLoginDefaults } from '../secret';

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe('requestOrigin', () => {
  test('the scheme and host the request came in on, lowercased, with its port', () => {
    expect(requestOrigin(req('http://Omni.Tail.ts.net:8882/api/v2/login/status'), {})).toBe(
      'http://omni.tail.ts.net:8882',
    );
    expect(requestOrigin(req('http://10.0.0.5:8882/x'), {})).toBe('http://10.0.0.5:8882');
    expect(requestOrigin(req('http://[::1]:8882/x'), {})).toBe('http://[::1]:8882');
  });

  test('X-Forwarded-Proto counts only behind a proxy the API trusts', () => {
    const behind = req('http://omni.example.com/x', { 'x-forwarded-proto': 'https' });
    expect(requestOrigin(behind, {})).toBe('http://omni.example.com');
    expect(requestOrigin(behind, { TRUSTED_PROXY_HEADER: 'x-forwarded-for' })).toBe('https://omni.example.com');
    const odd = req('http://omni.example.com/x', { 'x-forwarded-proto': 'gopher' });
    expect(requestOrigin(odd, { TRUSTED_PROXY_HEADER: 'x-forwarded-for' })).toBe('http://omni.example.com');
  });

  test('a host that is not a host gives no origin', () => {
    for (const host of ['evil.com/path', 'evil.com?x', 'a b', 'evil.com:99999999', '-bad.com', 'x..y']) {
      expect(requestOrigin(req('http://omni.example.com/x', { host }), {})).toBeNull();
    }
  });

  test('a fixed public URL always wins over the request', () => {
    const request = req('http://forged.example/x');
    expect(publicOrigin({ publicUrl: 'https://omni.example.com' }, request)).toBe('https://omni.example.com');
    expect(publicOrigin({ publicUrl: null }, request)).toBe('http://forged.example');
  });

  test('a browser may post from either scheme of the host it is on, and nowhere else', () => {
    expect(sameHostOrigins(req('http://omni.local:8882/api/auth/device/approve'))).toEqual([
      'https://omni.local:8882',
      'http://omni.local:8882',
    ]);
    expect(sameHostOrigins(req('http://omni.local/x', { host: 'bad host' }))).toEqual([]);
  });
});

describe('resolveLoginDefaults', () => {
  const settings = (stored: Record<string, string> = {}) => {
    let generated = 0;
    return {
      generated: () => generated,
      ensureGeneratedSecret: async (key: string, generate: () => string) => {
        if (!stored[key]) {
          generated++;
          stored[key] = generate();
        }
        return stored[key] as string;
      },
      getString: async (key: string) => stored[key],
    };
  };

  test('generates a secret once and hands back the same one after a restart', async () => {
    const store: Record<string, string> = {};
    const first = settings(store);
    const a = await resolveLoginDefaults({} as never, {}, first);
    const b = await resolveLoginDefaults({} as never, {}, settings(store));
    expect(a.secret).toHaveLength(43);
    expect(b.secret).toBe(a.secret);
    expect(first.generated()).toBe(1);
    expect(store[AUTH_SECRET_SETTING]).toBe(a.secret);
  });

  test('the environment wins, login off asks for nothing, and the stored public URL fills in', async () => {
    const store = { 'server.public_url': 'http://omni.tail.ts.net:8882' };
    expect(await resolveLoginDefaults({} as never, { OMNI_AUTH_SECRET: 'e'.repeat(40) }, settings(store))).toEqual({
      publicUrl: 'http://omni.tail.ts.net:8882',
    });
    expect(await resolveLoginDefaults({} as never, { OMNI_LOGIN_ENABLED: 'false' }, settings(store))).toEqual({});
    expect(
      await resolveLoginDefaults(
        {} as never,
        { OMNI_AUTH_SECRET: 'e'.repeat(40), OMNI_PUBLIC_URL: 'https://x.example' },
        settings(store),
      ),
    ).toEqual({});
  });

  test('a secret that cannot be stored leaves login off rather than inventing one per process', async () => {
    const broken = {
      ensureGeneratedSecret: async () => {
        throw new Error('db down');
      },
      getString: async () => undefined,
    };
    expect(await resolveLoginDefaults({} as never, {}, broken)).toEqual({});
  });
});

describe('a default device key (#1392)', () => {
  test('operates all of Omni: every scope the API asks for, but governing Omni and the opt-in logs and metrics', () => {
    const optIn: readonly string[] = DEVICE_KEY_OPT_IN_NAMESPACES;
    const scopes = [...new Set(Object.values(SCOPE_MAP))];
    const missing = scopes.filter(
      (scope) =>
        !FORBIDDEN_SCOPE.test(scope) &&
        !optIn.includes(scope.split(':')[0] ?? '') &&
        !ApiKeyService.scopeAllows([...DEFAULT_DEVICE_KEY_SCOPES], scope),
    );
    expect(missing).toEqual([]);
    for (const scope of ['persons:read', 'automations:read', 'agents:write', 'routes:write', 'follow-up:read']) {
      expect(ApiKeyService.scopeAllows([...DEFAULT_DEVICE_KEY_SCOPES], scope)).toBe(true);
    }
    for (const scope of [
      'keys:write',
      'settings:write',
      'auth:admin',
      'trust:read',
      'audit:read',
      'logs:read',
      'metrics:read',
    ]) {
      expect(ApiKeyService.scopeAllows([...DEFAULT_DEVICE_KEY_SCOPES], scope)).toBe(false);
    }
    expect(DEFAULT_DEVICE_KEY_SCOPES.some((scope) => FORBIDDEN_SCOPE.test(scope))).toBe(false);
  });
});

describe('the operator routes', () => {
  test('need auth:admin, which device keys never carry and the primary key has', () => {
    for (const route of ['POST /owner/claim', 'POST /owner/approve', 'POST /owner/connect']) {
      const scope = SCOPE_MAP[route];
      expect(scope).toBe('auth:admin');
      expect(ApiKeyService.scopeAllows([...DEFAULT_DEVICE_KEY_SCOPES], scope as string)).toBe(false);
      expect(ApiKeyService.scopeAllows(['instances:*', 'messages:*', 'system:admin'], scope as string)).toBe(false);
      expect(ApiKeyService.scopeAllows(['*'], scope as string)).toBe(true);
    }
  });

  test('answer 409 when login is off', async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('login', null);
      await next();
    });
    app.route('/owner', ownerRoutes);
    for (const path of ['/owner/claim', '/owner/approve', '/owner/connect']) {
      const response = await app.request(path, { method: 'POST', body: '{}' });
      expect(response.status).toBe(409);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('LOGIN_OFF');
    }
  });
});
