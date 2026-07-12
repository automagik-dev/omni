#!/usr/bin/env bun
/**
 * validate-instances-live.ts — the Live-verified proof for the instances slice.
 *
 * Exercises the exact data path the UI uses (through an in-process BFF, so the
 * API key is injected server-side and never in this script) against the live
 * Omni backend:
 *
 *   1. Create a DISPOSABLE whatsapp-baileys instance (zz-test-khalui-<ts>).
 *   2. PATCH config fields and assert the read-back reflects them.
 *   3. Fetch the QR payload (connect + poll; render/fetch only — never paired).
 *   4. Read status/contacts/groups on the two PRODUCTION instances (read-only).
 *   5. Delete the disposable in a finally, even on failure.
 *
 * SAFETY: every mutating call is guarded — it throws if it targets a production
 * id. The evidence summary lists exactly which ids were mutated; it must contain
 * only the disposable. Production instances are touched with GET only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createBff } from '../service/src/bff.ts';

const PRODUCTION_IDS = ['506377b1-eb79-4ae3-abc1-80bd00986f6b', '11c1a3e2-bb53-45df-aac8-0418f44ea5d5'];

function loadEnv(): void {
  if (process.env.OMNI_API_KEY && process.env.OMNI_BASE_URL) return;
  const envPath = `${import.meta.dir}/../.env`;
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

interface Check {
  name: string;
  status: 'pass' | 'fail';
  detail: string;
}

interface HttpResult {
  status: number;
  json: unknown;
}

const mutatedIds = new Set<string>();
const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string): boolean {
  checks.push({ name, status: ok ? 'pass' : 'fail', detail });
  return ok;
}

async function main(): Promise<number> {
  loadEnv();
  const apiKey = process.env.OMNI_API_KEY ?? '';
  const baseUrl = process.env.OMNI_BASE_URL ?? '';
  if (!apiKey || !baseUrl) {
    console.error('OMNI_API_KEY / OMNI_BASE_URL not set (apps/khal-ui/.env). Cannot validate against live backend.');
    return 1;
  }
  const bff = createBff({ apiKey, baseUrl });

  const call = async (method: string, path: string, body?: unknown): Promise<HttpResult> => {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { 'content-type': 'application/json' };
    }
    const res = await bff.fetch(new Request(`http://validate/omni/api/v2${path}`, init));
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text.slice(0, 200);
    }
    return { status: res.status, json };
  };

  /** Guarded mutation: refuses to touch a production instance. */
  const mutate = async (method: string, path: string, targetId: string, body?: unknown): Promise<HttpResult> => {
    if (PRODUCTION_IDS.includes(targetId)) {
      throw new Error(`SAFETY VIOLATION: refused ${method} on production instance ${targetId}`);
    }
    mutatedIds.add(targetId);
    return call(method, path, body);
  };

  // ── supported channels (live-verified) ─────────────────────────────────────
  const channels = await call('GET', '/instances/supported-channels');
  record(
    'GET /instances/supported-channels',
    channels.status === 200 && Array.isArray((channels.json as { items?: unknown[] })?.items),
    `status=${channels.status}`,
  );

  // ── list (live-verified) ────────────────────────────────────────────────────
  const list = await call('GET', '/instances?limit=100');
  record('GET /instances', list.status === 200, `status=${list.status}`);

  const stamp = Date.now();
  const disposableName = `zz-test-khalui-${stamp}`;
  let disposableId: string | null = null;
  const evidence: Record<string, unknown> = { disposableName };

  try {
    // ── create disposable (live-verified) ─────────────────────────────────────
    const created = await call('POST', '/instances', { name: disposableName, channel: 'whatsapp-baileys' });
    disposableId = (created.json as { data?: { id?: string } })?.data?.id ?? null;
    if (disposableId) mutatedIds.add(disposableId);
    record(
      'POST /instances (create disposable)',
      (created.status === 200 || created.status === 201) && Boolean(disposableId),
      `status=${created.status} id=${disposableId}`,
    );
    if (!disposableId) throw new Error('create did not return an id — aborting');
    evidence.disposableId = disposableId;

    // ── config round-trip: PATCH → read-back (live-verified) ──────────────────
    const before = await call('GET', `/instances/${disposableId}`);
    const beforeRow = (before.json as { data?: Record<string, unknown> })?.data ?? {};
    const patchBody = { messageDebounceMode: 'fixed', enableAutoSplit: false };
    const patched = await mutate('PATCH', `/instances/${disposableId}`, disposableId, patchBody);
    const after = await call('GET', `/instances/${disposableId}`);
    const afterRow = (after.json as { data?: Record<string, unknown> })?.data ?? {};
    const roundTripped =
      patched.status < 400 && afterRow.messageDebounceMode === 'fixed' && afterRow.enableAutoSplit === false;
    record(
      'PATCH /instances/:id config round-trip',
      roundTripped,
      `patch=${patched.status} debounce ${String(beforeRow.messageDebounceMode)}→${String(afterRow.messageDebounceMode)} autoSplit ${String(beforeRow.enableAutoSplit)}→${String(afterRow.enableAutoSplit)}`,
    );
    evidence.configRoundTrip = {
      request: patchBody,
      before: { messageDebounceMode: beforeRow.messageDebounceMode, enableAutoSplit: beforeRow.enableAutoSplit },
      after: { messageDebounceMode: afterRow.messageDebounceMode, enableAutoSplit: afterRow.enableAutoSplit },
    };

    // ── status (live-verified) ────────────────────────────────────────────────
    const status = await call('GET', `/instances/${disposableId}/status`);
    record('GET /instances/:id/status', status.status === 200, `status=${status.status}`);

    // ── QR fetch/render (live-verified) — connect then poll, never pair ───────
    await mutate('POST', `/instances/${disposableId}/connect`, disposableId, {});
    let qrPayloadPresent = false;
    let qrValuePresent = false;
    let lastQrStatus = 0;
    for (let i = 0; i < 6; i++) {
      const qr = await call('GET', `/instances/${disposableId}/qr`);
      lastQrStatus = qr.status;
      const data = (qr.json as { data?: { qr?: string | null } })?.data;
      if (qr.status === 200 && data && 'qr' in data) qrPayloadPresent = true;
      if (data?.qr) {
        qrValuePresent = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    record(
      'GET /instances/:id/qr (fetch/render only)',
      qrPayloadPresent,
      `status=${lastQrStatus} payload=${qrPayloadPresent} qrValue=${qrValuePresent}`,
    );
    evidence.qr = { payloadPresent: qrPayloadPresent, qrValuePresent };

    // ── production read-only: status / contacts / groups (read-only path) ─────
    const productionReads: Array<Record<string, unknown>> = [];
    for (const pid of PRODUCTION_IDS) {
      const s = await call('GET', `/instances/${pid}/status`);
      const c = await call('GET', `/instances/${pid}/contacts?limit=3`);
      const g = await call('GET', `/instances/${pid}/groups?limit=3`);
      const ok = s.status === 200 && c.status === 200 && g.status === 200;
      record(
        `PRODUCTION read-only ${pid.slice(0, 8)}`,
        ok,
        `status=${s.status} contacts=${c.status} groups=${g.status}`,
      );
      productionReads.push({
        id: pid,
        status: s.status,
        contacts: (c.json as { items?: unknown[] })?.items?.length ?? 0,
        groups: (g.json as { items?: unknown[] })?.items?.length ?? 0,
      });
    }
    evidence.productionReadOnly = productionReads;
  } finally {
    // ── delete disposable (live-verified) — always, even on failure ───────────
    if (disposableId) {
      try {
        const del = await mutate('DELETE', `/instances/${disposableId}`, disposableId);
        record('DELETE /instances/:id (cleanup)', del.status < 400, `status=${del.status}`);
        evidence.deleted = del.status < 400;
      } catch (err) {
        record('DELETE /instances/:id (cleanup)', false, err instanceof Error ? err.message : 'delete failed');
      }
    }
  }

  // ── safety assertion: only the disposable was ever mutated ──────────────────
  const onlyDisposableMutated = [...mutatedIds].every((id) => id === disposableId);
  record(
    'SAFETY: only the disposable was mutated',
    onlyDisposableMutated,
    `mutatedIds=${JSON.stringify([...mutatedIds])}`,
  );

  const failed = checks.filter((c) => c.status === 'fail');
  const summary = {
    ok: failed.length === 0,
    mutatedIds: [...mutatedIds],
    productionIds: PRODUCTION_IDS,
    checks,
    evidence,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failed.length > 0) {
    console.error(`\nFAIL: ${failed.length} check(s) failed.`);
    return 1;
  }
  console.error('\nOK: all instance checks passed against the live backend.');
  return 0;
}

process.exit(await main());
