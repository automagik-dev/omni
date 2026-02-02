/**
 * Output Formatting
 *
 * Human-friendly and JSON output modes with color support.
 */

import chalk from 'chalk';
import { getOutputFormat } from './config.js';

/** Global color control */
let colorsEnabled = true;

/** Disable colors (for --no-color flag) */
export function disableColors(): void {
  colorsEnabled = false;
}

/** Check if colors are enabled */
export function areColorsEnabled(): boolean {
  return colorsEnabled && process.stdout.isTTY !== false;
}

/** Get chalk instance (respects color setting) */
function c(): typeof chalk {
  if (areColorsEnabled()) {
    return chalk;
  }
  // For no-color mode, just return chalk - it respects NO_COLOR env
  return chalk;
}

/** Output format type */
export type OutputFormat = 'human' | 'json';

/** Current output format */
export function getCurrentFormat(): OutputFormat {
  return getOutputFormat();
}

/** Output success message */
// biome-ignore lint/suspicious/noConsole: CLI needs console output
export function success(message: string, data?: unknown): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    console.log(JSON.stringify({ success: true, message, data }, null, 2));
  } else {
    console.log(c().green('✓'), message);
    if (data !== undefined) {
      console.log(c().dim(JSON.stringify(data, null, 2)));
    }
  }
}

/** Output error message and exit */
// biome-ignore lint/suspicious/noConsole: CLI needs console output
export function error(message: string, details?: unknown, exitCode = 1): never {
  const format = getCurrentFormat();

  if (format === 'json') {
    console.error(JSON.stringify({ success: false, error: message, details }, null, 2));
  } else {
    console.error(c().red('✗'), message);
    if (details !== undefined) {
      console.error(c().dim(typeof details === 'string' ? details : JSON.stringify(details, null, 2)));
    }
  }

  process.exit(exitCode);
}

/** Output warning message */
// biome-ignore lint/suspicious/noConsole: CLI needs console output
export function warn(message: string): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    console.error(JSON.stringify({ warning: message }));
  } else {
    console.warn(c().yellow('⚠'), message);
  }
}

/** Output info message */
// biome-ignore lint/suspicious/noConsole: CLI needs console output
export function info(message: string): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    console.error(JSON.stringify({ info: message }));
  } else {
    console.log(c().blue('ℹ'), message);
  }
}

/** Output data (main output) */
// biome-ignore lint/suspicious/noConsole: CLI needs console output
export function data(value: unknown): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    console.log(JSON.stringify(value, null, 2));
  } else {
    if (Array.isArray(value)) {
      printTable(value);
    } else if (typeof value === 'object' && value !== null) {
      printObject(value as Record<string, unknown>);
    } else {
      console.log(value);
    }
  }
}

/** Output list of items */
// biome-ignore lint/suspicious/noConsole: CLI needs console output
export function list<T>(items: T[], options?: { emptyMessage?: string }): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log(c().dim(options?.emptyMessage ?? 'No items found.'));
    return;
  }

  printTable(items);
}

/** Print a simple table from array of objects */
// biome-ignore lint/suspicious/noConsole: CLI needs console output
function printTable<T>(items: T[]): void {
  if (items.length === 0) return;

  const first = items[0];
  if (typeof first !== 'object' || first === null) {
    for (const item of items) {
      console.log(String(item));
    }
    return;
  }

  const keys = Object.keys(first as Record<string, unknown>);
  if (keys.length === 0) return;

  const widths: Record<string, number> = {};
  for (const key of keys) {
    widths[key] = key.length;
  }

  for (const item of items) {
    const obj = item as Record<string, unknown>;
    for (const key of keys) {
      const val = formatCellValue(obj[key]);
      widths[key] = Math.max(widths[key], val.length);
    }
  }

  const header = keys.map((k) => k.toUpperCase().padEnd(widths[k])).join('  ');
  console.log(c().bold(header));

  const separator = keys.map((k) => '-'.repeat(widths[k])).join('  ');
  console.log(c().dim(separator));

  for (const item of items) {
    const obj = item as Record<string, unknown>;
    const row = keys.map((k) => formatCellValue(obj[k]).padEnd(widths[k])).join('  ');
    console.log(row);
  }
}

/** Format a cell value for table display */
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  const str = String(value);
  return str.length > 50 ? `${str.slice(0, 47)}...` : str;
}

/** Print a single object's properties */
// biome-ignore lint/suspicious/noConsole: CLI needs console output
function printObject(obj: Record<string, unknown>): void {
  const maxKeyLen = Math.max(...Object.keys(obj).map((k) => k.length));

  for (const [key, value] of Object.entries(obj)) {
    const label = key.padEnd(maxKeyLen);
    const formattedValue = formatValue(value);
    console.log(`${c().cyan(label)}  ${formattedValue}`);
  }
}

/** Format a value for human display */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return c().dim('-');
  }
  if (typeof value === 'boolean') {
    return value ? c().green('yes') : c().red('no');
  }
  if (typeof value === 'object') {
    return c().dim(JSON.stringify(value));
  }
  return String(value);
}

/** Print a key-value pair */
// biome-ignore lint/suspicious/noConsole: CLI needs console output
export function keyValue(key: string, value: unknown): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    console.log(JSON.stringify({ [key]: value }, null, 2));
  } else {
    console.log(`${c().cyan(key)}:`, formatValue(value));
  }
}

/** Print a section header */
// biome-ignore lint/suspicious/noConsole: CLI needs console output
export function header(title: string): void {
  if (getCurrentFormat() === 'human') {
    console.log();
    console.log(c().bold(title));
    console.log(c().dim('-'.repeat(title.length)));
  }
}

/** Print dimmed/secondary text */
// biome-ignore lint/suspicious/noConsole: CLI needs console output
export function dim(text: string): void {
  if (getCurrentFormat() === 'human') {
    console.log(c().dim(text));
  }
}

/** Raw console.log (for custom formatting) */
// biome-ignore lint/suspicious/noConsole: CLI needs console output
export function raw(text: string): void {
  console.log(text);
}
