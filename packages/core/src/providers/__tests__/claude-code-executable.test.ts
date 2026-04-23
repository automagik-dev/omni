/**
 * claude-code-executable — libc probe + subpackage resolver tests.
 *
 * The probe is pure: it dispatches on `platform`, `arch`, and a filesystem
 * presence check, all injectable. The resolver wraps `require.resolve`, also
 * injectable. These tests lock in the glibc / musl / unknown branches and the
 * error-message wrapper's behavior.
 */

import { describe, expect, it } from 'bun:test';
import {
  describeClaudeCodeStartupError,
  detectLinuxLibc,
  resolveClaudeCodeExecutable,
} from '../claude-code-executable';

function fsWith(paths: Set<string>) {
  return (path: string) => paths.has(path);
}

describe('detectLinuxLibc', () => {
  it('returns glibc when the glibc dynamic linker is present (x86_64 uses hyphen)', () => {
    // Note: glibc spells x86_64 with a hyphen in the loader filename,
    // while musl spells it with an underscore. These MUST stay in sync with
    // archLinkerNames() in claude-code-executable.ts.
    const existsSync = fsWith(new Set(['/lib64/ld-linux-x86-64.so.2']));
    expect(detectLinuxLibc({ platform: 'linux', arch: 'x64', existsSync })).toBe('glibc');
  });

  it('returns glibc from the Debian multi-arch path', () => {
    const existsSync = fsWith(new Set(['/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2']));
    expect(detectLinuxLibc({ platform: 'linux', arch: 'x64', existsSync })).toBe('glibc');
  });

  it('returns musl when the musl dynamic linker is present', () => {
    const existsSync = fsWith(new Set(['/lib/ld-musl-x86_64.so.1']));
    expect(detectLinuxLibc({ platform: 'linux', arch: 'x64', existsSync })).toBe('musl');
  });

  it('prefers musl when both linkers somehow coexist', () => {
    // musl is tried first because that matches the SDK's own resolution order;
    // this keeps us consistent with what the SDK would pick if we did nothing.
    const existsSync = fsWith(new Set(['/lib/ld-musl-x86_64.so.1', '/lib64/ld-linux-x86-64.so.2']));
    expect(detectLinuxLibc({ platform: 'linux', arch: 'x64', existsSync })).toBe('musl');
  });

  it('returns unknown when neither linker is found', () => {
    const existsSync = fsWith(new Set());
    expect(detectLinuxLibc({ platform: 'linux', arch: 'x64', existsSync })).toBe('unknown');
  });

  it('returns unknown on non-linux platforms', () => {
    const existsSync = fsWith(new Set(['/lib/ld-musl-x86_64.so.1']));
    expect(detectLinuxLibc({ platform: 'darwin', arch: 'x64', existsSync })).toBe('unknown');
    expect(detectLinuxLibc({ platform: 'win32', arch: 'x64', existsSync })).toBe('unknown');
  });

  it('returns unknown for unsupported arches', () => {
    const existsSync = fsWith(new Set(['/lib/ld-musl-x86_64.so.1']));
    expect(detectLinuxLibc({ platform: 'linux', arch: 'mips', existsSync })).toBe('unknown');
  });

  it('detects glibc on arm64 via the aarch64 linker name', () => {
    const existsSync = fsWith(new Set(['/lib/ld-linux-aarch64.so.1']));
    expect(detectLinuxLibc({ platform: 'linux', arch: 'arm64', existsSync })).toBe('glibc');
  });

  it('detects musl on arm64', () => {
    const existsSync = fsWith(new Set(['/lib/ld-musl-aarch64.so.1']));
    expect(detectLinuxLibc({ platform: 'linux', arch: 'arm64', existsSync })).toBe('musl');
  });
});

