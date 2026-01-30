#!/usr/bin/env bun
/**
 * Integration test script for NATS EventBus
 *
 * Prerequisites:
 * - NATS server running (e.g., via PM2 or Docker)
 *
 * Usage:
 *   bun run packages/core/scripts/test-events-integration.ts
 *
 * Environment variables:
 *   NATS_URL - NATS server URL (default: nats://localhost:4222)
 */

import { z } from 'zod';
import { connectEventBus, eventRegistry, getStreamInfo } from '../src/events/nats';
import type { MessageReceivedPayload } from '../src/events/types';

const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4222';

async function main() {
  console.log('🧪 NATS EventBus Integration Test\n');
  console.log(`Connecting to: ${NATS_URL}\n`);

  const eventBus = await connectEventBus({ url: NATS_URL, serviceName: 'integration-test' });

  try {
    // Test 1: Stream creation
    console.log('✓ Test 1: Stream creation');
    const jsm = eventBus.getJetStreamManager();
    if (jsm) {
      const streamInfo = await getStreamInfo(jsm);
      console.log('  Streams created:');
      for (const [name, info] of streamInfo) {
        console.log(`    - ${name}: ${info.messages} messages, ${info.bytes} bytes`);
      }
    }

    // Test 2: Publish core event
    console.log('\n✓ Test 2: Publish core event');
    const publishResult = await eventBus.publish(
      'message.received',
      {
        externalId: 'ext-123',
        chatId: 'chat-456',
        from: '+1234567890',
        content: { type: 'text', text: 'Hello from integration test!' },
      } satisfies MessageReceivedPayload,
      {
        instanceId: 'test-instance',
        channelType: 'whatsapp-baileys',
        correlationId: 'test-correlation-id',
      },
    );
    console.log(`  Event published: ${publishResult.id}`);
    console.log(`  Stream: ${publishResult.stream}, Sequence: ${publishResult.sequence}`);

    // Test 3: Subscribe to core events
    console.log('\n✓ Test 3: Subscribe to core events');
    let receivedEvent = false;
    const subscription = await eventBus.subscribe(
      'message.received',
      async (event) => {
        console.log(`  Received event: ${event.id}`);
        console.log(`  Type: ${event.type}`);
        console.log(`  Payload text: ${event.payload.content.text}`);
        receivedEvent = true;
      },
      { startFrom: 'last' },
    );
    console.log(`  Subscription created: ${subscription.id}`);

    // Wait a bit for message processing
    await sleep(500);

    // Clean up subscription
    await subscription.unsubscribe();
    console.log(`  Received event: ${receivedEvent ? 'Yes' : 'No'}`);

    // Test 4: Publish custom event with registry
    console.log('\n✓ Test 4: Custom event with registry');
    const customSchema = z.object({
      action: z.string(),
      repository: z.string(),
      sender: z.string(),
    });
    eventRegistry.register({
      eventType: 'custom.webhook.github.test',
      schema: customSchema,
      description: 'Test GitHub webhook',
    });

    const customResult = await eventBus.publishGeneric(
      'custom.webhook.github.test',
      { action: 'push', repository: 'omni-v2', sender: 'test-user' },
      { source: 'integration-test' },
    );
    console.log(`  Custom event published: ${customResult.id}`);
    console.log(`  Stream: ${customResult.stream}`);

    // Test 5: Pattern subscription
    console.log('\n✓ Test 5: Pattern subscription');
    const patternSub = await eventBus.subscribePattern(
      'message.>',
      async (event) => {
        console.log(`  Pattern received: ${event.type} - ${event.id}`);
      },
      { startFrom: 'last' },
    );
    console.log(`  Pattern subscription created: ${patternSub.pattern}`);

    // Publish another message to test pattern
    await eventBus.publish(
      'message.sent',
      {
        externalId: 'ext-sent-123',
        chatId: 'chat-456',
        to: '+1234567890',
        content: { type: 'text', text: 'Reply message' },
      },
      { instanceId: 'test-instance', channelType: 'whatsapp-baileys' },
    );

    await sleep(500);
    await patternSub.unsubscribe();

    // Test 6: System event (dead letter)
    console.log('\n✓ Test 6: System events');
    const systemResult = await eventBus.publishGeneric(
      'system.health.check',
      { status: 'ok', timestamp: Date.now() },
      { source: 'integration-test' },
    );
    console.log(`  System event published: ${systemResult.id}`);
    console.log(`  Stream: ${systemResult.stream}`);

    // Test 7: Connection status
    console.log('\n✓ Test 7: Connection status');
    console.log(`  Connected: ${eventBus.isConnected()}`);
    console.log(`  Active subscriptions: ${eventBus.getSubscriptionCount()}`);

    console.log('\n✅ All integration tests passed!\n');
  } catch (error) {
    console.error('\n❌ Integration test failed:', error);
    process.exit(1);
  } finally {
    await eventBus.close();
    console.log('Connection closed');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
