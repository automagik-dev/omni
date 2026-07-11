/**
 * Cross-instance routing helpers.
 *
 * `fanInRoutes` gathers every instance's routes into one flat list (the backend
 * has no cross-instance route list, so the UI fans in client-side).
 *
 * `explainRouteDecision` is the heart of the Route Test panel: there is NO
 * server-side route-test endpoint, so this is a *synthetic decision explainer*
 * assembled from real reads (routes + agent + provider health + access check).
 * It never sends a message — it walks the same checks the dispatcher would and
 * reports where an inbound message for a simulated identity would land. Kept pure
 * so the decision logic is unit-testable.
 */
import type { AccessDecision, AgentRouteRow, AgentRow, OmniExt, ProviderHealth } from '../../api/ext';

export interface InstanceRef {
  id: string;
  name: string;
}

export interface FannedRoute {
  instanceId: string;
  instanceName: string;
  route: AgentRouteRow;
}

/** Fetch every instance's routes and flatten them, tolerating per-instance errors. */
export async function fanInRoutes(ext: OmniExt, instances: InstanceRef[]): Promise<FannedRoute[]> {
  const results = await Promise.all(
    instances.map(async (inst) => {
      try {
        const res = await ext.instances.listRoutes(inst.id);
        return (res.items ?? []).map((route) => ({ instanceId: inst.id, instanceName: inst.name, route }));
      } catch {
        return [] as FannedRoute[];
      }
    }),
  );
  return results.flat();
}

export type DecisionOutcome = 'pass' | 'warn' | 'fail' | 'info';

export interface DecisionStep {
  label: string;
  outcome: DecisionOutcome;
  detail: string;
}

export interface RouteDecisionInput {
  instanceName: string;
  /** All routes configured on the target instance. */
  routes: AgentRouteRow[];
  /** Result of POST /access/check for the simulated identity (null if not run). */
  access: AccessDecision | null;
  /** The agent bound to the selected/winning route, resolved (null if unresolved). */
  agent: AgentRow | null;
  /** Last health probe of that agent's provider (null if not probed). */
  providerHealth: ProviderHealth | null;
  /** Operator-picked route to explain; defaults to the highest-priority active route. */
  selectedRouteId?: string | null;
}

export interface RouteDecision {
  steps: DecisionStep[];
  /** The route the explainer treated as the winner, if any. */
  winningRoute: AgentRouteRow | null;
  /** One-line summary of where the message would land. */
  verdict: string;
}

/** Pick the winning route: the explicit selection, else highest-priority active route. */
export function pickWinningRoute(routes: AgentRouteRow[], selectedRouteId?: string | null): AgentRouteRow | null {
  if (selectedRouteId) return routes.find((r) => r.id === selectedRouteId) ?? null;
  const active = routes.filter((r) => r.isActive !== false);
  if (active.length === 0) return null;
  return [...active].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0] ?? null;
}

/**
 * Walk the dispatcher's checks for a simulated inbound and explain the outcome.
 * Pure: takes already-fetched reads, produces the explanation chain + verdict.
 */
export function explainRouteDecision(input: RouteDecisionInput): RouteDecision {
  const steps: DecisionStep[] = [];
  const winningRoute = pickWinningRoute(input.routes, input.selectedRouteId);

  // 1. Access gate.
  if (input.access) {
    steps.push({
      label: 'Access check',
      outcome: input.access.allowed ? 'pass' : 'fail',
      detail: input.access.allowed
        ? `Allowed (mode: ${input.access.mode ?? 'unknown'})`
        : `Denied: ${input.access.reason ?? 'no reason given'}`,
    });
  } else {
    steps.push({ label: 'Access check', outcome: 'info', detail: 'Not evaluated.' });
  }

  // 2. Route match.
  const activeCount = input.routes.filter((r) => r.isActive !== false).length;
  if (winningRoute) {
    steps.push({
      label: 'Route match',
      outcome: 'pass',
      detail: `Matched route ${winningRoute.label ?? winningRoute.id} (scope=${winningRoute.scope}, priority=${winningRoute.priority ?? 0}).`,
    });
  } else {
    steps.push({
      label: 'Route match',
      outcome: 'warn',
      detail:
        activeCount === 0
          ? 'No active routes — falls back to the instance default agent.'
          : 'No route selected — pick one to explain, or falls back to instance default.',
    });
  }

  // 3. Agent active.
  if (winningRoute) {
    if (!winningRoute.agentId) {
      steps.push({
        label: 'Agent binding',
        outcome: 'warn',
        detail: 'Route has no agent assigned (inherits instance default).',
      });
    } else if (input.agent) {
      steps.push({
        label: 'Agent active',
        outcome: input.agent.isActive ? 'pass' : 'fail',
        detail: input.agent.isActive
          ? `Agent "${input.agent.name}" is active.`
          : `Agent "${input.agent.name}" is inactive — dispatch would be dropped.`,
      });
    } else {
      steps.push({ label: 'Agent active', outcome: 'info', detail: `Agent ${winningRoute.agentId} not resolved.` });
    }
  }

  // 4. Provider health.
  if (input.agent) {
    if (input.providerHealth) {
      steps.push({
        label: 'Provider health',
        outcome: input.providerHealth.healthy ? 'pass' : 'warn',
        detail: input.providerHealth.healthy
          ? `Provider healthy (${input.providerHealth.latency ?? '?'}ms).`
          : `Provider unhealthy: ${input.providerHealth.error ?? 'unknown'} — replies may fail.`,
      });
    } else {
      steps.push({ label: 'Provider health', outcome: 'info', detail: 'Provider not probed.' });
    }
  }

  // Verdict.
  const blocked = steps.some((s) => s.outcome === 'fail');
  let verdict: string;
  if (blocked) {
    verdict = 'Message would be BLOCKED before reaching an agent.';
  } else if (winningRoute?.agentId && input.agent) {
    verdict = `Message would dispatch to agent "${input.agent.name}"${
      input.providerHealth && !input.providerHealth.healthy ? ' (provider currently unhealthy)' : ''
    }.`;
  } else if (winningRoute?.agentId) {
    verdict = `Message would dispatch to agent ${winningRoute.agentId}.`;
  } else {
    verdict = 'Message would fall back to the instance default agent (no explicit route).';
  }

  return { steps, winningRoute, verdict };
}
