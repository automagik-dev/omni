'use client';

import type { Channel, Instance } from '@omni/sdk';
/**
 * Explicit instance/channel scope, shared across pages via context.
 *
 * Scope is *visible context*, never a hidden filter: the header shows the active
 * selection, pages read it to pre-fill forms and default queries, and the user
 * can always widen back to "All". Later groups consume `useScope()` to decide
 * what a page shows — but the selection is theirs to honour explicitly, so a
 * page never silently drops data because of a background filter.
 */
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useOmniClient } from './OmniClientProvider';

export interface ScopeContextValue {
  instances: Instance[];
  instancesLoading: boolean;
  instancesError: Error | null;
  selectedInstanceId: string | null;
  selectedChannel: Channel | null;
  selectedInstance: Instance | null;
  setInstance: (id: string | null) => void;
  setChannel: (channel: Channel | null) => void;
  refreshInstances: () => void;
}

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const { client } = useOmniClient();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);

  const query = useQuery({
    queryKey: ['instances', 'list'],
    queryFn: () => client.instances.list(),
  });

  const instances = query.data?.items ?? [];

  const value = useMemo<ScopeContextValue>(() => {
    const selectedInstance = instances.find((i) => i.id === selectedInstanceId) ?? null;
    return {
      instances,
      instancesLoading: query.isLoading,
      instancesError: (query.error as Error | null) ?? null,
      selectedInstanceId,
      selectedChannel,
      selectedInstance,
      setInstance: (id) => {
        setSelectedInstanceId(id);
        // Selecting an instance narrows the channel to that instance's channel.
        if (id) {
          const inst = instances.find((i) => i.id === id);
          if (inst) setSelectedChannel(inst.channel as Channel);
        }
      },
      setChannel: (channel) => {
        setSelectedChannel(channel);
        // Widening the channel clears an instance that no longer matches.
        if (channel && selectedInstance && selectedInstance.channel !== channel) {
          setSelectedInstanceId(null);
        }
      },
      refreshInstances: () => void query.refetch(),
    };
  }, [instances, query.isLoading, query.error, query.refetch, selectedInstanceId, selectedChannel]);

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeContextValue {
  const value = useContext(ScopeContext);
  if (!value) throw new Error('useScope must be used within <ScopeProvider>');
  return value;
}
