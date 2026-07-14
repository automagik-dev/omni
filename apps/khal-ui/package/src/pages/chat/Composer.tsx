'use client';

/**
 * Message composer: a native Enter-to-send text path plus an attachment menu
 * that opens {@link SchemaForm}-driven modals for every send type (media,
 * sticker, reaction, contact, location, poll, TTS, forward, presence). Every
 * send surfaces delivery evidence (message id + status) — inline for text,
 * through {@link MutationResult} for the modal sends.
 *
 * The composer IS the product's live path, but a production chat that is NOT the
 * sanctioned canary requires an explicit LIVE confirmation before the first send
 * so an operator can't message a real contact by reflex.
 */
import {
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  GlassCard,
  Icons,
  StatusDot,
} from '@khal-os/ui';
import { useRef, useState } from 'react';
import type { ChatRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { requirementReason } from '../../auth/capabilities';
import { useCan } from '../../auth/useAuthz';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { MutationResult } from '../../components/MutationResult';
import { SchemaForm } from '../../components/SchemaForm';
import { T } from '../../components/tokens';
import '../../components/runtime-styles';
import { chatDisplayName, requiresSendConfirm } from './chat-helpers';
import { ATTACHMENT_KINDS, type AttachmentKind, type SendOutcome } from './composer-schemas';

interface SendEvidence {
  method: string;
  path: string;
  outcome?: SendOutcome;
  error?: string | null;
  pending: boolean;
}

/** Expressive glyph per attachment kind — mirrors the emoji vocabulary the
 * thread already uses (📌 🔕 📄) so the menu reads at a glance. */
const KIND_GLYPH: Record<string, string> = {
  media: '🖼️',
  sticker: '🏷️',
  reaction: '😀',
  contact: '👤',
  location: '📍',
  tts: '🔊',
  poll: '📊',
  forward: '↪️',
  presence: '✍️',
};

export function Composer({ chat, instanceId }: { chat: ChatRow; instanceId: string }) {
  const { client } = useOmniClient();
  const to = chat.id; // backend resolves a chat UUID to its platform JID
  const requiresConfirm = requiresSendConfirm(chat);
  // Sending is an operational action — `member` (read-only console) can't send.
  const canSend = useCan('operate');
  const sendReason = requirementReason('operate');

  const [text, setText] = useState('');
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [textEvidence, setTextEvidence] = useState<SendEvidence | null>(null);
  const [activeKind, setActiveKind] = useState<AttachmentKind | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const doSendText = async (value: string) => {
    setTextEvidence({ method: 'POST', path: '/messages/send', pending: true });
    try {
      const res = await client.messages.send({ instanceId, to, text: value });
      setTextEvidence({ method: 'POST', path: '/messages/send', outcome: res, pending: false });
      setText('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (e) {
      setTextEvidence({
        method: 'POST',
        path: '/messages/send',
        error: e instanceof Error ? e.message : String(e),
        pending: false,
      });
    }
  };

  const onSubmitText = () => {
    if (!canSend) return;
    const value = text.trim();
    if (!value) return;
    if (requiresConfirm) {
      setPendingText(value);
      setConfirmOpen(true);
      return;
    }
    void doSendText(value);
  };

  // Grow the single-row field with its content, up to a cap.
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  return (
    <div style={{ borderTop: `1px solid ${T.border}`, padding: 10, background: T.bg }}>
      {textEvidence && <SendStatusLine evidence={textEvidence} onDismiss={() => setTextEvidence(null)} />}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="omni-iconbtn"
              aria-label="Attachments"
              disabled={!canSend}
              title={canSend ? undefined : sendReason}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 38,
                height: 38,
                flexShrink: 0,
                borderRadius: 10,
                border: `1px solid ${T.border}`,
                background: T.surface,
                color: T.secondary,
                cursor: canSend ? 'pointer' : 'not-allowed',
                opacity: canSend ? 1 : 0.5,
              }}
            >
              <Icons.Plus size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top">
            {ATTACHMENT_KINDS.map((k) => (
              <DropdownMenuItem key={k.id} onSelect={() => setActiveKind(k)}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 220 }}>
                  <span aria-hidden style={{ fontSize: 15, width: 20, textAlign: 'center', flexShrink: 0 }}>
                    {KIND_GLYPH[k.id] ?? '＋'}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, color: T.fg }}>{k.label}</span>
                    <span style={{ fontSize: 11, color: T.muted }}>{k.hint}</span>
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div
          className="omni-composer"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'flex-end',
            borderRadius: 10,
            border: `1px solid ${T.border}`,
            background: T.surface,
            transition: 'border-color 120ms cubic-bezier(0.22,1,0.36,1), box-shadow 120ms cubic-bezier(0.22,1,0.36,1)',
          }}
        >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              autoGrow(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmitText();
              }
            }}
            placeholder={`Message ${chatDisplayName(chat)}…`}
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              minHeight: 36,
              maxHeight: 140,
              padding: '9px 12px',
              borderRadius: 10,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: T.fg,
              fontSize: 13.5,
              fontFamily: 'inherit',
              lineHeight: 1.4,
            }}
          />
        </div>

        <Button
          typeName="button"
          variant="default"
          onClick={onSubmitText}
          disabled={!text.trim() || !canSend}
          title={canSend ? undefined : sendReason}
        >
          Send
        </Button>
      </div>

      {requiresConfirm && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            fontFamily: T.mono,
            color: T.warn,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <StatusDot state="away" size="sm" />
          Production chat (not the canary) — sends require confirmation.
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          setPendingText(null);
        }}
        onConfirm={() => {
          setConfirmOpen(false);
          if (pendingText) void doSendText(pendingText);
          setPendingText(null);
        }}
        title="Send to a production contact"
        targetName={chatDisplayName(chat)}
        targetId={chat.id}
        effect="live"
        description={
          <span>
            This sends a real WhatsApp message to <strong>{chatDisplayName(chat)}</strong> on a production instance.
          </span>
        }
      />

      {activeKind && (
        <AttachmentModal
          kind={activeKind}
          chat={chat}
          instanceId={instanceId}
          to={to}
          requiresConfirm={requiresConfirm}
          onClose={() => setActiveKind(null)}
        />
      )}
    </div>
  );
}

