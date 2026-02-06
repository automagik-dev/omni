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

const navItems: NavItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/' },
  { icon: Server, label: 'Instances', href: '/instances' },
  { icon: MessageSquare, label: 'Chats', href: '/chats' },
  { icon: Users, label: 'People', href: '/people' },
  { icon: BookUser, label: 'Contacts', href: '/contacts' },
  { icon: Bot, label: 'Providers', href: '/providers' },
  { icon: Zap, label: 'Automations', href: '/automations' },
  { icon: Shield, label: 'Access Rules', href: '/access-rules' },
  { icon: Package, label: 'Batch Jobs', href: '/batch-jobs' },
  { icon: AlertTriangle, label: 'Dead Letters', href: '/dead-letters' },
  { icon: Activity, label: 'Events', href: '/events' },
  { icon: Mic, label: 'Voices', href: '/voices' },
  { icon: FileText, label: 'Logs', href: '/logs' },
  { icon: Settings, label: 'Settings', href: '/settings' },
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

  // Sync with localStorage on mount
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
          'flex h-screen flex-col border-r bg-card transition-all duration-200',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        {/* Logo + Collapse toggle */}
        <div className="flex h-16 items-center justify-between border-b px-3">
          {!collapsed && (
            <div className="flex items-center px-3">
              <span className="text-xl font-bold text-primary">Omni</span>
              <span className="ml-2 text-sm text-muted-foreground">v2</span>
            </div>
          )}
          <button
            type="button"
            onClick={toggleCollapse}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
              collapsed && 'mx-auto',
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const navLink = (
              <NavLink
                key={item.href}
                to={item.href}
                className={({ isActive }) =>
                  cn(
                    'flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    collapsed ? 'justify-center' : 'gap-3',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )
                }
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {!collapsed && item.label}
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
        </nav>

        {/* Logout button */}
        <div className="border-t p-3">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center justify-center rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Logout</TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
            >
              <LogOut className="h-5 w-5" />
              Logout
            </button>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
