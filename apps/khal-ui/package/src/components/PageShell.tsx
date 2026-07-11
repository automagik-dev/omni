'use client';

/**
 * Titled page frame every route renders into — real pages and placeholders
 * alike, so navigation never lands on a bare or 404 surface. Provides the
 * heading, optional description, header actions slot, and a consistent content
 * column.
 */
import type { ReactNode } from 'react';
import { T } from './tokens';

export interface PageShellProps {
  title: string;
  description?: string;
  /** Right-aligned header actions (buttons, selectors). */
  actions?: ReactNode;
  /** Small label above the title (e.g. the group name). */
  eyebrow?: string;
  children?: ReactNode;
}

export function PageShell({ title, description, actions, eyebrow, children }: PageShellProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 24, maxWidth: 1200, minWidth: 0 }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          {eyebrow && (
            <span
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: T.muted,
                fontWeight: 600,
              }}
            >
              {eyebrow}
            </span>
          )}
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 650, color: T.fg }}>{title}</h1>
          {description && <p style={{ margin: 0, fontSize: 13, color: T.muted }}>{description}</p>}
        </div>
        {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{actions}</div>}
      </header>
      {children}
    </div>
  );
}
