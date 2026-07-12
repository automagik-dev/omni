'use client';

/**
 * Route-level error boundary. A render error in one page must not white-screen
 * the whole pack — it should stay contained to the page area, keep the shell
 * (sidebar/header) alive, and show the error with a retry. Mounted around the
 * routed {@link Outlet} and keyed by pathname, so navigating away auto-clears a
 * crashed page. The fallback is a pure component so it renders under SSR tests.
 */
import { Component, type ReactNode } from 'react';
import { T } from '../components/tokens';

export function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div
      role="alert"
      style={{
        margin: 24,
        padding: 20,
        borderRadius: 12,
        border: `1px solid ${T.danger}`,
        background: T.surface,
        color: T.fg,
        maxWidth: 720,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>This page hit an error</div>
      <div style={{ fontSize: 13, color: T.muted, marginBottom: 12 }}>
        The rest of the app is fine — you can retry this page or navigate elsewhere from the sidebar.
      </div>
      <pre
        style={{
          margin: '0 0 14px',
          padding: 12,
          borderRadius: 8,
          background: T.sunken,
          color: T.muted,
          fontSize: 12,
          fontFamily: T.mono,
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
        }}
      >
        {error.message || String(error)}
      </pre>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={onRetry}
          style={{
            padding: '7px 14px',
            borderRadius: 8,
            border: `1px solid ${T.border}`,
            background: T.accent,
            color: '#fff',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined') window.location.reload();
          }}
          style={{
            padding: '7px 14px',
            borderRadius: 8,
            border: `1px solid ${T.border}`,
            background: 'transparent',
            color: T.fg,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    </div>
  );
}

interface Props {
  children: ReactNode;
  /** When this changes, a captured error is cleared (e.g. route pathname). */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidUpdate(prev: Props): void {
    // Auto-clear when the route changes so a crashed page doesn't stick.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override componentDidCatch(error: Error, info: { componentStack?: string }): void {
    // Surface to the console for dev; the fallback shows it in the UI.
    console.error('Route render error:', error, info?.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}
