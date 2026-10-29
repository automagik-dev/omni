/** Device pairing, or target-bound Omni ↔ Genie NATS wiring. */
import type { OmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import { getConfigDir, getTargetServerName, loadConfig, loadLocalRuntimeConfig } from '../config.js';
import { type GenieEntry, discoverGenieAgent, normalizeNatsUrl, resolveConnectNatsUrl } from '../connect-preflight.js';
import * as output from '../output.js';
import { findOrCreateAgent } from './_setup-helpers.js';
import { printConnectLink } from './owner.js';

interface ConnectOptions {
  url?: string;
  natsUrl?: string;
  mode: 'turn-based' | 'fire-and-forget';
  replyFilter: 'all' | 'filtered';
}

interface ConnectDeps {
  client: () => OmniClient;
  discover: (name: string) => GenieEntry;
  nats: (override: string | undefined) => string;
  output: typeof output;
  link: typeof printConnectLink;
}

const defaults: ConnectDeps = {
  client: getClient,
  discover: discoverGenieAgent,
  nats: (override) =>
    resolveConnectNatsUrl(override, {
      apiUrl: loadConfig().apiUrl ?? 'http://localhost:8882',
      localApiUrl: loadLocalRuntimeConfig().apiUrl ?? 'http://localhost:8882',
      serverName: getTargetServerName(),
      configDir: getConfigDir(),
      sandboxHome: process.env.OMNI_SANDBOX_HOME,
      defaultSandboxHome: process.env.OMNI_HOME ? `${process.env.OMNI_HOME}/sandbox` : undefined,
    }),
  output,
  link: printConnectLink,
};

export function createConnectCommand(dependencies: Partial<ConnectDeps> = {}): Command {
  const deps = { ...defaults, ...dependencies };
  return new Command('connect')
    .description(
      'A one-time link that connects a device; or, with two arguments, wire an instance to a compatible Genie agent',
    )
    .argument('[instance-id]', 'Omni instance ID (Genie wiring)')
    .argument('[agent-name]', 'Agent name from a verified Genie directory interface')
    .option('--url <address>', 'Where devices reach this Omni, for the link (default: the address this CLI uses)')
    .option(
      '--nats-url <url>',
      'NATS URL override (default: matching local sandbox metadata, or localhost:4222 for the standard local API; required for remote targets)',
    )
    .option('--mode <mode>', 'Trigger mode: turn-based (round-trip) or fire-and-forget', 'turn-based')
    .option('--reply-filter <filter>', 'Reply filter: all (reply to everything) or filtered', 'all')
    .action(async (instanceId: string | undefined, agentName: string | undefined, options: ConnectOptions) => {
      if (instanceId === undefined && agentName === undefined) return deps.link({ url: options.url });
      if (instanceId === undefined || agentName === undefined) {
        return deps.output.error('Give both <instance-id> and <agent-name>, or neither for a device link.');
      }
      await runGenieConnect(instanceId, agentName, options, deps);
    });
}

type Provider = Awaited<ReturnType<OmniClient['providers']['list']>>[number];

function matchingProvider(provider: Provider, entry: GenieEntry, natsUrl: string): boolean {
  const config = provider.schemaConfig as Record<string, unknown> | null;
  try {
    return (
      config?.agentName === entry.name &&
      config?.agentDir === entry.dir &&
      typeof config?.natsUrl === 'string' &&
      normalizeNatsUrl(config.natsUrl) === natsUrl &&
      normalizeNatsUrl(provider.baseUrl) === natsUrl
    );
  } catch {
    return false;
  }
}

export async function runGenieConnect(
  instanceId: string,
  agentName: string,
  options: ConnectOptions,
  dependencies: Partial<ConnectDeps> = {},
): Promise<void> {
  const deps = { ...defaults, ...dependencies };
  const out = deps.output;
  let entry: GenieEntry;
  let natsUrl: string;
  try {
    // Compatibility/configuration failures must precede even client authentication.
    entry = deps.discover(agentName);
    natsUrl = deps.nats(options.natsUrl);
  } catch (error) {
    return out.error(error instanceof Error ? error.message : 'Unable to verify Genie/NATS configuration.');
  }
  const client = deps.client();
  try {
    await client.instances.get(instanceId);
  } catch {
    return out.error(`Could not read instance "${instanceId}". Check API access and run: omni instances list`);
  }

  const name = `nats-genie-${agentName}`;
  const lookup = async () => (await client.providers.list()).find((p) => p.name === name && p.schema === 'nats-genie');
  let provider: Provider | undefined;
  try {
    provider = await lookup();
  } catch {
    return out.error('Could not inspect existing providers; no Omni records were changed. Check API access.');
  }
  if (!provider) {
    try {
      provider = await client.providers.create({
        name,
        schema: 'nats-genie',
        baseUrl: natsUrl,
        schemaConfig: { agentName: entry.name, agentDir: entry.dir, natsUrl },
      });
    } catch {
      // A concurrent creator may have won: validate its configuration below as well.
      try {
        provider = await lookup();
      } catch {
        return out.error('Failed to create or inspect the NATS provider. Check API access.');
      }
      if (!provider) return out.error('Failed to create the NATS provider. Check API access.');
    }
  }
  if (!matchingProvider(provider, entry, natsUrl)) {
    return out.error(
      `Provider "${name}" has different agent or NATS configuration. Inspect it with omni providers list and reconcile it explicitly, or choose another agent name. No existing provider or instance was changed.`,
    );
  }
  const providerId = provider.id;
  const agentId = await findOrCreateAgent(client, { name: agentName, providerId, agentProvider: 'custom' });
  if (!agentId) return;
  const triggerMode = options.mode === 'turn-based' ? 'round-trip' : 'fire-and-forget';
  const replyFilterMode = options.replyFilter;
  const agentReplyFilter = { mode: replyFilterMode, conditions: {} };
  try {
    await client.instances.update(instanceId, { agentId, agentReplyFilter, triggerMode } as Record<string, unknown>);
  } catch {
    return out.error(
      `Could not update instance agent assignment. Provider/agent records may exist. Set manually: omni instances update ${instanceId} --agent-fk-id ${agentId}`,
    );
  }
  out.success(`Configured instance "${instanceId}" for Genie agent "${agentName}".`);
  out.header('Configuration Summary');
  out.keyValue('Agent ID', agentId);
  out.keyValue('Provider ID', providerId);
  out.keyValue('Reply Filter', replyFilterMode);
  out.keyValue('Trigger Mode', `${triggerMode} (--mode ${options.mode})`);
  out.header('NATS Topics');
  out.keyValue('Inbound', `omni.message.${instanceId}.*`);
  out.keyValue('Outbound', `omni.reply.${instanceId}.*`);
  out.header('Next Step');
  out.info(
    'This configures Omni only; the external Genie bridge was not started or verified. Consult the installed Genie version documentation and genie --help to verify its integration.',
  );
}
