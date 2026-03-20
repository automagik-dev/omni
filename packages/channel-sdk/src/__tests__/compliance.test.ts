/**
 * SDK Compliance Test Suite
 *
 * Parameterized tests that verify every channel plugin complies with the
 * @omni/channel-sdk contract. Uses static analysis (prototype inspection and
 * source-code scanning) — no runtime instantiation, so no credentials or
 * network connections are needed.
 *
 * Each channel is described by a ChannelDescriptor and tested against the same
 * set of contract checks. Groups cover:
 *   1. Infrastructure & descriptors (this file scaffolding)
 *   2. Required contract (extends base, required methods/properties)
 *   3. Reliability utilities (dedupe, download guard, sanitize, event emitters)
 *   4. Optional capability consistency (streaming, fetchHistory, sendTyping)
 *   5. Error hierarchy (extends ChannelError, channelCode, name)
 *   6. Journey timing (T10, T11, inbound timing)
 *   7. Capabilities shape validation
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// SDK base & types
import { BaseChannelPlugin } from '../base/BaseChannelPlugin';
import type { ChannelCapabilities } from '../types/capabilities';

// Channel classes, capabilities, errors, and error codes
import {
  DISCORD_CAPABILITIES,
  DiscordError,
  ErrorCode as DiscordErrorCode,
  DiscordPlugin,
} from '@omni/channel-discord';
import { SLACK_CAPABILITIES, SlackError, SlackErrorCode, SlackPlugin } from '@omni/channel-slack';
import { TELEGRAM_CAPABILITIES, TelegramError, TelegramErrorCode, TelegramPlugin } from '@omni/channel-telegram';
import {
  WHATSAPP_CAPABILITIES,
  WhatsAppError,
  ErrorCode as WhatsAppErrorCode,
  WhatsAppPlugin,
} from '@omni/channel-whatsapp';

// Core error base
import { ChannelError } from '@omni/core';

// ─────────────────────────────────────────────────────────────
// Channel Descriptor
// ─────────────────────────────────────────────────────────────

interface ChannelDescriptor {
  name: string;
  packageName: string;
  pluginClass: typeof BaseChannelPlugin;
  errorClass: new (...args: any[]) => Error;
  capabilities: ChannelCapabilities;
  pluginSourcePath: string;
  handlerSourcePaths: string[];
  errorSourcePath: string;
}

/** Root of the monorepo packages directory */
const packagesRoot = resolve(dirname(import.meta.dir), '..', '..');

function channelPath(channel: string, ...segments: string[]): string {
  return resolve(packagesRoot, `channel-${channel}`, 'src', ...segments);
}

