import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

/**
 * Main application shell with sidebar navigation
 */
export function Shell() {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
