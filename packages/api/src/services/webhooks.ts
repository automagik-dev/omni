/**
 * Webhook service - manages webhook sources and receives webhooks
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ERROR_CODES,
  NotFoundError,
  OmniError,
  SCHEMA_VALIDATION_FAILED,
  ValidationError,
  createLogger,
  sweepConnectorLiveness,
} from '@omni/core';
import type {
  ConnectorLivenessDeps,
  ConnectorLivenessRepo,
  ConnectorLivenessRow,
  ConnectorLivenessSweepStats,
  CustomEventType,
  EventBus,
  OmniEvent,
} from '@omni/core';
import { generateId } from '@omni/core';
import type { Database } from '@omni/db';
import {
  type NewWebhookSource,
  type WebhookEventTypeMapping,
  type WebhookSource,
  omniEvents,
  webhookSources,
} from '@omni/db';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { deriveIdempotencyKey } from '../lib/ingress-idempotency';
import { openCredentialField, sealCredentialField } from '../tenancy/sealed-credentials';
import { currentTenantScope, scopedHandle } from '../tenancy/tenant-scope';
import type { DeadLetterService } from './dead-letters';
import type { EventSchemaService } from './event-schemas';

const log = createLogger('api:webhooks');

export interface WebhookReceiveResult {
  received: boolean;
  eventId: string;
  source: string;
  eventType: string;
  /**
   * True when this delivery collided with an already-journaled idempotency
   * key (#958): the emitter is acked so it stops redelivering, but no second
   * event was created. `eventId` is the ORIGINAL event's id in that case.
   */
  duplicate?: boolean;
}

export interface WebhookReceiveOptions {
  /** Create the source on first receive. Administrative creation is the norm; this is a dev convenience. */
  autoCreate?: boolean;
  /** Raw request body bytes as received — HMAC verification must run over these, not a re-serialization. */
  rawBody?: string;
  /** Reject sources without a signature config (the auth-exempt public ingress sets this). */
  requireSignature?: boolean;
}

export interface WebhookHeartbeatResult {
  ok: true;
  source: string;
  /** ISO timestamp the heartbeat was recorded at. */
  heartbeatAt: string;
  /** Status BEFORE this heartbeat — the sweeper owns transitions, so a stalled source recovers on its next tick. */
  livenessStatus: WebhookSource['livenessStatus'];
  expectedIntervalSeconds: number | null;
}

/** Constant-time string comparison; a length mismatch short-circuits, which leaks only the length. */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Normalize a delivery's semantic event name into an event-type token:
 * lowercased, `[a-z0-9_-]` only, at most 64 characters. Null when nothing
 * usable remains — the caller falls back to the collapsed legacy type.
 */
function sanitizeEventToken(raw: string | undefined): string | null {
  if (!raw) return null;
  const token = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return token.length > 0 ? token : null;
}

/**
 * Source→semantic-type mapping (issue #959). A source configured with an
 * `eventTypeMapping` emits `custom.{source}.{event}` (e.g. `X-GitHub-Event:
 * push` → `custom.github.push`) instead of collapsing every delivery into
 * `custom.webhook.{source}`. No mapping, or a delivery the mapping cannot
 * resolve (header absent/empty), falls back to the legacy collapsed type.
 */
export function resolveWebhookEventType(
  sourceName: string,
  mapping: WebhookEventTypeMapping | null,
  headers: Record<string, string>,
): CustomEventType {
  const fallback = `custom.webhook.${sourceName}` as CustomEventType;
  if (!mapping || mapping.source !== 'header') {
    return fallback;
  }
  const token = sanitizeEventToken(headers[mapping.header.toLowerCase()]);
  return token ? (`custom.${sourceName}.${token}` as CustomEventType) : fallback;
}

export class WebhookService {
  /**
   * The handle every query in this service uses.
   *
   * Inside a tenant-scoped request this is the request's tenant-stamped
   * transaction (wish: omni-full-multitenancy, G4 — see `tenancy/tenant-scope.ts`);
   * for a legacy credential, a worker, or the CLI it is the ambient pool and
   * the query issued is byte-for-byte the one issued before the conversion.
   */
  private get db(): Database {
    return scopedHandle(this.pool);
  }

