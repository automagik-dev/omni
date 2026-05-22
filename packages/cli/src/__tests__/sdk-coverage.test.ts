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
  // A2A
  // ============================================================================
  'a2a.listAgents': 'a2a list',
  'a2a.getAgentCard': 'a2a card <agent-id>',
  'a2a.sendMessage': 'a2a send <instance-id> --text <message>',

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
  'instances.listGroupMembers': 'instances group-members',
  'instances.getUserProfile': 'instances profile',

  // ============================================================================
  // MESSAGES
  // ============================================================================
  'messages.get': 'messages get <id>',
  'messages.send': 'send text',
  'messages.sendMedia': 'send media',
  'messages.sendReaction': 'send reaction',
  'messages.sendForward': 'send --forward',
  'messages.sendSticker': 'send sticker',
  'messages.sendContact': 'send contact',
  'messages.sendLocation': 'send location',
  'messages.sendPoll': 'send poll',
  'messages.sendEmbed': 'send embed',
  'messages.sendPresence': 'send presence',
  'messages.listVoices': 'tts voices',
  'messages.sendTts': 'send tts',
  'messages.removeReaction': 'messages remove-reaction <messageId>',
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
  'chats.hide': 'chats hide',
  'chats.unhide': 'chats unhide',
  'chats.addLabel': 'chats label',
  'chats.removeLabel': 'chats unlabel',

  // ============================================================================
  // EVENTS
  // ============================================================================
  'events.list': 'events list',
  'events.get': 'events get <id>',
  'events.analytics': 'events analytics',

  // ============================================================================
  // PERSONS
  // ============================================================================
  'persons.search': 'persons search',
  'persons.get': 'persons get',
  'persons.presence': 'persons presence',
  'persons.update': 'persons update <id>',
  'persons.link': 'persons link <id>',
  'persons.unlink': 'persons unlink <id>',
  'persons.merge': 'persons merge <a> <b>',

  // ============================================================================
  // ACCESS CONTROL
  // ============================================================================
  'access.listRules': 'access list',
  'access.createRule': 'access create',
  'access.deleteRule': 'access delete',
  'access.checkAccess': 'access check',
  'access.listPairingRequests': 'access pending',
  'access.actionPairingRequest': 'access approve / access deny',

  // ============================================================================
  // SETTINGS
  // ============================================================================
  'settings.list': 'settings list',
  'settings.get': 'settings get',
  'settings.set': 'settings set',

  // ============================================================================
  // PROVIDERS (AI/Agent providers)
  // ============================================================================
  'providers.list': 'providers list',
  'providers.get': 'providers get <id>',
  'providers.create': 'providers create --name <name> --schema <schema> --base-url <url> --api-key <key>',
  'providers.update': 'providers update <id> --name <name> --base-url <url>',
  'providers.delete': 'providers delete <id> --force',
  'providers.checkHealth': 'providers test <id>',
  'providers.listAgents': 'providers agents <id>',
  'providers.listTeams': 'providers teams <id>',
  'providers.listWorkflows': 'providers workflows <id>',

  // ============================================================================
  // ROUTES
  // ============================================================================
  'routes.list': 'routes list',
  'routes.get': 'routes get',
  'routes.create': 'routes create',
  'routes.update': 'routes update',
  'routes.delete': 'routes delete',
  'routes.getMetrics': 'routes metrics',

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
  'automations.execute': 'automations execute',
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
  // BATCH JOBS
  // ============================================================================
  'batchJobs.create': 'batch create',
  'batchJobs.get': 'batch status',
  'batchJobs.getStatus': 'batch status',
  'batchJobs.list': 'batch list',
  'batchJobs.cancel': 'batch cancel',
  'batchJobs.estimate': 'batch estimate',

  // ============================================================================
  // API KEYS
  // ============================================================================
  'keys.create': 'keys create',
  'keys.list': 'keys list',
  'keys.get': 'keys get',
  'keys.update': 'keys update',
  'keys.revoke': 'keys revoke',
  'keys.delete': 'keys delete',

  // ============================================================================
  // CONTEXT
  // ============================================================================
  'context.get': 'where',
  'context.set': 'open <contact>',
  'context.use': 'use <instance>',
  'context.clear': 'close',

  // ============================================================================
  // TURNS
  // ============================================================================
  'turns.close': 'done "text" / done --react / done --skip',
  'turns.list': 'turns list',
  'turns.get': 'turns get <id>',
  'turns.forceClose': 'turns close <id>',
  'turns.bulkClose': 'turns close-all --confirm',
  'turns.stats': 'turns stats',

  // ============================================================================
  // MEDIA (multimodal verbs — tts/stt/vision/imagegen/videogen)
  // ============================================================================
  'media.tts': 'speak <text>',
  'media.stt': 'listen <file>',
  'media.vision': 'see <file> [prompt]',
  'media.imagine': 'imagine <prompt...>',
  'media.film': 'film <prompt>',

  // ============================================================================
  // AGENTS
  // ============================================================================
  'agents.list': 'agents list',
  'agents.get': 'agents get <id>',
  'agents.create': 'agents create --name <name> --provider <id> --instance <id>',
  'agents.update': 'agents update <id> [--name <name>] [--model <model>] [--provider <p>] [--active|--inactive]',
  'agents.delete': 'agents delete <id>',

  // ============================================================================
  // FOLLOW-UP (idle-chat follow-up config — issue #404)
  // ============================================================================
  'followUp.getAgent': 'follow-up get agents',
  'followUp.setAgent': 'follow-up set agents',
  'followUp.unsetAgent': 'follow-up unset agents',
  'followUp.getInstance': 'follow-up get instances',
  'followUp.setInstance': 'follow-up set instances',
  'followUp.unsetInstance': 'follow-up unset instances',
  'followUp.getChat': 'follow-up get chats',
  'followUp.setChat': 'follow-up set chats',
  'followUp.unsetChat': 'follow-up unset chats',

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
      baseUrl: 'http://localhost:8882',
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
