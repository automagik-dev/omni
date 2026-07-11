'use client';

/**
 * Voice — active voice sessions (read-only list/detail) plus join/leave controls
 * wired behind LIVE confirms. Joining or leaving a channel touches a live
 * instance, so both are typed-phrase-gated and never exercised by validation.
 */
import { Badge, Button, Input, Note, SectionCard } from '@khal-os/ui';
import { useState } from 'react';
import type { VoiceSession } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import {
  type ColumnDef,
  ConfirmDialog,
  DataTable,
  FieldGrid,
  JsonInspector,
  MutationResult,
  PageShell,
  ResourceDetail,
} from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { InstancePicker, errMsg, fmtTime } from './shared';

export function VoicePage() {
  const { ext } = useOmniClient();
  const [selected, setSelected] = useState<VoiceSession | null>(null);
  const [joinInstance, setJoinInstance] = useState('');
  const [joinChannel, setJoinChannel] = useState('');
  const [joinGuild, setJoinGuild] = useState('');
  const [confirmJoin, setConfirmJoin] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState<VoiceSession | null>(null);

  const sessions = useOmniQuery(['voice', 'sessions'], () => ext.voice.sessions(), { refetchInterval: 10_000 });

  const join = useOmniMutation({
    mutationFn: () =>
      ext.voice.join({
        instanceId: joinInstance,
        channelId: joinChannel,
        ...(joinGuild ? { guildId: joinGuild } : {}),
      }),
    invalidate: [['voice', 'sessions']],
  });
  const leave = useOmniMutation({
    mutationFn: (sessionId: string) => ext.voice.leave(sessionId),
    invalidate: [['voice', 'sessions']],
  });

  const columns: ColumnDef<VoiceSession>[] = [
    {
      key: 'sessionId',
      header: 'Session',
      mono: true,
      render: (r) => <span style={{ fontWeight: 600, color: T.fg }}>{r.sessionId}</span>,
    },
    { key: 'channelId', header: 'Channel', mono: true, accessor: (r) => r.channelId ?? '—' },
    {
      key: 'state',
      header: 'State',
      width: 120,
      render: (r) => <Badge variant={r.state === 'connected' ? 'green' : 'gray'}>{r.state ?? 'unknown'}</Badge>,
    },
    { key: 'createdAt', header: 'Created', width: 180, mono: true, accessor: (r) => fmtTime(r.createdAt) },
  ];

  return (
    <PageShell
      eyebrow="Messaging"
      title="Voice"
      description="Active voice sessions and join/leave controls."
      actions={
        <Button size="small" variant="secondary" onClick={() => void sessions.refetch()}>
          Refresh
        </Button>
      }
    >
      <DataTable
        columns={columns}
        rows={sessions.data?.items ?? []}
        getRowKey={(r) => r.sessionId}
        loading={sessions.isLoading}
        error={errMsg(sessions.error)}
        emptyTitle="No active voice sessions"
        onRowClick={(r) => setSelected(r)}
      />

      {selected && (
        <SectionCard padding="md">
          <ResourceDetail
            title={`Session ${selected.sessionId}`}
            id={selected.sessionId}
            actions={
              <Button size="small" variant="error" onClick={() => setConfirmLeave(selected)}>
                Leave
              </Button>
            }
          >
            <ResourceDetail.Section title="Fields">
              <FieldGrid
                fields={[
                  { label: 'Instance', value: selected.instanceId, mono: true },
                  { label: 'Channel', value: selected.channelId, mono: true },
                  { label: 'State', value: selected.state },
                  { label: 'Created', value: fmtTime(selected.createdAt), mono: true },
                ]}
              />
            </ResourceDetail.Section>
            <ResourceDetail.Section title="Raw">
              <JsonInspector value={selected} />
            </ResourceDetail.Section>
          </ResourceDetail>
        </SectionCard>
      )}

      <SectionCard padding="md">
        <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: T.fg }}>Join a voice channel</h3>
        <Note type="warning" label="LIVE">
          Joining connects a live instance to a voice channel. Confirm required.
        </Note>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <InstancePicker value={joinInstance} onChange={setJoinInstance} />
          <Input placeholder="channelId" value={joinChannel} onChange={(e) => setJoinChannel(e.target.value)} />
          <Input
            placeholder="guildId (Discord, optional)"
            value={joinGuild}
            onChange={(e) => setJoinGuild(e.target.value)}
          />
          <Button
            size="small"
            variant="warning"
            disabled={!joinInstance || !joinChannel}
            onClick={() => setConfirmJoin(true)}
          >
            Join…
          </Button>
        </div>
        {(join.data || join.error) && (
          <div style={{ marginTop: 12 }}>
            <MutationResult
              effect="live"
              request={{ method: 'POST', path: '/voice/join' }}
              response={join.data}
              error={errMsg(join.error)}
            />
          </div>
        )}
        {(leave.data || leave.error) && (
          <div style={{ marginTop: 12 }}>
            <MutationResult
              effect="live"
              request={{ method: 'POST', path: '/voice/leave' }}
              response={leave.data}
              error={errMsg(leave.error)}
            />
          </div>
        )}
      </SectionCard>

      <ConfirmDialog
        open={confirmJoin}
        onClose={() => setConfirmJoin(false)}
        onConfirm={() => {
          join.mutate(undefined);
          setConfirmJoin(false);
        }}
        title="Join voice channel"
        targetName={joinChannel}
        targetId={joinInstance}
        effect="live"
        destructive
        confirmLabel="Join"
        description="Connects the selected instance to this voice channel."
      />
      <ConfirmDialog
        open={confirmLeave !== null}
        onClose={() => setConfirmLeave(null)}
        onConfirm={() => {
          if (confirmLeave) leave.mutate(confirmLeave.sessionId);
          setConfirmLeave(null);
          setSelected(null);
        }}
        title="Leave voice session"
        targetName={confirmLeave?.sessionId ?? ''}
        targetId={confirmLeave?.sessionId ?? ''}
        effect="live"
        destructive
        confirmLabel="Leave"
      />
    </PageShell>
  );
}
