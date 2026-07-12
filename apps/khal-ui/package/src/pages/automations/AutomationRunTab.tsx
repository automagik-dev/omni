'use client';

/**
 * Run an automation against a sample event. Two paths, clearly separated by
 * blast radius:
 *  - Test (SYNTHETIC): POST /automations/:id/test — a true dry-run that evaluates
 *    conditions and reports which actions WOULD execute, running nothing.
 *  - Execute (LIVE): POST /automations/:id/execute — actually runs the actions
 *    (may send messages, call agents, hit webhooks). Gated behind a typed-phrase
 *    confirm with a standing warning; there is no server-side "disposable" flag,
 *    so the operator must confirm intent explicitly every time.
 */
import { Note } from '@khal-os/ui';
import { useState } from 'react';
import type { AutomationRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { JsonEditor, type JsonEditorState } from '../../components/JsonEditor';
import { T } from '../../components/tokens';
import { ActionButton, Panel } from '../instances/components';
import { sampleEvent } from './automation-helpers';

export function AutomationRunTab({ automation }: { automation: AutomationRow; refetch: () => void }) {
  const { ext } = useOmniClient();
  const seed = sampleEvent(automation.triggerEventType);
  const [event, setEvent] = useState<JsonEditorState>({
    text: JSON.stringify(seed, null, 2),
    ok: true,
    value: seed,
    error: null,
  });

  const eventBody =
    event.ok && event.value !== undefined && typeof event.value === 'object'
      ? (event.value as { type: string; payload: Record<string, unknown> })
      : null;
  const badJson = eventBody === null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <Panel title="Sample event" description="The event fed to the automation. Type is matched against the trigger.">
        <JsonEditor label="event" value={seed} rows={8} onChange={setEvent} />
      </Panel>

      <Panel
        title="Test (dry-run)"
        description="Evaluates conditions and reports which actions would run — executes nothing."
      >
        <ActionButton
          label="Run test"
          effect="synthetic"
          targetName={automation.name}
          targetId={automation.id}
          resultName="POST /automations/:id/test"
          disabledReason={badJson ? 'Fix the event JSON first' : undefined}
          run={() => {
            if (!eventBody) throw new Error('invalid event');
            return ext.automations.test(automation.id, eventBody);
          }}
        />
      </Panel>

      <Panel
        title="Execute (live)"
        description="Actually runs the actions — may send messages, call agents, hit webhooks."
      >
        <Note type="error" label="Warning">
          Execute is a LIVE action with real side effects. There is no dry-run safety net here — only run it when you
          intend the actions to happen. Confirm by typing the automation name.
        </Note>
        <div style={{ marginTop: 10 }}>
          <ActionButton
            label="Execute now"
            effect="live"
            destructive
            targetName={automation.name}
            targetId={automation.id}
            resultName="POST /automations/:id/execute"
            confirmDescription="Runs every action in this automation against the sample event, for real."
            disabledReason={badJson ? 'Fix the event JSON first' : undefined}
            run={() => {
              if (!eventBody) throw new Error('invalid event');
              return ext.automations.execute(automation.id, eventBody);
            }}
          />
        </div>
        <span style={{ fontSize: 11, color: T.muted, marginTop: 6 }}>
          Heuristic: always warn. This backend exposes no "disposable" flag on automations, so execution is treated as
          production-affecting regardless of target.
        </span>
      </Panel>
    </div>
  );
}
