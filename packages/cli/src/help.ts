/**
 * Help Formatting Utilities
 *
 * Reusable utilities for formatting CLI help text.
 */

import chalk, { Chalk, type ChalkInstance } from 'chalk';
import { areColorsEnabled } from './output.js';

/** Option definition for grouped options display */
export interface OptionDef {
  flags: string;
  description: string;
}

/** Example definition for examples section */
export interface Example {
  command: string;
  description: string;
}

/** Get chalk instance (respects color setting) */
function c(): ChalkInstance {
  if (areColorsEnabled()) {
    return chalk;
  }
  return new Chalk({ level: 0 });
}

/**
 * Format a section with title and indented content.
 *
 * @example
 * formatSection('Quick Start', 'omni send --to +55 --text "Hi"')
 * // Returns:
 * // Quick Start:
 * //   omni send --to +55 --text "Hi"
 */
export function formatSection(title: string, content: string): string {
  const lines = content.split('\n').map((line) => `  ${line}`);
  return `${c().bold(title)}:\n${lines.join('\n')}`;
}

/**
 * Format a group of options with a group title.
 *
 * @example
 * formatOptionGroup('Text Message', [
 *   { flags: '--text <text>', description: 'Message content' }
 * ])
 */
export function formatOptionGroup(title: string, options: OptionDef[]): string {
  const maxFlagLen = Math.max(...options.map((o) => o.flags.length));
  const lines = options.map((opt) => {
    const paddedFlags = opt.flags.padEnd(maxFlagLen + 2);
    return `    ${paddedFlags}${opt.description}`;
  });

  return `\n  ${c().cyan(title)}:\n${lines.join('\n')}`;
}

/**
 * Format examples section.
 *
 * @example
 * formatExamples([
 *   { command: 'omni send --to +55 --text "Hi"', description: 'Send text' }
 * ])
 */
export function formatExamples(examples: Example[]): string {
  const maxCmdLen = Math.max(...examples.map((e) => e.command.length));
  const lines = examples.map((ex) => {
    const paddedCmd = ex.command.padEnd(maxCmdLen + 2);
    return `  ${paddedCmd}${c().dim(`# ${ex.description}`)}`;
  });

  return `${c().bold('Examples')}:\n${lines.join('\n')}`;
}

/**
 * Format key-value pairs in a compact display.
 *
 * @example
 * formatKeyValue({ instance: 'cezar-personal', format: 'human' })
 * // Returns: "instance=cezar-personal, format=human"
 */
export function formatKeyValue(pairs: Record<string, string | undefined>): string {
  const entries = Object.entries(pairs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`);

  return entries.join(', ');
}

/**
 * Indent text by a number of spaces.
 */
export function indent(text: string, spaces = 2): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => `${pad}${line}`)
    .join('\n');
}

/**
 * Format command groups for help display.
 *
 * @example
 * formatCommandGroups({
 *   Core: [{ name: 'send', description: 'Send message' }]
 * })
 */
export interface CommandInfo {
  name: string;
  description: string;
}

export function formatCommandGroups(groups: Record<string, CommandInfo[]>): string {
  const sections: string[] = [];
  const maxNameLen = Math.max(
    ...Object.values(groups)
      .flat()
      .map((c) => c.name.length),
  );

  for (const [groupName, commands] of Object.entries(groups)) {
    const cmdLines = commands.map((cmd) => {
      const paddedName = cmd.name.padEnd(maxNameLen + 2);
      return `    ${c().green(paddedName)}${cmd.description}`;
    });

    sections.push(`  ${c().bold(groupName)}:\n${cmdLines.join('\n')}`);
  }

  return sections.join('\n\n');
}
