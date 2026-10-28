/**
 * Updates the owner confirms (system/update.ts), with the registry, the owner's self chat,
 * the request store and the update command all faked: no real update, no real service.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { SpawnOptions } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventBus } from '@omni/core';
import { Hono } from 'hono';
import { updateCodeInMessage } from '../../login/update-requests';
import type { UpdateRequest, UpdateRequestStore } from '../../login/update-requests';
import type { OwnAccount } from '../../login/whatsapp';
import { systemRoutes } from '../../routes/v2/system';
import type { AppVariables } from '../../types';
import {
  MAX_WRONG_CODES,
  type OwnerChannel,
  UPDATE_GRACE_MS,
  type UpdateChild,
  createSystemUpdater,
  readUpdateConfig,
} from '../update';

const OWNER: OwnAccount = {
  instanceId: '11111111-1111-4111-8111-111111111111',
  instanceName: 'owner-whatsapp',
  phone: '5511999990000',
  selfJid: '5511999990000@s.whatsapp.net',
};
const CURRENT = '2.261023.7';
const LATEST = '2.261023.8';

let dir: string;
let sent: string[];
let events: { type: string; payload: Record<string, unknown> }[];
let spawned: { command: string; args: string[]; options: SpawnOptions; child: FakeChild }[];
let fetched: string[];
let tags: Record<string, string> | 'fail';
let account: OwnAccount | null;

class FakeChild implements UpdateChild {
  errorListener?: (error: Error) => void;
  exitListener?: (code: number | null, signal: string | null) => void;
  unrefed = false;
  onError(listener: (error: Error) => void) {
    this.errorListener = listener;
  }
  onExit(listener: (code: number | null, signal: string | null) => void) {
    this.exitListener = listener;
  }
  unref() {
    this.unrefed = true;
  }
}

/** The database store's behaviour in memory: hashed by code, single use, ten minutes. */
function memoryStore(
  now: () => number,
): UpdateRequestStore & { rows: Map<string, { request: UpdateRequest; expiresAt: Date }> } {
  const rows = new Map<string, { request: UpdateRequest; expiresAt: Date }>();
  const live = () => [...rows].filter(([, row]) => row.expiresAt.getTime() > now());
  let next = 0;
  return {
    rows,
    pending: async () => live()[0]?.[1] ?? null,
    create: async (request) => {
      const code = ['K7QM2X', 'H3RT9P', 'Z2ABCD'][next++ % 3] as string;
      const expiresAt = new Date(now() + 10 * 60 * 1000);
      rows.set(code, { request, expiresAt });
      return { code, expiresAt };
    },
    consume: async (code) => {
      const row = rows.get(code);
      rows.delete(code);
      return row && row.expiresAt.getTime() > now() ? row.request : null;
    },
    cancel: async () => rows.clear(),
  };
}

function setup(env: Record<string, string> = {}, options: { version?: string; clock?: { at: number } } = {}) {
  const clock = options.clock ?? { at: Date.now() };
  const now = () => clock.at;
  const requests = memoryStore(now);
  const owner: OwnerChannel = {
    account: async () => account,
    send: async (_account, _key, text) => {
      sent.push(text);
    },
  };
  const eventBus = {
    publishGeneric: async (type: string, payload: Record<string, unknown>) => {
      events.push({ type, payload });
      return { id: 'e', sequence: 1 };
    },
  } as unknown as EventBus;
  const updater = createSystemUpdater({
    version: options.version ?? CURRENT,
    login: null,
    eventBus,
    owner,
    requests,
    env: { OMNI_UPDATE_STATE_DIR: dir, ...env },
    now,
    fetch: async (url) => {
      fetched.push(url);
      if (tags === 'fail') throw new Error('offline');
      return new Response(JSON.stringify(tags), { status: 200 });
    },
    spawn: (command, args, spawnOptions) => {
      const child = new FakeChild();
      spawned.push({ command, args, options: spawnOptions, child });
      return child;
    },
  });
  return { updater, requests, clock };
}

