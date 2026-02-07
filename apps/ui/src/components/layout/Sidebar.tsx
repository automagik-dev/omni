import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { clearApiKey } from '@/lib/sdk';
import { cn } from '@/lib/utils';
import {
  Activity,
  AlertTriangle,
  BookUser,
  Bot,
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Mic,
  Package,
  Server,
  Settings,
  Shield,
  Users,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';

interface NavItem {
  icon: React.ElementType;
  label: string;
  href: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    title: 'OVERVIEW',
    items: [
      { icon: LayoutDashboard, label: 'Dashboard', href: '/' },
      { icon: Server, label: 'Instances', href: '/instances' },
    ],
  },
  {
    title: 'MESSAGING',
    items: [
      { icon: MessageSquare, label: 'Chats', href: '/chats' },
      { icon: Users, label: 'People', href: '/people' },
      { icon: BookUser, label: 'Contacts', href: '/contacts' },
    ],
  },
  {
    title: 'AI & AUTOMATION',
    items: [
      { icon: Bot, label: 'Providers', href: '/providers' },
      { icon: Zap, label: 'Automations', href: '/automations' },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { icon: Activity, label: 'Events', href: '/events' },
      { icon: Package, label: 'Batch Jobs', href: '/batch-jobs' },
      { icon: AlertTriangle, label: 'Dead Letters', href: '/dead-letters' },
      { icon: FileText, label: 'Logs', href: '/logs' },
      { icon: Mic, label: 'Voices', href: '/voices' },
    ],
  },
  {
    title: 'SETTINGS',
    items: [
      { icon: Shield, label: 'Access Rules', href: '/access-rules' },
      { icon: Settings, label: 'Settings', href: '/settings' },
    ],
  },
];

const STORAGE_KEY = 'omni-sidebar-collapsed';

interface SidebarProps {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function Sidebar({ collapsed: controlledCollapsed, onCollapsedChange }: SidebarProps = {}) {
  const [internalCollapsed, setInternalCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });

  const collapsed = controlledCollapsed ?? internalCollapsed;

  const setCollapsed = useCallback(
    (value: boolean) => {
      setInternalCollapsed(value);
      localStorage.setItem(STORAGE_KEY, String(value));
      onCollapsedChange?.(value);
    },
    [onCollapsedChange],
  );

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      setInternalCollapsed(stored === 'true');
    }
  }, []);

  const handleLogout = () => {
    clearApiKey();
    window.location.href = '/login';
  };

  const toggleCollapse = () => setCollapsed(!collapsed);

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'flex h-screen flex-col border-r border-border/30 bg-card/50 backdrop-blur-xl transition-all duration-300',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        {/* Logo + Collapse toggle */}
        <div className="flex h-16 items-center justify-between border-b border-border/30 px-3">
          {!collapsed && (
            <div className="flex items-center gap-2 px-3">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              <span className="font-display text-xl font-bold tracking-tight text-foreground">OMNI</span>
            </div>
          )}
          <button
            type="button"
            onClick={toggleCollapse}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground',
              collapsed && 'mx-auto',
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {navGroups.map((group) => (
            <div key={group.title} className="mb-6">
              {!collapsed && (
                <div className="mb-2 px-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/50">
                  {group.title}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const navLink = (
                    <NavLink
                      key={item.href}
                      to={item.href}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
                          collapsed ? 'justify-center' : 'gap-3',
                          isActive
                            ? 'bg-primary/8 text-primary'
                            : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-primary" />
                          )}
                          <item.icon className="h-4.5 w-4.5 shrink-0" />
                          {!collapsed && item.label}
                        </>
                      )}
                    </NavLink>
                  );

                  if (collapsed) {
                    return (
                      <Tooltip key={item.href}>
                        <TooltipTrigger asChild>{navLink}</TooltipTrigger>
                        <TooltipContent side="right">{item.label}</TooltipContent>
                      </Tooltip>
                    );
                  }

                  return navLink;
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Logout button */}
        <div className="border-t border-border/30 p-3">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center justify-center rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <LogOut className="h-4.5 w-4.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Logout</TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="h-4.5 w-4.5" />
              Logout
            </button>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
