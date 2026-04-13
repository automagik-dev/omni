/**
 * VoiceManager — manages Discord voice sessions for an instance.
 *
 * Hooks into the discord.js Client to receive VOICE_STATE_UPDATE and
 * VOICE_SERVER_UPDATE events, then orchestrates DiscordVoiceSession
 * connections from @omni/voice-client.
 *
 * Each voice channel the bot joins gets a separate session with its own
 * WebSocket gateway, UDP socket, and SRTP decryptor.
 */

import { type EventBus, createLogger } from '@omni/core';
import { DiscordVoiceSession, type TransportOptions } from '@omni/voice-client';
import type { Client, VoiceState } from 'discord.js';

/** Optional audio stream callback registry. */
export interface AudioStreamSink {
  pushAudio(sessionId: string, userId: string, audioData: Uint8Array, format: 'opus' | 'pcm'): void;
  broadcast(sessionId: string, message: Record<string, unknown>): void;
}

const log = createLogger('discord:voice');

export interface VoiceSessionInfo {
  sessionId: string;
  instanceId: string;
  guildId: string;
  channelId: string;
  state: string;
  participants: string[];
  createdAt: number;
}

/** Pending voice connection waiting for both gateway events. */
interface PendingConnection {
  guildId: string;
  channelId: string;
  sessionId?: string;
  token?: string;
  endpoint?: string;
}

interface ConnectionWaiter {
  resolve: (info: VoiceSessionInfo) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class VoiceManager {
  private instanceId: string;
  private client: Client;
  private streamSink: AudioStreamSink | null;
  private eventBus: EventBus | null;

  /** Active voice sessions keyed by a generated session ID. */
  private sessions = new Map<string, DiscordVoiceSession>();
  /** Session metadata. */
  private sessionInfo = new Map<string, VoiceSessionInfo>();
  /** Pending connections waiting for VOICE_SERVER_UPDATE. */
  private pending = new Map<string, PendingConnection>();
  /** guildId → sessionId reverse lookup. */
  private guildToSession = new Map<string, string>();

  constructor(instanceId: string, client: Client, streamSink?: AudioStreamSink, eventBus?: EventBus) {
    this.instanceId = instanceId;
    this.client = client;
    this.streamSink = streamSink ?? null;
    this.eventBus = eventBus ?? null;
    this.setupEventListeners();
  }

  /**
   * Join a voice channel.
   * Sends the voice state update via the Discord gateway, then waits for
   * VOICE_STATE_UPDATE + VOICE_SERVER_UPDATE to complete the handshake.
   */
  async joinChannel(guildId: string, channelId: string): Promise<VoiceSessionInfo> {
    // Check if already in this guild
    const existingSessionId = this.guildToSession.get(guildId);
    if (existingSessionId) {
      const existing = this.sessionInfo.get(existingSessionId);
      if (existing) return existing;
    }

    // Get the guild
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      throw new Error(`Guild ${guildId} not found`);
    }

    // If bot is already in a voice channel in this guild, leave first to get fresh credentials
    const me = await guild.members.fetchMe();
    if (me.voice?.channelId) {
      guild.shard.send({
        op: 4,
        d: { guild_id: guildId, channel_id: null, self_mute: false, self_deaf: false },
      });
      // Wait 500ms for Discord to process the leave
      await new Promise((r) => setTimeout(r, 500));
    }

    // Clear any stale pending state
    this.pending.delete(guildId);
    this.clearConnectionWaiter(guildId);

    // Set up pending connection
    this.pending.set(guildId, { guildId, channelId });

    // Discord.js voice state update — tells Discord we want to join the channel
    // This sends Gateway Opcode 4 (Voice State Update) with self_mute=false, self_deaf=false
    guild.shard.send({
      op: 4,
      d: {
        guild_id: guildId,
        channel_id: channelId,
        self_mute: false,
        self_deaf: false,
      },
    });

    // Wait for the connection to complete (voice server update arrives)
    const info = await this.waitForConnection(guildId, channelId);
    return info;
  }

