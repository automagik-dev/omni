/**
 * SDK Compliance Test Suite
 *
 * Parameterized tests that verify each channel plugin conforms to the
 * @omni/channel-sdk contract. Uses static analysis (prototype inspection
 * and source-code scanning) — no plugin instantiation required.
 *
 * What "SDK compliance" means:
 * 1. Required Contract — plugin extends BaseChannelPlugin with all abstract methods
 * 2. Reliability Utilities — plugin adopts SDK deduplication, download guards, and sanitization
 * 3. Optional Capabilities — declared capabilities match implemented methods
 * 4. Error Hierarchy — channel errors extend core ChannelError
 * 5. Journey Timing — sendMessage paths capture T10/T11 checkpoints
 * 6. Capabilities Shape — capabilities object has all required fields with correct types
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { BaseChannelPlugin } from '../base/BaseChannelPlugin';
import type { ChannelCapabilities } from '../types/capabilities';

import { ChannelError } from '@omni/core';
// Use relative imports to avoid circular workspace dependencies
// (channel packages depend on channel-sdk; adding them as devDeps creates a turbo cycle)
import {
  DISCORD_CAPABILITIES,
  DiscordError,
  ErrorCode as DiscordErrorCode,
  DiscordPlugin,
} from '../../../channel-discord/src/index';
import { SLACK_CAPABILITIES, SlackError, SlackErrorCode, SlackPlugin } from '../../../channel-slack/src/index';
import {
  TELEGRAM_CAPABILITIES,
  TelegramError,
  TelegramErrorCode,
  TelegramPlugin,
} from '../../../channel-telegram/src/index';
import {
  TWILIO_WHATSAPP_CAPABILITIES,
  TwilioWhatsAppError,
  TwilioWhatsAppErrorCode,
  TwilioWhatsAppPlugin,
} from '../../../channel-twilio-whatsapp/src/index';
import {
  MetaApiError,
  MetaErrorCode,
  WHATSAPP_CLOUD_CAPABILITIES,
  WhatsAppCloudPlugin,
} from '../../../channel-whatsapp-cloud/src/index';
import {
  WHATSAPP_CAPABILITIES,
  WhatsAppError,
  ErrorCode as WhatsAppErrorCode,
  WhatsAppPlugin,
} from '../../../channel-whatsapp/src/index';

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
      channelPath('telegram', 'utils', 'media-download.ts'),
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
    handlerSourcePaths: [
      channelPath('discord', 'handlers', 'messages.ts'),
      channelPath('discord', 'handlers', 'forwarded-attachments.ts'),
    ],
    errorSourcePath: channelPath('discord', 'utils', 'errors.ts'),
  },
  {
    name: 'slack',
    packageName: '@omni/channel-slack',
    pluginClass: SlackPlugin as unknown as typeof BaseChannelPlugin,
    errorClass: SlackError,
    capabilities: SLACK_CAPABILITIES,
    pluginSourcePath: channelPath('slack', 'plugin.ts'),
    handlerSourcePaths: [channelPath('slack', 'handlers', 'messages.ts'), channelPath('slack', 'handlers', 'files.ts')],
    errorSourcePath: channelPath('slack', 'types.ts'),
  },
  {
    name: 'whatsapp-cloud',
    packageName: '@omni/channel-whatsapp-cloud',
    pluginClass: WhatsAppCloudPlugin as unknown as typeof BaseChannelPlugin,
    errorClass: MetaApiError,
    capabilities: WHATSAPP_CLOUD_CAPABILITIES,
    pluginSourcePath: channelPath('whatsapp-cloud', 'plugin.ts'),
    handlerSourcePaths: [channelPath('whatsapp-cloud', 'handlers', 'webhook.ts')],
    errorSourcePath: channelPath('whatsapp-cloud', 'utils', 'errors.ts'),
  },
  {
    name: 'twilio-whatsapp',
    packageName: '@omni/channel-twilio-whatsapp',
    pluginClass: TwilioWhatsAppPlugin as unknown as typeof BaseChannelPlugin,
    errorClass: TwilioWhatsAppError,
    capabilities: TWILIO_WHATSAPP_CAPABILITIES,
    pluginSourcePath: channelPath('twilio-whatsapp', 'plugin.ts'),
    handlerSourcePaths: [channelPath('twilio-whatsapp', 'handlers', 'webhooks.ts')],
    errorSourcePath: channelPath('twilio-whatsapp', 'utils', 'errors.ts'),
  },
];

function readSource(path: string): string {
  return readFileSync(path, 'utf-8');
}

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

function sourceContainsCall(source: string, fnName: string): boolean {
  const needle = `${fnName}(`;
  for (const line of source.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (line.includes(needle)) return true;
  }
  return false;
}

function anySourceContainsCall(paths: string[], fnName: string): boolean {
  return paths.some((p) => sourceContainsCall(readSource(p), fnName));
}

function sourceDeclaresProperty(source: string, propName: string): boolean {
  const patterns = [
    new RegExp(`readonly\\s+${propName}\\b`),
    new RegExp(`(?:public|protected|private)?\\s*${propName}\\s*[:=]`),
    new RegExp(`this\\.${propName}\\s*=`),
  ];
  return patterns.some((p) => p.test(source));
}

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

const errorConstructorArgs: Record<string, unknown[]> = {
  whatsapp: [WhatsAppErrorCode.SEND_FAILED, 'compliance test'],
  telegram: [TelegramErrorCode.SEND_FAILED, 'compliance test'],
  discord: [DiscordErrorCode.SEND_FAILED, 'compliance test'],
  slack: [SlackErrorCode.SEND_FAILED, 'compliance test'],
  'twilio-whatsapp': [TwilioWhatsAppErrorCode.SEND_FAILED, 'compliance test'],
  'whatsapp-cloud': [MetaErrorCode.INVALID_REQUEST, 'compliance test'],
};

// Group 1: Infrastructure

describe('SDK compliance test infrastructure', () => {
  it('has descriptors for all 6 channels', () => {
    const names = channels.map((c) => c.name).sort();
    expect(names).toEqual(['discord', 'slack', 'telegram', 'twilio-whatsapp', 'whatsapp', 'whatsapp-cloud']);
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

// Groups 2-7: Parameterized per channel

for (const channel of channels) {
  describe(`${channel.name} SDK compliance`, () => {
    // Group 2: Required contract
    describe('required contract', () => {
      it('extends BaseChannelPlugin', () => {
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
        expect(hasMethod(channel.pluginClass, 'initialize')).toBe(true);
        expect(hasMethod(channel.pluginClass, 'destroy')).toBe(true);
      });

      it('has health methods (getHealth, getConnectedInstances, getStatus)', () => {
        expect(hasMethod(channel.pluginClass, 'getHealth')).toBe(true);
        expect(hasMethod(channel.pluginClass, 'getConnectedInstances')).toBe(true);
        expect(hasMethod(channel.pluginClass, 'getStatus')).toBe(true);
      });
    });

    // Group 3: Reliability utilities
    describe('reliability utilities', () => {
      it('uses createInboundDedupeCache for deduplication', () => {
        const allPaths = [channel.pluginSourcePath, ...channel.handlerSourcePaths];
        expect(anySourceContainsCall(allPaths, 'createInboundDedupeCache')).toBe(true);
      });

      it('uses createDownloadGuard for media downloads', () => {
        const allPaths = [channel.pluginSourcePath, ...channel.handlerSourcePaths];
        expect(anySourceContainsCall(allPaths, 'createDownloadGuard')).toBe(true);
      });

      it('uses sanitizeMessage for inbound text', () => {
        const allPaths = [channel.pluginSourcePath, ...channel.handlerSourcePaths];
        expect(anySourceContainsCall(allPaths, 'sanitizeMessage')).toBe(true);
      });

      it('calls emitMessageReceived for inbound messages', () => {
        const source = readSource(channel.pluginSourcePath);
        expect(sourceContainsCall(source, 'this.emitMessageReceived')).toBe(true);
      });

      it('calls emitMessageSent on successful send', () => {
        const source = readSource(channel.pluginSourcePath);
        expect(sourceContainsCall(source, 'this.emitMessageSent')).toBe(true);
      });

      it('calls emitMessageFailed on send failure', () => {
        const source = readSource(channel.pluginSourcePath);
        expect(sourceContainsCall(source, 'this.emitMessageFailed')).toBe(true);
      });
    });

    // Group 4: Optional capability consistency
    describe('optional capability consistency', () => {
      it('has createStreamSender when canStreamResponse is declared', () => {
        if (channel.capabilities.canStreamResponse) {
          expect(hasMethod(channel.pluginClass, 'createStreamSender')).toBe(true);
        }
      });

      it('has fetchHistory method', () => {
        expect(hasMethod(channel.pluginClass, 'fetchHistory')).toBe(true);
      });

      it('has sendTyping when canSendTyping is declared', () => {
        if (channel.capabilities.canSendTyping) {
          expect(hasMethod(channel.pluginClass, 'sendTyping')).toBe(true);
        }
      });

      it('has react/unreact pair when reactions are supported', () => {
        if (channel.capabilities.canSendReaction) {
          expect(hasMethod(channel.pluginClass, 'react')).toBe(true);
          expect(hasMethod(channel.pluginClass, 'unreact')).toBe(true);
        }
      });
    });

    // Group 5: Error hierarchy
    describe('error hierarchy', () => {
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
        expect(err.name).toBe(channel.errorClass.name);
      });
    });

    // Group 6: Journey timing
    describe('journey timing', () => {
      it('captures T10 (pluginSentAt) in sendMessage path', () => {
        // T10 is recorded right before the platform API call.
        const source = readSource(channel.pluginSourcePath);
        expect(sourceContainsCall(source, 'captureT10')).toBe(true);
      });

      it('captures T11 (platformDeliveredAt) in sendMessage path', () => {
        // T11 is recorded right after the platform confirms delivery.
        const source = readSource(channel.pluginSourcePath);
        expect(sourceContainsCall(source, 'captureT11')).toBe(true);
      });

      it('captures inbound timing checkpoints (T0/T1/T2)', () => {
        // Inbound flow: captureInboundTimings() builds T0+T1, then captureT2()
        // records T2 after the event is published via emitMessageReceived().
        const source = readSource(channel.pluginSourcePath);
        expect(sourceContainsCall(source, 'captureInboundTimings')).toBe(true);
        expect(sourceContainsCall(source, 'captureT2')).toBe(true);
      });

      it('calls T10 before T11 in sendMessage flow', () => {
        // Verify correct ordering: T10 (before send) must appear before T11 (after send).
        const source = readSource(channel.pluginSourcePath);
        const t10Index = source.indexOf('captureT10(');
        const t11Index = source.indexOf('captureT11(');
        expect(t10Index).toBeGreaterThan(-1);
        expect(t11Index).toBeGreaterThan(-1);
        expect(t10Index).toBeLessThan(t11Index);
      });

      it('calls captureInboundTimings before captureT2 in inbound flow', () => {
        // Verify correct ordering: build timings map before recording T2.
        const source = readSource(channel.pluginSourcePath);
        const inboundIndex = source.indexOf('captureInboundTimings(');
        const t2Index = source.indexOf('captureT2(');
        expect(inboundIndex).toBeGreaterThan(-1);
        expect(t2Index).toBeGreaterThan(-1);
        expect(inboundIndex).toBeLessThan(t2Index);
      });
    });

    // Group 7: Capabilities shape
    describe('capabilities shape', () => {
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
  });
}

// Discovery guard

describe('channel coverage', () => {
  it('covers all channel-* packages (excluding a2a, internal, and linkedin)', () => {
    const entries = readdirSync(packagesRoot, { withFileTypes: true });
    const channelPackages = entries
      .filter(
        (e) =>
          e.isDirectory() &&
          existsSync(resolve(packagesRoot, e.name, 'package.json')) &&
          e.name.startsWith('channel-') &&
          e.name !== 'channel-sdk' &&
          e.name !== 'channel-a2a' &&
          e.name !== 'channel-internal' &&
          e.name !== 'channel-linkedin' && // Placeholder package — no source yet
          e.name !== 'channel-gupshup', // In progress — PR #334
      )
      .map((e) => e.name.replace('channel-', ''));

    const testedChannels = channels.map((c) => c.name);
    for (const pkg of channelPackages) {
      expect(testedChannels).toContain(pkg);
    }
  });
});
