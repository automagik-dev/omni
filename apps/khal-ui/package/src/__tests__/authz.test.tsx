import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { KhalAuthContext } from '@khal-os/sdk/app';
import type { KhalAuth, Role } from '@khal-os/sdk/app';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { omniExt } from '../api/ext';
import type { InstanceRow } from '../api/ext';
import { visibleNavGroups } from '../app/nav-visibility';
import { OmniClientProvider } from '../app/providers/OmniClientProvider';
import { SITEMAP } from '../app/sitemap';
import { RequireCapability } from '../auth/RequireCapability';
import {
  type Capability,
  can,
  isKnownRoleSlug,
  requirementReason,
  routeCapability,
  sessionRole,
} from '../auth/capabilities';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AgentStatePanel } from '../pages/agents/AgentStatePanel';
import { CreateInstanceDialog } from '../pages/instances/CreateInstanceDialog';
import { ActionButton } from '../pages/instances/components';
import { ConfigTab } from '../pages/instances/tabs/ConfigTab';
import { ConversationsPage } from '../pages/resources/ConversationsPage';
import { PersonsPage } from '../pages/resources/PersonsPage';
import { TtsVoicesPage } from '../pages/resources/TtsVoicesPage';
import { WebhookSourcesPage } from '../pages/resources/WebhookSourcesPage';

/**
 * Role-based gating is defense in depth over the BFF boundary. These tests
 * exercise every tier — `member` (read-only), `platform-dev` (operator),
 * `platform-admin` (full console) — plus the two fail-closed cases: no auth
 * context at all (`null`), and a session still resolving (`loading`).
 */

function auth(role: string, extra: Partial<KhalAuth> = {}): KhalAuth {
  return { userId: 'u', orgId: 'o', role, permissions: [], loading: false, ...extra };
}

/** SSR-render an element under a fake KhalAuthContext value (or none for `null`). */
function renderAs(value: KhalAuth | null, el: ReactElement): string {
  return renderToStaticMarkup(<KhalAuthContext.Provider value={value}>{el}</KhalAuthContext.Provider>);
}

// ── Pure capability model ──────────────────────────────────────────────────────

describe('capability model', () => {
  const cases: Array<[string, Capability, boolean]> = [
    ['member', 'read', true],
    ['member', 'operate', false],
    ['member', 'administer', false],
    ['platform-dev', 'read', true],
    ['platform-dev', 'operate', true],
    ['platform-dev', 'administer', false],
    ['platform-admin', 'read', true],
    ['platform-admin', 'operate', true],
    ['platform-admin', 'administer', true],
    ['platform-owner', 'administer', true],
  ];

  for (const [role, cap, expected] of cases) {
    test(`${role} ${expected ? 'can' : 'cannot'} ${cap}`, () => {
      expect(can(auth(role), cap)).toBe(expected);
    });
  }

  test('aliases normalize before comparison (admin ⇒ platform-admin)', () => {
    expect(can(auth('admin'), 'administer')).toBe(true);
    expect(can(auth('developer'), 'operate')).toBe(true);
    expect(can(auth('viewer'), 'operate')).toBe(false);
  });

  test('fails closed for null / loading / unknown slug', () => {
    expect(can(null, 'read')).toBe(false);
    expect(can(undefined, 'read')).toBe(false);
    expect(can(auth('member', { loading: true }), 'read')).toBe(false);
    // An unrecognised slug must NOT fail open to member/read-everything.
    expect(can(auth('org-guest'), 'read')).toBe(false);
    expect(can(auth(''), 'read')).toBe(false);
  });

  test('sessionRole only resolves recognised, non-loading sessions', () => {
    expect(sessionRole(auth('platform-dev'))).toBe('platform-dev' as Role);
    expect(sessionRole(auth('admin'))).toBe('platform-admin' as Role);
    expect(sessionRole(null)).toBeNull();
    expect(sessionRole(auth('member', { loading: true }))).toBeNull();
    expect(sessionRole(auth('bogus-role'))).toBeNull();
  });

  test('isKnownRoleSlug distinguishes canonical/alias from unknown', () => {
    expect(isKnownRoleSlug('platform-owner')).toBe(true);
    expect(isKnownRoleSlug('owner')).toBe(true);
    expect(isKnownRoleSlug('org-guest')).toBe(false);
    expect(isKnownRoleSlug(undefined)).toBe(false);
  });

  test('admin routes require administer; everything else is a read view', () => {
    expect(routeCapability('/api-keys')).toBe('administer');
    expect(routeCapability('/trust-hosts')).toBe('administer');
    expect(routeCapability('/settings')).toBe('administer');
    expect(routeCapability('/chat')).toBe('read');
    expect(routeCapability('/instances')).toBe('read');
  });
});

