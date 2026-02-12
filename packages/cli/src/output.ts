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
export function success(message: string, data?: unknown): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(JSON.stringify({ success: true, message, data }, null, 2));
  } else {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(c().green('✓'), message);
    if (data !== undefined) {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(c().dim(JSON.stringify(data, null, 2)));
    }
  }
}

/** Output error message and exit */
export function error(message: string, details?: unknown, exitCode = 1): never {
  const format = getCurrentFormat();

  if (format === 'json') {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(JSON.stringify({ success: false, error: message, details }, null, 2));
  } else {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(c().red('✗'), message);
    if (details !== undefined) {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.error(c().dim(JSON.stringify(details, null, 2)));
    }
  }

  process.exit(exitCode);
}

/** Output warning message */
export function warn(message: string): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(JSON.stringify({ warning: message }, null, 2));
  } else {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(c().yellow('⚠'), message);
  }
}

/** Output info message */
export function info(message: string): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(JSON.stringify({ info: message }, null, 2));
  } else {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(c().blue('ℹ'), message);
  }
}

/** Output data (main output) */
export function data(value: unknown): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(JSON.stringify(value, null, 2));
  } else {
    if (Array.isArray(value)) {
      printTable(value);
    } else if (typeof value === 'object' && value !== null) {
      printObject(value as Record<string, unknown>);
    } else {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(value);
    }
  }
}

/** Maximum cell width for table display (0 = unlimited) */
let maxCellWidth = 50;

/** Set max cell width for table rendering (0 = unlimited) */
export function setMaxCellWidth(width: number): void {
  maxCellWidth = width;
}

/** Output list of items. When rawData is provided, JSON mode outputs rawData instead of formatted items. */
export function list<T>(items: T[], options?: { emptyMessage?: string; rawData?: unknown[] }): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(JSON.stringify(options?.rawData ?? items, null, 2));
    return;
  }

  if (items.length === 0) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(c().dim(options?.emptyMessage ?? 'No items found.'));
    return;
  }

  printTable(items);
}

/** Print a simple table from array of objects */
function printTable<T>(items: T[]): void {
  if (items.length === 0) return;

  const first = items[0];
  if (typeof first !== 'object' || first === null) {
    for (const item of items) {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(item);
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
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(c().bold(header));

  const separator = keys.map((k) => '-'.repeat(widths[k])).join('  ');
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(c().dim(separator));

  for (const item of items) {
    const obj = item as Record<string, unknown>;
    const row = keys.map((k) => formatCellValue(obj[k]).padEnd(widths[k])).join('  ');
    // biome-ignore lint/suspicious/noConsole: CLI output
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
  if (maxCellWidth > 0 && str.length > maxCellWidth) {
    return `${str.slice(0, maxCellWidth - 3)}...`;
  }
  return str;
}

/** Print a single object's properties */
function printObject(obj: Record<string, unknown>): void {
  const maxKeyLen = Math.max(...Object.keys(obj).map((k) => k.length));

  for (const [key, value] of Object.entries(obj)) {
    const label = key.padEnd(maxKeyLen);
    const formattedValue = formatValue(value);
    // biome-ignore lint/suspicious/noConsole: CLI output
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
export function keyValue(key: string, value: unknown): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(JSON.stringify({ [key]: value }, null, 2));
  } else {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`${c().cyan(key)}: ${formatValue(value)}`);
  }
}

/** Print a section header */
export function header(title: string): void {
  if (getCurrentFormat() === 'human') {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`\n${c().bold.underline(title)}`);
  }
}

/** Print dimmed/secondary text */
export function dim(text: string): void {
  if (getCurrentFormat() === 'human') {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(c().dim(text));
  }
}

/** Raw console.log (for custom formatting) */
export function raw(text: string): void {
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(text);
}
