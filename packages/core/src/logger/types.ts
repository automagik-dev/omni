/**
 * Logger Type Definitions
 *
 * Core types for the unified logging system.
 */

/**
 * Log levels in order of severity
 */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/**
 * Log level type
 */
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Log level numeric values (for filtering)
 */
export const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Log output format
 */
export type LogFormat = 'auto' | 'pretty' | 'json';

/**
 * A single log entry
 */
export interface LogEntry {
  /** Log level */
  level: LogLevel;
  /** Unix timestamp in milliseconds */
  time: number;
  /** Module/source identifier (e.g., 'whatsapp:auth', 'api:http') */
  module: string;
  /** Human-readable log message */
  msg: string;
  /** Additional contextual data */
  [key: string]: unknown;
}

/**
 * Logger interface compatible with channel-sdk
 *
 * This interface is the public contract for all loggers in the system.
 */
export interface Logger {
  /**
   * Log a debug message (verbose, development info)
   */
  debug(message: string, data?: Record<string, unknown>): void;

  /**
   * Log an info message (normal operational info)
   */
  info(message: string, data?: Record<string, unknown>): void;

  /**
   * Log a warning message (potential issues)
   */
  warn(message: string, data?: Record<string, unknown>): void;

  /**
   * Log an error message (failures requiring attention)
   */
  error(message: string, data?: Record<string, unknown>): void;

  /**
   * Create a child logger with additional context
   *
   * Child loggers inherit the parent's module and add extra context.
   */
  child(context: Record<string, unknown>): Logger;
}

/**
 * Global logging configuration
 */
export interface LogConfig {
  /**
   * Minimum log level to output
   * @default 'info'
   */
  level?: LogLevel;

  /**
   * Output format
   * - 'auto': pretty if TTY, JSON otherwise
   * - 'pretty': Human-readable with colors
   * - 'json': Structured JSON for log aggregation
   * @default 'auto'
   */
  format?: LogFormat;

  /**
   * Optional file path for persistent logs
   * Uses pino-roll for rotation when set
   */
  file?: string;

  /**
   * Max file size before rotation (e.g., '10m', '100k')
   * @default '10m'
   */
  fileMaxSize?: string;

  /**
   * Module filter patterns (e.g., 'whatsapp:*', 'api:*')
   * '*' matches all modules
   * @default '*'
   */
  modules?: string;
}

/**
 * Listener for log entries (used by ring buffer and SSE)
 */
export type LogListener = (entry: LogEntry) => void;

/**
 * Function to unsubscribe a log listener
 */
export type Unsubscribe = () => void;
