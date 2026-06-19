type EnvMap = Record<string, string | undefined>;

export interface WhatsAppOutboundTimingConfig {
  humanDelayEnabled: boolean;
  humanDelayMinMs: number;
  humanDelayMaxMs: number;
  typingSimulationEnabled: boolean;
  typingDelayBaseMs: number;
  typingDelayPerCharMs: number;
  typingDelayMaxMs: number;
  typingDefaultMs: number;
}

export interface WhatsAppRateLimitEnvConfig {
  initialBackoffMs: number;
  maxBackoffMs: number;
  jitterFactor: number;
}

export const DEFAULT_WHATSAPP_OUTBOUND_TIMING: WhatsAppOutboundTimingConfig = {
  humanDelayEnabled: true,
  humanDelayMinMs: 1500,
  humanDelayMaxMs: 3500,
  typingSimulationEnabled: true,
  typingDelayBaseMs: 800,
  typingDelayPerCharMs: 30,
  typingDelayMaxMs: 4000,
  typingDefaultMs: 3000,
};

export const DEFAULT_WHATSAPP_RATE_LIMIT: WhatsAppRateLimitEnvConfig = {
  initialBackoffMs: 1000,
  maxBackoffMs: 30_000,
  jitterFactor: 0.2,
};

const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled']);
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);

function readBooleanEnv(env: EnvMap, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (FALSE_VALUES.has(raw)) return false;
  if (TRUE_VALUES.has(raw)) return true;
  return fallback;
}

function readNonNegativeIntEnv(env: EnvMap, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readNonNegativeNumberEnv(env: EnvMap, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getWhatsAppOutboundTimingConfig(env: EnvMap = process.env): WhatsAppOutboundTimingConfig {
  const humanDelayMinMs = readNonNegativeIntEnv(
    env,
    'WHATSAPP_HUMAN_DELAY_MIN_MS',
    DEFAULT_WHATSAPP_OUTBOUND_TIMING.humanDelayMinMs,
  );
  const rawHumanDelayMaxMs = readNonNegativeIntEnv(
    env,
    'WHATSAPP_HUMAN_DELAY_MAX_MS',
    DEFAULT_WHATSAPP_OUTBOUND_TIMING.humanDelayMaxMs,
  );

  return {
    humanDelayEnabled: readBooleanEnv(
      env,
      'WHATSAPP_HUMAN_DELAY_ENABLED',
      DEFAULT_WHATSAPP_OUTBOUND_TIMING.humanDelayEnabled,
    ),
    humanDelayMinMs,
    humanDelayMaxMs: Math.max(humanDelayMinMs, rawHumanDelayMaxMs),
    typingSimulationEnabled: readBooleanEnv(
      env,
      'WHATSAPP_TYPING_SIMULATION_ENABLED',
      DEFAULT_WHATSAPP_OUTBOUND_TIMING.typingSimulationEnabled,
    ),
    typingDelayBaseMs: readNonNegativeIntEnv(
      env,
      'WHATSAPP_TYPING_DELAY_BASE_MS',
      DEFAULT_WHATSAPP_OUTBOUND_TIMING.typingDelayBaseMs,
    ),
    typingDelayPerCharMs: readNonNegativeIntEnv(
      env,
      'WHATSAPP_TYPING_DELAY_PER_CHAR_MS',
      DEFAULT_WHATSAPP_OUTBOUND_TIMING.typingDelayPerCharMs,
    ),
    typingDelayMaxMs: readNonNegativeIntEnv(
      env,
      'WHATSAPP_TYPING_DELAY_MAX_MS',
      DEFAULT_WHATSAPP_OUTBOUND_TIMING.typingDelayMaxMs,
    ),
    typingDefaultMs: readNonNegativeIntEnv(
      env,
      'WHATSAPP_TYPING_DEFAULT_MS',
      DEFAULT_WHATSAPP_OUTBOUND_TIMING.typingDefaultMs,
    ),
  };
}

export function getWhatsAppRateLimitConfig(env: EnvMap = process.env): WhatsAppRateLimitEnvConfig {
  const initialBackoffMs = readNonNegativeIntEnv(
    env,
    'WHATSAPP_RATE_LIMIT_INITIAL_BACKOFF_MS',
    DEFAULT_WHATSAPP_RATE_LIMIT.initialBackoffMs,
  );
  const rawMaxBackoffMs = readNonNegativeIntEnv(
    env,
    'WHATSAPP_RATE_LIMIT_MAX_BACKOFF_MS',
    DEFAULT_WHATSAPP_RATE_LIMIT.maxBackoffMs,
  );

  return {
    initialBackoffMs,
    maxBackoffMs: Math.max(initialBackoffMs, rawMaxBackoffMs),
    jitterFactor: readNonNegativeNumberEnv(
      env,
      'WHATSAPP_RATE_LIMIT_JITTER_FACTOR',
      DEFAULT_WHATSAPP_RATE_LIMIT.jitterFactor,
    ),
  };
}