const stateFile = () => join(dir, 'system-update.json');
const lastCode = () => sent.at(-1)?.match(/^update ([A-Z0-9]{6})$/m)?.[1] ?? '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'omni-update-'));
  sent = [];
  events = [];
  spawned = [];
  fetched = [];
  tags = { latest: LATEST, next: '2.261024.1-rc.1' };
  account = OWNER;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('update config', () => {
  test('off unless OMNI_UPDATE_COMMAND is set; its words are argv, no shell', () => {
    expect(readUpdateConfig(CURRENT, {}).command).toBeNull();
    expect(readUpdateConfig(CURRENT, { OMNI_UPDATE_COMMAND: '   ' }).command).toBeNull();
    expect(readUpdateConfig(CURRENT, { OMNI_UPDATE_COMMAND: 'omni update  --yes' }).command).toEqual([
      'omni',
      'update',
      '--yes',
    ]);
  });

  test('a JSON array of strings is argv as it is, for words that hold a space', () => {
    const command = '["/Users/me/My Omni/bun", "omni", "sandbox", "update"]';
    expect(readUpdateConfig(CURRENT, { OMNI_UPDATE_COMMAND: command }).command).toEqual([
      '/Users/me/My Omni/bun',
      'omni',
      'sandbox',
      'update',
    ]);
    expect(readUpdateConfig(CURRENT, { OMNI_UPDATE_COMMAND: '["omni", 3]' }).command).toBeNull();
    expect(readUpdateConfig(CURRENT, { OMNI_UPDATE_COMMAND: '[not json' }).command).toBeNull();
    expect(readUpdateConfig(CURRENT, { OMNI_UPDATE_COMMAND: '[]' }).command).toBeNull();
  });

  test("the app's yes counts only on an Omni that listens on loopback alone", () => {
    expect(readUpdateConfig(CURRENT, {}).confirm).toBe('whatsapp');
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      expect(readUpdateConfig(CURRENT, { OMNI_UPDATE_CONFIRM: 'app', API_HOST: host }).confirm).toBe('app');
    }
    for (const host of ['0.0.0.0', '::', '192.168.0.10', '']) {
      expect(readUpdateConfig(CURRENT, { OMNI_UPDATE_CONFIRM: 'app', API_HOST: host }).confirm).toBe('whatsapp');
    }
    expect(readUpdateConfig(CURRENT, { OMNI_UPDATE_CONFIRM: 'app' }).confirm).toBe('whatsapp');
    expect(readUpdateConfig(CURRENT, { OMNI_UPDATE_CONFIRM: 'yes', API_HOST: '127.0.0.1' }).confirm).toBe('whatsapp');
  });

  test('a prerelease follows next and a release latest, unless the operator says otherwise', () => {
    expect(readUpdateConfig('2.261023.6-labs.2', {}).channel).toBe('next');
    expect(readUpdateConfig(CURRENT, {}).channel).toBe('latest');
    expect(readUpdateConfig(CURRENT, { OMNI_UPDATE_CHANNEL: 'next' }).channel).toBe('next');
    expect(readUpdateConfig(CURRENT, { OMNI_UPDATE_CHANNEL: 'homolog' }).channel).toBe('latest');
  });
});

