/**
 * API type definitions
 */

import type { ChannelRegistry } from '@omni/channel-sdk';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import type { ApiKeyProfile, ApiKeyProfileOverrides } from '@omni/db';
import type { Services } from './services';

/**
 * API key data from validation
 */
export interface ApiKeyData {
  id: string;
  name: string;
  scopes: string[];
  instanceIds: string[] | null;
  expiresAt: Date | null;
  /**
   * Profile template applied at key-creation time. `null` for pre-profile
   * (legacy) keys — they keep their hand-authored scopes and treat empty
   * allowlists as "no lock". Profile keys whose template declares a lock in
   * `requiresLocks` treat an empty allowlist as "deny all" instead.
   */
  profile?: ApiKeyProfile | null;
  /** Chats (external ids / JIDs) this key may target. See empty-array semantics above. */
  chatAllowlist?: string[];
  /** Instances this key may target. Separate from `instanceIds` legacy restriction. */
  instanceAllowlist?: string[];
  /** Outbound recipients (platform ids / JIDs) this key may send to. */
  outboundRecipientAllowlist?: string[];
  /**
   * Tenant overrides persisted on the row. Consumed by the output-redactor to
   * resolve the effective denylist preset key and per-key extra patterns.
   */
  profileOverrides?: ApiKeyProfileOverrides | null;
}

/**
 * Variables available in Hono context
 */
export interface AppVariables {
  db: Database;
  eventBus: EventBus | null;
  channelRegistry: ChannelRegistry | null;
  services: Services;
  apiKey?: ApiKeyData;
  requestId: string;
}

/**
 * Health check result
 */
export interface HealthCheck {
  status: 'ok' | 'error';
  latency?: number;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Health response
 */
export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: string;
  checks: {
    database: HealthCheck;
    nats: HealthCheck;
  };
  instances?: {
    total: number;
    connected: number;
    byChannel: Record<string, number>;
  };
}

/**
 * API error response
 */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  items: T[];
  meta: {
    cursor?: string;
    hasMore: boolean;
    total?: number;
  };
}
