/**
 * Updates the owner confirms (wish: omni-labs-distribution).
 *
 * Safer than auto-update: this Omni never replaces itself on its own, and an app or key
 * alone cannot update it. Three things must line up:
 *
 *   1. The operator set OMNI_UPDATE_COMMAND: the command that updates this deployment
 *      (`omni update --yes` for a CLI install). Unset, updates are off and the API says so.
 *   2. Something with the `system:update` scope asks for the version the update channel
 *      publishes right now, and nothing else (POST /api/v2/system/update).
 *   3. The owner says yes in their own WhatsApp self chat, `update <CODE>`, within ten
 *      minutes (login/update-requests.ts, plugins/device-login.ts).
 *
 * One exception to 3: an Omni that only listens on this computer's loopback (API_HOST
 * 127.0.0.1, ::1 or localhost), whose operator set OMNI_UPDATE_CONFIRM=app, takes the yes from
 * the app itself, which asks the person on screen before it asks. That is the sandbox
 * `omni install --sandbox` sets up (packages/cli/src/sandbox.ts): it often has no WhatsApp,
 * and nothing but this computer can reach it. Anywhere else the setting is ignored.
 *
 * Then the command runs detached, its words as argv with no shell (a JSON array of strings
 * when a word holds a space), with OMNI_UPDATE_VERSION set. The update in flight is written
 * to a small file first, so the Omni that boots after the restart can tell the owner how it
 * went (reconcile).
 */

import { type SpawnOptions, spawn as nodeSpawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { EventBus } from '@omni/core';
import { createLogger } from '@omni/core';
import { z } from 'zod';
import { type Login, ownerAccount } from '../login';
import {
  updateCodeWrongMessage,
  updateConfirmMessage,
  updateFinishedMessage,
  updateStartedMessage,
} from '../login/messages';
import { UPDATE_CONFIRM_TTL_MS, type UpdateRequestStore, updateRequestStore } from '../login/update-requests';
import type { OwnAccount } from '../login/whatsapp';

const log = createLogger('system-update');

const PACKAGE = '@automagik/omni';
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const LATEST_TTL_MS = 10 * 60 * 1000;
/** A failed registry read is retried after this, not on every request. */
const LATEST_FAILURE_TTL_MS = 60 * 1000;
const REGISTRY_TIMEOUT_MS = 3000;
/** An update not done by then, with this Omni still running the old version, did not complete. */
export const UPDATE_GRACE_MS = 15 * 60 * 1000;
/** Wrong codes in a row before the waiting request is cancelled. */
export const MAX_WRONG_CODES = 5;
/** How long a finished update waits for the owner's WhatsApp to come back to say how it went. */
const REPORT_WAIT_MS = 5 * 60 * 1000;
const REPORT_POLL_MS = 10 * 1000;

export const UpdateVersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'a version like 2.261023.8');
const ChannelSchema = z.enum(['latest', 'next']);
export type UpdateChannel = z.infer<typeof ChannelSchema>;
const DistTagsSchema = z.record(z.string(), z.string());
const InFlightSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  startedAt: z.string().datetime(),
});
type InFlight = z.infer<typeof InFlightSchema>;

const CommandArraySchema = z.array(z.string().min(1)).min(1);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/** Who says yes to an update: the owner on WhatsApp, or the app on this computer (a loopback-only Omni). */
export type UpdateConfirm = 'whatsapp' | 'app';

export interface UpdateConfig {
  /**
   * False with OMNI_UPDATE_CHECK=false: the registry is never read and updates are off. An app
   * that embeds this Omni (`omni sandbox run --embedded`) ships its updates itself.
   */
  check: boolean;
  /** The operator's update command as argv, or null when updates are off. */
  command: string[] | null;
  confirm: UpdateConfirm;
  channel: UpdateChannel;
  registry: string;
  stateFile: string;
}