describe('update status', () => {
  test('says what runs and what the channel publishes, read once per ten minutes', async () => {
    const { updater, clock } = setup();
    expect(await updater.status()).toEqual({
      current: CURRENT,
      channel: 'latest',
      latest: LATEST,
      updateAvailable: true,
      mode: 'off',
      confirm: 'whatsapp',
    });
    await updater.status();
    expect(fetched).toEqual(['https://registry.npmjs.org/-/package/%40automagik%2Fomni/dist-tags']);
    clock.at += 10 * 60 * 1000;
    await updater.status();
    expect(fetched.length).toBe(2);
  });

  test('a registry that cannot be read reads as unknown, never as an error', async () => {
    tags = 'fail';
    const { updater } = setup({ OMNI_UPDATE_COMMAND: 'omni update --yes' });
    expect(await updater.status()).toMatchObject({ latest: null, updateAvailable: false, mode: 'command' });
    expect(await updater.request(LATEST, 'key-1')).toMatchObject({
      ok: false,
      status: 503,
      code: 'REGISTRY_UNAVAILABLE',
    });
  });

  test('an older published version is no update', async () => {
    const { updater } = setup({}, { version: '2.261024.1' });
    expect((await updater.status()).updateAvailable).toBe(false);
  });

  test('OMNI_UPDATE_CHECK=false (an embedded sandbox): the registry is never read, and updates are off', async () => {
    expect(readUpdateConfig(CURRENT, {}).check).toBe(true);
    const off = readUpdateConfig(CURRENT, { OMNI_UPDATE_CHECK: 'false', OMNI_UPDATE_COMMAND: 'omni update --yes' });
    expect(off.check).toBe(false);
    expect(off.command).toBeNull();
    for (const value of ['0', 'off', ' OFF '])
      expect(readUpdateConfig(CURRENT, { OMNI_UPDATE_CHECK: value }).check).toBe(false);
    expect(readUpdateConfig(CURRENT, { OMNI_UPDATE_CHECK: 'true' }).check).toBe(true);
    const { updater } = setup({
      OMNI_UPDATE_CHECK: 'false',
      OMNI_UPDATE_COMMAND: 'omni update --yes',
      OMNI_UPDATE_CONFIRM: 'app',
      API_HOST: '127.0.0.1',
    });
    expect(await updater.status()).toMatchObject({ latest: null, updateAvailable: false, mode: 'off' });
    expect(await updater.request(LATEST, 'key-1')).toMatchObject({ ok: false, code: 'UPDATE_NOT_CONFIGURED' });
    expect(fetched).toEqual([]);
    expect(spawned).toEqual([]);
  });
});

describe('asking for an update', () => {
  test('is refused while updates are off (the default)', async () => {
    const { updater } = setup();
    expect(await updater.request(LATEST, 'key-1')).toMatchObject({
      ok: false,
      status: 409,
      code: 'UPDATE_NOT_CONFIGURED',
    });
    expect(sent).toEqual([]);
  });

  test('needs the owner on WhatsApp to confirm', async () => {
    account = null;
    const { updater } = setup({ OMNI_UPDATE_COMMAND: 'omni update --yes' });
    expect(await updater.request(LATEST, 'key-1')).toMatchObject({ code: 'CONFIRM_CHANNEL_MISSING' });
  });

  test('takes only the version the channel publishes now', async () => {
    const { updater } = setup({ OMNI_UPDATE_COMMAND: 'omni update --yes' });
    expect(await updater.request('2.261023.9', 'key-1')).toMatchObject({ status: 409, code: 'VERSION_MISMATCH' });
    expect(await updater.request('9.9.9', 'key-1')).toMatchObject({ code: 'VERSION_MISMATCH' });
    expect(sent).toEqual([]);
    const current = setup({ OMNI_UPDATE_COMMAND: 'omni update --yes' }, { version: LATEST });
    expect(await current.updater.request(LATEST, 'key-1')).toMatchObject({ code: 'ALREADY_CURRENT' });
  });

  test('asks the owner in their self chat, once at a time', async () => {
    const { updater, requests } = setup({ OMNI_UPDATE_COMMAND: 'omni update --yes' });
    const [first, second] = await Promise.all([updater.request(LATEST, 'key-1'), updater.request(LATEST, 'key-2')]);
    expect(first).toMatchObject({ ok: true, version: LATEST });
    expect(second).toMatchObject({ ok: false, code: 'UPDATE_PENDING' });
    expect(requests.rows.size).toBe(1);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain(`from ${CURRENT} to ${LATEST}`);
    expect(updateCodeInMessage(`update ${lastCode()}`)).toBe(lastCode());
    expect(events.map((event) => event.type)).toEqual(['system.update.requested']);
    expect(events[0]?.payload).toMatchObject({ from: CURRENT, to: LATEST, requestedBy: 'key-1' });
    expect(JSON.stringify(events)).not.toContain(lastCode());
    expect(await updater.request(LATEST, 'key-3')).toMatchObject({ code: 'UPDATE_PENDING' });
    expect((await updater.status()).pending).toMatchObject({ version: LATEST });
  });
});

