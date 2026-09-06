/**
 * Event schema registry service (issue #959, RFC #925 G1).
 *
 * Owns the `event_schemas` table: one row per event_type holding the payload
 * contract as a JSON Schema artifact (Zod-first — core contracts export via
 * `zodToEventJsonSchema`; external registrations arrive as JSON Schema and
 * are stored as-is). Validation for BOTH origins runs on the one engine in
 * `@omni/core` (`validateEventPayload`).
 *
 * The registry is opt-in per type: `validate()` on an unregistered type
 * reports `registered: false, valid: true` and the gates pass the payload
 * through unchanged. Flipping to deny-by-default is a later policy switch.
 *
 * Evolution rule (enforced in `register`): replacing an existing type's
 * schema must be additive-optional; an incompatible change is refused with a
 * 409 and must ship as a new versioned event_type (`custom.github.push.v2`).
 */

import {
  ConflictError,
  NotFoundError,
  ValidationError,
  checkSchemaCompatibility,
  createLogger,
  isValidJsonSchema,
  jsonEquals,
  validateEventPayload,
} from '@omni/core';
import type { Database, EventSchemaRow } from '@omni/db';
import { eventSchemas } from '@omni/db';
import { eq } from 'drizzle-orm';
import { scopedHandle } from '../tenancy/tenant-scope';

const log = createLogger('api:event-schemas');

/** Gate-path lookup cache TTL. The gates consult the registry on every
 * publish; 10s of staleness after a register/update is acceptable there. */
const GATE_CACHE_TTL_MS = 10_000;

export interface RegisterEventSchemaInput {
  eventType: string;
  /** JSON Schema (draft-07) artifact, stored as-is. */
  schema: Record<string, unknown>;
  description?: string;
  enabled?: boolean;
}

export interface EventSchemaGateVerdict {
  /** False when no enabled schema exists for the type (pass-through). */
  registered: boolean;
  valid: boolean;
  errors: string[];
}

export class EventSchemaService {
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

  /** Per-process gate cache: eventType → enabled row (or null) + expiry. */
  private readonly gateCache = new Map<string, { row: EventSchemaRow | null; expiresAt: number }>();

  constructor(private readonly pool: Database) {}

  /**
   * Register a schema for an event type, or revise an existing one.
   *
   * First registration inserts at version 1. A revision is accepted only when
   * it satisfies the additive-optional evolution rule; re-registering a
   * byte-identical artifact is idempotent (no version bump).
   */
  async register(input: RegisterEventSchemaInput): Promise<EventSchemaRow> {
    const wellFormed = isValidJsonSchema(input.schema);
    if (!wellFormed.ok) {
      throw new ValidationError(`schema is not a valid JSON Schema: ${wellFormed.error}`, undefined, {
        eventType: input.eventType,
      });
    }

    const existing = await this.getByType(input.eventType);
    const row = existing ? await this.revise(existing, input) : await this.insert(input);
    this.gateCache.delete(input.eventType);
    return row;
  }

  private async insert(input: RegisterEventSchemaInput): Promise<EventSchemaRow> {
    const [created] = await this.db
      .insert(eventSchemas)
      .values({
        eventType: input.eventType,
        schema: input.schema,
        description: input.description,
        enabled: input.enabled ?? true,
      })
      .returning();
    if (!created) {
      throw new Error('Failed to register event schema');
    }
    log.info('Event schema registered', { eventType: created.eventType, version: created.version });
    return created;
  }

  private async revise(existing: EventSchemaRow, input: RegisterEventSchemaInput): Promise<EventSchemaRow> {
    // Structural, key-order-agnostic comparison: stored jsonb normalizes key
    // order, so a byte comparison would bump the version on every re-register.
    const identical = jsonEquals(existing.schema, input.schema);
    if (!identical) {
      const compat = checkSchemaCompatibility(existing.schema, input.schema);
      if (!compat.compatible) {
        throw new ConflictError(
          'EventSchema',
          `incompatible schema change for '${existing.eventType}' — the evolution rule is additive-optional; ` +
            `ship a breaking contract as a new versioned event_type (e.g. '${existing.eventType}.v2'). ` +
            `Violations: ${compat.reasons.join('; ')}`,
          { eventType: existing.eventType, currentVersion: existing.version, violations: compat.reasons },
        );
      }
    }

    const [updated] = await this.db
      .update(eventSchemas)
      .set({
        schema: input.schema,
        version: identical ? existing.version : existing.version + 1,
        description: input.description ?? existing.description,
        enabled: input.enabled ?? existing.enabled,
        updatedAt: new Date(),
      })
      .where(eq(eventSchemas.id, existing.id))
      .returning();
    if (!updated) {
      throw new NotFoundError('EventSchema', existing.eventType);
    }
    log.info('Event schema revised', { eventType: updated.eventType, version: updated.version });
    return updated;
  }

  /** List registered schemas (optionally only enabled ones). */
  async list(options: { enabled?: boolean } = {}): Promise<EventSchemaRow[]> {
    let query = this.db.select().from(eventSchemas).$dynamic();
    if (options.enabled !== undefined) {
      query = query.where(eq(eventSchemas.enabled, options.enabled));
    }
    return query.orderBy(eventSchemas.eventType);
  }

  /** Get a schema row by event type, or null when unregistered. */
  async getByType(eventType: string): Promise<EventSchemaRow | null> {
    const [row] = await this.db.select().from(eventSchemas).where(eq(eventSchemas.eventType, eventType)).limit(1);
    return row ?? null;
  }

  /** Get a schema row by event type, throwing 404 when unregistered. */
  async getByTypeOrThrow(eventType: string): Promise<EventSchemaRow> {
    const row = await this.getByType(eventType);
    if (!row) {
      throw new NotFoundError('EventSchema', eventType);
    }
    return row;
  }

  /**
   * The validation gate. Unregistered (or disabled) types pass through —
   * the registry is opt-in per type.
   */
  async validate(eventType: string, payload: unknown): Promise<EventSchemaGateVerdict> {
    const row = await this.lookupForGate(eventType);
    if (!row) {
      return { registered: false, valid: true, errors: [] };
    }
    const verdict = validateEventPayload(row.schema, payload);
    return { registered: true, valid: verdict.valid, errors: verdict.errors };
  }

  private async lookupForGate(eventType: string): Promise<EventSchemaRow | null> {
    const cached = this.gateCache.get(eventType);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.row;
    }
    const row = await this.getByType(eventType);
    const usable = row?.enabled ? row : null;
    this.gateCache.set(eventType, { row: usable, expiresAt: Date.now() + GATE_CACHE_TTL_MS });
    return usable;
  }
}
