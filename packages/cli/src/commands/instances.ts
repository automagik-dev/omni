/**
 * Instance Commands
 *
 * All <id> arguments accept: full UUID, partial UUID prefix, or instance name.
 *
 * omni instances list
 * omni instances get <id>
 * omni instances create --name <name> --channel <type>
 * omni instances delete <id>
 * omni instances status <id>
 * omni instances qr <id>
 * omni instances pair <id> --phone <number>
 * omni instances connect <id>
 * omni instances disconnect <id>
 * omni instances restart <id>
 * omni instances logout <id>
 * omni instances sync <id> --type <type> [--chat <jid>]
 * omni instances syncs <id> [job-id]
 */

import type { Channel } from '@omni/sdk';
import { Command } from 'commander';
import qrcode from 'qrcode-terminal';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveInstanceId } from '../resolve.js';

const VALID_CHANNELS: Channel[] = ['whatsapp-baileys', 'whatsapp-cloud', 'discord', 'slack', 'telegram', 'gupshup'];
const VALID_SYNC_TYPES = ['profile', 'messages', 'contacts', 'groups', 'all'] as const;

/** Set value on body, resolving "null" string to actual null */
function setVal(body: Record<string, unknown>, key: string, val: unknown): void {
  if (val === 'null') body[key] = null;
  else if (val !== undefined) body[key] = val;
}

/** Set boolean on body (handles Commander's --flag / --no-flag booleans) */
function setBool(body: Record<string, unknown>, key: string, val: unknown): void {
  if (val === true) body[key] = true;
  if (val === false) body[key] = false;
}

/** Extract agent routing fields from CLI options into body */
function applyAgentFields(body: Record<string, unknown>, opts: Record<string, unknown>): void {
  // agentFkId (--agent-fk-id) is now the primary way to set the agent (maps to agentId in DB)
  setVal(body, 'agentId', opts.agentFkId);
  if (opts.agentTimeout !== undefined) body.agentTimeout = opts.agentTimeout;
  setBool(body, 'agentStreamMode', opts.agentStreamMode);
  setVal(body, 'agentSessionStrategy', opts.agentSessionStrategy);
  setBool(body, 'agentPrefixSenderName', opts.agentPrefixSenderName);
  setBool(body, 'agentWaitForMedia', opts.agentWaitForMedia);
  setBool(body, 'agentSendMediaPath', opts.agentSendMediaPath);
  if (typeof opts.agentSendMediaPathTypes === 'string') {
    body.agentSendMediaPathTypes = (opts.agentSendMediaPathTypes as string).split(',').map((s: string) => s.trim());
  }
}

/** Extract reply filter fields from CLI options into body */
function applyReplyFilter(body: Record<string, unknown>, opts: Record<string, unknown>): void {
  if (opts.clearReplyFilter) {
    body.agentReplyFilter = null;
    return;
  }
  if (!opts.replyFilterMode) return;
  const cond: Record<string, unknown> = {};
  setBool(cond, 'onDm', opts.replyOnDm);
  setBool(cond, 'onMention', opts.replyOnMention);
  setBool(cond, 'onReply', opts.replyOnReply);
  if (opts.replyOnName === true || opts.replyOnName === false) cond.onNameMatch = opts.replyOnName;
  if (opts.replyNamePatterns) {
    cond.namePatterns = (opts.replyNamePatterns as string).split(',').map((s) => s.trim());
  }
  body.agentReplyFilter = { mode: opts.replyFilterMode, conditions: cond };
}

/** Extract message formatting fields from CLI options into body */
function applyFormatFields(body: Record<string, unknown>, opts: Record<string, unknown>): void {
  setBool(body, 'enableAutoSplit', opts.enableAutoSplit);
  setVal(body, 'messageFormatMode', opts.messageFormatMode);
}

/** Extract debounce fields from CLI options into body */
function applyDebounceFields(body: Record<string, unknown>, opts: Record<string, unknown>): void {
  setVal(body, 'messageDebounceMode', opts.debounceMode);
  if (opts.debounceMin !== undefined) body.messageDebounceMinMs = opts.debounceMin;
  if (opts.debounceMax !== undefined) body.messageDebounceMaxMs = opts.debounceMax;
  setBool(body, 'messageDebounceRestartOnTyping', opts.debounceRestartOnTyping);
  if (opts.debounceGroup !== undefined) body.messageDebounceGroupMs = opts.debounceGroup;
}

/** Extract split-delay fields from CLI options into body */
function applySplitDelayFields(body: Record<string, unknown>, opts: Record<string, unknown>): void {
  setVal(body, 'messageSplitDelayMode', opts.splitDelayMode);
  if (opts.splitDelayFixed !== undefined) body.messageSplitDelayFixedMs = opts.splitDelayFixed;
  if (opts.splitDelayMin !== undefined) body.messageSplitDelayMinMs = opts.splitDelayMin;
  if (opts.splitDelayMax !== undefined) body.messageSplitDelayMaxMs = opts.splitDelayMax;
}

/** Extract agent gate fields from CLI options into body */
function applyGateFields(body: Record<string, unknown>, opts: Record<string, unknown>): void {
  setBool(body, 'agentGateEnabled', opts.agentGate);
  setVal(body, 'agentGateModel', opts.agentGateModel);
  setVal(body, 'agentGatePrompt', opts.agentGatePrompt);
}

