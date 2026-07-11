'use client';

import { useKhalAuth } from '@khal-os/sdk/app';
import { Button, PillBadge, Spinner } from '@khal-os/ui';
import type { Instance } from '@omni/sdk';
import { useCallback, useEffect, useState } from 'react';
import { createOmniAdminClient } from '../../api/client';
import { capabilityInventory } from '../../capabilities';

interface MainViewProps {
  windowId?: string;
  meta?: Record<string, unknown>;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; instances: Instance[] };

const omni = createOmniAdminClient();

/**
 * Omni Admin — vertical-skeleton shell.
 *
 * Renders the app frame plus a LIVE instance list fetched through the BFF,
 * proving the full path: browser → BFF (key injection) → Omni backend. Group B
 * replaces this placeholder with the full navigable shell.
 */
export function MainView({ windowId }: MainViewProps) {
  const auth = useKhalAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const { items } = await omni.instances.list();
      setState({ status: 'ready', instances: items });
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load instances' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = capabilityInventory.totals;

  return (
    <div data-window-id={windowId} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>Omni Admin</h1>
        <PillBadge size="sm" variant="muted">
          {auth?.role ?? 'member'}
        </PillBadge>
      </header>

      <p style={{ margin: 0, color: 'var(--fg-dim, #8a8a8a)', fontSize: 13 }}>
        Vertical skeleton. Tracking {totals.total} capabilities ({totals.inSpec} in-spec, {totals.offSpec} off-spec,{' '}
        {totals.darkFamilyCount} dark {totals.darkFamilyCount === 1 ? 'family' : 'families'}).
      </p>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7 }}>
            Instances
          </h2>
          <Button size="small" variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        </div>

        {state.status === 'loading' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12 }}>
            <Spinner /> <span>Loading instances…</span>
          </div>
        )}

        {state.status === 'error' && (
          <div style={{ padding: 12, color: '#f87171', fontSize: 13 }}>Error: {state.message}</div>
        )}

        {state.status === 'ready' && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {state.instances.length === 0 && <li style={{ opacity: 0.6, fontSize: 13 }}>No instances.</li>}
            {state.instances.map((inst) => (
              <li
                key={inst.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 14px',
                  border: '1px solid var(--border, #2a2a2a)',
                  borderRadius: 10,
                }}
              >
                <span style={{ fontWeight: 500 }}>{inst.name}</span>
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  <PillBadge size="sm" variant="muted">
                    {inst.channel}
                  </PillBadge>
                  <PillBadge size="sm" variant={inst.isActive ? 'default' : 'muted'}>
                    {inst.isActive ? 'active' : 'inactive'}
                  </PillBadge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
