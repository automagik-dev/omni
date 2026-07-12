'use client';

/**
 * Automation create/edit form. Scalar fields render through {@link SchemaForm};
 * the actions/conditions/debounce (a discriminated union SchemaForm can't render
 * natively) are edited as JSON with templates. The Validate button parses the
 * assembled body through the real mirror schema (read-only), and Save gates the
 * write through the caller. Used by the create dialog and the detail Edit tab.
 */
import { Button, Note } from '@khal-os/ui';
import { useState } from 'react';
import type { AutomationRow } from '../../api/ext';
import { JsonEditor, type JsonEditorState } from '../../components/JsonEditor';
import { LiveTestResult, type LiveTestStatus } from '../../components/LiveTestResult';
import { SchemaForm } from '../../components/SchemaForm';
import {
  AUTOMATION_ACTIONS_TEMPLATE,
  type AutomationDraft,
  automationScalarSchema,
  buildAutomationBody,
  validateAutomationBody,
} from './automation-helpers';

const OK_JSON: JsonEditorState = { text: '', ok: true, value: undefined, error: null };

export interface AutomationEditorProps {
  initial?: AutomationRow;
  submitLabel: string;
  /** Receives the assembled, JSON-valid body; the caller gates + posts it. */
  onReady: (body: Record<string, unknown>) => void;
}

export function AutomationEditor({ initial, submitLabel, onReady }: AutomationEditorProps) {
  const [scalars, setScalars] = useState<Record<string, unknown> | null>(null);
  const [actions, setActions] = useState<JsonEditorState>(OK_JSON);
  const [conditions, setConditions] = useState<JsonEditorState>(OK_JSON);
  const [debounce, setDebounce] = useState<JsonEditorState>(OK_JSON);
  const [validation, setValidation] = useState<{ status: LiveTestStatus; errors: string[] } | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const assemble = (currentScalars: Record<string, unknown>): AutomationDraft | null => {
    if (!actions.ok || !conditions.ok || !debounce.ok) {
      setJsonError('Fix the JSON fields (actions / conditions / debounce) first.');
      return null;
    }
    setJsonError(null);
    return {
      scalars: currentScalars,
      actions: actions.text.trim() ? actions.value : initial?.actions,
      triggerConditions: conditions.text.trim() ? conditions.value : undefined,
      debounce: debounce.text.trim() ? debounce.value : undefined,
    };
  };

  const validate = () => {
    if (!scalars) {
      setValidation({ status: 'fail', errors: ['Fill the scalar fields and submit them first.'] });
      return;
    }
    const draft = assemble(scalars);
    if (!draft) return;
    const body = buildAutomationBody(draft);
    const out = validateAutomationBody(body);
    setValidation({ status: out.ok ? 'pass' : 'fail', errors: out.errors });
  };

  const submit = (data: Record<string, unknown>) => {
    setScalars(data);
    const draft = assemble(data);
    if (!draft) return;
    const body = buildAutomationBody(draft);
    const out = validateAutomationBody(body);
    if (!out.ok) {
      setValidation({ status: 'fail', errors: out.errors });
      return;
    }
    onReady(body);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {jsonError && <Note type="error">{jsonError}</Note>}
      <SchemaForm
        schema={automationScalarSchema}
        value={
          initial
            ? {
                name: initial.name,
                description: initial.description ?? undefined,
                triggerEventType: initial.triggerEventType,
                conditionLogic: (initial.conditionLogic as 'and' | 'or') ?? 'and',
                enabled: initial.enabled,
                priority: initial.priority ?? 0,
              }
            : undefined
        }
        submitLabel={submitLabel}
        onChange={(v) => setScalars(v as Record<string, unknown>)}
        onSubmit={(data) => submit(data as Record<string, unknown>)}
      />

      <JsonEditor
        label="actions"
        description="Array of actions (log / call_agent / send_message / emit_event / webhook). Required."
        rows={8}
        value={initial?.actions ?? AUTOMATION_ACTIONS_TEMPLATE}
        onChange={setActions}
      />
      <JsonEditor
        label="triggerConditions"
        description="Array of { field, operator, value } (optional)"
        rows={4}
        value={initial?.triggerConditions ?? undefined}
        onChange={setConditions}
      />
      <JsonEditor
        label="debounce"
        description="Debounce config, e.g. { mode: 'fixed', delayMs: 500 } (optional)"
        rows={3}
        value={initial?.debounce ?? undefined}
        onChange={setDebounce}
      />

      <div>
        <Button size="small" variant="secondary" onClick={validate}>
          Validate (client)
        </Button>
      </div>

      {validation && (
        <LiveTestResult
          name="Client-side Zod validation"
          effect="read-only"
          status={validation.status}
          message={validation.errors.length ? `${validation.errors.length} issue(s)` : 'Body is valid.'}
          evidence={validation.errors.length ? validation.errors : undefined}
        />
      )}
    </div>
  );
}
