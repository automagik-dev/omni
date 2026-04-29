/**
 * Genie Wiring Deprecation Nudge
 *
 * Shared helper that emits a stderr tip when an operator runs one of the
 * legacy multi-command genie-wiring entry points (`agents create`,
 * `instances update --agent`, `agent-routes create`) on a `nats-genie`
 * provider. The tip steers them toward the canonical
 * `omni connect <instance> <agent>` (or the `/genie:omni` skill from a
 * Claude session) without breaking the legacy path.
 *
 * Why a shared helper: each caller needs the same provider-fetch +
 * schema-check logic. A single helper keeps the nudge text in one place
 * and makes the "best-effort, never throw" semantics explicit.
 *
 * Tracked under the canonical-genie-omni-wiring wish (Wave 3 / Group 5,
 * second half — indirect-detection). The schema-detected case
 * (`providers create --schema nats-genie`) was wired in PR #553.
 */

import type { OmniClient } from '@omni/sdk';
import * as output from '../output.js';

/**
 * If `providerId` references a provider whose schema is `nats-genie`,
 * emit the deprecation nudge to stderr. Best-effort: if the provider
 * lookup fails (network, 404, etc.), silently skip — the nudge is a
 * UX hint, not a contract.
 *
 * @param agentName Optional agent name to fold into the suggested
 *   `omni connect <instance> <agentName>` example. When omitted (e.g.,
 *   `agent-routes create` doesn't always know the agent's display name),
 *   the example uses a placeholder.
 */
export async function maybeNudgeForGenieBackedAgent(
  client: OmniClient,
  providerId: string,
  agentName?: string,
): Promise<void> {
  let schema: string | undefined;
  try {
    const provider = await client.providers.get(providerId);
    schema = (provider as { schema?: string }).schema;
  } catch {
    // Provider lookup failed — silently skip. The legacy command itself
    // will surface any real error from its own code path.
    return;
  }

  if (schema !== 'nats-genie') return;

  const agentSlot = agentName ?? '<agent>';
  output.tip(
    `For genie-backed agents, prefer 'omni connect <instance-id> ${agentSlot}' (or '/genie:omni' from a Claude session) — it creates the provider, the agent record, and binds the instance in one step. This command stays for power users.`,
  );
}
