/**
 * Pure helpers for the instances slice: the production-instance safety guard,
 * channel display labels, connection-state derivation, and send/receive proof
 * extraction. Kept DOM-free so the safety rails are unit-testable.
 */

/**
 * The two live production instances. Mutating them (connect/disconnect/restart/
 * logout/delete, any PATCH, any attach) is prohibited — the UI reads them only.
 * The guard is enforced in the UI (write affordances hidden/blocked) and in the
 * validation script (asserts it only ever mutates a disposable id).
 */
export const PRODUCTION_INSTANCE_IDS: readonly string[] = [
  '506377b1-eb79-4ae3-abc1-80bd00986f6b', // felipe-whatsapp
  '11c1a3e2-bb53-45df-aac8-0418f44ea5d5', // pessoal-whatsapp
];

export function isProductionInstance(id: string | null | undefined): boolean {
  return id != null && PRODUCTION_INSTANCE_IDS.includes(id);
}

const CHANNEL_LABELS: Record<string, string> = {
  'whatsapp-baileys': 'WhatsApp (Baileys)',
  'whatsapp-business': 'WhatsApp Cloud',
  'twilio-whatsapp': 'Twilio WhatsApp',
  discord: 'Discord',
  slack: 'Slack',
  telegram: 'Telegram',
  gupshup: 'Gupshup',
  a2a: 'A2A',
  internal: 'Internal',
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

/** WhatsApp-family channels expose QR/pairing, groups, blocklist, privacy, etc. */
export function isWhatsApp(channel: string): boolean {
  return channel.startsWith('whatsapp') || channel === 'gupshup' || channel === 'twilio-whatsapp';
}

export type ConnState = 'connected' | 'connecting' | 'disconnected' | 'unknown';

/** Normalise the many backend state strings to a small, displayable set. */
export function normalizeConnState(state: string | null | undefined, isConnected?: boolean): ConnState {
  if (isConnected) return 'connected';
  const s = (state ?? '').toLowerCase();
  if (s === 'connected' || s === 'open' || s === 'ready') return 'connected';
  if (s === 'connecting' || s === 'qr' || s === 'pairing' || s === 'reconnecting') return 'connecting';
  if (s === 'disconnected' || s === 'closed' || s === 'logged_out' || s === 'close') return 'disconnected';
  return s ? 'unknown' : 'unknown';
}

/** Map a connection state to a StatusDot state prop. */
export function connStateDot(state: ConnState): 'live' | 'active' | 'away' | 'error' | 'idle' {
  switch (state) {
    case 'connected':
      return 'active';
    case 'connecting':
      return 'away';
    case 'disconnected':
      return 'error';
    default:
      return 'idle';
  }
}

export interface SendReceiveProof {
  transport: ConnState;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
  lastInboundPreview: string | null;
  lastOutboundState: string | null;
}

interface EventLike {
  direction?: string | null;
  receivedAt?: string | null;
  timestamp?: string | null;
  textContent?: string | null;
  transcription?: string | null;
  status?: string | null;
}

function eventTime(e: EventLike): number | null {
  const raw = e.receivedAt ?? e.timestamp;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Derive a send/receive proof split from the status endpoint plus recent events:
 * the transport state, the last inbound observed (with preview), and the last
 * outbound state. Proves the instance is actually moving messages, not just
 * "connected" on paper.
 */
export function deriveSendReceiveProof(
  status: { state?: string | null; isConnected?: boolean } | undefined,
  recentEvents: EventLike[],
): SendReceiveProof {
  const transport = normalizeConnState(status?.state, status?.isConnected);
  let inbound: EventLike | undefined;
  let outbound: EventLike | undefined;
  for (const e of recentEvents) {
    const dir = (e.direction ?? '').toLowerCase();
    if (dir === 'inbound' && !inbound) inbound = e;
    if (dir === 'outbound' && !outbound) outbound = e;
    if (inbound && outbound) break;
  }
  const preview = inbound?.textContent ?? inbound?.transcription ?? null;
  return {
    transport,
    lastInboundAt: inbound ? eventTime(inbound) : null,
    lastOutboundAt: outbound ? eventTime(outbound) : null,
    lastInboundPreview: preview ? (preview.length > 80 ? `${preview.slice(0, 80)}…` : preview) : null,
    lastOutboundState: outbound?.status ?? (outbound ? 'sent' : null),
  };
}

/** True when the QR payload is a renderable image data URL (vs a raw code string). */
export function isQrImage(qr: string | null | undefined): boolean {
  return typeof qr === 'string' && qr.startsWith('data:image');
}
