/**
 * Audit Commands (issue #1152)
 *
 * omni audit list [--target <id>] [--type <type>] [--actor <x>] [--since <iso>] [--limit <n>]
 * omni audit show <id>
 *
 * Reads the config-mutation audit log. Set OMNI_ACTOR to tag your own calls.
 */

import { Command } from 'commander';
import { exitNotAuthenticated } from '../client.js';
import { hasAuth, loadConfig } from '../config.js';
import * as output from '../output.js';

interface AuditEntry {
  id: string;
  createdAt: string;
  apiKeyName: string | null;
  actor: string | null;
  ipAddress: string | null;
  statusCode: number;
  action: string;
  targetType: string;
  targetId: string | null;
  changedFields: string[];
  changes: Record<string, { before: unknown; after: unknown }>;
}

async function auditFetch<T>(path: string): Promise<T> {
  if (!hasAuth()) exitNotAuthenticated();
  const config = loadConfig();
  const res = await fetch(`${config.apiUrl ?? 'http://localhost:8882'}/api/v2/audit${path}`, {
    headers: { 'x-api-key': config.apiKey ?? '' },
  });
  if (!res.ok) output.error(`Audit request failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  return (await res.json()) as T;
}

export function createAuditCommand(): Command {
  const audit = new Command('audit').description('Config-mutation audit log (who changed what)');

  audit
    .command('list')
    .description('List config changes, newest first')
    .option('--target <id>', 'Filter by target id (instance, agent, provider, ...)')
    .option('--type <type>', 'Filter by target type (instance|agent|provider|route|automation|api_key|setting)')
    .option('--actor <actor>', 'Filter by X-Omni-Actor or API key name')
    .option('--since <iso>', 'Only changes at or after this timestamp')
    .option('--limit <n>', 'Max results', '50')
    .action(async (opts: { target?: string; type?: string; actor?: string; since?: string; limit: string }) => {
      const params = new URLSearchParams({ limit: opts.limit });
      if (opts.target) params.set('target', opts.target);
      if (opts.type) params.set('targetType', opts.type);
      if (opts.actor) params.set('actor', opts.actor);
      if (opts.since) params.set('since', opts.since);
      const { items } = await auditFetch<{ items: AuditEntry[] }>(`?${params}`);
      output.list(
        items.map((e) => ({
          id: e.id,
          time: e.createdAt,
          actor: e.actor ?? e.apiKeyName ?? '-',
          action: e.action,
          target: e.targetId ?? '-',
          status: e.statusCode,
          changed: e.changedFields.join(', ') || '-',
        })),
        { emptyMessage: 'No audit entries.', rawData: items },
      );
    });

  audit
    .command('show <id>')
    .description('Show one audit entry with before/after (secrets as fingerprints)')
    .action(async (id: string) => {
      const { data } = await auditFetch<{ data: AuditEntry }>(`/${encodeURIComponent(id)}`);
      output.data(data);
    });

  return audit;
}