describe("the owner's yes", () => {
  test('runs the command detached, as argv with no shell, with the version in its environment', async () => {
    const { updater } = setup({ OMNI_UPDATE_COMMAND: '/usr/local/bin/omni update --yes' });
    await updater.request(LATEST, 'key-1');
    expect(await updater.confirm(lastCode(), OWNER)).toBe('started');

    expect(spawned.length).toBe(1);
    const [run] = spawned;
    expect(run?.command).toBe('/usr/local/bin/omni');
    expect(run?.args).toEqual(['update', '--yes']);
    expect(run?.options).toMatchObject({ detached: true, shell: false, stdio: 'ignore' });
    expect(run?.options.env?.OMNI_UPDATE_VERSION).toBe(LATEST);
    expect(run?.child.unrefed).toBe(true);
    expect(JSON.parse(readFileSync(stateFile(), 'utf8'))).toMatchObject({ from: CURRENT, to: LATEST });
    expect(events.map((event) => event.type)).toEqual([
      'system.update.requested',
      'system.update.confirmed',
      'system.update.started',
    ]);
    expect(sent.at(-1)).toContain(`Updating Omni from ${CURRENT} to ${LATEST}`);
    expect(await updater.status()).toMatchObject({ inFlight: { version: LATEST } });
    expect(await updater.request(LATEST, 'key-1')).toMatchObject({ code: 'UPDATE_IN_PROGRESS' });
  });

  test('a code works once', async () => {
    const { updater } = setup({ OMNI_UPDATE_COMMAND: 'omni update --yes' });
    await updater.request(LATEST, 'key-1');
    const code = lastCode();
    expect(await updater.confirm(code, OWNER)).toBe('started');
    expect(await updater.confirm(code, OWNER)).toBeNull();
    expect(spawned.length).toBe(1);
  });

  test('an expired code starts nothing', async () => {
    const { updater, clock } = setup({ OMNI_UPDATE_COMMAND: 'omni update --yes' });
    await updater.request(LATEST, 'key-1');
    clock.at += 10 * 60 * 1000 + 1;
    expect(await updater.confirm(lastCode(), OWNER)).toBeNull();
    expect(spawned).toEqual([]);
  });

  test('wrong codes are answered, and too many cancel the request', async () => {
    const { updater, requests } = setup({ OMNI_UPDATE_COMMAND: 'omni update --yes' });
    // Nothing waiting: an "update" code is not an answer to anything.
    expect(await updater.confirm('AAAAAA', OWNER)).toBeNull();
    expect(sent).toEqual([]);
    await updater.request(LATEST, 'key-1');
    for (let i = 1; i < MAX_WRONG_CODES; i++) expect(await updater.confirm('AAAAAA', OWNER)).toBe('wrong-code');
    expect(sent.at(-1)).toContain("doesn't match");
    expect(await updater.confirm('AAAAAA', OWNER)).toBe('cancelled');
    expect(sent.at(-1)).toContain('cancelled the update');
    expect(requests.rows.size).toBe(0);
    expect(spawned).toEqual([]);
  });

  test('a command that fails before the restart ends the update and says so', async () => {
    const { updater } = setup({ OMNI_UPDATE_COMMAND: 'omni update --yes' });
    await updater.request(LATEST, 'key-1');
    await updater.confirm(lastCode(), OWNER);
    spawned[0]?.child.exitListener?.(1, null);
    await Bun.sleep(20);
    expect(existsSync(stateFile())).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: 'system.update.finished',
      payload: { ok: false, reason: 'exited with 1' },
    });
    expect(sent.at(-1)).toBe(`🐙 The update to ${LATEST} did not complete; Omni is still on ${CURRENT}.`);
    // Settled once: a late error from the same child changes nothing.
    spawned[0]?.child.errorListener?.(new Error('late'));
    await Bun.sleep(20);
    expect(events.filter((event) => event.type === 'system.update.finished').length).toBe(1);
  });

  test('a command that cannot start ends the update', async () => {
    const { updater } = setup({ OMNI_UPDATE_COMMAND: 'omni update --yes' });
    await updater.request(LATEST, 'key-1');
    await updater.confirm(lastCode(), OWNER);
    spawned[0]?.child.errorListener?.(new Error('ENOENT'));
    await Bun.sleep(20);
    expect(existsSync(stateFile())).toBe(false);
    expect(events.at(-1)?.payload).toMatchObject({ ok: false });
  });
});