/** Above-composer status line: mono, with a working/active/error StatusDot that
 * reflects the real in-flight send — honest presence, never fabricated. */
function SendStatusLine({ evidence, onDismiss }: { evidence: SendEvidence; onDismiss: () => void }) {
  return (
    <div
      style={{
        marginBottom: 8,
        fontSize: 12,
        fontFamily: T.mono,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      {evidence.pending ? (
        <>
          <StatusDot state="working" size="sm" pulse />
          <span style={{ color: T.secondary }}>Sending…</span>
        </>
      ) : evidence.error ? (
        <>
          <StatusDot state="error" size="sm" />
          <span style={{ color: T.danger }}>Send failed: {evidence.error}</span>
        </>
      ) : (
        <>
          <StatusDot state="active" size="sm" />
          <span style={{ color: T.ok }}>sent</span>
          <span style={{ color: T.muted }}>
            id {evidence.outcome?.messageId?.slice(0, 12) || '—'} · {evidence.outcome?.status}
          </span>
          <button type="button" onClick={onDismiss} style={dismissBtn}>
            dismiss
          </button>
        </>
      )}
    </div>
  );
}

function AttachmentModal({
  kind,
  chat,
  instanceId,
  to,
  requiresConfirm,
  onClose,
}: {
  kind: AttachmentKind;
  chat: ChatRow;
  instanceId: string;
  to: string;
  requiresConfirm: boolean;
  onClose: () => void;
}) {
  const { client } = useOmniClient();
  const [result, setResult] = useState<{ outcome?: SendOutcome; error?: string; pending: boolean } | null>(null);
  const [lastBody, setLastBody] = useState<Record<string, unknown> | null>(null);
  // Values captured from the form, held while the LIVE confirm is open.
  const [pendingValues, setPendingValues] = useState<Record<string, unknown> | null>(null);

  const doSend = async (values: Record<string, unknown>) => {
    setLastBody(values);
    setResult({ pending: true });
    try {
      const outcome = await kind.send(client, { instanceId, to }, values);
      setResult({ outcome, pending: false });
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e), pending: false });
    }
  };

  // Same gate as the text path: on a production non-canary chat, hold the send
  // behind the LIVE ConfirmDialog instead of firing straight from the form.
  const submit = (values: Record<string, unknown>) => {
    if (requiresConfirm) {
      setPendingValues(values);
      return;
    }
    void doSend(values);
  };

  return (
    <>
      <Dialog open onClose={onClose}>
        <Dialog.Title>Send {kind.label.toLowerCase()}</Dialog.Title>
        <Dialog.Body>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 380 }}>
            <GlassCard variant="raised" padding="md">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span aria-hidden style={{ fontSize: 20 }}>
                  {KIND_GLYPH[kind.id] ?? '＋'}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 650, color: T.fg }}>{kind.label}</span>
                  <span style={{ fontSize: 12, color: T.muted }}>
                    {kind.hint} → <strong style={{ color: T.secondary }}>{chatDisplayName(chat)}</strong>
                  </span>
                </div>
              </div>
            </GlassCard>
            <SchemaForm schema={kind.schema} submitLabel={`Send ${kind.label.toLowerCase()}`} onSubmit={submit} />
            {result && (
              <MutationResult
                effect="live"
                request={{ method: 'POST', path: `/messages/send/${kind.id}`, body: lastBody ?? undefined }}
                response={result.outcome}
                error={result.error ?? null}
                pending={result.pending}
              />
            )}
          </div>
        </Dialog.Body>
        <Dialog.Actions>
          <Dialog.Cancel onClick={onClose}>Close</Dialog.Cancel>
        </Dialog.Actions>
      </Dialog>

      <ConfirmDialog
        open={pendingValues !== null}
        onClose={() => setPendingValues(null)}
        onConfirm={() => {
          const values = pendingValues;
          setPendingValues(null);
          if (values) void doSend(values);
        }}
        title="Send to a production contact"
        targetName={chatDisplayName(chat)}
        targetId={chat.id}
        effect="live"
        description={
          <span>
            This performs a live {kind.label.toLowerCase()} send to <strong>{chatDisplayName(chat)}</strong> on a
            production instance.
          </span>
        }
      />
    </>
  );
}

const dismissBtn = {
  fontSize: 11,
  padding: '1px 6px',
  borderRadius: 6,
  border: `1px solid ${T.border}`,
  background: 'transparent',
  color: T.muted,
  cursor: 'pointer',
} as const;
