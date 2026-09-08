/**
 * Agent event manifest schema (RFC #925 G4a — issue #985).
 *
 * Storage-shape validation only: event-type tokens must follow the existing
 * naming rules (core enum, custom.*, system.*) and the accepts/publishes
 * entries must be well-formed. No matching semantics are tested here —
 * `filter` evaluation belongs to the automation conditions matcher (G4b, #986).
 */

import { describe, expect, test } from 'bun:test';
import { AgentEventManifestSchema, ManifestEventTypeSchema, checkPublishAllowed } from '../agent-manifest';

describe('ManifestEventTypeSchema', () => {
  test('accepts core event types', () => {
    expect(ManifestEventTypeSchema.safeParse('message.received').success).toBe(true);
    expect(ManifestEventTypeSchema.safeParse('agent.task.completed').success).toBe(true);
  });

  test('accepts namespaced custom event types', () => {
    expect(ManifestEventTypeSchema.safeParse('custom.clickup.task.status_changed').success).toBe(true);
    expect(ManifestEventTypeSchema.safeParse('custom.github.push.v2').success).toBe(true);
  });

  test('accepts namespaced system event types', () => {
    expect(ManifestEventTypeSchema.safeParse('system.agent.manifest.updated').success).toBe(true);
  });

  test('rejects tokens outside every namespace', () => {
    // Shaped like an event type but neither core, custom.* nor system.*
    expect(ManifestEventTypeSchema.safeParse('review.parecer.ready').success).toBe(false);
    expect(ManifestEventTypeSchema.safeParse('clickup.task').success).toBe(false);
  });

  test('rejects malformed tokens', () => {
    expect(ManifestEventTypeSchema.safeParse('Not A Type!').success).toBe(false);
    expect(ManifestEventTypeSchema.safeParse('custom.').success).toBe(false);
    expect(ManifestEventTypeSchema.safeParse('custom').success).toBe(false);
    expect(ManifestEventTypeSchema.safeParse('custom..double.dot').success).toBe(false);
    expect(ManifestEventTypeSchema.safeParse('CUSTOM.UPPER.CASE').success).toBe(false);
    expect(ManifestEventTypeSchema.safeParse('').success).toBe(false);
  });
});

describe('AgentEventManifestSchema', () => {
  test('accepts the RFC-shaped manifest', () => {
    const parsed = AgentEventManifestSchema.parse({
      accepts: [{ event: 'custom.clickup.task.status_changed', filter: { list_id: '901300373349' } }],
      publishes: [{ event: 'custom.review.parecer.ready' }],
    });
    expect(parsed.accepts).toHaveLength(1);
    expect(parsed.accepts[0]?.filter).toEqual({ list_id: '901300373349' });
    expect(parsed.publishes[0]?.event).toBe('custom.review.parecer.ready');
  });

  test('defaults omitted sections to empty arrays', () => {
    const parsed = AgentEventManifestSchema.parse({});
    expect(parsed.accepts).toEqual([]);
    expect(parsed.publishes).toEqual([]);
  });

  test('accepts entries without a filter (filter is optional)', () => {
    const parsed = AgentEventManifestSchema.parse({ accepts: [{ event: 'message.received' }] });
    expect(parsed.accepts[0]?.filter).toBeUndefined();
  });

  test('allows dot-notation payload paths as filter keys', () => {
    const result = AgentEventManifestSchema.safeParse({
      accepts: [{ event: 'custom.github.push', filter: { 'repository.full_name': 'automagik-dev/omni' } }],
    });
    expect(result.success).toBe(true);
  });

  test('rejects a bad event token inside accepts', () => {
    const result = AgentEventManifestSchema.safeParse({ accepts: [{ event: 'not-an-event' }] });
    expect(result.success).toBe(false);
  });

  test('rejects a bad event token inside publishes', () => {
    const result = AgentEventManifestSchema.safeParse({ publishes: [{ event: 'review.parecer.ready' }] });
    expect(result.success).toBe(false);
  });

  test('rejects unknown keys (typo protection)', () => {
    expect(AgentEventManifestSchema.safeParse({ accept: [{ event: 'message.received' }] }).success).toBe(false);
    expect(AgentEventManifestSchema.safeParse({ accepts: [{ event: 'message.received', filters: {} }] }).success).toBe(
      false,
    );
  });

  test('rejects plain-string entries (entries are objects, matching the RFC YAML)', () => {
    expect(AgentEventManifestSchema.safeParse({ publishes: ['custom.review.parecer.ready'] }).success).toBe(false);
  });
});

