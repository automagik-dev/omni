/**
 * Pure helpers for the live-chat console + Agent Lens. DOM-free so the safety
 * rails (canary/production gating), the event↔message↔chat correlation, and the
 * rendering derivations (delivery ticks, day separators, media URLs) are all
 * unit-testable.
 *
 * Grounded in the live payload shapes (see `api/ext.ts`):
 *   - a message's pipeline events join back on `event.externalId === message.externalId`;
 *   - a chat's events join on `event.chatUuid === chat.id` (the `/events` chatId
 *     query is ignored server-side, so we over-fetch and filter here);
 *   - media is served by the BFF at `/api/v2/media/<mediaLocalPath>`.
 */
import type { AgentStateSnapshot, ChatRow, EventRow, MessageRow } from '../../api/ext';
import { PRODUCTION_INSTANCE_IDS } from '../instances/instance-helpers';

// ── Safety: production instances & the sanctioned canary chat ─────────────────

/** felipe-whatsapp (own number 5511986780008). */
export const FELIPE_WHATSAPP_ID = '506377b1-eb79-4ae3-abc1-80bd00986f6b';
/** pessoal-whatsapp (own number 5512982298888). */
export const PESSOAL_WHATSAPP_ID = '11c1a3e2-bb53-45df-aac8-0418f44ea5d5';

const FELIPE_NUMBER = '5511986780008';
const PESSOAL_NUMBER = '5512982298888';

function digits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

export function isProductionChat(chat: Pick<ChatRow, 'instanceId'>): boolean {
  return PRODUCTION_INSTANCE_IDS.includes(chat.instanceId);
}

/**
 * The single sanctioned live chat on a production instance: the DM between
 * Felipe's two numbers (felipe-whatsapp ↔ pessoal-whatsapp). Chat-flag
 * mutations on production are allowed ONLY here.
 */
export function isCanaryChat(chat: Pick<ChatRow, 'instanceId' | 'externalId' | 'chatType'>): boolean {
  const ext = digits(chat.externalId);
  if (chat.chatType && chat.chatType !== 'dm' && chat.chatType !== 'direct' && chat.chatType !== 'contact')
    return false;
  if (chat.instanceId === FELIPE_WHATSAPP_ID) return ext.includes(PESSOAL_NUMBER);
  if (chat.instanceId === PESSOAL_WHATSAPP_ID) return ext.includes(FELIPE_NUMBER);
  return false;
}

/**
 * Whether chat-flag mutations (read/pin/mute/labels/rename/archive/disappearing)
 * are permitted on this chat: any non-production chat, or the canary chat.
 */
export function canMutateChatFlags(chat: Pick<ChatRow, 'instanceId' | 'externalId' | 'chatType'>): boolean {
  return !isProductionChat(chat) || isCanaryChat(chat);
}

/**
 * clear-session / reopen-contact reset production agent-session state, so they
 * are disabled on ANY production chat (including the canary).
 */
export function canClearSession(chat: Pick<ChatRow, 'instanceId'>): boolean {
  return !isProductionChat(chat);
}

/**
 * Whether a send (text OR any attachment/media/poll/…) must be explicitly
 * confirmed before it hits the wire: a production chat that is NOT the sanctioned
 * canary. Keeps every composer path on one gate so an operator can't message a
 * real contact by reflex.
 */
export function requiresSendConfirm(chat: Pick<ChatRow, 'instanceId' | 'externalId' | 'chatType'>): boolean {
  return isProductionChat(chat) && !isCanaryChat(chat);
}

// ── JID / display-name normalization ─────────────────────────────────────────

const JID_SUFFIX = /@(s\.whatsapp\.net|g\.us|c\.us|lid|broadcast|newsletter)$/i;

export function stripJid(s: string | null | undefined): string {
  return (s ?? '').replace(JID_SUFFIX, '');
}

/** True when a string is a raw JID or a bare numeric id rather than a human name. */
export function isJidLike(s: string | null | undefined): boolean {
  if (!s) return false;
  return JID_SUFFIX.test(s) || /^\d{7,}$/.test(s.trim());
}

/**
 * Best display name for a chat: a real name if it isn't a raw JID, else the
 * cleaned external id (a bare phone number is an acceptable fallback — that's
 * what WhatsApp shows for an unsaved contact).
 */
export function chatDisplayName(chat: Pick<ChatRow, 'name' | 'externalId' | 'id'>): string {
  if (chat.name && !isJidLike(chat.name)) return chat.name;
  const bare = stripJid(chat.externalId);
  if (bare) return bare;
  return chat.name?.trim() || chat.id.slice(0, 8);
}

