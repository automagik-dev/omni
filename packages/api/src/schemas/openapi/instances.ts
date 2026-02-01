/**
 * OpenAPI schemas for instance endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { ChannelTypeSchema } from '@omni/core';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema, PaginationMetaSchema, SuccessSchema } from './common';

/**
 * Instance response schema
 */
export const InstanceSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Instance UUID' }),
  name: z.string().openapi({ description: 'Instance name' }),
  channel: ChannelTypeSchema.openapi({ description: 'Channel type' }),
  isActive: z.boolean().openapi({ description: 'Whether instance is active' }),
  isDefault: z.boolean().openapi({ description: 'Whether this is the default instance for channel' }),
  profileName: z.string().nullable().openapi({ description: 'Connected profile name' }),
  profilePicUrl: z.string().nullable().openapi({ description: 'Profile picture URL' }),
  ownerIdentifier: z.string().nullable().openapi({ description: 'Owner identifier' }),
  agentProviderId: z.string().uuid().nullable().openapi({ description: 'Agent provider UUID' }),
  agentId: z.string().nullable().openapi({ description: 'Agent ID' }),
  agentTimeout: z.number().openapi({ description: 'Agent timeout in seconds' }),
  agentStreamMode: z.boolean().openapi({ description: 'Whether streaming is enabled' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
});

/**
 * Create instance request schema
 */
export const CreateInstanceSchema = z.object({
  name: z.string().min(1).max(255).openapi({ description: 'Unique name for the instance' }),
  channel: ChannelTypeSchema.openapi({ description: 'Channel type' }),
  agentProviderId: z.string().uuid().optional().openapi({ description: 'Reference to agent provider' }),
  agentId: z.string().max(255).default('default').openapi({ description: 'Agent ID within the provider' }),
  agentTimeout: z.number().int().positive().default(60).openapi({ description: 'Agent timeout in seconds' }),
  agentStreamMode: z.boolean().default(false).openapi({ description: 'Enable streaming responses' }),
  isDefault: z.boolean().default(false).openapi({ description: 'Set as default instance for channel' }),
  token: z.string().optional().openapi({ description: 'Bot token for Discord instances' }),
});

/**
 * Instance status response schema
 */
export const InstanceStatusSchema = z.object({
  instanceId: z.string().uuid().openapi({ description: 'Instance UUID' }),
  state: z.string().openapi({ description: 'Connection state' }),
  isConnected: z.boolean().openapi({ description: 'Whether instance is connected' }),
  connectedAt: z.string().datetime().nullable().openapi({ description: 'When connected' }),
  profileName: z.string().nullable().openapi({ description: 'Profile name' }),
  profilePicUrl: z.string().nullable().openapi({ description: 'Profile picture URL' }),
  ownerIdentifier: z.string().nullable().openapi({ description: 'Owner identifier' }),
  message: z.string().optional().openapi({ description: 'Status message' }),
});

/**
 * QR code response schema
 */
export const QrCodeSchema = z.object({
  qr: z.string().nullable().openapi({ description: 'QR code string' }),
  expiresAt: z.string().datetime().nullable().openapi({ description: 'QR code expiration' }),
  message: z.string().openapi({ description: 'Status message' }),
});

/**
 * Pairing code request schema
 */
export const PairingCodeRequestSchema = z.object({
  phoneNumber: z.string().min(10).max(20).openapi({ description: 'Phone number in international format' }),
});

/**
 * Pairing code response schema
 */
export const PairingCodeSchema = z.object({
  code: z.string().openapi({ description: 'Pairing code to enter on phone' }),
  phoneNumber: z.string().openapi({ description: 'Masked phone number' }),
  message: z.string().openapi({ description: 'Instructions for user' }),
  expiresIn: z.number().openapi({ description: 'Seconds until code expires' }),
});

/**
 * Connect instance request schema
 */
export const ConnectInstanceSchema = z.object({
  token: z.string().optional().openapi({ description: 'Bot token for Discord instances' }),
  forceNewQr: z.boolean().optional().openapi({ description: 'Force new QR code for WhatsApp' }),
});

/**
 * Connect instance response schema
 */
export const ConnectResponseSchema = z.object({
  instanceId: z.string().uuid().openapi({ description: 'Instance UUID' }),
  status: z.string().openapi({ description: 'Connection status' }),
  message: z.string().openapi({ description: 'Status message' }),
});