describe("the app's yes, on a loopback-only Omni", () => {
  const APP = { OMNI_UPDATE_COMMAND: 'omni sandbox update', OMNI_UPDATE_CONFIRM: 'app', API_HOST: '127.0.0.1' };

  test('the request starts the update at once, with no WhatsApp', async () => {
    account = null;
    const { updater, requests } = setup(APP);
    expect((await updater.status()).confirm).toBe('app');
    const result = await updater.request(LATEST, 'key-1');
    expect(result).toMatchObject({ ok: true, status: 'started', version: LATEST });
    expect(requests.rows.size).toBe(0);
    expect(sent).toEqual([]);
    expect(spawned.length).toBe(1);
    expect(spawned[0]?.args).toEqual(['sandbox', 'update']);
    expect(spawned[0]?.options).toMatchObject({ detached: true, shell: false, stdio: 'ignore' });
    expect(spawned[0]?.options.env?.OMNI_UPDATE_VERSION).toBe(LATEST);
    expect(JSON.parse(readFileSync(stateFile(), 'utf8'))).toMatchObject({ from: CURRENT, to: LATEST });
    expect(events.map((event) => event.type)).toEqual([
      'system.update.requested',
      'system.update.confirmed',
      'system.update.started',
    ]);
    expect(events[1]?.payload).toMatchObject({ confirmedBy: 'app' });
    expect(await updater.status()).toMatchObject({ inFlight: { version: LATEST } });
    expect(await updater.request(LATEST, 'key-2')).toMatchObject({ code: 'UPDATE_IN_PROGRESS' });
    expect(spawned.length).toBe(1);
  });

  test('takes only the version the channel publishes now, and never while updates are off', async () => {
    const { updater } = setup(APP);
    expect(await updater.request('2.261023.9', 'key-1')).toMatchObject({ code: 'VERSION_MISMATCH' });
    const off = setup({ OMNI_UPDATE_CONFIRM: 'app', API_HOST: '127.0.0.1' });
    expect(await off.updater.request(LATEST, 'key-1')).toMatchObject({ code: 'UPDATE_NOT_CONFIGURED' });
    expect(spawned).toEqual([]);
  });

  test('a command that cannot start is refused and settled', async () => {
    const { updater } = setup(APP);
    const failing = createSystemUpdater({
      version: CURRENT,
      login: null,
      eventBus: null,
      owner: null,
      requests: null,
      env: { OMNI_UPDATE_STATE_DIR: dir, ...APP },
      fetch: async () => new Response(JSON.stringify(tags), { status: 200 }),
      spawn: () => {
        throw new Error('ENOENT');
      },
    });
    expect(await failing.request(LATEST, 'key-1')).toMatchObject({ ok: false, code: 'UPDATE_START_FAILED' });
    expect(existsSync(stateFile())).toBe(false);
    expect((await updater.status()).inFlight).toBeUndefined();
  });

  test('on an Omni the network can reach, the setting is ignored and WhatsApp confirms', async () => {
    account = null;
    const { updater } = setup({ ...APP, API_HOST: '0.0.0.0' });
    expect((await updater.status()).confirm).toBe('whatsapp');
    expect(await updater.request(LATEST, 'key-1')).toMatchObject({ code: 'CONFIRM_CHANNEL_MISSING' });
    expect(spawned).toEqual([]);
  });
});

