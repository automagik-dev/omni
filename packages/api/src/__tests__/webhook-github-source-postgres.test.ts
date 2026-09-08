/**
 * The GitHub source recipe, end-to-end over the REAL HTTP ingress and real
 * PostgreSQL (issue #983, RFC #925 Phase 3 — source 1 of 2).
 *
 * This suite is the proof of the RFC's claim: "each source = 1 webhook source
 * row + N registered schemas + a key template, ZERO new ingress code". The
 * source row and the four schema artifacts below are EXACTLY what
 * docs/runbooks/github-webhook-source.md tells an operator to configure —
 * the schemas are loaded from the shipped artifacts in
 * docs/examples/event-schemas/github/, so registering them here also proves
 * they compile. Faked GitHub deliveries then go through the unmodified
 * public ingress route (POST /api/v2/webhooks/ingress/github):
 *
 *   * a correctly signed delivery (HMAC-SHA256 over the raw body,
 *     X-Hub-Signature-256, sha256= prefix) is accepted; a bad signature gets
 *     the uniform 401 and journals NOTHING;
 *   * X-GitHub-Event maps deliveries to the semantic types
 *     custom.github.push / .pull_request / .issues / .release (#959);
 *   * a REDELIVERY (same X-GitHub-Delivery — GitHub's GUID is stable across
 *     redeliveries) responds 200 BOTH times but creates exactly ONE journal
 *     event and ONE bus publish (→ at most one automation firing), with the
 *     source's duplicate counter bumped (#958);
 *   * a signed delivery violating its registered schema is refused with 400
 *     and dead-lettered, never journaled (#959);
 *   * declaring the cadence armed liveness supervision on create (#961).
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventBus } from '@omni/core';
import { type Database, createDbHandle, deadLetterEvents, omniEvents, webhookSources } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { EventSchemaService } from '../services/event-schemas';
import { WebhookService } from '../services/webhooks';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const SECRET = 'gh-recipe-shared-secret-983';
const ARTIFACTS_DIR = join(import.meta.dir, '../../../../docs/examples/event-schemas/github');
const GITHUB_EVENT_TYPES = [
  'custom.github.push',
  'custom.github.pull_request',
  'custom.github.issues',
  'custom.github.release',
] as const;

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-983-github-${crypto.randomUUID()}.sql`);
  writeFileSync(file, script);
  try {
    const result = Bun.spawnSync({
      cmd: [psqlBin, '-X', '--no-psqlrc', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '--dbname', url, '-f', file],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { exitCode: result.exitCode, stderr: result.stderr.toString() };
  } finally {
    rmSync(file, { force: true });
  }
}

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

interface PublishedEvent {
  type: string;
  payload: Record<string, unknown>;
}

/** An EventBus fake that records generic publishes (all this path uses). */
function recordingBus(events: PublishedEvent[]): EventBus {
  return {
    publishGeneric: async (type: string, payload: Record<string, unknown>, metadata?: Record<string, unknown>) => {
      events.push({ type, payload });
      return { id: crypto.randomUUID(), type, timestamp: Date.now(), payload, metadata };
    },
  } as unknown as EventBus;
}

/** Sign a raw body exactly the way GitHub does. */
function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
}

interface GitHubDeliveryOptions {
  /** Overrides the valid signature (e.g. a tampered one). */
  signature?: string;
  /** Drop the X-GitHub-Event header entirely. */
  omitEventHeader?: boolean;
}

interface ReceiveResponse {
  received?: boolean;
  eventId?: string;
  eventType?: string;
  duplicate?: boolean;
  error?: { code: string; message: string };
}

/** Realistic-but-minimal GitHub webhook payloads (the runbook's four types). */
const REPO = { full_name: 'automagik-dev/omni' };
const SENDER = { login: 'vasconceloscezar' };
const PAYLOADS: Record<string, Record<string, unknown>> = {
  push: {
    ref: 'refs/heads/main',
    before: 'a'.repeat(40),
    after: 'b'.repeat(40),
    commits: [{ id: 'b'.repeat(40), message: 'feat(sources): recipe', url: 'https://github.com/x/c/b' }],
    repository: REPO,
    sender: SENDER,
  },
  pull_request: {
    action: 'opened',
    number: 983,
    pull_request: { title: 'GitHub as first real source', state: 'open', merged: false },
    repository: REPO,
    sender: SENDER,
  },
  issues: {
    action: 'closed',
    issue: { number: 983, title: 'plug in GitHub', state: 'closed' },
    repository: REPO,
    sender: SENDER,
  },
  release: {
    action: 'published',
    release: { tag_name: 'v2.260907.4', name: 'v2.260907.4', draft: false, prerelease: false },
    repository: REPO,
    sender: SENDER,
  },
};

