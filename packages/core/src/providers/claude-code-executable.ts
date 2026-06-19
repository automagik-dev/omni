/**
 * Claude Code executable resolution — libc ABI safety net.
 *
 * The @anthropic-ai/claude-agent-sdk (>= 0.2.117) ships native binaries as
 * optional subpackages. Its internal resolver tries the musl binary FIRST on
 * Linux via `require.resolve()`. If the musl optional package is installed but
 * the host is glibc (no /lib/ld-musl-*), the musl binary is returned and then
 * crashes on exec with code 1 — see automagik-dev/omni#501.
 *
 * This module provides:
 *   1. `detectLinuxLibc()` — probes well-known dynamic-linker paths to decide
 *      whether the host uses glibc or musl.
 *   2. `resolveClaudeCodeExecutable()` — given a libc flavor, tries to resolve
 *      the matching SDK subpackage binary so the caller can pass it via
 *      `pathToClaudeCodeExecutable` before the SDK's own resolver runs.
 *   3. `describeClaudeCodeStartupError()` — wraps the opaque "exited with
 *      code 1" message with an actionable hint when auto-detection may have
 *      mismatched the host's ABI.
 *
 * All helpers accept injectable FS/require to keep them unit-testable.
 */

import { existsSync as nodeExistsSync } from 'node:fs';
import { createRequire } from 'node:module';

import { createLogger } from '../logger';

const log = createLogger('provider:claude-code:libc');

export type LinuxLibcFlavor = 'glibc' | 'musl' | 'unknown';

export interface DetectLinuxLibcOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  existsSync?: (path: string) => boolean;
}

/**
 * Map Node arch → (muslName, glibcName) — the arch token in linker paths.
 *
 * Note the asymmetry on x64: musl uses `x86_64` (underscore) while the glibc
 * loader is `ld-linux-x86-64.so.2` (hyphen). aarch64 uses the same spelling
 * in both, but glibc on aarch64 suffixes `.so.1` instead of `.so.2`.
 */
function archLinkerNames(arch: string): { musl: string; glibc: string } | null {
  if (arch === 'x64') return { musl: 'x86_64', glibc: 'x86-64' };
  if (arch === 'arm64') return { musl: 'aarch64', glibc: 'aarch64' };
  return null;
}

function muslLinkerPath(muslName: string): string {
  return `/lib/ld-musl-${muslName}.so.1`;
}

/** Candidate glibc dynamic-linker paths across common Linux distros. */
function glibcLinkerCandidates(glibcName: string, muslName: string, nodeArch: string): string[] {
  // Canonical glibc loader suffix: x86_64 → .so.2, aarch64 → .so.1
  const suffix = nodeArch === 'arm64' ? '1' : '2';
  const fileName = `ld-linux-${glibcName}.so.${suffix}`;
  return [`/lib64/${fileName}`, `/lib/${muslName}-linux-gnu/${fileName}`, `/lib/${fileName}`];
}

/**
 * Detect whether the current Linux host uses glibc or musl.
 *
 * Probes the canonical dynamic-linker paths. musl always installs at
 * `/lib/ld-musl-<arch>.so.1`; glibc lives at one of a handful of distro-
 * dependent paths. Returns `'unknown'` on non-Linux platforms, unsupported
 * arches, or when neither linker is found.
 */
export function detectLinuxLibc(options: DetectLinuxLibcOptions = {}): LinuxLibcFlavor {
  const platform = options.platform ?? process.platform;
  if (platform !== 'linux') return 'unknown';

  const arch = options.arch ?? process.arch;
  const names = archLinkerNames(arch);
  if (!names) return 'unknown';

  const exists = options.existsSync ?? nodeExistsSync;

  if (exists(muslLinkerPath(names.musl))) return 'musl';
  if (glibcLinkerCandidates(names.glibc, names.musl, arch).some(exists)) return 'glibc';

  return 'unknown';
}

export interface ResolveClaudeCodeExecutableOptions {
  libc?: LinuxLibcFlavor;
  platform?: NodeJS.Platform;
  arch?: string;
  /** Override require function (tests). Defaults to `createRequire(import.meta.url)`. */
  resolve?: (specifier: string) => string;
}

/**
 * Resolve the SDK subpackage binary that matches the host's libc ABI.
 *
 * Returns the absolute path to the `claude` binary when the correct subpackage
 * is installed, or `undefined` when detection is not confident (non-Linux,
 * unknown libc, unsupported arch, subpackage missing). Callers should fall
 * back to the SDK's built-in resolver when this returns `undefined`.
 */
export function resolveClaudeCodeExecutable(options: ResolveClaudeCodeExecutableOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  if (platform !== 'linux') return undefined;

  const libc = options.libc ?? detectLinuxLibc({ platform, arch: options.arch });
  if (libc === 'unknown') return undefined;

  const arch = options.arch ?? process.arch;
  if (arch !== 'x64' && arch !== 'arm64') return undefined;

  const suffix = libc === 'musl' ? `-${arch}-musl` : `-${arch}`;
  const specifier = `@anthropic-ai/claude-agent-sdk-linux${suffix}/claude`;

  const resolve = options.resolve ?? createRequire(import.meta.url).resolve;
  try {
    const resolved = resolve(specifier);
    log.debug('Resolved Claude Code executable for host libc', { libc, arch, resolved });
    return resolved;
  } catch (error) {
    log.debug('Claude Code subpackage not installed; falling back to SDK default', {
      libc,
      arch,
      specifier,
      error: String(error),
    });
    return undefined;
  }
}

/**
 * Wrap an opaque Claude Code startup crash with an actionable libc-mismatch hint.
 *
 * When the SDK's resolver picks a binary that cannot execute (the canonical
 * case: musl binary on glibc host, issue #501), the SDK throws an error whose
 * message is the bare `Claude Code process exited with code 1`. This helper
 * adds context pointing at `pathToClaudeCodeExecutable` and the glibc/musl
 * optional-subpackage workaround so operators have something to act on.
 *
 * Returns the original error message unchanged when it does not match the
 * known startup-crash signature or when an explicit executable was configured.
 */
export function describeClaudeCodeStartupError(
  error: unknown,
  options: {
    explicitExecutablePath?: string;
    platform?: NodeJS.Platform;
  } = {},
): string {
  const raw = String(error);
  const platform = options.platform ?? process.platform;

  const isStartupCrash = /process exited with code 1/i.test(raw);
  if (!isStartupCrash || platform !== 'linux') return raw;

  const configuredHint = options.explicitExecutablePath
    ? `Configured pathToClaudeCodeExecutable=${options.explicitExecutablePath} did not launch — verify the binary is executable on this host.`
    : 'Set `pathToClaudeCodeExecutable` on the provider to the correct SDK binary for this host, ' +
      'or remove the mismatched optional subpackage ' +
      '(e.g. `bun remove @anthropic-ai/claude-agent-sdk-linux-x64-musl` on glibc).';

  return `${raw} — Claude Code binary failed to start. This is typically a glibc/musl ABI mismatch: the SDK resolved an optional subpackage whose native binary cannot execute on this host's dynamic linker. ${configuredHint}`;
}
