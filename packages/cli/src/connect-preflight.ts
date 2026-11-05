/** Read-only compatibility checks and target-bound defaults for Genie wiring. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { VERSION } from './version.js';

const GenieEntrySchema = z.object({ name: z.string().trim().min(1), dir: z.string().trim().min(1) });
export type GenieEntry = z.infer<typeof GenieEntrySchema>;
export type GenieRunner = (args: string[]) => string;

const runGenie: GenieRunner = (args) =>
  execFileSync('genie', args, {
    encoding: 'utf-8',
    timeout: 10_000,
    maxBuffer: 256 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

function advertises(help: string, command: string): boolean {
  return help.split('\n').some((line) => new RegExp(`^\\s{2,}${command}(?:\\s|$)`).test(line));
}

export function discoverGenieAgent(agentName: string, run: GenieRunner = runGenie): GenieEntry {
  let version: string;
  try {
    const reported = run(['--version']).trim();
    const match = /^(?:genie(?: CLI)?\s+)?v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/i.exec(reported);
    if (!match) throw new Error('Unrecognized version');
    version = match[1] as string;
  } catch {
    throw new Error(
      `Omni ${VERSION} could not identify the installed Genie. Check genie --version and genie --help; no Omni records were changed.`,
    );
  }
  const incompatible = () =>
    new Error(
      `Omni ${VERSION} cannot discover agents with installed Genie ${version}: no verified directory JSON interface. Run genie --help and consult the documentation for that installed version, or use a compatible external runtime with omni setup agent --help. No Omni records were changed.`,
    );
  try {
    // Probe each parent before invoking a potentially removed subcommand.
    if (!advertises(run(['--help']), 'dir')) throw incompatible();
    if (!advertises(run(['dir', '--help']), 'ls')) throw incompatible();
    if (!/(?:^|[\s,])--json(?:[\s,]|$)/m.test(run(['dir', 'ls', '--help']))) throw incompatible();
  } catch {
    throw incompatible();
  }
  try {
    if (!agentName.trim() || agentName.startsWith('-')) throw new Error('Invalid agent name');
    const entry = GenieEntrySchema.parse(JSON.parse(run(['dir', 'ls', agentName, '--json']).trim()));
    if (entry.name !== agentName) throw new Error('Directory returned a different agent');
    return entry;
  } catch {
    throw new Error(
      `Genie ${version} advertised directory discovery but could not resolve agent ${JSON.stringify(agentName)}. Check the agent and directory JSON interface in genie --help; no Omni records were changed.`,
    );
  }
}

/** Keep supported transport/auth forms while producing one scheme and explicit port. */
export function normalizeNatsUrl(value: string): string {
  const raw = z.string().trim().min(1).parse(value);
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `nats://${raw}`);
  } catch {
    throw new Error('Invalid NATS URL. Use --nats-url nats://host:port.');
  }
  const defaultPorts: Record<string, number> = { 'nats:': 4222, 'tls:': 4222, 'ws:': 80, 'wss:': 443 };
  const defaultPort = defaultPorts[url.protocol];
  const port = url.port ? Number(url.port) : defaultPort;
  if (
    !defaultPort ||
    !url.hostname ||
    !port ||
    port < 1 ||
    port > 65535 ||
    ((url.protocol === 'nats:' || url.protocol === 'tls:') && url.pathname !== '' && url.pathname !== '/') ||
    url.hash
  ) {
    throw new Error('Invalid NATS URL. Use a nats://, tls://, ws:// or wss:// broker URL.');
  }
  // URL validates/escapes credentials; never expose this value in diagnostics.
  const auth = url.username || url.password ? `${url.username}${url.password ? `:${url.password}` : ''}@` : '';
  const path = url.protocol === 'ws:' || url.protocol === 'wss:' ? url.pathname : '';
  return `${url.protocol}//${auth}${url.hostname.toLowerCase()}:${port}${path}${url.search}`;
}

// Versioned projection of sandbox.ts's on-disk contract, without importing its installer/runtime graph.
const PortSchema = z.number().int().min(1024).max(65535);
const SandboxMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  ports: z.object({ api: PortSchema, nats: PortSchema }),
});

export interface NatsTarget {
  apiUrl: string;
  localApiUrl: string;
  serverName: string;
  configDir: string;
  sandboxHome?: string;
  defaultSandboxHome?: string;
}
type ReadMetadata = (path: string) => unknown;
const readMetadata: ReadMetadata = (path) => JSON.parse(readFileSync(path, 'utf-8'));

function localEndpoint(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    if (url.username || url.password || url.search || url.hash || (url.pathname !== '' && url.pathname !== '/'))
      return null;
    return `http://loopback:${url.port || '80'}`;
  } catch {
    return null;
  }
}

export function resolveConnectNatsUrl(
  override: string | undefined,
  target: NatsTarget,
  read: ReadMetadata = readMetadata,
): string {
  if (override !== undefined) return normalizeNatsUrl(override);
  const endpoint = localEndpoint(target.apiUrl);
  if (target.serverName !== 'default' || !endpoint || endpoint !== localEndpoint(target.localApiUrl)) {
    throw new Error(
      'The selected Omni target has no verified local NATS configuration. Supply --nats-url for that server.',
    );
  }
  const configHome = basename(resolve(target.configDir)) === 'config' ? dirname(resolve(target.configDir)) : undefined;
  const homes = new Set([
    ...(configHome ? [configHome] : []),
    ...(target.sandboxHome ? [resolve(target.sandboxHome)] : []),
    resolve(target.defaultSandboxHome ?? join(homedir(), '.omni', 'sandbox')),
  ]);
  const apiPort = Number(new URL(target.apiUrl).port || '80');
  const matches: number[] = [];
  for (const home of homes) {
    try {
      const state = SandboxMetadataSchema.safeParse(read(join(home, 'sandbox.json')));
      if (state.success && state.data.ports.api === apiPort) matches.push(state.data.ports.nats);
    } catch {
      // Missing/corrupt state is not evidence of a sandbox port.
    }
  }
  if (new Set(matches).size > 1) {
    throw new Error('Conflicting sandbox NATS metadata. Supply --nats-url explicitly.');
  }
  if (matches[0] !== undefined) return `nats://127.0.0.1:${matches[0]}`;
  if (endpoint === 'http://loopback:8882' && !configHome && !target.sandboxHome) return 'nats://localhost:4222';
  throw new Error('No matching sandbox NATS metadata for the selected API address. Supply --nats-url explicitly.');
}
