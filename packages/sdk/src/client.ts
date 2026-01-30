/**
 * Omni SDK Client
 *
 * Type-safe wrapper around the OpenAPI-generated types.
 */

import createClient, { type Middleware } from 'openapi-fetch';
import { OmniApiError, OmniConfigError } from './errors';
import type { components, paths } from './types.generated';

// Re-export schema types for convenience
export type Instance = components['schemas']['Instance'];
export type Person = components['schemas']['Person'];
export type Event = components['schemas']['Event'];
export type AccessRule = components['schemas']['AccessRule'];
export type Setting = components['schemas']['Setting'];
export type Provider = components['schemas']['Provider'];
export type HealthResponse = components['schemas']['HealthResponse'];
export type PaginationMeta = components['schemas']['PaginationMeta'];

// Channel type enum
export type Channel = 'whatsapp-baileys' | 'whatsapp-cloud' | 'discord' | 'slack' | 'telegram';

// Paginated response helper
export interface PaginatedResponse<T> {
  items: T[];
  meta: PaginationMeta;
}

/**
 * Client configuration
 */
export interface OmniClientConfig {
  /** Base URL of the API (e.g., 'http://localhost:8881') */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
}

/**
 * Query parameters for listing instances
 */
export interface ListInstancesParams {
  channel?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Body for creating an instance
 */
export interface CreateInstanceBody {
  name: string;
  channel: Channel;
  agentProviderId?: string;
  agentId?: string;
}

/**
 * Body for sending a message
 */
export interface SendMessageBody {
  instanceId: string;
  to: string;
  text: string;
  replyTo?: string;
}

/**
 * Query parameters for listing events
 */
export interface ListEventsParams {
  channel?: string;
  instanceId?: string;
  eventType?: string;
  since?: string;
  until?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Query parameters for searching persons
 */
export interface SearchPersonsParams {
  search: string;
  limit?: number;
}

/**
 * Query parameters for listing access rules
 */
export interface ListAccessRulesParams {
  instanceId?: string;
  type?: 'allow' | 'deny';
}

/**
 * Body for creating an access rule
 */
export interface CreateAccessRuleBody {
  ruleType: 'allow' | 'deny';
  instanceId?: string;
  phonePattern?: string;
  platformUserId?: string;
  priority?: number;
}

/**
 * Query parameters for listing settings
 */
export interface ListSettingsParams {
  category?: string;
}

/**
 * Query parameters for listing providers
 */
export interface ListProvidersParams {
  active?: boolean;
}

/**
 * Helper to throw API error from response
 */
function throwIfError(response: Response, error: unknown): asserts error is undefined {
  if (!response.ok) {
    throw OmniApiError.from(error, response.status);
  }
}

/**
 * Create an Omni API client
 */
export function createOmniClient(config: OmniClientConfig) {
  if (!config.baseUrl) {
    throw new OmniConfigError('baseUrl is required');
  }
  if (!config.apiKey) {
    throw new OmniConfigError('apiKey is required');
  }

  // Normalize base URL
  const baseUrl = config.baseUrl.replace(/\/$/, '');

  // Auth middleware
  const authMiddleware: Middleware = {
    async onRequest({ request }) {
      request.headers.set('x-api-key', config.apiKey);
      return request;
    },
  };

  // Create openapi-fetch client
  const client = createClient<paths>({ baseUrl: `${baseUrl}/api/v2` });
  client.use(authMiddleware);

  return {
    /**
     * Instance management
     */
    instances: {
      /**
       * List all instances
       */
      async list(params?: ListInstancesParams): Promise<PaginatedResponse<Instance>> {
        const { data, error, response } = await client.GET('/instances', {
          params: { query: params },
        });
        throwIfError(response, error);
        return {
          items: data?.items ?? [],
          meta: data?.meta ?? { hasMore: false },
        };
      },

      /**
       * Get a single instance by ID
       */
      async get(id: string): Promise<Instance> {
        const { data, error, response } = await client.GET('/instances/{id}', {
          params: { path: { id } },
        });
        throwIfError(response, error);
        if (!data?.data) throw new OmniApiError('Instance not found', 'NOT_FOUND', undefined, 404);
        return data.data;
      },

      /**
       * Create a new instance
       */
      async create(body: CreateInstanceBody): Promise<Instance> {
        const { data, error, response } = await client.POST('/instances', { body });
        throwIfError(response, error);
        if (!data?.data)
          throw new OmniApiError('Failed to create instance', 'CREATE_FAILED', undefined, response.status);
        return data.data;
      },

      /**
       * Update an instance
       */
      async update(id: string, body: Partial<Instance>): Promise<void> {
        const { error, response } = await client.PATCH('/instances/{id}', {
          params: { path: { id } },
          body: body as Record<string, never>,
        });
        throwIfError(response, error);
      },

      /**
       * Delete an instance
       */
      async delete(id: string): Promise<void> {
        const { error, response } = await client.DELETE('/instances/{id}', {
          params: { path: { id } },
        });
        throwIfError(response, error);
      },
    },

    /**
     * Message sending
     */
    messages: {
      /**
       * Send a text message
       */
      async send(body: SendMessageBody): Promise<void> {
        const { error, response } = await client.POST('/messages', { body });
        throwIfError(response, error);
      },
    },

    /**
     * Event querying
     */
    events: {
      /**
       * List events with optional filters
       */
      async list(params?: ListEventsParams): Promise<PaginatedResponse<Event>> {
        const { data, error, response } = await client.GET('/events', {
          params: { query: params },
        });
        throwIfError(response, error);
        return {
          items: data?.items ?? [],
          meta: data?.meta ?? { hasMore: false },
        };
      },
    },

    /**
     * Person/identity search
     */
    persons: {
      /**
       * Search for persons
       */
      async search(params: SearchPersonsParams): Promise<Person[]> {
        const { data, error, response } = await client.GET('/persons', {
          params: { query: params },
        });
        throwIfError(response, error);
        return data?.items ?? [];
      },
    },

    /**
     * Access control rules
     */
    access: {
      /**
       * List access rules
       */
      async listRules(params?: ListAccessRulesParams): Promise<AccessRule[]> {
        const { data, error, response } = await client.GET('/access/rules', {
          params: { query: params },
        });
        throwIfError(response, error);
        return data?.items ?? [];
      },

      /**
       * Create an access rule
       */
      async createRule(body: CreateAccessRuleBody): Promise<void> {
        const { error, response } = await client.POST('/access/rules', { body });
        throwIfError(response, error);
      },
    },

    /**
     * Settings management
     */
    settings: {
      /**
       * List settings
       */
      async list(params?: ListSettingsParams): Promise<Setting[]> {
        const { data, error, response } = await client.GET('/settings', {
          params: { query: params },
        });
        throwIfError(response, error);
        return data?.items ?? [];
      },
    },

    /**
     * Provider management
     */
    providers: {
      /**
       * List providers
       */
      async list(params?: ListProvidersParams): Promise<Provider[]> {
        const { data, error, response } = await client.GET('/providers', {
          params: { query: params },
        });
        throwIfError(response, error);
        return data?.items ?? [];
      },
    },

    /**
     * System health
     */
    system: {
      /**
       * Get health status (no auth required)
       */
      async health(): Promise<HealthResponse> {
        // Health endpoint doesn't require auth, use a separate client
        const healthClient = createClient<paths>({ baseUrl: `${baseUrl}/api/v2` });
        const { data, error, response } = await healthClient.GET('/health');
        throwIfError(response, error);
        return data ?? { status: 'unhealthy' };
      },
    },

    /**
     * Raw openapi-fetch client for advanced usage
     */
    raw: client,
  };
}

/**
 * Type for the Omni client
 */
export type OmniClient = ReturnType<typeof createOmniClient>;