/** Best display name for a message sender (bare number is an acceptable fallback). */
export function senderLabel(msg: Pick<MessageRow, 'isFromMe' | 'senderDisplayName' | 'senderPlatformUserId'>): string {
  if (msg.isFromMe) return 'You';
  if (msg.senderDisplayName && !isJidLike(msg.senderDisplayName)) return msg.senderDisplayName;
  const bare = stripJid(msg.senderPlatformUserId);
  if (bare) return bare;
  return msg.senderDisplayName?.trim() || 'Unknown';
}

// ── Media ────────────────────────────────────────────────────────────────────

/**
 * BFF-servable URL for a message's cached media, or null when not yet cached
 * (caller should `ext.messages.mediaDownload` to populate it first).
 */
export function mediaUrl(bffBase: string, msg: Pick<MessageRow, 'mediaLocalPath'>): string | null {
  if (!msg.mediaLocalPath) return null;
  return `${bffBase}/api/v2/media/${msg.mediaLocalPath}`;
}

export type MediaKind = 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'none';

export function mediaKind(msg: Pick<MessageRow, 'messageType' | 'mediaMimeType' | 'hasMedia'>): MediaKind {
  const type = (msg.messageType ?? '').toLowerCase();
  const mime = (msg.mediaMimeType ?? '').toLowerCase();
  if (type === 'sticker') return 'sticker';
  if (type === 'image' || mime.startsWith('image/')) return 'image';
  if (type === 'audio' || type === 'voice' || type === 'ptt' || mime.startsWith('audio/')) return 'audio';
  if (type === 'video' || mime.startsWith('video/')) return 'video';
  if (type === 'document' || type === 'file' || (msg.hasMedia && mime)) return 'document';
  return 'none';
}

// ── Delivery status ticks ────────────────────────────────────────────────────

export interface DeliveryTick {
  /** Compact glyph rendered on outbound bubbles. */
  glyph: string;
  label: string;
  tone: 'muted' | 'ok' | 'accent' | 'danger';
}

export function deliveryTick(status: string | null | undefined): DeliveryTick | null {
  switch ((status ?? '').toLowerCase()) {
    case 'pending':
    case 'queued':
    case 'sending':
      return { glyph: '⧖', label: 'pending', tone: 'muted' };
    case 'sent':
      return { glyph: '✓', label: 'sent', tone: 'muted' };
    case 'delivered':
      return { glyph: '✓✓', label: 'delivered', tone: 'muted' };
    case 'read':
    case 'played':
      return { glyph: '✓✓', label: 'read', tone: 'accent' };
    case 'failed':
    case 'error':
    case 'undelivered':
      return { glyph: '!', label: 'failed', tone: 'danger' };
    default:
      return null;
  }
}

// ── Timestamps / day separators ──────────────────────────────────────────────