/** OMNI_UPDATE_COMMAND as argv: a JSON array of strings, else its words. */
function commandOf(raw: string | undefined): string[] | null {
  const text = (raw ?? '').trim();
  if (text.startsWith('[')) {
    try {
      const parsed = CommandArraySchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
    } catch {
      // not JSON: refused below
    }
    log.warn('OMNI_UPDATE_COMMAND looks like a JSON array but is not one of strings; updates are off');
    return null;
  }
  const words = text.split(/\s+/).filter(Boolean);
  return words.length ? words : null;
}

/** The app's yes counts only on an Omni nothing but this computer can reach. */
function confirmOf(env: NodeJS.ProcessEnv): UpdateConfirm {
  if (env.OMNI_UPDATE_CONFIRM?.trim() !== 'app') return 'whatsapp';
  const host = env.API_HOST?.trim() ?? '';
  if (LOOPBACK_HOSTS.has(host)) return 'app';
  log.warn('OMNI_UPDATE_CONFIRM=app is ignored: API_HOST is not loopback, so the owner confirms on WhatsApp', {
    host,
  });
  return 'whatsapp';
}

/** Read from the environment and nowhere else. A prerelease version follows `next`, a release `latest`. */
export function readUpdateConfig(version: string, env: NodeJS.ProcessEnv = process.env): UpdateConfig {
  const channel = ChannelSchema.safeParse(env.OMNI_UPDATE_CHANNEL?.trim());
  const check = env.OMNI_UPDATE_CHECK?.trim().toLowerCase() !== 'false';
  return {
    check,
    command: check ? commandOf(env.OMNI_UPDATE_COMMAND) : null,
    confirm: confirmOf(env),
    channel: channel.success ? channel.data : version.includes('-') ? 'next' : 'latest',
    registry: (env.OMNI_UPDATE_REGISTRY?.trim() || DEFAULT_REGISTRY).replace(/\/+$/, ''),
    stateFile: join(env.OMNI_UPDATE_STATE_DIR?.trim() || './data', 'system-update.json'),
  };
}

export interface UpdateStatus {
  current: string;
  channel: UpdateChannel;
  /** What the channel publishes now; null when the registry could not be read. */
  latest: string | null;
  updateAvailable: boolean;
  mode: 'off' | 'command';
  confirm: UpdateConfirm;
  pending?: { version: string; expiresAt: string };
  inFlight?: { version: string; startedAt: string };
}

export type UpdateRequestResult =
  | { ok: true; status: 'awaiting-confirmation'; version: string; expiresAt: Date }
  | { ok: true; status: 'started'; version: string; startedAt: Date }
  | { ok: false; status: 409 | 502 | 503; code: string; message: string };

/** What the updater needs of the command it starts. */
export interface UpdateChild {
  onError(listener: (error: Error) => void): void;
  onExit(listener: (code: number | null, signal: string | null) => void): void;
  unref(): void;
}
type Spawn = (command: string, args: string[], options: SpawnOptions) => UpdateChild;
type Refusal = Extract<UpdateRequestResult, { ok: false }>;
const refuse = (status: Refusal['status'], code: string, message: string): Refusal => ({
  ok: false,
  status,
  code,
  message,
});
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The owner's own WhatsApp self chat, where updates are confirmed and reported. */
export interface OwnerChannel {
  account(): Promise<OwnAccount | null>;
  send(account: OwnAccount, operationKey: string, text: string): Promise<void>;
}

export interface SystemUpdaterDeps {
  version: string;
  /** Human login: the owner's self chat and the request store come from it. Null: nobody can confirm. */
  login: Login | null;
  eventBus: EventBus | null;
  owner?: OwnerChannel | null;
  requests?: UpdateRequestStore | null;
  env?: NodeJS.ProcessEnv;
  fetch?: Fetch;
  spawn?: Spawn;
  now?: () => number;
}

export interface SystemUpdater {
  readonly config: UpdateConfig;
  status(): Promise<UpdateStatus>;
  request(version: string, requestedBy: string): Promise<UpdateRequestResult>;
  /** The owner's `update <CODE>` from their self chat: what it did, or null when nothing was waiting. */
  confirm(code: string, account: OwnAccount): Promise<'started' | 'wrong-code' | 'cancelled' | 'failed' | null>;
  /** At boot: tell the owner how an update recorded before the restart went. */
  reconcile(): Promise<'updated' | 'not-completed' | 'waiting' | null>;
}

