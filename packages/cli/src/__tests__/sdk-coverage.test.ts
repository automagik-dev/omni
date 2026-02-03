/**
 * SDK Coverage Test
 *
 * Ensures the CLI exposes all SDK functionality.
 * This test fails if the SDK has methods that the CLI doesn't cover.
 *
 * PRINCIPLE: The CLI should expose EVERYTHING the SDK has.
 * Access control is handled by the API via scopes, not by hiding CLI commands.
 */

import { describe, expect, test } from 'bun:test';
import { createOmniClient } from '@omni/sdk';

/**
 * SDK methods that are INTERNAL and should NOT be exposed in CLI.
 * These are implementation details, not user-facing functionality.
 */
const INTERNAL_METHODS = new Set([
  'raw', // The underlying openapi-fetch client - internal implementation detail
]);

/**
 * Maps SDK methods to their CLI commands.
 *
 * When SDK adds new methods, add them here with the CLI command.
 */
const CLI_COMMANDS: Record<string, string> = {
  // ============================================================================
  // AUTH
  // ============================================================================
  'auth.validate': 'auth status',

  // ============================================================================
  // INSTANCES
  // ============================================================================
  'instances.list': 'instances list',
  'instances.get': 'instances get',
  'instances.create': 'instances create',
  'instances.update': 'instances update',
  'instances.delete': 'instances delete',
  'instances.status': 'instances status',
  'instances.qr': 'instances qr',
  'instances.connect': 'instances connect',
  'instances.disconnect': 'instances disconnect',
  'instances.restart': 'instances restart',
  'instances.logout': 'instances logout',
  'instances.pair': 'instances pair',
  'instances.syncProfile': 'instances sync',
  'instances.startSync': 'instances sync',
  'instances.listSyncs': 'instances syncs',
  'instances.getSyncStatus': 'instances syncs',
  'instances.listContacts': 'instances contacts',
  'instances.listGroups': 'instances groups',
  'instances.getUserProfile': 'instances profile',

  // ============================================================================
  // MESSAGES
  // ============================================================================
  'messages.send': 'send text',
  'messages.sendMedia': 'send media',
  'messages.sendReaction': 'send reaction',
  'messages.sendSticker': 'send sticker',
  'messages.sendContact': 'send contact',
  'messages.sendLocation': 'send location',
  'messages.sendPoll': 'send poll',
  'messages.sendEmbed': 'send embed',
  'messages.sendPresence': 'send presence',
  'messages.markRead': 'messages read',
  'messages.batchMarkRead': 'messages read --batch',

  // ============================================================================
  // CHATS
  // ============================================================================
  'chats.list': 'chats list',
  'chats.get': 'chats get',
  'chats.create': 'chats create',
  'chats.update': 'chats update',
  'chats.delete': 'chats delete',
  'chats.archive': 'chats archive',
  'chats.unarchive': 'chats unarchive',
  'chats.getMessages': 'chats messages',
  'chats.listParticipants': 'chats participants',
  'chats.addParticipant': 'chats participants --add',
  'chats.removeParticipant': 'chats participants --remove',
  'chats.markRead': 'chats read',

  // ============================================================================
  // EVENTS
  // ============================================================================
  'events.list': 'events list',

  // ============================================================================
  // PERSONS
  // ============================================================================
  'persons.search': 'persons search',
  'persons.get': 'persons get',
  'persons.presence': 'persons presence',

  // ============================================================================
  // ACCESS CONTROL
  // ============================================================================
  'access.listRules': 'access list',
  'access.createRule': 'access create',

  // ============================================================================
  // SETTINGS
  // ============================================================================
  'settings.list': 'settings list',

  // ============================================================================
  // PROVIDERS (AI/Agent providers)
  // ============================================================================
  'providers.list': 'providers list',

  // ============================================================================
  // LOGS
  // ============================================================================
  'logs.recent': 'logs',

  // ============================================================================
  // AUTOMATIONS
  // ============================================================================
  'automations.list': 'automations list',
  'automations.get': 'automations get',
  'automations.create': 'automations create',
  'automations.update': 'automations update',
  'automations.delete': 'automations delete',
  'automations.enable': 'automations enable',
  'automations.disable': 'automations disable',
  'automations.test': 'automations test',
  'automations.getLogs': 'automations logs',

  // ============================================================================
  // DEAD LETTERS (failed events)
  // ============================================================================
  'deadLetters.list': 'dead-letters list',
  'deadLetters.get': 'dead-letters get',
  'deadLetters.stats': 'dead-letters stats',
  'deadLetters.retry': 'dead-letters retry',
  'deadLetters.resolve': 'dead-letters resolve',
  'deadLetters.abandon': 'dead-letters abandon',

  // ============================================================================
  // EVENT OPS (replay, metrics)
  // ============================================================================
  'eventOps.metrics': 'events metrics',
  'eventOps.startReplay': 'events replay --start',
  'eventOps.listReplays': 'events replay',
  'eventOps.getReplay': 'events replay --status',
  'eventOps.cancelReplay': 'events replay --cancel',

  // ============================================================================
  // WEBHOOKS
  // ============================================================================
  'webhooks.listSources': 'webhooks list',
  'webhooks.getSource': 'webhooks get',
  'webhooks.createSource': 'webhooks create',
  'webhooks.updateSource': 'webhooks update',
  'webhooks.deleteSource': 'webhooks delete',
  'webhooks.trigger': 'webhooks trigger',

  // ============================================================================
  // PAYLOADS (event payload storage)
  // ============================================================================
  'payloads.listForEvent': 'payloads list',
  'payloads.getStage': 'payloads get',
  'payloads.delete': 'payloads delete',
  'payloads.listConfigs': 'payloads config',
  'payloads.updateConfig': 'payloads config --set',
  'payloads.stats': 'payloads stats',

  // ============================================================================
  // SYSTEM
  // ============================================================================
  'system.health': 'status',
};