  /** Tenant of the active request scope; seals/opens the signature secret (providers.ts precedent). */
  private get tenantId(): string | null {
    return currentTenantScope()?.tenantId ?? null;
  }

  constructor(
    private readonly pool: Database,
    private eventBus: EventBus | null,
    /**
     * Schema-registry gate (issue #959). Optional so existing constructions
     * (tests, tooling) keep working; without both collaborators the ingress
     * publishes exactly as before.
     */
    private readonly eventSchemas: EventSchemaService | null = null,
    private readonly deadLetters: DeadLetterService | null = null,
  ) {}

  /**
   * List all webhook sources
   */
  async list(options: { enabled?: boolean } = {}): Promise<WebhookSource[]> {
    let query = this.db.select().from(webhookSources).$dynamic();

    if (options.enabled !== undefined) {
      query = query.where(eq(webhookSources.enabled, options.enabled));
    }

    return query.orderBy(webhookSources.name);
  }

  /**
   * Get webhook source by ID
   */
  async getById(id: string): Promise<WebhookSource> {
    const [result] = await this.db.select().from(webhookSources).where(eq(webhookSources.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('WebhookSource', id);
    }

    return result;
  }

  /**
   * Get webhook source by name
   */
  async getByName(name: string): Promise<WebhookSource | null> {
    const [result] = await this.db.select().from(webhookSources).where(eq(webhookSources.name, name)).limit(1);
    return result ?? null;
  }

  /**
   * Create a new webhook source
   */
  async create(data: NewWebhookSource): Promise<WebhookSource> {
    if (data.signatureConfig && !data.signatureSecret) {
      throw new ValidationError('signatureSecret is required when signatureConfig is set');
    }
    if (data.signatureSecret && !data.signatureConfig) {
      throw new ValidationError('signatureSecret cannot be set without a signatureConfig');
    }

    let values = data.signatureSecret
      ? { ...data, signatureSecret: sealCredentialField(this.tenantId, data.signatureSecret) }
      : data;
    // Declaring a cadence arms liveness supervision with a full fresh window.
    if (values.expectedIntervalSeconds != null) {
      values = { ...values, livenessArmedAt: new Date(), livenessStatus: 'healthy' };
    }
    const [created] = await this.db.insert(webhookSources).values(values).returning();

    if (!created) {
      throw new Error('Failed to create webhook source');
    }

    return created;
  }

  /**
   * Update a webhook source
   */
  async update(id: string, data: Partial<NewWebhookSource>): Promise<WebhookSource> {
    const patch: Partial<NewWebhookSource> = { ...data };

    if (typeof data.signatureSecret === 'string') {
      patch.signatureSecret = sealCredentialField(this.tenantId, data.signatureSecret);
    }

    // Invariant across every partial-update combination: a signature config
    // always has a secret, and a secret never outlives its config. `undefined`
    // means "untouched" and inherits the stored value; `null` is an explicit
    // clear.
    if (data.signatureConfig !== undefined || data.signatureSecret !== undefined) {
      const existing = await this.getById(id);
      const nextConfig = data.signatureConfig === undefined ? existing.signatureConfig : data.signatureConfig;
      const nextSecret = data.signatureSecret === undefined ? existing.signatureSecret : patch.signatureSecret;

      if (nextConfig && !nextSecret) {
        throw new ValidationError('signatureSecret is required when signatureConfig is set');
      }
      if (!nextConfig) {
        if (typeof data.signatureSecret === 'string') {
          throw new ValidationError('signatureSecret cannot be set without a signatureConfig');
        }
        // Clearing the config would orphan the stored secret — clear it too.
        patch.signatureSecret = null;
      }
    }

    await this.applyLivenessArming(id, data, patch);

    const [updated] = await this.db
      .update(webhookSources)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(webhookSources.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('WebhookSource', id);
    }

    return updated;
  }

  /**
   * Liveness arming on update (issue #961). `undefined` = untouched; a number
   * (re)declares the cadence and re-anchors the window; `null` disarms
   * supervision entirely. A stalled source keeps its status on re-arm — the
   * sweeper sees the fresh window on its next tick and emits the `recovered`
   * event, so recovery stays single-writer.
   */
  private async applyLivenessArming(
    id: string,
    data: Partial<NewWebhookSource>,
    patch: Partial<NewWebhookSource>,
  ): Promise<void> {
    if (data.expectedIntervalSeconds === undefined) return;

    if (data.expectedIntervalSeconds === null) {
      patch.livenessStatus = null;
      patch.livenessArmedAt = null;
      patch.stalledAt = null;
      return;
    }

    patch.livenessArmedAt = new Date();
    const existing = await this.getById(id);
    if (existing.livenessStatus === null) {
      patch.livenessStatus = 'healthy';
    }
  }

  /**
   * Delete a webhook source
   */
  async delete(id: string): Promise<void> {
    const result = await this.db.delete(webhookSources).where(eq(webhookSources.id, id)).returning();

    if (!result.length) {
      throw new NotFoundError('WebhookSource', id);
    }
  }

  /**
   * Receive a webhook and publish as event.
   *
   * Sources are created by administrative act; `autoCreate` (default OFF,
   * issue #928) is a dev-environment convenience only. When the source
   * carries a `signatureConfig`, the request is verified against it BEFORE
   * anything is published or counted — verification failure means nothing
   * enters the journal.
   */
  async receive(
    sourceName: string,
    payload: Record<string, unknown>,
    headers: Record<string, string>,
    options: WebhookReceiveOptions = {},
  ): Promise<WebhookReceiveResult> {
    const { autoCreate = false, rawBody, requireSignature = false } = options;

    // Get or create source
    let source = await this.getByName(sourceName);

    if (!source && autoCreate) {
      source = await this.create({
        name: sourceName,
        description: `Auto-created from webhook: ${sourceName}`,
      });
    }

    if (!source) {
      throw new NotFoundError('WebhookSource', sourceName);
    }

    if (!source.enabled) {
      throw new OmniError({
        code: ERROR_CODES.FORBIDDEN,
        message: `Webhook source '${sourceName}' is disabled`,
        context: { sourceName },
      });
    }

    // The public ingress carries no API key: a source is reachable there only
    // once an admin has configured its signature contract.
    if (requireSignature && !source.signatureConfig) {
      throw new OmniError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: `Webhook source '${sourceName}' has no signature configuration`,
        context: { sourceName },
      });
    }

