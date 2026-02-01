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
  bold: '\x1b[1m',
  // Levels
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m', // green
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
} as const;

/**
 * Predefined colors for known modules (locked to avoid confusion)
 */
const PREDEFINED_MODULE_COLORS: Record<string, string> = {
  whatsapp: '\x1b[38;5;34m', // green (WhatsApp brand)
  discord: '\x1b[38;5;135m', // purple/blue (Discord brand)
  api: '\x1b[38;5;75m', // light blue
  nats: '\x1b[38;5;208m', // orange
  scheduler: '\x1b[38;5;179m', // gold
  system: '\x1b[38;5;247m', // gray
};

/**
 * Module color palette for modules without predefined colors
 */
const MODULE_COLORS = [
  '\x1b[38;5;75m', // light blue
  '\x1b[38;5;213m', // pink
  '\x1b[38;5;114m', // light green
  '\x1b[38;5;179m', // gold
  '\x1b[38;5;147m', // lavender
  '\x1b[38;5;81m', // sky blue
  '\x1b[38;5;216m', // salmon
  '\x1b[38;5;156m', // mint
] as const;

/**
 * Simple string hash for consistent color assignment
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Default color when no other match */
const DEFAULT_COLOR = '\x1b[38;5;75m'; // light blue

/**
 * Get color for a module, using predefined colors when available
 */
function getModuleColor(module: string): string {
  // Check predefined colors first
  const predefined = PREDEFINED_MODULE_COLORS[module];
  if (predefined) return predefined;

  // Fall back to hash-based color
  const index = hashString(module) % MODULE_COLORS.length;
  return MODULE_COLORS[index] ?? DEFAULT_COLOR;
}

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
 * Pad string to consistent width for alignment
 */
function pad(str: string, width: number): string {
  return str.length >= width ? str.slice(0, width) : str.padEnd(width);
}

/**
 * Format module name with color coding
 * Base module gets a bright color, sub-parts are dimmed
 *
 * Examples:
 * - "api:startup" → colored "api" + dim ":startup"
 * - "discord:connection" → colored "discord" + dim ":connection"
 */
function formatModule(module: string, width = 17): string {
  const colonIndex = module.indexOf(':');

  if (colonIndex === -1) {
    // No sub-part, just color the whole thing
    const color = getModuleColor(module);
    return `${color}${pad(module, width)}${COLORS.reset}`;
  }

  const base = module.slice(0, colonIndex);
  const color = getModuleColor(base);

  // Pad the full module string, then apply colors
  const padded = pad(module, width);
  const paddedBase = padded.slice(0, colonIndex);
  const paddedSub = padded.slice(colonIndex);

  return `${color}${paddedBase}${COLORS.reset}${COLORS.dim}${paddedSub}${COLORS.reset}`;
}

/** Internal keys to skip when formatting data */
const INTERNAL_KEYS = new Set(['level', 'time', 'module', 'msg']);

/**
 * Format a single value for key=value output
 */
function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.includes(' ') ? `"${value}"` : value;
  }
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Object]';
    }
  }
  return String(value);
}

/**
 * Format extra data as key=value pairs
 */
function formatData(data: Record<string, unknown>): string {
  const pairs: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (!INTERNAL_KEYS.has(key)) {
      pairs.push(`${key}=${formatValue(value)}`);
    }
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
  const moduleStr = formatModule(module);
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
