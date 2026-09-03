/**
 * Handoff validation — everything that decides whether a turn may say
 * `hand_off: "sim"`, and with which values.
 *
 * The two destinations are EXCLUSIVE — see `AscFlowHandoffMode`.
 *
 * Why this is its own file: the numbers here leave our process twice. The
 * `cod_servico` goes to `POST /transferirHumano`, and `fila_vq` /
 * `motivo_transf_vq` ride the poll body straight into the Genesys component's
 * `u_cod_transf` / `u_bot_motivo_transf` userdata (HANDOFF-GENESYS.md). A bad
 * value there does not fail loudly: the beneficiary has already read "vou te
 * transferir" and nobody arrives.
 *
 * `Number()` is the trap this replaces — `Number("")` and `Number([])` are
 * both `0` (a service that does not exist), and `Number("fila-x")` is `NaN`,
 * which `JSON.stringify` puts on the wire as `null`.
 */

import type { Logger } from '@omni/core';

/**
 * The queue code the Genesys component reads. No domain exists yet (the
 * de-para is a known pendency on the Hapvida side), so this only enforces a
 * conservative SHAPE — enough to keep junk out of `u_cod_transf`.
 */
const FILA_PATTERN = /^[A-Za-z0-9_.-]{1,32}$/;

/** `u_bot_motivo_transf` is free text; cap it so a runaway prompt cannot flood it. */
const MOTIVO_MAX_LENGTH = 255;

/**
 * Which of the two MUTUALLY EXCLUSIVE handoff destinations this instance uses.
 *
 * Measured live on atendimento 22286567 (flow #225, 03/09): `POST
 * /transferirHumano` was accepted, the atendimento left "Automático" for
 * "Aguardando atendimento" — and the flow STOPPED POLLING. One event after the
 * call, nothing more. A dead flow never reads `hand_off:"sim"` and never
 * reaches the `genesys_mobile_service` node, so the WDE agent got nothing.
 *
 * - `flow` (default): do NOT call `/transferirHumano`. Answer the poll with
 *   `hand_off:"sim"` + `fila_vq` + `motivo_transf_vq` and let the flow route to
 *   the Genesys node. This is the Hapvida/Genesys path.
 * - `service`: call `/transferirHumano` — the atendimento lands in the ASC's own
 *   internal queue, worked from the ASC panel. The flow dies, by design.
 */
export type AscFlowHandoffMode = 'flow' | 'service';

export interface HandoffPlan {
  /**
   * The `/transferirHumano` arguments — `null` in `flow` mode, where no call is
   * made at all.
   */
  transfer: { codServico: number; codPrioridade: 0 | 1 } | null;
  /** The Genesys userdata fields, present only when they validated. */
  fields: { fila_vq?: string; motivo_transf_vq?: string };
}

/**
 * Read a handoff input under any of its accepted names.
 *
 * Two callers exist and they speak different dialects. A plugin caller sets
 * `metadata.handoffQueue` / `handoffReason` / `handoffServico` directly. The
 * REST route `POST /messages/send/handoff` (which is what an agent tool calls)
 * has no per-channel keys: it forwards a free `handoffFields` record plus
 * `motivoHandoff`. Without this the route could never fill `fila_vq` at all,
 * so the wire names (`fila_vq`, `motivo_transf_vq`, `cod_servico`) are read
 * from inside `handoffFields` too. Top-level `metadata` wins.
 */
function pickFrom(meta: Record<string, unknown>): (...keys: string[]) => unknown {
  const bag =
    typeof meta.handoffFields === 'object' && meta.handoffFields !== null
      ? (meta.handoffFields as Record<string, unknown>)
      : {};
  return (...keys) => keys.map((key) => meta[key] ?? bag[key]).find((value) => value !== undefined);
}

/** Accept a positive integer, from a number or a fully-numeric string. Nothing else. */
function toPositiveInt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Build the handoff plan for a turn, or `null` when the turn must NOT hand off.
 *
 * `null` means: make no platform call, and answer the flow with
 * `hand_off: "nao"`. Lying to the flow routes the beneficiary to a node that
 * has nobody behind it.
 *
 * What makes `hand_off:"sim"` TRUE differs per mode:
 *
 * - `service`: the transfer was ACCEPTED by `/transferirHumano` (this function
 *   only validates the inputs; `sendMessage` wraps the call itself).
 * - `flow`: no call exists to be accepted, so it is true when the handoff was
 *   REQUESTED and the fields validated. But `fila_vq` is what decides the
 *   routing here, so a malformed one is a REFUSAL — not a silent omission.
 */
export function planHandoff(
  mode: AscFlowHandoffMode,
  meta: Record<string, unknown>,
  fallbackServico: unknown,
  logger: Logger,
): HandoffPlan | null {
  const read = pickFrom(meta);

  const fields = buildGenesysFields(read, logger, mode);
  if (fields === null) return null;

  if (mode === 'flow') return { transfer: null, fields };

  const rawServico = read('handoffServico', 'cod_servico') ?? fallbackServico;
  const codServico = toPositiveInt(rawServico);
  if (codServico === null) {
    logger.error('[asc-flow] handoff refused: cod_servico is not a positive integer', {
      received: rawServico,
      type: typeof rawServico,
    });
    return null;
  }

  const rawPrioridade = read('handoffPriority', 'cod_prioridade');
  let codPrioridade: 0 | 1 = 0;
  if (rawPrioridade === 1 || rawPrioridade === '1') codPrioridade = 1;
  else if (rawPrioridade !== undefined && rawPrioridade !== 0 && rawPrioridade !== '0') {
    logger.debug('[asc-flow] cod_prioridade out of domain, defaulting to 0', { received: rawPrioridade });
  }

  return { transfer: { codServico, codPrioridade }, fields };
}

/**
 * The two userdata fields the agent owns. `null` = refuse the whole handoff.
 *
 * A malformed `fila_vq` is only survivable in `service` mode, where the ASC's
 * own queue receives the atendimento and the field is decoration. In `flow`
 * mode it is the routing key: omitting it hands Genesys a transfer with no
 * destination. An ABSENT one is still fine in both — flow #225 hardcodes
 * `u_cod_transf` to `SKILL_WPP_TECNICA_GENESYS` and never reads `{#fila_vq}`,
 * so a flow that resolves its own queue is a supported (and current) setup.
 * Only PRESENT-AND-MALFORMED is the error.
 */
function buildGenesysFields(
  read: (...keys: string[]) => unknown,
  logger: Logger,
  mode: AscFlowHandoffMode,
): HandoffPlan['fields'] | null {
  const fields: HandoffPlan['fields'] = {};

  const rawFila = read('handoffQueue', 'fila_vq');
  if (rawFila !== undefined && rawFila !== null) {
    const fila = String(rawFila).trim();
    if (FILA_PATTERN.test(fila)) fields.fila_vq = fila;
    else if (mode === 'flow') {
      logger.error('[asc-flow] handoff refused: fila_vq does not match the accepted shape', { received: rawFila });
      return null;
    } else {
      // Omitting is the safe failure HERE: the ASC queue already has the
      // atendimento, and Genesys falls back to the flow's default queue.
      logger.warn('[asc-flow] fila_vq omitted: value does not match the accepted shape', { received: rawFila });
    }
  }

  const rawMotivo = read('handoffReason', 'motivo_transf_vq', 'motivoHandoff');
  if (typeof rawMotivo === 'string') {
    const motivo = rawMotivo.replace(/\s+/g, ' ').trim().slice(0, MOTIVO_MAX_LENGTH);
    if (motivo) fields.motivo_transf_vq = motivo;
  }

  return fields;
}
