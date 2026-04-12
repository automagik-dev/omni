import { describe, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';

const sessionConnect = mock(async (_options?: unknown) => {});

class MockDiscordVoiceSession {
  state = 'connecting';

  async connect(options?: unknown): Promise<void> {
    await sessionConnect(options);
    this.state = 'ready';
  }

  async disconnect(): Promise<void> {}

  listParticipants(): string[] {
    return [];
  }

  onAudio(): void {}

  onParticipantEvent(): void {}
}

mock.module('@omni/voice-client', () => ({
  DiscordVoiceSession: MockDiscordVoiceSession,
}));

const { VoiceManager } = await import('../voice/manager');

function createClient() {
  const client = new EventEmitter() as EventEmitter & {
    user: { id: string };
    guilds: { cache: Map<string, unknown> };
  };
  client.user = { id: 'bot-1' };
  client.guilds = { cache: new Map() };
  return client;
}

function createGuild() {
  return {
    members: {
      fetchMe: async () => ({ voice: { channelId: null } }),
    },
    channels: {
      cache: new Map([['chan-1', { members: new Map([['user-1', { id: 'user-1' }]]) }]]),
    },
    shard: {
      send: () => {},
    },
  };
}

describe('VoiceManager', () => {
  test('rejects joinChannel when session connect fails', async () => {
    sessionConnect.mockImplementationOnce(async () => {
      throw new Error('boom');
    });

    const client = createClient();
    client.guilds.cache.set('guild-1', createGuild());

    const manager = new VoiceManager('inst-1', client as never);
    const joinPromise = manager.joinChannel('guild-1', 'chan-1');

    await Promise.resolve();
    await Promise.resolve();

    client.emit('raw', {
      t: 'VOICE_STATE_UPDATE',
      d: { user_id: 'bot-1', guild_id: 'guild-1', session_id: 'discord-session-1' },
    });
    client.emit('raw', {
      t: 'VOICE_SERVER_UPDATE',
      d: { guild_id: 'guild-1', token: 'voice-token', endpoint: 'voice.example.test' },
    });

    const outcome = await Promise.race([
      joinPromise.then(
        () => 'resolved',
        (err) => (err instanceof Error ? err.message : String(err)),
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 50)),
    ]);

    expect(outcome).toBe('boom');
  });
});
