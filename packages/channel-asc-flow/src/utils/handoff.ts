/**
 * Handoff validation — everything that decides whether a turn may say
 * `hand_off: "sim"`, and with which values.
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

export interface HandoffPlan {
  /** Destination queue for `/transferirHumano`. Validated: positive integer. */
  codServico: number;
  /** The platform accepts 0 (normal) or 1 (priority) — nothing else. */
  codPrioridade: 0 | 1;
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
 * `null` means: do not call `/transferirHumano`, and answer the flow with
 * `hand_off: "nao"`. Lying to the flow routes the beneficiary to a node that
 * has nobody behind it.
 */
export function planHandoff(
  meta: Record<string, unknown>,
  fallbackServico: unknown,
  logger: Logger,
): HandoffPlan | null {
  const read = pickFrom(meta);
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

  return { codServico, codPrioridade, fields: buildGenesysFields(read, logger) };
}

/** The two userdata fields the agent owns. Anything malformed is OMITTED, never coerced. */
function buildGenesysFields(read: (...keys: string[]) => unknown, logger: Logger): HandoffPlan['fields'] {
  const fields: HandoffPlan['fields'] = {};

  const rawFila = read('handoffQueue', 'fila_vq');
  if (rawFila !== undefined && rawFila !== null) {
    const fila = String(rawFila).trim();
    if (FILA_PATTERN.test(fila)) fields.fila_vq = fila;
    else {
      // Omitting is the safe failure: Genesys falls back to the flow's default
      // queue, which beats routing on a garbage code.
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