// ── Route/view gate ────────────────────────────────────────────────────────────

describe('RequireCapability (view gate)', () => {
  const view = <div>SECRET-KEY-CONSOLE</div>;

  test('renders the view when the role qualifies (platform-admin ⇒ administer)', () => {
    const html = renderAs(
      auth('platform-admin'),
      <RequireCapability capability="administer">{view}</RequireCapability>,
    );
    expect(html).toContain('SECRET-KEY-CONSOLE');
    expect(html).not.toContain('Access denied');
  });

  test('denies an operator (platform-dev) the admin view', () => {
    const html = renderAs(auth('platform-dev'), <RequireCapability capability="administer">{view}</RequireCapability>);
    expect(html).not.toContain('SECRET-KEY-CONSOLE');
    expect(html).toContain('Access denied');
  });

  test('denies a viewer (member) an operate-gated view', () => {
    const html = renderAs(auth('member'), <RequireCapability capability="operate">{view}</RequireCapability>);
    expect(html).not.toContain('SECRET-KEY-CONSOLE');
    expect(html).toContain('Access denied');
  });

  test('fails closed with no auth context (null ⇒ denied, not allowed)', () => {
    const html = renderAs(null, <RequireCapability capability="read">{view}</RequireCapability>);
    expect(html).not.toContain('SECRET-KEY-CONSOLE');
    expect(html).toContain('Access denied');
  });

  test('shows a neutral "checking" state while the session resolves', () => {
    const html = renderAs(
      auth('member', { loading: true }),
      <RequireCapability capability="read">{view}</RequireCapability>,
    );
    expect(html).not.toContain('SECRET-KEY-CONSOLE');
    expect(html).not.toContain('Access denied');
    expect(html).toContain('Checking access');
  });
});

// ── Nav visibility (sidebar + palette) ──────────────────────────────────────────

describe('visibleNavGroups', () => {
  function pathsFor(value: KhalAuth | null): Set<string> {
    const groups = visibleNavGroups(SITEMAP, (cap) => can(value, cap));
    return new Set(groups.flatMap((g) => g.items.map((i) => i.path)));
  }

  test('member sees read routes but not admin routes', () => {
    const paths = pathsFor(auth('member'));
    expect(paths.has('/chat')).toBe(true);
    expect(paths.has('/api-keys')).toBe(false);
    expect(paths.has('/settings')).toBe(false);
  });

  test('platform-admin sees the admin routes', () => {
    const paths = pathsFor(auth('platform-admin'));
    expect(paths.has('/api-keys')).toBe(true);
    expect(paths.has('/settings')).toBe(true);
  });

  test('null session (fail closed) sees nothing', () => {
    expect(pathsFor(null).size).toBe(0);
  });
});

// ── Action gate: ActionButton ──────────────────────────────────────────────────

