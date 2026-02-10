/**
 * Unified Logging System
 *
 * Provides a consistent, performant logging interface across all packages.
 *
 * @example
 * ```typescript
 * import { createLogger, configureLogging } from '@omni/core';
 *
 * // Configure once at startup
 * configureLogging({ level: 'debug', format: 'pretty' });
 *
 * // Create module loggers
 * const logger = createLogger('whatsapp:auth');
 * logger.info('Credentials restored', { instanceId, registered: true });
 *
 * // Child loggers for sub-context
 * const socketLogger = logger.child({ socketId: 'abc123' });
 * socketLogger.debug('Sending message');
 * ```
 */

import { getLogBuffer } from './buffer';
import { createFormatter, isTTY } from './formatters';
import type { LogConfig, LogEntry, LogFormat, LogLevel, Logger } from './types';
import { LOG_LEVEL_VALUES } from './types';

// Re-export all types
export * from './types';
export * from './buffer';
export * from './formatters';

/**
 * Global configuration state
 */
const config: Required<LogConfig> = {
  level: 'info',
  format: 'auto',
  file: '',
  fileMaxSize: '10m',
  modules: '*',
};

/**
 * Cached formatter function
 */
let formatter: ((entry: LogEntry) => string) | null = null;

/**
 * Initialize config from environment variables
 */
function initFromEnv(): void {
  const level = process.env.LOG_LEVEL;
  if (level && ['debug', 'info', 'warn', 'error'].includes(level)) {
    config.level = level as LogLevel;
  }

  const format = process.env.LOG_FORMAT;
  if (format && ['auto', 'pretty', 'json'].includes(format)) {
    config.format = format as LogFormat;
  }

  if (process.env.LOG_FILE) {
    config.file = process.env.LOG_FILE;
  }

  if (process.env.LOG_FILE_MAX_SIZE) {
    config.fileMaxSize = process.env.LOG_FILE_MAX_SIZE;
  }

  if (process.env.LOG_MODULES) {
    config.modules = process.env.LOG_MODULES;
  }
}

// Initialize from environment on module load
initFromEnv();

/**
 * Get the resolved format (handles 'auto')
 */
function getResolvedFormat(): 'pretty' | 'json' {
  if (config.format === 'auto') {
    return isTTY() ? 'pretty' : 'json';
  }
  return config.format;
}

/**
 * Get or create the formatter
 */
function getFormatter(): (entry: LogEntry) => string {
  if (!formatter) {
    formatter = createFormatter(getResolvedFormat());
  }
  return formatter;
}

/**
 * Check if a module matches the configured filter
 */
function matchesModuleFilter(module: string): boolean {
  if (config.modules === '*') return true;

  const patterns = config.modules.split(',').map((p) => p.trim());

  for (const pattern of patterns) {
    if (pattern === '*') return true;
    if (pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -2);
      if (module === prefix || module.startsWith(`${prefix}:`)) return true;
    } else if (module === pattern) {
      return true;
    }
  }

  return false;
}

/**
 * Write a log entry to output
 */
function writeLog(entry: LogEntry): void {
  // Check level filter
  if (LOG_LEVEL_VALUES[entry.level] < LOG_LEVEL_VALUES[config.level]) {
    return;
  }

  // Check module filter
  if (!matchesModuleFilter(entry.module)) {
    return;
  }

  // Add to buffer for SSE streaming
  getLogBuffer().push(entry);

  // Format and output
  const formatted = getFormatter()(entry);

  // Write to appropriate stream
  if (entry.level === 'error') {
    process.stderr.write(`${formatted}\n`);
  } else {
    process.stdout.write(`${formatted}\n`);
  }
}

/**
 * Configure global logging settings
 *
 * Call this once at application startup to configure logging.
 * Settings can also be controlled via environment variables:
 * - LOG_LEVEL: debug, info, warn, error
 * - LOG_FORMAT: auto, pretty, json
 * - LOG_FILE: path for file logging
 * - LOG_FILE_MAX_SIZE: rotation threshold (e.g., '10m')
 * - LOG_MODULES: comma-separated module filters
 */
export function configureLogging(options: LogConfig): void {
  if (options.level !== undefined) config.level = options.level;
  if (options.format !== undefined) config.format = options.format;
  if (options.file !== undefined) config.file = options.file;
  if (options.fileMaxSize !== undefined) config.fileMaxSize = options.fileMaxSize;
  if (options.modules !== undefined) config.modules = options.modules;

  // Reset formatter to pick up format changes
  formatter = null;
}

/**
 * Get current logging configuration
 */
export function getLogConfig(): Readonly<Required<LogConfig>> {
  return { ...config };
}

/**
 * Create a logger for a specific module
 *
 * @param module - Module identifier (e.g., 'whatsapp:auth', 'api:http')
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger('api:startup');
 * logger.info('Server listening', { host: '0.0.0.0', port: 8882 });
 * ```
 */
export function createLogger(module: string): Logger {
  return createLoggerWithContext(module, {});
}

/**
 * Internal: Create a logger with initial context
 */
function createLoggerWithContext(module: string, context: Record<string, unknown>): Logger {
  const log = (level: LogLevel, message: string, data?: Record<string, unknown>) => {
    const entry: LogEntry = {
      level,
      time: Date.now(),
      module,
      msg: message,
      ...context,
      ...data,
    };

    writeLog(entry);
  };

  return {
    debug(message: string, data?: Record<string, unknown>) {
      log('debug', message, data);
    },
    info(message: string, data?: Record<string, unknown>) {
      log('info', message, data);
    },
    warn(message: string, data?: Record<string, unknown>) {
      log('warn', message, data);
    },
    error(message: string, data?: Record<string, unknown>) {
      log('error', message, data);
    },
    child(childContext: Record<string, unknown>): Logger {
      return createLoggerWithContext(module, { ...context, ...childContext });
    },
  };
}

/**
 * Root logger for system-level messages
 *
 * Use createLogger() for module-specific logging.
 */
export const rootLogger = createLogger('system');
