'use client';

/**
 * ⌘K command palette. Every sitemap route, grouped by section, plus quick
 * actions: jump straight to a channel instance by name, or open the chat
 * console. Controlled by {@link AppShell} (which also owns the ⌘K/Ctrl+K
 * shortcut) so the same open-state drives the keyboard, the StatusBar hint,
 * and any future trigger.
 */
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@khal-os/ui';
import { useNavigate } from 'react-router-dom';
import { useScope } from './providers/ScopeProvider';
import { SITEMAP } from './sitemap';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const scope = useScope();

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to a page, or an instance by name…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        <CommandGroup heading="Quick actions">
          <CommandItem value="open chat console" onSelect={() => go('/chat')}>
            Open chat console
          </CommandItem>
          {scope.instances.map((inst) => (
            <CommandItem
              key={inst.id}
              value={`instance ${inst.name} ${inst.channel}`}
              onSelect={() => go(`/instances/${inst.id}`)}
            >
              Instance · {inst.name}
            </CommandItem>
          ))}
        </CommandGroup>

        {SITEMAP.map((group) => (
          <CommandGroup key={group.id} heading={group.title}>
            {group.items.map((item) => (
              <CommandItem key={item.path} value={`${group.title} ${item.label}`} onSelect={() => go(item.path)}>
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

        <CommandSeparator />
      </CommandList>
    </CommandDialog>
  );
}
