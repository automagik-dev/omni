'use client';

/**
 * Payload Config — per-event-type control over which pipeline payload stages are
 * stored and for how long. Storage stats up top, a config table (the `*` row is
 * the default), and a PUT editor with read-back.
 */
import { Note, SectionCard } from '@khal-os/ui';
import { useState } from 'react';
import { z } from 'zod';
import type { PayloadConfigRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { type ColumnDef, DataTable, MutationResult, PageShell, ResourceDetail, SchemaForm } from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { StatGrid, errMsg } from './shared';

const cfgSchema = z.object({
  storeWebhookRaw: z.boolean(),
  storeAgentRequest: z.boolean(),
  storeAgentResponse: z.boolean(),
  storeChannelSend: z.boolean(),
  storeError: z.boolean(),
  retentionDays: z.number().describe('Days to retain'),
});

function fmtBytes(n?: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function PayloadConfigPage() {
  const { ext } = useOmniClient();
  const [selected, setSelected] = useState<PayloadConfigRow | null>(null);

  const config = useOmniQuery(['payload-config', 'list'], () => ext.payloadConfig.list());
  const stats = useOmniQuery(['payload-config', 'stats'], () => ext.payloadConfig.stats());

  const put = useOmniMutation({
    mutationFn: (vars: { eventType: string; body: Record<string, unknown> }) =>
      ext.payloadConfig.put(vars.eventType, vars.body),
    invalidate: [['payload-config', 'list']],
    readBack: () => ext.payloadConfig.list(),
  });

  const s = stats.data?.data;

  const columns: ColumnDef<PayloadConfigRow>[] = [
    {
      key: 'eventType',
      header: 'Event type',
      mono: true,
      render: (r) => (
        <span style={{ fontWeight: 600, color: T.fg }}>{r.eventType === '*' ? '* (default)' : r.eventType}</span>
      ),
    },
    {
      key: 'stages',
      header: 'Stored stages',
      accessor: (r) =>
        [
          r.storeWebhookRaw && 'raw',
          r.storeAgentRequest && 'req',
          r.storeAgentResponse && 'resp',
          r.storeChannelSend && 'send',
          r.storeError && 'err',
        ]
          .filter(Boolean)
          .join(' · ') || '—',
    },
    {
      key: 'retentionDays',
      header: 'Retention',
      width: 110,
      align: 'right',
      accessor: (r) => `${r.retentionDays ?? '—'}d`,
    },
  ];

  return (
    <PageShell
      eyebrow="Configuration"
      title="Payload Config"
      description="Per-event-type payload storage retention and stages."
    >
      <StatGrid
        min={150}
        stats={[
          { label: 'Payloads stored', value: s?.totalPayloads ?? 0 },
          { label: 'Compressed size', value: fmtBytes(s?.totalSizeCompressed) },
          {
            label: 'Avg compression',
            value: s?.avgCompressionRatio != null ? `${s.avgCompressionRatio.toFixed(2)}x` : '—',
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={config.data?.items ?? []}
        getRowKey={(r) => r.eventType}
        loading={config.isLoading}
        error={errMsg(config.error)}
        emptyTitle="No payload configs"
        onRowClick={(r) => {
          setSelected(r);
          put.reset();
        }}
      />

      {selected && (
        <SectionCard padding="md">
          <ResourceDetail
            title={selected.eventType === '*' ? '* (default)' : selected.eventType}
            id={selected.eventType}
          >
            <ResourceDetail.Section
              title="Storage config"
              description="Which stages to store and for how long. Read-back proves the write."
            >
              <SchemaForm
                key={selected.eventType}
                schema={cfgSchema}
                value={{
                  storeWebhookRaw: selected.storeWebhookRaw ?? true,
                  storeAgentRequest: selected.storeAgentRequest ?? true,
                  storeAgentResponse: selected.storeAgentResponse ?? true,
                  storeChannelSend: selected.storeChannelSend ?? true,
                  storeError: selected.storeError ?? true,
                  retentionDays: selected.retentionDays ?? 14,
                }}
                submitLabel="Save config"
                onSubmit={(data) => put.mutate({ eventType: selected.eventType, body: { ...data } })}
              />
              {(put.data || put.error) && (
                <div style={{ marginTop: 12 }}>
                  <MutationResult
                    effect="live"
                    request={{ method: 'PUT', path: `/payload-config/${selected.eventType}` }}
                    response={put.data}
                    error={errMsg(put.error)}
                  />
                </div>
              )}
            </ResourceDetail.Section>
          </ResourceDetail>
        </SectionCard>
      )}

      {config.data?.items?.length === 0 && (
        <Note type="default">No per-event overrides configured — the default (`*`) applies to everything.</Note>
      )}
    </PageShell>
  );
}
