import { createLogger } from '../index';

/**
 * Pino log level numeric values
 */
const _PINO_LEVELS: Record<number, 'debug' | 'info' | 'warn' | 'error'> = {
  10: 'debug', // trace -> debug
  20: 'debug', // debug
  30: 'info', // info
  40: 'warn', // warn
  50: 'error', // error
  60: 'error', // fatal -> error
};

/**
 * Minimal pino-compatible logger interface for Baileys
 */
export interface PinoLogger {
  level: string;
  trace: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  fatal: (obj: unknown, msg?: string) => void;
  child: (bindings: Record<string, unknown>) => PinoLogger;
}

/**
 * Extract message and data from pino-style arguments
 *
 * Pino can be called in multiple ways:
 * - logger.info('message')
 * - logger.info({ key: 'value' }, 'message')
 * - logger.info({ msg: 'message', key: 'value' })
 */
function extractLogArgs(objOrMsg: unknown, msg?: string): { message: string; data: Record<string, unknown> } {
  // String-only call: logger.info('message')
  if (typeof objOrMsg === 'string') {
    return { message: objOrMsg, data: {} };
  }

  // Object call
  if (typeof objOrMsg === 'object' && objOrMsg !== null) {
    const obj = objOrMsg as Record<string, unknown>;

    // If msg is provided, it's the message
    if (typeof msg === 'string') {
      return { message: msg, data: obj };
    }

    // Otherwise, check for 'msg' property
    if (typeof obj.msg === 'string') {
      const { msg: message, ...rest } = obj;
      return { message, data: rest };
    }

    // Fall back to JSON stringification
    return { message: JSON.stringify(obj), data: {} };
  }

  // Fallback
  return { message: String(objOrMsg), data: {} };
}

/**
 * Clean up Baileys-specific noise from log data
 */
function cleanBaileysData(data: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    // Skip internal pino/baileys fields
    if (key === 'pid' || key === 'hostname' || key === 'name' || key === 'level' || key === 'time') {
      continue;
    }

    // Skip very large objects (e.g., full message payloads)
    if (typeof value === 'object' && value !== null) {
      const str = JSON.stringify(value);
      if (str.length > 500) {
        cleaned[key] = '[large object]';
        continue;
      }
    }

    cleaned[key] = value;
  }

  return cleaned;
}

/**
 * Create a pino-compatible logger that routes to unified logging
 *
 * @param module - Module prefix (e.g., 'whatsapp:baileys')
 * @param level - Pino level string (default: 'warn')
 * @returns Pino-compatible logger for Baileys
 *
 * @example
 * ```typescript
 * import { createBaileysLogger } from '@omni/core/logger/adapters/baileys';
 *
 * const logger = createBaileysLogger('whatsapp:baileys', 'warn');
 *
 * // Pass to Baileys
 * const sock = makeWASocket({
 *   logger,
 *   auth: { creds, keys },
 * });
 * ```
 */
export function createBaileysLogger(module = 'whatsapp:baileys', level = 'warn'): PinoLogger {
  const logger = createLogger(module);

  const createLogMethod = (logLevel: 'debug' | 'info' | 'warn' | 'error') => (objOrMsg: unknown, msg?: string) => {
    const { message, data } = extractLogArgs(objOrMsg, msg);
    const cleanedData = cleanBaileysData(data);
    logger[logLevel](message, cleanedData);
  };

  const pinoLogger: PinoLogger = {
    level,
    trace: createLogMethod('debug'),
    debug: createLogMethod('debug'),
    info: createLogMethod('info'),
    warn: createLogMethod('warn'),
    error: createLogMethod('error'),
    fatal: createLogMethod('error'),
    child(bindings: Record<string, unknown>): PinoLogger {
      // Create a child with the bindings as permanent context
      const childModule = bindings.name ? `${module}:${String(bindings.name)}` : module;
      return createBaileysLogger(childModule, level);
    },
  };

  return pinoLogger;
}

/**
 * Create a silent pino logger (no output)
 *
 * Useful for suppressing Baileys logs entirely.
 */
export function createSilentLogger(): PinoLogger {
  const noop = () => {};
  return {
    level: 'silent',
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => createSilentLogger(),
  };
}
