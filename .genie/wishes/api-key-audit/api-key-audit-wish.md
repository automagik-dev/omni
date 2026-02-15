# Wish: API Key Audit Trail

> Track every API key usage for security, debugging, and compliance

**Status:** Draft
**Beads:** omni-tth
**Priority:** P2

## Problem

The design docs promise full API key audit logging but only basic tracking exists:

| Feature | Designed | Implemented |
|---------|----------|-------------|
| Last used timestamp | Yes | Yes |
| Usage count | Yes | Yes |
| Last used IP | Yes | No (field exists, not populated) |
| Full audit log per request | Yes | No |
| Audit log endpoint | Yes | No |

Without audit trails, we cannot:
- Investigate security incidents (which key accessed what, when)
- Debug API issues (see request/response patterns per key)
- Meet compliance requirements (auditable access logs)
- Detect anomalous usage patterns

## Solution

### 1. New Schema: `api_key_audit_logs`

```typescript
export const apiKeyAuditLogs = pgTable(
  'api_key_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),

    // Request info
    method: varchar('method', { length: 10 }).notNull(),  // GET, POST, etc.
    path: varchar('path', { length: 500 }).notNull(),      // /api/v1/messages
    statusCode: integer('status_code').notNull(),

    // Client info
    ipAddress: varchar('ip_address', { length: 45 }),      // IPv6 max
    userAgent: text('user_agent'),

    // Performance
    responseTimeMs: integer('response_time_ms'),

    // Optional: request/response sampling for debugging
    requestSample: jsonb('request_sample').$type<Record<string, unknown>>(),
    responseSample: jsonb('response_sample').$type<Record<string, unknown>>(),

    // Timestamps
    timestamp: timestamp('timestamp').notNull().defaultNow(),
  },
  (table) => ({
    apiKeyIdx: index('api_key_audit_logs_api_key_idx').on(table.apiKeyId),
    timestampIdx: index('api_key_audit_logs_timestamp_idx').on(table.timestamp),
    pathIdx: index('api_key_audit_logs_path_idx').on(table.path),
    statusCodeIdx: index('api_key_audit_logs_status_code_idx').on(table.statusCode),
  }),
);
```

### 2. Update Auth Middleware

Capture IP and user agent, pass to audit service:

```typescript
// In auth middleware
const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
const userAgent = c.req.header('user-agent');

// After response (using Hono's afterResponse or similar)
await auditService.log({
  apiKeyId: validatedKey.id,
  method: c.req.method,
  path: c.req.path,
  statusCode: c.res.status,
  ipAddress: ip,
  userAgent,
  responseTimeMs: Date.now() - startTime,
});
```

### 3. Populate `lastUsedIp` on API Keys

Update `ApiKeyService.validate()` to accept and store IP:

```typescript
async validate(key: string, ip?: string): Promise<ValidatedApiKey | null> {
  // ... existing validation ...

  this.db
    .update(apiKeys)
    .set({
      lastUsedAt: new Date(),
      lastUsedIp: ip,  // Now populated!
      usageCount: sql`${apiKeys.usageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(apiKeys.id, apiKey.id))
    // ...
}
```

### 4. New Endpoints

```yaml
# List audit logs for a key
GET /api/v2/api-keys/:id/audit
Query:
  - since: datetime
  - until: datetime
  - path: string        # Filter by path pattern
  - statusCode: number  # Filter by status
  - limit: number
  - cursor: string
Response: { items: AuditLog[], meta: PaginationMeta }

# Get audit summary/stats
GET /api/v2/api-keys/:id/audit/stats
Query:
  - since: datetime
  - until: datetime
Response: {
  totalRequests: number,
  uniqueIps: number,
  topPaths: { path: string, count: number }[],
  statusBreakdown: { status: number, count: number }[],
  avgResponseTimeMs: number
}
```

### 5. Retention Policy

Add configuration for audit log retention:

```typescript
// In payload_storage_config or separate config
auditLogRetentionDays: 90  // Default 90 days
```

Background job to clean old audit logs.

### 6. Performance Considerations

- **Async writes**: Log to audit table asynchronously (fire-and-forget with error handling)
- **Batching**: Consider batching writes if high volume
- **Sampling**: For very high-traffic keys, sample requests (log 1 in N)
- **Indexing**: Careful index strategy for query patterns

## Tasks

### Group A: Schema & Service
- [ ] Add `api_key_audit_logs` table to schema
- [ ] Create `AuditService` with `log()` method
- [ ] Update `ApiKeyService.validate()` to accept IP parameter
- [ ] Add retention cleanup job

### Group B: Middleware Integration
- [ ] Update auth middleware to capture IP and user agent
- [ ] Add response timing measurement
- [ ] Call audit service after response

### Group C: API Endpoints
- [ ] Implement `GET /api/v2/api-keys/:id/audit`
- [ ] Implement `GET /api/v2/api-keys/:id/audit/stats`
- [ ] Add to OpenAPI spec
- [ ] Add tRPC procedures

### Group D: CLI & SDK
- [ ] Add `omni api-keys audit <id>` CLI command
- [ ] Generate SDK types for audit endpoints

## Success Criteria

- [ ] Every API request logged with key ID, path, status, IP, user agent
- [ ] `lastUsedIp` populated on API keys table
- [ ] Audit logs queryable via API
- [ ] Audit stats endpoint provides usage analytics
- [ ] Logs retained for configurable period (default 90 days)
- [ ] Performance: <5ms overhead per request

## Non-Goals

- Real-time alerting on suspicious patterns (future work)
- Request/response body logging by default (privacy concerns)
- Cross-key analytics (focus on per-key audit)

## References

- Design spec: `docs/api/design.md:92-100`
- Current schema: `packages/db/src/schema.ts:263-312`
- API key service: `packages/api/src/services/api-keys.ts`
