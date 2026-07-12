'use client';

/**
 * Discord tab (channel-gated): the bot's guilds, and per-guild config override
 * view / set (raw JSON) / reset, plus the guild audit log. Config set/reset are
 * live actions gated on production; the rest are reads.
 */
import { Note } from '@khal-os/ui';
import { useState } from 'react';
import type { GuildSummary } from '../../../api/ext';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import type { ColumnDef } from '../../../components/DataTable';
import { DataTable } from '../../../components/DataTable';
import { JsonInspector } from '../../../components/JsonInspector';
import { T } from '../../../components/tokens';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { ActionButton, Panel } from '../components';
import { type InstanceTabProps, PRODUCTION_GUARD_REASON } from '../tab-types';

const guildColumns: ColumnDef<GuildSummary>[] = [
  { key: 'name', header: 'Guild', accessor: (g) => (g.name ? String(g.name) : '—') },
  { key: 'id', header: 'Guild ID', mono: true },
];

export function DiscordTab({ instance, isProduction }: InstanceTabProps) {
  const { ext } = useOmniClient();
  const id = instance.id;
  const guard = isProduction ? PRODUCTION_GUARD_REASON : undefined;
  const [selected, setSelected] = useState<GuildSummary | null>(null);

  const guilds = useOmniQuery(['instances', id, 'guilds'], () => ext.instances.guilds(id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <DataTable
        columns={guildColumns}
        rows={guilds.data?.items ?? []}
        getRowKey={(g) => g.id}
        loading={guilds.isLoading}
        error={guilds.error ? (guilds.error as Error).message : null}
        emptyTitle="No guilds"
        onRowClick={(g) => setSelected(g)}
      />
      {selected && <GuildConfig instanceId={id} instanceName={instance.name} guild={selected} guard={guard} />}
    </div>
  );
}

function GuildConfig({
  instanceId,
  instanceName,
  guild,
  guard,
}: {
  instanceId: string;
  instanceName: string;
  guild: GuildSummary;
  guard?: string;
}) {
  const { ext } = useOmniClient();
  const config = useOmniQuery(['instances', instanceId, 'guild-config', guild.id], () =>
    ext.instances.guildConfig(instanceId, guild.id),
  );
  const [draft, setDraft] = useState('{\n  \n}');
  const [parseError, setParseError] = useState<string | null>(null);

  const parse = (): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(draft) as Record<string, unknown>;
      setParseError(null);
      return parsed;
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON');
      throw err;
    }
  };

  return (
    <Panel title={`Guild config · ${guild.name ?? guild.id}`} description={guild.id}>
      {config.error && <Note type="error">{(config.error as Error).message}</Note>}
      {config.data && <JsonInspector value={config.data.data ?? config.data} />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.fg }}>Set config override (raw JSON)</span>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          style={{
            padding: 10,
            borderRadius: 8,
            border: `1px solid ${parseError ? T.danger : T.border}`,
            background: T.sunken,
            color: T.fg,
            fontFamily: T.mono,
            fontSize: 12,
            resize: 'vertical',
          }}
        />
        {parseError && <span style={{ fontSize: 11, color: T.danger }}>{parseError}</span>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <ActionButton
            label="Save config"
            effect="live"
            targetName={instanceName}
            targetId={instanceId}
            disabledReason={guard}
            onDone={() => void config.refetch()}
            run={() => ext.instances.setGuildConfig(instanceId, guild.id, parse())}
          />
          <ActionButton
            label="Reset config"
            effect="live"
            destructive
            targetName={instanceName}
            targetId={instanceId}
            disabledReason={guard}
            confirmDescription="Reset this guild to the instance defaults."
            onDone={() => void config.refetch()}
            run={() => ext.instances.resetGuildConfig(instanceId, guild.id)}
          />
          <ActionButton
            label="View audit"
            effect="read-only"
            targetName={instanceName}
            targetId={instanceId}
            run={() => ext.instances.guildAudit(instanceId, guild.id)}
          />
        </div>
      </div>
    </Panel>
  );
}
