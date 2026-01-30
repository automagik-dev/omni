/**
 * tRPC context
 */

import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import type { Services } from '../services';

/**
 * Context available to all tRPC procedures
 */
export interface TrpcContext {
  db: Database;
  eventBus: EventBus | null;
  services: Services;
  apiKey: {
    id: string;
    name: string;
    scopes: string[];
    instanceIds: string[] | null;
  } | null;
  requestId: string;
}

/**
 * Create tRPC context from request
 */
export type CreateContextOptions = {
  db: Database;
  eventBus: EventBus | null;
  services: Services;
};

export function createTrpcContext(options: CreateContextOptions) {
  return async (opts: FetchCreateContextFnOptions): Promise<TrpcContext> => {
    const { req } = opts;

    // Extract API key from header
    const apiKeyHeader = req.headers.get('x-api-key');

    // For now, simple validation - will be replaced with database lookup
    const apiKey =
      apiKeyHeader === 'test-key' || apiKeyHeader?.startsWith('omni_sk_')
        ? {
            id: 'test-key-id',
            name: 'Test Key',
            scopes: ['*'],
            instanceIds: null,
          }
        : null;

    // Generate request ID
    const requestId =
      req.headers.get('x-request-id') ?? `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;

    return {
      db: options.db,
      eventBus: options.eventBus,
      services: options.services,
      apiKey,
      requestId,
    };
  };
}
