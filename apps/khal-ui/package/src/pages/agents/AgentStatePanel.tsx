'use client';

/**
 * Agent-state debug panel — a one-shot read and write of the NATS-KV state
 * machine for an (agentId, chatId) pair. The write is labelled SYNTHETIC: it
 * pokes a KV status value, touches no production messaging, and is the kind of
 * thing you run against a scratch chat id while debugging the actor lifecycle.
 * Reused by the agent detail's State tab and the standalone /dev/agent-state page.
 */
import { Button, Input, Note } from '@khal-os/ui';
import { useState } from 'react';
import { AGENT_STATUSES, type AgentStatus } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { JsonInspector } from '../../components/JsonInspector';
import { LiveTestResult, type LiveTestStatus } from '../../components/LiveTestResult';
import { T } from '../../components/tokens';

export function AgentStatePanel({ agentId, lockAgentId = false }: { agentId?: string; lockAgentId?: boolean }) {
  const { ext } = useOmniClient();
  const [agent, setAgent] = useState(agentId ?? '');
  const [chat, setChat] = useState('');
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [readStatus, setReadStatus] = useState<LiveTestStatus | null>(null);
  const [readEvidence, setReadEvidence] = useState<unknown>(null);
  const [readMsg, setReadMsg] = useState<string | undefined>();
  const [writeStatus, setWriteStatus] = useState<LiveTestStatus | null>(null);
  const [writeEvidence, setWriteEvidence] = useState<unknown>(null);
  const [writeMsg, setWriteMsg] = useState<string | undefined>();

  const canRun = Boolean(agent && chat);

  const read = async () => {
    setReadStatus('pending');
    try {
      const res = await ext.agentState.get(agent, chat);
      setReadStatus('pass');
      setReadEvidence(res.data ?? { note: 'no active state for this pair (404)' });
      setReadMsg(undefined);
    } catch (err) {
      setReadStatus('fail');
      setReadMsg(err instanceof Error ? err.message : 'read failed');
    }
  };

  const write = async () => {
    setWriteStatus('pending');
    try {
      const res = await ext.agentState.put(agent, chat, { status });
      setWriteStatus('pass');
      setWriteEvidence(res.data ?? { ok: true });
      setWriteMsg(undefined);
    } catch (err) {
      setWriteStatus('fail');
      setWriteMsg(err instanceof Error ? err.message : 'write failed');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <Note type="default" label="Synthetic">
        Reads and writes a KV status value for one (agent, chat) pair. Use a scratch chat id — this touches the actor
        state machine, not production messaging.
      </Note>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: T.muted }}>Agent ID</span>
          <Input
            value={agent}
            readOnly={lockAgentId}
            onChange={(e) => setAgent(e.target.value)}
            placeholder="agent uuid"
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: T.muted }}>Chat ID (scratch)</span>
          <Input value={chat} onChange={(e) => setChat(e.target.value)} placeholder="chat uuid" />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: T.muted }}>Status to write</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as AgentStatus)}
            style={{
              padding: '7px 10px',
              borderRadius: 8,
              border: `1px solid ${T.border}`,
              background: T.surface,
              color: T.fg,
              fontSize: 13,
            }}
          >
            {AGENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <Button size="small" variant="secondary" disabled={!canRun} onClick={() => void read()}>
          Read state
        </Button>
        <Button size="small" variant="secondary" disabled={!canRun} onClick={() => void write()}>
          Write state
        </Button>
      </div>

      {readStatus && (
        <LiveTestResult
          name="GET agent-state"
          effect="read-only"
          status={readStatus}
          message={readMsg}
          evidence={readEvidence}
        />
      )}
      {writeStatus && (
        <LiveTestResult
          name="PUT agent-state"
          effect="synthetic"
          status={writeStatus}
          message={writeMsg}
          evidence={writeEvidence}
        />
      )}
      {readEvidence !== null && readStatus === 'pass' && (
        <div>
          <span style={{ fontSize: 11, color: T.muted }}>Last read payload</span>
          <JsonInspector value={readEvidence} />
        </div>
      )}
    </div>
  );
}
