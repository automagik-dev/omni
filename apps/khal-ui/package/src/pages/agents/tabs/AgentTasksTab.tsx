'use client';

/**
 * Persistent task history for this agent. Lists tasks (GET /agents/:id/tasks),
 * offers a gated create form (POST /agent-tasks — needs a chat id), and per-row
 * view / delete. Create and delete are LIVE writes and flow through the confirm
 * gate; the list is a read.
 */
import { Badge } from '@khal-os/ui';
import { useState } from 'react';
import { z } from 'zod';
import type { AgentRow, AgentTaskRow } from '../../../api/ext';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import type { ColumnDef } from '../../../components/DataTable';
import { DataTable } from '../../../components/DataTable';
import { SchemaForm } from '../../../components/SchemaForm';
import { T } from '../../../components/tokens';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { ActionButton, Panel } from '../../instances/components';

const createTaskSchema = z.object({
  chatId: z.string().uuid().describe('Chat UUID this task belongs to'),
  type: z.string().min(1).max(100).describe('Task type'),
  title: z.string().min(1).max(500).describe('Human title'),
  description: z.string().optional().describe('Details'),
  priority: z.number().int().optional().describe('Higher runs first'),
});

const STATUS_VARIANT: Record<string, 'green' | 'blue' | 'amber' | 'gray'> = {
  completed: 'green',
  running: 'blue',
  pending: 'gray',
  waiting_input: 'amber',
  failed: 'amber',
  cancelled: 'gray',
};

export function AgentTasksTab({ agent }: { agent: AgentRow; refetch: () => void }) {
  const { ext } = useOmniClient();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tasks = useOmniQuery(['agents', agent.id, 'tasks'], () => ext.agents.tasks(agent.id));

  const columns: ColumnDef<AgentTaskRow>[] = [
    { key: 'title', header: 'Title', render: (t) => <span style={{ fontWeight: 600, color: T.fg }}>{t.title}</span> },
    { key: 'type', header: 'Type', width: 120 },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (t) => <Badge variant={STATUS_VARIANT[t.status] ?? 'gray'}>{t.status}</Badge>,
    },
    { key: 'progress', header: 'Progress', width: 90, accessor: (t) => `${t.progress ?? 0}%` },
    { key: 'createdAt', header: 'Created', mono: true, accessor: (t) => t.createdAt ?? '—' },
    {
      key: 'actions',
      header: '',
      width: 100,
      render: (t) => (
        <ActionButton
          label="Delete"
          effect="live"
          destructive
          targetName={t.title}
          targetId={t.id}
          confirmDescription={`Delete task ${t.title}.`}
          onDone={() => void tasks.refetch()}
          run={() => ext.agentTasks.remove(t.id)}
        />
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <Panel
        title="Tasks"
        description="Persistent task history for this agent."
        actions={
          <button
            type="button"
            onClick={() => setCreating((c) => !c)}
            style={{ fontSize: 12, color: T.accent, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {creating ? 'Cancel' : 'New task'}
          </button>
        }
      >
        <DataTable
          columns={columns}
          rows={tasks.data?.items ?? []}
          getRowKey={(t) => t.id}
          loading={tasks.isLoading}
          error={tasks.error ? (tasks.error as Error).message : null}
          emptyTitle="No tasks"
        />
      </Panel>

      {creating && (
        <Panel title="Create task" description="Records a task against a chat for this agent (live).">
          {error && <span style={{ fontSize: 12, color: T.danger }}>{error}</span>}
          <SchemaForm
            schema={createTaskSchema}
            submitLabel="Review task"
            onSubmit={(data) => {
              setError(null);
              const body: Record<string, unknown> = { agentId: agent.id };
              for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
                if (v !== undefined && v !== '') body[k] = v;
              }
              setPending(body);
            }}
          />
          {pending && (
            <ActionButton
              label="Confirm create"
              effect="live"
              targetName={String(pending.title ?? 'task')}
              targetId={agent.id}
              confirmDescription="Creates a persistent task for this agent."
              onDone={() => {
                setPending(null);
                setCreating(false);
                void tasks.refetch();
              }}
              run={() => ext.agentTasks.create(pending)}
            />
          )}
        </Panel>
      )}
    </div>
  );
}
