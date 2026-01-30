/**
 * OpenAPI spec and Swagger UI routes
 */

import { swaggerUI } from '@hono/swagger-ui';
import { Hono } from 'hono';
import type { AppVariables } from '../types';

const VERSION = '2.0.0';

const openapiRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * OpenAPI 3.1 specification
 */
const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Omni v2 API',
    version: VERSION,
    description: `
Omni v2 is a universal event-driven omnichannel platform API.

## Authentication

All API requests require an API key passed via the \`x-api-key\` header:

\`\`\`
x-api-key: omni_sk_your_key_here
\`\`\`

## Rate Limiting

- Messages: 60 requests/minute
- Events: 100 requests/minute
- Instances: 30 requests/minute
- General: 1000 requests/minute

Rate limit headers are included in responses:
- \`X-RateLimit-Limit\`: Max requests per window
- \`X-RateLimit-Remaining\`: Requests remaining
- \`X-RateLimit-Reset\`: Unix timestamp when limit resets

## Pagination

List endpoints use cursor-based pagination:

\`\`\`
GET /api/v2/events?limit=50&cursor=abc123
\`\`\`

Response includes \`meta.hasMore\` and \`meta.cursor\` for next page.
    `.trim(),
    contact: {
      name: 'Omni Support',
    },
    license: {
      name: 'MIT',
    },
  },
  servers: [
    {
      url: '/api/v2',
      description: 'v2 API',
    },
  ],
  security: [
    {
      ApiKeyAuth: [],
    },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'API key for authentication',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Error code' },
              message: { type: 'string', description: 'Error message' },
              details: { type: 'object', description: 'Additional error details' },
            },
            required: ['code', 'message'],
          },
        },
      },
      Instance: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          channel: { type: 'string', enum: ['whatsapp-baileys', 'whatsapp-cloud', 'discord', 'slack', 'telegram'] },
          isActive: { type: 'boolean' },
          profileName: { type: 'string', nullable: true },
          profilePicUrl: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Person: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          displayName: { type: 'string', nullable: true },
          primaryPhone: { type: 'string', nullable: true },
          primaryEmail: { type: 'string', nullable: true },
          avatarUrl: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Event: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          eventType: { type: 'string' },
          channel: { type: 'string' },
          contentType: { type: 'string', nullable: true },
          direction: { type: 'string', enum: ['inbound', 'outbound'] },
          textContent: { type: 'string', nullable: true },
          receivedAt: { type: 'string', format: 'date-time' },
        },
      },
      AccessRule: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          ruleType: { type: 'string', enum: ['allow', 'deny'] },
          instanceId: { type: 'string', format: 'uuid', nullable: true },
          phonePattern: { type: 'string', nullable: true },
          platformUserId: { type: 'string', nullable: true },
          priority: { type: 'integer' },
          enabled: { type: 'boolean' },
        },
      },
      Setting: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          key: { type: 'string' },
          value: { type: 'string', nullable: true },
          valueType: { type: 'string', enum: ['string', 'integer', 'boolean', 'json', 'secret'] },
          category: { type: 'string', nullable: true },
          description: { type: 'string', nullable: true },
          isSecret: { type: 'boolean' },
        },
      },
      Provider: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          schema: { type: 'string', enum: ['openai', 'anthropic', 'agno', 'custom'] },
          baseUrl: { type: 'string' },
          isActive: { type: 'boolean' },
          supportsStreaming: { type: 'boolean' },
          supportsImages: { type: 'boolean' },
          supportsAudio: { type: 'boolean' },
        },
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
          version: { type: 'string' },
          uptime: { type: 'integer' },
          timestamp: { type: 'string', format: 'date-time' },
          checks: {
            type: 'object',
            properties: {
              database: { type: 'object' },
              nats: { type: 'object' },
            },
          },
        },
      },
      PaginationMeta: {
        type: 'object',
        properties: {
          hasMore: { type: 'boolean' },
          cursor: { type: 'string', nullable: true },
          total: { type: 'integer', nullable: true },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: 'Authentication required',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      NotFound: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      ValidationError: {
        description: 'Validation error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        tags: ['System'],
        security: [],
        responses: {
          200: {
            description: 'System is healthy',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
          503: {
            description: 'System is unhealthy',
          },
        },
      },
    },
    '/instances': {
      get: {
        summary: 'List instances',
        tags: ['Instances'],
        parameters: [
          {
            name: 'channel',
            in: 'query',
            schema: { type: 'string' },
            description: 'Filter by channel (comma-separated)',
          },
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string' },
            description: 'Filter by status (active,inactive)',
          },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'List of instances',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/Instance' } },
                    meta: { $ref: '#/components/schemas/PaginationMeta' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create instance',
        tags: ['Instances'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'channel'],
                properties: {
                  name: { type: 'string' },
                  channel: {
                    type: 'string',
                    enum: ['whatsapp-baileys', 'whatsapp-cloud', 'discord', 'slack', 'telegram'],
                  },
                  agentProviderId: { type: 'string', format: 'uuid' },
                  agentId: { type: 'string', default: 'default' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Instance created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { data: { $ref: '#/components/schemas/Instance' } },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/ValidationError' },
        },
      },
    },
    '/instances/{id}': {
      get: {
        summary: 'Get instance',
        tags: ['Instances'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: {
            description: 'Instance details',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Instance' } } },
              },
            },
          },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      patch: {
        summary: 'Update instance',
        tags: ['Instances'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
        responses: {
          200: { description: 'Instance updated' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        summary: 'Delete instance',
        tags: ['Instances'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Instance deleted' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/messages': {
      post: {
        summary: 'Send text message',
        tags: ['Messages'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['instanceId', 'to', 'text'],
                properties: {
                  instanceId: { type: 'string', format: 'uuid' },
                  to: { type: 'string' },
                  text: { type: 'string' },
                  replyTo: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Message sent' },
          400: { $ref: '#/components/responses/ValidationError' },
        },
      },
    },
    '/events': {
      get: {
        summary: 'List events',
        tags: ['Events'],
        parameters: [
          { name: 'channel', in: 'query', schema: { type: 'string' } },
          { name: 'instanceId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'eventType', in: 'query', schema: { type: 'string' } },
          { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'until', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'List of events',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/Event' } },
                    meta: { $ref: '#/components/schemas/PaginationMeta' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/persons': {
      get: {
        summary: 'Search persons',
        tags: ['Persons'],
        parameters: [
          { name: 'search', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: {
            description: 'List of persons',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/Person' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/access/rules': {
      get: {
        summary: 'List access rules',
        tags: ['Access'],
        parameters: [
          { name: 'instanceId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['allow', 'deny'] } },
        ],
        responses: {
          200: {
            description: 'List of access rules',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/AccessRule' } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create access rule',
        tags: ['Access'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ruleType'],
                properties: {
                  instanceId: { type: 'string', format: 'uuid' },
                  ruleType: { type: 'string', enum: ['allow', 'deny'] },
                  phonePattern: { type: 'string' },
                  platformUserId: { type: 'string' },
                  priority: { type: 'integer', default: 0 },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Rule created' },
        },
      },
    },
    '/settings': {
      get: {
        summary: 'List settings',
        tags: ['Settings'],
        parameters: [{ name: 'category', in: 'query', schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'List of settings',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/Setting' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/providers': {
      get: {
        summary: 'List providers',
        tags: ['Providers'],
        parameters: [{ name: 'active', in: 'query', schema: { type: 'boolean' } }],
        responses: {
          200: {
            description: 'List of providers',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/Provider' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  tags: [
    { name: 'System', description: 'System health and info' },
    { name: 'Instances', description: 'Channel instance management' },
    { name: 'Messages', description: 'Send messages' },
    { name: 'Events', description: 'Message events/traces' },
    { name: 'Persons', description: 'Identity management' },
    { name: 'Access', description: 'Access control rules' },
    { name: 'Settings', description: 'Global settings' },
    { name: 'Providers', description: 'Agent providers' },
  ],
};

/**
 * GET /openapi.json - OpenAPI specification
 */
openapiRoutes.get('/openapi.json', (c) => {
  return c.json(openApiSpec);
});

/**
 * GET /docs - Swagger UI
 */
openapiRoutes.get(
  '/docs',
  swaggerUI({
    url: '/api/v2/openapi.json',
    // @ts-ignore - docExpansion is valid
    docExpansion: 'list',
  }),
);

export { openapiRoutes, openApiSpec };
