/**
 * Output Formatting
 *
 * Human-friendly and JSON output modes with color support.
 */

import boxen from 'boxen';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import ora from 'ora';
import { getOutputFormat } from './config.js';

/**
 * Pending write promises for end-of-process flush.
 * When stdout is a pipe (e.g., `--json | cat > file`), writes above the kernel
 * pipe buffer (64KB on Linux) trigger backpressure and get buffered in the
 * stream's internal queue. `write(chunk, cb)` fires its callback only after
 * the chunk is actually drained, so we retain those promises and await them
 * before the process exits to prevent 64KB truncation.
 */
const pendingStdoutWrites = new Set<Promise<void>>();

/**
 * Write a line to stdout using the callback form so we can await drain.
 * `console.log` doesn't expose a completion signal, so large JSON payloads
 * can be lost when the process exits before the pipe drains.
 */
function writeStdoutLine(text: string): void {
  const promise = new Promise<void>((resolve) => {
    process.stdout.write(`${text}\n`, () => resolve());
  });
  pendingStdoutWrites.add(promise);
  promise.finally(() => pendingStdoutWrites.delete(promise));
}

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
    writeStdoutLine(JSON.stringify({ success: true, message, data }, null, 2));
  } else {
    writeStdoutLine(`${c().green('✓')} ${message}`);
    if (data !== undefined) {
      writeStdoutLine(c().dim(JSON.stringify(data, null, 2)));
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

/** Output warning message. In JSON mode, writes to stderr to keep stdout as valid JSON. */
export function warn(message: string): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    // Write to stderr so --json stdout remains valid, parseable JSON
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(JSON.stringify({ warning: message }));
  } else {
    writeStdoutLine(`${c().yellow('⚠')} ${message}`);
  }
}

/**
 * Output a deprecation tip / nudge — ALWAYS to stderr regardless of format.
 *
 * Unlike `info` / `warn`, this never goes to stdout so CI scripts that grep
 * stdout for command output remain unaffected. Use for "prefer X over Y"
 * hints on legacy command paths that still work but are being deprioritized
 * (e.g., the manual nats-genie wiring chain — operators should use
 * `omni connect` or `/genie:omni` instead).
 */
export function tip(message: string): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(JSON.stringify({ tip: message }));
  } else {
    // biome-ignore lint/suspicious/noConsole: CLI output (stderr by design)
    console.error(`${c().cyan('💡')} ${message}`);
  }
}

/** Output info message. In JSON mode, writes to stderr to keep stdout as valid JSON. */
export function info(message: string): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    // Write to stderr so --json stdout remains valid, parseable JSON
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(JSON.stringify({ info: message }));
  } else {
    writeStdoutLine(`${c().blue('ℹ')} ${message}`);
  }
}

