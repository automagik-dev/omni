/** Test wiring: the fake issuer, the reference store and a core, plus small HTTP helpers. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type OidcSettings, createOidcClient } from '../src/oidc';
import { type ConnectCoreOptions, createConnectCore, newSetupCapability } from '../src/sessions';
import { CLIENT_ID, CLIENT_SECRET, type FakeIssuer, ISSUER, OWNER } from './fake-issuer';
import { MemoryStore } from './memory-store';

const ORIGIN = 'https://studio.test';
export const SESSION = '__Host-brain_connect_session';
export const TX = '__Host-brain_connect_tx';
export type Wiring = { issuer: FakeIssuer; store: MemoryStore; core: ReturnType<typeof createConnectCore> };
type FinishOptions = { claims?: Record<string, unknown>; state?: string; tamper?: (url: URL) => void };

export function secretFile(mode = 0o600, content = `${CLIENT_SECRET}\n`): string {
  const path = join(mkdtempSync(join(tmpdir(), 'connect-')), 'client-secret');
  writeFileSync(path, content, { mode });
  return path;
}

export function settings(extra: Partial<OidcSettings> = {}): OidcSettings {
  const base = { issuer: ISSUER, clientId: CLIENT_ID, origin: ORIGIN, requiredGroup: 'studio-owners' };
  return { ...base, clientSecretFile: secretFile(), ...extra };
}

/** An initialized installation, enrolled to OWNER unless `enrolled` is false. */
export async function wire(
  issuer: FakeIssuer,
  opts: { enrolled?: boolean; oidc?: Partial<OidcSettings>; core?: Partial<ConnectCoreOptions> } = {},
): Promise<Wiring> {
  Object.assign(issuer, { plan: {}, down: false, jwksPadding: 0, tokenGate: null });
  const oidc = createOidcClient(settings(opts.oidc), { fetch: issuer.fetch });
  const store = new MemoryStore();
  await store.adminUpdate({ op: 'init', installationId: 'inst-1', trustFingerprint: oidc.trustFingerprint });
  if (opts.enrolled !== false) Object.assign(store.installation ?? {}, { state: 'enrolled', binding: { ...OWNER } });
  return { issuer, store, core: createConnectCore({ appName: 'brain', store, oidc, ...opts.core }) };
}

export function request(path: string, cookies: (string | null)[] = [], init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  const jar = cookies.filter((c): c is string => !!c).join('; ');
  if (jar) headers.set('cookie', jar);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

/** `name=value` of a Set-Cookie for `name` with a non-empty value, or null. */
export function cookie(response: Response, name: string): string | null {
  const hit = response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`) && !c.startsWith(`${name}=;`));
  return hit?.split(';')[0] ?? null;
}

/** Plays the issuer for a started sign-in and delivers its callback. */
export async function finish(w: Wiring, start: Response, opts: FinishOptions = {}): Promise<Response> {
  const url = new URL(start.headers.get('location') ?? '');
  opts.tamper?.(url);
  const query = w.issuer.authorize(url.href, opts.claims, opts.state);
  return w.core.callback(request(`/auth/callback?${query}`, [cookie(start, TX)]));
}

export async function signIn(w: Wiring, opts: FinishOptions = {}): Promise<Response> {
  return finish(w, await w.core.login(request('/auth/login')), opts);
}

/** Bootstraps through the store (the operator's local command) and posts the capability. */
export async function startSetup(w: Wiring): Promise<Response> {
  const { capability, hash } = newSetupCapability();
  await w.store.adminUpdate({ op: 'bootstrap', capabilityHash: hash });
  return w.core.setup(request('/auth/setup', [], { method: 'POST', body: `capability=${capability}` }));
}