const channels: ChannelDescriptor[] = [
  {
    name: 'whatsapp',
    packageName: '@omni/channel-whatsapp',
    pluginClass: WhatsAppPlugin as unknown as typeof BaseChannelPlugin,
    errorClass: WhatsAppError,
    capabilities: WHATSAPP_CAPABILITIES,
    pluginSourcePath: channelPath('whatsapp', 'plugin.ts'),
    handlerSourcePaths: [
      channelPath('whatsapp', 'handlers', 'messages.ts'),
      channelPath('whatsapp', 'handlers', 'media.ts'),
    ],
    errorSourcePath: channelPath('whatsapp', 'utils', 'errors.ts'),
  },
  {
    name: 'telegram',
    packageName: '@omni/channel-telegram',
    pluginClass: TelegramPlugin as unknown as typeof BaseChannelPlugin,
    errorClass: TelegramError,
    capabilities: TELEGRAM_CAPABILITIES,
    pluginSourcePath: channelPath('telegram', 'plugin.ts'),
    handlerSourcePaths: [
      channelPath('telegram', 'handlers', 'messages.ts'),
      channelPath('telegram', 'handlers', 'extract-content.ts'),
    ],
    errorSourcePath: channelPath('telegram', 'utils', 'errors.ts'),
  },
  {
    name: 'discord',
    packageName: '@omni/channel-discord',
    pluginClass: DiscordPlugin as unknown as typeof BaseChannelPlugin,
    errorClass: DiscordError,
    capabilities: DISCORD_CAPABILITIES,
    pluginSourcePath: channelPath('discord', 'plugin.ts'),
    handlerSourcePaths: [channelPath('discord', 'handlers', 'messages.ts')],
    errorSourcePath: channelPath('discord', 'utils', 'errors.ts'),
  },
  {
    name: 'slack',
    packageName: '@omni/channel-slack',
    pluginClass: SlackPlugin as unknown as typeof BaseChannelPlugin,
    errorClass: SlackError,
    capabilities: SLACK_CAPABILITIES,
    pluginSourcePath: channelPath('slack', 'plugin.ts'),
    handlerSourcePaths: [channelPath('slack', 'handlers', 'messages.ts')],
    errorSourcePath: channelPath('slack', 'types.ts'),
  },
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Read a source file, returning its content. Throws if missing. */
function readSource(path: string): string {
  return readFileSync(path, 'utf-8');
}

/** Check if a method exists on the prototype chain of a class */
function hasMethod(cls: typeof BaseChannelPlugin, methodName: string): boolean {
  let proto = cls.prototype;
  while (proto && proto !== Object.prototype) {
    if (typeof Object.getOwnPropertyDescriptor(proto, methodName)?.value === 'function') {
      return true;
    }
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}

/** Check if a property is declared in the class source (for abstract/readonly properties) */
function sourceDeclaresProperty(source: string, propName: string): boolean {
  // Match property declarations like: readonly id, readonly name, etc.
  // Also match: this.id = , public id, etc.
  const patterns = [
    new RegExp(`readonly\\s+${propName}\\b`),
    new RegExp(`(?:public|protected|private)?\\s*${propName}\\s*[:=]`),
    new RegExp(`this\\.${propName}\\s*=`),
  ];
  return patterns.some((p) => p.test(source));
}

// ═══════════════════════════════════════════════════════════════
// Group 1: Infrastructure — verify descriptors and source paths
// ═══════════════════════════════════════════════════════════════

describe('SDK compliance test infrastructure', () => {
  it('has descriptors for all 4 channels', () => {
    const names = channels.map((c) => c.name).sort();
    expect(names).toEqual(['discord', 'slack', 'telegram', 'whatsapp']);
  });

  for (const channel of channels) {
    it(`${channel.name}: plugin source file exists`, () => {
      expect(existsSync(channel.pluginSourcePath)).toBe(true);
    });

    it(`${channel.name}: error source file exists`, () => {
      expect(existsSync(channel.errorSourcePath)).toBe(true);
    });

    it(`${channel.name}: handler source files exist`, () => {
      for (const handlerPath of channel.handlerSourcePaths) {
        expect(existsSync(handlerPath)).toBe(true);
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// Group 2: Required contract — base class, methods, properties
// ═══════════════════════════════════════════════════════════════

for (const channel of channels) {
  describe(`${channel.name} SDK compliance: required contract`, () => {
    it('extends BaseChannelPlugin', () => {
      // Walk the prototype chain to verify inheritance
      let proto = Object.getPrototypeOf(channel.pluginClass.prototype);
      let extendsBase = false;
      while (proto) {
        if (proto === BaseChannelPlugin.prototype) {
          extendsBase = true;
          break;
        }
        proto = Object.getPrototypeOf(proto);
      }
      expect(extendsBase).toBe(true);
    });

    it('implements connect()', () => {
      expect(hasMethod(channel.pluginClass, 'connect')).toBe(true);
    });

    it('implements disconnect()', () => {
      expect(hasMethod(channel.pluginClass, 'disconnect')).toBe(true);
    });

    it('implements sendMessage()', () => {
      expect(hasMethod(channel.pluginClass, 'sendMessage')).toBe(true);
    });

    it('has id, name, version, capabilities properties', () => {
      const source = readSource(channel.pluginSourcePath);
      for (const prop of ['id', 'name', 'version', 'capabilities']) {
        expect(sourceDeclaresProperty(source, prop)).toBe(true);
      }
    });

    it('has lifecycle methods (initialize, destroy)', () => {
      // These are inherited from BaseChannelPlugin
      expect(hasMethod(channel.pluginClass, 'initialize')).toBe(true);
      expect(hasMethod(channel.pluginClass, 'destroy')).toBe(true);
    });

    it('has health methods (getHealth, getConnectedInstances, getStatus)', () => {
      expect(hasMethod(channel.pluginClass, 'getHealth')).toBe(true);
      expect(hasMethod(channel.pluginClass, 'getConnectedInstances')).toBe(true);
      expect(hasMethod(channel.pluginClass, 'getStatus')).toBe(true);
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// Group 5: Error hierarchy
//
// Verifies that each channel's error class properly extends the
// core ChannelError from @omni/core, exposes a channelCode
// property, and sets error.name to the channel-specific class name.
// ═══════════════════════════════════════════════════════════════

/** Map channel name → constructor args for a representative error instance */
const errorConstructorArgs: Record<string, unknown[]> = {
  whatsapp: [WhatsAppErrorCode.SEND_FAILED, 'compliance test'],
  telegram: [TelegramErrorCode.SEND_FAILED, 'compliance test'],
  discord: [DiscordErrorCode.SEND_FAILED, 'compliance test'],
  slack: [SlackErrorCode.SEND_FAILED, 'compliance test'],
};

for (const channel of channels) {
  describe(`${channel.name} SDK compliance: error hierarchy`, () => {
    const args = errorConstructorArgs[channel.name]!;
    const createError = () => new (channel.errorClass as any)(...args);

    it('error class extends ChannelError from @omni/core', () => {
      const err = createError();
      expect(err).toBeInstanceOf(ChannelError);
    });

    it('error instances have channelCode property', () => {
      const err = createError();
      expect(err).toHaveProperty('channelCode');
      expect(typeof (err as any).channelCode).toBe('string');
      expect((err as any).channelCode.length).toBeGreaterThan(0);
    });

    it('error.name matches channel-specific pattern', () => {
      const err = createError();
      // The error class constructor sets this.name to the class name (e.g. 'WhatsAppError')
      expect(err.name).toBe(channel.errorClass.name);
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// Group 7: Capabilities shape validation
//
// Verifies each channel's capabilities object conforms to the
// full ChannelCapabilities interface: required boolean fields,
// numeric limits, and media type declarations.
// ═══════════════════════════════════════════════════════════════

/** The 15 required boolean fields from ChannelCapabilities (non-optional) */
const REQUIRED_BOOLEAN_FIELDS: (keyof ChannelCapabilities)[] = [
  'canSendText',
  'canSendMedia',
  'canSendReaction',
  'canSendTyping',
  'canReceiveReadReceipts',
  'canReceiveDeliveryReceipts',
  'canEditMessage',
  'canDeleteMessage',
  'canReplyToMessage',
  'canForwardMessage',
  'canSendContact',
  'canSendLocation',
  'canSendSticker',
  'canHandleGroups',
  'canHandleBroadcast',
];

for (const channel of channels) {
  describe(`${channel.name} SDK compliance: capabilities shape`, () => {
    it('has all required boolean fields', () => {
      for (const field of REQUIRED_BOOLEAN_FIELDS) {
        expect(typeof channel.capabilities[field]).toBe('boolean');
      }
    });

    it('has valid maxMessageLength', () => {
      expect(typeof channel.capabilities.maxMessageLength).toBe('number');
      expect(channel.capabilities.maxMessageLength).toBeGreaterThanOrEqual(0);
    });

    it('has valid maxFileSize', () => {
      expect(typeof channel.capabilities.maxFileSize).toBe('number');
      expect(channel.capabilities.maxFileSize).toBeGreaterThanOrEqual(0);
    });

    it('has valid supportedMediaTypes', () => {
      const { supportedMediaTypes } = channel.capabilities;
      expect(Array.isArray(supportedMediaTypes)).toBe(true);
      expect(supportedMediaTypes.length).toBeGreaterThan(0);

      for (const mediaType of supportedMediaTypes) {
        expect(typeof mediaType.mimeType).toBe('string');
        expect(mediaType.mimeType.length).toBeGreaterThan(0);
      }
    });
  });
}