  /**
   * Leave a voice session by session ID.
   */
  async leaveChannel(sessionId: string): Promise<void> {
    const info = this.sessionInfo.get(sessionId);
    if (!info) return;

    // Send voice state update to leave
    const guild = this.client.guilds.cache.get(info.guildId);
    if (guild) {
      guild.shard.send({
        op: 4,
        d: {
          guild_id: info.guildId,
          channel_id: null,
          self_mute: false,
          self_deaf: false,
        },
      });
    }

    // Clean up
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.disconnect();
    }
    this.cleanup(sessionId);
  }

  /** Get all active voice sessions. */
  getSessions(): VoiceSessionInfo[] {
    // Update participant lists from live sessions
    for (const [id, session] of this.sessions) {
      const info = this.sessionInfo.get(id);
      if (info) {
        info.participants = session.listParticipants();
        info.state = session.state;
      }
    }
    return [...this.sessionInfo.values()];
  }

  /** Get a specific session by ID. */
  getSession(sessionId: string): VoiceSessionInfo | undefined {
    const info = this.sessionInfo.get(sessionId);
    if (!info) return undefined;
    const session = this.sessions.get(sessionId);
    if (session) {
      info.participants = session.listParticipants();
      info.state = session.state;
    }
    return info;
  }

  /** Get the underlying DiscordVoiceSession for advanced usage. */
  getVoiceSession(sessionId: string): DiscordVoiceSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Clean up all sessions (called on plugin disconnect). */
  async destroy(): Promise<void> {
    this.clearAllConnectionWaiters(new Error(`Voice manager destroyed for instance ${this.instanceId}`));
    for (const [id, session] of this.sessions) {
      await session.disconnect();
      this.cleanup(id);
    }
  }

  // ─── internal ───────────────────────────────────────────────

  private setupEventListeners(): void {
    // VOICE_STATE_UPDATE — fires when we or others join/leave voice
    this.client.on('voiceStateUpdate', (oldState: VoiceState, newState: VoiceState) => {
      this.handleVoiceStateUpdate(oldState, newState);
    });

    // Raw events for VOICE_SERVER_UPDATE (not exposed by discord.js) and
    // VOICE_STATE_UPDATE (to get the authoritative session_id for voice).
    this.client.on('raw', (packet: { t: string; d: Record<string, unknown> }) => {
      if (packet.t === 'VOICE_SERVER_UPDATE') {
        this.handleVoiceServerUpdate(packet.d);
      } else if (packet.t === 'VOICE_STATE_UPDATE') {
        const botId = this.client.user?.id;
        if (packet.d.user_id === botId && packet.d.guild_id && packet.d.session_id) {
          const guildId = packet.d.guild_id as string;
          const pending = this.pending.get(guildId);
          if (pending) {
            const sessionId = packet.d.session_id as string;
            pending.sessionId = sessionId;
            this.tryConnect(guildId);
          }
        }
      }
    });
  }

  /** Publish a voice event to NATS (fire-and-forget). */
  private publishVoiceEvent(
    type: 'voice.user_joined_channel' | 'voice.user_left_channel',
    payload: { userId: string; channelId: string; guildId: string; displayName?: string },
  ): void {
    this.eventBus?.publish(type, { ...payload, instanceId: this.instanceId }).catch(() => {});
  }

  /** Emit join/leave events when any user changes voice channel. */
  private emitUserVoiceEvents(oldState: VoiceState, newState: VoiceState): void {
    const userId = newState.id;
    const guildId = newState.guild.id;
    const oldChannel = oldState.channelId;
    const newChannel = newState.channelId;
    const displayName = newState.member?.displayName ?? userId;

    if (!oldChannel && newChannel) {
      this.publishVoiceEvent('voice.user_joined_channel', { userId, channelId: newChannel, guildId, displayName });
    } else if (oldChannel && !newChannel) {
      this.publishVoiceEvent('voice.user_left_channel', { userId, channelId: oldChannel, guildId, displayName });
    } else if (oldChannel && newChannel && oldChannel !== newChannel) {
      this.publishVoiceEvent('voice.user_left_channel', { userId, channelId: oldChannel, guildId, displayName });
      this.publishVoiceEvent('voice.user_joined_channel', { userId, channelId: newChannel, guildId, displayName });
    }
  }

  private handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
    const userId = newState.id;
    const botId = this.client.user?.id;
    const guildId = newState.guild.id;

    // Emit join/leave events for all non-bot users
    if (userId !== botId) {
      this.emitUserVoiceEvents(oldState, newState);
    }

    // Bot's own voice state updates (for connection flow)
    if (userId !== botId) return;

    const pending = this.pending.get(guildId);
    if (!pending) return;

    // Store session ID from Discord
    if (newState.sessionId) {
      pending.sessionId = newState.sessionId;
      this.tryConnect(guildId);
    }

    // If we left the channel (channelId is null), clean up
    if (!newState.channelId && oldState.channelId) {
      const sessionId = this.guildToSession.get(guildId);
      if (sessionId) {
        log.info('Bot disconnected from voice channel', { guildId, sessionId });
        const session = this.sessions.get(sessionId);
        if (session) {
          session.disconnect().catch(() => {});
        }
        this.cleanup(sessionId);
      }
    }
  }

  private handleVoiceServerUpdate(data: Record<string, unknown>): void {
    const guildId = data.guild_id as string;
    const token = data.token as string;
    const endpoint = data.endpoint as string | null;

    if (!guildId || !token || !endpoint) return;

    const pending = this.pending.get(guildId);
    if (!pending) return;

    pending.token = token;
    pending.endpoint = endpoint;
    this.tryConnect(guildId);
  }

  /** Try to complete the connection once we have both session ID and server info. */
  private tryConnect(guildId: string): void {
    const pending = this.pending.get(guildId);
    if (!pending?.sessionId || !pending.token || !pending.endpoint) return;

    const sessionId = `voice-${guildId}-${Date.now()}`;
    const session = new DiscordVoiceSession();

    this.sessions.set(sessionId, session);
    this.guildToSession.set(guildId, sessionId);

    const info: VoiceSessionInfo = {
      sessionId,
      instanceId: this.instanceId,
      guildId: pending.guildId,
      channelId: pending.channelId,
      state: 'connecting',
      participants: [],
      createdAt: Date.now(),
    };
    this.sessionInfo.set(sessionId, info);

    // Remove from pending
    this.pending.delete(guildId);

    // Gather the user IDs already in the voice channel for DAVE
    // (DAVE rejects proposals for users not in the recognized set)
    const recognizedUserIds: string[] = [];
    const guild = this.client.guilds.cache.get(pending.guildId);
    if (guild) {
      const voiceChannel = guild.channels.cache.get(pending.channelId);
      if (voiceChannel && 'members' in voiceChannel) {
        const members = (voiceChannel as { members: Map<string, { id: string }> }).members;
        for (const [memberId] of members) {
          recognizedUserIds.push(memberId);
        }
      }
    }

    // Connect the voice session
    session
      .connect({
        channelId: pending.channelId,
        guildId: pending.guildId,
        token: pending.token,
        endpoint: pending.endpoint,
        userId: this.client.user?.id,
        sessionId: pending.sessionId,
        recognizedUserIds,
      } as TransportOptions & { userId?: string; sessionId?: string; recognizedUserIds?: string[] })
      .then(() => {
        info.state = 'ready';
        log.info('Voice session connected', { sessionId, guildId, channelId: pending.channelId });

        // Wire audio to stream sink (WS registry) if available
        if (this.streamSink) {
          const sink = this.streamSink;
          session.onAudio((userId, _ssrc, opusFrame) => {
            sink.pushAudio(sessionId, userId, opusFrame, 'opus');
          });
          session.onParticipantEvent('participantJoin', (userId) => {
            sink.broadcast(sessionId, { type: 'participant_joined', userId });
          });
          session.onParticipantEvent('participantLeave', (userId) => {
            sink.broadcast(sessionId, { type: 'participant_left', userId });
          });
          sink.broadcast(sessionId, { type: 'session_ready', sessionId });
        }

        // Resolve any waiters
        const resolve = this.connectionWaiters.get(guildId);
        if (resolve) {
          this.resolveConnectionWaiter(guildId, info);
        }
      })
      .catch((err) => {
        log.error('Voice session connection failed', { sessionId, error: String(err) });
        this.cleanup(sessionId);

        this.rejectConnectionWaiter(guildId, err instanceof Error ? err : new Error(String(err)));
      });
  }

  /** Waiters for joinChannel() promise resolution. */
  private connectionWaiters = new Map<string, ConnectionWaiter>();

  private waitForConnection(guildId: string, _channelId: string): Promise<VoiceSessionInfo> {
    return new Promise<VoiceSessionInfo>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.connectionWaiters.has(guildId)) return;
        this.pending.delete(guildId);
        this.rejectConnectionWaiter(guildId, new Error(`Voice connection timed out for guild ${guildId}`));
      }, 10000);

      this.connectionWaiters.set(guildId, { resolve, reject, timeout });
    });
  }

  private cleanup(sessionId: string): void {
    const info = this.sessionInfo.get(sessionId);
    if (info) {
      this.guildToSession.delete(info.guildId);
    }
    this.sessions.delete(sessionId);
    this.sessionInfo.delete(sessionId);
  }

  private clearConnectionWaiter(guildId: string): ConnectionWaiter | undefined {
    const waiter = this.connectionWaiters.get(guildId);
    if (!waiter) return undefined;
    clearTimeout(waiter.timeout);
    this.connectionWaiters.delete(guildId);
    return waiter;
  }

  private resolveConnectionWaiter(guildId: string, info: VoiceSessionInfo): void {
    const waiter = this.clearConnectionWaiter(guildId);
    waiter?.resolve(info);
  }

  private rejectConnectionWaiter(guildId: string, error: Error): void {
    const waiter = this.clearConnectionWaiter(guildId);
    waiter?.reject(error);
  }

  private clearAllConnectionWaiters(error: Error): void {
    for (const guildId of [...this.connectionWaiters.keys()]) {
      this.rejectConnectionWaiter(guildId, error);
    }
  }
}