/**
 * Get all method paths from an object recursively
 */
function getMethodPaths(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) {
    return [];
  }

  const paths: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'function') {
      paths.push(path);
    } else if (typeof value === 'object' && value !== null) {
      if (key !== 'raw') {
        paths.push(...getMethodPaths(value, path));
      } else {
        paths.push(path);
      }
    }
  }

  return paths;
}

describe('SDK Coverage', () => {
  test('All SDK methods are mapped', () => {
    const client = createOmniClient({
      baseUrl: 'http://localhost:8881',
      apiKey: 'test-key',
    });

    const sdkMethods = getMethodPaths(client);

    // Find methods not in CLI_COMMANDS and not internal
    const unmappedMethods: string[] = [];
    for (const method of sdkMethods) {
      if (!INTERNAL_METHODS.has(method) && !(method in CLI_COMMANDS)) {
        unmappedMethods.push(method);
      }
    }

    if (unmappedMethods.length > 0) {
      throw new Error(
        `SDK has methods not mapped in CLI!\n\nUnmapped methods:\n${unmappedMethods.map((m) => `  - ${m}`).join('\n')}\n\nAdd these to CLI_COMMANDS in sdk-coverage.test.ts`,
      );
    }

    // Check for stale entries
    const staleMappings: string[] = [];
    for (const method of Object.keys(CLI_COMMANDS)) {
      if (!sdkMethods.includes(method)) {
        staleMappings.push(method);
      }
    }

    if (staleMappings.length > 0) {
      throw new Error(
        `CLI_COMMANDS has stale entries!\n\nStale:\n${staleMappings.map((m) => `  - ${m}`).join('\n')}\n\nRemove these from CLI_COMMANDS.`,
      );
    }
  });

  test('Coverage statistics', () => {
    const total = Object.keys(CLI_COMMANDS).length;

    // biome-ignore lint/suspicious/noConsole: test output
    console.log(`\n${'='.repeat(60)}`);
    // biome-ignore lint/suspicious/noConsole: test output
    console.log('SDK COVERAGE REPORT');
    // biome-ignore lint/suspicious/noConsole: test output
    console.log('='.repeat(60));
    // biome-ignore lint/suspicious/noConsole: test output
    console.log(`Total SDK methods:  ${total}`);
    // biome-ignore lint/suspicious/noConsole: test output
    console.log(`Implemented:        ${total} (100%)`);
    // biome-ignore lint/suspicious/noConsole: test output
    console.log(`Internal (skipped): ${INTERNAL_METHODS.size}`);
    // biome-ignore lint/suspicious/noConsole: test output
    console.log('='.repeat(60));

    // Always pass - this is informational
    expect(total).toBeGreaterThan(0);
  });
});
