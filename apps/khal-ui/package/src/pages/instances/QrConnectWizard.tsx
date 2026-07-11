'use client';

/**
 * QR connect wizard: connect the instance, poll the QR endpoint and render the
 * image/code, then poll status until it reports connected (or the attempt times
 * out). A pairing-code path (enter phone → request code) is offered as the
 * alternative. Fetch/render only — a disposable test instance is never actually
 * paired, so this drives the flow up to a rendered QR and stops.
 */
import { Button, Note, Spinner } from '@khal-os/ui';
import { useEffect, useState } from 'react';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { ActionButton, Panel } from './components';
import { type ConnState, isQrImage, normalizeConnState } from './instance-helpers';

/** Why polling stopped, surfaced to the user instead of silently going quiet. */
type StopReason = 'connected' | 'error' | 'timeout';

/** Hard cap on how long the QR/status poll may run before giving up. */
const POLL_TIMEOUT_MS = 120_000;

export function QrConnectWizard({
  instanceId,
  instanceName,
  isProduction,
}: {
  instanceId: string;
  instanceName: string;
  isProduction: boolean;
}) {
  const { client } = useOmniClient();
  const [polling, setPolling] = useState(false);
  const [stopReason, setStopReason] = useState<StopReason | null>(null);
  const [phone, setPhone] = useState('');

  const qr = useOmniQuery(['instances', instanceId, 'qr'], () => client.instances.qr(instanceId), {
    enabled: polling,
    refetchInterval: polling ? 3000 : undefined,
  });
  const status = useOmniQuery(
    ['instances', instanceId, 'status', 'wizard'],
    () => client.instances.status(instanceId),
    {
      enabled: polling,
      refetchInterval: polling ? 3000 : undefined,
    },
  );

  const conn = normalizeConnState(status.data?.state, status.data?.isConnected);
  const pollError = qr.isError || status.isError;
  const guard = isProduction ? 'Production instance — connecting is prohibited.' : undefined;

  useStopPollingWhenTerminal({ polling, conn, pollError, setPolling, setStopReason });

  return (
    <Panel
      title="QR connect"
      description="Connect the instance, then scan the rendered QR (or request a pairing code)."
    >
      {isProduction && <Note type="warning">Read-only: this production instance cannot be connected from here.</Note>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <ActionButton
          label="Connect & start QR"
          effect="live"
          targetName={instanceName}
          targetId={instanceId}
          disabledReason={guard}
          resultName="connect"
          run={async () => {
            const r = await client.instances.connect(instanceId);
            setStopReason(null);
            setPolling(true);
            return r;
          }}
        />
        <Button size="small" variant="secondary" disabled={!polling} onClick={() => void qr.refetch()}>
          Refresh QR
        </Button>
        <Button size="small" variant="secondary" disabled={!polling} onClick={() => setPolling(false)}>
          Stop polling
        </Button>
        {polling && (
          <FreshnessBadge observedAt={qr.dataUpdatedAt || undefined} source="qr poll" staleAfterMs={10_000} />
        )}
      </div>

      {polling && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, color: T.fg }}>
            Transport: <strong>{conn}</strong>
            {status.data?.profileName ? ` · ${status.data.profileName}` : ''}
          </div>

          {conn === 'connected' ? (
            <Note type="success">Connected. No QR needed.</Note>
          ) : qr.isLoading ? (
            <Spinner size="sm" />
          ) : qr.data?.qr ? (
            <QrView qr={qr.data.qr} expiresAt={qr.data.expiresAt} />
          ) : (
            <Note type="default">{qr.data?.message ?? 'Waiting for a QR code…'}</Note>
          )}
        </div>
      )}

      {!polling && stopReason && <PollStopNote reason={stopReason} />}

      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: T.fg }}>Pairing code (alternative)</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={phone}
            placeholder="+5511999999999"
            onChange={(e) => setPhone(e.target.value)}
            style={{
              minWidth: 180,
              padding: '7px 10px',
              borderRadius: 8,
              border: `1px solid ${T.border}`,
              background: T.surface,
              color: T.fg,
              fontSize: 13,
            }}
          />
          <ActionButton
            label="Request pairing code"
            effect="live"
            targetName={instanceName}
            targetId={instanceId}
            resultName="pairing code"
            disabledReason={guard ?? (phone.trim() ? undefined : 'Enter a phone number')}
            run={() => client.instances.pair(instanceId, { phoneNumber: phone.trim() })}
          />
        </div>
      </div>
    </Panel>
  );
}

/**
 * Give the QR/status poll terminal states so it can't run forever: stop once the
 * transport reports connected or a poll request errors, and cap the whole attempt
 * at {@link POLL_TIMEOUT_MS}. Each stop records why, so the UI can show it.
 */
function useStopPollingWhenTerminal({
  polling,
  conn,
  pollError,
  setPolling,
  setStopReason,
}: {
  polling: boolean;
  conn: ConnState;
  pollError: boolean;
  setPolling: (value: boolean) => void;
  setStopReason: (reason: StopReason) => void;
}) {
  useEffect(() => {
    if (!polling) return;
    if (conn === 'connected') {
      setPolling(false);
      setStopReason('connected');
    } else if (pollError) {
      setPolling(false);
      setStopReason('error');
    }
  }, [polling, conn, pollError, setPolling, setStopReason]);

  useEffect(() => {
    if (!polling) return;
    const timer = setTimeout(() => {
      setPolling(false);
      setStopReason('timeout');
    }, POLL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [polling, setPolling, setStopReason]);
}

/** Terminal status line shown after polling stops, explaining the state reached. */
function PollStopNote({ reason }: { reason: StopReason }) {
  if (reason === 'connected') {
    return <Note type="success">Connected — polling stopped.</Note>;
  }
  if (reason === 'error') {
    return <Note type="error">Polling stopped: the QR/status request failed. Use “Connect & start QR” to retry.</Note>;
  }
  return <Note type="warning">Polling stopped after 120s without connecting. Use “Connect & start QR” to retry.</Note>;
}

function QrView({ qr, expiresAt }: { qr: string; expiresAt: string | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {isQrImage(qr) ? (
        <img
          src={qr}
          alt="WhatsApp QR code"
          style={{ width: 240, height: 240, borderRadius: 8, border: `1px solid ${T.border}`, background: '#fff' }}
        />
      ) : (
        <pre
          style={{
            margin: 0,
            padding: 12,
            borderRadius: 8,
            border: `1px solid ${T.border}`,
            background: T.sunken,
            color: T.fg,
            fontFamily: T.mono,
            fontSize: 11,
            maxWidth: '100%',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {qr}
        </pre>
      )}
      {expiresAt && (
        <span style={{ fontSize: 11, color: T.muted }}>Expires {new Date(expiresAt).toLocaleTimeString()}</span>
      )}
    </div>
  );
}