describe('ActionButton (live mutation)', () => {
  function render(value: KhalAuth | null): string {
    return renderAs(
      value,
      <ActionButton label="Revoke Key" effect="live" targetName="key-1" targetId="1" run={async () => ({})} />,
    );
  }

  test('operator (platform-dev) gets an enabled control', () => {
    const html = render(auth('platform-dev'));
    expect(html).toContain('Revoke Key');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('Requires the Platform Dev role');
  });

  test('viewer (member) gets a disabled control with the reason', () => {
    const html = render(auth('member'));
    expect(html).toContain('disabled=""');
    expect(html).toContain('Requires the Platform Dev role or higher');
  });

  test('fails closed with no auth context (null ⇒ disabled)', () => {
    const html = render(null);
    expect(html).toContain('disabled=""');
    expect(html).toContain('Requires the Platform Dev role or higher');
  });

  test('a read-only effect is not role-gated (any qualifying viewer can run it)', () => {
    const html = renderAs(
      auth('member'),
      <ActionButton label="Ping" effect="read-only" targetName="x" targetId="1" run={async () => ({})} />,
    );
    expect(html).toContain('Ping');
    expect(html).not.toContain('disabled=""');
  });
});

// ── Action gate: ConfirmDialog is the central mutation gate ─────────────────────

describe('ConfirmDialog (central mutation gate)', () => {
  function render(value: KhalAuth | null): string {
    return renderToStaticMarkup(
      <KhalAuthContext.Provider value={value}>
        <ConfirmDialog
          open
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete instance"
          targetName="inst-1"
          targetId="1"
          effect="live"
        />
      </KhalAuthContext.Provider>,
    );
  }

  test('a live action below operate shows the not-permitted notice', () => {
    const html = render(auth('member'));
    expect(html).toContain('Not permitted for your role');
  });

  test('null session (fail closed) is also blocked', () => {
    const html = render(null);
    expect(html).toContain('Not permitted for your role');
  });

  test('an operator is not blocked and reaches the confirmation input', () => {
    const html = render(auth('platform-dev'));
    expect(html).not.toContain('Not permitted for your role');
    expect(html).toContain('to confirm');
  });
});

// ── Read-tier page write affordances (defense in depth) ─────────────────────────

/**
 * Mutating controls on read-tier pages (create/edit/toggle/write) must not be
 * live for a `member`. These pages read live data through TanStack Query and the
 * Omni `ext` layer, so each renders under a QueryClient + OmniClientProvider. The
 * gate surfaces the same denial copy as the rest of the pack, keyed on the role
 * requirement — present for `member`, absent for `platform-dev`.
 */
function renderPage(value: KhalAuth | null, el: ReactElement, seed?: (qc: QueryClient) => void): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(qc);
  return renderToStaticMarkup(
    <KhalAuthContext.Provider value={value}>
      <QueryClientProvider client={qc}>
        <OmniClientProvider bffBase="/omni">{el}</OmniClientProvider>
      </QueryClientProvider>
    </KhalAuthContext.Provider>,
  );
}

const OPERATE_REASON = requirementReason('operate');