    if (source.signatureConfig) {
      this.verifySignature(source, rawBody, headers);
    }

    // Validate expected headers if configured (presence only — the signature
    // check above is the authenticity gate)
    if (source.expectedHeaders) {
      for (const headerName of Object.keys(source.expectedHeaders)) {
        if (!headers[headerName.toLowerCase()]) {
          throw new ValidationError(`Missing required header: ${headerName}`);
        }
      }
    }

    // Generate event ID
    const eventId = generateId();
    // Semantic type extraction (issue #959): a mapped source emits
    // custom.{source}.{event}; unmapped keeps the legacy collapsed type.
    const eventType = resolveWebhookEventType(sourceName, source.eventTypeMapping, headers);
    const eventPayload = {
      source: sourceName,
      ...payload,
    };

    // Schema-registry gate (issue #959): a registered type's payload must
    // satisfy its schema BEFORE anything is published or counted. An invalid
    // payload is dead-lettered with reason `schema_validation_failed` and
    // never enters the journal; unregistered types pass through (opt-in).
    await this.enforceRegisteredSchema(eventType, eventPayload, eventId, `webhook '${sourceName}'`);

    // Ingress idempotency (#958): derive the delivery-identity key from the
    // source's template and CLAIM it by inserting the journal row — the
    // `omni_events.idempotency_key` unique index is the dedup authority. A
    // conflict means the provider redelivered: ack it (200) so it stops
    // retrying, bump the source's dup counter, create no second event.
    // Scope boundary: this dedupes REDELIVERY, not semantic identity — see
    // `lib/ingress-idempotency.ts`.
    const idempotencyKey = deriveIdempotencyKey({
      template: source.idempotencyKeyTemplate,
      sourceName,
      rawBody: rawBody ?? JSON.stringify(payload),
      payload,
      headers,
    });

