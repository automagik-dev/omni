'use client';

/**
 * Slim top toolbar: the explicit instance/channel scope selector and a ⌘K
 * affordance. Scope here is *visible context*, not a hidden filter — the
 * selector always shows the active instance/channel, and "All" is always
 * reachable, so pages built on `useScope()` can honour the selection without an
 * operator wondering why a list looks short. Backend origin/version/freshness
 * live in the bottom StatusBar; the theme switch lives in the sidebar head.
 */
import { Button } from '@khal-os/ui';
import type { Channel } from '@omni/sdk';
import { useNavigate } from 'react-router-dom';
import { T } from '../components/tokens';
import { useScope } from './providers/ScopeProvider';

const selectStyle = {
  padding: '5px 9px',
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.cell,
  color: T.fg,
  fontSize: 12,
  fontFamily: T.mono,
  maxWidth: 220,
} as const;

export function Header({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const scope = useScope();
  const navigate = useNavigate();

  const channels = Array.from(new Set(scope.instances.map((i) => i.channel))).sort();

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px clamp(24px, 4vw, 56px)',
        borderBottom: `1px solid ${T.border}`,
        background: T.chrome,
        minHeight: 52,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 10.5,
            color: T.tertiary,
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            fontFamily: T.mono,
            fontWeight: 650,
          }}
        >
          Scope
        </span>
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

      <Button size="small" variant="tertiary" onClick={onOpenPalette} suffix={<kbd style={kbdStyle}>⌘K</kbd>}>
        Search
      </Button>
    </header>
  );
}

const kbdStyle = {
  fontFamily: T.mono,
  fontSize: 10.5,
  padding: '1px 5px',
  borderRadius: 5,
  border: `1px solid ${T.border}`,
  color: T.secondary,
  background: T.cell,
} as const;
