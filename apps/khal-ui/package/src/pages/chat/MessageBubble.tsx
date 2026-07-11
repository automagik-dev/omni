'use client';

/**
 * A single message bubble in the thread: direction-aware layout, sender name,
 * media (image inline, audio/video players, document link — via BFF media URLs),
 * reply quotes, forwarded/edited markers, reactions, timestamp, and delivery
 * ticks on outbound. Media that isn't cached yet is fetched on demand so a
 * scroll-through doesn't download every attachment.
 */
import { useState } from 'react';
import type { MessageRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { T } from '../../components/tokens';
import {
  type DeliveryTick,
  deliveryTick,
  formatClock,
  mediaKind,
  mediaUrl,
  messageTime,
  reactionSummary,
  senderLabel,
} from './chat-helpers';

const TICK_TONE: Record<DeliveryTick['tone'], string> = {
  muted: T.muted,
  ok: T.ok,
  accent: T.accentBlue,
  danger: T.danger,
};

function MediaBlock({ msg }: { msg: MessageRow }) {
  const { bffBase } = useOmniClient();
  const { ext } = useOmniClient();
  const kind = mediaKind(msg);
  const [url, setUrl] = useState<string | null>(() => mediaUrl(bffBase, msg));
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (kind === 'none') return null;

  const fetchMedia = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await ext.messages.mediaDownload({ messageId: msg.id });
      const path = res.data?.downloadUrl;
      if (path) setUrl(`${bffBase}${path.startsWith('/') ? '' : '/'}${path}`);
      else setErr('No media returned');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load media');
    } finally {
      setLoading(false);
    }
  };

  if (!url) {
    return (
      <button
        type="button"
        onClick={fetchMedia}
        disabled={loading}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          borderRadius: 8,
          border: `1px dashed ${T.border}`,
          background: T.sunken,
          color: T.fg,
          fontSize: 12,
          cursor: loading ? 'default' : 'pointer',
        }}
      >
        {loading ? 'Loading…' : `Load ${kind}`}
        {err && <span style={{ color: T.danger }}> · {err}</span>}
      </button>
    );
  }

  if (kind === 'image' || kind === 'sticker') {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img
          src={url}
          alt={msg.textContent ?? 'image'}
          style={{ maxWidth: kind === 'sticker' ? 140 : 260, maxHeight: 300, borderRadius: 8, display: 'block' }}
        />
      </a>
    );
  }
  if (kind === 'audio') {
    // biome-ignore lint/a11y/useMediaCaption: user-generated voice notes have no captions.
    return <audio controls src={url} style={{ maxWidth: 260 }} />;
  }
  if (kind === 'video') {
    // biome-ignore lint/a11y/useMediaCaption: user-generated video has no captions.
    return <video controls src={url} style={{ maxWidth: 280, maxHeight: 320, borderRadius: 8 }} />;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      style={{ color: T.accentBlue, fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center' }}
    >
      📄 {msg.mediaMimeType ?? 'document'}
    </a>
  );
}

function ReplyQuote({ msg }: { msg: MessageRow }) {
  if (!msg.quotedText && !msg.replyToMessageId) return null;
  return (
    <div
      style={{
        borderLeft: `3px solid ${T.accentBlue}`,
        padding: '2px 8px',
        margin: '2px 0 4px',
        background: T.sunken,
        borderRadius: 4,
        fontSize: 12,
        color: T.muted,
      }}
    >
      {msg.quotedSenderName && <div style={{ color: T.accentBlue, fontWeight: 600 }}>{msg.quotedSenderName}</div>}
      {msg.quotedText ?? 'Replied message'}
    </div>
  );
}

function BubbleBody({ msg }: { msg: MessageRow }) {
  const isDeleted = Boolean(msg.deletedAt) || msg.status === 'deleted';
  const transcript = msg.transcription ?? msg.imageDescription ?? msg.videoDescription ?? msg.documentExtraction;
  if (isDeleted) return <span style={{ fontStyle: 'italic', color: T.muted }}>This message was deleted</span>;
  if (msg.textContent) return <span style={{ whiteSpace: 'pre-wrap' }}>{msg.textContent}</span>;
  if (transcript) {
    return <span style={{ fontStyle: 'italic', color: T.muted, whiteSpace: 'pre-wrap' }}>“{transcript}”</span>;
  }
  return null;
}

function BubbleMeta({ msg, mine }: { msg: MessageRow; mine: boolean }) {
  const edited = (msg.editCount ?? 0) > 0 || Boolean(msg.editedAt);
  const tick = mine ? deliveryTick(msg.deliveryStatus) : null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 5,
        marginTop: 2,
        fontSize: 10.5,
        color: T.muted,
      }}
    >
      {edited && <span title={msg.editedAt ?? undefined}>edited</span>}
      <span>{formatClock(messageTime(msg))}</span>
      {tick && (
        <span title={tick.label} style={{ color: TICK_TONE[tick.tone], fontWeight: 700 }}>
          {tick.glyph}
        </span>
      )}
    </div>
  );
}

function Reactions({ msg, mine }: { msg: MessageRow; mine: boolean }) {
  const reactions = reactionSummary(msg);
  if (reactions.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 4, marginTop: -4, marginRight: mine ? 4 : 0, marginLeft: mine ? 0 : 4 }}>
      {reactions.map((r) => (
        <span
          key={r.emoji}
          style={{
            fontSize: 11,
            padding: '1px 6px',
            borderRadius: 999,
            background: T.surface,
            border: `1px solid ${T.border}`,
          }}
        >
          {r.emoji} {r.count > 1 ? r.count : ''}
        </span>
      ))}
    </div>
  );
}

export function MessageBubble({ msg, showSender }: { msg: MessageRow; showSender: boolean }) {
  const mine = Boolean(msg.isFromMe);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', gap: 2 }}>
      <div
        style={{
          maxWidth: '78%',
          minWidth: 0,
          padding: '7px 11px',
          borderRadius: 12,
          borderBottomRightRadius: mine ? 3 : 12,
          borderBottomLeftRadius: mine ? 12 : 3,
          background: mine ? 'color-mix(in srgb, var(--khal-accent, #3b82f6) 22%, transparent)' : T.surface,
          border: `1px solid ${mine ? 'color-mix(in srgb, var(--khal-accent, #3b82f6) 40%, transparent)' : T.border}`,
          color: T.fg,
          fontSize: 13.5,
          lineHeight: 1.45,
          wordBreak: 'break-word',
        }}
      >
        {showSender && !mine && (
          <div style={{ fontSize: 11.5, fontWeight: 700, color: T.accentBlue, marginBottom: 2 }}>
            {senderLabel(msg)}
          </div>
        )}
        {msg.isForwarded && (
          <div style={{ fontSize: 11, color: T.muted, fontStyle: 'italic', marginBottom: 2 }}>↪ Forwarded</div>
        )}
        <ReplyQuote msg={msg} />
        {mediaKind(msg) !== 'none' && (
          <div style={{ margin: '2px 0' }}>
            <MediaBlock msg={msg} />
          </div>
        )}
        <BubbleBody msg={msg} />
        <BubbleMeta msg={msg} mine={mine} />
      </div>
      <Reactions msg={msg} mine={mine} />
    </div>
  );
}
