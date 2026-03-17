/**
 * Provider Setup Commands
 *
 * omni providers setup openclaw
 *   --gateway-url <url>
 *   --gateway-token <token>
 *   --agent-id <agentId>
 *   [--name <name>]
 *   [--instance-id <uuid>]
 *   [--account-name <name>]
 *   [--plugin-path <path>]
 *   [--skip-openclaw-config]
 *   [--non-interactive]
 *
 * omni providers setup genie
 *   --agent-name <name>
 *   --target-agent <name>
 *   [--team-name <template>]
 *   [--name <name>]
 *   [--base-url <url>]
 *   [--instance-id <uuid>]
 *   [--non-interactive]
 *
 * Single command that takes gateway URL + token + agent ID
 * and produces a fully working OpenClaw provider with device identity.
 * Optionally auto-configures ~/.openclaw/openclaw.json with plugin
 * registration and channel account when --instance-id is provided.
 */

import { execFileSync, execSync } from 'node:child_process';
import * as nodeCrypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { type DeviceKeypair, ED25519_PKCS8_PREFIX, generateDeviceKeypair } from '@omni/core';
import { Command } from 'commander';
import ora from 'ora';
import { getClient } from '../client.js';
import { loadConfig } from '../config.js';
import * as output from '../output.js';

// ============================================================================
// TYPES
// ============================================================================

/** WS RPC request frame (matches OpenClaw protocol) */
interface WsReqFrame {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/** WS RPC response frame (matches OpenClaw protocol) */
interface WsResFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message: string; code?: string };
}

/** WS event frame (matches OpenClaw protocol) */
interface WsEventFrame {
  type: 'event';
  event: string;
  payload?: unknown;
}

/** Connect handshake parameters (matches OpenClaw protocol) */
interface WsConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: { id: string; version: string; platform: string; mode: string };
  role: 'operator' | 'node';
  scopes: string[];
  caps: string[];
  auth?: { token?: string };
  locale: string;
  userAgent: string;
  device?: {
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce: string;
  };
}

interface SetupOpenClawOptions {
  gatewayUrl: string;
  gatewayToken: string;
  agentId: string;
  name?: string;
  nonInteractive?: boolean;
  instanceId?: string;
  accountName?: string;
  pluginPath?: string;
  skipOpenclawConfig?: boolean;
}

interface PairingResult {
  deviceToken: string;
}

// ============================================================================
// HELPERS - INTERACTIVE PROMPT
// ============================================================================

/** Prompt for a line of input with a default value */
async function promptLine(question: string, defaultValue = ''): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed === '' ? defaultValue : trimmed);
    });
  });
}

/** Check if a character signals end of input (Enter or EOF) */
function isEndOfInput(c: string): boolean {
  return c === '\n' || c === '\r' || c === '\u0004';
}

/** Check if a character is backspace */
function isBackspace(c: string): boolean {
  return c === '\u007F' || c === '\b';
}

/** Prompt for a secret (input not echoed to terminal) */
async function promptSecret(question: string): Promise<string> {
  process.stdout.write(question);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise((resolve) => {
    let input = '';
    const onData = (ch: string) => {
      const c = ch.toString();
      if (isEndOfInput(c)) {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input.trim());
      } else if (c === '\u0003') {
        process.exit(1);
      } else if (isBackspace(c)) {
        input = input.slice(0, -1);
      } else {
        input += c;
      }
    };
    process.stdin.on('data', onData);
  });
}

// ============================================================================
// HELPERS - WS PAIRING CLIENT
// ============================================================================

