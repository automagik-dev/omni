import { AddServerDialog } from '@/components/layout/AddServerDialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { resetClient, switchServer } from '@/lib/sdk';
import { type ServerEntry, getActiveServer, listServers, removeServer, resolveBaseUrl } from '@/lib/servers';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronsUpDown, KeyRound, Plus, Server, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface ServerSwitcherProps {
  collapsed: boolean;
}

/**
 * Short, human-scannable form of an entry's endpoint. Same-origin entries are
 * resolved through `resolveBaseUrl`, so the row shows the host actually used.
 */
function describeEntry(entry: ServerEntry): string {
  const url = resolveBaseUrl(entry);
  if (!url) {
    return 'This origin';
  }
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Active-server switcher for the sidebar.
 *
 * The registry lives in localStorage, which is not reactive, so the component
 * re-reads it whenever the menu opens or a mutation lands. `getActiveServer()`
 * (not the raw pointer) is the source of truth for what is checked: it is the
 * same resolution the SDK client uses, including the dangling-pointer
 * correction, so the checkmark can never disagree with the server being talked
 * to.
 */
export function ServerSwitcher({ collapsed }: ServerSwitcherProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [servers, setServers] = useState<ServerEntry[]>(() => listServers());
  const [activeId, setActiveId] = useState<string | null>(() => getActiveServer()?.id ?? null);
  const [addOpen, setAddOpen] = useState(false);

  const refresh = useCallback(() => {
    setServers(listServers());
    setActiveId(getActiveServer()?.id ?? null);
  }, []);

  const active = servers.find((server) => server.id === activeId) ?? null;

  /** Land on the newly active server, or send the user to log into it. */
  const settleOnActiveServer = useCallback(() => {
    const next = getActiveServer();
    refresh();
    if (!next?.apiKey) {
      // No credential for the server we just landed on (or none left at all).
      window.location.href = '/login';
      return;
    }
    // Resource ids in the current route belong to the previous server.
    navigate('/');
  }, [navigate, refresh]);

  const handleSelect = useCallback(
    (id: string) => {
      if (id === activeId) {
        return;
      }
      // Always hand over the query client: a switch that keeps the previous
      // server's cached data is a correctness bug, not a performance detail.
      if (!switchServer(id, queryClient)) {
        // Unknown id — the registry changed under this menu. Re-read it.
        refresh();
        return;
      }
      settleOnActiveServer();
    },
    [activeId, queryClient, refresh, settleOnActiveServer],
  );

  const handleRemove = useCallback(
    (entry: ServerEntry) => {
      if (!confirm(`Remove "${entry.name}"? Its stored API key will be deleted from this browser.`)) {
        return;
      }

      const wasActive = entry.id === activeId;
      removeServer(entry.id);

      if (!wasActive) {
        refresh();
        return;
      }

      // The active connection just went away: drop the cached client and any
      // data it produced before resolving the fallback entry.
      resetClient();
      queryClient.clear();
      settleOnActiveServer();
    },
    [activeId, queryClient, refresh, settleOnActiveServer],
  );

  const handleAdded = useCallback(
    (serverId: string) => {
      setAddOpen(false);
      refresh();
      if (switchServer(serverId, queryClient)) {
        settleOnActiveServer();
      }
    },
    [queryClient, refresh, settleOnActiveServer],
  );

  const label = active?.name ?? 'No server';

  const trigger = (
    <DropdownMenuTrigger
      className={cn(
        'group flex items-center rounded-md text-sm font-medium text-muted-foreground transition-colors',
        'hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
        'data-[state=open]:bg-white/5 data-[state=open]:text-foreground',
        collapsed ? 'h-9 w-9 justify-center' : 'h-9 w-full gap-2 px-3',
      )}
      aria-label={`Active server: ${label}. Switch server`}
    >
      <Server className="h-4 w-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 truncate text-left text-foreground">{label}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </>
      )}
    </DropdownMenuTrigger>
  );

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && refresh()}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}

        <DropdownMenuContent align="start" side={collapsed ? 'right' : 'bottom'} className="w-64">
          <DropdownMenuLabel>Servers</DropdownMenuLabel>

          {servers.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">No servers registered.</div>
          )}

          {servers.map((entry) => (
            <div key={entry.id} className="group/server relative">
              <DropdownMenuCheckboxItem
                checked={entry.id === activeId}
                onSelect={() => handleSelect(entry.id)}
                // Radix keeps arrow keys, typeahead and Escape; Delete/Backspace
                // is added as the keyboard path to remove, because the remove
                // button overlaying the row is not tab-reachable inside a menu.
                onKeyDown={(event) => {
                  if (event.key === 'Delete' || event.key === 'Backspace') {
                    event.preventDefault();
                    handleRemove(entry);
                  }
                }}
                aria-keyshortcuts="Delete"
                className="pr-9"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5 truncate text-foreground">
                    {entry.name}
                    {!entry.apiKey && (
                      <KeyRound className="h-3 w-3 shrink-0 text-amber-500" role="img" aria-label="No API key" />
                    )}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{describeEntry(entry)}</span>
                </span>
              </DropdownMenuCheckboxItem>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  handleRemove(entry);
                }}
                className={cn(
                  'absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md',
                  // Always visible (not hover-only): inside a menu this button is
                  // not tab-reachable, so hiding it until hover would leave touch
                  // users with no remove affordance at all.
                  'text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive',
                  'group-hover/server:text-muted-foreground',
                )}
                aria-label={`Remove ${entry.name}`}
                tabIndex={-1}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add server…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AddServerDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={handleAdded} />
    </>
  );
}
