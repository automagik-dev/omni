/**
 * Connector service.
 *
 * Owns the two connector tables, the sealed credential codec, subscription
 * lifecycle and the inbound delivery envelope. A connector is a tenant-owned
 * integration account: this service never creates an `instances`, `chats` or
 * `messages` row, and no delivery emits `message.received`.
 *
 * Sealing symmetry follows the `instances` rule literally: a read opens under
 * the row's OWN persisted tenant, and a write seals under the tenant the
 * persisted row presents back. A failure to open is `null`, never ciphertext.
 *
 * The journal (`omni_events`) is the delivery log. Idempotency is claimed by
 * inserting the journal row first; the `omni_events.idempotency_key` unique
 * index, not application logic, is the dedupe authority.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { ConnectorManifest, ConnectorParsedDelivery, ConnectorRegistry } from '@omni/connector-sdk';
import { providerDetail, providerSummary, redactSecrets, redactValue, verifyDelivery } from '@omni/connector-sdk';
import {
  CONNECTOR_EVENT_TYPE,
  type EventBus,
  NotFoundError,
  OmniError,
  ValidationError,
  createLogger,
} from '@omni/core';
import type { Database } from '@omni/db';
import {
  type Connector,
  type ConnectorEventSubscription,
  automations,
  connectorEventSubscriptions,
  connectors,
  omniEvents,
} from '@omni/db';
import { type AnyColumn, and, eq, gt, isNull, sql } from 'drizzle-orm';
import type {
  CreateConnectorBody,
  CreateSubscriptionBody,
  UpdateConnectorBody,
  UpdateSubscriptionBody,
} from '../schemas/connectors';
import { openCredentialField, sealCredentialField } from '../tenancy/sealed-credentials';
import { currentTenantScope, scopedHandle } from '../tenancy/tenant-scope';
import { runTenantWorkDb } from '../tenancy/worker-tenant-context';

const log = createLogger('connector-service');

/** Longest idempotency key stored as-is; longer keys collapse to a hash. */
const MAX_KEY_LENGTH = 512;
const MAX_ERROR_TEXT = 500;

export const CONNECTOR_RESERVED_KEYS = [
  'connectorId',
  'subscriptionId',
  'targetAutomationId',
  'provider',
  'eventKey',
  'providerEventId',
  'occurredAt',
  'rawPayload',
] as const;

export interface ConnectorView {
  id: string;
  provider: string;
  name: string;
  status: string;
  config: Record<string, unknown>;
  hasCredentials: boolean;
  lastValidatedAt: Date | null;
  lastError: string | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventSubscriptionView {
  id: string;
  connectorId: string;
  providerEventKey: string;
  filters: Record<string, unknown>;
  targetAutomationId: string;
  status: string;
  inboundUrl: string;
  lastDeliveryAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  totalDeliveries: number;
  totalDuplicates: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliveryOutcome {
  status: 200 | 202 | 400 | 401 | 500;
  body: Record<string, unknown>;
}

export interface ConnectorListOptions {
  provider?: string;
  status?: 'connected' | 'error' | 'revoked';
  limit?: number;
  cursor?: string;
}

/** A resolved connector + action, with credentials opened, but no provider call yet. */
export interface PreparedConnectorAction {
  readonly connector: Connector;
  readonly manifest: ConnectorManifest;
  readonly action: ConnectorManifest['actions'][number];
  readonly credentials: Record<string, string>;
  readonly config: Record<string, unknown>;
}

export interface ConnectorCallRequest {
  connectorId: string;
  action: string;
  input: Record<string, unknown>;
  timeoutMs?: number;
}

export interface ConnectorServiceOptions {
  /** Injected transport; tests replace it, production uses the global fetch. */
  fetch?: typeof fetch;
  /** Public base URL used to render `inboundUrl`; relative when absent. */
  publicBaseUrl?: string;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function getPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(part)) return undefined;
      current = current[Number(part)];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }
  return current;
}

/** Exact-match filters over the parsed provider data (dot paths allowed). */
export function matchesFilters(data: Record<string, unknown>, filters: Record<string, unknown>): boolean {
  for (const [path, expected] of Object.entries(filters)) {
    if (JSON.stringify(getPath(data, path)) !== JSON.stringify(expected)) return false;
  }
  return true;
}

/**
 * Delivery identity key: `connector:{subscriptionId}:{providerEventId}`, with
 * the body hash as the fallback when the provider sends no stable event id.
 * Subscription-scoped on purpose: two subscriptions may legitimately receive
 * one provider fact for two automations.
 */
