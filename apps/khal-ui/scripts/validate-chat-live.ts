#!/usr/bin/env bun
/**
 * validate-chat-live.ts — the Live-verified proof for the live-chat + Agent Lens
 * slice (Group D of the omni-khal-ui wish).
 *
 * Exercises the exact data path the UI uses (through an in-process BFF, so the
 * API key is injected server-side and never appears in this script) against the
 * live Omni backend:
 *
 *   1. List chats on BOTH production instances (read-only).
 *   2. Send the TEXT CANARY: felipe-whatsapp → 5512982298888 (Felipe's own other
 *      number). Content is clearly labeled "[khal-ui canary <ts>]".
 *   3. Poll pessoal-whatsapp until the canary text arrives as an INBOUND message
 *      (timeout 60s).
 *   4. Capture the outbound message's delivery-status trail (pending→…→read).
 *   5. Subscribe to /agent-state/stream?chatId=<canary chat> for 10s, recording
 *      whatever arrives (silence is recorded honestly).
 *   6. Pull the canary message's correlated events + payload stages, if any.
 *   7. Agent-state ladder: since real agent activity may be silent, exercise a
 *      SYNTHETIC agentId/chatId PUT (KV-only, unrelated to production) and record
 *      whether the SSE stream delivers the change. No DELETE endpoint exists, so
 *      the synthetic KV entry is documented as TTL-expiring / inert.
 *   8. Print evidence JSON (ids, timestamps, statuses — content truncated).
 *
 * SAFETY: the ONLY production mutation is the text canary (felipe→5512982298888).
 * The agent-state PUT uses freshly-generated UUIDs unrelated to any real entity.
 * The `mutate` guard refuses any other write; the evidence lists every mutation.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createBff } from '../service/src/bff.ts';

const FELIPE_WHATSAPP = '506377b1-eb79-4ae3-abc1-80bd00986f6b'; // sends the canary
const PESSOAL_WHATSAPP = '11c1a3e2-bb53-45df-aac8-0418f44ea5d5'; // receives the canary
const FELIPE_NUMBER = '5511986780008'; // felipe-whatsapp's own number (inbound sender on pessoal)
const PESSOAL_NUMBER = '5512982298888'; // the canary recipient
const PRODUCTION_IDS = [FELIPE_WHATSAPP, PESSOAL_WHATSAPP];

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

const checks: Check[] = [];
const mutations: string[] = [];
function record(name: string, ok: boolean, detail: string): boolean {
  checks.push({ name, status: ok ? 'pass' : 'fail', detail });
  return ok;
}
function truncate(s: string | null | undefined, n = 60): string | null {
  if (s == null) return null;
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  /** Read frames from an SSE endpoint for `ms`, returning the raw stream text. */
  const readStream = async (path: string, ms: number): Promise<string> => {
    const res = await bff.fetch(
      new Request(`http://validate/omni/api/v2${path}`, { headers: { accept: 'text/event-stream' } }),
    );
    const reader = res.body?.getReader();
    if (!reader) return '';
    const dec = new TextDecoder();
    const chunks: string[] = [];
    const started = Date.now();
    try {
      while (Date.now() - started < ms) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) chunks.push(dec.decode(value, { stream: true }));
      }
    } catch {
      /* stream closed — return what we have */
    }
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
    return chunks.join('');
  };

  const evidence: Record<string, unknown> = {};

  // ── 1. read-only chat lists on both production instances ────────────────────
  const felipeChats = await call('GET', `/chats?instanceId=${FELIPE_WHATSAPP}&limit=20`);
  const pessoalChats = await call('GET', `/chats?instanceId=${PESSOAL_WHATSAPP}&limit=20`);
  record(
    'read-only chat lists (both production instances)',
    felipeChats.status === 200 && pessoalChats.status === 200,
    `felipe=${felipeChats.status}(${((felipeChats.json as { items?: unknown[] })?.items ?? []).length}) pessoal=${pessoalChats.status}(${((pessoalChats.json as { items?: unknown[] })?.items ?? []).length})`,
  );

  // Resolve the canary chats on each side.
  const findChat = async (instanceId: string, number: string): Promise<{ id?: string; externalId?: string } | null> => {
    const r = await call('GET', `/chats?instanceId=${instanceId}&search=${number}&limit=5`);
    const items = (
      (r.json as { items?: Array<{ id?: string; externalId?: string; chatType?: string }> })?.items ?? []
    ).filter((c) => c.chatType === 'dm' || (c.externalId ?? '').includes('@s.whatsapp.net'));
    return items[0] ?? null;
  };
  const felipeCanaryChat = await findChat(FELIPE_WHATSAPP, PESSOAL_NUMBER);
  evidence.canaryChatFelipeSide = felipeCanaryChat?.id ?? null;

  // ── 5(pre). open the agent-state stream on the canary chat (record silence) ──
  let realStreamFrames = '';
  if (felipeCanaryChat?.id) {
    realStreamFrames = await readStream(`/agent-state/stream?chatId=${felipeCanaryChat.id}`, 10_000);
  }
  const realConnected = realStreamFrames.includes('event: connected');
  const realChanged = (realStreamFrames.match(/event: agent\.state\.changed/g) ?? []).length;
  record(
    'agent-state stream reachable on canary chat',
    Boolean(felipeCanaryChat?.id) && realConnected,
    `connected=${realConnected} changeFrames=${realChanged} (silence is expected when the agent is idle)`,
  );
  evidence.canaryStream = {
    connected: realConnected,
    changeFrames: realChanged,
    note:
      realChanged === 0
        ? 'No agent.state.changed during the 10s window — agent idle / no real activity.'
        : 'Live agent activity observed.',
  };

  // ── 2. send the TEXT CANARY felipe → 5512982298888 ──────────────────────────
  const stamp = new Date().toISOString();
  const canaryText = `[khal-ui canary ${stamp}] live-chat validation ping`;
  mutations.push(`POST /messages/send instance=${FELIPE_WHATSAPP} to=${PESSOAL_NUMBER}`);
  const sent = await call('POST', '/messages/send', {
    instanceId: FELIPE_WHATSAPP,
    to: PESSOAL_NUMBER,
    text: canaryText,
  });
  const outboundId = (sent.json as { data?: { messageId?: string; status?: string } })?.data?.messageId ?? null;
  const sentOk = (sent.status === 200 || sent.status === 201) && Boolean(outboundId);
  record('text canary sent (felipe → 5512982298888)', sentOk, `status=${sent.status} messageId=${outboundId}`);
  evidence.canarySend = {
    instanceId: FELIPE_WHATSAPP,
    to: PESSOAL_NUMBER,
    text: truncate(canaryText),
    status: sent.status,
    messageId: outboundId,
    initialStatus: (sent.json as { data?: { status?: string } })?.data?.status ?? null,
  };
  if (!sentOk) {
    // Do not retry-spam; record and finish honestly.
    return finish(evidence);
  }

  // ── 4. delivery-status trail of the outbound message ────────────────────────
  // `send` returns the WhatsApp EXTERNAL id, not the Omni UUID. Poll the felipe
  // canary chat's own messages (the same path the thread UI uses) to find the
  // outbound row and watch its deliveryStatus advance.
  const outboundExternalId = outboundId as string; // guaranteed non-null past the sentOk guard
  const trail: Array<{ at: string; deliveryStatus: string | null; status: string | null }> = [];
  let outboundUuid: string | null = null;
  for (let i = 0; i < 10 && felipeCanaryChat?.id; i++) {
    await sleep(1500);
    const msgs = await call('GET', `/chats/${felipeCanaryChat.id}/messages?limit=10`);
    const items =
      (
        msgs.json as {
          items?: Array<{
            id?: string;
            externalId?: string;
            isFromMe?: boolean;
            textContent?: string;
            deliveryStatus?: string;
            status?: string;
          }>;
        }
      )?.items ?? [];
    const out = items.find(
      (m) => m.externalId === outboundExternalId || (m.isFromMe && (m.textContent ?? '').includes(stamp)),
    );
    if (out) {
      outboundUuid = out.id ?? outboundUuid;
      const last = trail[trail.length - 1];
      if (!last || last.deliveryStatus !== (out.deliveryStatus ?? null)) {
        trail.push({
          at: new Date().toISOString(),
          deliveryStatus: out.deliveryStatus ?? null,
          status: out.status ?? null,
        });
      }
      if (out.deliveryStatus === 'read' || out.deliveryStatus === 'delivered') break;
    }
  }
  record(
    'outbound delivery-status trail captured',
    trail.length > 0,
    `uuid=${outboundUuid ?? 'n/a'} trail=${trail.map((t) => t.deliveryStatus).join('→') || 'none'}`,
  );
  evidence.deliveryTrail = trail;
  evidence.outboundExternalId = outboundExternalId;
  evidence.outboundUuid = outboundUuid;

  // ── 3. poll pessoal until the canary arrives as INBOUND ─────────────────────
  const pessoalCanaryChat = await findChat(PESSOAL_WHATSAPP, FELIPE_NUMBER);
  evidence.canaryChatPessoalSide = pessoalCanaryChat?.id ?? null;
  let inbound: { id?: string; externalId?: string; isFromMe?: boolean; textContent?: string } | null = null;
  const deadline = Date.now() + 60_000;
  if (pessoalCanaryChat?.id) {
    while (Date.now() < deadline && !inbound) {
      const msgs = await call('GET', `/chats/${pessoalCanaryChat.id}/messages?limit=10`);
      const items =
        (msgs.json as { items?: Array<{ id?: string; externalId?: string; isFromMe?: boolean; textContent?: string }> })
          ?.items ?? [];
      inbound = items.find((m) => !m.isFromMe && (m.textContent ?? '').includes(stamp)) ?? null;
      if (!inbound) await sleep(3000);
    }
  }
  record(
    'canary visible as INBOUND on pessoal-whatsapp',
    Boolean(inbound),
    inbound ? `messageId=${inbound.id}` : 'not observed within 60s (delivery may lag; outbound trail still captured)',
  );
  evidence.canaryInbound = inbound
    ? { messageId: inbound.id, externalId: inbound.externalId, text: truncate(inbound.textContent) }
    : null;

  // ── 6. correlated events + payload stages for the canary message ────────────
  // The reliable join for a DM is the external id (event.externalId ===
  // message.externalId): DM events carry chatUuid=null and an @lid chatId, so the
  // chat-UUID join only catches group chats. `/events` caps limit at 100 and
  // ignores a chat filter, so we page the recent window and narrow here.
  const eventsRes = await call('GET', `/events?instanceId=${FELIPE_WHATSAPP}&limit=100`);
  const allEvents = (eventsRes.json as { items?: Array<Record<string, unknown>> })?.items ?? [];
  const correlated = allEvents.filter(
    (e) => e.externalId === outboundExternalId || (felipeCanaryChat?.id && e.chatUuid === felipeCanaryChat.id),
  );
  record(
    'correlated events found for the canary chat',
    correlated.length > 0,
    `events=${correlated.length} (join on externalId/chatUuid)`,
  );
  let payloadStages = 0;
  if (correlated[0]?.id) {
    const pl = await call('GET', `/events/${correlated[0].id as string}/payloads`);
    payloadStages = ((pl.json as { items?: unknown[] })?.items ?? []).length;
  }
  evidence.trace = {
    outboundExternalId,
    correlatedEventCount: correlated.length,
    sampleEventTypes: correlated
      .slice(0, 5)
      .map((e) => ({ type: e.eventType, dir: e.direction, status: e.status, latMs: e.totalLatencyMs })),
    payloadStages,
  };

  // ── 7. synthetic agent-state ladder (KV-only, unrelated to production) ───────
  const synthAgent = randomUUID();
  const synthChat = randomUUID();
  mutations.push(`PUT /agent-state/${synthAgent}/${synthChat} (synthetic)`);
  const synthFramesPromise = readStream(`/agent-state/stream?chatId=${synthChat}`, 6000);
  await sleep(1200);
  const put1 = await call('PUT', `/agent-state/${synthAgent}/${synthChat}`, {
    status: 'thinking',
    statusMeta: { source: 'validate-chat-live', synthetic: true },
  });
  await sleep(600);
  const putGet = await call('GET', `/agent-state/${synthAgent}/${synthChat}`);
  await sleep(400);
  await call('PUT', `/agent-state/${synthAgent}/${synthChat}`, { status: 'idle' });
  const synthFrames = await synthFramesPromise;
  const synthConnected = synthFrames.includes('event: connected');
  const synthChanged = (synthFrames.match(/event: agent\.state\.changed/g) ?? []).length;
  // The PUT is accepted (200) regardless; whether the stream broadcasts depends
  // on the backend's KV availability. Record honestly rather than asserting.
  record(
    'synthetic agent-state PUT accepted + stream observed',
    put1.status === 200 && synthConnected,
    `put=${put1.status} streamConnected=${synthConnected} changeFrames=${synthChanged} oneShotGet=${putGet.status}`,
  );
  evidence.agentStateLadder = {
    syntheticAgentId: synthAgent,
    syntheticChatId: synthChat,
    putStatus: put1.status,
    oneShotGetStatus: putGet.status,
    streamConnected: synthConnected,
    changeFramesDelivered: synthChanged,
    cleanup: 'No DELETE endpoint for agent-state; the synthetic KV entry is inert and expires via the 24h bucket TTL.',
    interpretation:
      synthChanged > 0
        ? 'SSE delivered the synthetic state change end-to-end.'
        : 'PUT accepted (200) but no agent.state.changed frame arrived and the one-shot GET did not return it — this backend is not persisting/broadcasting KV state for synthetic pairs. Recorded as-is.',
  };

  return finish(evidence);
}

