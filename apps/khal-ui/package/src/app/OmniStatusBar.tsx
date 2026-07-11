'use client';

/**
 * Bottom StatusBar — the OS chrome's ground line. Mono, quiet, always-on:
 * backend origin + version (from `/diag`), a connection-freshness StatusDot,
 * the current route path, capability coverage counts, and the ⌘K hint. Reads
 * only; every value is observed, never asserted.
 */
import { Icons, StatusBar, StatusDot } from '@khal-os/ui';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { capabilityInventory } from '../capabilities';
import { formatAge } from '../components/FreshnessBadge';
import { useDiag } from '../hooks/useDiag';

const totals = capabilityInventory.totals;
const liveVerified = (totals.byUiStatus['live-verified'] ?? 0) + (totals.byUiStatus['ux-complete'] ?? 0);

export function OmniStatusBar({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const location = useLocation();
  const { diag, observedAt } = useDiag();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const origin = diag?.baseUrl ? diag.baseUrl.replace(/^https?:\/\//, '') : '—';
  const age = observedAt ? now - observedAt : undefined;
  const degraded = diag !== undefined && diag.auth !== 'ok';
  const stale = age !== undefined && age > 60_000;
  const connState = degraded ? 'error' : stale ? 'away' : observedAt ? 'live' : 'idle';

  return (
    <StatusBar>
      <StatusBar.Item icon={<StatusDot state={connState} size="sm" pulse={connState === 'live'} />}>
        {origin}
      </StatusBar.Item>
      {diag?.version && (
        <>
          <StatusBar.Separator />
          <StatusBar.Item>v{diag.version}</StatusBar.Item>
        </>
      )}
      <StatusBar.Separator />
      <StatusBar.Item>{degraded ? 'auth failed' : age === undefined ? 'connecting…' : formatAge(age)}</StatusBar.Item>
      <StatusBar.Separator />
      <StatusBar.Item icon={<Icons.File />}>{location.pathname}</StatusBar.Item>
      <StatusBar.Spacer />
      <StatusBar.Item icon={<Icons.Sparkles />}>
        {liveVerified}/{totals.total} capabilities live
      </StatusBar.Item>
      <StatusBar.Separator />
      <StatusBar.Item icon={<Icons.Cmd />} onClick={onOpenPalette}>
        ⌘K
      </StatusBar.Item>
    </StatusBar>
  );
}