export function deriveConnectorIdempotencyKey(
  subscriptionId: string,
  providerEventId: string | undefined,
  rawBody: string,
): string {
  const identity = providerEventId && providerEventId.length > 0 ? providerEventId : sha256Hex(rawBody);
  const key = `connector:${subscriptionId}:${identity}`;
  return key.length > MAX_KEY_LENGTH ? `connector:${subscriptionId}:${sha256Hex(key)}` : key;
}

/**
 * The published `connector.event` payload: provider data at the top level plus
 * the fixed connector envelope. Reserved keys win over provider fields, so a
 * provider that uses one of those names must rename it in `parseDelivery`.
 */
export function buildConnectorEventPayload(args: {
  connectorId: string;
  subscriptionId: string;
  targetAutomationId: string;
  provider: string;
  eventKey: string;
  providerEventId?: string;
  occurredAt?: string;
  data: Record<string, unknown>;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...args.data };
  const reserved: Record<(typeof CONNECTOR_RESERVED_KEYS)[number], unknown> = {
    connectorId: args.connectorId,
    subscriptionId: args.subscriptionId,
    targetAutomationId: args.targetAutomationId,
    provider: args.provider,
    eventKey: args.eventKey,
    providerEventId: args.providerEventId,
    occurredAt: args.occurredAt,
    rawPayload: args.data,
  };
  for (const key of CONNECTOR_RESERVED_KEYS) {
    if (reserved[key] !== undefined) payload[key] = reserved[key];
    else delete payload[key];
  }
  return payload;
}

function asErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ConnectorService {
  /** The handle every query uses: the request's tenant transaction or the ambient pool. */
  private get db(): Database {
    return scopedHandle(this.pool);
  }

  private readonly fetchImpl: typeof fetch;
  private readonly publicBaseUrl: string;

  constructor(
    private readonly pool: Database,
    private readonly eventBus: EventBus | null,
    private readonly registry: ConnectorRegistry,
    options: ConnectorServiceOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.publicBaseUrl = (options.publicBaseUrl ?? process.env.OMNI_PUBLIC_URL ?? '').replace(/\/+$/, '');
  }

  /** Tenant of the active request scope, or null in the legacy world. */
  private get tenantId(): string | null {
    return currentTenantScope()?.tenantId ?? null;
  }

  /** Filter a tenant-owned column to the active scope (NULL in the legacy world). */
  private tenantFilter(column: AnyColumn) {
    const tenantId = this.tenantId;
    return tenantId ? eq(column, tenantId) : isNull(column);
  }

  private inboundUrl(subscriptionId: string): string {
    const path = `/api/v2/connectors/events/${subscriptionId}`;
    return this.publicBaseUrl ? `${this.publicBaseUrl}${path}` : path;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Credentials
  // ───────────────────────────────────────────────────────────────────────────

  private openCredentials(row: Connector): Record<string, string> | null {
    const raw = openCredentialField(row.tenantId ?? null, row.credentials);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string') out[key] = value;
      }
      return out;
    } catch {
      return null;
    }
  }

  private requireCredentials(row: Connector): Record<string, string> {
    const opened = this.openCredentials(row);
    if (!opened) {
      throw new OmniError({
        code: 'CONNECTOR_NOT_CONNECTED',
        message: 'Connector credential is unavailable; reconnect with a valid credential.',
      });
    }
    return opened;
  }

  sanitizeConnector(row: Connector, hasCredentials?: boolean): ConnectorView {
    const opened = hasCredentials === undefined ? this.openCredentials(row) : null;
    // A stored credential that no longer opens (wrong tenant, key withdrawn)
    // is not a silent empty string: surface it as an error state with a
    // readable cause. This is a VIEW concern — reads do not mutate the row.
    const unopenable = hasCredentials === undefined && row.credentials.length > 0 && opened === null;
    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      status: unopenable ? 'error' : row.status,
      config: row.config ?? {},
      hasCredentials: hasCredentials ?? opened !== null,
      lastValidatedAt: row.lastValidatedAt,
      lastError: unopenable ? 'credential unavailable' : row.lastError,
      lastErrorCode: unopenable ? 'CREDENTIAL_UNAVAILABLE' : row.lastErrorCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private sanitizeSubscription(row: ConnectorEventSubscription): EventSubscriptionView {
    return {
      id: row.id,
      connectorId: row.connectorId,
      providerEventKey: row.providerEventKey,
      filters: row.filters ?? {},
      targetAutomationId: row.targetAutomationId,
      status: row.status,
      inboundUrl: this.inboundUrl(row.id),
      lastDeliveryAt: row.lastDeliveryAt,
      lastFailureAt: row.lastFailureAt,
      consecutiveFailures: row.consecutiveFailures,
      totalDeliveries: row.totalDeliveries,
      totalDuplicates: row.totalDuplicates,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Provider catalog
  // ───────────────────────────────────────────────────────────────────────────

  listProviders() {
    return this.registry.list().map(providerSummary);
  }

  getProvider(id: string) {
    const manifest = this.registry.get(id);
    if (!manifest) {
      throw new OmniError({
        code: 'CONNECTOR_PROVIDER_UNKNOWN',
        message: `Unknown connector provider: ${id}`,
      });
    }
    return providerDetail(manifest);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Connector lifecycle
  // ───────────────────────────────────────────────────────────────────────────

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const [existing] = await this.db
      .select({ id: connectors.id })
      .from(connectors)
      .where(and(this.tenantFilter(connectors.tenantId), eq(connectors.name, name)))
      .limit(1);
    if (existing && existing.id !== exceptId) {
      throw new ValidationError(`A connector named "${name}" already exists`);
    }
  }

  private async insertConnector(values: {
    provider: string;
    name: string;
    credentials: string;
    config: Record<string, unknown>;
    status: string;
    lastValidatedAt: Date | null;
    lastError: string | null;
    lastErrorCode: string | null;
    createdBy: string | null;
    tenantId: string | null;
  }): Promise<Connector> {
    const [created] = await this.db.insert(connectors).values(values).returning();
    if (!created) throw new Error('Failed to create connector');
    return created;
  }

  async create(input: CreateConnectorBody, actor?: string | null): Promise<ConnectorView> {
    const manifest = this.registry.get(input.provider);
    if (!manifest) {
      throw new OmniError({
        code: 'CONNECTOR_PROVIDER_UNKNOWN',
        message: `Unknown connector provider: ${input.provider}`,
      });
    }
    const config = this.parseConfig(manifest, input.config ?? {});
    this.assertCredentialKeys(manifest, input.credentials);
    await this.assertNameFree(input.name);

    const tenantId = this.tenantId;
    const validation = await this.runValidation(manifest, input.credentials, config);
    const sealed = sealCredentialField(tenantId, JSON.stringify(input.credentials)) as string;
    const row = await this.insertConnector({
      provider: manifest.id,
      name: input.name,
      credentials: sealed,
      config,
      status: validation.ok ? 'connected' : 'error',
      lastValidatedAt: validation.ok ? new Date() : null,
      lastError: validation.ok ? null : validation.message,
      lastErrorCode: validation.ok ? null : validation.code,
      createdBy: actor?.slice(0, 255) ?? null,
      tenantId,
    });
    return this.sanitizeConnector(row, Object.keys(input.credentials).length > 0);
  }

  async list(
    options: ConnectorListOptions = {},
  ): Promise<{ items: ConnectorView[]; hasMore: boolean; cursor?: string }> {
    const { provider, status, limit = 50, cursor } = options;
    const conditions = [this.tenantFilter(connectors.tenantId)];
    if (provider) conditions.push(eq(connectors.provider, provider));
    if (status) conditions.push(eq(connectors.status, status));
    if (cursor) conditions.push(gt(connectors.id, cursor));

    const rows = await this.db
      .select()
      .from(connectors)
      .where(and(...conditions))
      .orderBy(connectors.createdAt)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    return {
      items: rows.map((row) => this.sanitizeConnector(row)),
      hasMore,
      ...(rows.length > 0 ? { cursor: rows[rows.length - 1]?.id } : {}),
    };
  }

  async getById(id: string): Promise<ConnectorView> {
    return this.sanitizeConnector(await this.getRow(id));
  }

  async getRow(id: string): Promise<Connector> {
    const [row] = await this.db
      .select()
      .from(connectors)
      .where(and(eq(connectors.id, id), this.tenantFilter(connectors.tenantId)))
      .limit(1);
    if (!row) throw new NotFoundError('Connector', id);
    return row;
  }

  async update(id: string, input: UpdateConnectorBody): Promise<ConnectorView> {
    const existing = await this.getRow(id);
    const manifest = this.registry.get(existing.provider);
    if (!manifest) {
      throw new OmniError({
        code: 'CONNECTOR_PROVIDER_UNKNOWN',
        message: `Connector references unknown provider: ${existing.provider}`,
      });
    }
    if (input.name !== undefined) await this.assertNameFree(input.name, id);

    const patch: Partial<typeof connectors.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;

    const config = input.config !== undefined ? this.parseConfig(manifest, input.config) : (existing.config ?? {});
    if (input.config !== undefined) patch.config = config;

    if (input.credentials !== undefined) {
      this.assertCredentialKeys(manifest, input.credentials);
      const validation = await this.runValidation(manifest, input.credentials, config);
      // Seal under the tenant the PERSISTED ROW presents back, never the
      // active scope: a row with a NULL tenant cannot be opened by a
      // scope-sealed envelope.
      patch.credentials = sealCredentialField(existing.tenantId ?? null, JSON.stringify(input.credentials)) as string;
      patch.status = validation.ok ? 'connected' : 'error';
      patch.lastValidatedAt = validation.ok ? new Date() : null;
      patch.lastError = validation.ok ? null : validation.message;
      patch.lastErrorCode = validation.ok ? null : validation.code;
    }

    const [updated] = await this.db.update(connectors).set(patch).where(eq(connectors.id, id)).returning();
    if (!updated) throw new NotFoundError('Connector', id);
    return this.sanitizeConnector(updated);
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.db
      .delete(connectors)
      .where(and(eq(connectors.id, id), this.tenantFilter(connectors.tenantId)))
      .returning({ id: connectors.id });
    if (deleted.length === 0) throw new NotFoundError('Connector', id);
  }

  private parseConfig(manifest: ConnectorManifest, input: Record<string, unknown>): Record<string, unknown> {
    const parsed = manifest.configSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid connector config: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data as Record<string, unknown>;
  }

  private assertCredentialKeys(manifest: ConnectorManifest, credentials: Record<string, string>): void {
    const accepted = new Set(manifest.credentialFields.map((field) => field.key));
    for (const key of Object.keys(credentials)) {
      if (!accepted.has(key)) {
        throw new ValidationError(`Unknown credential field "${key}" for provider ${manifest.id}`);
      }
    }
    for (const field of manifest.credentialFields) {
      if (!field.optional && !credentials[field.key]) {
        throw new ValidationError(`Missing required credential "${field.key}" for provider ${manifest.id}`);
      }
    }
  }

  private async runValidation(
    manifest: ConnectorManifest,
    credentials: Record<string, string>,
    config: Record<string, unknown>,
  ) {
    try {
      const result = await manifest.validate({ credentials, config, fetch: this.fetchImpl });
      if (result.ok) return result;
      return {
        ok: false as const,
        code: result.code,
        message: redactSecrets(result.message, this.secretValues(credentials)).slice(0, MAX_ERROR_TEXT),
      };
    } catch (error) {
      return {
        ok: false as const,
        code: 'VALIDATION_FAILED',
        message: redactSecrets(asErrorText(error), this.secretValues(credentials)).slice(0, MAX_ERROR_TEXT),
      };
    }
  }

  private secretValues(credentials: Record<string, string>): string[] {
    return Object.values(credentials).filter((value) => typeof value === 'string' && value.length > 0);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Subscription lifecycle
  // ───────────────────────────────────────────────────────────────────────────

  private async getConnectorRow(connectorId: string): Promise<Connector> {
    return this.getRow(connectorId);
  }

  private async assertTargetAutomation(targetAutomationId: string): Promise<void> {
    const [automation] = await this.db
      .select({ id: automations.id, triggerEventType: automations.triggerEventType })
      .from(automations)
      .where(and(eq(automations.id, targetAutomationId), this.tenantFilter(automations.tenantId)))
      .limit(1);
    if (!automation) {
      throw new ValidationError(`Target automation ${targetAutomationId} was not found`);
    }
    if (automation.triggerEventType !== CONNECTOR_EVENT_TYPE) {
      throw new ValidationError(
        `Target automation triggerEventType must be "${CONNECTOR_EVENT_TYPE}" (got "${automation.triggerEventType}")`,
      );
    }
  }

  async createSubscription(connectorId: string, input: CreateSubscriptionBody): Promise<EventSubscriptionView> {
    const connector = await this.getConnectorRow(connectorId);
    const manifest = this.registry.get(connector.provider);
    if (!manifest) {
      throw new OmniError({
        code: 'CONNECTOR_PROVIDER_UNKNOWN',
        message: `Connector references unknown provider: ${connector.provider}`,
      });
    }
    const event = manifest.events.find((candidate) => candidate.key === input.eventKey);
    if (!event) {
      throw new ValidationError(`Unknown event key "${input.eventKey}" for provider ${manifest.id}`);
    }
    const filters = this.parseFilters(event.filterSchema, input.filters ?? {});
    await this.assertTargetAutomation(input.targetAutomationId);

    const [created] = await this.db
      .insert(connectorEventSubscriptions)
      .values({
        connectorId,
        providerEventKey: input.eventKey,
        filters,
        targetAutomationId: input.targetAutomationId,
        verificationSecret: sealCredentialField(connector.tenantId ?? null, input.verificationSecret) as string,
        status: 'active',
        tenantId: connector.tenantId ?? null,
      })
      .returning();
    if (!created) throw new Error('Failed to create connector event subscription');
    return this.sanitizeSubscription(created);
  }

  private parseFilters(
    filterSchema: ConnectorManifest['events'][number]['filterSchema'],
    filters: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!filterSchema) return filters;
    const parsed = filterSchema.safeParse(filters);
    if (!parsed.success) {
      throw new ValidationError(
        `Invalid subscription filters: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data;
  }

  async listSubscriptions(connectorId: string): Promise<EventSubscriptionView[]> {
    await this.getConnectorRow(connectorId);
    const rows = await this.db
      .select()
      .from(connectorEventSubscriptions)
      .where(
        and(
          eq(connectorEventSubscriptions.connectorId, connectorId),
          this.tenantFilter(connectorEventSubscriptions.tenantId),
        ),
      )
      .orderBy(connectorEventSubscriptions.createdAt);
    return rows.map((row) => this.sanitizeSubscription(row));
  }

  private async getSubscriptionRow(connectorId: string, subscriptionId: string): Promise<ConnectorEventSubscription> {
    const [row] = await this.db
      .select()
      .from(connectorEventSubscriptions)
      .where(
        and(
          eq(connectorEventSubscriptions.id, subscriptionId),
          eq(connectorEventSubscriptions.connectorId, connectorId),
          this.tenantFilter(connectorEventSubscriptions.tenantId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundError('ConnectorEventSubscription', subscriptionId);
    return row;
  }

  async updateSubscription(
    connectorId: string,
    subscriptionId: string,
    input: UpdateSubscriptionBody,
  ): Promise<EventSubscriptionView> {
    const connector = await this.getConnectorRow(connectorId);
    const existing = await this.getSubscriptionRow(connectorId, subscriptionId);
    const manifest = this.registry.get(connector.provider);
    const patch: Partial<typeof connectorEventSubscriptions.$inferInsert> = { updatedAt: new Date() };

    if (input.status !== undefined) patch.status = input.status;
    if (input.filters !== undefined) {
      const event = manifest?.events.find((candidate) => candidate.key === existing.providerEventKey);
      patch.filters = this.parseFilters(event?.filterSchema, input.filters);
    }
    if (input.targetAutomationId !== undefined) {
      await this.assertTargetAutomation(input.targetAutomationId);
      patch.targetAutomationId = input.targetAutomationId;
    }
    if (input.verificationSecret !== undefined) {
      // Seal under the connector's persisted tenant — the row presents it back.
      patch.verificationSecret = sealCredentialField(connector.tenantId ?? null, input.verificationSecret) as string;
    }

    const [updated] = await this.db
      .update(connectorEventSubscriptions)
      .set(patch)
      .where(eq(connectorEventSubscriptions.id, subscriptionId))
      .returning();
    if (!updated) throw new NotFoundError('ConnectorEventSubscription', subscriptionId);
    return this.sanitizeSubscription(updated);
  }

  async deleteSubscription(connectorId: string, subscriptionId: string): Promise<void> {
    await this.getConnectorRow(connectorId);
    const deleted = await this.db
      .delete(connectorEventSubscriptions)
      .where(
        and(
          eq(connectorEventSubscriptions.id, subscriptionId),
          eq(connectorEventSubscriptions.connectorId, connectorId),
          this.tenantFilter(connectorEventSubscriptions.tenantId),
        ),
      )
      .returning({ id: connectorEventSubscriptions.id });
    if (deleted.length === 0) throw new NotFoundError('ConnectorEventSubscription', subscriptionId);
  }

  /**
   * A real delivery through parse → filters → claim → publish, with the
   * signature bypassed. The idempotency key is random, so repeated tests are
   * not deduped.
   */
  async testSubscription(
    connectorId: string,
    subscriptionId: string,
    payload?: Record<string, unknown>,
  ): Promise<{ eventId: string }> {
    const connector = await this.getConnectorRow(connectorId);
    const subscription = await this.getSubscriptionRow(connectorId, subscriptionId);
    const manifest = this.registry.get(connector.provider);
    if (!manifest) {
      throw new OmniError({
        code: 'CONNECTOR_PROVIDER_UNKNOWN',
        message: `Connector references unknown provider: ${connector.provider}`,
      });
    }
    const event = manifest.events.find((candidate) => candidate.key === subscription.providerEventKey);
    if (!event) {
      throw new ValidationError(`Subscription references unknown event key "${subscription.providerEventKey}"`);
    }
    const data = payload ?? event.sample ?? { event: event.key };
    const result = await this.deliver({
      connector,
      subscription,
      eventKey: subscription.providerEventKey,
      data,
      idempotencyKey: `test:${randomUUID()}`,
      test: true,
    });
    return { eventId: result.eventId };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Inbound delivery
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Receive a provider delivery for one subscription.
   *
   * Order: parse JSON → resolve subscription → open secret → verify raw body →
   * paused ack → manifest parse → key/filter match → claim → publish. Unknown,
   * unopenable and badly signed all return the same 401.
   */
  async receive(subscriptionId: string, rawBody: string, headers: Record<string, string>): Promise<DeliveryOutcome> {
    try {
      const value = rawBody.trim().length === 0 ? {} : JSON.parse(rawBody);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Body must be a JSON object' } } };
      }
    } catch {
      return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Body must be JSON' } } };
    }

    const [resolved] = await this.db
      .select({ subscription: connectorEventSubscriptions, connector: connectors })
      .from(connectorEventSubscriptions)
      .innerJoin(connectors, eq(connectors.id, connectorEventSubscriptions.connectorId))
      .where(eq(connectorEventSubscriptions.id, subscriptionId))
      .limit(1);

    if (!resolved) return this.unauthorized();
    const { subscription, connector } = resolved;
    const manifest = this.registry.get(connector.provider);
    if (!manifest) return this.unauthorized();

    const secret = openCredentialField(
      subscription.tenantId ?? connector.tenantId ?? null,
      subscription.verificationSecret,
    );
    if (!secret) {
      log.warn('Connector subscription has no usable verification secret', { subscriptionId });
      return this.unauthorized();
    }

    if (!(await verifyDelivery(manifest.verification, rawBody, headers, secret))) {
      log.warn('Connector delivery signature rejected', { subscriptionId });
      return this.unauthorized();
    }

    if (subscription.status === 'paused') {
      return { status: 202, body: { received: true, ignored: true } };
    }

    let parsed: ConnectorParsedDelivery;
    try {
      if (!manifest.parseDelivery) {
        return await this.failDelivery(subscription, 'Provider manifest cannot parse deliveries');
      }
      parsed = manifest.parseDelivery(rawBody, headers);
    } catch (error) {
      return await this.failDelivery(subscription, redactSecrets(asErrorText(error), [secret]));
    }

    if (parsed.eventKey !== subscription.providerEventKey) {
      return { status: 202, body: { received: true, ignored: true } };
    }
    if (!matchesFilters(parsed.data, subscription.filters ?? {})) {
      return { status: 202, body: { received: true, ignored: true } };
    }

    const idempotencyKey = this.idempotencyKey(subscription.id, parsed.providerEventId, rawBody);
    try {
      const result = await this.deliver({
        connector,
        subscription,
        eventKey: parsed.eventKey,
        providerEventId: parsed.providerEventId,
        occurredAt: parsed.occurredAt,
        data: redactValue(parsed.data, [secret]),
        idempotencyKey,
        test: false,
      });
      if (result.duplicate) {
        return {
          status: 200,
          body: { received: true, duplicate: true, eventId: result.eventId },
        };
      }
      return { status: 202, body: { received: true, eventId: result.eventId } };
    } catch (error) {
      // `deliver` already recorded the failure and released the claim; do not
      // increment the counter a second time here.
      log.warn('Connector delivery failed', {
        subscriptionId: subscription.id,
        error: redactSecrets(asErrorText(error), [secret]).slice(0, 200),
      });
      return {
        status: 500,
        body: { error: { code: 'DELIVERY_FAILED', message: 'Connector delivery could not be processed' } },
      };
    }
  }

  private unauthorized(): DeliveryOutcome {
    return { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Connector verification failed' } } };
  }

  private idempotencyKey(subscriptionId: string, providerEventId: string | undefined, rawBody: string): string {
    return deriveConnectorIdempotencyKey(subscriptionId, providerEventId, rawBody);
  }

  /**
   * Claim the journal row, publish under its id, update counters.
   *
   * The claim is inserted BEFORE publish so the unique index is the dedupe
   * authority; a failed publish deletes the claim so the provider's retry can
   * claim it again. `deliver` throws on a processing failure after recording
   * it on the subscription.
   */
  private async deliver(args: {
    connector: Connector;
    subscription: ConnectorEventSubscription;
    eventKey: string;
    providerEventId?: string;
    occurredAt?: string;
    data: Record<string, unknown>;
    idempotencyKey: string;
    test: boolean;
  }): Promise<{ eventId: string; duplicate: boolean }> {
    const { connector, subscription, eventKey, providerEventId, occurredAt, data } = args;
    const eventId = randomUUID();

    const payload = buildConnectorEventPayload({
      connectorId: connector.id,
      subscriptionId: subscription.id,
      targetAutomationId: subscription.targetAutomationId,
      provider: connector.provider,
      eventKey,
      providerEventId,
      occurredAt,
      data,
    });

    const metadata: Record<string, unknown> = {
      correlationId: eventId,
      source: 'connector',
      connectorId: connector.id,
      subscriptionId: subscription.id,
      provider: connector.provider,
      fullEventType: CONNECTOR_EVENT_TYPE,
      ...(args.test ? { test: true } : {}),
    };

    const claimed = await this.db
      .insert(omniEvents)
      .values({
        id: eventId,
        channel: 'internal',
        direction: 'internal',
        eventType: CONNECTOR_EVENT_TYPE,
        status: 'received',
        idempotencyKey: args.idempotencyKey,
        rawPayload: payload,
        metadata,
        receivedAt: new Date(),
        tenantId: subscription.tenantId ?? connector.tenantId ?? null,
      })
      .onConflictDoNothing({ target: omniEvents.idempotencyKey })
      .returning({ id: omniEvents.id });

    if (claimed.length === 0) {
      const [original] = await this.db
        .select({ id: omniEvents.id })
        .from(omniEvents)
        .where(eq(omniEvents.idempotencyKey, args.idempotencyKey))
        .limit(1);
      await this.recordDuplicate(subscription);
      return { eventId: original?.id ?? eventId, duplicate: true };
    }

    try {
      if (!this.eventBus) throw new Error('Event bus is not available');
      // Published UNDER the claim's id so the journal row and the bus event
      // share one identity.
      await this.eventBus.publishGeneric(CONNECTOR_EVENT_TYPE, payload, {
        publishEventId: eventId,
        source: 'connector',
        correlationId: eventId,
        ...(args.test ? { test: true } : {}),
      });
    } catch (error) {
      await this.db
        .delete(omniEvents)
        .where(eq(omniEvents.id, eventId))
        .catch((releaseError: unknown) => {
          log.error('Failed to release connector delivery claim after publish failure', {
            subscriptionId: subscription.id,
            eventId,
            error: asErrorText(releaseError),
          });
        });
      await this.recordFailure(subscription, redactSecrets(asErrorText(error), [subscription.verificationSecret]));
      throw error;
    }

    await this.recordSuccess(subscription);
    return { eventId, duplicate: false };
  }

  private async failDelivery(subscription: ConnectorEventSubscription, message: string): Promise<DeliveryOutcome> {
    await this.recordFailure(subscription, message);
    log.warn('Connector delivery failed', { subscriptionId: subscription.id, error: message.slice(0, 200) });
    return {
      status: 500,
      body: { error: { code: 'DELIVERY_FAILED', message: 'Connector delivery could not be processed' } },
    };
  }

  private async recordSuccess(subscription: ConnectorEventSubscription): Promise<void> {
    await this.db
      .update(connectorEventSubscriptions)
      .set({
        totalDeliveries: sql`${connectorEventSubscriptions.totalDeliveries} + 1`,
        lastDeliveryAt: new Date(),
        consecutiveFailures: 0,
        // `error` is advisory: a success recovers it.
        status: subscription.status === 'error' ? 'active' : subscription.status,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(connectorEventSubscriptions.id, subscription.id));
  }

  private async recordDuplicate(subscription: ConnectorEventSubscription): Promise<void> {
    await this.db
      .update(connectorEventSubscriptions)
      .set({
        totalDuplicates: sql`${connectorEventSubscriptions.totalDuplicates} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(connectorEventSubscriptions.id, subscription.id));
  }

  private async recordFailure(subscription: ConnectorEventSubscription, message: string): Promise<void> {
    const failures = subscription.consecutiveFailures + 1;
    await this.db
      .update(connectorEventSubscriptions)
      .set({
        consecutiveFailures: failures,
        lastFailureAt: new Date(),
        lastError: message.slice(0, MAX_ERROR_TEXT),
        // `error` is advisory: deliveries keep processing so recovery is reachable.
        status: failures >= 3 ? 'error' : subscription.status === 'error' ? 'error' : 'active',
        updatedAt: new Date(),
      })
      .where(eq(connectorEventSubscriptions.id, subscription.id));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Actions (typed invoke + connector.call)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Save-time action existence check for an automation.
   *
   * `connectorId` may be a template, so only a literal UUID that resolves is
   * checked. A literal reference to a missing connector is not an error at save
   * time (the connector may be created later); the run fails with NOT_FOUND.
   */
  async assertAutomationActions(actions: unknown): Promise<void> {
    if (!Array.isArray(actions)) return;
    for (const candidate of actions) {
      if (candidate === null || typeof candidate !== 'object') continue;
      const action = candidate as { type?: unknown; config?: unknown };
      if (action.type !== 'connector.call') continue;
      const config = action.config as { connectorId?: unknown; action?: unknown } | undefined;
      if (!config || typeof config.connectorId !== 'string' || typeof config.action !== 'string') continue;
      if (config.action.includes('{{')) {
        throw new ValidationError('connector.call action must be a literal manifest action key, not a template');
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.connectorId)) continue;
      let row: Connector;
      try {
        row = await this.getRow(config.connectorId);
      } catch {
        continue;
      }
      const manifest = this.registry.get(row.provider);
      if (manifest && !manifest.actions.some((action) => action.key === config.action)) {
        throw new OmniError({
          code: 'ACTION_UNKNOWN',
          message: `Connector ${row.provider} has no action "${config.action}"`,
        });
      }
    }
  }

  /** Invoke an action over the authenticated API. */
  async invoke(connectorId: string, actionKey: string, input: Record<string, unknown>): Promise<unknown> {
    const prepared = await this.resolveAction(connectorId, actionKey);
    return this.executePrepared(prepared, input);
  }

  /**
   * Resolve a connector + action and open its credentials, WITHOUT a provider
   * call. The automation callback runs this inside a short worker tenant scope,
   * then executes the provider call outside any transaction.
   */
  async resolveAction(
    connectorId: string,
    actionKey: string,
    tenantIdOverride?: string | null,
  ): Promise<PreparedConnectorAction> {
    const row =
      tenantIdOverride === undefined
        ? await this.getRow(connectorId)
        : await this.getRowForTenant(connectorId, tenantIdOverride);
    if (row.status !== 'connected') {
      throw new OmniError({
        code: 'CONNECTOR_NOT_CONNECTED',
        message: `Connector "${row.name}" is ${row.status}; actions require a connected connector.`,
      });
    }
    const manifest = this.registry.get(row.provider);
    if (!manifest) {
      throw new OmniError({
        code: 'CONNECTOR_PROVIDER_UNKNOWN',
        message: `Connector references unknown provider: ${row.provider}`,
      });
    }
    const action = manifest.actions.find((candidate) => candidate.key === actionKey);
    if (!action) {
      throw new OmniError({
        code: 'ACTION_UNKNOWN',
        message: `Connector ${row.provider} has no action "${actionKey}"`,
      });
    }
    return {
      connector: row,
      manifest,
      action,
      credentials: this.requireCredentials(row),
      config: row.config ?? {},
    };
  }

  private async getRowForTenant(connectorId: string, tenantId: string | null): Promise<Connector> {
    const [row] = await this.db
      .select()
      .from(connectors)
      .where(
        and(eq(connectors.id, connectorId), tenantId ? eq(connectors.tenantId, tenantId) : isNull(connectors.tenantId)),
      )
      .limit(1);
    if (!row) throw new NotFoundError('Connector', connectorId);
    return row;
  }

  /** Validate the rendered input and run the provider action. No retry in v1. */
  async executePrepared(
    prepared: PreparedConnectorAction,
    input: Record<string, unknown>,
    timeoutMs?: number,
    trustedTenantId?: string | null,
  ): Promise<unknown> {
    const parsed = prepared.action.inputSchema.safeParse(input);
    if (!parsed.success) {
      throw new OmniError({
        code: 'ACTION_INPUT_INVALID',
        message: `Invalid input for ${prepared.manifest.id}.${prepared.action.key}: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ')}`,
        context: { issues: parsed.error.issues },
      });
    }

    try {
      return await prepared.action.run({
        credentials: prepared.credentials,
        config: prepared.config,
        input: parsed.data as Record<string, unknown>,
        fetch: this.fetchImpl,
        timeoutMs: timeoutMs ?? 30_000,
      });
    } catch (error) {
      const message = redactSecrets(asErrorText(error), Object.values(prepared.credentials)).slice(0, MAX_ERROR_TEXT);
      const status = (error as { status?: unknown }).status;
      if (status === 401 || status === 403) {
        await runTenantWorkDb(this.pool, trustedTenantId ?? null, () =>
          this.db
            .update(connectors)
            .set({ status: 'revoked', lastError: message, lastErrorCode: 'AUTH_FAILED', updatedAt: new Date() })
            .where(eq(connectors.id, prepared.connector.id)),
        );
      }
      throw new OmniError({ code: 'PROVIDER_REJECTED', message });
    }
  }

  /** The automation `connector.call` implementation. */
  async call(request: ConnectorCallRequest, trustedTenantId?: string | null): Promise<unknown> {
    const prepared = await this.resolveAction(request.connectorId, request.action, trustedTenantId ?? null);
    return this.executePrepared(prepared, request.input, request.timeoutMs, trustedTenantId ?? null);
  }
}
