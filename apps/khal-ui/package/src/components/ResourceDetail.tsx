'use client';

/**
 * Detail layout for a single resource: a header (title, id, status badges,
 * actions) over a stack of titled sections. Later groups drop entity fields,
 * {@link SchemaForm} editors, and {@link JsonInspector} payloads into the
 * sections; this component owns the consistent frame.
 */
import { SectionCard } from '@khal-os/ui';
import type { ReactNode } from 'react';
import { T } from './tokens';

export interface ResourceDetailProps {
  title: string;
  subtitle?: string;
  /** Stable id shown read-only under the title. */
  id?: string;
  /** Status badges / chips rendered next to the title. */
  status?: ReactNode;
  /** Header actions (buttons). */
  actions?: ReactNode;
  children?: ReactNode;
}

export function ResourceDetail({ title, subtitle, id, status, actions, children }: ResourceDetailProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          paddingBottom: 12,
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 650, color: T.fg }}>{title}</h2>
            {status}
          </div>
          {subtitle && <span style={{ fontSize: 13, color: T.muted }}>{subtitle}</span>}
          {id && <span style={{ fontSize: 12, fontFamily: T.mono, color: T.muted, wordBreak: 'break-all' }}>{id}</span>}
        </div>
        {actions && <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export interface ResourceSectionProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

function ResourceSection({ title, description, actions, children }: ResourceSectionProps) {
  return (
    <SectionCard padding="md">
      {(title || actions) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: description ? 2 : 12,
          }}
        >
          {title && <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.fg }}>{title}</h3>}
          {actions}
        </div>
      )}
      {description && <p style={{ margin: '0 0 12px', fontSize: 12, color: T.muted }}>{description}</p>}
      {children}
    </SectionCard>
  );
}

ResourceDetail.Section = ResourceSection;
