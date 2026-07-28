/**
 * Scope definitions for API key authorization.
 *
 * SCOPE_MAP is a table-driven mapping from HTTP method + path pattern
 * to the required scope. The scope-enforcer middleware uses this map
 * to authorize every v2 API request. Routes not in this map are denied
 * by default (deny-by-default).
 */

/**
 * Default scopes granted to turn-scoped agent keys when no explicit scopes are configured.
 */
export const DEFAULT_TURN_SCOPES = ['messages:send', 'turns:close', 'tts:synthesize', 'context:read'] as const;

/**
 * Map of METHOD + path pattern -> required scope.
 *
 * Path patterns use Hono-style segments:
 * - :param matches a single path segment
 * - * matches any remaining path
 *
 * The middleware normalizes the actual request path to match these patterns.
 */
export const SCOPE_MAP: Record<string, string> = {
  // --- a2a discovery ---
  'GET /a2a/agents': 'agents:read',
  'GET /a2a/agents/:agentId/card': 'agents:read',

  // --- access ---
  'GET /access/rules': 'access:read',
  'GET /access/rules/:id': 'access:read',
  'POST /access/rules': 'access:write',
  'PATCH /access/rules/:id': 'access:write',
  'DELETE /access/rules/:id': 'access:write',
  'POST /access/check': 'access:read',

  // --- agent-routes (mounted at root: /instances/:instanceId/routes/...) ---
  'GET /instances/:instanceId/routes': 'routes:read',
  'GET /instances/:instanceId/routes/:id': 'routes:read',
  'POST /instances/:instanceId/routes': 'routes:write',
  'PATCH /instances/:instanceId/routes/:id': 'routes:write',
  'DELETE /instances/:instanceId/routes/:id': 'routes:write',
  'GET /routes/metrics': 'routes:read',

  // --- agent-state ---
  'GET /agent-state/stream': 'agent-state:read',
  'GET /agent-state/:agentId/:chatId': 'agent-state:read',
  'PUT /agent-state/:agentId/:chatId': 'agent-state:write',

  // --- agent-tasks ---
  'GET /agent-tasks': 'agent-tasks:read',
  'POST /agent-tasks': 'agent-tasks:write',
  'GET /agent-tasks/:id': 'agent-tasks:read',
  'PATCH /agent-tasks/:id': 'agent-tasks:write',
  'DELETE /agent-tasks/:id': 'agent-tasks:write',

  // --- agents ---
  'GET /agents': 'agents:read',
  'GET /agents/:id': 'agents:read',
  'POST /agents': 'agents:write',
  'PATCH /agents/:id': 'agents:write',
  'DELETE /agents/:id': 'agents:write',
  'GET /agents/:id/identities': 'agents:read',
  'POST /agents/:id/identities': 'agents:write',
  'GET /agents/:id/tasks': 'agents:read',

  // --- auth ---
  'POST /auth/validate': 'auth:validate',

  // --- automations (mounted at /automations AND root for logs/metrics) ---
  'GET /automations': 'automations:read',
  'GET /automations/:id': 'automations:read',
  'POST /automations': 'automations:write',
  'PATCH /automations/:id': 'automations:write',
  'DELETE /automations/:id': 'automations:write',
  'POST /automations/:id/enable': 'automations:write',
  'POST /automations/:id/disable': 'automations:write',
  'POST /automations/:id/test': 'automations:write',
  'POST /automations/:id/execute': 'automations:write',
  'GET /automations/:id/logs': 'automations:read',
  'GET /automation-logs': 'automations:read',
  'GET /automation-metrics': 'automations:read',

  // --- batch-jobs ---
  'POST /batch-jobs': 'batch-jobs:write',
  'GET /batch-jobs': 'batch-jobs:read',
  'POST /batch-jobs/estimate': 'batch-jobs:read',
  'GET /batch-jobs/:id': 'batch-jobs:read',
  'GET /batch-jobs/:id/status': 'batch-jobs:read',
  'POST /batch-jobs/:id/cancel': 'batch-jobs:write',

  // --- chats ---
  'GET /chats': 'chats:read',
  'POST /chats': 'chats:write',
  'GET /chats/:id': 'chats:read',
  'PATCH /chats/:id': 'chats:write',
  'DELETE /chats/:id': 'chats:write',
  'POST /chats/:id/archive': 'chats:write',
  'POST /chats/:id/unarchive': 'chats:write',
  'POST /chats/:id/hide': 'chats:write',
  'POST /chats/:id/unhide': 'chats:write',
  'POST /chats/:id/label': 'chats:write',
  'DELETE /chats/:id/label': 'chats:write',
  'POST /chats/:id/pin': 'chats:write',
  'POST /chats/:id/unpin': 'chats:write',
  'POST /chats/:id/mute': 'chats:write',
  'POST /chats/:id/unmute': 'chats:write',
  'GET /chats/:id/participants': 'chats:read',
  'POST /chats/:id/participants': 'chats:write',
  'DELETE /chats/:id/participants/:platformUserId': 'chats:write',
  'PATCH /chats/:id/participants/:platformUserId': 'chats:write',
  'GET /chats/:id/messages': 'chats:read',
  'GET /chats/by-external': 'chats:read',
  'POST /chats/:id/read': 'chats:write',
  'POST /chats/:id/disappearing': 'chats:write',
  'POST /chats/sync-names': 'chats:write',

  // --- context ---
  'GET /context': 'context:read',
  'POST /context': 'context:write',
  'POST /context/use': 'context:read',
  'DELETE /context': 'context:write',

  // --- conversations ---
  'GET /conversations': 'conversations:read',
  'POST /conversations': 'conversations:write',
  'GET /conversations/:id': 'conversations:read',
  'PATCH /conversations/:id': 'conversations:write',
  'DELETE /conversations/:id': 'conversations:write',
  'GET /conversations/:id/chats': 'conversations:read',

  // --- dead-letters ---
  'GET /dead-letters': 'dead-letters:read',
  'GET /dead-letters/stats': 'dead-letters:read',
  'GET /dead-letters/:id': 'dead-letters:read',
  'POST /dead-letters/:id/retry': 'dead-letters:write',
  'POST /dead-letters/:id/resolve': 'dead-letters:write',
  'POST /dead-letters/:id/abandon': 'dead-letters:write',

  // --- event-ops ---
  'GET /event-ops/metrics': 'event-ops:read',
  'POST /event-ops/replay': 'event-ops:write',
  'GET /event-ops/replay': 'event-ops:read',
  'GET /event-ops/replay/:id': 'event-ops:read',
  'DELETE /event-ops/replay/:id': 'event-ops:write',
  'POST /event-ops/scheduled': 'event-ops:write',

  // --- events ---
  'GET /events': 'events:read',
  'GET /events/analytics': 'events:read',
  'GET /events/timeline/:personId': 'events:read',
  'POST /events/search': 'events:read',
  'GET /events/:id': 'events:read',
  'GET /events/by-sender/:senderId': 'events:read',

  // --- follow-up (idle-chat follow-up config at /follow-up/{agents|instances|chats}/:id — issue #404) ---
  'GET /follow-up/agents/:id': 'follow-up:read',
  'PUT /follow-up/agents/:id': 'follow-up:write',
  'DELETE /follow-up/agents/:id': 'follow-up:write',
  'GET /follow-up/instances/:id': 'follow-up:read',
  'PUT /follow-up/instances/:id': 'follow-up:write',
  'DELETE /follow-up/instances/:id': 'follow-up:write',
  'GET /follow-up/chats/:id': 'follow-up:read',
  'PUT /follow-up/chats/:id': 'follow-up:write',
  'DELETE /follow-up/chats/:id': 'follow-up:write',

  // --- handoffs (handoff audit log) ---
  'GET /handoffs': 'handoffs:read',
  'GET /handoffs/:id': 'handoffs:read',

  // --- instances ---
  'GET /instances': 'instances:read',
  'GET /instances/supported-channels': 'instances:read',
  'GET /instances/:id': 'instances:read',
  'POST /instances': 'instances:write',
  'PATCH /instances/:id': 'instances:write',
  'DELETE /instances/:id': 'instances:write',
  'GET /instances/:id/status': 'instances:read',
  'GET /instances/:id/qr': 'instances:read',
  'POST /instances/:id/pair': 'instances:write',
  'POST /instances/:id/connect': 'instances:write',
  'POST /instances/:id/disconnect': 'instances:write',
  'POST /instances/:id/restart': 'instances:write',
  'POST /instances/:id/logout': 'instances:write',
  'POST /instances/:id/sync/profile': 'instances:write',
  'PUT /instances/:id/profile/name': 'instances:write',
  'POST /instances/:id/sync': 'instances:write',
  'GET /instances/:id/sync/:jobId': 'instances:read',
  'GET /instances/:id/sync': 'instances:read',
  'GET /instances/:id/users/:userId/profile': 'instances:read',
  'GET /instances/:id/contacts': 'instances:read',
  'GET /instances/:id/groups': 'instances:read',
  'GET /instances/:id/groups/:jid/members': 'instances:read',
  'POST /instances/:id/check-number': 'instances:read',
  'PUT /instances/:id/profile/status': 'instances:write',
  'POST /instances/:id/block': 'instances:write',
  'DELETE /instances/:id/block': 'instances:write',
  'GET /instances/:id/blocklist': 'instances:read',
  'PUT /instances/:id/profile/picture': 'instances:write',
  'DELETE /instances/:id/profile/picture': 'instances:write',
  'POST /instances/:id/groups': 'instances:write',
  'GET /instances/:id/chats/:chatId/invite': 'instances:read',
  'GET /instances/:id/groups/:groupJid/invite': 'instances:read',
  'POST /instances/:id/groups/:groupJid/invite/revoke': 'instances:write',
  'POST /instances/:id/groups/join': 'instances:write',
  'PUT /instances/:id/groups/:groupJid/picture': 'instances:write',
  'GET /instances/:id/privacy': 'instances:read',
  'POST /instances/:id/calls/reject': 'instances:write',
  'POST /instances/:id/resync': 'instances:write',
  'POST /instances/:id/replay': 'instances:write',
  'GET /instances/:id/pairing-requests': 'instances:read',
  'POST /instances/:id/pairing-requests/:requestId/action': 'instances:write',
  'GET /instances/:id/guilds': 'instances:read',
  'GET /instances/:id/guilds/:guildId/config': 'instances:read',
  'PUT /instances/:id/guilds/:guildId/config': 'instances:write',
  'DELETE /instances/:id/guilds/:guildId/config': 'instances:write',
  'GET /instances/:id/guilds/:guildId/audit': 'instances:read',
  'PUT /instances/:id/presence': 'instances:write',

  // --- journeys ---
  'GET /journeys/summary': 'journeys:read',
  'GET /journeys/:correlationId': 'journeys:read',

  // --- keys ---
  'POST /keys': 'keys:write',
  'GET /keys': 'keys:read',
  'GET /keys/:id': 'keys:read',
  'PATCH /keys/:id': 'keys:write',
  'POST /keys/:id/revoke': 'keys:write',
  'DELETE /keys/:id': 'keys:write',
  'GET /keys/:id/audit': 'keys:read',

  // --- logs ---
  'GET /logs/stream': 'logs:read',
  'GET /logs/recent': 'logs:read',

  // --- media ---
  'POST /media/tts': 'tts:synthesize',
  'POST /media/stt': 'media:write',
  'POST /media/imagine': 'media:write',
  'POST /media/vision': 'media:read',
  'POST /media/film': 'media:write',
  'GET /media/:instanceId/*': 'media:read',

  // --- messages ---
  'GET /messages': 'messages:read',
  'GET /messages/by-external': 'messages:read',
  'POST /messages/media/download': 'messages:read',
  'POST /messages': 'messages:write',
  'GET /messages/:id': 'messages:read',
  'PATCH /messages/:id': 'messages:write',
  'DELETE /messages/:id': 'messages:write',
  'POST /messages/:id/edit': 'messages:write',
  'POST /messages/:id/reactions': 'messages:write',
  'DELETE /messages/:id/reactions': 'messages:write',
  'PATCH /messages/:id/delivery-status': 'messages:write',
  'PATCH /messages/:id/transcription': 'messages:write',
  'PATCH /messages/:id/image-description': 'messages:write',
  'PATCH /messages/:id/video-description': 'messages:write',
  'PATCH /messages/:id/document-extraction': 'messages:write',
  'POST /messages/send': 'messages:send',
  'POST /messages/send/media': 'messages:send',
  'POST /messages/send/reaction': 'messages:send',
  'POST /messages/send/sticker': 'messages:send',
  'POST /messages/send/contact': 'messages:send',
  'POST /messages/send/location': 'messages:send',
  'GET /messages/tts/voices': 'messages:read',
  'POST /messages/send/tts': 'messages:send',
  'POST /messages/send/forward': 'messages:send',
  'POST /messages/send/presence': 'messages:send',
  'POST /messages/:id/read': 'messages:write',
  'POST /messages/read': 'messages:write',
  'POST /messages/send/poll': 'messages:send',
  'POST /messages/send/embed': 'messages:send',
  'POST /messages/edit-channel': 'messages:send',
  'POST /messages/delete-channel': 'messages:send',
  'POST /messages/:id/star': 'messages:write',
  'DELETE /messages/:id/star': 'messages:write',

  // --- metrics ---
  'GET /metrics': 'metrics:read',

  // --- payloads (mounted at root: /events/:eventId/payloads/...) ---
  'GET /events/:eventId/payloads': 'payloads:read',
  'GET /events/:eventId/payloads/:stage': 'payloads:read',
  'DELETE /events/:eventId/payloads': 'payloads:write',
  'GET /payload-config': 'payloads:read',
  'PUT /payload-config/:eventType': 'payloads:write',
  'GET /payload-stats': 'payloads:read',

  // --- persons ---
  'GET /persons': 'persons:read',
  'GET /persons/:id': 'persons:read',
  'PATCH /persons/:id': 'persons:write',
  'GET /persons/:id/presence': 'persons:read',
  'GET /persons/:id/timeline': 'persons:read',
  'POST /persons/link': 'persons:write',
  'POST /persons/unlink': 'persons:write',
  'POST /persons/merge': 'persons:write',

  // --- providers ---
  'GET /providers': 'providers:read',
  'GET /providers/:id': 'providers:read',
  'POST /providers': 'providers:write',
  'PATCH /providers/:id': 'providers:write',
  'DELETE /providers/:id': 'providers:write',
  'POST /providers/:id/health': 'providers:read',
  'GET /providers/:id/agents': 'providers:read',
  'GET /providers/:id/teams': 'providers:read',
  'GET /providers/:id/workflows': 'providers:read',

  // --- settings ---
  'GET /settings': 'settings:read',
  'GET /settings/:key': 'settings:read',
  'PUT /settings/:key': 'settings:write',
  'PATCH /settings': 'settings:write',
  'DELETE /settings/:key': 'settings:write',
  'GET /settings/:key/history': 'settings:read',

  // --- turns ---
  'GET /turns': 'turns:admin',
  'GET /turns/stats': 'turns:admin',
  'GET /turns/:id': 'turns:admin',
  'POST /turns/:id/close': 'turns:admin',
  'POST /turns/close-all': 'turns:admin',
  'POST /turns/close': 'turns:close',

  // --- trust (genie host fingerprint trust; omni-host-fingerprint-trust wish) ---
  'POST /trust/handshake': 'trust:write',
  'GET /trust/hosts': 'trust:read',
  'GET /trust/hosts/:id': 'trust:read',
  'PATCH /trust/hosts/:id': 'trust:write',
  'DELETE /trust/hosts/:id': 'trust:write',

  // --- voice (voice session management) ---
  'POST /voice/join': 'voice:write',
  'POST /voice/leave': 'voice:write',
  'GET /voice/sessions': 'voice:read',
  'GET /voice/sessions/:id': 'voice:read',

  // --- whatsapp-cloud (Meta Cloud API): mounted at /instances/:id/whatsapp-cloud/* ---
  'POST /instances/:id/whatsapp-cloud/oauth/exchange': 'instances:write',
  'POST /instances/:id/whatsapp-cloud/connect': 'instances:write',
  'POST /instances/:id/whatsapp-cloud/register': 'instances:write',
  'POST /instances/:id/whatsapp-cloud/subscribe-app': 'instances:write',
  'GET /instances/:id/whatsapp-cloud/connection': 'instances:read',
  'DELETE /instances/:id/whatsapp-cloud/connection': 'instances:write',
  'GET /instances/:id/whatsapp-cloud/quality': 'instances:read',
  'GET /instances/:id/whatsapp-cloud/analytics': 'instances:read',
  'GET /instances/:id/whatsapp-cloud/profile': 'instances:read',
  'PUT /instances/:id/whatsapp-cloud/profile': 'instances:write',
  'POST /instances/:id/whatsapp-cloud/profile/photo': 'instances:write',

  // --- whatsapp-templates (mounted at root: /instances/:id/whatsapp-templates/...) ---
  'GET /instances/:id/whatsapp-templates': 'instances:read',
  'GET /instances/:id/whatsapp-templates/:templateId': 'instances:read',
  'POST /instances/:id/whatsapp-templates': 'instances:write',
  'DELETE /instances/:id/whatsapp-templates/:templateId': 'instances:write',
  'POST /instances/:id/whatsapp-templates/upload-header-media': 'instances:write',
  'POST /instances/:id/whatsapp-templates/:templateId/send-test': 'instances:write',
  'POST /instances/:id/whatsapp-templates/:templateName/send': 'instances:write',

  // --- webhooks (mounted at root: /webhook-sources/..., /webhooks/:source, /events/trigger) ---
  'GET /webhook-sources': 'webhooks:read',
  'GET /webhook-sources/:id': 'webhooks:read',
  'POST /webhook-sources': 'webhooks:write',
  'PATCH /webhook-sources/:id': 'webhooks:write',
  'DELETE /webhook-sources/:id': 'webhooks:write',
  'POST /webhooks/:source': 'webhooks:write',
  'POST /events/trigger': 'events:write',
};
