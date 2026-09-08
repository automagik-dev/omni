/**
 * Agent event subscription manifest (RFC #925 G4a — issue #985).
 *
 * Declarative `accepts` / `publishes` contract stored on the agent record
 * (`agents.event_manifest` jsonb). The DB is the source of truth; teams that
 * want git history keep a YAML/JSON file in their repo and apply it with
 * `omni agents manifest apply <agent> --file <path>`.
 *
 * This slice is STORAGE + READ SURFACE ONLY:
 *   - G4b (#986) compiles `accepts` entries into automations (routing).
 *   - G4c (#987) enforces `publishes` at emission time.
 * Nothing in this module implements matching or routing behavior.
 */

import { z } from 'zod';
import { isCoreEvent, isCustomEvent, isSystemEvent } from '../events/types';

/**
 * Event-type token shape: dot-separated lowercase tokens
 * (e.g. `custom.clickup.task.status_changed`). Same naming rule the event
 * schema registry enforces at registration (#959).
 */
export const EVENT_TYPE_TOKEN_PATTERN = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;

/**
 * A manifest event-type token. Must match the registry token shape AND belong
 * to a known namespace: a core event type (`CORE_EVENT_TYPES`), a `custom.*`
 * event, or a `system.*` event — see `isCoreEvent` / `isCustomEvent` /
 * `isSystemEvent` in `packages/core/src/events/types.ts`.
 */
export const ManifestEventTypeSchema = z
  .string()
  .min(3)
  .max(255)
  .regex(EVENT_TYPE_TOKEN_PATTERN, 'Event type must be dot-separated lowercase tokens (e.g. custom.github.push)')
  .refine((type) => isCoreEvent(type) || isCustomEvent(type) || isSystemEvent(type), {
    message:
      'Event type must be a core event type, or namespaced under custom.* / system.* ' +
      '(e.g. custom.clickup.task.status_changed)',
  });

/**
 * One `accepts` entry: an event type this agent consumes, optionally narrowed
 * by a payload filter.
 *
 * `filter` uses the SAME payload-field matcher semantics as automation
 * conditions (see `packages/core/src/automations/conditions.ts`): each key is
 * a dot-notation path into the event payload (resolved like `getNestedValue`,
 * array indices allowed — `items.0.name`), and each value is the expected
 * payload value under the automation `equals` operator. All entries must match
 * (AND logic). Matching is NOT implemented here — G4b (#986) compiles these
 * entries into automation conditions, which own the evaluation.
 */
export const ManifestAcceptsEntrySchema = z
  .object({
    event: ManifestEventTypeSchema,
    filter: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ManifestAcceptsEntry = z.infer<typeof ManifestAcceptsEntrySchema>;

/**
 * One `publishes` entry: an event type this agent declares it may emit.
 * Declaration only in this slice — G4c (#987) adds emission-time enforcement.
 */
export const ManifestPublishesEntrySchema = z
  .object({
    event: ManifestEventTypeSchema,
  })
  .strict();

export type ManifestPublishesEntry = z.infer<typeof ManifestPublishesEntrySchema>;

/**
 * The full agent event manifest, as stored in `agents.event_manifest`.
 *
 * ```yaml
 * accepts:
 *   - event: custom.clickup.task.status_changed
 *     filter: { list_id: "901300373349" }
 * publishes:
 *   - event: custom.review.parecer.ready
 * ```
 */
export const AgentEventManifestSchema = z
  .object({
    accepts: z.array(ManifestAcceptsEntrySchema).max(200).default([]),
    publishes: z.array(ManifestPublishesEntrySchema).max(200).default([]),
  })
  .strict();

export type AgentEventManifest = z.infer<typeof AgentEventManifestSchema>;
