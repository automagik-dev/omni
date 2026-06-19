/**
 * Default cooldown / escalation config for the close-contact endpoint.
 *
 * The route reads these defaults to compute (a) the `closeUntil` timestamp
 * for soft outcomes and (b) the escalation count threshold + window when
 * deciding whether to auto-promote a soft close to hard terminal.
 *
 * Per-instance overrides live on `instance.settings.closeContactConfig`
 * (free-form jsonb today; future migration may schema this).
 *
 * Numbers are operational guesses validated against the cliente-atual-SAC
 * regression scenario; expect to tune post-launch with real data. See
 * `genie-hapvida/brain/Designs/design-eugenia-close-contact.md` §8 for the
 * rationale per outcome.
 */
import type { CloseContactOutcome } from '@omni/core/events';

export interface CloseContactOutcomeConfig {
  /** Cooldown duration in milliseconds. `null` for hard terminals. */
  cooldownMs: number | null;
  /** Number of repeats within `escalationWindowMs` that promotes to hard terminal. */
  escalationThreshold: number | null;
  /** Window in milliseconds during which repeats count. */
  escalationWindowMs: number | null;
}

export type CloseContactConfig = Record<CloseContactOutcome, CloseContactOutcomeConfig>;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Hardcoded defaults — used when an instance does not override.
 *
 * Hard terminals (`won`, `lost`) carry nulls because they never reopen
 * automatically; the dispatcher refuses dispatch and only `/chats/:id/reopen-contact`
 * can revert.
 */
export const DEFAULT_CLOSE_CONTACT_CONFIG: CloseContactConfig = {
  won: { cooldownMs: null, escalationThreshold: null, escalationWindowMs: null },
  lost: { cooldownMs: null, escalationThreshold: null, escalationWindowMs: null },
  // `redirected_sac` is the canonical outcome for an active Hapvida client
  // reaching the seller agent (appointments, billing, doctor lookup,
  // authorization — anything post-sale). Each new conversation legitimately
  // ends in a SAC redirect, so the same client returning several times in a
  // week is expected behaviour, not a signal that the redirect is failing.
  // Auto-escalating to a hard terminal silences the reactive agent for a
  // customer whose every interaction is, by design, a SAC redirect. The 24h
  // cooldown stays so the proactive Haiku follow-up keeps disarmed in the
  // immediate window, but the soft close never auto-promotes. Operators can
  // still close manually with `won`/`lost`, and per-instance overrides via
  // `instance.settings.closeContactConfig` remain available.
  redirected_sac: { cooldownMs: 24 * HOUR, escalationThreshold: null, escalationWindowMs: null },
  unqualified: { cooldownMs: 7 * DAY, escalationThreshold: 3, escalationWindowMs: 30 * DAY },
  no_response: { cooldownMs: 48 * HOUR, escalationThreshold: 3, escalationWindowMs: 30 * DAY },
  other: { cooldownMs: 24 * HOUR, escalationThreshold: 2, escalationWindowMs: 14 * DAY },
};

/**
 * Resolve config for a specific outcome on a specific instance. Falls back
 * to `DEFAULT_CLOSE_CONTACT_CONFIG` per-key when the instance override is
 * missing or partial. Unknown override keys are ignored.
 *
 * The override shape is intentionally permissive (jsonb on instance.settings)
 * so ops can hot-tune via PATCH /instances/:id/settings without a migration.
 */
export function resolveCloseContactConfig(
  outcome: CloseContactOutcome,
  instanceSettings: unknown,
): CloseContactOutcomeConfig {
  const override = (instanceSettings as { closeContactConfig?: Partial<CloseContactConfig> } | null | undefined)
    ?.closeContactConfig;
  const def = DEFAULT_CLOSE_CONTACT_CONFIG[outcome];
  if (!override || typeof override !== 'object') return def;
  const ovr = override[outcome];
  if (!ovr || typeof ovr !== 'object') return def;
  return {
    cooldownMs: typeof ovr.cooldownMs === 'number' || ovr.cooldownMs === null ? ovr.cooldownMs : def.cooldownMs,
    escalationThreshold:
      typeof ovr.escalationThreshold === 'number' || ovr.escalationThreshold === null
        ? ovr.escalationThreshold
        : def.escalationThreshold,
    escalationWindowMs:
      typeof ovr.escalationWindowMs === 'number' || ovr.escalationWindowMs === null
        ? ovr.escalationWindowMs
        : def.escalationWindowMs,
  };
}

/** True for outcomes that are unconditionally hard-terminal (won/lost). */
export function isHardTerminalOutcome(outcome: CloseContactOutcome): boolean {
  return outcome === 'won' || outcome === 'lost';
}