describe('read-tier write affordances require operate', () => {
  test('WebhookSourcesPage create is role-blocked for member, not for platform-dev', () => {
    expect(renderPage(auth('member'), <WebhookSourcesPage />)).toContain(OPERATE_REASON);
    expect(renderPage(auth('platform-dev'), <WebhookSourcesPage />)).not.toContain(OPERATE_REASON);
  });

  test('WebhookSourcesPage create is also blocked for a null session (fail closed)', () => {
    expect(renderPage(null, <WebhookSourcesPage />)).toContain(OPERATE_REASON);
  });

  test('ConversationsPage create form is disabled with the reason for member only', () => {
    const memberHtml = renderPage(auth('member'), <ConversationsPage />);
    expect(memberHtml).toContain(OPERATE_REASON);
    expect(memberHtml).toContain('disabled=""');
    expect(renderPage(auth('platform-dev'), <ConversationsPage />)).not.toContain(OPERATE_REASON);
  });

  test('AgentStatePanel write is role-blocked for member, not for platform-dev', () => {
    // Agent id supplied + locked; the write button is additionally role-gated.
    expect(renderPage(auth('member'), <AgentStatePanel agentId="a-1" lockAgentId />)).toContain(OPERATE_REASON);
    expect(renderPage(auth('platform-dev'), <AgentStatePanel agentId="a-1" lockAgentId />)).not.toContain(
      OPERATE_REASON,
    );
  });

  test('AgentStatePanel keeps the read control ungated (read-only effect)', () => {
    // The "Read state" button is present for a member — reads are never role-gated.
    expect(renderPage(auth('member'), <AgentStatePanel agentId="a-1" lockAgentId />)).toContain('Read state');
  });

  test('CreateInstanceDialog create form is disabled with the reason for member only', () => {
    // Open with a channel already chosen so the create form (not the picker) renders.
    const dialog = <CreateInstanceDialog open initialChannel="whatsapp" onClose={() => {}} onCreated={() => {}} />;
    const memberHtml = renderPage(auth('member'), dialog);
    expect(memberHtml).toContain(OPERATE_REASON);
    expect(memberHtml).toContain('disabled=""');
    expect(renderPage(auth('platform-dev'), dialog)).not.toContain(OPERATE_REASON);
  });

  test('TtsVoicesPage set-default is role-blocked for member, not for platform-dev', () => {
    // Seed the voice catalog so a VoiceCard (with its gated "Set default") renders.
    const seed = (qc: QueryClient) =>
      qc.setQueryData(['tts', 'voices'], { data: { voices: [{ id: 'v1', name: 'Aria' }] } });
    expect(renderPage(auth('member'), <TtsVoicesPage />, seed)).toContain(OPERATE_REASON);
    expect(renderPage(auth('platform-dev'), <TtsVoicesPage />, seed)).not.toContain(OPERATE_REASON);
  });

  test('PersonsPage profile save is disabled with the reason for member only', () => {
    // Open with a person selected so the profile edit form renders.
    const memberHtml = renderPage(auth('member'), <PersonsPage initialSelectedId="p-1" />);
    expect(memberHtml).toContain(OPERATE_REASON);
    expect(memberHtml).toContain('disabled=""');
    expect(renderPage(auth('platform-dev'), <PersonsPage initialSelectedId="p-1" />)).not.toContain(OPERATE_REASON);
  });

  test('ConfigTab save forms are role-blocked for member, not for platform-dev', () => {
    const instance = { id: 'i1', name: 'Test', channel: 'whatsapp' } as unknown as InstanceRow;
    const tab = <ConfigTab instance={instance} isProduction={false} refetchInstance={() => {}} />;
    const memberHtml = renderPage(auth('member'), tab);
    expect(memberHtml).toContain(OPERATE_REASON);
    expect(memberHtml).toContain('disabled=""');
    expect(renderPage(auth('platform-dev'), tab)).not.toContain(OPERATE_REASON);
  });
});

// ── Identity-token forwarding ───────────────────────────────────────────────────

describe('identity token forwarding (ext layer)', () => {
  const realFetch = globalThis.fetch;
  let seen: { url: string; headers: Record<string, string> };

  beforeEach(() => {
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      seen = { url: String(url), headers: { ...((init?.headers as Record<string, string>) ?? {}) } };
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('attaches Authorization: Bearer <token> when present', async () => {
    await omniExt('/omni', 'jwt-abc').trust.listHosts();
    expect(seen.url).toBe('/omni/api/v2/trust/hosts');
    expect(seen.headers.Authorization).toBe('Bearer jwt-abc');
  });

  test('omits the header when no token (dev harness) — does not throw', async () => {
    await omniExt('/omni').trust.listHosts();
    expect(seen.headers.Authorization).toBeUndefined();
  });

  test('token rides alongside a JSON body on mutations', async () => {
    await omniExt('/omni', 'jwt-xyz').trust.patchScopes('h1', ['read']);
    expect(seen.headers.Authorization).toBe('Bearer jwt-xyz');
    expect(seen.headers['Content-Type']).toBe('application/json');
  });

  test('metrics text also forwards the token', async () => {
    await omniExt('/omni', 'jwt-m').metrics.text();
    expect(seen.headers.Authorization).toBe('Bearer jwt-m');
  });
});
