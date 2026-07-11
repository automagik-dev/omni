'use client';

/**
 * Per-chat actions: mark read, archive/unarchive, pin/unpin, mute/unmute,
 * labels, rename, disappearing timer, participants, clear-session, reopen-contact.
 *
 * Safety model (see chat-helpers):
 *   - chat-flag mutations run on any non-production chat OR the canary chat;
 *     on other production chats they are shown disabled with the reason.
 *   - clear-session / reopen-contact reset production agent-session state, so
 *     they are disabled on ANY production chat (canary included).
 * Mutating actions go through {@link ConfirmDialog} with a LIVE effect label.
 */
import { Button, Dialog } from '@khal-os/ui';
import type { ChatParticipant } from '@omni/sdk';
import { useState } from 'react';
import type { ChatRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { T } from '../../components/tokens';
import { canClearSession, canMutateChatFlags, chatDisplayName } from './chat-helpers';

interface ActionResult {
  label: string;
  ok: boolean;
  detail: string;
}

type PendingAction = {
  id: string;
  title: string;
  description: string;
  run: () => Promise<string>;
};

export function ChatActionsMenu({ chat, onChanged }: { chat: ChatRow; onChanged?: () => void }) {
  const { client, ext } = useOmniClient();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [labelInput, setLabelInput] = useState('');
  const [renameInput, setRenameInput] = useState(chat.name ?? '');
  const [showLabels, setShowLabels] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [participants, setParticipants] = useState<ChatParticipant[] | null>(null);

  const iid = chat.instanceId;
  const flagsAllowed = canMutateChatFlags(chat);
  const sessionAllowed = canClearSession(chat);
  const archived = chat.isArchived === true || chat.visibility === 'archived' || Boolean(chat.archivedAt);

  const runConfirmed = async (action: PendingAction) => {
    setWorking(true);
    try {
      const detail = await action.run();
      setResult({ label: action.title, ok: true, detail });
      onChanged?.();
    } catch (e) {
      setResult({ label: action.title, ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setWorking(false);
      setPending(null);
      setOpen(false);
    }
  };

  const confirm = (id: string, title: string, description: string, run: () => Promise<string>) =>
    setPending({ id, title, description, run });

  const openParticipants = async () => {
    setOpen(false);
    setShowParticipants(true);
    try {
      const list = await client.chats.listParticipants(chat.id);
      setParticipants(list);
    } catch {
      setParticipants([]);
    }
  };

  const item = (label: string, onClick: () => void, opts?: { allowed?: boolean; reason?: string }) => {
    const allowed = opts?.allowed ?? true;
    return (
      <button
        type="button"
        role="menuitem"
        disabled={!allowed}
        onClick={onClick}
        title={allowed ? undefined : opts?.reason}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          padding: '7px 12px',
          border: 'none',
          background: 'transparent',
          color: allowed ? T.fg : T.muted,
          fontSize: 12.5,
          cursor: allowed ? 'pointer' : 'not-allowed',
          opacity: allowed ? 1 : 0.55,
        }}
      >
        {label}
      </button>
    );
  };

  const flagReason = 'Disabled: production chat (only the canary chat permits chat-flag changes).';
  const sessionReason = 'Disabled: resets production agent-session state.';

  return (
    <div style={{ position: 'relative' }}>
      <Button
        typeName="button"
        variant="secondary"
        size="small"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
      >
        ⋯
      </Button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'transparent', border: 'none', zIndex: 20 }}
          />
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              zIndex: 21,
              minWidth: 210,
              background: T.elevated,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              padding: 4,
              boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
              maxHeight: 380,
              overflowY: 'auto',
            }}
          >
            {item(
              'Mark read',
              () =>
                confirm('read', 'Mark chat read', 'Marks the whole conversation as read on the channel.', async () => {
                  const r = await client.chats.markRead(chat.id, { instanceId: iid });
                  return `read · ${r.messageCount ?? 0} messages`;
                }),
              { allowed: flagsAllowed, reason: flagReason },
            )}
            {item(
              archived ? 'Unarchive' : 'Archive',
              () =>
                confirm(
                  'archive',
                  archived ? 'Unarchive chat' : 'Archive chat',
                  archived ? 'Restores the chat to the main list.' : 'Moves the chat to the archive.',
                  async () => {
                    const r = archived ? await client.chats.unarchive(chat.id) : await client.chats.archive(chat.id);
                    return `visibility → ${(r as ChatRow).visibility ?? (archived ? 'visible' : 'archived')}`;
                  },
                ),
              { allowed: flagsAllowed, reason: flagReason },
            )}
            {item(
              'Pin',
              () =>
                confirm('pin', 'Pin chat', 'Pins the chat to the top of the list.', async () => {
                  await ext.chats.pin(chat.id, iid);
                  return 'pinned';
                }),
              { allowed: flagsAllowed, reason: flagReason },
            )}
            {item(
              'Unpin',
              () =>
                confirm('unpin', 'Unpin chat', 'Removes the pin.', async () => {
                  await ext.chats.unpin(chat.id, iid);
                  return 'unpinned';
                }),
              { allowed: flagsAllowed, reason: flagReason },
            )}
            {item(
              'Mute (8h)',
              () =>
                confirm('mute', 'Mute chat', 'Silences notifications for 8 hours.', async () => {
                  await ext.chats.mute(chat.id, iid);
                  return 'muted';
                }),
              { allowed: flagsAllowed, reason: flagReason },
            )}
            {item(
              'Unmute',
              () =>
                confirm('unmute', 'Unmute chat', 'Restores notifications.', async () => {
                  await ext.chats.unmute(chat.id, iid);
                  return 'unmuted';
                }),
              { allowed: flagsAllowed, reason: flagReason },
            )}
            {item(
              'Labels…',
              () => {
                setOpen(false);
                setShowLabels(true);
              },
              { allowed: flagsAllowed, reason: flagReason },
            )}
            {item(
              'Rename…',
              () => {
                setOpen(false);
                setRenameInput(chat.name ?? '');
                setShowRename(true);
              },
              { allowed: flagsAllowed, reason: flagReason },
            )}
            {item(
              'Disappearing: 24h',
              () =>
                confirm('disappearing', 'Set disappearing timer', 'Messages disappear after 24 hours.', async () => {
                  await ext.chats.disappearing(chat.id, iid, '24h');
                  return 'timer → 24h';
                }),
              { allowed: flagsAllowed, reason: flagReason },
            )}
            {item(
              'Disappearing: off',
              () =>
                confirm('disappearing-off', 'Disable disappearing', 'Turns the disappearing timer off.', async () => {
                  await ext.chats.disappearing(chat.id, iid, 'off');
                  return 'timer → off';
                }),
              { allowed: flagsAllowed, reason: flagReason },
            )}
            {item('Participants…', openParticipants)}
            <div style={{ height: 1, background: T.border, margin: '4px 0' }} />
            {item(
              'Clear session',
              () =>
                confirm(
                  'clear-session',
                  'Clear agent session',
                  'Resets the agent conversation session for this chat.',
                  async () => {
                    await ext.chats.clearSession(iid, chat.id);
                    return 'session cleared';
                  },
                ),
              { allowed: sessionAllowed, reason: sessionReason },
            )}
            {item(
              'Reopen contact',
              () =>
                confirm('reopen', 'Reopen contact', 'Re-enables agent handling for this contact.', async () => {
                  await ext.chats.reopenContact(chat.id);
                  return 'reopened';
                }),
              { allowed: sessionAllowed, reason: sessionReason },
            )}
            {!sessionAllowed && (
              <div style={{ padding: '4px 12px 6px', fontSize: 11, color: T.muted, lineHeight: 1.35 }}>
                {sessionReason}
              </div>
            )}
          </div>
        </>
      )}

      {result && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 15,
            minWidth: 220,
            padding: '8px 10px',
            borderRadius: 8,
            border: `1px solid ${result.ok ? T.ok : T.danger}`,
            background: T.surface,
            fontSize: 12,
          }}
        >
          <div style={{ color: result.ok ? T.ok : T.danger, fontWeight: 600 }}>
            {result.ok ? '✓' : '✗'} {result.label}
          </div>
          <div style={{ color: T.muted, marginTop: 2 }}>{result.detail}</div>
          <button type="button" onClick={() => setResult(null)} style={{ ...dismissBtn, marginTop: 4 }}>
            dismiss
          </button>
        </div>
      )}

      {pending && (
        <ConfirmDialog
          open
          onClose={() => setPending(null)}
          onConfirm={() => void runConfirmed(pending)}
          title={pending.title}
          targetName={chatDisplayName(chat)}
          targetId={chat.id}
          effect="live"
          description={pending.description}
          pending={working}
        />
      )}

      {showLabels && (
        <Dialog open onClose={() => setShowLabels(false)}>
          <Dialog.Title>Labels · {chatDisplayName(chat)}</Dialog.Title>
          <Dialog.Body>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 320 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(chat.labels ?? []).length === 0 ? (
                  <span style={{ fontSize: 12, color: T.muted }}>No labels.</span>
                ) : (
                  (chat.labels ?? []).map((l) => (
                    <span
                      key={l}
                      style={{
                        fontSize: 12,
                        border: `1px solid ${T.border}`,
                        borderRadius: 999,
                        padding: '2px 8px',
                        display: 'inline-flex',
                        gap: 6,
                      }}
                    >
                      {l}
                      <button
                        type="button"
                        onClick={() =>
                          confirm('label-remove', 'Remove label', `Removes “${l}”.`, async () => {
                            await client.chats.removeLabel(chat.id, l);
                            return `removed ${l}`;
                          })
                        }
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: T.danger,
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  placeholder="new label"
                  style={inputStyle}
                />
                <Button
                  typeName="button"
                  size="small"
                  disabled={!labelInput.trim()}
                  onClick={() =>
                    confirm('label-add', 'Add label', `Adds “${labelInput.trim()}”.`, async () => {
                      const label = labelInput.trim();
                      await client.chats.addLabel(chat.id, label);
                      setLabelInput('');
                      return `added ${label}`;
                    })
                  }
                >
                  Add
                </Button>
              </div>
            </div>
          </Dialog.Body>
          <Dialog.Actions>
            <Dialog.Cancel onClick={() => setShowLabels(false)}>Close</Dialog.Cancel>
          </Dialog.Actions>
        </Dialog>
      )}

      {showRename && (
        <Dialog open onClose={() => setShowRename(false)}>
          <Dialog.Title>Rename · {chatDisplayName(chat)}</Dialog.Title>
          <Dialog.Body>
            <input
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              placeholder="Chat name"
              style={{ ...inputStyle, minWidth: 320 }}
            />
          </Dialog.Body>
          <Dialog.Actions>
            <Dialog.Cancel onClick={() => setShowRename(false)}>Cancel</Dialog.Cancel>
            <Dialog.Confirm
              disabled={!renameInput.trim()}
              onClick={() => {
                setShowRename(false);
                confirm('rename', 'Rename chat', `Renames to “${renameInput.trim()}”.`, async () => {
                  const r = await client.chats.update(chat.id, { name: renameInput.trim() });
                  return `name → ${(r as ChatRow).name ?? renameInput.trim()}`;
                });
              }}
            >
              Rename
            </Dialog.Confirm>
          </Dialog.Actions>
        </Dialog>
      )}

      {showParticipants && (
        <Dialog open onClose={() => setShowParticipants(false)}>
          <Dialog.Title>Participants · {chatDisplayName(chat)}</Dialog.Title>
          <Dialog.Body>
            <div style={{ minWidth: 320, maxHeight: 360, overflowY: 'auto' }}>
              {participants === null ? (
                <span style={{ fontSize: 12, color: T.muted }}>Loading…</span>
              ) : participants.length === 0 ? (
                <span style={{ fontSize: 12, color: T.muted }}>No participants (or not a group).</span>
              ) : (
                participants.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '5px 0',
                      borderBottom: `1px solid ${T.borderSubtle}`,
                      fontSize: 12.5,
                    }}
                  >
                    <span style={{ color: T.fg }}>{p.displayName ?? p.platformUserId}</span>
                    {p.role && <span style={{ color: T.muted }}>{p.role}</span>}
                  </div>
                ))
              )}
            </div>
          </Dialog.Body>
          <Dialog.Actions>
            <Dialog.Cancel onClick={() => setShowParticipants(false)}>Close</Dialog.Cancel>
          </Dialog.Actions>
        </Dialog>
      )}
    </div>
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

const inputStyle = {
  flex: 1,
  padding: '7px 10px',
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.surface,
  color: T.fg,
  fontSize: 13,
} as const;