describe('after the restart', () => {
  const record = (startedAt: number) =>
    writeFileSync(
      stateFile(),
      JSON.stringify({ id: 'u1', from: CURRENT, to: LATEST, startedAt: new Date(startedAt).toISOString() }),
    );

  test('an Omni on the new version says it updated', async () => {
    const clock = { at: Date.now() };
    record(clock.at - 60_000);
    const { updater } = setup({}, { version: LATEST, clock });
    expect(await updater.reconcile()).toBe('updated');
    expect(sent).toEqual([`🐙 *Omni updated to ${LATEST}.*`]);
    expect(events).toEqual([
      {
        type: 'system.update.finished',
        payload: { id: 'u1', from: CURRENT, to: LATEST, ok: true, reason: 'running the new version' },
      },
    ]);
    expect(existsSync(stateFile())).toBe(false);
    expect(await updater.reconcile()).toBeNull();
  });

  test('an Omni still on the old version after the grace period says the update did not complete', async () => {
    const clock = { at: Date.now() };
    record(clock.at - UPDATE_GRACE_MS - 1);
    const { updater } = setup({}, { clock });
    expect(await updater.reconcile()).toBe('not-completed');
    expect(sent).toEqual([`🐙 The update to ${LATEST} did not complete; Omni is still on ${CURRENT}.`]);
    expect(existsSync(stateFile())).toBe(false);
  });

  test('an Omni restarted mid-update waits out the grace period', async () => {
    const clock = { at: Date.now() };
    record(clock.at - 60_000);
    const { updater } = setup({}, { clock });
    expect(await updater.reconcile()).toBe('waiting');
    expect(sent).toEqual([]);
    expect(existsSync(stateFile())).toBe(true);
  });

  test('nothing recorded, nothing said', async () => {
    const { updater } = setup();
    expect(await updater.reconcile()).toBeNull();
    writeFileSync(stateFile(), '{"not":"a record"}');
    expect(await updater.reconcile()).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe('the routes', () => {
  test('GET says the status; POST validates the body and maps each refusal', async () => {
    const { updater } = setup({ OMNI_UPDATE_COMMAND: 'omni update --yes' });
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('updater', updater);
      await next();
    });
    app.route('/', systemRoutes);
    const get = await app.request('/update');
    expect(get.status).toBe(200);
    expect(((await get.json()) as { data: { latest: string } }).data.latest).toBe(LATEST);

    const post = (body: unknown) =>
      app.request('/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post({ version: 'latest' })).status).toBe(400);
    expect((await post({ version: LATEST, extra: true })).status).toBe(400);
    const mismatch = await post({ version: '2.261023.9' });
    expect(mismatch.status).toBe(409);
    expect(((await mismatch.json()) as { error: { code: string } }).error.code).toBe('VERSION_MISMATCH');
    const asked = await post({ version: LATEST });
    expect(asked.status).toBe(202);
    expect(((await asked.json()) as { data: unknown }).data).toMatchObject({
      status: 'awaiting-confirmation',
      version: LATEST,
    });
  });

  test('POST on an Omni the app confirms says the update started', async () => {
    const { updater } = setup({
      OMNI_UPDATE_COMMAND: 'omni sandbox update',
      OMNI_UPDATE_CONFIRM: 'app',
      API_HOST: '::1',
    });
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('updater', updater);
      await next();
    });
    app.route('/', systemRoutes);
    const started = await app.request('/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: LATEST }),
    });
    expect(started.status).toBe(202);
    const data = ((await started.json()) as { data: { status: string; version: string; startedAt: string } }).data;
    expect(data).toMatchObject({ status: 'started', version: LATEST });
    expect(Number.isNaN(Date.parse(data.startedAt))).toBe(false);
  });
});

describe('the confirmation message', () => {
  test('is only the whole "update <CODE>", in the code alphabet', () => {
    expect(updateCodeInMessage('update k7qm2x')).toBe('K7QM2X');
    expect(updateCodeInMessage('  Omni update K7QM2X ')).toBe('K7QM2X');
    expect(updateCodeInMessage('please update K7QM2X')).toBeNull();
    expect(updateCodeInMessage('update K7QM2X now')).toBeNull();
    expect(updateCodeInMessage('update K7QM20')).toBeNull();
    expect(updateCodeInMessage('update')).toBeNull();
  });
});