    const claimed = await this.db
      .insert(omniEvents)
      .values({
        id: eventId,
        channel: 'internal',
        eventType,
        direction: 'inbound',
        status: 'received',
        rawPayload: payload,
        idempotencyKey,
        receivedAt: new Date(),
        metadata: { correlationId: eventId, webhookSource: sourceName },
      })
      .onConflictDoNothing({ target: omniEvents.idempotencyKey })
      .returning({ id: omniEvents.id });

    if (claimed.length === 0) {
      await this.db
        .update(webhookSources)
        .set({
          totalDuplicates: sql`${webhookSources.totalDuplicates} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(webhookSources.id, source.id));

      const [original] = await this.db
        .select({ id: omniEvents.id })
        .from(omniEvents)
        .where(eq(omniEvents.idempotencyKey, idempotencyKey))
        .limit(1);

      log.info('Webhook redelivery acked without a second event', { sourceName, idempotencyKey });

      return {
        received: true,
        duplicate: true,
        eventId: original?.id ?? eventId,
        source: sourceName,
        eventType,
      };
    }

    // Update stats
    await this.db
      .update(webhookSources)
      .set({
        lastReceivedAt: new Date(),
        totalReceived: sql`${webhookSources.totalReceived} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(webhookSources.id, source.id));

    // Publish event
    if (this.eventBus) {
      try {
        await this.eventBus.publishGeneric(eventType, eventPayload, {
          correlationId: eventId,
          source: 'webhook',
        });
      } catch (error) {
        // The claim must not outlive a failed publish: leaving it would ack
        // the provider's retry as a "duplicate" of an event that never
        // reached the bus. Release the row and let the emitter redeliver.
        await this.db
          .delete(omniEvents)
          .where(eq(omniEvents.id, eventId))
          .catch((releaseError: unknown) => {
            log.error('Failed to release idempotency claim after publish failure', {
              sourceName,
              eventId,
              idempotencyKey,
              error: String(releaseError),
            });
          });
        throw error;
      }
    }

    return {
      received: true,
      eventId,
      source: sourceName,
      eventType,
    };
  }

  /**
   * Verify a request against the source's signature config. Throws
   * UNAUTHORIZED (→ 401) on any failure; callers reach the publish path only
   * when this returns.
   */
  private verifySignature(source: WebhookSource, rawBody: string | undefined, headers: Record<string, string>): void {
    const config = source.signatureConfig;
    if (!config) return;

    const sourceName = source.name;
    const unauthorized = (message: string) =>
      new OmniError({ code: ERROR_CODES.UNAUTHORIZED, message, context: { sourceName } });

    const provided = headers[config.header.toLowerCase()];
    if (!provided) {
      throw unauthorized(`Missing signature header: ${config.header}`);
    }

    const secret = openCredentialField(source.tenantId ?? this.tenantId, source.signatureSecret);
    if (!secret) {
      log.warn('Webhook source has a signature config but no usable secret', { sourceName });
      throw unauthorized('Webhook signature verification unavailable for this source');
    }

    let expected: string;
    if (config.algorithm === 'token-match') {
      expected = secret;
    } else {
      if (rawBody === undefined) {
        throw unauthorized('Webhook signature verification requires the raw request body');
      }
      const hmac = createHmac(config.algorithm === 'hmac-sha256' ? 'sha256' : 'sha1', secret);
      expected = `${config.prefix ?? ''}${hmac.update(rawBody).digest('hex')}`;
    }

    if (!timingSafeEqualStrings(provided, expected)) {
      throw unauthorized('Invalid webhook signature');
    }
  }

  /**
   * Schema-registry gate (issue #959): validates the payload of a REGISTERED
   * event type; unregistered types return immediately (opt-in per type). An
   * invalid payload is dead-lettered (reason `schema_validation_failed`,
   * manual-retry only) and the ingress request fails with a 400 — nothing
   * enters the journal.
   */
  private async enforceRegisteredSchema(
    eventType: CustomEventType,
    payload: Record<string, unknown>,
    eventId: string,
    origin: string,
  ): Promise<void> {
    if (!this.eventSchemas) {
      return;
    }
    const verdict = await this.eventSchemas.validate(eventType, payload);
    if (verdict.valid) {
      return;
    }

    await this.deadLetters?.createSchemaValidationFailure({
      eventId,
      eventType,
      subject: eventType,
      payload,
      errors: verdict.errors,
    });

    log.warn('Webhook payload refused by schema registry', { eventType, origin, errors: verdict.errors });
    throw new ValidationError(
      `${SCHEMA_VALIDATION_FAILED}: payload for '${eventType}' violates its registered schema (${origin})`,
      undefined,
      { eventType, errors: verdict.errors },
    );
  }

  /**
   * Manually trigger a custom event
   */
  async trigger(
    eventType: CustomEventType,
    payload: Record<string, unknown>,
    metadata?: { correlationId?: string; instanceId?: string },
  ): Promise<{ eventId: string; published: boolean }> {
    const eventId = metadata?.correlationId ?? generateId();

    // Same gate as the webhook ingress: a registered type's contract holds on
    // every publish path into the journal (issue #959).
    await this.enforceRegisteredSchema(eventType, payload, eventId, 'manual trigger');

    if (this.eventBus) {
      await this.eventBus.publishGeneric(eventType, payload, {
        correlationId: eventId,
        instanceId: metadata?.instanceId,
        source: 'manual-trigger',
      });

      return { eventId, published: true };
    }

    return { eventId, published: false };
  }

  /**
   * Heartbeat ingress (#961): a connector's cheap "I ran, zero events found".
   *
   * Distinguishes quiet from dead — this is the exact signal that would have
   * caught the dogfood week's three silent environment failures on the first
   * tick. Deliberately NO journal event per heartbeat: at cadence a heartbeat
   * is pure control-plane noise in the journal, so the compacted
   * representation is the `lastHeartbeatAt` timestamp + `heartbeatCount`
   * counter on the source row. The journaled state changes are the
   * TRANSITIONS (`system.connector.stalled`/`recovered`), which the liveness
   * sweeper owns — a stalled source that heartbeats recovers on the sweeper's
   * next tick, keeping every transition single-writer and emitted once.
   */
  async heartbeat(sourceName: string): Promise<WebhookHeartbeatResult> {
    const source = await this.getByName(sourceName);
    if (!source) {
      throw new NotFoundError('WebhookSource', sourceName);
    }
    if (!source.enabled) {
      throw new OmniError({
        code: ERROR_CODES.FORBIDDEN,
        message: `Webhook source '${sourceName}' is disabled`,
        context: { sourceName },
      });
    }

    const now = new Date();
    await this.db
      .update(webhookSources)
      .set({
        lastHeartbeatAt: now,
        heartbeatCount: sql`${webhookSources.heartbeatCount} + 1`,
        updatedAt: now,
      })
      .where(eq(webhookSources.id, source.id));

    return {
      ok: true,
      source: sourceName,
      heartbeatAt: now.toISOString(),
      livenessStatus: source.livenessStatus,
      expectedIntervalSeconds: source.expectedIntervalSeconds,
    };
  }

  /**
   * One liveness sweep tick (#961) — called by the scheduler. Lives on
   * WebhookService because this is the one file sanctioned to touch
   * `webhook_sources` (tenancy-db-access-guard); the transition semantics
   * live in `@omni/core` (`sweepConnectorLiveness`).
   *
   * When a `DeadLetterService` is provided, a stalled transition also files a
   * manual-resolution DLQ entry (the "zero-emission dead-letter" ops surface)
   * and recovery auto-resolves it.
   */
  async sweepLiveness(options: { deadLetters?: DeadLetterService } = {}): Promise<ConnectorLivenessSweepStats> {
    const { deadLetters } = options;
    const hooks: Pick<ConnectorLivenessDeps, 'onStalled' | 'onRecovered'> = deadLetters
      ? {
          onStalled: (row, payload, publishedEventId) =>
            fileStallDeadLetter(deadLetters, row, payload, publishedEventId),
          onRecovered: (row) => resolveStallDeadLetters(deadLetters, row),
        }
      : {};

    return sweepConnectorLiveness({
      repo: this.livenessRepo(),
      eventBus: this.eventBus,
      logger: log,
      ...hooks,
    });
  }

  /**
   * `ConnectorLivenessRepo` over `webhook_sources`. The guarded transition
   * updates (`WHERE liveness_status = <previous>`) are what makes each
   * stalled/recovered event single-winner under overlapping ticks.
   */
  private livenessRepo(): ConnectorLivenessRepo {
    return {
      findSupervised: async (): Promise<ConnectorLivenessRow[]> => {
        const rows = await this.db
          .select()
          .from(webhookSources)
          .where(and(eq(webhookSources.enabled, true), isNotNull(webhookSources.expectedIntervalSeconds)));
        return rows
          .filter(
            (row): row is WebhookSource & { expectedIntervalSeconds: number } => row.expectedIntervalSeconds !== null,
          )
          .map((row) => ({
            id: row.id,
            name: row.name,
            expectedIntervalSeconds: row.expectedIntervalSeconds,
            lastReceivedAt: row.lastReceivedAt,
            lastHeartbeatAt: row.lastHeartbeatAt,
            livenessArmedAt: row.livenessArmedAt,
            livenessStatus: row.livenessStatus,
            stalledAt: row.stalledAt,
            createdAt: row.createdAt,
            tenantId: row.tenantId,
          }));
      },
      markStalled: async (id: string, at: Date): Promise<boolean> => {
        const res = await this.db
          .update(webhookSources)
          .set({ livenessStatus: 'stalled', stalledAt: at, updatedAt: at })
          .where(and(eq(webhookSources.id, id), sql`${webhookSources.livenessStatus} IS DISTINCT FROM 'stalled'`))
          .returning({ id: webhookSources.id });
        return res.length > 0;
      },
      markRecovered: async (id: string, at: Date): Promise<boolean> => {
        const res = await this.db
          .update(webhookSources)
          .set({ livenessStatus: 'healthy', stalledAt: null, updatedAt: at })
          .where(and(eq(webhookSources.id, id), eq(webhookSources.livenessStatus, 'stalled')))
          .returning({ id: webhookSources.id });
        return res.length > 0;
      },
    };
  }
}

/**
 * File the stalled transition into the DLQ so a dead connector surfaces on
 * the ops surface, not only in a log (#961). Manual resolution only
 * (`autoRetry: false`): auto-retry would republish the stalled event and
 * break its emitted-once contract — recovery resolves the entry instead.
 */
async function fileStallDeadLetter(
  deadLetters: DeadLetterService,
  row: ConnectorLivenessRow,
  payload: Parameters<NonNullable<ConnectorLivenessDeps['onStalled']>>[1],
  publishedEventId: string | null,
): Promise<void> {
  const event: OmniEvent = {
    id: publishedEventId ?? generateId(),
    type: 'system.connector.stalled',
    payload: { ...payload },
    metadata: {
      correlationId: generateId(),
      source: 'connector-liveness',
      ...(row.tenantId ? { tenantId: row.tenantId } : {}),
    },
    timestamp: payload.stalledAt,
  };
  await deadLetters.create({
    event,
    subject: 'system.connector.stalled.internal.global',
    error: new Error(
      `Connector '${row.name}' declared >=1 event or heartbeat per ${row.expectedIntervalSeconds}s ` +
        `but has been silent for ${payload.silentForSeconds}s`,
    ),
    retryCount: 0,
    autoRetry: false,
  });
}

/** Recovery auto-resolves the pending stall entries this sweeper filed for the source. */
async function resolveStallDeadLetters(deadLetters: DeadLetterService, row: ConnectorLivenessRow): Promise<void> {
  const { items } = await deadLetters.list({ status: ['pending'], eventType: ['system.connector.stalled'] });
  for (const entry of items) {
    const stored = entry.payload as { payload?: { sourceId?: unknown } };
    if (stored.payload?.sourceId === row.id) {
      await deadLetters.resolve(entry.id, 'connector-liveness: recovered');
    }
  }
}
