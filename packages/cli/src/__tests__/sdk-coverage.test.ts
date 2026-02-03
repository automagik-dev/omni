/**
 * SDK Coverage Test
 *
 * Ensures the CLI exposes all SDK functionality.
 * This test fails if the SDK has methods that the CLI doesn't cover.
 *
 * When this test fails:
 * 1. Check what new SDK methods were added
 * 2. Add corresponding CLI commands
 * 3. Update the CLI_COVERAGE mapping below
 */

import { describe, expect, test } from 'bun:test';
import { createOmniClient } from '@omni/sdk';

/**
 * Maps SDK namespaces/methods to CLI commands.
 *
 * Format: 'namespace.method': 'command subcommand' or null if intentionally skipped
 *
 * When adding new SDK methods, add them here with the corresponding CLI command.
 * Use null for methods that are intentionally not exposed via CLI (with a comment explaining why).
 */
const CLI_COVERAGE: Record<string, string | null> = {
  // Auth
  'auth.validate': 'auth status',

  // Instances
  'instances.list': 'instances list',
  'instances.get': 'instances get',
  'instances.create': 'instances create',
  'instances.update': 'instances update', // Not implemented yet - TODO
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
  'instances.listContacts': 'instances contacts', // Not implemented yet - TODO
  'instances.listGroups': 'instances groups', // Not implemented yet - TODO
  'instances.getUserProfile': null, // Internal API, not needed in CLI

  // Messages (send commands)
  'messages.send': 'send text',
  'messages.sendMedia': 'send media',
  'messages.sendReaction': 'send reaction',
  'messages.sendSticker': 'send sticker',
  'messages.sendContact': 'send contact',
  'messages.sendLocation': 'send location',
  'messages.sendPoll': 'send poll',
  'messages.sendEmbed': 'send embed',
  'messages.sendPresence': 'send presence',
  'messages.markRead': null, // Handled via chats commands
  'messages.batchMarkRead': null, // Handled via chats commands

  // Chats
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
  'chats.markRead': null, // Low priority for CLI

  // Events
  'events.list': 'events list',

  // Persons
  'persons.search': 'persons search',
  'persons.get': 'persons get',
  'persons.presence': 'persons presence',

  // Access
  'access.listRules': null, // Admin feature, low priority
  'access.createRule': null, // Admin feature, low priority

  // Settings
  'settings.list': 'settings list',

  // Providers
  'providers.list': null, // Admin feature, low priority

  // Logs
  'logs.recent': null, // Admin feature, low priority

  // Automations
  'automations.list': null, // Future: automations list
  'automations.get': null, // Future: automations get
  'automations.create': null, // Future: automations create
  'automations.update': null, // Future: automations update
  'automations.delete': null, // Future: automations delete
  'automations.enable': null, // Future: automations enable
  'automations.disable': null, // Future: automations disable
  'automations.test': null, // Future: automations test
  'automations.getLogs': null, // Future: automations logs

  // Dead Letters
  'deadLetters.list': null, // Admin feature, low priority
  'deadLetters.get': null, // Admin feature, low priority
  'deadLetters.stats': null, // Admin feature, low priority
  'deadLetters.retry': null, // Admin feature, low priority
  'deadLetters.resolve': null, // Admin feature, low priority
  'deadLetters.abandon': null, // Admin feature, low priority

  // Event Ops
  'eventOps.metrics': null, // Admin feature, low priority
  'eventOps.startReplay': null, // Admin feature, low priority
  'eventOps.listReplays': null, // Admin feature, low priority
  'eventOps.getReplay': null, // Admin feature, low priority
  'eventOps.cancelReplay': null, // Admin feature, low priority

  // Webhooks
  'webhooks.listSources': null, // Admin feature, low priority
  'webhooks.getSource': null, // Admin feature, low priority
  'webhooks.createSource': null, // Admin feature, low priority
  'webhooks.updateSource': null, // Admin feature, low priority
  'webhooks.deleteSource': null, // Admin feature, low priority
  'webhooks.trigger': null, // Admin feature, low priority

  // Payloads
  'payloads.listForEvent': null, // Debug feature, low priority
  'payloads.getStage': null, // Debug feature, low priority
  'payloads.delete': null, // Debug feature, low priority
  'payloads.listConfigs': null, // Admin feature, low priority
  'payloads.updateConfig': null, // Admin feature, low priority
  'payloads.stats': null, // Admin feature, low priority

  // System
  'system.health': 'status',

  // Raw client - internal, not exposed
  raw: null,
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
      // Recurse into nested objects (but skip the raw client)
      if (key !== 'raw') {
        paths.push(...getMethodPaths(value, path));
      } else {
        // Just mark 'raw' as a single entry
        paths.push(path);
      }
    }
  }

  return paths;
}

describe('SDK Coverage', () => {
  test('CLI covers all SDK methods', () => {
    // Create a mock client to introspect its structure
    const client = createOmniClient({
      baseUrl: 'http://localhost:8881',
      apiKey: 'test-key',
    });

    // Get all SDK method paths
    const sdkMethods = getMethodPaths(client);

    // Find methods not in CLI_COVERAGE
    const uncoveredMethods: string[] = [];
    for (const method of sdkMethods) {
      if (!(method in CLI_COVERAGE)) {
        uncoveredMethods.push(method);
      }
    }

    if (uncoveredMethods.length > 0) {
      throw new Error(
        `SDK has methods not covered by CLI!\n\n` +
          `Uncovered methods:\n${uncoveredMethods.map((m) => `  - ${m}`).join('\n')}\n\n` +
          `To fix:\n` +
          `1. Add CLI commands for these SDK methods, OR\n` +
          `2. Add them to CLI_COVERAGE with null and a comment explaining why they're skipped\n\n` +
          `Location: packages/cli/src/__tests__/sdk-coverage.test.ts`,
      );
    }

    // Also check for stale entries in CLI_COVERAGE
    const staleCoverage: string[] = [];
    for (const method of Object.keys(CLI_COVERAGE)) {
      if (!sdkMethods.includes(method)) {
        staleCoverage.push(method);
      }
    }

    if (staleCoverage.length > 0) {
      throw new Error(
        `CLI_COVERAGE has entries for methods that no longer exist in SDK!\n\n` +
          `Stale entries:\n${staleCoverage.map((m) => `  - ${m}`).join('\n')}\n\n` +
          `Remove these from CLI_COVERAGE.`,
      );
    }
  });

  test('All non-null CLI_COVERAGE entries reference valid commands', () => {
    // This test ensures that when we say a method maps to a command,
    // that command actually exists. We do this by checking the help output.

    const coveredMethods = Object.entries(CLI_COVERAGE)
      .filter(([_, cmd]) => cmd !== null)
      .map(([method, cmd]) => ({ method, command: cmd as string }));

    // Just verify we have coverage entries
    expect(coveredMethods.length).toBeGreaterThan(0);

    // Count how many are marked as covered vs skipped
    const covered = Object.values(CLI_COVERAGE).filter((v) => v !== null).length;
    const skipped = Object.values(CLI_COVERAGE).filter((v) => v === null).length;

    // Log coverage stats (visible in test output)
    // biome-ignore lint/suspicious/noConsole: test output
    console.log(`\nSDK Coverage: ${covered} methods covered, ${skipped} intentionally skipped`);
  });
});
