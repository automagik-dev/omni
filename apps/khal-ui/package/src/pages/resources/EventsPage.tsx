'use client';

/**
 * Events — the pipeline event explorer. Analytics cards + a filterable/searchable
 * table over GET /events (+ POST /events/search), an inline detail with the
 * staged request/response payloads (GET /events/:id/payloads[/:stage]) and a
 * destructive payload purge, and a manual custom-event trigger gated behind a
 * LIVE typed-phrase confirm (never auto-run).
 */
import { Badge, Button, Input, MetricDisplay, Note, SectionCard } from '@khal-os/ui';
import { useState } from 'react';
import type { EventRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import {
  type ColumnDef,
  ConfirmDialog,
  DataTable,
  FieldGrid,
  JsonEditor,
  type JsonEditorState,
  JsonInspector,
  MutationResult,
  PageShell,
  ResourceDetail,
} from '../../components';
import { T } from '../../components/tokens';
import { useOmniMutation, useOmniQuery } from '../../hooks/useOmniQuery';
import { CardSection, errMsg, fmtTime } from './shared';

export function EventsPage() {
  const { ext } = useOmniClient();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);

  // Trigger form.
  const [triggerType, setTriggerType] = useState('custom.khalui.demo');
  const [triggerPayload, setTriggerPayload] = useState<JsonEditorState>({
    text: '{}',
    ok: true,
    value: {},
    error: null,
  });
  const [confirmTrigger, setConfirmTrigger] = useState(false);

  const list = useOmniQuery(['events', 'list', submitted], () =>
    ext.events.list({ limit: 50, ...(submitted ? { search: submitted } : {}) }),
  );
  const analytics = useOmniQuery(['events', 'analytics'], () => ext.events.analytics());
  const detail = useOmniQuery(['events', selectedId], () => ext.events.get(selectedId ?? ''), {
    enabled: Boolean(selectedId),
  });
  const payloads = useOmniQuery(['events', selectedId, 'payloads'], () => ext.events.payloads(selectedId ?? ''), {
    enabled: Boolean(selectedId),
  });
  const stage = useOmniQuery(
    ['events', selectedId, 'payloads', selectedStage],
    () => ext.events.payloadStage(selectedId ?? '', selectedStage ?? ''),
    {
      enabled: Boolean(selectedId && selectedStage),
    },
  );

  const purge = useOmniMutation({
    mutationFn: (id: string) => ext.events.deletePayloads(id, 'khalui operator purge'),
    invalidate: [['events', selectedId, 'payloads']],
  });
  const trigger = useOmniMutation({
    mutationFn: () =>
      ext.events.trigger({ eventType: triggerType, payload: (triggerPayload.value as Record<string, unknown>) ?? {} }),
    invalidate: [['events', 'list', '']],
  });

  const selected = detail.data?.data;

  const columns: ColumnDef<EventRow>[] = [
    {
      key: 'eventType',
      header: 'Type',
      render: (r) => <span style={{ fontWeight: 600, color: T.fg }}>{r.eventType}</span>,
    },
    {
      key: 'direction',
      header: 'Dir',
      width: 90,
      render: (r) => <Badge variant={r.direction === 'outbound' ? 'purple' : 'blue'}>{r.direction ?? '—'}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      width: 110,
      render: (r) => (
        <Badge variant={r.status === 'failed' ? 'red' : r.status === 'completed' ? 'green' : 'gray'}>
          {r.status ?? '—'}
        </Badge>
      ),
    },
    { key: 'textContent', header: 'Text', accessor: (r) => (r.textContent ? String(r.textContent).slice(0, 60) : '—') },
    { key: 'receivedAt', header: 'Received', width: 180, mono: true, accessor: (r) => fmtTime(r.receivedAt) },
  ];

  return (
    <PageShell
      eyebrow="Operations"
      title="Events"
      description="Pipeline event stream — analytics, search, payload stages, and manual triggers."
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <SectionCard padding="md">
          <MetricDisplay value={analytics.data?.totalMessages ?? 0} label="Total (24h)" />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay
            value={analytics.data?.successRate != null ? `${Math.round(analytics.data.successRate)}%` : '—'}
            label="Success rate"
            accentColor={T.ok}
          />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay value={analytics.data?.failedMessages ?? 0} label="Failed" accentColor={T.danger} />
        </SectionCard>
        <SectionCard padding="md">
          <MetricDisplay
            value={
              analytics.data?.avgProcessingTimeMs != null ? `${Math.round(analytics.data.avgProcessingTimeMs)}ms` : '—'
            }
            label="Avg processing"
          />
        </SectionCard>
      </div>

      <DataTable
        columns={columns}
        rows={list.data?.items ?? []}
        getRowKey={(r) => r.id}
        loading={list.isLoading}
        error={errMsg(list.error)}
        emptyTitle="No events"
        onRowClick={(r) => {
          setSelectedId(r.id);
          setSelectedStage(null);
          purge.reset();
        }}
        toolbar={
          <form
            style={{ display: 'flex', gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(search.trim());
            }}
          >
            <Input placeholder="Full-text search events…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button size="small" variant="secondary" typeName="submit">
              Search
            </Button>
          </form>
        }
      />

      {selectedId && (
        <SectionCard padding="md">
          <ResourceDetail
            title={selected?.eventType ?? 'Event'}
            id={selectedId}
            subtitle={selected?.channel ?? undefined}
            actions={
              <Button size="small" variant="error" disabled={purge.isPending} onClick={() => setConfirmPurge(true)}>
                Purge payloads
              </Button>
            }
          >
            <ResourceDetail.Section title="Fields">
              <FieldGrid
                fields={[
                  { label: 'Type', value: selected?.eventType },
                  { label: 'Direction', value: selected?.direction },
                  { label: 'Status', value: selected?.status },
                  { label: 'Error', value: selected?.errorMessage ?? '—' },
                  { label: 'Chat', value: selected?.chatId, mono: true },
                  {
                    label: 'Total latency',
                    value: selected?.totalLatencyMs != null ? `${selected.totalLatencyMs}ms` : '—',
                  },
                  { label: 'Received', value: fmtTime(selected?.receivedAt), mono: true },
                ]}
              />
            </ResourceDetail.Section>

            <ResourceDetail.Section
              title={`Payload stages (${payloads.data?.items?.length ?? 0})`}
              description="Click a stage to load its stored payload."
            >
              {(payloads.data?.items ?? []).length === 0 ? (
                <Note type="default">No stored payloads for this event.</Note>
              ) : (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(payloads.data?.items ?? []).map((p) => (
                    <Button
                      key={p.stage}
                      size="small"
                      variant={selectedStage === p.stage ? 'default' : 'secondary'}
                      disabled={p.hasData === false}
                      onClick={() => setSelectedStage(p.stage ?? null)}
                    >
                      {p.stage} {p.deletedAt ? '(deleted)' : ''}
                    </Button>
                  ))}
                </div>
              )}
              {selectedStage && (
                <div style={{ marginTop: 12 }}>
                  {stage.isLoading ? (
                    <span style={{ fontSize: 12, color: T.muted }}>Loading…</span>
                  ) : (
                    <JsonInspector value={stage.data?.data?.payload ?? stage.data?.data ?? {}} />
                  )}
                </div>
              )}
            </ResourceDetail.Section>

            {Boolean(selected?.rawPayload || selected?.agentRequest || selected?.agentResponse) && (
              <ResourceDetail.Section title="Inline payloads">
                <JsonInspector
                  value={{
                    rawPayload: selected?.rawPayload,
                    agentRequest: selected?.agentRequest,
                    agentResponse: selected?.agentResponse,
                  }}
                />
              </ResourceDetail.Section>
            )}
          </ResourceDetail>
        </SectionCard>
      )}

      <CardSection title="Trigger a custom event">
        <Note type="warning" label="LIVE">
          Publishes a real event into the pipeline. Event type must start with{' '}
          <code style={{ fontFamily: T.mono }}>custom.</code>. Typed-phrase confirm required — never auto-run.
        </Note>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          <Input placeholder="custom.something" value={triggerType} onChange={(e) => setTriggerType(e.target.value)} />
          <JsonEditor label="Payload" value={{}} onChange={setTriggerPayload} rows={6} />
          <div>
            <Button
              size="small"
              variant="warning"
              disabled={!triggerType.startsWith('custom.') || !triggerPayload.ok}
              onClick={() => setConfirmTrigger(true)}
            >
              Trigger…
            </Button>
          </div>
        </div>
        {(trigger.data || trigger.error) && (
          <div style={{ marginTop: 12 }}>
            <MutationResult
              effect="live"
              request={{ method: 'POST', path: '/events/trigger' }}
              response={trigger.data}
              error={errMsg(trigger.error)}
            />
          </div>
        )}
      </CardSection>

      <ConfirmDialog
        open={confirmPurge}
        onClose={() => setConfirmPurge(false)}
        onConfirm={() => {
          if (selectedId) purge.mutate(selectedId);
          setConfirmPurge(false);
        }}
        title="Purge stored payloads"
        targetName={selected?.eventType ?? 'event'}
        targetId={selectedId ?? ''}
        effect="live"
        destructive
        confirmLabel="Purge"
        description="Soft-deletes every stored payload stage for this event."
      />
      <ConfirmDialog
        open={confirmTrigger}
        onClose={() => setConfirmTrigger(false)}
        onConfirm={() => {
          trigger.mutate(undefined);
          setConfirmTrigger(false);
        }}
        title="Trigger custom event"
        targetName={triggerType}
        targetId={triggerType}
        effect="live"
        destructive
        confirmLabel="Publish event"
        description="Publishes this event into the live pipeline."
      />
    </PageShell>
  );
}