describe('resolveClaudeCodeExecutable', () => {
  it('returns the glibc subpackage binary when libc=glibc on x64', () => {
    const resolve = (specifier: string) => {
      expect(specifier).toBe('@anthropic-ai/claude-agent-sdk-linux-x64/claude');
      return '/opt/sdk/linux-x64/claude';
    };
    const result = resolveClaudeCodeExecutable({
      libc: 'glibc',
      platform: 'linux',
      arch: 'x64',
      resolve,
    });
    expect(result).toBe('/opt/sdk/linux-x64/claude');
  });

  it('returns the musl subpackage binary when libc=musl on x64', () => {
    const resolve = (specifier: string) => {
      expect(specifier).toBe('@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude');
      return '/opt/sdk/linux-x64-musl/claude';
    };
    const result = resolveClaudeCodeExecutable({
      libc: 'musl',
      platform: 'linux',
      arch: 'x64',
      resolve,
    });
    expect(result).toBe('/opt/sdk/linux-x64-musl/claude');
  });

  it('returns undefined when require.resolve throws (subpackage missing)', () => {
    const resolve = () => {
      throw new Error("Cannot find module '@anthropic-ai/claude-agent-sdk-linux-x64/claude'");
    };
    const result = resolveClaudeCodeExecutable({
      libc: 'glibc',
      platform: 'linux',
      arch: 'x64',
      resolve,
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined on non-linux platforms', () => {
    const resolve = () => {
      throw new Error('should not be called');
    };
    expect(resolveClaudeCodeExecutable({ libc: 'glibc', platform: 'darwin', arch: 'x64', resolve })).toBeUndefined();
  });

  it('returns undefined when libc is unknown', () => {
    const resolve = () => {
      throw new Error('should not be called');
    };
    expect(resolveClaudeCodeExecutable({ libc: 'unknown', platform: 'linux', arch: 'x64', resolve })).toBeUndefined();
  });

  it('returns undefined for unsupported arches', () => {
    const resolve = () => {
      throw new Error('should not be called');
    };
    expect(resolveClaudeCodeExecutable({ libc: 'glibc', platform: 'linux', arch: 'mips', resolve })).toBeUndefined();
  });

  it('uses arm64 suffix for arm64 hosts', () => {
    const resolve = (specifier: string) => {
      expect(specifier).toBe('@anthropic-ai/claude-agent-sdk-linux-arm64-musl/claude');
      return '/opt/sdk/linux-arm64-musl/claude';
    };
    const result = resolveClaudeCodeExecutable({
      libc: 'musl',
      platform: 'linux',
      arch: 'arm64',
      resolve,
    });
    expect(result).toBe('/opt/sdk/linux-arm64-musl/claude');
  });
});

describe('describeClaudeCodeStartupError', () => {
  it('annotates the opaque startup crash on Linux without an explicit path', () => {
    const msg = describeClaudeCodeStartupError(new Error('Claude Code process exited with code 1'), {
      platform: 'linux',
    });
    expect(msg).toContain('glibc/musl ABI mismatch');
    expect(msg).toContain('pathToClaudeCodeExecutable');
    expect(msg).toContain('bun remove @anthropic-ai/claude-agent-sdk-linux-x64-musl');
  });

  it('mentions the configured path when one was explicitly set', () => {
    const msg = describeClaudeCodeStartupError(new Error('Claude Code process exited with code 1'), {
      platform: 'linux',
      explicitExecutablePath: '/opt/bad/claude',
    });
    expect(msg).toContain('/opt/bad/claude');
    expect(msg).toContain('did not launch');
    // When explicitly configured the remove-subpackage suggestion is not useful
    expect(msg).not.toContain('bun remove');
  });

  it('returns the raw message unchanged when the error is not a startup crash', () => {
    const msg = describeClaudeCodeStartupError(new Error('Timed out after 30s'), {
      platform: 'linux',
    });
    expect(msg).toBe('Error: Timed out after 30s');
  });

  it('returns the raw message unchanged on non-linux platforms', () => {
    const msg = describeClaudeCodeStartupError(new Error('Claude Code process exited with code 1'), {
      platform: 'darwin',
    });
    expect(msg).toBe('Error: Claude Code process exited with code 1');
  });
});
