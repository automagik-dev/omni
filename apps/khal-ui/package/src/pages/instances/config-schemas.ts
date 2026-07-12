/**
 * Grouped, editable config schemas for an instance — the single source of truth
 * behind the Config tab's {@link SchemaForm} sections.
 *
 * Every field here is drawn from the API's ACTUAL PATCH contract
 * (`updateInstanceSchema` in packages/api/src/routes/v2/instances.ts): only
 * fields that endpoint honours are editable, so what the UI writes always
 * round-trips. Fields the detail endpoint returns but PATCH ignores
 * (trigger*, session*, processAudio, …) are shown read-only in the Overview,
 * never here — exposing them as editable would be a lie.
 *
 * Each field is `.optional()`: the form submits a group at a time and we PATCH
 * only what changed ({@link minimalPatch}), so an omitted/blank field is never
 * sent and can't clobber a redacted secret or reset an untouched column.
 */
import { z } from 'zod';

/** A titled group of related fields rendered as one SchemaForm section. */
export interface ConfigSection {
  id: string;
  title: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  /** Keys this section owns — used to slice current values and diff on save. */
  keys: string[];
  /** Channels this section applies to; omit for all. */
  channels?: string[];
}

const replyFilterSchema = z
  .object({
    mode: z.enum(['all', 'filtered']).describe('all = reply to everything; filtered = check conditions'),
    conditions: z
      .object({
        onDm: z.boolean().optional().describe('Reply to DMs'),
        onMention: z.boolean().optional().describe('Reply when @mentioned'),
        onReply: z.boolean().optional().describe('Reply to replies to the bot'),
        onNameMatch: z.boolean().optional().describe('Reply when the bot name appears'),
        namePatterns: z.array(z.string()).optional().describe('Custom name-match patterns'),
      })
      .optional(),
  })
  .optional();

