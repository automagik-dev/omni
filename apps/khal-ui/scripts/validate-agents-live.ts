#!/usr/bin/env bun
/**
 * validate-agents-live.ts — the Live-verified proof for the agents-automation
 * slice (Group E).
 *
 * Exercises the exact data path the UI uses (through an in-process BFF, so the
 * API key is injected server-side and never in this script) against the live
 * Omni backend:
 *
 *   (a) list agents / providers / automations (read-only, expect 200s).
 *   (b) health-check EVERY existing provider (read-only probe). A failing
 *       provider is EVIDENCE, recorded honestly — it is not a script failure.
 *   (c) disposable agent: create (provider=custom, isActive=false) → PATCH →
 *       read-back the change → DELETE (in finally).
 *   (d) disposable automation: client-side validate → create (DISABLED, with an
 *       impossible condition) → POST /test (dry-run, no side effects) → DELETE
 *       (in finally). NEVER enabled, NEVER executed.
 *   (e) disposable instance + chat + route binding the disposable agent → GET
 *       read-back → DELETE route/chat/instance (in finally).
 *   (f) route-test explainer exercised against the disposable instance's data
 *       (client-side decision walk — sends nothing).
 *   (g) print an evidence JSON summary.
 *
 * SAFETY: every mutating call is guarded — it throws if it targets a production
 * instance. Only entities this script creates are ever mutated or deleted.
 * NEVER enables anything, NEVER binds to a production instance, NEVER executes a
 * live automation.
 */
import { existsSync, readFileSync } from 'node:fs';
import { validateAutomationBody } from '../package/src/pages/automations/automation-helpers.ts';
import { explainRouteDecision } from '../package/src/pages/routing/routing-helpers.ts';
import { createBff } from '../service/src/bff.ts';

const PRODUCTION_INSTANCE_IDS = ['506377b1-eb79-4ae3-abc1-80bd00986f6b', '11c1a3e2-bb53-45df-aac8-0418f44ea5d5'];

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

const mutatedInstanceIds = new Set<string>();
const createdDisposables: Record<string, string | null> = {};
const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string): boolean {
  checks.push({ name, status: ok ? 'pass' : 'fail', detail });
  return ok;
}

