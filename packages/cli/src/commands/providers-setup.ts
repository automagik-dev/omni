/**
 * Provider Setup Commands
 *
 * omni providers setup openclaw
 *   --gateway-url <url>
 *   --gateway-token <token>
 *   --agent-id <agentId>
 *   [--name <name>]
 *   [--non-interactive]
 *
 * Single command that takes gateway URL + token + agent ID
 * and produces a fully working OpenClaw provider with device identity.
 */

import * as nodeCrypto from 'node:crypto';
import { createInterface } from 'node:readline';
import { type DeviceKeypair, generateDeviceKeypair } from '@omni/core';
import { Command } from 'commander';
import ora from 'ora';
import { getClient } from '../client.js';
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

    const cleanup = () => {
      clearTimeout(timeout);
      ws.removeEventListener('message', handler);
    };

    ws.addEventListener('message', handler);
    ws.send(JSON.stringify(frame));
  });
}

/** Wait for a specific WS event by name */
function waitForWsEvent(ws: WebSocket, eventName: string, timeoutMs = 10_000): Promise<WsEventFrame> {
  return new Promise((resolve, reject) => {
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

    const cleanup = () => {
      clearTimeout(timeout);
      ws.removeEventListener('message', handler);
    };

    ws.addEventListener('message', handler);
  });
}

/** Open a WS connection and wait for it to be ready */
function openWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);

    const onOpen = () => {
      ws.removeEventListener('error', onError);
      resolve(ws);
    };

    const onError = () => {
      ws.removeEventListener('open', onOpen);
      reject(new Error(`Failed to connect to ${url}`));
    };

    ws.addEventListener('open', onOpen, { once: true });
    ws.addEventListener('error', onError, { once: true });
  });
}

/**
 * Connect to the gateway WS with a shared token only (no device),
 * completing the connect.challenge handshake.
 */
async function connectWithToken(ws: WebSocket, token: string): Promise<void> {
  const challengeEvent = await waitForWsEvent(ws, 'connect.challenge');
  // Challenge received; respond with token-only connect
  const _nonce = (challengeEvent.payload as Record<string, unknown>)?.nonce;

  const params: WsConnectParams = {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: 'omni-cli-setup',
      version: '1.0.0',
      platform: 'omni',
      mode: 'backend',
    },
    role: 'operator',
    scopes: ['operator.pairing'],
    caps: [],
    auth: { token },
    locale: 'en-US',
    userAgent: 'omni-cli/setup',
  };

  await sendWsRequest(ws, 'connect', params as unknown as Record<string, unknown>);
}

/**
 * Perform device pairing via gateway WS RPC.
 *
 * Steps:
 * 1. Connect to gateway with shared token
 * 2. Call node.pair.request with the device public key
 * 3. Call node.pair.approve to auto-approve (requires operator.pairing scope)
 * 4. Return the device token from the approval response
 */
async function pairDevice(
  gatewayUrl: string,
  gatewayToken: string,
  keypair: DeviceKeypair,
  spinner: ReturnType<typeof ora>,
): Promise<PairingResult> {
  spinner.text = 'Connecting to gateway...';
  const ws = await openWs(gatewayUrl);

  try {
    spinner.text = 'Authenticating with gateway...';
    await connectWithToken(ws, gatewayToken);

    spinner.text = 'Requesting device pairing...';
    const pairResult = (await sendWsRequest(ws, 'node.pair.request', {
      deviceId: keypair.deviceId,
      publicKey: keypair.publicKey,
      name: `omni-provider-${keypair.deviceId.slice(0, 8)}`,
    })) as Record<string, unknown> | undefined;

    const requestId = pairResult?.requestId as string | undefined;
    const alreadyApproved = pairResult?.token as string | undefined;

    // If the gateway returns a token directly, the device was auto-approved
    if (alreadyApproved) {
      return { deviceToken: alreadyApproved };
    }

    spinner.text = 'Approving device pairing...';
    try {
      const approveResult = (await sendWsRequest(ws, 'node.pair.approve', {
        deviceId: keypair.deviceId,
        ...(requestId ? { requestId } : {}),
      })) as Record<string, unknown> | undefined;

      const deviceToken = approveResult?.token as string | undefined;
      if (!deviceToken) {
        throw new Error('Gateway did not return a device token after approval');
      }

      return { deviceToken };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('scope') || msg.includes('permission') || msg.includes('unauthorized')) {
        throw new PairingScopeError(gatewayUrl, gatewayToken, keypair.deviceId);
      }
      throw err;
    }
  } finally {
    ws.close(1000, 'pairing complete');
  }
}

// ============================================================================
// ERRORS
// ============================================================================

class PairingScopeError extends Error {
  constructor(
    public readonly gatewayUrl: string,
    public readonly _gatewayToken: string,
    public readonly deviceId: string,
  ) {
    super('Token lacks operator.pairing scope');
    this.name = 'PairingScopeError';
  }
}

// ============================================================================
// SETUP FLOW
// ============================================================================

/** Collect missing options via interactive prompts */
async function collectOptions(options: Partial<SetupOpenClawOptions>): Promise<SetupOpenClawOptions> {
  const gatewayUrl = options.gatewayUrl ?? (await promptLine('Gateway WebSocket URL: '));
  const gatewayToken = options.gatewayToken ?? (await promptLine('Gateway token: '));
  const agentId = options.agentId ?? (await promptLine('Default agent ID: '));
  const name = options.name ?? (await promptLine(`Provider name [openclaw-${agentId}]: `, `openclaw-${agentId}`));

  return { gatewayUrl, gatewayToken, agentId, name, nonInteractive: options.nonInteractive };
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
 * 2. Pair device with gateway via WS RPC
 * 3. Create provider via Omni API
 * 4. Run health check
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
    let pairingResult: PairingResult;
    try {
      pairingResult = await pairDevice(opts.gatewayUrl, opts.gatewayToken, keypair, spinner);
    } catch (err) {
      if (err instanceof PairingScopeError) {
        spinner.fail('Auto-approval failed: token lacks operator.pairing scope');
        output.info('');
        output.info('Device pairing requested. Approve it manually:');
        output.info(`  openclaw devices approve --latest --url ${err.gatewayUrl}`);
        output.info('');
        output.info('Then re-run this command.');
        return;
      }
      throw err;
    }
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

export function createSetupCommand(): Command {
  const setup = new Command('setup').description('Interactive setup wizards for providers');

  setup
    .command('openclaw')
    .description('Set up an OpenClaw provider (keypair generation + device pairing + provider creation)')
    .option('--gateway-url <url>', 'Gateway WebSocket URL (ws:// or wss://)')
    .option('--gateway-token <token>', 'Gateway authentication token')
    .option('--agent-id <agentId>', 'Default agent ID')
    .option('--name <name>', 'Provider name (default: openclaw-<agent-id>)')
    .option('--non-interactive', 'Error on missing required flags instead of prompting')
    .action(
      async (options: {
        gatewayUrl?: string;
        gatewayToken?: string;
        agentId?: string;
        name?: string;
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

        // Interactive mode: prompt for missing flags
        let resolved: SetupOpenClawOptions;
        if (options.nonInteractive) {
          resolved = options as SetupOpenClawOptions;
        } else {
          resolved = await collectOptions(options);
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

  return setup;
}
