'use client';

/**
 * Read-only discovery of the agents/teams/workflows a provider exposes. Only
 * Agno-schema providers support discovery; for others the API returns a
 * `{ items: [], message }` explaining why, which this renders as-is instead of
 * an error. A missing API key returns a 400 the query surfaces honestly.
 */
import { Note } from '@khal-os/ui';
import type { ProviderEntriesResult, ProviderRow } from '../../../api/ext';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import { JsonInspector } from '../../../components/JsonInspector';
import { T } from '../../../components/tokens';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { Panel } from '../../instances/components';
import { supportsDiscovery } from '../provider-helpers';

function EntryList({
  title,
  result,
  loading,
  error,
}: { title: string; result?: ProviderEntriesResult; loading: boolean; error: string | null }) {
  const items = result?.items ?? [];
  return (
    <Panel title={title} actions={<span style={{ fontSize: 12, color: T.muted }}>{items.length}</span>}>
      {loading && <span style={{ fontSize: 12, color: T.muted }}>Loading…</span>}
      {error && <Note type="error">{error}</Note>}
      {result?.message && <Note type="default">{result.message}</Note>}
      {result?.error && <Note type="error">{result.error}</Note>}
      {items.length > 0 && <JsonInspector value={items} />}
      {!loading && !error && items.length === 0 && !result?.message && (
        <span style={{ fontSize: 12, color: T.muted }}>None discovered.</span>
      )}
    </Panel>
  );
}

export function ProviderDiscoveryTab({ provider }: { provider: ProviderRow; refetch: () => void }) {
  const { ext } = useOmniClient();
  const enabled = supportsDiscovery(provider.schema);

  const agents = useOmniQuery(['providers', provider.id, 'agents'], () => ext.providers.agents(provider.id));
  const teams = useOmniQuery(['providers', provider.id, 'teams'], () => ext.providers.teams(provider.id));
  const workflows = useOmniQuery(['providers', provider.id, 'workflows'], () => ext.providers.workflows(provider.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      {!enabled && (
        <Note type="default" label="Discovery">
          Provider schema <strong>{provider.schema}</strong> does not expose live discovery. The endpoints below still
          respond (with an explanatory message) so the surface stays honest.
        </Note>
      )}
      <EntryList
        title="Agents"
        result={agents.data}
        loading={agents.isLoading}
        error={agents.error ? (agents.error as Error).message : null}
      />
      <EntryList
        title="Teams"
        result={teams.data}
        loading={teams.isLoading}
        error={teams.error ? (teams.error as Error).message : null}
      />
      <EntryList
        title="Workflows"
        result={workflows.data}
        loading={workflows.isLoading}
        error={workflows.error ? (workflows.error as Error).message : null}
      />
    </div>
  );
}
