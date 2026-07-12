/**
 * Harness KHAL-host shim.
 *
 * Standalone, the pack has no KHAL OS around it, so the harness supplies the
 * minimum host context the pack reads: a logged-in admin user (so
 * `useKhalAuth()` resolves through `KhalAuthContext`) plus the theme and
 * tooltip providers. No NATS bridge — MainView doesn't use it, and Group B
 * mocks any realtime hooks it later adds.
 */
import { KhalAuthContext } from '@khal-os/sdk/app';
import type { KhalAuth, Role } from '@khal-os/sdk/app';
import { ThemeProvider, TooltipProvider } from '@khal-os/ui';
import { useTheme } from 'next-themes';
import { type ReactNode, useEffect } from 'react';

export const DEV_USER: KhalAuth = {
  userId: 'harness-dev',
  orgId: 'harness-org',
  role: 'platform-dev' satisfies Role,
  permissions: ['*'],
  loading: false,
  email: 'dev@omni.local',
  name: 'Omni Dev',
  picture: undefined,
};

/** Mock of the SDK `useKhalAuth` hook for standalone use. */
export function mockUseKhalAuth(): KhalAuth {
  return DEV_USER;
}

/**
 * KhalOS uses two token namespaces: next-themes flips `--ds-*` via the `.dark`
 * class, but the `--khal-*` tokens (GlassCard, SectionCard, DataRow, StatusDot,
 * copper accent…) only re-tint under `.khal-light`. In the running OS the host
 * bridges the two; standalone the harness must, or light mode renders a
 * dark/light mix. Mirror the resolved theme onto `.khal-light` on <html>.
 */
function KhalLightSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    document.documentElement.classList.toggle('khal-light', resolvedTheme === 'light');
  }, [resolvedTheme]);
  return null;
}

export function HarnessProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <KhalLightSync />
      <KhalAuthContext.Provider value={DEV_USER}>
        <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
      </KhalAuthContext.Provider>
    </ThemeProvider>
  );
}
