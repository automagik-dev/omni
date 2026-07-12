'use client';

/**
 * Per-agent follow-up sequence config (GET/PUT/DELETE /follow-up/agents/:id).
 * The config is a nested object with a schedule union, so it's edited as JSON
 * (with a template to start from). Save and clear are LIVE writes behind the
 * confirm gate; the current config renders through {@link JsonInspector}.
 */
import { Button, Note } from '@khal-os/ui';
import { useState } from 'react';
import type { AgentRow, FollowUpConfig } from '../../../api/ext';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import { JsonEditor, type JsonEditorState } from '../../../components/JsonEditor';
import { JsonInspector } from '../../../components/JsonInspector';
import { T } from '../../../components/tokens';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { ActionButton, Panel } from '../../instances/components';

const TEMPLATE = {
  enabled: true,
  schedule: { kind: 'fixed', intervalsMinutes: [60, 240, 1440] },
  maxFollowUps: 3,
  promptTemplate: 'Draft a friendly nudge for {{chatName}} after {{minutes}} minutes of silence.',
  stopOutsideMessagingWindow: true,
  showTypingIndicator: true,
};

const OK_JSON: JsonEditorState = { text: '', ok: true, value: undefined, error: null };

export function AgentFollowUpTab({ agent }: { agent: AgentRow; refetch: () => void }) {
  const { ext } = useOmniClient();
  const [edited, setEdited] = useState<JsonEditorState>(OK_JSON);
  const [seed, setSeed] = useState<unknown>(undefined);

  const config = useOmniQuery(['follow-up', 'agents', agent.id], () => ext.followUp.getForAgent(agent.id));
  const current = config.data?.data ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <Panel
        title="Current config"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="small" variant="secondary" onClick={() => void config.refetch()}>
              Refresh
            </Button>
            <Button size="small" variant="secondary" onClick={() => setSeed(current ?? TEMPLATE)}>
              Load into editor
            </Button>
          </div>
        }
      >
        {config.isLoading ? (
          <span style={{ fontSize: 12, color: T.muted }}>Loading…</span>
        ) : current ? (
          <JsonInspector value={current} />
        ) : (
          <Note type="default">No follow-up sequence configured for this agent.</Note>
        )}
      </Panel>

      <Panel title="Edit config" description="A follow-up sequence: schedule, prompt, caps. Saved as-is (live).">
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" variant="secondary" onClick={() => setSeed(TEMPLATE)}>
            Insert template
          </Button>
        </div>
        <JsonEditor key={JSON.stringify(seed)} label="follow-up config" value={seed} rows={12} onChange={setEdited} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ActionButton
            label="Save config"
            effect="live"
            targetName={agent.name}
            targetId={agent.id}
            disabledReason={edited.ok && edited.value !== undefined ? undefined : 'Enter valid JSON first'}
            confirmDescription="Writes the follow-up sequence config for this agent."
            onDone={() => void config.refetch()}
            run={() => ext.followUp.setForAgent(agent.id, edited.value as FollowUpConfig)}
          />
          <ActionButton
            label="Clear config"
            effect="live"
            destructive
            targetName={agent.name}
            targetId={agent.id}
            disabledReason={current ? undefined : 'Nothing to clear'}
            confirmDescription="Removes the follow-up sequence config for this agent."
            onDone={() => void config.refetch()}
            run={() => ext.followUp.clearForAgent(agent.id)}
          />
        </div>
      </Panel>
    </div>
  );
}
