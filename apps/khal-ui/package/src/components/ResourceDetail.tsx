'use client';

/**
 * Detail layout for a single resource: a header (title, id, status badges,
 * actions) over a stack of titled sections. Sections are SectionCards with a
 * mono, uppercase section head; the id renders mono so it reads as a stable
 * handle. Later groups drop entity fields, {@link SchemaForm} editors, and
 * {@link JsonInspector} payloads into the sections; this component owns the frame.
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          paddingBottom: 14,
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 650, letterSpacing: '-0.02em', color: T.fg }}>{title}</h2>
            {status}
          </div>
          {subtitle && <span style={{ fontSize: 13.5, color: T.secondary }}>{subtitle}</span>}
          {id && (
            <span style={{ fontSize: 12, fontFamily: T.mono, color: T.tertiary, wordBreak: 'break-all' }}>{id}</span>
          )}
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

/** Mono, uppercase, wide-tracked section head — the KhalOS section eyebrow. */
export function SectionHead({ children }: { children: ReactNode }) {
  return (
    <h3
      style={{
        margin: 0,
        fontFamily: T.mono,
        fontSize: 11,
        fontWeight: 650,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: T.tertiary,
      }}
    >
      {children}
    </h3>
  );
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
            marginBottom: description ? 4 : 14,
          }}
        >
          {title ? <SectionHead>{title}</SectionHead> : <span />}
          {actions}
        </div>
      )}
      {description && <p style={{ margin: '0 0 14px', fontSize: 12.5, color: T.muted }}>{description}</p>}
      {children}
    </SectionCard>
  );
}

ResourceDetail.Section = ResourceSection;
