/**
 * In-flight privileged-work revocation monitor, proven with a SYNTHETIC clock
 * (wish: omni-full-multitenancy, Group G5, deliverable (c); ADR-0006;
 * RELEASE_SLOS `revocation.inflight_privileged_work_revocation_seconds_max: 30`).
 *
 * A long-running work item (a multi-thousand-message sync, a slow batch loop)
 * can outlive its dequeue-time admissibility check by minutes. The monitor
 * gives such loops a bounded observation window: `assertAdmissible()` is
 * called once per item, consults the injected clock, and re-checks the
 * tenant's admissibility whenever the recheck interval has elapsed — so a
 * revocation that lands mid-flight is OBSERVED within the interval, and the
 * interval is half the ceiling (the same cadence-vs-ceiling rationale as the
 * stream-termination sweep: a flip landing right after one check is still
 * caught by the next one, inside the ceiling).
 *
 * Every number here is driven from the injected `now` — no wall-clock waits,
 * no production timing claims. Legacy work (null tenant) never checks and
 * never gains a query: the dual world, byte-identical.
 */

import { describe, expect, test } from 'bun:test';
import {
  INFLIGHT_REVOCATION_CEILING_SECONDS,
  InflightRevocationError,
  createInflightRevocationMonitor,
} from '../inflight-revocation';

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';

describe('the ceiling constant (RELEASE_SLOS inflight_privileged_work_revocation_seconds_max)', () => {
  test('is 30 seconds, and the default recheck cadence is half of it', () => {
    expect(INFLIGHT_REVOCATION_CEILING_SECONDS).toBe(30);
  });
});

describe('inflight revocation monitor (synthetic clock)', () => {
  test('checks at the first gate, then re-checks only when the interval elapses', async () => {
    let now = 0;
    const checks: number[] = [];
    const monitor = createInflightRevocationMonitor({
      tenantId: TENANT_A,
      check: async () => {
        checks.push(now);
        return true;
      },
      now: () => now,
    });

    await monitor.assertAdmissible(); // first gate always checks
    expect(checks).toEqual([0]);

    now = 14_999; // inside the cadence — no new query
    await monitor.assertAdmissible();
    expect(checks).toEqual([0]);

    now = 15_000; // cadence reached — re-check
    await monitor.assertAdmissible();
    expect(checks).toEqual([0, 15_000]);

    now = 29_999;
    await monitor.assertAdmissible();
    expect(checks).toEqual([0, 15_000]);

    now = 30_000;
    await monitor.assertAdmissible();
    expect(checks).toEqual([0, 15_000, 30_000]);
  });

  test('a mid-flight revocation is observed within the 30s ceiling', async () => {
    let now = 0;
    let revoked = false;
    let observedAt: number | null = null;
    const monitor = createInflightRevocationMonitor({
      tenantId: TENANT_A,
      check: async () => {
        if (revoked) observedAt = now;
        return !revoked;
      },
      now: () => now,
    });

    await monitor.assertAdmissible();

    // The revocation lands immediately after the first check — the worst case.
    now = 1;
    revoked = true;

    // The loop keeps calling the gate as it processes items; the flip must be
    // observed at the next cadence tick, which is within the ceiling.
    let refused = false;
    for (const t of [5_000, 10_000, 14_999, 15_000, 20_000]) {
      now = t;
      try {
        await monitor.assertAdmissible();
      } catch (error) {
        expect(error).toBeInstanceOf(InflightRevocationError);
        refused = true;
        break;
      }
    }

    expect(refused).toBe(true);
    expect(observedAt).not.toBeNull();
    // Observed 15s after the flip landed — inside the 30s ceiling.
    expect((observedAt ?? Number.POSITIVE_INFINITY) - 1).toBeLessThanOrEqual(
      INFLIGHT_REVOCATION_CEILING_SECONDS * 1000,
    );
  });

  test('once refused, the monitor stays refused — no side effect after the flip is observable', async () => {
    let now = 0;
    let admissible = true;
    const monitor = createInflightRevocationMonitor({
      tenantId: TENANT_A,
      check: async () => admissible,
      now: () => now,
    });

    await monitor.assertAdmissible();
    admissible = false;
    now = 15_000;
    await expect(monitor.assertAdmissible()).rejects.toThrow(InflightRevocationError);

    // Even if the tenant were somehow admissible again, this work item is dead.
    admissible = true;
    now = 30_000;
    await expect(monitor.assertAdmissible()).rejects.toThrow(InflightRevocationError);
  });

  test('a first-gate refusal stops the work item before ANY side effect (dequeue-time shape)', async () => {
    const monitor = createInflightRevocationMonitor({
      tenantId: TENANT_A,
      check: async () => false,
      now: () => 0,
    });
    await expect(monitor.assertAdmissible()).rejects.toThrow(/no longer admissible/);
  });

  test('a check that THROWS refuses fail-closed — auth-plane silence is not admissibility', async () => {
    let calls = 0;
    const monitor = createInflightRevocationMonitor({
      tenantId: TENANT_A,
      check: async () => {
        calls++;
        throw new Error('auth plane unreachable');
      },
      now: () => 0,
    });

    // The module doc pins this: privileged work that cannot verify its tenant
    // stops. The check's error must not surface as-is (callers key on the
    // typed refusal) and must not be swallowed into admissibility.
    await expect(monitor.assertAdmissible()).rejects.toThrow(InflightRevocationError);
    expect(calls).toBe(1);
  });

  test('a check-error refusal is sticky — the dead work item never re-queries, even past the cadence', async () => {
    let now = 0;
    let calls = 0;
    const monitor = createInflightRevocationMonitor({
      tenantId: TENANT_A,
      check: async () => {
        calls++;
        throw new Error('auth plane unreachable');
      },
      now: () => now,
    });

    await expect(monitor.assertAdmissible()).rejects.toThrow(InflightRevocationError);

    // Even a full ceiling later — when the auth plane may be healthy again —
    // this work item stays refused and consults nothing.
    now = INFLIGHT_REVOCATION_CEILING_SECONDS * 1000;
    await expect(monitor.assertAdmissible()).rejects.toThrow(InflightRevocationError);
    expect(calls).toBe(1);
  });

  test('legacy work (null tenant) never checks and never refuses — byte-identical', async () => {
    let checked = 0;
    const monitor = createInflightRevocationMonitor({
      tenantId: null,
      check: async () => {
        checked++;
        return false; // would refuse if ever consulted
      },
      now: () => 0,
    });

    await monitor.assertAdmissible();
    await monitor.assertAdmissible();
    expect(checked).toBe(0);
  });
});
