/**
 * API type definitions
 */

import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
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
}

/**
 * Variables available in Hono context
 */
export interface AppVariables {
  db: Database;
  eventBus: EventBus | null;
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

/**
 * Success response
 */
export interface SuccessResponse<T = void> {
  success: true;
  data?: T;
}