export function messageTime(msg: Pick<MessageRow, 'platformTimestamp' | 'receivedAt' | 'createdAt'>): number {
  const raw = msg.platformTimestamp ?? msg.receivedAt ?? msg.createdAt ?? null;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function formatClock(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function formatDaySeparator(ts: number, now: number = Date.now()): string {
  if (!ts) return '';
  if (dayKey(ts) === dayKey(now)) return 'Today';
  if (dayKey(ts) === dayKey(now - 86_400_000)) return 'Yesterday';
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Message accumulation (dedupe by id, ascending by time) ───────────────────

export function sortMessagesAsc(msgs: MessageRow[]): MessageRow[] {
  return [...msgs].sort((a, b) => messageTime(a) - messageTime(b));
}

/** Merge incoming messages into an accumulated list, newest write wins per id. */
export function mergeMessagesById(prev: MessageRow[], incoming: MessageRow[]): MessageRow[] {
  const map = new Map<string, MessageRow>();
  for (const m of prev) map.set(m.id, m);
  for (const m of incoming) {
    const existing = map.get(m.id);
    map.set(m.id, existing ? { ...existing, ...m } : m);
  }
  return sortMessagesAsc([...map.values()]);
}

// ── Reactions ────────────────────────────────────────────────────────────────

export interface ReactionTally {
  emoji: string;
  count: number;
}

export function reactionSummary(msg: Pick<MessageRow, 'reactions' | 'reactionCounts'>): ReactionTally[] {
  const counts = msg.reactionCounts;
  if (counts && typeof counts === 'object') {
    return Object.entries(counts)
      .map(([emoji, count]) => ({ emoji, count: Number(count) || 0 }))
      .filter((r) => r.count > 0);
  }
  if (Array.isArray(msg.reactions)) {
    const tally = new Map<string, number>();
    for (const r of msg.reactions as Array<{ emoji?: string; text?: string }>) {
      const emoji = r?.emoji ?? r?.text;
      if (emoji) tally.set(emoji, (tally.get(emoji) ?? 0) + 1);
    }
    return [...tally.entries()].map(([emoji, count]) => ({ emoji, count }));
  }
  return [];
}

// ── Event ↔ chat ↔ message correlation ───────────────────────────────────────

export function eventsForChat(events: EventRow[], chatUuid: string): EventRow[] {
  return events.filter((e) => e.chatUuid === chatUuid);
}

/**
 * Events correlated to a chat, robust for both groups and DMs. Group events
 * carry `chatUuid`, but DM events carry `chatUuid=null` and an `@lid` chatId, so
 * the dependable join is the chat's own message external ids
 * (`event.externalId === message.externalId`). The chatUuid match additionally
 * catches group events that predate the loaded message window.
 */
export function correlateChatEvents(
  events: EventRow[],
  chatUuid: string,
  messageExternalIds: ReadonlySet<string>,
): EventRow[] {
  return events.filter(
    (e) => e.chatUuid === chatUuid || (e.externalId != null && messageExternalIds.has(e.externalId)),
  );
}

export function eventsForMessage(events: EventRow[], externalId: string | null | undefined): EventRow[] {
  if (!externalId) return [];
  return events.filter((e) => e.externalId === externalId);
}

export function eventCorrelationId(e: EventRow): string | null {
  const fromMeta =
    e.metadata && typeof e.metadata === 'object' ? (e.metadata.correlationId as string | undefined) : undefined;
  return fromMeta ?? e.conversationId ?? null;
}

export function eventTime(e: EventRow): number {
  const raw = e.receivedAt ?? e.createdAt ?? e.processedAt ?? null;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** A derived timeline step for the Trace pane. */
export interface TraceStep {
  event: EventRow;
  time: number;
  /** Latency in ms where the pipeline recorded one. */
  durationMs: number | null;
  /** 'ok' | 'pending' | 'error'. */
  outcome: 'ok' | 'pending' | 'error';
}

export function toTraceSteps(events: EventRow[]): TraceStep[] {
  return [...events]
    .sort((a, b) => eventTime(a) - eventTime(b))
    .map((event) => {
      const durationMs = event.totalLatencyMs ?? event.agentLatencyMs ?? event.processingTimeMs ?? null;
      const status = (event.status ?? '').toLowerCase();
      const outcome: TraceStep['outcome'] =
        event.errorMessage || status.includes('error') || status === 'failed'
          ? 'error'
          : event.processedAt || status === 'processed' || status === 'delivered' || status === 'received'
            ? 'ok'
            : 'pending';
      return { event, time: eventTime(event), durationMs, outcome };
    });
}

// ── Agent state derivations ──────────────────────────────────────────────────

export const BUSY_STATUSES = ['thinking', 'typing', 'sending', 'running_task', 'waiting'] as const;

export function isBusyStatus(status: string | null | undefined): boolean {
  return (BUSY_STATUSES as readonly string[]).includes((status ?? '').toLowerCase());
}

export function timeInState(state: Pick<AgentStateSnapshot, 'updatedAt'> | null, now: number): number | null {
  if (!state?.updatedAt) return null;
  return Math.max(0, now - state.updatedAt);
}

/**
 * "Possibly stalled": the agent reports a busy status but nothing has moved for
 * longer than `thresholdMs` — no state transition and no correlated event.
 */
export function isPossiblyStalled(
  state: Pick<AgentStateSnapshot, 'status' | 'updatedAt'> | null,
  lastEventAt: number | null,
  now: number,
  thresholdMs = 60_000,
): boolean {
  if (!state || !isBusyStatus(state.status)) return false;
  const lastActivity = Math.max(state.updatedAt ?? 0, lastEventAt ?? 0);
  if (!lastActivity) return false;
  return now - lastActivity > thresholdMs;
}

/** Map an agent status to a StatusDot state. */
export function agentStatusDot(status: string | null | undefined): 'live' | 'working' | 'idle' | 'error' | 'away' {
  const s = (status ?? '').toLowerCase();
  if (s === 'error') return 'error';
  if (s === 'idle') return 'idle';
  if (s === 'waiting') return 'away';
  if (isBusyStatus(s)) return 'working';
  return 'idle';
}

// ── Latency / duration formatting ────────────────────────────────────────────

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/** Truncate long content for evidence output (keeps logs/JSON readable). */
export function truncate(s: string | null | undefined, max = 80): string | null {
  if (s == null) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
