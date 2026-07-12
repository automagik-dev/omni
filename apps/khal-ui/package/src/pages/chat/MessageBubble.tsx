'use client';

/**
 * A single message bubble in the thread: direction-aware layout, sender name,
 * media (image inline, audio/video players, document card — via BFF media URLs),
 * reply quotes, forwarded/edited markers, reactions, timestamp, and delivery
 * ticks on outbound. Media that isn't cached yet is fetched on demand so a
 * scroll-through doesn't download every attachment.
 *
 * KhalOS-native surfaces: inbound sits on a raised surface (left tail), outbound
 * is copper-tinted (right tail); every timestamp and tick is mono + tabular;
 * media is a rounded card with a hover-zoom affordance; reactions float as a
 * pill cluster over the bubble's edge; a reply is an inset hairline quote.
 */
import { useState } from 'react';
import type { MessageRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { T } from '../../components/tokens';
import '../../components/runtime-styles';
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
  accent: T.accent,
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
          borderRadius: 10,
          border: `1px dashed ${T.borderStrong}`,
          background: T.sunken,
          color: T.fg,
          fontSize: 12,
          fontFamily: T.mono,
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
      <a href={url} target="_blank" rel="noreferrer" className="omni-media" style={{ width: 'fit-content' }}>
        <img
          src={url}
          alt={msg.textContent ?? 'image'}
          style={{ maxWidth: kind === 'sticker' ? 140 : 260, maxHeight: 300 }}
        />
      </a>
    );
  }
  if (kind === 'audio') {
    // biome-ignore lint/a11y/useMediaCaption: user-generated voice notes have no captions.
    return <audio controls src={url} style={{ maxWidth: 260, borderRadius: 10 }} />;
  }
  if (kind === 'video') {
    return (
      <div className="omni-media" style={{ width: 'fit-content' }}>
        {/* biome-ignore lint/a11y/useMediaCaption: user-generated video has no captions. */}
        <video controls src={url} style={{ maxWidth: 280, maxHeight: 320 }} />
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'inline-flex',
        gap: 8,
        alignItems: 'center',
        padding: '8px 11px',
        borderRadius: 10,
        border: `1px solid ${T.border}`,
        background: T.sunken,
        color: T.fg,
        fontSize: 12.5,
        textDecoration: 'none',
      }}
    >
      <span aria-hidden style={{ fontSize: 15 }}>
        📄
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ color: T.accentBlue }}>Open document</span>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>{msg.mediaMimeType ?? 'document'}</span>
      </span>
    </a>
  );
}

function ReplyQuote({ msg }: { msg: MessageRow }) {
  if (!msg.quotedText && !msg.replyToMessageId) return null;
  return (
    <div
      style={{
        borderLeft: `2px solid ${T.accent}`,
        padding: '3px 9px',
        margin: '2px 0 5px',
        background: 'color-mix(in oklch, var(--khal-fg) 5%, transparent)',
        borderRadius: '0 6px 6px 0',
        fontSize: 12,
        color: T.secondary,
      }}
    >
      {msg.quotedSenderName && (
        <div style={{ color: T.accent, fontWeight: 600, marginBottom: 1 }}>{msg.quotedSenderName}</div>
      )}
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
        marginTop: 3,
        fontSize: 10.5,
        fontFamily: T.mono,
        fontVariantNumeric: 'tabular-nums',
        color: mine ? 'color-mix(in oklch, var(--khal-fg) 55%, transparent)' : T.muted,
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
    <div
      style={{
        display: 'flex',
        gap: 4,
        marginTop: -8,
        marginRight: mine ? 8 : 0,
        marginLeft: mine ? 0 : 8,
        position: 'relative',
        zIndex: 1,
      }}
    >
      {reactions.map((r) => (
        <span
          key={r.emoji}
          style={{
            fontSize: 11,
            fontVariantNumeric: 'tabular-nums',
            padding: '1px 7px',
            borderRadius: 999,
            background: T.elevated,
            border: `1px solid ${T.border}`,
            boxShadow: '0 2px 8px color-mix(in oklch, black 28%, transparent)',
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', gap: 0 }}>
      <div
        style={{
          maxWidth: '78%',
          minWidth: 0,
          padding: '7px 11px',
          borderRadius: 12,
          borderBottomRightRadius: mine ? 4 : 12,
          borderBottomLeftRadius: mine ? 12 : 4,
          background: mine ? 'color-mix(in oklch, var(--khal-accent) 15%, transparent)' : T.elevated,
          border: `1px solid ${mine ? 'color-mix(in oklch, var(--khal-accent) 32%, transparent)' : T.border}`,
          color: T.fg,
          fontSize: 13.5,
          lineHeight: 1.45,
          wordBreak: 'break-word',
        }}
      >
        {showSender && !mine && (
          <div style={{ fontSize: 11.5, fontWeight: 700, color: T.accent, marginBottom: 2 }}>{senderLabel(msg)}</div>
        )}
        {msg.isForwarded && (
          <div
            style={{
              fontSize: 11,
              color: T.muted,
              fontStyle: 'italic',
              marginBottom: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            ↪ Forwarded
          </div>
        )}
        <ReplyQuote msg={msg} />
        {mediaKind(msg) !== 'none' && (
          <div style={{ margin: '3px 0' }}>
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
