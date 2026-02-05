import { Shell } from '@/components/layout';
import { createQueryClient } from '@/lib/query';
import { isAuthenticated } from '@/lib/sdk';
import { ChatView, Chats, Dashboard, Events, InstanceDetail, Instances, Login, Logs, Settings } from '@/pages';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

const queryClient = createQueryClient();

/**
 * Protected route wrapper - redirects to login if not authenticated
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

/**
 * Public route wrapper - redirects to dashboard if already authenticated
 */
function PublicRoute({ children }: { children: React.ReactNode }) {
  if (isAuthenticated()) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route
            path="/login"
            element={
              <PublicRoute>
                <Login />
              </PublicRoute>
            }
          />

          {/* Protected routes with shell layout */}
          <Route
            element={
              <ProtectedRoute>
                <Shell />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/instances" element={<Instances />} />
            <Route path="/instances/:id" element={<InstanceDetail />} />
            <Route path="/chats" element={<Chats />} />
            <Route path="/chats/:id" element={<ChatView />} />
            <Route path="/events" element={<Events />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          {/* Catch-all redirect */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