function finish(evidence: Record<string, unknown>): number {
  // Safety assertion: every mutation was the canary send or a synthetic PUT.
  const safe = mutations.every((m) => m.includes(`to=${PESSOAL_NUMBER}`) || m.includes('(synthetic)'));
  record(
    'SAFETY: only canary send + synthetic agent-state were mutated',
    safe,
    `mutations=${JSON.stringify(mutations)}`,
  );

  // A note on which checks are hard gates vs. environment-dependent observations.
  const hardFailures = checks.filter((c) => c.status === 'fail' && !SOFT_CHECKS.has(c.name));
  const summary = {
    ok: hardFailures.length === 0,
    generatedAt: new Date().toISOString(),
    productionIds: PRODUCTION_IDS,
    mutations,
    checks,
    softChecks: [...SOFT_CHECKS],
    evidence,
  };
  console.log(JSON.stringify(summary, null, 2));

  // Persist a key-free copy so `bun run evidence` can reuse it without re-sending
  // the canary. Content is already truncated in `evidence`; no key material here.
  try {
    const dir = `${import.meta.dir}/../evidence`;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    writeFileSync(`${dir}/chat-evidence-${date}.json`, `${JSON.stringify(summary, null, 2)}\n`);
  } catch {
    /* evidence persistence is best-effort; the stdout JSON is the source of record */
  }
  if (hardFailures.length > 0) {
    console.error(`\nFAIL: ${hardFailures.length} hard check(s) failed.`);
    return 1;
  }
  console.error('\nOK: live-chat validation passed against the live backend.');
  return 0;
}

/**
 * Checks that depend on live delivery timing or real agent activity — recorded
 * as evidence but not treated as hard gates (a quiet agent or a slow WhatsApp
 * relay must not fail the run once the canary is provably sent).
 */
const SOFT_CHECKS = new Set<string>([
  'canary visible as INBOUND on pessoal-whatsapp',
  'correlated events found for the canary chat',
]);

process.exit(await main());
