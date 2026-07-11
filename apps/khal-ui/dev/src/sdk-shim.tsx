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
import type { ReactNode } from 'react';

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

export function HarnessProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <KhalAuthContext.Provider value={DEV_USER}>
        <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
      </KhalAuthContext.Provider>
    </ThemeProvider>
  );
}
