#!/usr/bin/env bun
/**
 * Integration test for all message types across channels
 *
 * Configure in .env:
 *   TEST_WHATSAPP_INSTANCE=<instance-id>
 *   TEST_WHATSAPP_RECIPIENT=<jid like 555197285829@s.whatsapp.net>
 *   TEST_DISCORD_INSTANCE=<instance-id>
 *   TEST_DISCORD_CHANNEL=<channel-id>
 *   TEST_PERSON_ID=<person-uuid> (optional, for testing person resolution)
 *
 * Run:
 *   bun scripts/test-messaging.ts
 *   bun scripts/test-messaging.ts --channel=whatsapp
 *   bun scripts/test-messaging.ts --channel=discord
 */

const API_URL = process.env.API_URL || 'http://localhost:8881/api/v2';
const API_KEY = process.env.OMNI_API_KEY || '';

// Test config from env
const config = {
  whatsapp: {
    instanceId: process.env.TEST_WHATSAPP_INSTANCE || '',
    recipient: process.env.TEST_WHATSAPP_RECIPIENT || '',
  },
  discord: {
    instanceId: process.env.TEST_DISCORD_INSTANCE || '',
    channel: process.env.TEST_DISCORD_CHANNEL || '',
  },
  personId: process.env.TEST_PERSON_ID || '',
};

