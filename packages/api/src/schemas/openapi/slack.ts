/**
 * OpenAPI schemas for the Slack one-click OAuth install
 * (wish: slack-personal-oauth, Group 4).
 *
 * Four operations: the deployment app status, the authenticated start, the
 * PUBLIC callback Slack redirects the browser to, and the single-use result
 * the dashboard and CLI read. The callback is documented with `security: []`
 * and fixed responses: its redirect carries only `?slack=<nonce>`, and its
 * pages carry no instance id, name, tenant or connection state.
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema } from './common';

export const SlackAppStatusSchema = z
  .object({
    configured: z.boolean().openapi({ description: 'True when every Slack app setting resolves (settings or env)' }),
    missing: z.array(z.string()).openapi({
      description: 'Settings keys still unset, e.g. slack.app.client_id, server.public_url',
    }),
    redirectUrl: z
      .string()
      .nullable()
      .openapi({ description: 'server.public_url + /api/v2/slack/oauth/callback; null until the public URL is set' }),
    manifestUrl: z.string().nullable().openapi({
      description:
        'Pre-filled https://api.slack.com/apps?new_app=1&manifest_json=… link; null until the public URL is set',
    }),
  })
  .openapi('SlackAppStatus');

export const SlackOAuthStartBodySchema = z
  .object({
    mode: z
      .enum(['user', 'bot'])
      .optional()
      .openapi({ description: "Act as the authorizing person ('user', default) or as the workspace bot" }),
    entry: z.enum(['ui', 'cli']).openapi({
      description:
        'Who is waiting: the dashboard (callback redirects to returnTo) or a terminal (callback renders a page)',
    }),
    returnTo: z.string().optional().openapi({
      description:
        'Where the dashboard resumes after Slack: a path beginning with "/" or a URL on server.public_url, without query or fragment',
    }),
  })
  .openapi('SlackOAuthStartBody');

export const SlackOAuthStartSchema = z
  .object({
    authorizeUrl: z.string().openapi({ description: 'https://slack.com/oauth/v2/authorize?… to open in a browser' }),
    nonce: z
      .string()
      .openapi({ description: 'Handle for GET /slack/oauth/result/{nonce}; also the callback redirect query' }),
    expiresAt: z.string().datetime().openapi({ description: 'When the pending install expires' }),
  })
  .openapi('SlackOAuthStart');

export const SlackOAuthResultSchema = z
  .discriminatedUnion('status', [
    z.object({ status: z.literal('pending') }),
    z.object({ status: z.literal('done'), instanceId: z.string().uuid() }),
    z.object({ status: z.literal('error'), code: z.string(), message: z.string() }),
  ])
  .openapi('SlackOAuthResult', {
    description: 'Single-use: `done` and `error` are returned once; afterwards (and for unknown nonces) `pending`',
  });

const SlackAppNotConfiguredSchema = z.object({
  error: z.object({
    code: z.literal('SLACK_APP_NOT_CONFIGURED'),
    message: z.string(),
    details: z.object({ missing: z.array(z.string()) }),
  }),
});

export function registerSlackSchemas(registry: OpenAPIRegistry): void {
  registry.register('SlackAppStatus', SlackAppStatusSchema);
  registry.register('SlackOAuthStartBody', SlackOAuthStartBodySchema);
  registry.register('SlackOAuthStart', SlackOAuthStartSchema);
  registry.register('SlackOAuthResult', SlackOAuthResultSchema);

  registry.registerPath({
    method: 'get',
    path: '/slack/app',
    operationId: 'getSlackAppStatus',
    tags: ['Instances'],
    summary: 'Slack app configuration status',
    description:
      'Whether the deployment-wide Slack app is configured, which settings are missing, and the redirect and ' +
      'manifest URLs an operator needs to create it. Scope: `instances:read`.',
    responses: {
      200: {
        description: 'Slack app status',
        content: { 'application/json': { schema: SlackAppStatusSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/slack/oauth/start',
    operationId: 'startSlackOAuth',
    tags: ['Instances'],
    summary: 'Start a Slack OAuth install',
    description:
      'Issues a signed state bound to a server-side pending record that carries this request’s tenant, and ' +
      'returns the Slack authorize URL to open. Scope: `instances:write`.',
    request: {
      body: { content: { 'application/json': { schema: SlackOAuthStartBodySchema } } },
    },
    responses: {
      200: {
        description: 'Authorize URL and result nonce',
        content: { 'application/json': { schema: SlackOAuthStartSchema } },
      },
      400: { description: 'Invalid body or returnTo', content: { 'application/json': { schema: ErrorSchema } } },
      409: {
        description: 'Slack app not configured; `details.missing` names every unset setting key',
        content: { 'application/json': { schema: SlackAppNotConfiguredSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/slack/oauth/callback',
    operationId: 'slackOAuthCallback',
    tags: ['Instances'],
    summary: 'Slack OAuth redirect target (public)',
    description:
      'Slack redirects the browser here after authorization. Unauthenticated by contract and rate-limited by IP: ' +
      'the state is HMAC-verified, the pending record is consumed before any Slack call, the tenant comes from ' +
      'that record only, and the response never carries an instance id, name, tenant or connection state.',
    security: [],
    request: {
      query: z.object({
        code: z.string().optional().openapi({ description: 'Authorization code from Slack' }),
        state: z.string().openapi({ description: 'The signed state issued by POST /slack/oauth/start' }),
        error: z.string().optional().openapi({ description: 'Set by Slack when the person cancelled (access_denied)' }),
      }),
    },
    responses: {
      302: {
        description: 'Dashboard entry: redirect to returnTo with the query string exactly `?slack=<nonce>`',
        headers: z.object({ Location: z.string() }),
      },
      200: {
        description: 'CLI entry: fixed "return to your terminal" page',
        content: { 'text/html': { schema: z.string() } },
      },
      400: {
        description:
          'Missing, tampered, expired, replayed or unknown state; disallowed returnTo. Fixed page, no Slack call',
        content: { 'text/html': { schema: z.string() } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/slack/oauth/result/{nonce}',
    operationId: 'getSlackOAuthResult',
    tags: ['Instances'],
    summary: 'Read a Slack OAuth install outcome',
    description:
      'Single-use outcome for the nonce POST /slack/oauth/start returned. `done` carries the instance id; ' +
      '`error` carries a code such as SLACK_ACCESS_DENIED or SLACK_ENTERPRISE_INSTALL_UNSUPPORTED. Scope: `instances:read`.',
    request: { params: z.object({ nonce: z.string() }) },
    responses: {
      200: {
        description: 'Outcome',
        content: { 'application/json': { schema: SlackOAuthResultSchema } },
      },
      400: { description: 'Malformed nonce', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });
}