/** Lightweight WS RPC request with timeout */
function sendWsRequest(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<unknown> {
  const id = nodeCrypto.randomUUID();
  const frame: WsReqFrame = { type: 'req', id, method, params };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`WS request "${method}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const handler = (ev: MessageEvent) => {
      let res: WsResFrame;
      try {
        res = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (res.type !== 'res' || res.id !== id) return;

      cleanup();
      if (res.ok) {
        resolve(res.payload);
      } else {
        reject(new Error(res.error?.message ?? `Request "${method}" failed`));
      }
    };

    const closeHandler = (ev: CloseEvent) => {
      cleanup();
      reject(new Error(`WebSocket closed before "${method}" response (code ${ev.code})`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ws.removeEventListener('message', handler);
      ws.removeEventListener('close', closeHandler);
    };

    ws.addEventListener('message', handler);
    ws.addEventListener('close', closeHandler);
    ws.send(JSON.stringify(frame));
  });
}

/** Wait for a specific WS event by name, checking buffered messages first */
function waitForWsEvent(
  ws: WebSocket,
  eventName: string,
  buffered: MessageEvent[] = [],
  timeoutMs = 10_000,
): Promise<WsEventFrame> {
  return new Promise((resolve, reject) => {
    // Check buffered messages first (connect.challenge may already be here)
    for (let i = 0; i < buffered.length; i++) {
      try {
        const parsed = JSON.parse(String(buffered[i].data)) as WsEventFrame;
        if (parsed.type === 'event' && parsed.event === eventName) {
          buffered.splice(i, 1);
          resolve(parsed);
          return;
        }
      } catch {
        /* skip non-JSON */
      }
    }

    // Not in buffer — listen for new messages
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for event "${eventName}"`));
    }, timeoutMs);

    const handler = (ev: MessageEvent) => {
      let frame: WsEventFrame;
      try {
        frame = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (frame.type !== 'event' || frame.event !== eventName) return;
      cleanup();
      resolve(frame);
    };

    const closeHandler = (ev: CloseEvent) => {
      cleanup();
      reject(new Error(`WebSocket closed while waiting for "${eventName}" (code ${ev.code})`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ws.removeEventListener('message', handler);
      ws.removeEventListener('close', closeHandler);
    };

    ws.addEventListener('message', handler);
    ws.addEventListener('close', closeHandler);
  });
}

type WsBufferedOpen = [ws: WebSocket, buffered: MessageEvent[], bufferListener: (event: MessageEvent) => void];

/** Open a WS connection and wait for it to be ready, buffering early messages */
function openWs(url: string): Promise<WsBufferedOpen> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const buffered: MessageEvent[] = [];
    const bufferListener = (event: MessageEvent) => {
      buffered.push(event);
    };

    // Buffer messages BEFORE open — gateway sends connect.challenge immediately
    ws.addEventListener('message', bufferListener);

    const onOpen = () => {
      ws.removeEventListener('error', onError);
      resolve([ws, buffered, bufferListener]);
    };

    const onError = () => {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('message', bufferListener);
      reject(new Error(`Failed to connect to ${url}`));
    };

    ws.addEventListener('open', onOpen, { once: true });
    ws.addEventListener('error', onError, { once: true });
  });
}

/**
 * Connect to the gateway WS with device credentials, completing the
 * connect.challenge handshake. From localhost the gateway sets silent: true
 * and auto-approves, returning the device token in hello-ok.
 */
async function connectWithDevice(
  ws: WebSocket,
  gatewayToken: string,
  keypair: DeviceKeypair,
  buffered: MessageEvent[] = [],
  bufferListener?: (event: MessageEvent) => void,
): Promise<Record<string, unknown>> {
  try {
    // Wait for the connect.challenge event to get the nonce
    const challengeEvent = await waitForWsEvent(ws, 'connect.challenge', buffered);
    const nonce = (challengeEvent.payload as Record<string, unknown>)?.nonce as string;

    const role = 'operator';
    const scopes = ['operator.read', 'operator.write'];
    const clientId = 'gateway-client';
    const clientMode = 'backend';
    const signedAtMs = Date.now();

    // Build payload matching gateway's buildDeviceAuthPayload (v2 with nonce)
    // For first-time pairing, dev.token is empty string
    const payload = [
      'v2',
      keypair.deviceId,
      clientId,
      clientMode,
      role,
      scopes.join(','),
      String(signedAtMs),
      gatewayToken, // gateway uses auth.token in the payload: token = connectParams.auth?.token ?? null
      nonce,
    ].join('|');

    // Sign with Ed25519 private key (PKCS8 DER reconstruction)
    const rawPrivKey = Buffer.from(keypair.privateKey, 'base64url');
    const pkcs8Der = Buffer.concat([ED25519_PKCS8_PREFIX, rawPrivKey]);
    const privateKey = nodeCrypto.createPrivateKey({ key: pkcs8Der, type: 'pkcs8', format: 'der' });
    const signature = nodeCrypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url');

    const params: WsConnectParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: clientId,
        version: '1.0.0',
        platform: 'omni',
        mode: clientMode,
      },
      role,
      scopes,
      caps: [],
      auth: { token: gatewayToken },
      locale: 'en-US',
      userAgent: 'omni-cli/setup',
      device: {
        id: keypair.deviceId,
        publicKey: keypair.publicKey,
        signature,
        signedAt: signedAtMs,
        nonce,
      },
    };

    const result = await sendWsRequest(ws, 'connect', params as unknown as Record<string, unknown>);
    return (result ?? {}) as Record<string, unknown>;
  } finally {
    if (bufferListener) {
      ws.removeEventListener('message', bufferListener);
    }
  }
}

