import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';

/**
 * Main application shell with sidebar navigation and status footer
 */
export function Shell() {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
        <StatusBar />
      </div>
    </div>
  );
}
