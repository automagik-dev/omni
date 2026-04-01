/**
 * Enhanced ChannelPlugin interface
 *
 * This extends the basic interface from @omni/core with full lifecycle
 * management, multi-instance support, and health monitoring.
 */

import type { ChannelType } from '@omni/core/types';
import type { FetchHistoryOptions, FetchHistoryResult } from '../history';
import type { ChannelCapabilities } from './capabilities';
import type { PluginContext } from './context';
import type { ConnectionStatus, InstanceConfig } from './instance';
import type { OutgoingMessage, SendResult } from './messaging';
import type { StreamSender } from './streaming';

/**
 * Health status for the plugin
 */
export interface HealthStatus {
  /** Overall health state */
  status: 'healthy' | 'degraded' | 'unhealthy';

  /** Human-readable message */
  message?: string;

  /** Individual check results */
  checks: HealthCheck[];

  /** When health was last checked */
  checkedAt: Date;
}

/**
 * Individual health check result
 */
export interface HealthCheck {
  /** Check name */
  name: string;

  /** Check status */
  status: 'pass' | 'warn' | 'fail';

  /** Optional message */
  message?: string;

  /** Check-specific data */
  data?: Record<string, unknown>;
}

/**
 * Enhanced channel plugin interface
 *
 * Channels should extend BaseChannelPlugin rather than implementing
 * this interface directly, to get automatic event helper methods.
 */
export interface ChannelPlugin {
  // ─────────────────────────────────────────────────────────────
  // Identity
  // ─────────────────────────────────────────────────────────────

  /**
   * Unique identifier for this plugin (must match a ChannelType)
   * Example: 'whatsapp-baileys', 'discord', 'slack'
   */
  readonly id: ChannelType;

  /**
   * Human-readable name for display
   * Example: 'WhatsApp (Baileys)', 'Discord Bot'
   */
  readonly name: string;

  /**
   * Plugin version (semver)
   * Example: '1.0.0'
   */
  readonly version: string;

  /**
   * Declared capabilities of this channel
   */
  readonly capabilities: ChannelCapabilities;

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────

  /**
   * Initialize the plugin with dependencies
   *
   * Called once when the plugin is loaded. Use this to:
   * - Store references to eventBus, logger, etc.
   * - Set up any shared resources
   * - Register event handlers
   *
   * Do NOT connect to external services here - that happens in connect()
   */
  initialize(context: PluginContext): Promise<void>;

  /**
   * Destroy the plugin and release all resources
   *
   * Called when the platform is shutting down. Use this to:
   * - Disconnect all instances
   * - Clean up resources
   * - Flush any pending operations
   */
  destroy(): Promise<void>;

  // ─────────────────────────────────────────────────────────────
  // Instance Management
  // ─────────────────────────────────────────────────────────────

  /**
   * Connect a new instance
   *
   * Called to establish a connection for a specific instance.
   * Should emit instance.connected or instance.qr_code events.
   *
   * @param instanceId - Unique identifier for this instance
   * @param config - Configuration including credentials
   */
  connect(instanceId: string, config: InstanceConfig): Promise<void>;

  /**
   * Disconnect an instance
   *
   * Called to gracefully disconnect. Should emit instance.disconnected.
   *
   * @param instanceId - Instance to disconnect
   */
  disconnect(instanceId: string): Promise<void>;

  /**
   * Get the current connection status of an instance
   *
   * @param instanceId - Instance to check
   * @returns Current connection status
   */
  getStatus(instanceId: string): Promise<ConnectionStatus>;

  /**
   * Get all connected instance IDs
   */
  getConnectedInstances(): string[];

  // ─────────────────────────────────────────────────────────────
  // Messaging
  // ─────────────────────────────────────────────────────────────

  /**
   * Send a message through the channel
   *
   * Should emit message.sent on success or message.failed on failure.
   *
   * @param instanceId - Instance to send from
   * @param message - Message to send
   * @returns Send result with message ID or error
   */
  sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult>;

  /**
   * Create a stream sender for partial response updates
   *
   * Optional - only implement if canStreamResponse capability is true.
   */
  createStreamSender?(
    instanceId: string,
    chatId: string,
    replyToMessageId?: string,
    chatType?: 'dm' | 'group' | 'channel',
    options?: { formatMode?: 'convert' | 'passthrough' },
  ): StreamSender;

  /**
   * Send typing indicator
   *
   * Optional - only implement if canSendTyping capability is true.
   *
   * @param instanceId - Instance to send from
   * @param chatId - Chat to show typing in
   * @param duration - How long to show typing (ms), 0 to stop
   */
  sendTyping?(instanceId: string, chatId: string, duration?: number): Promise<void>;

  /**
   * Mark messages as read
   *
   * Optional - only implement if canReceiveReadReceipts capability is true.
   * Sends read receipts for the specified messages.
   *
   * @param instanceId - Instance to mark messages read for
   * @param chatId - Chat ID containing the messages
   * @param messageIds - Array of message IDs to mark as read, or ['all'] to mark entire chat
   * @param messageData - Optional message records from DB (plugins use these to build channel-specific keys)
   */
  markAsRead?(
    instanceId: string,
    chatId: string,
    messageIds: string[],
    messageData?: Array<{ externalId: string; rawPayload?: Record<string, unknown> | null }>,
  ): Promise<void>;

