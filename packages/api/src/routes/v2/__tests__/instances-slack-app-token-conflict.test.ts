/**
 * #1185, narrowed by slack-personal-oauth: instances behind one Slack app token
 * now SHARE one Socket Mode connection, and many members of a workspace
 * connecting personally (user mode) is the point of the feature — so one app
 * token is no longer a conflict by itself.
 *
 * What stays singular is the BOT identity of a workspace: two bot-mode
 * instances on one app token and one workspace would both answer as the same
 * bot user and handle every event twice. create / update / connect refuse only
 * that pair, keep the `SLACK_APP_TOKEN_IN_USE` code and the `force` escape, and
 * never echo the token.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const SELF_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'xapp-1-shared-secret';
const TEAM = 'T_WORKSPACE';
const OTHER_TEAM = 'T_ELSEWHERE';

function mount(others: Record<string, unknown>[], selfOverrides: Record<string, unknown> = {}) {
  const app = new Hono<{ Variables: AppVariables }>();
  const self = {
    id: SELF_ID,
    name: 'self',
    channel: 'slack',
    isActive: true,
    slackAppToken: TOKEN,
    slackBotToken: 'xoxb',
    slackAuthMode: 'bot',
    slackTeamId: TEAM,
    ...selfOverrides,
  };
  const calls = { create: 0, update: 0, connect: 0, connectOptions: [] as Record<string, unknown>[] };

  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        // listActive only returns active rows, mirroring the real service.
        listActive: mock(async () => [self, ...others].filter((i) => i.isActive)),
        getById: mock(async () => self),
        create: mock(async (data: Record<string, unknown>) => {
          calls.create++;
          return { ...data, id: SELF_ID };
        }),
        update: mock(async (_id: string, data: Record<string, unknown>) => {
          calls.update++;
          return { ...self, ...data };
        }),
        updateStatus: mock(async () => self),
      },
    } as never);
    c.set('channelRegistry', {
      get: () => ({
        id: 'slack',
        capabilities: {},
        connect: mock(async (_instanceId: string, config: { options?: Record<string, unknown> }) => {
          calls.connect++;
          calls.connectOptions.push(config.options ?? {});
        }),
        getStatus: mock(async () => ({ state: 'connected' })),
      }),
    } as never);
    c.set('apiKey', { id: 't', name: 't', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/instances', instancesRoutes);
  return { app, calls };
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const other = (overrides: Record<string, unknown> = {}) => ({
  id: OTHER_ID,
  name: 'fde-evaluator',
  channel: 'slack',
  isActive: true,
  slackAppToken: TOKEN,
  slackAuthMode: 'bot',
  slackTeamId: TEAM,
  ...overrides,
});

describe('shared Slack app token, bot identity (#1185 / slack-personal-oauth)', () => {
  test('a second bot-mode instance in the same workspace is refused, naming it, without leaking the token', async () => {
    const { app, calls } = mount([other()]);
    const res = await app.request(`/instances/${SELF_ID}/connect`, json({}));
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(text).toContain('SLACK_APP_TOKEN_IN_USE');
    expect(text).toContain('fde-evaluator');
    expect(text).toContain('one bot identity');
    expect(text).not.toContain(TOKEN);
    expect(calls.connect).toBe(0);
  });

  test('two user-mode instances on one app token are accepted', async () => {
    const { app, calls } = mount([other({ slackAuthMode: 'user', slackUserId: 'U_BEN' })], {
      slackAuthMode: 'user',
      slackUserId: 'U_ANA',
    });

    const connected = await app.request(`/instances/${SELF_ID}/connect`, json({}));
    expect(connected.status).toBe(200);
    expect(calls.connect).toBe(1);

    const created = await app.request(
      '/instances',
      json({ name: 'ana', channel: 'slack', slackAppToken: TOKEN, slackAuthMode: 'user' }),
    );
    expect(created.status).toBe(201);
    expect(calls.create).toBe(1);
  });

  test('a user-mode instance joining a workspace that already has the bot is accepted', async () => {
    const { app, calls } = mount([other()], { slackAuthMode: 'user', slackUserId: 'U_ANA' });
    const res = await app.request(`/instances/${SELF_ID}/connect`, json({}));
    expect(res.status).toBe(200);
    expect(calls.connect).toBe(1);
  });

  test('two bot-mode instances in DISTINCT known workspaces are accepted', async () => {
    const { app, calls } = mount([other({ slackTeamId: OTHER_TEAM })]);
    const res = await app.request(`/instances/${SELF_ID}/connect`, json({}));
    expect(res.status).toBe(200);
    expect(calls.connect).toBe(1);
  });

  test('create and update refuse a second bot-mode instance (workspace not known yet at create)', async () => {
    const { app, calls } = mount([other()]);
    const created = await app.request('/instances', json({ name: 'dup', channel: 'slack', slackAppToken: TOKEN }));
    expect(created.status).toBe(409);
    const updated = await app.request(`/instances/${SELF_ID}`, { ...json({ slackAppToken: TOKEN }), method: 'PATCH' });
    expect(updated.status).toBe(409);
    expect(calls.create + calls.update).toBe(0);
  });

  test('a mode-only PATCH onto a token that already carries the workspace bot is refused', async () => {
    // The conflict is keyed on the PAIR (token, bot mode), so flipping the mode
    // creates it just as moving the token would. The token is not in the body:
    // the guard must read it from the row.
    const { app, calls } = mount([other()], { slackAuthMode: 'user', slackUserId: 'U_ANA' });
    const res = await app.request(`/instances/${SELF_ID}`, { ...json({ slackAuthMode: 'bot' }), method: 'PATCH' });

    expect(res.status).toBe(409);
    const text = await res.text();
    expect(text).toContain('SLACK_APP_TOKEN_IN_USE');
    expect(text).toContain('fde-evaluator');
    expect(text).not.toContain(TOKEN);
    // Refused at the moment the impossible state was asked for, not stored and
    // then refused for ever by the connect path.
    expect(calls.update).toBe(0);
  });

  test('force: true still lets a mode-only PATCH through', async () => {
    const { app, calls } = mount([other()], { slackAuthMode: 'user', slackUserId: 'U_ANA' });
    const res = await app.request(`/instances/${SELF_ID}`, {
      ...json({ slackAuthMode: 'bot', force: true }),
      method: 'PATCH',
    });

    expect(res.status).toBe(200);
    expect(calls.update).toBe(1);
  });

  test('a mode-only PATCH that stays user-mode is accepted against the workspace bot', async () => {
    const { app, calls } = mount([other()], { slackAuthMode: 'user', slackUserId: 'U_ANA' });
    const res = await app.request(`/instances/${SELF_ID}`, { ...json({ slackAuthMode: 'user' }), method: 'PATCH' });

    expect(res.status).toBe(200);
    expect(calls.update).toBe(1);
  });

  test('create as a user-mode instance is accepted even against a bot-mode row on the same token', async () => {
    const { app, calls } = mount([other()]);
    const created = await app.request(
      '/instances',
      json({ name: 'personal', channel: 'slack', slackAppToken: TOKEN, slackAuthMode: 'user' }),
    );
    expect(created.status).toBe(201);
    expect(calls.create).toBe(1);
  });

  test('force: true overrides', async () => {
    const { app, calls } = mount([other()]);
    const res = await app.request(`/instances/${SELF_ID}/connect`, json({ force: true }));
    expect(res.status).toBe(200);
    const updated = await app.request(`/instances/${SELF_ID}`, {
      ...json({ slackAppToken: TOKEN, force: true }),
      method: 'PATCH',
    });
    expect(updated.status).toBe(200);
    expect(calls.connect).toBe(1);
  });

  test('force: true reaches the plugin as the `force` connect override, and is absent without it', async () => {
    // The 409 skip alone left the plugin's own SLACK_BOT_INSTANCE_EXISTS guard
    // armed, so the documented override died at this seam.
    const forced = mount([other()]);
    const res = await forced.app.request(`/instances/${SELF_ID}/connect`, json({ force: true }));
    expect(res.status).toBe(200);
    expect(forced.calls.connectOptions[0]?.force).toBe(true);

    // Same route, no override: the plugin must not see a force key at all.
    const plain = mount([]);
    const clean = await plain.app.request(`/instances/${SELF_ID}/connect`, json({}));
    expect(clean.status).toBe(200);
    expect(plain.calls.connectOptions[0]).not.toHaveProperty('force');

    // create + connect carries the override the same way.
    const created = mount([other()]);
    const createdRes = await created.app.request(
      '/instances',
      json({ name: 'dup', channel: 'slack', slackAppToken: TOKEN, force: true }),
    );
    expect(createdRes.status).toBe(201);
    expect(created.calls.connectOptions[0]?.force).toBe(true);
  });

  test('inactive duplicate is ignored', async () => {
    const { app } = mount([other({ isActive: false })]);
    const res = await app.request(`/instances/${SELF_ID}/connect`, json({}));
    expect(res.status).toBe(200);
  });

  test('different tokens are fine', async () => {
    const { app } = mount([other({ slackAppToken: 'xapp-1-different' })]);
    const res = await app.request(`/instances/${SELF_ID}/connect`, json({}));
    expect(res.status).toBe(200);
  });

  test('an unknown workspace on either side is still refused, since it cannot be cleared', async () => {
    const { app } = mount([other({ slackTeamId: null })]);
    const res = await app.request(`/instances/${SELF_ID}/connect`, json({}));
    expect(res.status).toBe(409);
  });
});