/**
 * Publish-allowlist semantics (RFC #925 G4c — issue #987).
 *
 * The decided contract, exhaustively:
 *   - no manifest → ungoverned (allowed)
 *   - manifest without a `publishes` key → ungoverned (allowed) — the
 *     document never spoke about publishing (only reachable for jsonb
 *     written outside the validated apply path, which defaults absent → [])
 *   - `publishes: []` → deny ALL (the agent declared "publishes nothing")
 *   - non-empty `publishes` → exact declared types only
 */
describe('checkPublishAllowed', () => {
  const declared = { publishes: [{ event: 'custom.review.parecer.ready' }, { event: 'custom.alerts.raised' }] };

  test('no manifest (null/undefined) → allowed (ungoverned, no flag day)', () => {
    expect(checkPublishAllowed(null, 'custom.anything.goes')).toBe(true);
    expect(checkPublishAllowed(undefined, 'custom.anything.goes')).toBe(true);
  });

  test('manifest without a publishes key → allowed (the document does not govern publishing)', () => {
    expect(checkPublishAllowed({}, 'custom.anything.goes')).toBe(true);
    expect(checkPublishAllowed({ publishes: undefined }, 'custom.anything.goes')).toBe(true);
    expect(checkPublishAllowed({ publishes: null }, 'custom.anything.goes')).toBe(true);
  });

  test('malformed publishes (non-array jsonb) → allowed, matching the absent-key stance', () => {
    expect(checkPublishAllowed({ publishes: 'custom.x.y' } as unknown as { publishes: [] }, 'custom.x.y')).toBe(true);
  });

  test('empty publishes array → deny ALL (an empty allowlist is an allowlist)', () => {
    expect(checkPublishAllowed({ publishes: [] }, 'custom.review.parecer.ready')).toBe(false);
    expect(checkPublishAllowed({ publishes: [] }, 'message.received')).toBe(false);
  });

  test('declared type → allowed', () => {
    expect(checkPublishAllowed(declared, 'custom.review.parecer.ready')).toBe(true);
    expect(checkPublishAllowed(declared, 'custom.alerts.raised')).toBe(true);
  });

  test('undeclared type → denied', () => {
    expect(checkPublishAllowed(declared, 'custom.review.parecer.draft')).toBe(false);
    expect(checkPublishAllowed(declared, 'custom.alerts')).toBe(false);
  });

  test('matching is exact — no prefix/wildcard semantics', () => {
    expect(checkPublishAllowed(declared, 'custom.review.parecer.ready.v2')).toBe(false);
    expect(checkPublishAllowed({ publishes: [{ event: 'custom.review' }] }, 'custom.review.parecer.ready')).toBe(false);
  });

  test('a parsed full manifest (accepts + publishes) governs by its publishes half only', () => {
    const manifest = AgentEventManifestSchema.parse({
      accepts: [{ event: 'custom.clickup.task.status_changed' }],
      publishes: [{ event: 'custom.review.parecer.ready' }],
    });
    expect(checkPublishAllowed(manifest, 'custom.review.parecer.ready')).toBe(true);
    // Accepting a type does NOT grant the right to publish it.
    expect(checkPublishAllowed(manifest, 'custom.clickup.task.status_changed')).toBe(false);
  });

  test('an apply-path manifest that omitted publishes governs as deny-all (Zod defaults absent → [])', () => {
    const manifest = AgentEventManifestSchema.parse({ accepts: [{ event: 'message.received' }] });
    expect(manifest.publishes).toEqual([]);
    expect(checkPublishAllowed(manifest, 'custom.anything.goes')).toBe(false);
  });
});