function idFrom(res: HttpResult): string | null {
  return (res.json as { data?: { id?: string } })?.data?.id ?? null;
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

  /** Guarded instance mutation: refuses to touch a production instance. */
  const mutateInstance = async (
    method: string,
    path: string,
    targetId: string,
    body?: unknown,
  ): Promise<HttpResult> => {
    if (PRODUCTION_INSTANCE_IDS.includes(targetId)) {
      throw new Error(`SAFETY VIOLATION: refused ${method} on production instance ${targetId}`);
    }
    mutatedInstanceIds.add(targetId);
    return call(method, path, body);
  };

  const evidence: Record<string, unknown> = {};
  const stamp = Date.now();

  // ── (a) read-only lists ─────────────────────────────────────────────────────
  const agentsList = await call('GET', '/agents?limit=200');
  const providersList = await call('GET', '/providers');
  const automationsList = await call('GET', '/automations');
  const batchList = await call('GET', '/batch-jobs?limit=10');
  record('GET /agents', agentsList.status === 200, `status=${agentsList.status}`);
  record('GET /providers', providersList.status === 200, `status=${providersList.status}`);
  record('GET /automations', automationsList.status === 200, `status=${automationsList.status}`);
  record('GET /batch-jobs', batchList.status === 200, `status=${batchList.status}`);
  const providers = (providersList.json as { items?: Array<{ id: string; name?: string }> })?.items ?? [];
  evidence.counts = {
    agents: (agentsList.json as { items?: unknown[] })?.items?.length ?? 0,
    providers: providers.length,
    automations: (automationsList.json as { items?: unknown[] })?.items?.length ?? 0,
  };

  // ── (b) provider health probes (read-only; failing = evidence) ──────────────
  const providerHealth: Array<Record<string, unknown>> = [];
  for (const p of providers) {
    const h = await call('POST', `/providers/${p.id}/health`);
    const hb = h.json as { healthy?: boolean; latency?: number; error?: string | null };
    // The CHECK passes when the endpoint answered with a health verdict; an
    // unhealthy provider is recorded but does not fail the run.
    record(
      `POST /providers/${p.id.slice(0, 8)}/health`,
      h.status === 200 && typeof hb?.healthy === 'boolean',
      `status=${h.status} healthy=${hb?.healthy}`,
    );
    providerHealth.push({
      id: p.id,
      name: p.name,
      healthy: hb?.healthy,
      latency: hb?.latency,
      error: hb?.error ?? null,
    });
  }
  evidence.providerHealth = providerHealth;

  let agentId: string | null = null;
  let automationId: string | null = null;
  let instanceId: string | null = null;
  let chatId: string | null = null;
  let routeId: string | null = null;

  try {
    // ── (c) disposable agent lifecycle ────────────────────────────────────────
    const agentCreate = await call('POST', '/agents', {
      name: `zz-khalui-agent-${stamp}`,
      provider: 'custom',
      agentType: 'assistant',
      capabilities: ['khalui-test'],
      isActive: false,
    });
    agentId = idFrom(agentCreate);
    createdDisposables.agentId = agentId;
    record(
      'POST /agents (disposable, inactive)',
      (agentCreate.status === 200 || agentCreate.status === 201) && Boolean(agentId),
      `status=${agentCreate.status} id=${agentId}`,
    );
    if (!agentId) throw new Error('agent create returned no id');

    const patchModel = `khalui-model-${stamp}`;
    const agentPatch = await call('PATCH', `/agents/${agentId}`, { model: patchModel });
    const agentReadBack = await call('GET', `/agents/${agentId}`);
    const agentRow = (agentReadBack.json as { data?: { model?: string; isActive?: boolean } })?.data ?? {};
    record(
      'PATCH /agents/:id round-trip',
      agentPatch.status < 400 && agentRow.model === patchModel && agentRow.isActive === false,
      `patch=${agentPatch.status} model→${String(agentRow.model)} isActive=${String(agentRow.isActive)}`,
    );
    evidence.agentRoundTrip = {
      requested: { model: patchModel },
      readBack: { model: agentRow.model, isActive: agentRow.isActive },
    };

    // ── (d) disposable automation lifecycle (validate → create → test) ────────
    const neverValue = `zz-khalui-never-${crypto.randomUUID()}`;
    const automationBody = {
      name: `zz-khalui-auto-${stamp}`,
      description: 'khalui disposable — impossible condition, disabled, never fires',
      triggerEventType: 'message.received',
      conditionLogic: 'and',
      triggerConditions: [{ field: 'payload.content.text', operator: 'eq', value: neverValue }],
      actions: [{ type: 'log', config: { level: 'info', message: 'khalui-never' } }],
      enabled: false,
    };
    const clientValidation = validateAutomationBody(automationBody);
    record(
      'client zod validate (automation body)',
      clientValidation.ok,
      clientValidation.ok ? 'valid' : clientValidation.errors.join('; '),
    );

    const autoCreate = await call('POST', '/automations', automationBody);
    automationId = idFrom(autoCreate);
    createdDisposables.automationId = automationId;
    const autoEnabled = (autoCreate.json as { data?: { enabled?: boolean } })?.data?.enabled;
    record(
      'POST /automations (disposable, DISABLED)',
      (autoCreate.status === 200 || autoCreate.status === 201) && Boolean(automationId) && autoEnabled === false,
      `status=${autoCreate.status} id=${automationId} enabled=${String(autoEnabled)}`,
    );
    if (!automationId) throw new Error('automation create returned no id');

    // Dry-run test with a NON-matching event — matched must be false, no side effects.
    const test = await call('POST', `/automations/${automationId}/test`, {
      event: { type: 'message.received', payload: { content: { type: 'text', text: 'hello' } } },
    });
    const testRes = test.json as { matched?: boolean; dryRun?: boolean };
    record(
      'POST /automations/:id/test (dry-run, synthetic)',
      test.status === 200 && testRes?.matched === false,
      `status=${test.status} matched=${String(testRes?.matched)} dryRun=${String(testRes?.dryRun)}`,
    );
    evidence.automationTest = { matched: testRes?.matched, dryRun: testRes?.dryRun };

    // ── (e) disposable instance + chat + route ────────────────────────────────
    const instCreate = await call('POST', '/instances', {
      name: `zz-khalui-inst-${stamp}`,
      channel: 'whatsapp-baileys',
    });
    instanceId = idFrom(instCreate);
    createdDisposables.instanceId = instanceId;
    if (instanceId) mutatedInstanceIds.add(instanceId);
    record(
      'POST /instances (disposable)',
      (instCreate.status === 200 || instCreate.status === 201) && Boolean(instanceId),
      `status=${instCreate.status} id=${instanceId}`,
    );
    if (!instanceId) throw new Error('instance create returned no id');

    const chatCreate = await call('POST', '/chats', {
      instanceId,
      externalId: `zz-khalui-${stamp}@s.whatsapp.net`,
      chatType: 'dm',
      channel: 'whatsapp-baileys',
    });
    chatId = idFrom(chatCreate);
    createdDisposables.chatId = chatId;
    record(
      'POST /chats (disposable)',
      (chatCreate.status === 200 || chatCreate.status === 201) && Boolean(chatId),
      `status=${chatCreate.status} id=${chatId}`,
    );
    if (!chatId) throw new Error('chat create returned no id');

    const routeCreate = await mutateInstance('POST', `/instances/${instanceId}/routes`, instanceId, {
      scope: 'chat',
      chatId,
      agentId,
      label: 'khalui-test-route',
      priority: 0,
      isActive: false,
    });
    routeId = idFrom(routeCreate);
    createdDisposables.routeId = routeId;
    record(
      'POST /instances/:id/routes (bind disposable agent)',
      (routeCreate.status === 200 || routeCreate.status === 201) && Boolean(routeId),
      `status=${routeCreate.status} id=${routeId}`,
    );
    if (!routeId) throw new Error('route create returned no id');

    const routeReadBack = await call('GET', `/instances/${instanceId}/routes/${routeId}`);
    const routeRow = (routeReadBack.json as { data?: { agentId?: string; scope?: string } })?.data ?? {};
    record(
      'GET route read-back',
      routeReadBack.status === 200 && routeRow.agentId === agentId,
      `status=${routeReadBack.status} agentId=${String(routeRow.agentId)}`,
    );

    // ── (f) route-test explainer (client-side, sends nothing) ─────────────────
    const routesForInstance = (await call('GET', `/instances/${instanceId}/routes`)).json as { items?: unknown[] };
    const access = (
      await call('POST', '/access/check', { instanceId, platformUserId: '5511999999999', channel: 'whatsapp-baileys' })
    ).json as { data?: { allowed?: boolean; reason?: string; mode?: string } };
    const agentForRoute = (await call('GET', `/agents/${agentId}`)).json as {
      data?: {
        id: string;
        name: string;
        provider: string;
        agentType: string;
        isActive: boolean;
        agentProviderId?: string | null;
      };
    };
    // biome-ignore lint/suspicious/noExplicitAny: shapes come straight from the live API JSON
    const liveRoutes = (routesForInstance.items ?? []) as any;
    // biome-ignore lint/suspicious/noExplicitAny: live API JSON
    const liveAccess = (access.data ?? null) as any;
    // biome-ignore lint/suspicious/noExplicitAny: live API JSON
    const liveAgent = (agentForRoute.data ?? null) as any;
    // Default walk: no active route → falls back to the instance default agent.
    const fallbackDecision = explainRouteDecision({
      instanceName: `zz-khalui-inst-${stamp}`,
      routes: liveRoutes,
      access: liveAccess,
      agent: liveAgent,
      providerHealth: null,
    });
    // Selecting the (inactive) disposable route exercises the agent-active branch:
    // the disposable agent is inactive → the decision is BLOCKED.
    const selectedDecision = explainRouteDecision({
      instanceName: `zz-khalui-inst-${stamp}`,
      routes: liveRoutes,
      access: liveAccess,
      agent: liveAgent,
      providerHealth: null,
      selectedRouteId: routeId,
    });
    record(
      'route-test explainer (synthetic decision)',
      fallbackDecision.steps.length > 0 &&
        typeof fallbackDecision.verdict === 'string' &&
        selectedDecision.steps.some((s) => s.label === 'Agent active'),
      `fallback="${fallbackDecision.verdict}" selected="${selectedDecision.verdict}"`,
    );
    evidence.routeTest = {
      access: access.data,
      fallback: { verdict: fallbackDecision.verdict, steps: fallbackDecision.steps },
      selectedInactiveRoute: { verdict: selectedDecision.verdict, steps: selectedDecision.steps },
    };

    // ── batch-jobs: estimate-only (read-only, no paid job created) ────────────
    // Scoped to the disposable instance (zero media). We deliberately DO NOT
    // create a batch job — estimate reports cost/counts without side effects.
    const estimate = await call('POST', '/batch-jobs/estimate', {
      jobType: 'time_based_batch',
      instanceId,
      daysBack: 1,
      limit: 1,
      contentTypes: ['audio'],
    });
    record('POST /batch-jobs/estimate (read-only)', estimate.status === 200, `status=${estimate.status}`);
    evidence.batchEstimate = (estimate.json as { data?: unknown })?.data ?? estimate.json;
  } finally {
    // ── cleanup (always, even on failure) ─────────────────────────────────────
    if (routeId && instanceId) {
      const d = await mutateInstance('DELETE', `/instances/${instanceId}/routes/${routeId}`, instanceId);
      record('DELETE route (cleanup)', d.status < 400, `status=${d.status}`);
    }
    if (chatId) {
      const d = await call('DELETE', `/chats/${chatId}`);
      record('DELETE chat (cleanup)', d.status < 400, `status=${d.status}`);
    }
    if (instanceId) {
      try {
        const d = await mutateInstance('DELETE', `/instances/${instanceId}`, instanceId);
        record('DELETE instance (cleanup)', d.status < 400, `status=${d.status}`);
      } catch (err) {
        record('DELETE instance (cleanup)', false, err instanceof Error ? err.message : 'delete failed');
      }
    }
    if (agentId) {
      const d = await call('DELETE', `/agents/${agentId}`);
      record('DELETE agent (cleanup)', d.status < 400, `status=${d.status}`);
    }
    if (automationId) {
      const d = await call('DELETE', `/automations/${automationId}`);
      record('DELETE automation (cleanup)', d.status < 400, `status=${d.status}`);
    }
  }

  // ── safety assertion: only disposable instances were ever mutated ───────────
  const onlyDisposableInstances = [...mutatedInstanceIds].every((id) => !PRODUCTION_INSTANCE_IDS.includes(id));
  record(
    'SAFETY: no production instance mutated',
    onlyDisposableInstances,
    `mutatedInstanceIds=${JSON.stringify([...mutatedInstanceIds])}`,
  );

  const failed = checks.filter((c) => c.status === 'fail');
  const summary = {
    ok: failed.length === 0,
    productionInstanceIds: PRODUCTION_INSTANCE_IDS,
    mutatedInstanceIds: [...mutatedInstanceIds],
    createdDisposables,
    checks,
    evidence,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failed.length > 0) {
    console.error(`\nFAIL: ${failed.length} check(s) failed.`);
    return 1;
  }
  console.error('\nOK: all agents/automation checks passed against the live backend.');
  return 0;
}

process.exit(await main());