const sections: ConfigSection[] = [
  {
    id: 'identity',
    title: 'Status & identity',
    description: 'Name, default flag, and access-control mode.',
    schema: z.object({
      name: z.string().min(1).max(255).optional().describe('Instance name'),
      isDefault: z.boolean().optional().describe('Default instance for this channel'),
      accessMode: z.enum(['disabled', 'blocklist', 'allowlist']).optional().describe('Access-control mode'),
    }),
    keys: ['name', 'isDefault', 'accessMode'],
  },
  {
    id: 'agent',
    title: 'Agent binding',
    description: 'Which agent answers, and how its session and timing behave.',
    schema: z.object({
      agentId: z.string().optional().describe('Agent UUID (blank leaves unchanged)'),
      agentTimeout: z.number().int().positive().optional().describe('Agent timeout (seconds)'),
      agentStreamMode: z.boolean().optional().describe('Stream responses'),
      agentSessionStrategy: z.enum(['per_user', 'per_chat', 'per_thread']).optional().describe('Session memory scope'),
      agentPrefixSenderName: z.boolean().optional().describe('Prefix messages with sender name'),
      agentStalledTimeoutMs: z.number().int().min(0).optional().describe('Idle ms before turn.stalled fires'),
    }),
    keys: [
      'agentId',
      'agentTimeout',
      'agentStreamMode',
      'agentSessionStrategy',
      'agentPrefixSenderName',
      'agentStalledTimeoutMs',
    ],
  },
  {
    id: 'replyFilter',
    title: 'Reply filter',
    description: 'When the agent should reply.',
    schema: z.object({ agentReplyFilter: replyFilterSchema }),
    keys: ['agentReplyFilter'],
  },
  {
    id: 'messageProcessing',
    title: 'Message processing',
    description: 'Splitting, formatting, receipts, and history window.',
    schema: z.object({
      enableAutoSplit: z.boolean().optional().describe('Split responses on double newlines'),
      messageFormatMode: z.enum(['convert', 'passthrough']).optional().describe('Markdown conversion mode'),
      readReceipts: z.enum(['on', 'off', 'exclude-self']).optional().describe('Read-receipt mode'),
      groupHistorySize: z.number().int().min(0).max(200).optional().describe('Context messages per dispatch (0–200)'),
      markOnlineOnConnect: z.boolean().optional().describe('Mark online on connect'),
    }),
    keys: ['enableAutoSplit', 'messageFormatMode', 'readReceipts', 'groupHistorySize', 'markOnlineOnConnect'],
  },
  {
    id: 'debounce',
    title: 'Debounce',
    description: 'Coalesce rapid inbound messages before dispatch.',
    schema: z.object({
      messageDebounceMode: z.enum(['disabled', 'fixed', 'randomized', 'presence']).optional().describe('Debounce mode'),
      messageDebounceMinMs: z.number().int().min(0).optional().describe('Minimum delay (ms)'),
      messageDebounceMaxMs: z.number().int().min(0).optional().describe('Maximum delay (ms)'),
      messageDebounceGroupMs: z.number().int().min(0).optional().describe('Group-chat delay (ms)'),
      messageDebounceMaxWaitMs: z.number().int().min(0).optional().describe('Presence-mode hard cap (ms)'),
      messageDebounceRestartOnTyping: z.boolean().optional().describe('Restart timer while user types'),
    }),
    keys: [
      'messageDebounceMode',
      'messageDebounceMinMs',
      'messageDebounceMaxMs',
      'messageDebounceGroupMs',
      'messageDebounceMaxWaitMs',
      'messageDebounceRestartOnTyping',
    ],
  },
  {
    id: 'splitDelay',
    title: 'Split delay',
    description: 'Delay between chunks when a reply is split.',
    schema: z.object({
      messageSplitDelayMode: z.enum(['disabled', 'fixed', 'randomized']).optional().describe('Split-delay mode'),
      messageSplitDelayFixedMs: z.number().int().min(0).optional().describe('Fixed delay (ms)'),
      messageSplitDelayMinMs: z.number().int().min(0).optional().describe('Minimum delay (ms)'),
      messageSplitDelayMaxMs: z.number().int().min(0).optional().describe('Maximum delay (ms)'),
    }),
    keys: ['messageSplitDelayMode', 'messageSplitDelayFixedMs', 'messageSplitDelayMinMs', 'messageSplitDelayMaxMs'],
  },
  {
    id: 'smartGate',
    title: 'Smart gate',
    description: 'LLM pre-filter that decides whether to dispatch to the agent.',
    schema: z.object({
      agentGateEnabled: z.boolean().optional().describe('Enable response gate'),
      agentGateModel: z.string().optional().describe('Gate model (blank = default)'),
      agentGatePrompt: z.string().optional().describe('Gate prompt (blank = default)'),
    }),
    keys: ['agentGateEnabled', 'agentGateModel', 'agentGatePrompt'],
  },
  {
    id: 'media',
    title: 'Media processing',
    description: 'How media is prepared before dispatch.',
    schema: z.object({
      agentWaitForMedia: z.boolean().optional().describe('Wait for media processing'),
      agentSendMediaPath: z.boolean().optional().describe('Include file path in media text'),
      agentSendMediaPathTypes: z.array(z.string()).optional().describe('Content types that receive the path'),
    }),
    keys: ['agentWaitForMedia', 'agentSendMediaPath', 'agentSendMediaPathTypes'],
  },
  {
    id: 'reactionAck',
    title: 'Reaction ack',
    description: 'Emoji acknowledgement while the agent works.',
    schema: z.object({
      reactionAck: z.enum(['on', 'off']).optional().describe('Reaction-ack mode'),
      reactionAckEmoji: z.record(z.string()).optional().describe('Per-channel emoji map'),
      ackTimeoutMs: z.number().int().min(0).max(120_000).optional().describe('Ack timeout (ms, ≤120000)'),
    }),
    keys: ['reactionAck', 'reactionAckEmoji', 'ackTimeoutMs'],
  },
  {
    id: 'tts',
    title: 'Text-to-speech',
    description: 'Default ElevenLabs voice and model.',
    schema: z.object({
      ttsVoiceId: z.string().optional().describe('Default voice ID'),
      ttsModelId: z.string().optional().describe('Default model ID'),
    }),
    keys: ['ttsVoiceId', 'ttsModelId'],
  },
  {
    id: 'advanced',
    title: 'Advanced',
    description: 'Bridge, signature enforcement, and cross-instance behaviour.',
    schema: z.object({
      bridgeTmuxSession: z.string().optional().describe('Genie bridge tmux session name'),
      requireGenieSignature: z.boolean().optional().describe('Require verified X-Genie-Signature'),
      allowFirstParty: z.boolean().optional().describe('Process messages from other instance owners'),
      triggerEvents: z.array(z.string()).optional().describe('Trigger event names'),
    }),
    keys: ['bridgeTmuxSession', 'requireGenieSignature', 'allowFirstParty', 'triggerEvents'],
  },
  // ── Channel credentials (write-only: blank leaves the stored secret intact) ──
  {
    id: 'creds-telegram',
    title: 'Telegram credentials',
    description: 'Blank fields leave the stored value untouched.',
    channels: ['telegram'],
    schema: z.object({ telegramBotToken: z.string().optional().describe('Bot token') }),
    keys: ['telegramBotToken'],
  },
  {
    id: 'creds-discord',
    title: 'Discord credentials',
    description: 'Blank fields leave the stored value untouched.',
    channels: ['discord'],
    schema: z.object({ discordBotToken: z.string().optional().describe('Bot token') }),
    keys: ['discordBotToken'],
  },
  {
    id: 'creds-slack',
    title: 'Slack credentials',
    description: 'Blank fields leave the stored value untouched.',
    channels: ['slack'],
    schema: z.object({
      slackBotToken: z.string().optional().describe('Bot token'),
      slackAppToken: z.string().optional().describe('App token'),
      slackSigningSecret: z.string().optional().describe('Signing secret'),
    }),
    keys: ['slackBotToken', 'slackAppToken', 'slackSigningSecret'],
  },
  {
    id: 'creds-gupshup',
    title: 'Gupshup credentials',
    description: 'Blank fields leave the stored value untouched.',
    channels: ['gupshup'],
    schema: z.object({
      gupshupCallbackUrl: z.string().optional().describe('Callback URL'),
      gupshupAuthToken: z.string().optional().describe('Auth token'),
      gupshupEventId: z.string().optional().describe('Event ID'),
      webhookVerifyToken: z.string().optional().describe('Webhook verify token'),
    }),
    keys: ['gupshupCallbackUrl', 'gupshupAuthToken', 'gupshupEventId', 'webhookVerifyToken'],
  },
  {
    id: 'creds-twilio',
    title: 'Twilio credentials',
    description: 'Blank fields leave the stored value untouched.',
    channels: ['twilio-whatsapp'],
    schema: z.object({
      twilioAccountSid: z.string().optional().describe('Account SID'),
      twilioAuthToken: z.string().optional().describe('Auth token'),
      twilioFrom: z.string().optional().describe('Sender address (whatsapp:+E164)'),
      twilioMessagingServiceSid: z.string().optional().describe('Messaging Service SID'),
      twilioStatusCallbackUrl: z.string().optional().describe('Status callback URL'),
      twilioWebhookUrl: z.string().optional().describe('Inbound webhook URL'),
      twilioValidateSignature: z.boolean().optional().describe('Validate X-Twilio-Signature'),
    }),
    keys: [
      'twilioAccountSid',
      'twilioAuthToken',
      'twilioFrom',
      'twilioMessagingServiceSid',
      'twilioStatusCallbackUrl',
      'twilioWebhookUrl',
      'twilioValidateSignature',
    ],
  },
];