/** Output data (main output) */
export function data(value: unknown): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    writeStdoutLine(JSON.stringify(value, null, 2));
  } else {
    if (Array.isArray(value)) {
      printTable(value);
    } else if (typeof value === 'object' && value !== null) {
      printObject(value as Record<string, unknown>);
    } else {
      writeStdoutLine(String(value));
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
    writeStdoutLine(JSON.stringify(options?.rawData ?? items, null, 2));
    return;
  }

  if (items.length === 0) {
    writeStdoutLine(c().dim(options?.emptyMessage ?? 'No items found.'));
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
      writeStdoutLine(String(item));
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
  writeStdoutLine(c().bold(header));

  const separator = keys.map((k) => '-'.repeat(widths[k])).join('  ');
  writeStdoutLine(c().dim(separator));

  for (const item of items) {
    const obj = item as Record<string, unknown>;
    const row = keys.map((k) => formatCellValue(obj[k]).padEnd(widths[k])).join('  ');
    writeStdoutLine(row);
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
    writeStdoutLine(`${c().cyan(label)}  ${formattedValue}`);
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
    writeStdoutLine(JSON.stringify({ [key]: value }, null, 2));
  } else {
    writeStdoutLine(`${c().cyan(key)}: ${formatValue(value)}`);
  }
}

/** Print a section header */
export function header(title: string): void {
  if (getCurrentFormat() === 'human') {
    writeStdoutLine(`\n${c().bold.underline(title)}`);
  }
}

/** Print dimmed/secondary text */
export function dim(text: string): void {
  if (getCurrentFormat() === 'human') {
    writeStdoutLine(c().dim(text));
  }
}

/** Raw stdout line (for custom formatting) */
export function raw(text: string): void {
  writeStdoutLine(text);
}

/**
 * Print a stage divider — bold cyan ▸ + bold message, with a leading newline.
 *
 * Used as a section header in install/update/setup pipelines. In JSON mode,
 * emits `{ step: "<msg>" }` to stderr so observability isn't lost while stdout
 * stays clean for `--json | jq` consumers.
 */
export function step(message: string): void {
  const format = getCurrentFormat();

  if (format === 'json') {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(JSON.stringify({ step: message }));
  } else {
    writeStdoutLine(`\n${c().bold.cyan('▸')} ${c().bold(message)}`);
  }
}

/**
 * Format-aware spinner. Locked subset of ora's API so the implementation can
 * be swapped later without breaking callers.
 *
 * - Human TTY: real ora animation.
 * - Human non-TTY (piped, CI, NO_COLOR): degrades to plain `info(text)` on
 *   start and `success(text)` on succeed; no `\r` animation.
 * - JSON mode: emits `{ spinner: "start" | "succeed" | "fail" | ..., text }`
 *   breadcrumbs to stderr; never writes to stdout.
 */
export interface OutputSpinner {
  start(): OutputSpinner;
  succeed(text?: string): void;
  fail(text?: string): void;
  warn(text?: string): void;
  info(text?: string): void;
  stop(): void;
  set text(value: string);
}

/** Create a format-aware spinner. See {@link OutputSpinner}. */
export function spinner(text: string): OutputSpinner {
  const format = getCurrentFormat();

  if (format === 'json') {
    let currentText = text;
    const obj: OutputSpinner = {
      start() {
        // biome-ignore lint/suspicious/noConsole: CLI output
        console.error(JSON.stringify({ spinner: 'start', text: currentText }));
        return obj;
      },
      succeed(t?: string) {
        // biome-ignore lint/suspicious/noConsole: CLI output
        console.error(JSON.stringify({ spinner: 'succeed', text: t ?? currentText }));
      },
      fail(t?: string) {
        // biome-ignore lint/suspicious/noConsole: CLI output
        console.error(JSON.stringify({ spinner: 'fail', text: t ?? currentText }));
      },
      warn(t?: string) {
        // biome-ignore lint/suspicious/noConsole: CLI output
        console.error(JSON.stringify({ spinner: 'warn', text: t ?? currentText }));
      },
      info(t?: string) {
        // biome-ignore lint/suspicious/noConsole: CLI output
        console.error(JSON.stringify({ spinner: 'info', text: t ?? currentText }));
      },
      stop() {
        // biome-ignore lint/suspicious/noConsole: CLI output
        console.error(JSON.stringify({ spinner: 'stop', text: currentText }));
      },
      set text(value: string) {
        currentText = value;
      },
    };
    return obj;
  }

  if (!process.stdout.isTTY) {
    let currentText = text;
    const obj: OutputSpinner = {
      start() {
        info(currentText);
        return obj;
      },
      succeed(t?: string) {
        success(t ?? currentText);
      },
      fail(t?: string) {
        // biome-ignore lint/suspicious/noConsole: CLI output
        console.error(`${c().red('✗')} ${t ?? currentText}`);
      },
      warn(t?: string) {
        warn(t ?? currentText);
      },
      info(t?: string) {
        info(t ?? currentText);
      },
      stop() {
        // No-op: nothing to clear when there was never an animation.
      },
      set text(value: string) {
        currentText = value;
      },
    };
    return obj;
  }

  const oraInstance = ora(text);
  const obj: OutputSpinner = {
    start() {
      oraInstance.start();
      return obj;
    },
    succeed(t?: string) {
      oraInstance.succeed(t);
    },
    fail(t?: string) {
      oraInstance.fail(t);
    },
    warn(t?: string) {
      oraInstance.warn(t);
    },
    info(t?: string) {
      oraInstance.info(t);
    },
    stop() {
      oraInstance.stop();
    },
    set text(value: string) {
      oraInstance.text = value;
    },
  };
  return obj;
}

/** Options for {@link banner}. Border styles and colors are locked to a small palette. */
export interface BannerOptions {
  title?: string;
  borderStyle?: 'single' | 'double' | 'round' | 'bold';
  borderColor?: 'green' | 'red' | 'yellow' | 'blue' | 'cyan';
  padding?: number;
}

/**
 * Print a boxed banner (boxen wrapper). Used for "Updated to vX.Y.Z"
 * release-style announcements.
 *
 * - Single-line input is center-aligned; multi-line input is left-aligned.
 * - When colors are disabled (NO_COLOR / non-TTY / `--no-color`), the border
 *   degrades to a single ASCII style with no color escapes.
 * - In JSON mode, emits `{ banner: "<msg>" }` to stderr; never writes to stdout.
 */
export function banner(message: string | string[], options?: BannerOptions): void {
  const format = getCurrentFormat();
  const messageStr = Array.isArray(message) ? message.join('\n') : message;

  if (format === 'json') {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.error(JSON.stringify({ banner: messageStr }));
    return;
  }

  const isMultiLine = Array.isArray(message) || messageStr.includes('\n');
  const borderStyle = options?.borderStyle ?? 'round';
  const padding = options?.padding ?? 1;
  const textAlignment: 'left' | 'center' = isMultiLine ? 'left' : 'center';

  const colorsOn = areColorsEnabled();
  const boxOptions: Parameters<typeof boxen>[1] = colorsOn
    ? {
        borderStyle,
        borderColor: options?.borderColor ?? 'cyan',
        padding,
        textAlignment,
        title: options?.title,
      }
    : {
        borderStyle: 'single',
        padding,
        textAlignment,
        title: options?.title,
      };

  writeStdoutLine(boxen(messageStr, boxOptions));
}

/**
 * Format-aware progress bar.
 *
 * - Human TTY: real `cli-progress.SingleBar`.
 * - Human non-TTY / JSON mode: rate-limited stub that emits at most one
 *   `{ progress: 0.0..1.0, total, downloaded, label }` line per second to
 *   stderr; never animates.
 */
export interface OutputProgress {
  start(total: number, startValue?: number): void;
  update(current: number): void;
  increment(delta?: number): void;
  stop(): void;
}

/** Create a format-aware progress bar. See {@link OutputProgress}. */
export function progress(label: string): OutputProgress {
  const format = getCurrentFormat();
  const isNonTTY = format === 'json' || !process.stdout.isTTY;

  if (isNonTTY) {
    let total = 0;
    let current = 0;
    let lastEmit = 0;

    const emit = (force: boolean): void => {
      const now = Date.now();
      if (!force && now - lastEmit < 1000) return;
      lastEmit = now;
      const ratio = total > 0 ? current / total : 0;
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.error(JSON.stringify({ progress: ratio, total, downloaded: current, label }));
    };

    return {
      start(totalValue: number, startValue = 0) {
        total = totalValue;
        current = startValue;
        lastEmit = 0;
        emit(true);
      },
      update(currentValue: number) {
        current = currentValue;
        emit(false);
      },
      increment(delta = 1) {
        current += delta;
        emit(false);
      },
      stop() {
        emit(true);
      },
    };
  }

  const bar = new cliProgress.SingleBar(
    {
      format: `${label} |{bar}| {percentage}% | {value}/{total}`,
      hideCursor: true,
      clearOnComplete: false,
    },
    cliProgress.Presets.shades_classic,
  );

  return {
    start(total: number, startValue = 0) {
      bar.start(total, startValue);
    },
    update(current: number) {
      bar.update(current);
    },
    increment(delta = 1) {
      bar.increment(delta);
    },
    stop() {
      bar.stop();
    },
  };
}

/**
 * Print a horizontal divider — `─` × terminal width (or 80 if non-TTY).
 *
 * In JSON mode this is a no-op; dividers are pure decoration and JSON
 * consumers don't need them.
 */
export function divider(): void {
  if (getCurrentFormat() === 'json') return;

  const width = process.stdout.columns || 80;
  writeStdoutLine(c().dim('─'.repeat(width)));
}

/**
 * Flush stdout to ensure all buffered data is written before exit.
 * When stdout is a pipe (e.g., `--json | cat > file`), writes above the kernel
 * pipe buffer (64KB on Linux) trigger backpressure and get queued in Bun's
 * internal stream buffer. If the process exits before those bytes drain,
 * output is truncated at exactly 64KB boundaries.
 *
 * All output paths in this module route through `writeStdoutLine`, which uses
 * `process.stdout.write(chunk, cb)`. The callback fires only after the chunk
 * is actually drained; we track those promises in `pendingStdoutWrites` and
 * await them here.
 *
 * A trailing empty-write drain gives any stdout bytes written outside this
 * module (e.g., direct `process.stdout.write` calls) a final chance to drain.
 */
export async function flushStdout(): Promise<void> {
  while (pendingStdoutWrites.size > 0) {
    await Promise.all([...pendingStdoutWrites]);
  }
  await new Promise<void>((resolve) => {
    process.stdout.write('', () => resolve());
  });
}
