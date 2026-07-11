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
import { Button, Dialog } from '@khal-os/ui';
import { useRef, useState } from 'react';
import type { ChatRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { MutationResult } from '../../components/MutationResult';
import { SchemaForm } from '../../components/SchemaForm';
import { T } from '../../components/tokens';
import { chatDisplayName, requiresSendConfirm } from './chat-helpers';
import { ATTACHMENT_KINDS, type AttachmentKind, type SendOutcome } from './composer-schemas';

interface SendEvidence {
  method: string;
  path: string;
  outcome?: SendOutcome;
  error?: string | null;
  pending: boolean;
}

export function Composer({ chat, instanceId }: { chat: ChatRow; instanceId: string }) {
  const { client } = useOmniClient();
  const to = chat.id; // backend resolves a chat UUID to its platform JID
  const requiresConfirm = requiresSendConfirm(chat);

  const [text, setText] = useState('');
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [textEvidence, setTextEvidence] = useState<SendEvidence | null>(null);
  const [activeKind, setActiveKind] = useState<AttachmentKind | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const doSendText = async (value: string) => {
    setTextEvidence({ method: 'POST', path: '/messages/send', pending: true });
    try {
      const res = await client.messages.send({ instanceId, to, text: value });
      setTextEvidence({ method: 'POST', path: '/messages/send', outcome: res, pending: false });
      setText('');
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
    const value = text.trim();
    if (!value) return;
    if (requiresConfirm) {
      setPendingText(value);
      setConfirmOpen(true);
      return;
    }
    void doSendText(value);
  };

  return (
    <div style={{ borderTop: `1px solid ${T.border}`, padding: 10, background: T.bg }}>
      {textEvidence && (
        <div style={{ marginBottom: 8, fontSize: 12 }}>
          {textEvidence.pending ? (
            <span style={{ color: T.muted }}>Sending…</span>
          ) : textEvidence.error ? (
            <span style={{ color: T.danger }}>Send failed: {textEvidence.error}</span>
          ) : (
            <span style={{ color: T.ok, display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <span>✓ sent</span>
              <span style={{ fontFamily: T.mono, color: T.muted }}>
                id {textEvidence.outcome?.messageId?.slice(0, 12) || '—'} · {textEvidence.outcome?.status}
              </span>
              <button type="button" onClick={() => setTextEvidence(null)} style={dismissBtn}>
                dismiss
              </button>
            </span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <Button
            typeName="button"
            variant="secondary"
            size="small"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            +
          </Button>
          {menuOpen && (
            <>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
                style={{ position: 'fixed', inset: 0, background: 'transparent', border: 'none', zIndex: 10 }}
              />
              <div
                role="menu"
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 6px)',
                  left: 0,
                  zIndex: 11,
                  minWidth: 220,
                  background: T.elevated,
                  border: `1px solid ${T.border}`,
                  borderRadius: 10,
                  padding: 6,
                  boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
                }}
              >
                {ATTACHMENT_KINDS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActiveKind(k);
                      setMenuOpen(false);
                    }}
                    style={menuItem}
                  >
                    <span style={{ fontWeight: 600, color: T.fg }}>{k.label}</span>
                    <span style={{ fontSize: 11, color: T.muted }}>{k.hint}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
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
            minHeight: 38,
            maxHeight: 140,
            padding: '9px 12px',
            borderRadius: 10,
            border: `1px solid ${T.border}`,
            background: T.surface,
            color: T.fg,
            fontSize: 13.5,
            fontFamily: 'inherit',
            lineHeight: 1.4,
          }}
        />
        <Button typeName="button" variant="default" onClick={onSubmitText} disabled={!text.trim()}>
          Send
        </Button>
      </div>

      {requiresConfirm && (
        <div style={{ marginTop: 6, fontSize: 11, color: T.warn }}>
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
            <span style={{ fontSize: 12, color: T.muted }}>
              {kind.hint} → <strong style={{ color: T.fg }}>{chatDisplayName(chat)}</strong>
            </span>
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

const menuItem = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  width: '100%',
  textAlign: 'left',
  padding: '7px 9px',
  borderRadius: 7,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
} as const;