/**
 * Pair a device with the gateway using the connect frame with Ed25519 credentials.
 * From localhost, the gateway auto-approves and returns the device token.
 */
async function pairDevice(
  gatewayUrl: string,
  gatewayToken: string,
  keypair: DeviceKeypair,
  spinner: ReturnType<typeof ora>,
): Promise<PairingResult> {
  spinner.text = 'Connecting to gateway...';
  const [ws, buffered, bufferListener] = await openWs(gatewayUrl);

  try {
    spinner.text = 'Authenticating with device credentials...';
    const result = await connectWithDevice(ws, gatewayToken, keypair, buffered, bufferListener);

    // Extract device token from hello-ok response: payload.auth.deviceToken
    const auth = result.auth as Record<string, unknown> | undefined;
    const deviceToken = auth?.deviceToken as string | undefined;

    if (!deviceToken) {
      throw new Error('Gateway did not return a device token in connect response');
    }

    return { deviceToken };
  } finally {
    ws.close(1000, 'pairing complete');
  }
}

// ============================================================================
// HELPERS - OPENCLAW CONFIG
// ============================================================================

const OPENCLAW_CONFIG_PATH = resolve(homedir(), '.openclaw', 'openclaw.json');
const PLUGIN_MARKER = 'plugin-openclaw/omni.ts';