/** Config sections applicable to a given channel, in display order. */
export function sectionsForChannel(channel: string): ConfigSection[] {
  return sections.filter((s) => !s.channels || s.channels.includes(channel));
}

/** Read-only fields the API returns but PATCH does not accept — shown, not edited. */
export const READ_ONLY_CONFIG_KEYS = [
  'triggerMode',
  'triggerReactions',
  'triggerMentionPatterns',
  'inboundMaxAgeMinutes',
  'sessionReset',
  'sessionIdPrefix',
  'processAudio',
  'processImages',
  'processVideo',
  'processDocuments',
  'processMediaOnBlocked',
  'downloadMediaOnSync',
  'disableUsernamePrefix',
  'agentChainToInstanceId',
  'chainMode',
  'agentAckMessage',
  'replayEnabled',
  'telegramReactionLevel',
] as const;

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isBlank(a) && isBlank(b)) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * Build the minimal PATCH body for a config section: only keys whose submitted
 * value is present AND differs from the current instance value. A blank field
 * is never sent, so redacted credentials and untouched columns are safe.
 */
export function minimalPatch(
  submitted: Record<string, unknown>,
  current: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const next = submitted[key];
    if (next === undefined) continue;
    if (deepEqual(next, current[key])) continue;
    out[key] = next;
  }
  return out;
}