/** Extract TTS, access, token, trigger fields from CLI options into body */
function applyMiscFields(body: Record<string, unknown>, opts: Record<string, unknown>): void {
  setVal(body, 'ttsVoiceId', opts.ttsVoice);
  setVal(body, 'ttsModelId', opts.ttsModel);
  setVal(body, 'accessMode', opts.accessMode);
  setVal(body, 'token', opts.token);
  setVal(body, 'telegramBotToken', opts.telegramToken);
  setVal(body, 'discordBotToken', opts.discordToken);
  setVal(body, 'slackBotToken', opts.slackBotToken);
  setVal(body, 'slackAppToken', opts.slackAppToken);
  setVal(body, 'gupshupCallbackUrl', opts.gupshupCallbackUrl);
  setVal(body, 'gupshupAuthToken', opts.gupshupAuthToken);
  setVal(body, 'gupshupEventId', opts.gupshupEventId);
  setVal(body, 'webhookVerifyToken', opts.gupshupWebhookVerifyToken);
  setVal(body, 'bridgeTmuxSession', opts.bridgeTmuxSession);
  if (opts.triggerEvents !== undefined) {
    const raw = opts.triggerEvents as string;
    body.triggerEvents = raw === 'null' ? null : raw.split(',').map((s) => s.trim());
  }
}

/** Extract reaction ack fields from CLI options into body */
function applyAckFields(body: Record<string, unknown>, opts: Record<string, unknown>): void {
  setVal(body, 'reactionAck', opts.reactionAck);
  if (opts.reactionAckEmoji !== undefined) {
    try {
      body.reactionAckEmoji = JSON.parse(opts.reactionAckEmoji as string);
    } catch {
      throw new Error('--reaction-ack-emoji must be valid JSON (e.g. \'{"whatsapp":"\\u2705"}\')');
    }
  }
  if (opts.ackTimeout !== undefined) {
    body.ackTimeoutMs = Number(opts.ackTimeout);
  }
}

/** Extract stalled-turn threshold (turn-monitor internal event) */
function applyStalledFields(body: Record<string, unknown>, opts: Record<string, unknown>): void {
  if (opts.agentStalledTimeoutMs !== undefined) {
    body.agentStalledTimeoutMs = Number(opts.agentStalledTimeoutMs);
  }
}

/** Build instance body from all CLI options */
function buildInstanceBody(opts: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  applyAgentFields(body, opts);
  applyReplyFilter(body, opts);
  applyFormatFields(body, opts);
  applyDebounceFields(body, opts);
  applySplitDelayFields(body, opts);
  applyGateFields(body, opts);
  applyMiscFields(body, opts);
  applyAckFields(body, opts);
  applyStalledFields(body, opts);
  return body;
}