/** Read openclaw.json, returning empty object if missing or empty */
function readOpenClawConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) return {};
  const raw = readFileSync(configPath, 'utf-8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Write openclaw.json with 2-space indent */
function writeOpenClawConfig(configPath: string, config: Record<string, unknown>): void {
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

/** Check if the omni plugin path is already in plugins.load.paths */
function isPluginRegistered(config: Record<string, unknown>, marker: string, pluginPath?: string): boolean {
  const plugins = config.plugins as Record<string, unknown> | undefined;
  const load = plugins?.load as Record<string, unknown> | undefined;
  const paths = load?.paths as string[] | undefined;
  return paths?.some((p) => p.includes(marker) || (pluginPath !== undefined && p === pluginPath)) ?? false;
}

/** Ensure nested object path exists without clobbering siblings, return the leaf */
function ensureNestedPath(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  let current = obj;
  for (const key of keys) {
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  return current;
}

/** Check if openclaw CLI is available in PATH */
function hasOpenClawCli(): boolean {
  try {
    execSync('openclaw --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Validate UUID v4 format */
function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Resolve the plugin entry point path */
function resolvePluginPath(explicit?: string): string | null {
  if (explicit) {
    return existsSync(explicit) ? resolve(explicit) : null;
  }
  const cwdCandidate = resolve(process.cwd(), 'packages/plugin-openclaw/omni.ts');
  return existsSync(cwdCandidate) ? cwdCandidate : null;
}

/** Try to register the plugin via openclaw CLI, falling back to JSON merge */
function registerPlugin(
  config: Record<string, unknown>,
  pluginPath: string,
  configPath: string,
): { config: Record<string, unknown>; registered: boolean } {
  if (hasOpenClawCli()) {
    try {
      execFileSync('openclaw', ['plugins', 'install', '--link', pluginPath], { stdio: 'ignore' });
      try {
        return { config: readOpenClawConfig(configPath), registered: true };
      } catch {
        return { config, registered: true };
      }
    } catch {
      // CLI failed, fall back to JSON merge
    }
  }

  // Fallback: JSON merge
  const loadSection = ensureNestedPath(config, ['plugins', 'load']);
  if (!Array.isArray(loadSection.paths)) {
    loadSection.paths = [];
  }
  const existingPaths = loadSection.paths as string[];
  if (!existingPaths.includes(pluginPath)) {
    existingPaths.push(pluginPath);
  }
  return { config, registered: true };
}

/** Set the channel account fields in the config object */
function setChannelAccount(config: Record<string, unknown>, accountName: string, instanceId: string): void {
  const omniConfig = loadConfig();
  const account = ensureNestedPath(config, ['channels', 'omni', 'accounts', accountName]);
  if (account.apiUrl === undefined) account.apiUrl = omniConfig.apiUrl ?? 'http://localhost:8882';
  if (account.apiKey === undefined) account.apiKey = omniConfig.apiKey ?? '';
  account.instanceId = instanceId;
  account.enabled = true;
}

/**
 * Step 5: Configure openclaw.json — register plugin + create channel account.
 * Non-fatal: logs warnings on failure, never throws.
 */
function configureOpenClawJson(opts: SetupOpenClawOptions, spinner: ReturnType<typeof ora>): void {
  const instanceId = opts.instanceId;
  if (!instanceId) return;

  const accountName = opts.accountName ?? opts.agentId;
  const configPath = OPENCLAW_CONFIG_PATH;

  spinner.start('Configuring openclaw.json...');

  let config: Record<string, unknown>;
  try {
    config = readOpenClawConfig(configPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    spinner.warn(`Could not parse ${configPath}: ${msg}`);
    output.info('  Tip: ensure openclaw.json is valid JSON, or use --skip-openclaw-config');
    return;
  }

  // 5a. Register plugin
  const pluginPath = resolvePluginPath(opts.pluginPath);
  let pluginRegistered = isPluginRegistered(config, PLUGIN_MARKER, pluginPath ?? undefined);

  if (!pluginRegistered && pluginPath) {
    const result = registerPlugin(config, pluginPath, configPath);
    config = result.config;
    pluginRegistered = result.registered;
  }

  // Enable plugin
  if (pluginRegistered) {
    const entries = ensureNestedPath(config, ['plugins', 'entries']);
    const existing = (entries.omni ?? {}) as Record<string, unknown>;
    entries.omni = { ...existing, enabled: true };
  }

  // 5c. Create channel account
  setChannelAccount(config, accountName, instanceId);

  // Write back
  try {
    writeOpenClawConfig(configPath, config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    spinner.warn(`Could not write ${configPath}: ${msg}`);
    return;
  }

  spinner.succeed('OpenClaw config updated');

  // 5d. Summary
  if (pluginRegistered) {
    output.info('  Plugin: omni (registered)');
  } else if (!pluginPath) {
    output.info('  Plugin: skipped (plugin-openclaw/omni.ts not found)');
  }
  output.info(`  Account: ${accountName} → instance ${instanceId}`);
  output.info('  Run `openclaw gateway restart` to apply');
}

// ============================================================================
// SETUP FLOW
// ============================================================================

/** Collect missing options via interactive prompts */
async function collectOptions(options: Partial<SetupOpenClawOptions>): Promise<SetupOpenClawOptions> {
  const gatewayUrl = options.gatewayUrl ?? (await promptLine('Gateway WebSocket URL: '));
  const gatewayToken = options.gatewayToken ?? (await promptSecret('Gateway token: '));
  const agentId = options.agentId ?? (await promptLine('Default agent ID: '));
  const name = options.name ?? (await promptLine(`Provider name [openclaw-${agentId}]: `, `openclaw-${agentId}`));

  let instanceId = options.instanceId;
  if (!instanceId && !options.skipOpenclawConfig) {
    instanceId = (await promptLine('Instance ID (Omni instance UUID, leave blank to skip config): ')) || undefined;
  }

  return {
    gatewayUrl,
    gatewayToken,
    agentId,
    name,
    nonInteractive: options.nonInteractive,
    instanceId,
    accountName: options.accountName,
    pluginPath: options.pluginPath,
    skipOpenclawConfig: options.skipOpenclawConfig,
  };
}

/** Validate the required fields are present */
function validateRequiredFields(options: Partial<SetupOpenClawOptions>): string | null {
  if (!options.gatewayUrl) return 'Missing required flag: --gateway-url';
  if (!options.gatewayToken) return 'Missing required flag: --gateway-token';
  if (!options.agentId) return 'Missing required flag: --agent-id';
  return null;
}

/** Validate the gateway URL scheme */
function validateGatewayUrl(url: string): string | null {
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    return `Gateway URL must use ws:// or wss:// scheme. Got: ${url}`;
  }
  return null;
}

/**
 * Main setup flow for OpenClaw provider.
 *
 * 1. Generate Ed25519 keypair
 * 2. Pair device with gateway via connect frame (auto-approved from localhost)
 * 3. Create provider via Omni API
 * 4. Run health check
 * 5. Configure openclaw.json (if --instance-id provided)
 */
async function runOpenClawSetup(opts: SetupOpenClawOptions): Promise<void> {
  const spinner = ora();

  try {
    // Step 1: Generate keypair
    spinner.start('Generating Ed25519 device keypair...');
    const keypair = generateDeviceKeypair();
    spinner.succeed(`Device keypair generated (deviceId: ${keypair.deviceId.slice(0, 12)}...)`);

    // Step 2: Pair device with gateway
    spinner.start('Pairing device with gateway...');
    const pairingResult = await pairDevice(opts.gatewayUrl, opts.gatewayToken, keypair, spinner);
    spinner.succeed('Device paired with gateway');

    // Step 3: Create provider via API
    spinner.start('Creating OpenClaw provider...');
    const client = getClient();
    const providerName = opts.name ?? `openclaw-${opts.agentId}`;
    const provider = await client.providers.create({
      name: providerName,
      schema: 'openclaw',
      baseUrl: opts.gatewayUrl,
      apiKey: opts.gatewayToken,
      schemaConfig: {
        defaultAgentId: opts.agentId,
        deviceId: keypair.deviceId,
        devicePublicKey: keypair.publicKey,
        devicePrivateKey: keypair.privateKey,
        deviceToken: pairingResult.deviceToken,
      },
    });
    spinner.succeed(`Provider created: ${provider.id}`);

    // Step 4: Health check
    spinner.start('Testing provider connectivity...');
    const health = await client.providers.checkHealth(provider.id);
    if (health.healthy) {
      spinner.succeed(`Provider is healthy (latency: ${health.latency}ms)`);
    } else {
      spinner.warn(`Provider created but health check failed: ${health.error ?? 'unknown error'}`);
      output.info('The provider was created. You can re-test later with:');
      output.info(`  omni providers test ${provider.id}`);
    }

    // Step 5: Configure openclaw.json (optional)
    if (!opts.skipOpenclawConfig && opts.instanceId) {
      configureOpenClawJson(opts, spinner);
    } else if (!opts.skipOpenclawConfig && !opts.instanceId) {
      output.info('');
      output.info('Skipping openclaw.json config (no --instance-id provided)');
    }

    // Summary
    output.info('');
    output.success('OpenClaw provider setup complete');
    output.info(`  Provider ID:  ${provider.id}`);
    output.info(`  Provider:     ${providerName}`);
    output.info(`  Agent ID:     ${opts.agentId}`);
    output.info(`  Device ID:    ${keypair.deviceId.slice(0, 16)}...`);
    output.info('');
    output.info('Next steps:');
    output.info(
      `  1. Assign to instance: omni instances update <instance-id> --agent-provider ${provider.id} --agent ${opts.agentId}`,
    );
    output.info(`  2. Test connectivity:  omni providers test ${provider.id}`);
  } catch (err) {
    spinner.fail('Setup failed');
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`OpenClaw provider setup failed: ${message}`);
  }
}

// ============================================================================
// COMMAND REGISTRATION
// ============================================================================

// ============================================================================
// GENIE SETUP
// ============================================================================

const GENIE_TEMPLATE_VARS = `
  Template variables (resolved per-message at runtime):
    {chat_id}     - Conversation ID (1 session per chat)
    {thread_id}   - Thread ID (1 session per thread)
    {sender_id}   - Sender user ID (1 session per person)
    {channel}     - Channel type (telegram, whatsapp, etc.)
    {instance_id} - Omni instance ID
  Examples:
    "workspace"              → Single shared session
    "genie-{chat_id}"        → One session per conversation
    "genie-{chat_id}-{thread_id}" → Per-thread isolation`;

interface SetupGenieOptions {
  agentName: string;
  targetAgent: string;
  teamName: string;
  agentRole: string;
  name: string;
  baseUrl: string;
  instanceId?: string;
  nonInteractive?: boolean;
}

/** Collect missing genie options via interactive prompts */
async function collectGenieOptions(options: Partial<SetupGenieOptions>): Promise<SetupGenieOptions> {
  const agentName = options.agentName ?? (await promptLine('Agent name (your identity / "from" field): '));
  const targetAgent = options.targetAgent ?? (await promptLine('Target agent (inbox to deliver to): '));
  const agentRole =
    options.agentRole ??
    (await promptLine('Agent role (registered genie dir agent, e.g. "omni-pm") [team-lead]: ', 'team-lead'));

  if (!options.teamName) {
    output.info(GENIE_TEMPLATE_VARS);
  }
  const teamName =
    options.teamName ?? (await promptLine(`Team name template [${agentName}-{chat_id}]: `, `${agentName}-{chat_id}`));

  const defaultName = `genie-${agentName}`;
  const name = options.name ?? (await promptLine(`Provider name [${defaultName}]: `, defaultName));
  const baseUrl =
    options.baseUrl ??
    (await promptLine('Base URL [file:///home/genie/.claude/teams]: ', 'file:///home/genie/.claude/teams'));

  let instanceId = options.instanceId;
  if (!instanceId) {
    instanceId = (await promptLine('Instance ID (Omni instance UUID, leave blank to skip): ')) || undefined;
  }

  return { agentName, targetAgent, teamName, agentRole, name, baseUrl, instanceId, nonInteractive: options.nonInteractive };
}

/** Main setup flow for Genie provider */
async function runGenieSetup(opts: SetupGenieOptions): Promise<void> {
  const spinner = ora();

  try {
    // Step 1: Create provider via API
    spinner.start('Creating Genie provider...');
    const client = getClient();
    const provider = await client.providers.create({
      name: opts.name,
      schema: 'genie',
      baseUrl: opts.baseUrl,
      schemaConfig: {
        agentName: opts.agentName,
        targetAgent: opts.targetAgent,
        teamName: opts.teamName,
        agentRole: opts.agentRole,
      },
    });
    spinner.succeed(`Provider created: ${provider.id}`);

    // Step 2: Health check
    spinner.start('Testing provider health...');
    const health = await client.providers.checkHealth(provider.id);
    if (health.healthy) {
      spinner.succeed(`Provider is healthy (latency: ${health.latency}ms)`);
    } else {
      spinner.warn(`Provider created but health check failed: ${health.error ?? 'unknown'}`);
      output.info('  The provider was created. Re-test later with:');
      output.info(`    omni providers test ${provider.id}`);
    }

    // Summary
    output.info('');
    output.success('Genie provider setup complete');
    output.info(`  Provider ID:    ${provider.id}`);
    output.info(`  Provider name:  ${opts.name}`);
    output.info(`  Agent name:     ${opts.agentName}`);
    output.info(`  Target agent:   ${opts.targetAgent}`);
    output.info(`  Agent role:     ${opts.agentRole}`);
    output.info(`  Team template:  ${opts.teamName}`);
    output.info(`  Base URL:       ${opts.baseUrl}`);
    output.info('');
    output.info('How it works:');
    output.info('  1. Incoming messages are written to ~/.claude/teams/<team>/inboxes/<target>.json');
    output.info('  2. Claude Code agent picks up messages natively from its team inbox');
    output.info('  3. Agent replies via `omni send` (fire-and-forget, no polling)');
    output.info('');
    output.info('Next steps:');
    if (opts.instanceId) {
      output.info(`  1. Assign to instance: omni instances update ${opts.instanceId} --agent-provider ${provider.id}`);
    } else {
      output.info(`  1. Assign to instance: omni instances update <instance-id> --agent-provider ${provider.id}`);
    }
    output.info(`  2. Test connectivity:  omni providers test ${provider.id}`);
    output.info(`  3. Update template:    omni providers update ${provider.id} --team-name "new-{chat_id}"`);
  } catch (err) {
    spinner.fail('Setup failed');
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Genie provider setup failed: ${message}`);
  }
}

/** Resolve non-interactive genie options from CLI flags */
function resolveGenieNonInteractive(options: {
  agentName?: string;
  targetAgent?: string;
  teamName?: string;
  agentRole?: string;
  name?: string;
  baseUrl?: string;
  instanceId?: string;
}): SetupGenieOptions | string {
  if (!options.agentName) return 'Missing required flag: --agent-name';
  if (!options.targetAgent) return 'Missing required flag: --target-agent';
  return {
    agentName: options.agentName,
    targetAgent: options.targetAgent,
    teamName: options.teamName ?? `${options.agentName}-{chat_id}`,
    agentRole: options.agentRole ?? 'team-lead',
    name: options.name ?? `genie-${options.agentName}`,
    baseUrl: options.baseUrl ?? 'file:///home/genie/.claude/teams',
    instanceId: options.instanceId,
    nonInteractive: true,
  };
}

/** Action handler for `omni providers setup genie` */
async function handleGenieSetup(options: {
  agentName?: string;
  targetAgent?: string;
  teamName?: string;
  agentRole?: string;
  name?: string;
  baseUrl?: string;
  instanceId?: string;
  nonInteractive?: boolean;
}): Promise<void> {
  if (options.instanceId && !isValidUuid(options.instanceId)) {
    output.error(`Invalid --instance-id: must be a valid UUID. Got: ${options.instanceId}`);
    return;
  }

  let resolved: SetupGenieOptions;
  if (options.nonInteractive) {
    const result = resolveGenieNonInteractive(options);
    if (typeof result === 'string') {
      output.error(result);
      return;
    }
    resolved = result;
  } else {
    resolved = await collectGenieOptions(options);
  }

  if (resolved.instanceId && !isValidUuid(resolved.instanceId)) {
    output.error(`Invalid instance ID: must be a valid UUID. Got: ${resolved.instanceId}`);
    return;
  }

  await runGenieSetup(resolved);
}

export function createSetupCommand(): Command {
  const setup = new Command('setup').description('Interactive setup wizards for providers');

  // omni providers setup openclaw
  setup
    .command('openclaw')
    .description('Set up an OpenClaw provider (keypair generation + device pairing + provider creation)')
    .option('--gateway-url <url>', 'Gateway WebSocket URL (ws:// or wss://)')
    .option('--gateway-token <token>', 'Gateway authentication token')
    .option('--agent-id <agentId>', 'Default agent ID')
    .option('--name <name>', 'Provider name (default: openclaw-<agent-id>)')
    .option('--instance-id <uuid>', 'Omni instance UUID for the openclaw channel account')
    .option('--account-name <name>', 'Account name in openclaw.json (default: agent-id)')
    .option('--plugin-path <path>', 'Path to omni.ts plugin entry (auto-detected from CWD)')
    .option('--skip-openclaw-config', 'Skip openclaw.json updates entirely')
    .option('--non-interactive', 'Error on missing required flags instead of prompting')
    .action(
      async (options: {
        gatewayUrl?: string;
        gatewayToken?: string;
        agentId?: string;
        name?: string;
        instanceId?: string;
        accountName?: string;
        pluginPath?: string;
        skipOpenclawConfig?: boolean;
        nonInteractive?: boolean;
      }) => {
        // Non-interactive mode: validate all required flags are present
        if (options.nonInteractive) {
          const validationError = validateRequiredFields(options);
          if (validationError) {
            output.error(validationError);
            return;
          }
        }

        // Validate instance-id format if provided
        if (options.instanceId && !isValidUuid(options.instanceId)) {
          output.error(`Invalid --instance-id: must be a valid UUID. Got: ${options.instanceId}`);
          return;
        }

        // Interactive mode: prompt for missing flags
        let resolved: SetupOpenClawOptions;
        if (options.nonInteractive) {
          resolved = options as SetupOpenClawOptions;
        } else {
          resolved = await collectOptions(options);
        }

        // Validate instance-id from prompt
        if (resolved.instanceId && !isValidUuid(resolved.instanceId)) {
          output.error(`Invalid instance ID: must be a valid UUID. Got: ${resolved.instanceId}`);
          return;
        }

        // Validate URL scheme
        const urlError = validateGatewayUrl(resolved.gatewayUrl);
        if (urlError) {
          output.error(urlError);
          return;
        }

        await runOpenClawSetup(resolved);
      },
    );

  // omni providers setup genie
  setup
    .command('genie')
    .description('Set up a Genie provider (Claude Code team inbox integration)')
    .option('--agent-name <name>', 'Agent identity / "from" field')
    .option('--target-agent <name>', 'Target agent inbox to deliver messages to')
    .option('--team-name <template>', 'Team name template (supports {chat_id}, {thread_id}, etc.)')
    .option('--agent-role <role>', 'Registered genie dir agent name (default: team-lead)')
    .option('--name <name>', 'Provider name (default: genie-<agent-name>)')
    .option('--base-url <url>', 'Base URL (default: file:///home/genie/.claude/teams)')
    .option('--instance-id <uuid>', 'Omni instance UUID to auto-assign provider')
    .option('--non-interactive', 'Error on missing required flags instead of prompting')
    .action(handleGenieSetup);

  return setup;
}