function spawnChild(command: string, args: string[], options: SpawnOptions): UpdateChild {
  // The node ChildProcess, typed by what is used of it (its EventEmitter typing does not resolve here).
  const child = nodeSpawn(command, args, options) as unknown as {
    on(event: string, listener: (...args: never[]) => void): unknown;
    unref(): void;
  };
  return {
    onError: (listener) => void child.on('error', listener),
    onExit: (listener) => void child.on('exit', listener),
    unref: () => child.unref(),
  };
}

export function createSystemUpdater(deps: SystemUpdaterDeps): SystemUpdater {
  const { version: current, login, eventBus } = deps;
  const owner: OwnerChannel | null =
    deps.owner !== undefined
      ? deps.owner
      : login && {
          account: () => ownerAccount(login),
          send: (account, operationKey, text) => login.whatsapp.sendToSelf(account, operationKey, text),
        };
  const requests = deps.requests !== undefined ? deps.requests : login && updateRequestStore(login);
  const config = readUpdateConfig(current, deps.env);
  const fetchImpl: Fetch = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const spawn: Spawn = deps.spawn ?? spawnChild;
  const now = deps.now ?? Date.now;
  let latestCache: { value: string | null; at: number; ttl: number } | null = null;
  let requesting = false;
  let wrongCodes = 0;

  async function latest(): Promise<string | null> {
    if (!config.check) return null;
    if (latestCache && now() - latestCache.at < latestCache.ttl) return latestCache.value;
    let value: string | null = null;
    try {
      const response = await fetchImpl(`${config.registry}/-/package/${encodeURIComponent(PACKAGE)}/dist-tags`, {
        signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
      const tags = response.ok ? DistTagsSchema.safeParse(await response.json()) : null;
      const tagged = tags?.success ? tags.data[config.channel] : undefined;
      value = tagged && UpdateVersionSchema.safeParse(tagged).success ? tagged : null;
    } catch (error) {
      log.debug('Could not read the update channel', { error: String(error) });
    }
    latestCache = { value, at: now(), ttl: value ? LATEST_TTL_MS : LATEST_FAILURE_TTL_MS };
    return value;
  }

  async function readInFlight(): Promise<InFlight | null> {
    try {
      const parsed = InFlightSchema.safeParse(JSON.parse(await readFile(config.stateFile, 'utf8')));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async function writeInFlight(record: InFlight): Promise<void> {
    await mkdir(dirname(config.stateFile), { recursive: true });
    const temp = `${config.stateFile}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(record), { mode: 0o600 });
    await rename(temp, config.stateFile);
  }

  async function tellOwner(operationKey: string, text: string, wait = 0): Promise<void> {
    if (!owner) return;
    const deadline = now() + wait;
    for (;;) {
      const account = await owner.account().catch(() => null);
      if (account) {
        await owner
          .send(account, operationKey, text)
          .catch((error) => log.warn('Could not tell the owner about the update', { error: String(error) }));
        return;
      }
      if (now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, REPORT_POLL_MS).unref?.());
    }
  }

  /** End an update exactly once: the file goes first, so a second caller finds nothing to settle. */
  async function settle(record: InFlight, ok: boolean, reason: string, wait = 0): Promise<boolean> {
    const recorded = await readInFlight();
    if (recorded?.id !== record.id) return false;
    await rm(config.stateFile, { force: true });
    await eventBus
      ?.publishGeneric('system.update.finished', { id: record.id, from: record.from, to: record.to, ok, reason })
      .catch((error) => log.warn('Could not publish the update result', { error: String(error) }));
    log.info('Update finished', { to: record.to, ok, reason });
    await tellOwner(`update-done-${record.id}`, updateFinishedMessage(record.to, current, ok), wait);
    return true;
  }

  /** The update is late when it is still not done after the grace period. */
  function settleLate(record: InFlight): void {
    const left = Date.parse(record.startedAt) + UPDATE_GRACE_MS - now();
    setTimeout(() => void settle(record, false, 'timed-out'), Math.max(0, left)).unref?.();
  }

  async function status(): Promise<UpdateStatus> {
    const [published, waiting, inFlight] = await Promise.all([
      latest(),
      requests ? requests.pending().catch(() => null) : null,
      readInFlight(),
    ]);
    return {
      current,
      channel: config.channel,
      latest: published,
      updateAvailable: published !== null && Bun.semver.order(published, current) > 0,
      mode: config.command ? 'command' : 'off',
      confirm: config.confirm,
      ...(waiting ? { pending: { version: waiting.request.to, expiresAt: waiting.expiresAt.toISOString() } } : {}),
      ...(inFlight ? { inFlight: { version: inFlight.to, startedAt: inFlight.startedAt } } : {}),
    };
  }

  const PENDING_MESSAGE = 'An update is already waiting for the owner to confirm it on WhatsApp.';

  /** Why an update to `version` cannot run now (null: it can), whoever confirms it. */
  async function versionRefusal(version: string): Promise<Refusal | null> {
    if (await readInFlight()) return refuse(409, 'UPDATE_IN_PROGRESS', 'An update is already running.');
    const published = await latest();
    if (!published) return refuse(503, 'REGISTRY_UNAVAILABLE', 'Could not read the update channel. Try again later.');
    if (version !== published) {
      return refuse(409, 'VERSION_MISMATCH', `Only the version the ${config.channel} channel publishes, ${published}.`);
    }
    if (version === current) return refuse(409, 'ALREADY_CURRENT', `This Omni already runs ${current}.`);
    return null;
  }

  /** Why an update to `version` cannot be asked for now, or where to ask the owner. */
  async function precheck(
    version: string,
  ): Promise<Refusal | { owner: OwnerChannel; requests: UpdateRequestStore; account: OwnAccount }> {
    const account = owner ? await owner.account() : null;
    if (!owner || !requests || !account) {
      return refuse(
        409,
        'CONFIRM_CHANNEL_MISSING',
        "An update needs the owner's yes on WhatsApp, and this Omni has no owner WhatsApp connected.",
      );
    }
    if (await requests.pending()) return refuse(409, 'UPDATE_PENDING', PENDING_MESSAGE);
    return (await versionRefusal(version)) ?? { owner, requests, account };
  }

  async function request(version: string, requestedBy: string): Promise<UpdateRequestResult> {
    // One request at a time, checked before anything is awaited.
    if (requesting) return refuse(409, 'UPDATE_PENDING', PENDING_MESSAGE);
    requesting = true;
    try {
      const command = config.command;
      if (!command) {
        return refuse(
          409,
          'UPDATE_NOT_CONFIGURED',
          'Updates are off here: the operator has not set OMNI_UPDATE_COMMAND.',
        );
      }
      if (config.confirm === 'app') return await requestOnThisComputer(command, version, requestedBy);
      const checked = await precheck(version);
      if ('ok' in checked) return checked;
      const { code, expiresAt } = await checked.requests.create({ from: current, to: version, requestedBy });
      try {
        await checked.owner.send(
          checked.account,
          `update-ask-${expiresAt.getTime()}`,
          updateConfirmMessage(current, version, code, UPDATE_CONFIRM_TTL_MS / 60_000),
        );
      } catch (error) {
        await checked.requests.cancel();
        log.warn('Could not ask the owner to confirm the update', { error: String(error) });
        return refuse(502, 'CONFIRM_SEND_FAILED', 'Could not reach the owner on WhatsApp to confirm. Try again.');
      }
      wrongCodes = 0;
      await eventBus
        ?.publishGeneric('system.update.requested', {
          from: current,
          to: version,
          requestedBy,
          expiresAt: expiresAt.toISOString(),
        })
        .catch((error) => log.warn('Could not publish the update request', { error: String(error) }));
      log.info('Update requested; waiting for the owner', { to: version });
      return { ok: true, status: 'awaiting-confirmation', version, expiresAt };
    } finally {
      requesting = false;
    }
  }

  /** A loopback-only Omni whose operator lets the app confirm: the request is the yes. */
  async function requestOnThisComputer(
    command: string[],
    version: string,
    requestedBy: string,
  ): Promise<UpdateRequestResult> {
    const refusal = await versionRefusal(version);
    if (refusal) return refusal;
    await eventBus
      ?.publishGeneric('system.update.requested', { from: current, to: version, requestedBy, confirmedBy: 'app' })
      .catch((error) => log.warn('Could not publish the update request', { error: String(error) }));
    const record = await begin(command, version);
    if (!record) {
      return refuse(503, 'UPDATE_START_FAILED', 'The update command could not start. See the logs of this Omni.');
    }
    return { ok: true, status: 'started', version, startedAt: new Date(record.startedAt) };
  }

  /**
   * Starts the update to `to`: records it, runs the command detached, and settles it if the
   * command fails. Null when it could not start (it is settled as failed then).
   */
  async function begin(command: string[], to: string): Promise<InFlight | null> {
    const record: InFlight = {
      id: crypto.randomUUID(),
      from: current,
      to,
      startedAt: new Date(now()).toISOString(),
    };
    await eventBus
      ?.publishGeneric('system.update.confirmed', {
        id: record.id,
        from: record.from,
        to: record.to,
        confirmedBy: config.confirm,
      })
      .catch((error) => log.warn('Could not publish the confirmation', { error: String(error) }));
    await writeInFlight(record);

    let child: UpdateChild;
    try {
      child = spawn(command[0] as string, command.slice(1), {
        detached: true,
        shell: false,
        stdio: 'ignore',
        env: { ...process.env, OMNI_UPDATE_VERSION: record.to },
      });
    } catch (error) {
      await settle(record, false, `could not start: ${String(error)}`);
      return null;
    }
    child.onError((error) => void settle(record, false, `could not start: ${String(error)}`));
    // The command usually restarts this Omni before it exits. If it exits first, a failure
    // is final here; a success waits for the restart, and the grace period ends a missing one.
    child.onExit((exitCode, signal) => {
      if (exitCode !== 0) void settle(record, false, signal ? `stopped by ${signal}` : `exited with ${exitCode}`);
    });
    child.unref();
    settleLate(record);

    await eventBus
      ?.publishGeneric('system.update.started', { id: record.id, from: record.from, to: record.to })
      .catch((error) => log.warn('Could not publish the update start', { error: String(error) }));
    log.info('Update started', { to: record.to });
    return record;
  }

  async function confirm(code: string, account: OwnAccount) {
    if (!owner || !requests) return null;
    const asked = await requests.consume(code);
    if (!asked) {
      if (!(await requests.pending())) return null;
      wrongCodes += 1;
      const cancelled = wrongCodes >= MAX_WRONG_CODES;
      if (cancelled) {
        wrongCodes = 0;
        await requests.cancel();
      }
      await owner
        .send(account, `update-wrong-${now()}`, updateCodeWrongMessage(cancelled))
        .catch((error) => log.warn('Could not answer the update code', { error: String(error) }));
      return cancelled ? 'cancelled' : 'wrong-code';
    }
    wrongCodes = 0;
    const command = config.command;
    if (!command || (await readInFlight())) return 'failed';
    const record = await begin(command, asked.to);
    if (!record) return 'failed';
    await owner
      .send(account, `update-start-${record.id}`, updateStartedMessage(record.from, record.to))
      .catch((error) => log.warn('Could not say the update started', { error: String(error) }));
    return 'started';
  }

  async function reconcile() {
    const record = await readInFlight();
    if (!record) return null;
    if (current === record.to) {
      await settle(record, true, 'running the new version', REPORT_WAIT_MS);
      return 'updated';
    }
    if (now() - Date.parse(record.startedAt) < UPDATE_GRACE_MS) {
      // Restarted mid-update (the command may still be at work): give it the rest of the grace period.
      settleLate(record);
      return 'waiting';
    }
    await settle(record, false, 'still on the old version', REPORT_WAIT_MS);
    return 'not-completed';
  }

  return { config, status, request, confirm, reconcile };
}
