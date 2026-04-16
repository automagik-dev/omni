/**
 * Follow-up config resolver — closest-wins hierarchy.
 *
 * Resolution order (first enabled config wins, `enabled: false` short-circuits):
 *
 *   chat  →  instance  →  agent  →  (no config)
 *
 * `enabled: false` at any level is a deliberate "off" at that scope — broader
 * scopes do not override it. Returning `null` means no sequence should arm.
 *
 * This module is DB-agnostic: callers read the raw `followUpConfig` fields
 * from their storage layer and pass them in. That keeps the core package free
 * of `@omni/db` and makes the resolver trivially unit-testable.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import type { FollowUpSequenceConfig } from '../../schemas/follow-up';

/**
 * Sparse input shape — only the `followUpConfig` field matters. The caller may
 * pass a full `Chat` / `Instance` / `Agent` row; the resolver ignores the rest.
 */
export interface FollowUpConfigInputs {
  /** Config stored at `chats.settings.followUpConfig` (closest scope). */
  chat?: FollowUpSequenceConfig | null | undefined;
  /** Config stored at `instances.followUpConfig`. */
  instance?: FollowUpSequenceConfig | null | undefined;
  /** Config stored at `agents.followUpConfig` (broadest scope). */
  agent?: FollowUpSequenceConfig | null | undefined;
}

/**
 * Resolve the active follow-up config for a chat.
 *
 * Returns:
 *  - The first non-null config whose `enabled !== false` — chat beats instance
 *    beats agent.
 *  - `null` when the closest defined config has `enabled: false` (explicit off
 *    at that scope — broader scopes do not leak through).
 *  - `null` when no scope defines a config at all.
 */
export function resolveFollowUpConfig(inputs: FollowUpConfigInputs): FollowUpSequenceConfig | null {
  const chain = [inputs.chat, inputs.instance, inputs.agent];

  for (const candidate of chain) {
    if (candidate === null || candidate === undefined) continue;
    // Defined at this scope — either take it, or short-circuit to null when explicitly off.
    return candidate.enabled === false ? null : candidate;
  }

  return null;
}