interface TestResult {
  name: string;
  channel: string;
  success: boolean;
  messageId?: string;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function api(endpoint: string, data: unknown): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (json.error) {
      return { success: false, error: json.error.message || JSON.stringify(json.error) };
    }
    return { success: true, data: json.data || json };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

async function test(
  name: string,
  channel: string,
  endpoint: string,
  data: unknown,
): Promise<TestResult> {
  const start = Date.now();
  const res = await api(endpoint, data);
  const result: TestResult = {
    name,
    channel,
    success: res.success,
    messageId: (res.data as { messageId?: string })?.messageId,
    error: res.error,
    duration: Date.now() - start,
  };
  results.push(result);

  const icon = res.success ? '✅' : '❌';
  const id = result.messageId ? ` (${result.messageId})` : '';
  const err = result.error ? ` - ${result.error}` : '';
  console.log(`${icon} [${channel}] ${name}${id}${err}`);

  return result;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================================
// WhatsApp Tests
// ============================================================================
async function testWhatsApp() {
  const { instanceId, recipient } = config.whatsapp;
  if (!instanceId || !recipient) {
    console.log('⚠️  Skipping WhatsApp tests (TEST_WHATSAPP_INSTANCE or TEST_WHATSAPP_RECIPIENT not set)');
    return;
  }

  console.log('\n📱 WhatsApp Tests\n');

  // 1. Text
  await test('Text message', 'whatsapp', '/messages/send', {
    instanceId,
    to: recipient,
    text: '🧪 Integration Test: Text message',
  });
  await sleep(1000);

  // 2. Image
  await test('Image', 'whatsapp', '/messages/send/media', {
    instanceId,
    to: recipient,
    type: 'image',
    url: 'https://httpbin.org/image/png',
    caption: '🖼️ Integration Test: Image',
  });
  await sleep(1000);

  // 3. Voice Note
  await test('Voice Note', 'whatsapp', '/messages/send/media', {
    instanceId,
    to: recipient,
    type: 'audio',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    voiceNote: true,
  });
  await sleep(1000);

  // 4. Video
  await test('Video', 'whatsapp', '/messages/send/media', {
    instanceId,
    to: recipient,
    type: 'video',
    url: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
    caption: '🎬 Integration Test: Video',
  });
  await sleep(1000);

  // 5. Document
  await test('Document', 'whatsapp', '/messages/send/media', {
    instanceId,
    to: recipient,
    type: 'document',
    url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    filename: 'test.pdf',
    caption: '📄 Integration Test: PDF',
  });
  await sleep(1000);

  // 6. Poll
  await test('Poll', 'whatsapp', '/messages/send/poll', {
    instanceId,
    to: recipient,
    question: '🗳️ Integration Test Poll',
    answers: ['Option A', 'Option B', 'Option C'],
    multiSelect: false,
  });
  await sleep(1000);

  // 7. Target for reaction/reply
  const targetResult = await test('Target for reaction/reply', 'whatsapp', '/messages/send', {
    instanceId,
    to: recipient,
    text: '👆 React and reply to this message!',
  });
  await sleep(2000);

  if (targetResult.messageId) {
    // 8. Reaction
    await test('Reaction', 'whatsapp', '/messages/send/reaction', {
      instanceId,
      to: recipient,
      messageId: targetResult.messageId,
      emoji: '❤️',
    });
    await sleep(1000);

    // 9. Reply
    await test('Reply', 'whatsapp', '/messages/send', {
      instanceId,
      to: recipient,
      text: '↩️ Integration Test: Reply!',
      replyTo: targetResult.messageId,
    });
  }
}

// ============================================================================
// Discord Tests
// ============================================================================
async function testDiscord() {
  const { instanceId, channel } = config.discord;
  if (!instanceId || !channel) {
    console.log('⚠️  Skipping Discord tests (TEST_DISCORD_INSTANCE or TEST_DISCORD_CHANNEL not set)');
    return;
  }

  console.log('\n💬 Discord Tests\n');

  // 1. Text
  await test('Text message', 'discord', '/messages/send', {
    instanceId,
    to: channel,
    text: '🧪 Integration Test: Text message',
  });
  await sleep(1000);

  // 2. User mention
  await test('User mention', 'discord', '/messages/send', {
    instanceId,
    to: channel,
    text: 'Integration Test: Mention',
    mentions: [{ id: '747922925146996746', type: 'user' }],
  });
  await sleep(1000);

  // 3. Image
  await test('Image', 'discord', '/messages/send/media', {
    instanceId,
    to: channel,
    type: 'image',
    url: 'https://httpbin.org/image/png',
    caption: '🖼️ Integration Test: Image',
  });
  await sleep(1000);

  // 4. Video
  await test('Video', 'discord', '/messages/send/media', {
    instanceId,
    to: channel,
    type: 'video',
    url: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
    caption: '🎬 Integration Test: Video',
  });
  await sleep(1000);

  // 5. Document
  await test('Document', 'discord', '/messages/send/media', {
    instanceId,
    to: channel,
    type: 'document',
    url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    filename: 'test.pdf',
    caption: '📄 Integration Test: PDF',
  });
  await sleep(1000);

  // 6. Embed
  await test('Embed', 'discord', '/messages/send', {
    instanceId,
    to: channel,
    text: 'Integration Test: Embed',
    embed: {
      title: 'Test Embed',
      description: 'This is an embed message',
      color: 5814783,
      fields: [
        { name: 'Field 1', value: 'Value 1', inline: true },
        { name: 'Field 2', value: 'Value 2', inline: true },
      ],
    },
  });
  await sleep(1000);

  // 7. Poll
  await test('Poll', 'discord', '/messages/send/poll', {
    instanceId,
    to: channel,
    question: '🗳️ Integration Test Poll',
    answers: ['Option A', 'Option B', 'Option C'],
    durationHours: 1,
  });
  await sleep(1000);

  // 8. Target for reaction/reply
  const targetResult = await test('Target for reaction/reply', 'discord', '/messages/send', {
    instanceId,
    to: channel,
    text: '👆 React and reply to this message!',
  });
  await sleep(2000);

  if (targetResult.messageId) {
    // 9. Reaction
    await test('Reaction', 'discord', '/messages/send/reaction', {
      instanceId,
      to: channel,
      messageId: targetResult.messageId,
      emoji: '👍',
    });
    await sleep(1000);

    // 10. Reply
    await test('Reply', 'discord', '/messages/send', {
      instanceId,
      to: channel,
      text: '↩️ Integration Test: Reply!',
      replyTo: targetResult.messageId,
    });
  }
}

// ============================================================================
// Person ID Test
// ============================================================================
async function testPersonId() {
  if (!config.personId) {
    console.log('⚠️  Skipping Person ID test (TEST_PERSON_ID not set)');
    return;
  }

  console.log('\n👤 Person ID Tests\n');

  // WhatsApp via Person ID
  if (config.whatsapp.instanceId) {
    await test('WhatsApp via Person ID', 'whatsapp', '/messages/send', {
      instanceId: config.whatsapp.instanceId,
      to: config.personId,
      text: '🧪 Message sent via Person ID (WhatsApp)',
    });
  }

  // Discord via Person ID (requires DM channel support - may fail)
  // if (config.discord.instanceId) {
  //   await test('Discord via Person ID', 'discord', '/messages/send', {
  //     instanceId: config.discord.instanceId,
  //     to: config.personId,
  //     text: '🧪 Message sent via Person ID (Discord)',
  //   });
  // }
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  console.log('🚀 Omni Messaging Integration Tests\n');
  console.log(`API: ${API_URL}`);
  console.log(`WhatsApp: ${config.whatsapp.instanceId || 'not configured'}`);
  console.log(`Discord: ${config.discord.instanceId || 'not configured'}`);
  console.log(`Person ID: ${config.personId || 'not configured'}`);

  const args = process.argv.slice(2);
  const channelFilter = args.find((a) => a.startsWith('--channel='))?.split('=')[1];

  if (!channelFilter || channelFilter === 'whatsapp') {
    await testWhatsApp();
  }

  if (!channelFilter || channelFilter === 'discord') {
    await testDiscord();
  }

  if (!channelFilter) {
    await testPersonId();
  }

  // Summary
  console.log('\n📊 Summary\n');
  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.log('\n❌ Failed tests:');
    results.filter((r) => !r.success).forEach((r) => {
      console.log(`  - [${r.channel}] ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }

  console.log('\n✅ All tests passed!');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
