/**
 * Log Formatters
 *
 * Pretty (TTY) and JSON formatters for log output.
 */

import type { LogEntry, LogLevel } from './types';

/**
 * ANSI color codes for terminal output
 */
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  // Levels
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m', // green
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
} as const;

/**
 * Level labels padded to consistent width
 */
const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

/**
 * Format timestamp as HH:mm:ss
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Pad module name to consistent width for alignment
 */
function padModule(module: string, width = 17): string {
  return module.length >= width ? module.slice(0, width) : module.padEnd(width);
}

/**
 * Format extra data as key=value pairs
 */
function formatData(data: Record<string, unknown>): string {
  const pairs: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    // Skip internal keys
    if (['level', 'time', 'module', 'msg'].includes(key)) continue;

    // Format value based on type
    let formatted: string;
    if (typeof value === 'string') {
      // Quote strings with spaces
      formatted = value.includes(' ') ? `"${value}"` : value;
    } else if (value === null || value === undefined) {
      formatted = 'null';
    } else if (typeof value === 'object') {
      try {
        formatted = JSON.stringify(value);
      } catch {
        formatted = '[Object]';
      }
    } else {
      formatted = String(value);
    }

    pairs.push(`${key}=${formatted}`);
  }

  return pairs.length > 0 ? ` ${pairs.join(' ')}` : '';
}

/**
 * Pretty formatter for TTY output
 *
 * Format: HH:mm:ss LEVEL module           message key=value
 */
export function formatPretty(entry: LogEntry): string {
  const { level, time, module, msg, ...data } = entry;

  const timeStr = formatTime(time);
  const levelColor = COLORS[level];
  const levelStr = `${levelColor}${LEVEL_LABELS[level]}${COLORS.reset}`;
  const moduleStr = `${COLORS.dim}${padModule(module)}${COLORS.reset}`;
  const dataStr = formatData(data);

  return `${timeStr} ${levelStr} ${moduleStr} ${msg}${dataStr}`;
}

/**
 * JSON formatter for production/LLM output
 *
 * Outputs a single JSON line per entry.
 */
export function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

/**
 * Create a formatter based on format type
 */
export function createFormatter(format: 'pretty' | 'json'): (entry: LogEntry) => string {
  return format === 'pretty' ? formatPretty : formatJson;
}

/**
 * Detect if stdout is a TTY
 */
export function isTTY(): boolean {
  // Check for Bun's stdout
  if (typeof process !== 'undefined' && process.stdout) {
    return process.stdout.isTTY === true;
  }
  return false;
}