/**
 * Supported channel schema
 */
export const SupportedChannelSchema = z.object({
  id: ChannelTypeSchema.openapi({ description: 'Channel type ID' }),
  name: z.string().openapi({ description: 'Human-readable channel name' }),
  version: z.string().optional().openapi({ description: 'Plugin version' }),
  description: z.string().optional().openapi({ description: 'Channel description' }),
  loaded: z.boolean().openapi({ description: 'Whether plugin is loaded' }),
  capabilities: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Plugin capabilities' }),
});

/**
 * Register instance schemas and paths with the given registry
 */
export function registerInstanceSchemas(registry: OpenAPIRegistry): void {
  registry.register('Instance', InstanceSchema);
  registry.register('CreateInstanceRequest', CreateInstanceSchema);
  registry.register('InstanceStatus', InstanceStatusSchema);
  registry.register('QrCode', QrCodeSchema);
  registry.register('PairingCodeRequest', PairingCodeRequestSchema);
  registry.register('PairingCode', PairingCodeSchema);
  registry.register('ConnectInstanceRequest', ConnectInstanceSchema);
  registry.register('ConnectResponse', ConnectResponseSchema);
  registry.register('SupportedChannel', SupportedChannelSchema);

  // Register paths
  registry.registerPath({
    method: 'get',
    path: '/instances',
    tags: ['Instances'],
    summary: 'List all instances',
    description: 'Get a paginated list of channel instances with optional filtering.',
    request: {
      query: z.object({
        channel: z.string().optional().openapi({ description: 'Filter by channel types (comma-separated)' }),
        status: z.string().optional().openapi({ description: 'Filter by status (active,inactive)' }),
        limit: z.number().int().min(1).max(100).default(50).openapi({ description: 'Maximum items to return' }),
        cursor: z.string().optional().openapi({ description: 'Pagination cursor' }),
      }),
    },
    responses: {
      200: {
        description: 'List of instances',
        content: {
          'application/json': {
            schema: z.object({
              items: z.array(InstanceSchema),
              meta: PaginationMetaSchema,
            }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/instances/supported-channels',
    tags: ['Instances'],
    summary: 'List supported channel types',
    description: 'Get a list of all supported channel types with their capabilities.',
    responses: {
      200: {
        description: 'List of supported channels',
        content: {
          'application/json': {
            schema: z.object({
              items: z.array(SupportedChannelSchema),
            }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/instances/{id}',
    tags: ['Instances'],
    summary: 'Get instance by ID',
    description: 'Get details of a specific channel instance.',
    request: {
      params: z.object({
        id: z.string().uuid().openapi({ description: 'Instance UUID' }),
      }),
    },
    responses: {
      200: {
        description: 'Instance details',
        content: {
          'application/json': {
            schema: z.object({ data: InstanceSchema }),
          },
        },
      },
      404: {
        description: 'Instance not found',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/instances',
    tags: ['Instances'],
    summary: 'Create new instance',
    description: 'Create a new channel instance. For Discord, a bot token is required.',
    request: {
      body: {
        content: {
          'application/json': { schema: CreateInstanceSchema },
        },
      },
    },
    responses: {
      201: {
        description: 'Instance created',
        content: {
          'application/json': {
            schema: z.object({ data: InstanceSchema }),
          },
        },
      },
      400: {
        description: 'Validation error',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/instances/{id}',
    tags: ['Instances'],
    summary: 'Update instance',
    description: 'Update an existing channel instance.',
    request: {
      params: z.object({
        id: z.string().uuid().openapi({ description: 'Instance UUID' }),
      }),
      body: {
        content: {
          'application/json': { schema: CreateInstanceSchema.partial() },
        },
      },
    },
    responses: {
      200: {
        description: 'Instance updated',
        content: {
          'application/json': {
            schema: z.object({ data: InstanceSchema }),
          },
        },
      },
      404: {
        description: 'Instance not found',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/instances/{id}',
    tags: ['Instances'],
    summary: 'Delete instance',
    description: 'Delete a channel instance. This will disconnect the instance first.',
    request: {
      params: z.object({
        id: z.string().uuid().openapi({ description: 'Instance UUID' }),
      }),
    },
    responses: {
      200: {
        description: 'Instance deleted',
        content: {
          'application/json': { schema: SuccessSchema },
        },
      },
      404: {
        description: 'Instance not found',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/instances/{id}/status',
    tags: ['Instances'],
    summary: 'Get instance connection status',
    description: 'Get the current connection status of a channel instance.',
    request: {
      params: z.object({
        id: z.string().uuid().openapi({ description: 'Instance UUID' }),
      }),
    },
    responses: {
      200: {
        description: 'Instance status',
        content: {
          'application/json': {
            schema: z.object({ data: InstanceStatusSchema }),
          },
        },
      },
      404: {
        description: 'Instance not found',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/instances/{id}/qr',
    tags: ['Instances'],
    summary: 'Get QR code for WhatsApp connection',
    description: 'Get the QR code for connecting a WhatsApp instance.',
    request: {
      params: z.object({
        id: z.string().uuid().openapi({ description: 'Instance UUID' }),
      }),
    },
    responses: {
      200: {
        description: 'QR code data',
        content: {
          'application/json': {
            schema: z.object({ data: QrCodeSchema }),
          },
        },
      },
      400: {
        description: 'Not a WhatsApp instance',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
      404: {
        description: 'Instance not found',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/instances/{id}/pair',
    tags: ['Instances'],
    summary: 'Request pairing code',
    description: 'Request a pairing code as an alternative to QR code scanning.',
    request: {
      params: z.object({
        id: z.string().uuid().openapi({ description: 'Instance UUID' }),
      }),
      body: {
        content: {
          'application/json': { schema: PairingCodeRequestSchema },
        },
      },
    },
    responses: {
      200: {
        description: 'Pairing code generated',
        content: {
          'application/json': {
            schema: z.object({ data: PairingCodeSchema }),
          },
        },
      },
      400: {
        description: 'Invalid operation',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
      404: {
        description: 'Instance not found',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/instances/{id}/connect',
    tags: ['Instances'],
    summary: 'Connect instance',
    description: 'Initiate connection for a channel instance.',
    request: {
      params: z.object({
        id: z.string().uuid().openapi({ description: 'Instance UUID' }),
      }),
      query: z.object({
        forceNewQr: z.string().optional().openapi({ description: 'Force new QR code (deprecated, use body)' }),
      }),
      body: {
        content: {
          'application/json': { schema: ConnectInstanceSchema },
        },
      },
    },
    responses: {
      200: {
        description: 'Connection initiated',
        content: {
          'application/json': {
            schema: z.object({ data: ConnectResponseSchema }),
          },
        },
      },
      400: {
        description: 'Plugin not found',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
      404: {
        description: 'Instance not found',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/instances/{id}/disconnect',
    tags: ['Instances'],
    summary: 'Disconnect instance',
    description: 'Disconnect a channel instance while preserving session data.',
    request: {
      params: z.object({
        id: z.string().uuid().openapi({ description: 'Instance UUID' }),
      }),
    },
    responses: {
      200: {
        description: 'Instance disconnected',
        content: {
          'application/json': { schema: SuccessSchema },
        },
      },
      404: {
        description: 'Instance not found',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/instances/{id}/restart',
    tags: ['Instances'],
    summary: 'Restart instance',
    description: 'Restart a channel instance by disconnecting and reconnecting.',
    request: {
      params: z.object({
        id: z.string().uuid().openapi({ description: 'Instance UUID' }),
      }),
      query: z.object({
        forceNewQr: z.string().optional().openapi({ description: 'Force new QR code for re-authentication' }),
      }),
    },
    responses: {
      200: {
        description: 'Restart initiated',
        content: {
          'application/json': {
            schema: z.object({ data: ConnectResponseSchema }),
          },
        },
      },
      400: {
        description: 'Plugin not found',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
      404: {
        description: 'Instance not found',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/instances/{id}/logout',
    tags: ['Instances'],
    summary: 'Logout instance',
    description: 'Logout a channel instance, clearing all session data.',
    request: {
      params: z.object({
        id: z.string().uuid().openapi({ description: 'Instance UUID' }),
      }),
    },
    responses: {
      200: {
        description: 'Session cleared',
        content: {
          'application/json': { schema: SuccessSchema },
        },
      },
      404: {
        description: 'Instance not found',
        content: {
          'application/json': { schema: ErrorSchema },
        },
      },
    },
  });
}
