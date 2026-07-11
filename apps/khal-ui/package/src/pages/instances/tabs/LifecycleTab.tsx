'use client';

/**
 * Lifecycle tab: transport actions (connect / disconnect / restart / logout),
 * the QR connect wizard, pending pairing-request approvals, recovery (resync /
 * replay), and call rejection. Every mutating control routes through
 * {@link ActionButton} — so it names the target and its blast radius before
 * firing — and is blocked outright on production instances.
 */
import { useState } from 'react';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import type { ColumnDef } from '../../../components/DataTable';
import { DataTable } from '../../../components/DataTable';
import { T } from '../../../components/tokens';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { QrConnectWizard } from '../QrConnectWizard';
import { ActionButton, Panel } from '../components';
import { isWhatsApp } from '../instance-helpers';
import { type InstanceTabProps, PRODUCTION_GUARD_REASON } from '../tab-types';

const inputStyle = {
  padding: '6px 10px',
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.surface,
  color: T.fg,
  fontSize: 13,
  minWidth: 160,
} as const;

interface TargetProps {
  instanceId: string;
  instanceName: string;
  guard?: string;
}

// The SDK keeps PairingRequestItem internal (not re-exported); mirror its shape.
interface PairingRequestRow {
  id: string;
  instanceId: string;
  platformUserId: string;
  pairingCode: string;
  expiresAt: string;
  createdAt: string;
}

export function LifecycleTab({ instance, isProduction, refetchInstance }: InstanceTabProps) {
  const { client } = useOmniClient();
  const id = instance.id;
  const name = instance.name;
  const guard = isProduction ? PRODUCTION_GUARD_REASON : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <Panel title="Transport" description="Connect, disconnect, restart, or clear the session.">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <ActionButton
            label="Connect"
            effect="live"
            targetName={name}
            targetId={id}
            disabledReason={guard}
            onDone={refetchInstance}
            run={() => client.instances.connect(id)}
          />
          <ActionButton
            label="Disconnect"
            effect="live"
            targetName={name}
            targetId={id}
            disabledReason={guard}
            onDone={refetchInstance}
            run={async () => {
              await client.instances.disconnect(id);
              return { disconnected: true };
            }}
          />
          <ActionButton
            label="Restart"
            effect="live"
            targetName={name}
            targetId={id}
            disabledReason={guard}
            onDone={refetchInstance}
            run={() => client.instances.restart(id)}
          />
          <ActionButton
            label="Logout"
            effect="live"
            targetName={name}
            targetId={id}
            destructive
            disabledReason={guard}
            confirmDescription="Clears the session — the instance must be re-paired to reconnect."
            onDone={refetchInstance}
            run={async () => {
              await client.instances.logout(id);
              return { loggedOut: true };
            }}
          />
        </div>
      </Panel>

      {isWhatsApp(instance.channel) && (
        <QrConnectWizard instanceId={id} instanceName={name} isProduction={isProduction} />
      )}

      <PairingRequests instanceId={id} instanceName={name} guard={guard} />

      <Panel title="Recovery" description="Backfill missed history or re-dispatch missed inbound messages.">
        <RecoveryTools instanceId={id} instanceName={name} guard={guard} />
      </Panel>

      <Panel title="Reject call" description="Reject a specific incoming call by id and caller JID.">
        <RejectCall instanceId={id} instanceName={name} guard={guard} />
      </Panel>
    </div>
  );
}

function PairingRequests({ instanceId, instanceName, guard }: TargetProps) {
  const { client } = useOmniClient();
  const requests = useOmniQuery(['instances', instanceId, 'pairing-requests'], () =>
    client.access.listPairingRequests(instanceId),
  );
  const columns: ColumnDef<PairingRequestRow>[] = [
    { key: 'platformUserId', header: 'User', mono: true },
    { key: 'pairingCode', header: 'Code', mono: true, width: 120 },
    { key: 'expiresAt', header: 'Expires', width: 160, accessor: (r) => new Date(r.expiresAt).toLocaleString() },
    {
      key: 'actions',
      header: '',
      width: 200,
      render: (r) => (
        <div style={{ display: 'flex', gap: 6 }}>
          <ActionButton
            label="Approve"
            effect="live"
            targetName={instanceName}
            targetId={instanceId}
            disabledReason={guard}
            onDone={() => void requests.refetch()}
            run={() => client.access.actionPairingRequest(instanceId, r.id, { action: 'approve' })}
          />
          <ActionButton
            label="Deny"
            effect="live"
            targetName={instanceName}
            targetId={instanceId}
            disabledReason={guard}
            onDone={() => void requests.refetch()}
            run={() => client.access.actionPairingRequest(instanceId, r.id, { action: 'deny' })}
          />
        </div>
      ),
    },
  ];
  return (
    <Panel
      title="Pairing requests"
      description="Pending device-pairing approvals."
      actions={<span style={{ fontSize: 12, color: T.muted }}>{requests.data?.length ?? 0} pending</span>}
    >
      <DataTable
        columns={columns}
        rows={requests.data ?? []}
        getRowKey={(r) => r.id}
        loading={requests.isLoading}
        error={requests.error ? (requests.error as Error).message : null}
        emptyTitle="No pending pairing requests"
      />
    </Panel>
  );
}

function RecoveryTools({ instanceId, instanceName, guard }: TargetProps) {
  const { ext } = useOmniClient();
  const [since, setSince] = useState('2h');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: T.muted }}>Since (ISO or relative, e.g. 2h)</span>
        <input value={since} onChange={(e) => setSince(e.target.value)} style={{ ...inputStyle, width: 140 }} />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <ActionButton
          label="Resync history"
          effect="live"
          targetName={instanceName}
          targetId={instanceId}
          disabledReason={guard}
          run={() => ext.instances.resync(instanceId, { since })}
        />
        <ActionButton
          label="Replay missed"
          effect="live"
          targetName={instanceName}
          targetId={instanceId}
          disabledReason={guard}
          run={() => ext.instances.replay(instanceId, {})}
        />
      </div>
    </div>
  );
}

function RejectCall({ instanceId, instanceName, guard }: TargetProps) {
  const { ext } = useOmniClient();
  const [callId, setCallId] = useState('');
  const [callFrom, setCallFrom] = useState('');
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <input value={callId} placeholder="callId" onChange={(e) => setCallId(e.target.value)} style={inputStyle} />
      <input
        value={callFrom}
        placeholder="callFrom (JID)"
        onChange={(e) => setCallFrom(e.target.value)}
        style={inputStyle}
      />
      <ActionButton
        label="Reject call"
        effect="live"
        targetName={instanceName}
        targetId={instanceId}
        disabledReason={guard ?? (callId.trim() && callFrom.trim() ? undefined : 'Enter call id and caller')}
        run={() => ext.instances.rejectCall(instanceId, callId.trim(), callFrom.trim())}
      />
    </div>
  );
}