postgresDescribe('GitHub source recipe end-to-end (#983, real PostgreSQL)', () => {
  const dbName = `omni_983_github_${crypto.randomUUID().replaceAll('-', '')}`;
  let db: Database;
  let close: () => Promise<void>;
  let app: ReturnType<typeof createApp>['app'];
  const published: PublishedEvent[] = [];

  /** POST a fake GitHub delivery through the real public ingress route. */
  async function deliver(
    githubEvent: string,
    deliveryId: string,
    payload: Record<string, unknown>,
    options: GitHubDeliveryOptions = {},
  ): Promise<{ status: number; json: ReceiveResponse }> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': options.signature ?? sign(body),
      'X-GitHub-Delivery': deliveryId,
    };
    if (!options.omitEventHeader) {
      headers['X-GitHub-Event'] = githubEvent;
    }
    const res = await app.request('/api/v2/webhooks/ingress/github', { method: 'POST', body, headers });
    return { status: res.status, json: (await res.json()) as ReceiveResponse };
  }

  async function journalRowsForKey(key: string) {
    return db.select().from(omniEvents).where(eq(omniEvents.idempotencyKey, key));
  }

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: urlFor(superUrl, dbName), maxConnections: 3 });
    db = handle.db;
    close = handle.close;

    // The runbook's step 1: one webhook_sources row declaring the whole
    // contract. Created through the same service the API route uses.
    await new WebhookService(db, null).create({
      name: 'github',
      description: 'GitHub repo webhooks (#983 recipe)',
      signatureConfig: { algorithm: 'hmac-sha256', header: 'X-Hub-Signature-256', prefix: 'sha256=' },
      signatureSecret: SECRET,
      idempotencyKeyTemplate: 'github:{headers.x-github-delivery}',
      eventTypeMapping: { source: 'header', header: 'X-GitHub-Event' },
      expectedIntervalSeconds: 86_400,
    });

    // The runbook's step 2: register the SHIPPED JSON Schema artifacts —
    // loading them from docs/ proves the artifacts themselves compile.
    const schemaService = new EventSchemaService(db);
    for (const eventType of GITHUB_EVENT_TYPES) {
      const artifact = JSON.parse(readFileSync(join(ARTIFACTS_DIR, `${eventType}.json`), 'utf-8')) as Record<
        string,
        unknown
      >;
      await schemaService.register({ eventType, schema: artifact, description: `${eventType} (#983)` });
    }

    // The real HTTP app over the real database — nothing stubbed.
    ({ app } = createApp(db, recordingBus(published)));
  }, 180_000);

  afterAll(async () => {
    await close?.().catch(() => undefined);
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  test('declaring the cadence armed liveness supervision on create (#961)', async () => {
    const [source] = await db.select().from(webhookSources).where(eq(webhookSources.name, 'github'));
    expect(source?.expectedIntervalSeconds).toBe(86_400);
    expect(source?.livenessStatus).toBe('healthy');
    expect(source?.livenessArmedAt).not.toBeNull();
  });

  test('a correctly signed push lands as custom.github.push under the delivery-id key', async () => {
    const deliveryId = crypto.randomUUID();
    const payload = PAYLOADS.push;
    if (!payload) throw new Error('missing push fixture');

    const { status, json } = await deliver('push', deliveryId, payload);

    expect(status).toBe(200);
    expect(json.received).toBe(true);
    expect(json.eventType).toBe('custom.github.push');
    expect(json.duplicate).toBeUndefined();

    // The journal row exists under the RFC's exact key shape and shares the
    // response's event id (#956/#958: one identity for row + event).
    const rows = await journalRowsForKey(`github:${deliveryId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(json.eventId as string);
    expect(rows[0]?.eventType).toBe('custom.github.push');

    // One bus publish → at most one automation firing.
    expect(published.filter((e) => e.type === 'custom.github.push')).toHaveLength(1);
  });

  test('a bad signature gets the uniform 401 and journals nothing', async () => {
    const deliveryId = crypto.randomUUID();
    const payload = PAYLOADS.push;
    if (!payload) throw new Error('missing push fixture');

    const { status, json } = await deliver('push', deliveryId, payload, { signature: 'sha256=deadbeef' });

    expect(status).toBe(401);
    expect(json.error?.message).toBe('Webhook verification failed');
    expect(await journalRowsForKey(`github:${deliveryId}`)).toHaveLength(0);
  });

  test('a signature over DIFFERENT body bytes is rejected (raw-body HMAC, not re-serialization)', async () => {
    const deliveryId = crypto.randomUUID();
    const payload = PAYLOADS.push;
    if (!payload) throw new Error('missing push fixture');

    const { status } = await deliver('push', deliveryId, payload, {
      signature: sign(JSON.stringify({ ...payload, after: 'c'.repeat(40) })),
    });

    expect(status).toBe(401);
    expect(await journalRowsForKey(`github:${deliveryId}`)).toHaveLength(0);
  });

  test.each([
    ['pull_request', 'custom.github.pull_request'],
    ['issues', 'custom.github.issues'],
    ['release', 'custom.github.release'],
  ])('X-GitHub-Event: %s maps to %s (#959)', async (githubEvent, expectedType) => {
    const payload = PAYLOADS[githubEvent];
    if (!payload) throw new Error(`missing fixture for ${githubEvent}`);

    const { status, json } = await deliver(githubEvent, crypto.randomUUID(), payload);

    expect(status).toBe(200);
    expect(json.eventType).toBe(expectedType);
  });

  test('a delivery without X-GitHub-Event falls back to the collapsed legacy type', async () => {
    // GitHub always sends the header; the fallback is the ingress contract
    // for a mapped source when the mapping cannot resolve (#959).
    const { status, json } = await deliver('unused', crypto.randomUUID(), PAYLOADS.push ?? {}, {
      omitEventHeader: true,
    });

    expect(status).toBe(200);
    expect(json.eventType).toBe('custom.webhook.github');
  });

  test('CRITICAL: a redelivery (same X-GitHub-Delivery) is 200 both times but journals exactly ONE event', async () => {
    const deliveryId = crypto.randomUUID();
    const payload = PAYLOADS.release;
    if (!payload) throw new Error('missing release fixture');
    const publishedBefore = published.length;
    const [sourceBefore] = await db.select().from(webhookSources).where(eq(webhookSources.name, 'github'));

    const first = await deliver('release', deliveryId, payload);
    const second = await deliver('release', deliveryId, payload);

    // GitHub must see success both times so it stops redelivering.
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.json.duplicate).toBeUndefined();
    expect(second.json.duplicate).toBe(true);
    // The duplicate ack points at the ORIGINAL event.
    expect(second.json.eventId).toBe(first.json.eventId);

    // Exactly one journal event and one bus publish for the delivery.
    expect(await journalRowsForKey(`github:${deliveryId}`)).toHaveLength(1);
    expect(published.length).toBe(publishedBefore + 1);

    // The redelivery is visible on the source's counters.
    const [sourceAfter] = await db.select().from(webhookSources).where(eq(webhookSources.name, 'github'));
    expect(sourceAfter?.totalDuplicates).toBe((sourceBefore?.totalDuplicates ?? 0) + 1);
  });

  test('a signed delivery violating its registered schema is 400 + dead-lettered, never journaled (#959)', async () => {
    const deliveryId = crypto.randomUUID();
    // `ref`, `repository` and `sender` are required by the shipped artifact.
    const invalid = { commits: [] };

    const { status, json } = await deliver('push', deliveryId, invalid);

    expect(status).toBe(400);
    expect(json.error?.message).toContain('schema_validation_failed');
    expect(await journalRowsForKey(`github:${deliveryId}`)).toHaveLength(0);

    const dlq = await db
      .select()
      .from(deadLetterEvents)
      .where(eq(deadLetterEvents.eventType, 'custom.github.push'))
      .limit(5);
    expect(dlq.length).toBeGreaterThanOrEqual(1);
    expect(dlq[0]?.error).toContain('schema_validation_failed');
  });
});