  /**
   * Mark entire chat as read
   *
   * Optional - convenience method to mark all messages in a chat as read.
   * If not implemented, markAsRead with ['all'] will be used.
   *
   * @param instanceId - Instance to mark chat read for
   * @param chatId - Chat ID to mark as read
   */
  markChatAsRead?(instanceId: string, chatId: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────
  // Profile & Contacts (Optional)
  // ─────────────────────────────────────────────────────────────

  /**
   * Get the profile of the connected account
   *
   * Optional - implement to support profile sync.
   *
   * @param instanceId - Instance to get profile for
   * @returns Profile information
   */
  getProfile?(instanceId: string): Promise<{
    name?: string;
    avatarUrl?: string;
    bio?: string;
    ownerIdentifier?: string;
    platformMetadata: Record<string, unknown>;
  }>;

  /**
   * Fetch profile for a specific user
   *
   * Optional - implement to support user profile lookup.
   *
   * @param instanceId - Instance to use
   * @param userId - User ID (platform-specific format)
   * @returns User profile data
   */
  fetchUserProfile?(
    instanceId: string,
    userId: string,
  ): Promise<{
    displayName?: string;
    avatarUrl?: string;
    bio?: string;
    phone?: string;
    platformData?: Record<string, unknown>;
  }>;

  /**
   * Fetch contacts for an instance
   *
   * Optional - implement to support contacts listing.
   *
   * @param instanceId - Instance to fetch contacts for
   * @param options - Platform-specific options (e.g., guildId for Discord)
   * @returns Contacts list with metadata
   */
  fetchContacts?(
    instanceId: string,
    options: Record<string, unknown>,
  ): Promise<{
    totalFetched: number;
    contacts: Array<{
      platformUserId: string;
      name?: string;
      phone?: string;
      profilePicUrl?: string;
      isGroup: boolean;
      isBusiness?: boolean;
      metadata?: Record<string, unknown>;
    }>;
  }>;

  /**
   * Fetch groups for an instance
   *
   * Optional - implement to support groups listing.
   *
   * @param instanceId - Instance to fetch groups for
   * @param options - Platform-specific options
   * @returns Groups list with metadata
   */
  fetchGroups?(
    instanceId: string,
    options: Record<string, unknown>,
  ): Promise<{
    totalFetched: number;
    groups: Array<{
      externalId: string;
      name?: string;
      description?: string;
      memberCount?: number;
      createdAt?: Date;
      createdBy?: string;
      isReadOnly?: boolean;
      metadata?: Record<string, unknown>;
    }>;
  }>;

  /**
   * Fetch members of a specific group
   *
   * Optional - implement to support group member listing.
   *
   * @param instanceId - Instance to fetch group members for
   * @param groupJid - Group JID to fetch members from
   * @returns Members list with name and role
   */
  fetchGroupMembers?(
    instanceId: string,
    groupJid: string,
  ): Promise<{
    members: Array<{
      id: string;
      name?: string;
      role?: 'admin' | 'superadmin' | 'member';
    }>;
  }>;

  // ─────────────────────────────────────────────────────────────
  // Health
  // ─────────────────────────────────────────────────────────────

  /**
   * Get the health status of this plugin
   *
   * Called periodically by the health checker. Include checks for:
   * - External service connectivity
   * - Resource usage
   * - Error rates
   */
  getHealth(): Promise<HealthStatus>;

  // ─────────────────────────────────────────────────────────────
  // Webhooks (Optional)
  // ─────────────────────────────────────────────────────────────

  /**
   * Handle an incoming webhook request
   *
   * Optional - implement if the channel uses webhooks for incoming events.
   *
   * @param request - Incoming HTTP request
   * @returns HTTP response to send back
   */
  handleWebhook?(request: Request): Promise<Response>;

  // ─────────────────────────────────────────────────────────────
  // Thread History & Reactions (Optional — per_thread sessions)
  // ─────────────────────────────────────────────────────────────

  /**
   * Fetch message history for a channel or thread.
   *
   * Required for per_thread collaboration sessions. Implement to allow the
   * dispatcher to fetch history on first activation and inject it as context.
   *
   * @param instanceId - Instance to fetch history for
   * @param options - Fetch options including channelId and threadId
   * @returns Fetched messages in standardized format
   */
  fetchHistory?(instanceId: string, options: FetchHistoryOptions): Promise<FetchHistoryResult>;

  /**
   * Add a reaction emoji to a message.
   *
   * Used for per_thread media processing feedback (👀/🎧 → ✅).
   * Graceful skip: channels without reaction support should not implement this.
   *
   * @param instanceId - Instance to react from
   * @param chatId - Channel/chat ID containing the message
   * @param messageId - Message to react to (platform-specific ID)
   * @param emoji - Emoji to react with (e.g. '👀', '✅')
   */
  react?(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void>;

  /**
   * Remove a reaction emoji from a message.
   *
   * Counterpart to react(). Used to replace the start emoji (👀/🎧) with ✅.
   *
   * @param instanceId - Instance to unreact from
   * @param chatId - Channel/chat ID containing the message
   * @param messageId - Message to remove reaction from
   * @param emoji - Emoji to remove
   */
  unreact?(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void>;
}
