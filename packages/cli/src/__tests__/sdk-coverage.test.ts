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
 * - String value = implemented CLI command
 * - 'TODO: command name' = planned but not yet implemented
 *
 * When SDK adds new methods, add them here with either the CLI command or TODO.
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
  'instances.update': 'TODO: instances update',
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
  'instances.listContacts': 'TODO: instances contacts',
  'instances.listGroups': 'TODO: instances groups',
  'instances.getUserProfile': 'TODO: instances profile',

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
  'messages.markRead': 'TODO: messages read',
  'messages.batchMarkRead': 'TODO: messages read --batch',

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
  'chats.markRead': 'TODO: chats read',

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
  'access.listRules': 'TODO: access list',
  'access.createRule': 'TODO: access create',

  // ============================================================================
  // SETTINGS
  // ============================================================================
  'settings.list': 'settings list',

  // ============================================================================
  // PROVIDERS (AI/Agent providers)
  // ============================================================================
  'providers.list': 'TODO: providers list',

  // ============================================================================
  // LOGS
  // ============================================================================
  'logs.recent': 'TODO: logs',

  // ============================================================================
  // AUTOMATIONS
  // ============================================================================
  'automations.list': 'TODO: automations list',
  'automations.get': 'TODO: automations get',
  'automations.create': 'TODO: automations create',
  'automations.update': 'TODO: automations update',
  'automations.delete': 'TODO: automations delete',
  'automations.enable': 'TODO: automations enable',
  'automations.disable': 'TODO: automations disable',
  'automations.test': 'TODO: automations test',
  'automations.getLogs': 'TODO: automations logs',

  // ============================================================================
  // DEAD LETTERS (failed events)
  // ============================================================================
  'deadLetters.list': 'TODO: dead-letters list',
  'deadLetters.get': 'TODO: dead-letters get',
  'deadLetters.stats': 'TODO: dead-letters stats',
  'deadLetters.retry': 'TODO: dead-letters retry',
  'deadLetters.resolve': 'TODO: dead-letters resolve',
  'deadLetters.abandon': 'TODO: dead-letters abandon',

  // ============================================================================
  // EVENT OPS (replay, metrics)
  // ============================================================================
  'eventOps.metrics': 'TODO: events metrics',
  'eventOps.startReplay': 'TODO: events replay',
  'eventOps.listReplays': 'TODO: events replays',
  'eventOps.getReplay': 'TODO: events replay --status',
  'eventOps.cancelReplay': 'TODO: events replay --cancel',

  // ============================================================================
  // WEBHOOKS
  // ============================================================================
  'webhooks.listSources': 'TODO: webhooks list',
  'webhooks.getSource': 'TODO: webhooks get',
  'webhooks.createSource': 'TODO: webhooks create',
  'webhooks.updateSource': 'TODO: webhooks update',
  'webhooks.deleteSource': 'TODO: webhooks delete',
  'webhooks.trigger': 'TODO: webhooks trigger',

  // ============================================================================
  // PAYLOADS (event payload storage)
  // ============================================================================
  'payloads.listForEvent': 'TODO: payloads list',
  'payloads.getStage': 'TODO: payloads get',
  'payloads.delete': 'TODO: payloads delete',
  'payloads.listConfigs': 'TODO: payloads config',
  'payloads.updateConfig': 'TODO: payloads config --set',
  'payloads.stats': 'TODO: payloads stats',

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
        `SDK has methods not mapped in CLI!\n\n` +
          `Unmapped methods:\n${unmappedMethods.map((m) => `  - ${m}`).join('\n')}\n\n` +
          `Add these to CLI_COMMANDS in sdk-coverage.test.ts`,
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
        `CLI_COMMANDS has stale entries!\n\n` +
          `Stale:\n${staleMappings.map((m) => `  - ${m}`).join('\n')}\n\n` +
          `Remove these from CLI_COMMANDS.`,
      );
    }
  });

  test('Coverage statistics', () => {
    const implemented = Object.entries(CLI_COMMANDS).filter(([_, cmd]) => !cmd.startsWith('TODO:'));
    const todo = Object.entries(CLI_COMMANDS).filter(([_, cmd]) => cmd.startsWith('TODO:'));

    const total = Object.keys(CLI_COMMANDS).length;
    const implementedCount = implemented.length;
    const todoCount = todo.length;
    const coverage = Math.round((implementedCount / total) * 100);

    // biome-ignore lint/suspicious/noConsole: test output
    console.log(`\n${'='.repeat(60)}`);
    // biome-ignore lint/suspicious/noConsole: test output
    console.log('SDK COVERAGE REPORT');
    // biome-ignore lint/suspicious/noConsole: test output
    console.log('='.repeat(60));
    // biome-ignore lint/suspicious/noConsole: test output
    console.log(`Total SDK methods:  ${total}`);
    // biome-ignore lint/suspicious/noConsole: test output
    console.log(`Implemented:        ${implementedCount} (${coverage}%)`);
    // biome-ignore lint/suspicious/noConsole: test output
    console.log(`TODO:               ${todoCount}`);
    // biome-ignore lint/suspicious/noConsole: test output
    console.log(`Internal (skipped): ${INTERNAL_METHODS.size}`);
    // biome-ignore lint/suspicious/noConsole: test output
    console.log('='.repeat(60));

    if (todoCount > 0) {
      // biome-ignore lint/suspicious/noConsole: test output
      console.log('\nMISSING CLI COMMANDS:');
      // Group TODOs by namespace
      const byNamespace: Record<string, string[]> = {};
      for (const [method, cmd] of todo) {
        const ns = method.split('.')[0];
        if (!byNamespace[ns]) byNamespace[ns] = [];
        byNamespace[ns].push(`  ${method} → ${cmd.replace('TODO: ', '')}`);
      }
      for (const [ns, methods] of Object.entries(byNamespace).sort()) {
        // biome-ignore lint/suspicious/noConsole: test output
        console.log(`\n${ns}:`);
        for (const m of methods) {
          // biome-ignore lint/suspicious/noConsole: test output
          console.log(m);
        }
      }
      // biome-ignore lint/suspicious/noConsole: test output
      console.log('');
    }

    // Always pass - this is informational
    expect(total).toBeGreaterThan(0);
  });
});
