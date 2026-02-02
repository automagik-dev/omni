/**
 * OpenAPI configuration
 *
 * Provides OpenAPI info, security schemes, and tags.
 * The registry is created in routes/openapi.ts to avoid initialization order issues.
 */

/**
 * OpenAPI info
 */
export const openApiInfo = {
  title: 'Omni v2 API',
  version: '2.0.0',
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
};

/**
 * Common OpenAPI security scheme
 */
export const securitySchemes = {
  ApiKeyAuth: {
    type: 'apiKey' as const,
    in: 'header' as const,
    name: 'x-api-key',
    description: 'API key for authentication',
  },
};

/**
 * Common OpenAPI tags
 */
export const apiTags = [
  { name: 'System', description: 'System health and info' },
  { name: 'Auth', description: 'API key validation' },
  { name: 'Instances', description: 'Channel instance management' },
  { name: 'Messages', description: 'Send messages' },
  { name: 'Events', description: 'Message events/traces' },
  { name: 'Persons', description: 'Identity management' },
  { name: 'Access', description: 'Access control rules' },
  { name: 'Settings', description: 'Global settings' },
  { name: 'Providers', description: 'Agent providers' },
  { name: 'Webhooks', description: 'External webhook management' },
  { name: 'Dead Letters', description: 'Failed event management' },
  { name: 'Metrics', description: 'System metrics and statistics' },
  { name: 'Logs', description: 'Application logs' },
  { name: 'Automations', description: 'Workflow automations' },
  { name: 'Payloads', description: 'Event payload management' },
];
