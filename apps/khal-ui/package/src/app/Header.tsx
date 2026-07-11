'use client';

/**
 * Global header: the explicit instance/channel scope selector, a backend
 * origin + version + freshness chip fed by `/diag`, and the theme toggle.
 *
 * Scope here is *visible context*, not a hidden filter — the selector always
 * shows the active instance/channel, and "All" is always reachable, so pages
 * built on `useScope()` can honour the selection without an operator wondering
 * why a list looks short.
 */
import { Button, ThemeSwitcher } from '@khal-os/ui';
import type { Channel } from '@omni/sdk';
import { useNavigate } from 'react-router-dom';
import { FreshnessBadge } from '../components/FreshnessBadge';
import { T } from '../components/tokens';
import { useDiag } from '../hooks/useDiag';
import { useScope } from './providers/ScopeProvider';

const selectStyle = {
  padding: '5px 8px',
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.surface,
  color: T.fg,
  fontSize: 12,
  maxWidth: 200,
} as const;

export function Header() {
  const scope = useScope();
  const navigate = useNavigate();
  const { diag, observedAt } = useDiag();

  const channels = Array.from(new Set(scope.instances.map((i) => i.channel))).sort();
  const origin = diag?.baseUrl ? diag.baseUrl.replace(/^https?:\/\//, '') : '—';

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        borderBottom: `1px solid ${T.border}`,
        background: T.surface,
        minHeight: 52,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Scope</span>
        <select
          aria-label="Instance scope"
          value={scope.selectedInstanceId ?? ''}
          onChange={(e) => scope.setInstance(e.target.value || null)}
          style={selectStyle}
        >
          <option value="">All instances</option>
          {scope.instances.map((inst) => (
            <option key={inst.id} value={inst.id}>
              {inst.name} ({inst.channel})
            </option>
          ))}
        </select>
        <select
          aria-label="Channel scope"
          value={scope.selectedChannel ?? ''}
          onChange={(e) => scope.setChannel((e.target.value || null) as Channel | null)}
          style={selectStyle}
        >
          <option value="">All channels</option>
          {channels.map((ch) => (
            <option key={ch} value={ch}>
              {ch}
            </option>
          ))}
        </select>
        {scope.selectedInstanceId && (
          <Button size="small" variant="secondary" onClick={() => navigate(`/instances/${scope.selectedInstanceId}`)}>
            Open
          </Button>
        )}
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: T.muted, fontFamily: T.mono }} title="Backend origin (via BFF)">
          {origin}
        </span>
        {diag?.version && (
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 999,
              border: `1px solid ${T.border}`,
              color: T.fg,
              fontFamily: T.mono,
            }}
          >
            v{diag.version}
          </span>
        )}
        <FreshnessBadge observedAt={observedAt} source="backend" degraded={diag !== undefined && diag.auth !== 'ok'} />
        <ThemeSwitcher small />
      </div>
    </header>
  );
}
