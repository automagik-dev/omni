'use client';

/**
 * Titled page frame every route renders into — real pages and placeholders
 * alike, so navigation never lands on a bare or 404 surface. The entry-head
 * pattern: a PillBadge eyebrow (the section name), a tight display heading, and
 * a lede. Outer padding + column width are owned by {@link AppShell}; this frame
 * just stacks the head over the page content.
 */
import { PillBadge } from '@khal-os/ui';
import type { ReactNode } from 'react';
import { T } from './tokens';

export interface PageShellProps {
  title: string;
  description?: string;
  /** Right-aligned header actions (buttons, selectors). */
  actions?: ReactNode;
  /** Small label above the title (e.g. the group name) — rendered as an eyebrow. */
  eyebrow?: string;
  children?: ReactNode;
}

export function PageShell({ title, description, actions, eyebrow, children }: PageShellProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          {eyebrow && (
            <PillBadge size="sm" variant="muted" dot dotColor={T.accent}>
              {eyebrow}
            </PillBadge>
          )}
          <h1
            style={{
              margin: 0,
              fontSize: 'clamp(26px, 2.4vw, 34px)',
              fontWeight: 650,
              letterSpacing: '-0.02em',
              color: T.fg,
            }}
          >
            {title}
          </h1>
          {description && (
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, maxWidth: '60ch', color: T.secondary }}>
              {description}
            </p>
          )}
        </div>
        {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{actions}</div>}
      </header>
      {children}
    </div>
  );
}