async function resolveBase64Image(options: { base64?: string; url?: string }): Promise<string> {
  if (options.base64) return options.base64;
  if (!options.url) throw new Error('Either --base64 or --url is required');
  const resp = await fetch(options.url);
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

/** Generic API call helper for direct fetch requests */
async function apiCall(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const config = (await import('../config.js')).loadConfig();
  const baseUrl = config.apiUrl ?? 'http://localhost:8882';
  const apiKey = config.apiKey ?? '';
  const headers: Record<string, string> = { 'x-api-key': apiKey };
  if (body) headers['Content-Type'] = 'application/json';
  const resp = await fetch(`${baseUrl}/api/v2/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const err = (await resp.json()) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
  }
  return resp.json();
}

export function createInstancesCommand(): Command {
  const instances = new Command('instances').description('Manage channel instances');

  // omni instances list
  instances
    .command('list')
    .description('List all instances')
    .option('--channel <type>', 'Filter by channel type')
    .option('--status <status>', 'Filter by status')
    .option('--limit <n>', 'Limit results', Number.parseInt)
    .action(async (options: { channel?: string; status?: string; limit?: number }) => {
      const client = getClient();

      try {
        const result = await client.instances.list({
          channel: options.channel,
          status: options.status,
          limit: options.limit,
        });

        // Fetch status for each instance to get phone/owner
        const statusMap = new Map<string, string>();
        await Promise.allSettled(
          result.items.map(async (i) => {
            try {
              const st = (await client.instances.status(i.id)) as { ownerIdentifier?: string };
              if (st.ownerIdentifier) {
                // Parse phone from JID like "5512982298888:36@s.whatsapp.net" or "5512982298888@s.whatsapp.net"
                const phone = st.ownerIdentifier.includes(':')
                  ? st.ownerIdentifier.split(':')[0]
                  : st.ownerIdentifier.split('@')[0];
                statusMap.set(i.id, phone);
              }
            } catch {
              /* skip if status unavailable */
            }
          }),
        );

        // Simplify output for display
        const items = result.items.map((i) => ({
          id: i.id,
          name: i.name,
          channel: i.channel,
          active: i.isActive ? 'yes' : 'no',
          profileName: i.profileName ?? '-',
          phone: statusMap.get(i.id) ?? '-',
        }));

        output.list(items, { emptyMessage: 'No instances found.', rawData: result.items });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list instances: ${message}`);
      }
    });

  // omni instances get <id>
  instances
    .command('get <id>')
    .description('Get instance details')
    .action(async (rawId: string) => {
      const client = getClient();

      try {
        const id = await resolveInstanceId(rawId);
        const instance = await client.instances.get(id);
        output.data(instance);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get instance: ${message}`, undefined, 3);
      }
    });

  // omni instances create
  instances
    .command('create')
    .description('Create a new instance (supports all API fields)')
    .requiredOption('--name <name>', 'Instance name')
    .requiredOption('--channel <type>', `Channel type (${VALID_CHANNELS.join(', ')})`)
    // Agent routing
    .option(
      '--agent-fk-id <uuid>',
      'Agent FK UUID (references agents table, use "null" to clear). When set without --reply-filter-mode, reply filter defaults to {mode:"all", onDm:true} so messages are dispatched instead of silently dropped (omni#443).',
    )
    .option('--agent-provider <id>', 'Agent provider ID')
    .option('--agent <id>', 'Agent ID')
    .option('--agent-type <type>', 'Agent type: agent, team, or workflow')
    .option('--agent-timeout <seconds>', 'Agent timeout in seconds', (v) => Number.parseInt(v, 10))
    .option('--agent-stream-mode', 'Enable streaming responses')
    .option('--agent-session-strategy <strategy>', 'Session strategy: per_user, per_chat, per_user_per_chat')
    .option('--agent-prefix-sender-name', 'Prefix messages with sender name')
    .option('--no-agent-prefix-sender-name', 'Disable sender name prefix')
    .option('--agent-wait-for-media', 'Wait for media processing before dispatch')
    .option('--no-agent-wait-for-media', 'Dispatch immediately without waiting for media')
    .option('--agent-send-media-path', 'Include file path in formatted media text')
    .option('--no-agent-send-media-path', 'Exclude file path from formatted media text')
    .option(
      '--agent-send-media-path-types <types>',
      'Content types that receive file path (comma-separated: image,video,document)',
    )
    // Reply filter
    .option('--reply-filter-mode <mode>', 'Reply filter: all or filtered')
    .option('--reply-on-dm', 'Reply to DMs')
    .option('--no-reply-on-dm', 'Ignore DMs')
    .option('--reply-on-mention', 'Reply when @mentioned')
    .option('--no-reply-on-mention', 'Ignore @mentions')
    .option('--reply-on-reply', 'Reply when message is reply to bot')
    .option('--no-reply-on-reply', 'Ignore replies')
    .option('--reply-on-name', 'Reply when bot name appears in text')
    .option('--no-reply-on-name', 'Ignore name matches')
    .option('--reply-name-patterns <patterns>', 'Custom name patterns (comma-separated)')
    // Message formatting
    .option('--enable-auto-split', 'Split responses on double newlines')
    .option('--no-enable-auto-split', 'Disable auto-split')
    .option('--message-format-mode <mode>', 'Format mode: convert or passthrough')
    // Debounce
    .option('--debounce-mode <mode>', 'Debounce mode: disabled, fixed, or randomized')
    .option('--debounce-min <ms>', 'Minimum debounce delay in ms', (v) => Number.parseInt(v, 10))
    .option('--debounce-max <ms>', 'Maximum debounce delay in ms', (v) => Number.parseInt(v, 10))
    .option('--debounce-restart-on-typing', 'Restart debounce timer on typing')
    .option('--debounce-group <ms>', 'Group chat debounce in ms', (v) => Number.parseInt(v, 10))
    // Split delay (between agent-reply chunks)
    .option('--split-delay-mode <mode>', 'Split delay mode: disabled, fixed, or randomized')
    .option('--split-delay-fixed <ms>', 'Fixed delay between split chunks in ms', (v) => Number.parseInt(v, 10))
    .option('--split-delay-min <ms>', 'Minimum delay between split chunks in ms', (v) => Number.parseInt(v, 10))
    .option('--split-delay-max <ms>', 'Maximum delay between split chunks in ms', (v) => Number.parseInt(v, 10))
    // Agent gate
    .option('--agent-gate', 'Enable LLM response gate')
    .option('--agent-gate-model <model>', 'Model for response gate')
    .option('--agent-gate-prompt <prompt>', 'Custom gate prompt')
    // TTS
    .option('--tts-voice <id>', 'ElevenLabs voice ID')
    .option('--tts-model <id>', 'ElevenLabs model ID')
    // Access control
    .option('--access-mode <mode>', 'Access mode: disabled, blocklist, or allowlist')
    // Reaction ack
    .option('--reaction-ack <mode>', 'Reaction ack mode (on|off)')
    .option('--reaction-ack-emoji <json>', 'Per-channel emoji map as JSON')
    .option('--ack-timeout <ms>', 'Ack timeout in milliseconds', (v) => Number.parseInt(v, 10))
    .option(
      '--agent-stalled-timeout-ms <ms>',
      'Idle threshold in ms before the internal turn.stalled event fires (no channel message is ever sent)',
      (v) => Number.parseInt(v, 10),
    )
    // Channel tokens
    .option('--token <token>', 'Generic bot token (auto-resolves to channel-specific field)')
    .option('--telegram-token <token>', 'Telegram bot token')
    .option('--discord-token <token>', 'Discord bot token')
    .option('--slack-bot-token <token>', 'Slack bot token')
    .option('--slack-app-token <token>', 'Slack app token')
    // Gupshup
    .option('--gupshup-callback-url <url>', 'Gupshup Custom Integration callback URL')
    .option('--gupshup-auth-token <token>', 'Gupshup Custom Integration auth token')
    .option('--gupshup-event-id <id>', 'Gupshup event ID (default: nx_omni_agent_reply)')
    .option('--gupshup-webhook-verify-token <token>', 'Gupshup webhook verify token')
    // Bridge tmux session override (parity with `update`; propagated via NATS env)
    .option(
      '--bridge-tmux-session <name>',
      'Tmux session name the genie bridge spawns into for this instance (propagated as GENIE_TMUX_SESSION via NATS). Use "null" to clear.',
    )
    // Default
    .option('--is-default', 'Set as default instance for channel')
    .action(async (options: Record<string, unknown>) => {
      const channel = options.channel as string;
      if (!VALID_CHANNELS.includes(channel as Channel)) {
        output.error(`Invalid channel: ${channel}`, { validChannels: VALID_CHANNELS });
      }

      try {
        const body = buildInstanceBody(options);
        body.name = options.name;
        body.channel = channel;
        setBool(body, 'isDefault', options.isDefault);

        const response = (await apiCall('instances', 'POST', body)) as {
          data?: {
            id: string;
            name: string;
            channel: string;
            isActive: boolean;
          };
          id?: string;
          name?: string;
          channel?: string;
          isActive?: boolean;
        };
        const instance = (response.data ?? response) as {
          id: string;
          name: string;
          channel: string;
          isActive: boolean;
        };

        output.success(`Instance created: ${instance.id}`, {
          id: instance.id,
          name: instance.name,
          channel: instance.channel,
          active: instance.isActive,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to create instance: ${message}`);
      }
    });

  // omni instances delete <id>
  instances
    .command('delete <id>')
    .description('Delete an instance')
    .action(async (rawId: string) => {
      const client = getClient();

      try {
        const id = await resolveInstanceId(rawId);
        await client.instances.delete(id);
        output.success(`Instance deleted: ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to delete instance: ${message}`);
      }
    });

  // omni instances status <id>
  instances
    .command('status <id>')
    .description('Get instance connection status')
    .action(async (rawId: string) => {
      const client = getClient();

      try {
        const id = await resolveInstanceId(rawId);
        const status = await client.instances.status(id);
        output.data({
          instanceId: id,
          ...status,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get status: ${message}`, undefined, 3);
      }
    });

  // omni instances whoami <id>
  instances
    .command('whoami <id>')
    .description('Show phone number and identity for an instance')
    .action(async (rawId: string) => {
      const client = getClient();

      try {
        const id = await resolveInstanceId(rawId);
        const status = (await client.instances.status(id)) as {
          state: string;
          isConnected: boolean;
          profileName?: string | null;
          profilePicUrl?: string | null;
          ownerIdentifier?: string;
        };

        const owner = status.ownerIdentifier ?? '-';
        const phone = owner !== '-' ? (owner.includes(':') ? owner.split(':')[0] : owner.split('@')[0]) : '-';

        output.data({
          instanceId: id,
          phone,
          profileName: status.profileName ?? '-',
          ownerIdentifier: owner,
          state: status.state,
          isConnected: status.isConnected,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get identity: ${message}`);
      }
    });

  // omni instances qr <id>
  instances
    .command('qr <id>')
    .description('Get QR code for WhatsApp instances')
    .option('--base64', 'Output raw base64 instead of ASCII')
    .option('--no-watch', 'Show QR once without auto-refreshing')
    .action(async (rawId: string, options: { base64?: boolean; watch?: boolean }) => {
      const client = getClient();
      const id = await resolveInstanceId(rawId);

      const renderQrAscii = async (qrData: string, expiresAt?: string): Promise<void> => {
        return new Promise<void>((resolve) => {
          qrcode.generate(qrData, { small: true }, (qrArt: string) => {
            output.raw(qrArt);
            if (expiresAt) output.dim(`Expires: ${expiresAt}`);
            resolve();
          });
        });
      };

      const outputQrResult = async (result: {
        qr: string | null;
        expiresAt: string | null;
        message: string;
      }): Promise<void> => {
        if (options.base64 || output.getCurrentFormat() === 'json') {
          output.data({ qr: result.qr, expiresAt: result.expiresAt });
        } else if (result.qr) {
          await renderQrAscii(result.qr, result.expiresAt ?? undefined);
        }
      };

      const fetchAndShowQr = async (watch: boolean): Promise<boolean> => {
        const status = await client.instances.status(id);
        if (status.isConnected) {
          output.success('Connected!');
          return true;
        }

        const result = await client.instances.qr(id);
        if (!result.qr) {
          output.warn(result.message || 'No QR available');
          return false;
        }

        // biome-ignore lint/suspicious/noConsole: CLI clear screen
        if (watch) console.clear();
        if (watch) output.info('Scan with WhatsApp (auto-refreshing, Ctrl+C to stop)\n');

        await outputQrResult(result);
        return false;
      };

      const QR_POLL_INTERVAL_MS = 5000;

      // Non-interactive modes (--json, --base64) always single-shot to avoid
      // hanging automation consumers that expect one payload then exit.
      const shouldWatch = options.watch && !options.base64 && output.getCurrentFormat() !== 'json';

      if (shouldWatch) {
        const poll = async (): Promise<void> => {
          try {
            const connected = await fetchAndShowQr(true);
            if (!connected) setTimeout(poll, QR_POLL_INTERVAL_MS);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            output.error(`Failed to get QR code: ${message}`);
          }
        };
        await poll();
      } else {
        try {
          await fetchAndShowQr(false);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to get QR code: ${message}`);
        }
      }
    });

  // omni instances pair <id> --phone <number>
  instances
    .command('pair <id>')
    .description('Request pairing code (alternative to QR)')
    .requiredOption('--phone <number>', 'Phone number with country code (e.g., +5511999999999)')
    .action(async (rawId: string, options: { phone: string }) => {
      const client = getClient();

      try {
        const id = await resolveInstanceId(rawId);
        const result = await client.instances.pair(id, { phoneNumber: options.phone });
        output.success(`Pairing code: ${result.code}`, {
          code: result.code,
          phoneNumber: result.phoneNumber,
          expiresIn: result.expiresIn,
          message: result.message,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to request pairing code: ${message}`);
      }
    });

  // omni instances connect <id>
  instances
    .command('connect <id>')
    .description('Connect an instance')
    .option('--force-new-qr', 'Force generation of new QR code')
    .option('--token <token>', 'Discord bot token (for Discord instances)')
    .action(async (rawId: string, options: { forceNewQr?: boolean; token?: string }) => {
      const client = getClient();

      try {
        const id = await resolveInstanceId(rawId);
        const result = await client.instances.connect(id, {
          forceNewQr: options.forceNewQr,
          token: options.token,
        });

        output.success(result.message, {
          status: result.status,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to connect: ${message}`);
      }
    });

  // omni instances disconnect <id>
  instances
    .command('disconnect <id>')
    .description('Disconnect an instance')
    .action(async (rawId: string) => {
      const client = getClient();

      try {
        const id = await resolveInstanceId(rawId);
        await client.instances.disconnect(id);
        output.success(`Instance disconnected: ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to disconnect: ${message}`);
      }
    });

  // omni instances restart <id>
  instances
    .command('restart <id>')
    .description('Restart an instance')
    .option('--force-new-qr', 'Force generation of new QR code after restart')
    .action(async (rawId: string, options: { forceNewQr?: boolean }) => {
      const client = getClient();

      try {
        const id = await resolveInstanceId(rawId);
        const result = await client.instances.restart(id, options.forceNewQr);
        output.success(result.message, {
          status: result.status,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to restart: ${message}`);
      }
    });

  // omni instances logout <id>
  instances
    .command('logout <id>')
    .description('Logout and clear session data')
    .action(async (rawId: string) => {
      const client = getClient();

      try {
        const id = await resolveInstanceId(rawId);
        await client.instances.logout(id);
        output.success(`Instance logged out: ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to logout: ${message}`);
      }
    });

  // omni instances sync <id> --type <type> [--chat <jid>]
  instances
    .command('sync <id>')
    .description('Start a sync operation')
    .requiredOption('--type <type>', `Sync type (${VALID_SYNC_TYPES.join(', ')})`)
    .option('--depth <depth>', 'Sync depth (7d, 30d, 90d, 1y, all)')
    .option('--download-media', 'Download media files')
    .option('--chat <jid>', 'Specific chat JID for per-chat active sync (WhatsApp only)')
    .action(
      async (rawId: string, options: { type: string; depth?: string; downloadMedia?: boolean; chat?: string }) => {
        if (!VALID_SYNC_TYPES.includes(options.type as (typeof VALID_SYNC_TYPES)[number])) {
          output.error(`Invalid sync type: ${options.type}`, {
            validTypes: VALID_SYNC_TYPES,
          });
        }

        const client = getClient();

        try {
          const id = await resolveInstanceId(rawId);
          // Profile sync is immediate
          if (options.type === 'profile') {
            const result = await client.instances.syncProfile(id);
            output.success('Profile synced', result);
            return;
          }

          // Other syncs create a job
          const result = await client.instances.startSync(id, {
            type: options.type as (typeof VALID_SYNC_TYPES)[number],
            depth: options.depth as '7d' | '30d' | '90d' | '1y' | 'all' | undefined,
            downloadMedia: options.downloadMedia,
            ...(options.chat ? { chatJids: [options.chat] } : {}),
          });

          const syncMode = options.chat ? `active (chat: ${options.chat})` : 'passive';
          output.success(result.message, {
            jobId: result.jobId,
            type: result.type,
            status: result.status,
            mode: syncMode,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to start sync: ${message}`);
        }
      },
    );

  // omni instances syncs <id> [job-id]
  instances
    .command('syncs <id> [jobId]')
    .description('List sync jobs or get job status')
    .option('--status <status>', 'Filter by status')
    .option('--limit <n>', 'Limit results', Number.parseInt)
    .action(async (rawId: string, jobId?: string, options?: { status?: string; limit?: number }) => {
      const client = getClient();

      try {
        const id = await resolveInstanceId(rawId);
        if (jobId) {
          // Get specific job status
          const job = await client.instances.getSyncStatus(id, jobId);
          output.data(job);
        } else {
          // List all jobs
          const result = await client.instances.listSyncs(id, {
            status: options?.status,
            limit: options?.limit,
          });

          output.list(result.items, { emptyMessage: 'No sync jobs found.' });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get sync info: ${message}`, undefined, 3);
      }
    });

  // Helper: update profile name via API (calls WhatsApp directly)
  async function updateProfileName(instanceId: string, name: string): Promise<void> {
    const config = (await import('../config.js')).loadConfig();
    const apiUrl = (config.apiUrl ?? 'http://localhost:8882').replace(/\/$/, '');
    const response = await fetch(`${apiUrl}/api/v2/instances/${instanceId}/profile/name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey ?? '' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      const err = (await response.json()) as { error?: { message?: string } };
      throw new Error(err?.error?.message ?? `HTTP ${response.status}`);
    }
  }

  // omni instances update <id>
  instances
    .command('update <id>')
    .description('Update an instance (supports all API fields)')
    // Identity
    .option('--name <name>', 'Instance name')
    .option('--is-default', 'Set as default instance for channel')
    .option('--no-is-default', 'Unset as default instance for channel')
    // Agent routing
    .option(
      '--agent-fk-id <uuid>',
      'Agent FK UUID (references agents table, use "null" to clear). When assigning an agent on an instance with no reply filter, the filter defaults to {mode:"all", onDm:true} so messages are dispatched instead of silently dropped (omni#443).',
    )
    .option('--agent-provider <id>', 'Agent provider ID (use "null" to clear)')
    .option('--agent <id>', 'Agent ID (use "null" to clear)')
    .option('--agent-type <type>', 'Agent type: agent, team, or workflow')
    .option('--agent-timeout <seconds>', 'Agent timeout in seconds', (v) => Number.parseInt(v, 10))
    .option('--agent-stream-mode', 'Enable streaming responses')
    .option('--no-agent-stream-mode', 'Disable streaming responses')
    .option('--agent-session-strategy <strategy>', 'Session strategy: per_user, per_chat, per_user_per_chat')
    .option('--agent-prefix-sender-name', 'Prefix messages with sender name')
    .option('--no-agent-prefix-sender-name', 'Disable sender name prefix')
    .option('--agent-wait-for-media', 'Wait for media processing before dispatch')
    .option('--no-agent-wait-for-media', 'Dispatch immediately without waiting for media')
    .option('--agent-send-media-path', 'Include file path in formatted media text')
    .option('--no-agent-send-media-path', 'Exclude file path from formatted media text')
    .option(
      '--agent-send-media-path-types <types>',
      'Content types that receive file path (comma-separated: image,video,document)',
    )
    // Reply filter
    .option('--reply-filter-mode <mode>', 'Reply filter: all or filtered')
    .option('--reply-on-dm', 'Reply to DMs (requires --reply-filter-mode filtered)')
    .option('--no-reply-on-dm', 'Ignore DMs')
    .option('--reply-on-mention', 'Reply when @mentioned')
    .option('--no-reply-on-mention', 'Ignore @mentions')
    .option('--reply-on-reply', 'Reply when message is reply to bot')
    .option('--no-reply-on-reply', 'Ignore replies')
    .option('--reply-on-name', 'Reply when bot name appears in text')
    .option('--no-reply-on-name', 'Ignore name matches')
    .option('--reply-name-patterns <patterns>', 'Custom name patterns (comma-separated)')
    .option('--clear-reply-filter', 'Remove reply filter (set to null)')
    // Message formatting
    .option('--enable-auto-split', 'Split responses on double newlines')
    .option('--no-enable-auto-split', 'Disable auto-split')
    .option('--message-format-mode <mode>', 'Format mode: convert or passthrough')
    // Debounce
    .option('--debounce-mode <mode>', 'Debounce mode: disabled, fixed, or randomized')
    .option('--debounce-min <ms>', 'Minimum debounce delay in ms', (v) => Number.parseInt(v, 10))
    .option('--debounce-max <ms>', 'Maximum debounce delay in ms', (v) => Number.parseInt(v, 10))
    .option('--debounce-restart-on-typing', 'Restart debounce timer on typing')
    .option('--no-debounce-restart-on-typing', 'Do not restart debounce on typing')
    .option('--debounce-group <ms>', 'Group chat debounce in ms (use "null" to inherit)', (v) =>
      v === 'null' ? null : Number.parseInt(v, 10),
    )
    // Split delay (between agent-reply chunks)
    .option('--split-delay-mode <mode>', 'Split delay mode: disabled, fixed, or randomized')
    .option('--split-delay-fixed <ms>', 'Fixed delay between split chunks in ms', (v) => Number.parseInt(v, 10))
    .option('--split-delay-min <ms>', 'Minimum delay between split chunks in ms', (v) => Number.parseInt(v, 10))
    .option('--split-delay-max <ms>', 'Maximum delay between split chunks in ms', (v) => Number.parseInt(v, 10))
    // Agent gate
    .option('--agent-gate', 'Enable LLM response gate')
    .option('--no-agent-gate', 'Disable LLM response gate')
    .option('--agent-gate-model <model>', 'Model for response gate (use "null" for default)')
    .option('--agent-gate-prompt <prompt>', 'Custom gate prompt (use "null" for default)')
    // TTS
    .option('--tts-voice <id>', 'ElevenLabs voice ID (use "null" to clear)')
    .option('--tts-model <id>', 'ElevenLabs model ID (use "null" to clear)')
    // Access control
    .option('--access-mode <mode>', 'Access mode: disabled, blocklist, or allowlist')
    // Reaction ack
    .option('--reaction-ack <mode>', 'Reaction ack mode (on|off)')
    .option('--reaction-ack-emoji <json>', 'Per-channel emoji map as JSON')
    .option('--ack-timeout <ms>', 'Ack timeout in milliseconds', (v) => Number.parseInt(v, 10))
    .option(
      '--agent-stalled-timeout-ms <ms>',
      'Idle threshold in ms before the internal turn.stalled event fires (no channel message is ever sent)',
      (v) => Number.parseInt(v, 10),
    )
    // Channel tokens
    .option('--token <token>', 'Generic bot token (auto-resolves to channel-specific field)')
    .option('--telegram-token <token>', 'Telegram bot token (use "null" to clear)')
    .option('--discord-token <token>', 'Discord bot token (use "null" to clear)')
    .option('--slack-bot-token <token>', 'Slack bot token (use "null" to clear)')
    .option('--slack-app-token <token>', 'Slack app token (use "null" to clear)')
    // Trigger events
    .option('--trigger-events <events>', 'Trigger events (comma-separated, use "null" to clear)')
    // WhatsApp profile name (separate endpoint)
    .option('--profile-name <name>', 'Update WhatsApp display name (push name)')
    // Bridge tmux session override (per-instance routing for genie nats-genie provider)
    .option(
      '--bridge-tmux-session <name>',
      'Tmux session name the genie bridge spawns into for this instance (propagated as GENIE_TMUX_SESSION via NATS). Use "null" to clear.',
    )
    .action(async (rawId: string, options: Record<string, unknown>) => {
      const client = getClient();

      try {
        const id = await resolveInstanceId(rawId);

        // Handle profile name update (separate endpoint)
        if (options.profileName) {
          await updateProfileName(id, options.profileName as string);
          output.success(`Profile name updated to "${options.profileName}"`);
        }

        // Build update body using shared helpers
        const body = buildInstanceBody(options);
        setVal(body, 'name', options.name);
        setBool(body, 'isDefault', options.isDefault);

        // Send update if there are fields to update
        if (Object.keys(body).length > 0) {
          await client.instances.update(id, body);
          output.success(`Instance updated: ${id}`, body);
        } else if (!options.profileName) {
          output.error('No update options provided. Use --help to see all available options.');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to update instance: ${message}`);
      }
    });

  // omni instances contacts <id>
  instances
    .command('contacts <id>')
    .description('List contacts for an instance')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10))
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--guild <id>', 'Guild ID (required for Discord)')
    .option('--search <query>', 'Filter contacts by name or phone')
    .option('--no-groups', 'Exclude group contacts')
    .action(
      async (
        rawId: string,
        options: { limit?: number; cursor?: string; guild?: string; search?: string; groups?: boolean },
      ) => {
        const client = getClient();

        try {
          const id = await resolveInstanceId(rawId);
          const result = await client.instances.listContacts(id, {
            limit: options.limit,
            cursor: options.cursor,
            guildId: options.guild,
            search: options.search,
            excludeGroups: options.groups === false ? true : undefined,
          });

          const items = result.items.map((c) => ({
            jid: c.platformUserId,
            name: c.displayName ?? '-',
            phone: c.phone ?? '-',
            isGroup: c.isGroup ? 'yes' : 'no',
            isBusiness: c.isBusiness ? 'yes' : 'no',
          }));

          output.list(items, { emptyMessage: 'No contacts found.', rawData: result.items });

          if (result.meta.hasMore) {
            if (result.meta.cursor) {
              output.dim(`More results available. Use --cursor ${result.meta.cursor}`);
            } else {
              output.dim('More results available. Use --limit to adjust page size.');
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to list contacts: ${message}`);
        }
      },
    );

  // omni instances groups <id>
  instances
    .command('groups <id>')
    .description('List groups for an instance')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10))
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--search <query>', 'Filter groups by name')
    .action(async (rawId: string, options: { limit?: number; cursor?: string; search?: string }) => {
      const client = getClient();

      try {
        const id = await resolveInstanceId(rawId);
        const result = await client.instances.listGroups(id, {
          limit: options.limit,
          cursor: options.cursor,
          search: options.search,
        });

        const items = result.items.map((g) => ({
          jid: g.externalId,
          name: g.name ?? '-',
          members: g.memberCount ?? '-',
          description: g.description
            ? g.description.length > 50
              ? `${g.description.substring(0, 47)}...`
              : g.description
            : '-',
        }));

        output.list(items, { emptyMessage: 'No groups found.', rawData: result.items });

        if (result.meta.hasMore) {
          if (result.meta.cursor) {
            output.dim(`More results available. Use --cursor ${result.meta.cursor}`);
          } else {
            output.dim('More results available. Use --limit to adjust page size.');
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list groups: ${message}`);
      }
    });

  // omni instances group-members <id> <jid>
  instances
    .command('group-members <id> <jid>')
    .description('List members of a group')
    .action(async (rawId: string, jid: string) => {
      try {
        const id = await resolveInstanceId(rawId);
        const result = (await apiCall(`instances/${id}/groups/${encodeURIComponent(jid)}/members`)) as {
          members: Array<{ id: string; name?: string; role?: string }>;
        };

        const items = result.members.map((m) => ({
          id: m.id,
          name: m.name ?? '-',
          role: m.role ?? 'member',
        }));

        output.list(items, { emptyMessage: 'No members found.', rawData: result.members });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list group members: ${message}`);
      }
    });

  // omni instances profile <id> <user-id>
  instances
    .command('profile <id> <userId>')
    .description('Get user profile from the channel')
    .action(async (rawId: string, userId: string) => {
      const client = getClient();

      try {
        const id = await resolveInstanceId(rawId);
        const profile = (await client.instances.getUserProfile(id, userId)) as unknown as Record<string, unknown>;
        const bio = profile.bio as { status?: string | null } | undefined;
        output.data({ ...profile, bio: bio?.status ?? '-' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get user profile: ${message}`);
      }
    });

  // omni instances check <id> <phone>
  instances
    .command('check <id> <phone>')
    .description('Check if phone number is registered on WhatsApp')
    .action(async (rawId: string, phone: string) => {
      try {
        const id = await resolveInstanceId(rawId);
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/instances/${id}/check-number`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ phones: [phone] }),
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        const data = (await resp.json()) as {
          data: { results: Array<{ exists: boolean; jid: string; phone: string }> };
        };
        const result = data.data.results[0];

        if (result?.exists) {
          output.success(`${phone} is registered on WhatsApp`, { jid: result.jid });
        } else {
          output.warn(`${phone} is NOT registered on WhatsApp`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to check number: ${message}`);
      }
    });

  // omni instances update-bio <id> <status>
  instances
    .command('update-bio <id> <status>')
    .description('Update own profile bio/status on WhatsApp')
    .action(async (rawId: string, status: string) => {
      try {
        const id = await resolveInstanceId(rawId);
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/instances/${id}/profile/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ status }),
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        output.success(`Bio updated: "${status}"`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to update bio: ${message}`);
      }
    });

  // omni instances block <id> <contactId>
  instances
    .command('block <id> <contactId>')
    .description('Block a contact on WhatsApp')
    .action(async (rawId: string, contactId: string) => {
      try {
        const id = await resolveInstanceId(rawId);
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/instances/${id}/block`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ contactId }),
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        output.success(`Contact blocked: ${contactId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to block contact: ${message}`);
      }
    });

  // omni instances unblock <id> <contactId>
  instances
    .command('unblock <id> <contactId>')
    .description('Unblock a contact on WhatsApp')
    .action(async (rawId: string, contactId: string) => {
      try {
        const id = await resolveInstanceId(rawId);
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/instances/${id}/block`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ contactId }),
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        output.success(`Contact unblocked: ${contactId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to unblock contact: ${message}`);
      }
    });

  // omni instances blocklist <id>
  instances
    .command('blocklist <id>')
    .description('List blocked contacts on WhatsApp')
    .action(async (rawId: string) => {
      try {
        const id = await resolveInstanceId(rawId);
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/instances/${id}/blocklist`, {
          headers: { 'x-api-key': apiKey },
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        const data = (await resp.json()) as { data: { blocklist: string[]; count: number } };
        const { blocklist, count } = data.data;

        if (count === 0) {
          output.info('No blocked contacts.');
          return;
        }

        const items = blocklist.map((jid) => ({ jid }));
        output.list(items, { emptyMessage: 'No blocked contacts.' });
        output.dim(`Total: ${count} blocked`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to fetch blocklist: ${message}`);
      }
    });

  // ============================================================================
  // C2: Profile Picture
  // ============================================================================

  // omni instances update-picture <id>
  instances
    .command('update-picture <id>')
    .description('Update instance profile picture')
    .option('--base64 <data>', 'Base64-encoded image data')
    .option('--url <url>', 'URL to fetch image from')
    .action(async (rawId: string, options: { base64?: string; url?: string }) => {
      if (!options.base64 && !options.url) {
        output.error('Either --base64 or --url is required');
        return;
      }

      try {
        const id = await resolveInstanceId(rawId);
        const base64Data = await resolveBase64Image(options);
        await apiCall(`instances/${id}/profile/picture`, 'PUT', { base64: base64Data });
        output.success('Profile picture updated');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to update profile picture: ${message}`);
      }
    });

  // omni instances remove-picture <id>
  instances
    .command('remove-picture <id>')
    .description('Remove instance profile picture')
    .action(async (rawId: string) => {
      try {
        const id = await resolveInstanceId(rawId);
        await apiCall(`instances/${id}/profile/picture`, 'DELETE');
        output.success('Profile picture removed');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to remove profile picture: ${message}`);
      }
    });

  // ============================================================================
  // Group Picture
  // ============================================================================

  // omni instances group-update-picture <id> --group <jid>
  instances
    .command('group-update-picture <id>')
    .description('Update a WhatsApp group profile picture')
    .requiredOption('--group <jid>', 'Group JID (e.g., 120363xxx@g.us)')
    .option('--base64 <data>', 'Base64-encoded image data')
    .option('--url <url>', 'URL to fetch image from')
    .action(async (rawId: string, options: { group: string; base64?: string; url?: string }) => {
      if (!options.base64 && !options.url) {
        output.error('Either --base64 or --url is required');
        return;
      }

      try {
        const id = await resolveInstanceId(rawId);
        const base64Data = await resolveBase64Image(options);
        await apiCall(`instances/${id}/groups/${options.group}/picture`, 'PUT', { base64: base64Data });
        output.success(`Group picture updated for ${options.group}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to update group picture: ${message}`);
      }
    });

  // ============================================================================
  // Group Create
  // ============================================================================

  // omni instances group-create <id> --subject "Name" --participants "+55..." "+55..."
  instances
    .command('group-create <id>')
    .description('Create a new WhatsApp group')
    .requiredOption('--subject <name>', 'Group name/subject')
    .requiredOption('--participants <phones...>', 'Phone numbers or JIDs to add (space-separated)')
    .action(async (rawId: string, opts: { subject: string; participants: string[] }) => {
      try {
        const id = await resolveInstanceId(rawId);
        const result = (await apiCall(`instances/${id}/groups`, 'POST', {
          subject: opts.subject,
          participants: opts.participants,
        })) as {
          data: {
            id: string;
            subject: string;
            owner: string | undefined;
            creation: number | undefined;
            participants: Array<{ id: string; admin: string | null }>;
          };
        };
        output.success(`Group created: ${result.data.id}`, result.data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        output.error(`Failed to create group: ${msg}`);
      }
    });

  // ============================================================================
  // C3: Group Invite Links
  // ============================================================================

  // omni instances group-invite <id> <groupJid>
  instances
    .command('group-invite <id> <groupJid>')
    .description('Get group invite link')
    .action(async (rawId: string, groupJid: string) => {
      try {
        const id = await resolveInstanceId(rawId);
        const result = (await apiCall(`instances/${id}/groups/${encodeURIComponent(groupJid)}/invite`)) as {
          data: { code: string; inviteLink: string };
        };
        output.data(result.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get invite link: ${message}`);
      }
    });

  // omni instances group-revoke-invite <id> <groupJid>
  instances
    .command('group-revoke-invite <id> <groupJid>')
    .description('Revoke group invite link and generate new one')
    .action(async (rawId: string, groupJid: string) => {
      try {
        const id = await resolveInstanceId(rawId);
        const result = (await apiCall(
          `instances/${id}/groups/${encodeURIComponent(groupJid)}/invite/revoke`,
          'POST',
        )) as { data: { code: string; inviteLink: string } };
        output.success('Invite link revoked', result.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to revoke invite link: ${message}`);
      }
    });

  // omni instances group-join <id> <code>
  instances
    .command('group-join <id> <code>')
    .description('Join a group via invite code')
    .action(async (rawId: string, code: string) => {
      try {
        const id = await resolveInstanceId(rawId);
        const result = (await apiCall(`instances/${id}/groups/join`, 'POST', { code })) as {
          data: { groupJid: string; joined: boolean };
        };
        output.success(`Joined group: ${result.data.groupJid}`, result.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to join group: ${message}`);
      }
    });

  // ============================================================================

  // ============================================================================
  // C5: Privacy Settings
  // ============================================================================

  // omni instances privacy <id>
  instances
    .command('privacy <id>')
    .description('Fetch privacy settings')
    .action(async (rawId: string) => {
      try {
        const id = await resolveInstanceId(rawId);
        const result = (await apiCall(`instances/${id}/privacy`)) as { data: Record<string, unknown> };
        output.data(result.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to fetch privacy settings: ${message}`);
      }
    });

  // ============================================================================
  // C6: Reject Incoming Calls
  // ============================================================================

  // omni instances reject-call <id>
  instances
    .command('reject-call <id>')
    .description('Reject an incoming call')
    .requiredOption('--call-id <callId>', 'Call ID from the call event')
    .requiredOption('--from <jid>', 'Caller JID')
    .action(async (rawId: string, options: { callId: string; from: string }) => {
      try {
        const id = await resolveInstanceId(rawId);
        await apiCall(`instances/${id}/calls/reject`, 'POST', {
          callId: options.callId,
          callFrom: options.from,
        });
        output.success(`Call rejected: ${options.callId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to reject call: ${message}`);
      }
    });

  return instances;
}
