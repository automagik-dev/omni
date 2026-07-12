'use client';

/**
 * Context — the API key's conversation-context pointer (a KV-style record on the
 * key row). Shows the current pointer, and set / use-instance / clear controls.
 * Setting a real `chatId` is validated server-side, so synthetic exploration uses
 * a `messageId`-only set; every write is LIVE and confirmed.
 */
import { Button, Input, Note } from '@khal-os/ui';
import { useState } from 'react';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { ConfirmDialog, MutationResult, PageShell } from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { CardSection, DataRowList, errMsg, fmtTime } from './shared';

export function ContextPage() {
  const { ext } = useOmniClient();
  const [instanceId, setInstanceId] = useState('');
  const [chatId, setChatId] = useState('');
  const [messageId, setMessageId] = useState('');
  const [confirmSet, setConfirmSet] = useState(false);
  const [confirmUse, setConfirmUse] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const current = useOmniQuery(['context'], () => ext.context.get());

  const setCtx = useOmniMutation({
    mutationFn: () =>
      ext.context.set({
        ...(instanceId ? { instanceId } : {}),
        ...(chatId ? { chatId } : {}),
        ...(messageId ? { messageId } : {}),
      }),
    invalidate: [['context']],
    readBack: () => ext.context.get(),
  });
  const useInstance = useOmniMutation({
    mutationFn: () => ext.context.use(instanceId),
    invalidate: [['context']],
    readBack: () => ext.context.get(),
  });
  const clear = useOmniMutation({
    mutationFn: () => ext.context.clear(),
    invalidate: [['context']],
    readBack: () => ext.context.get(),
  });

  const ctx = current.data?.data ?? {};

  return (
    <PageShell eyebrow="Configuration" title="Context" description="The API key's conversation-context pointer.">
      <CardSection title="Current pointer">
        <DataRowList
          rows={[
            { label: 'Instance', value: String(ctx.instanceId ?? '—') },
            { label: 'Active instance', value: String((ctx as Record<string, unknown>).activeInstanceId ?? '—') },
            { label: 'Chat', value: String(ctx.chatId ?? '—') },
            { label: 'Message', value: String((ctx as Record<string, unknown>).messageId ?? '—') },
            { label: 'Updated', value: fmtTime((ctx as Record<string, unknown>).updatedAt) },
          ]}
        />
      </CardSection>

      <CardSection title="Set context">
        <Note type="warning" label="LIVE">
          A real <code style={{ fontFamily: T.mono }}>chatId</code> is validated against the DB. For synthetic
          exploration set only a <code style={{ fontFamily: T.mono }}>messageId</code> (KV-style, no chat lookup).
        </Note>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <Input placeholder="instanceId (uuid)" value={instanceId} onChange={(e) => setInstanceId(e.target.value)} />
          <Input placeholder="chatId (uuid, real)" value={chatId} onChange={(e) => setChatId(e.target.value)} />
          <Input placeholder="messageId (uuid)" value={messageId} onChange={(e) => setMessageId(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <Button
            size="small"
            variant="warning"
            disabled={!instanceId && !chatId && !messageId}
            onClick={() => setConfirmSet(true)}
          >
            Set…
          </Button>
          <Button size="small" variant="secondary" disabled={!instanceId} onClick={() => setConfirmUse(true)}>
            Use instance…
          </Button>
          <Button size="small" variant="error" onClick={() => setConfirmClear(true)}>
            Clear…
          </Button>
        </div>
        {(setCtx.readBackData || setCtx.error) && (
          <div style={{ marginTop: 12 }}>
            <MutationResult
              effect="live"
              request={{ method: 'POST', path: '/context' }}
              after={setCtx.readBackData?.data}
              error={errMsg(setCtx.error)}
            />
          </div>
        )}
        {(useInstance.readBackData || useInstance.error) && (
          <div style={{ marginTop: 12 }}>
            <MutationResult
              effect="live"
              request={{ method: 'POST', path: '/context/use' }}
              after={useInstance.readBackData?.data}
              error={errMsg(useInstance.error)}
            />
          </div>
        )}
        {(clear.readBackData || clear.error) && (
          <div style={{ marginTop: 12 }}>
            <MutationResult
              effect="live"
              request={{ method: 'DELETE', path: '/context' }}
              after={clear.readBackData?.data}
              error={errMsg(clear.error)}
            />
          </div>
        )}
      </CardSection>

      <ConfirmDialog
        open={confirmSet}
        onClose={() => setConfirmSet(false)}
        onConfirm={() => {
          setCtx.mutate(undefined);
          setConfirmSet(false);
        }}
        title="Set context pointer"
        targetName={chatId || messageId || instanceId}
        targetId={instanceId || chatId || messageId}
        effect="live"
        confirmLabel="Set"
      />
      <ConfirmDialog
        open={confirmUse}
        onClose={() => setConfirmUse(false)}
        onConfirm={() => {
          useInstance.mutate(undefined);
          setConfirmUse(false);
        }}
        title="Switch active instance"
        targetName={instanceId}
        targetId={instanceId}
        effect="live"
        confirmLabel="Use instance"
      />
      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          clear.mutate(undefined);
          setConfirmClear(false);
        }}
        title="Clear context"
        targetName="context pointer"
        targetId="/context"
        effect="live"
        destructive
        confirmLabel="Clear"
      />
    </PageShell>
  );
}
