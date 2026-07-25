/**
 * Composition-root wiring safety net (G5; ADR-0008).
 *
 * Three of this leg's conversions are opted into the tenant world by ONE line
 * each in `index.ts`, and `index.ts` is the one composition root no test can
 * reach: `main()` and `setupEventBusServices` are module-private, the module
 * self-invokes `main()` and has import-time side effects (`./instrument`,
 * `./tracing`, module-scope `configureLogging`), and nothing under `packages/`
 * imports it. The sibling wirings live in `createServices`, which ~40 test files
 * exercise through `createApp`; these three do not.
 *
 * Deleting any of them compiles cleanly — `AgentHeartbeatStartOptions.db` is
 * optional, and `services.authPlane`/`globalInstanceMonitor` stay used elsewhere
 * so no unused-symbol diagnostic fires — while silently reverting the sweep to
 * the pre-G5 whole-table ambient scan and the heartbeat write to the ambient
 * pool. The db-access guard cannot see it either: it classifies by {file,table}
 * and merely NARRATES this wiring inside a justification string.
 *
 * So this is a source-scan safety net, the same shape and for the same reason as
 * `consumer-config.test.ts` (which pins `startFrom` policies by reading the
 * plugin files). It asserts the wiring EXISTS, not what it does — the behaviour
 * is pinned by the worker-scope probes, which supply the wiring themselves.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const INDEX_SRC = readFileSync(join(import.meta.dir, '../index.ts'), 'utf-8');

/** Source with `//` line comments stripped, so a commented-out wiring cannot pass. */
const INDEX_CODE = INDEX_SRC.split('\n')
  .filter(
    (line) =>
      !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//') && !line.trimStart().startsWith('/*'),
  )
  .join('\n');

describe('index.ts opts the G5 conversions into the tenant world', () => {
  test('the instance monitor is handed the auth plane after services exist', () => {
    // Without this the monitor's `authPlaneDb` stays null and `runHealthCheck`
    // takes its legacy early-return: the pre-G5 single ambient whole-table scan.
    expect(INDEX_CODE).toContain('setAuthPlane(services.authPlane.db)');
    expect(INDEX_CODE.match(/setAuthPlane\(services\.authPlane\.db\)/g)?.length).toBe(1);
  });

  test('the boot reconnect is given an auth-plane handle for its tenant enumeration', () => {
    // `reconnectWithPool` runs before `createApp`, so `services.authPlane` does
    // not exist yet; a short-lived handle is resolved for exactly this sweep.
    expect(INDEX_CODE).toContain('authPlaneDb: bootAuthPlane.db');
    expect(INDEX_CODE).toContain('resolveAuthPlaneConnection(db)');
  });

  test('the agent-heartbeat consumer is given a db handle', () => {
    // `db` is OPTIONAL on `AgentHeartbeatStartOptions`; without it
    // `recordHeartbeatActivity` short-circuits to the bare ambient
    // `turnService.recordActivity` — the pre-G5 write.
    const call = INDEX_CODE.match(/initAgentHeartbeat\(\{[^}]*\}\)/s)?.[0];
    expect(call).toBeDefined();
    expect(call).toContain('db: services.db');
  });
});
