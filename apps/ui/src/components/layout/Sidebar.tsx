import { clearApiKey } from '@/lib/sdk';
import { cn } from '@/lib/utils';
import { Activity, FileText, LayoutDashboard, LogOut, MessageSquare, Server, Settings } from 'lucide-react';
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
  { icon: Activity, label: 'Events', href: '/events' },
  { icon: FileText, label: 'Logs', href: '/logs' },
  { icon: Settings, label: 'Settings', href: '/settings' },
];

export function Sidebar() {
  const handleLogout = () => {
    clearApiKey();
    window.location.href = '/login';
  };

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-card">
      {/* Logo */}
      <div className="flex h-16 items-center border-b px-6">
        <span className="text-xl font-bold text-primary">Omni</span>
        <span className="ml-2 text-sm text-muted-foreground">v2</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )
            }
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Logout button */}
      <div className="border-t p-3">
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
        >
          <LogOut className="h-5 w-5" />
          Logout
        </button>
      </div>
    </aside>
  );
}
