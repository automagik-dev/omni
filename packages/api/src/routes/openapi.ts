/**
 * OpenAPI spec and Swagger UI routes
 *
 * Auto-generates OpenAPI spec from route definitions using the registry pattern.
 */

import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { Hono } from 'hono';
import type { OpenAPIObject } from 'openapi3-ts/oas30';
import { apiTags, openApiInfo, securitySchemes } from '../lib/openapi';
import type { AppVariables } from '../types';

// Import z from zod-openapi to ensure extension happens before schema imports
import '../lib/zod-openapi';

// Create a fresh registry for v7.3.4 API
const registry = new OpenAPIRegistry();

// Register security scheme
registry.registerComponent('securitySchemes', 'ApiKeyAuth', securitySchemes.ApiKeyAuth);

// Import schema registrations to populate the registry
import { registerAccessSchemas } from '../schemas/openapi/access';
import { registerRouteSchemas } from '../schemas/openapi/agent-routes';
import { registerAuthSchemas } from '../schemas/openapi/auth';
import { registerAutomationSchemas } from '../schemas/openapi/automations';
import { registerCommonSchemas } from '../schemas/openapi/common';
import { registerDeadLetterSchemas } from '../schemas/openapi/dead-letters';
import { registerEventOpsSchemas } from '../schemas/openapi/event-ops';
import { registerEventSchemas } from '../schemas/openapi/events';
import { registerHealthSchemas } from '../schemas/openapi/health';
import { registerInstanceSchemas } from '../schemas/openapi/instances';
import { registerJourneySchemas } from '../schemas/openapi/journeys';
import { registerLogSchemas } from '../schemas/openapi/logs';
import { registerMessageSchemas } from '../schemas/openapi/messages';
import { registerMetricsSchemas } from '../schemas/openapi/metrics';
import { registerPayloadSchemas } from '../schemas/openapi/payloads';
import { registerPersonSchemas } from '../schemas/openapi/persons';
import { registerProviderSchemas } from '../schemas/openapi/providers';
import { registerSettingsSchemas } from '../schemas/openapi/settings';
import { registerWebhookSchemas } from '../schemas/openapi/webhooks';

// Register all schemas
registerCommonSchemas(registry);
registerAuthSchemas(registry);
registerHealthSchemas(registry);
registerInstanceSchemas(registry);
registerMessageSchemas(registry);
registerEventSchemas(registry);
registerPersonSchemas(registry);
registerWebhookSchemas(registry);
registerAccessSchemas(registry);
registerSettingsSchemas(registry);
registerProviderSchemas(registry);
registerRouteSchemas(registry);
registerLogSchemas(registry);
registerDeadLetterSchemas(registry);
registerEventOpsSchemas(registry);
registerMetricsSchemas(registry);
registerAutomationSchemas(registry);
registerPayloadSchemas(registry);
registerJourneySchemas(registry);

const openapiRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * Generate OpenAPI spec from registry
 */
function generateOpenApiSpec() {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.3',
    info: openApiInfo,
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
    tags: apiTags,
  });
}

// Generate spec once for export and route handler
export const openApiSpec: OpenAPIObject = generateOpenApiSpec();

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

export { openapiRoutes };
