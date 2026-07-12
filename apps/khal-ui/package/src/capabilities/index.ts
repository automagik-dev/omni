/**
 * Typed access to the generated capability inventory.
 *
 * `capabilities.json` is produced by `scripts/build-capability-inventory.ts`
 * (do not hand-edit). It is the single source the UI reads to know what the
 * Omni backend can do and how far each capability has been surfaced.
 */
import inventory from './capabilities.json' with { type: 'json' };

export type UiStatus = 'none' | 'exposed' | 'operable' | 'live-verified' | 'ux-complete';

export interface Capability {
  key: string;
  method: string;
  route: string;
  resource: string;
  scope: string | null;
  inOpenApi: boolean;
  inScopeMap: boolean;
  mutating: boolean;
  destructive: boolean;
  realtime: boolean;
  uiStatus: UiStatus;
  /** Optional honest caveat (e.g. a known backend bug); curated, not derived. */
  note?: string;
}

export interface CapabilityInventory {
  $generator: string;
  totals: {
    total: number;
    inSpec: number;
    offSpec: number;
    inScopeMap: number;
    mutating: number;
    destructive: number;
    realtime: number;
    darkFamilyCount: number;
    darkFamilies: string[];
    byUiStatus: Record<UiStatus, number>;
  };
  capabilities: Capability[];
}

export const capabilityInventory = inventory as CapabilityInventory;
export const capabilities: Capability[] = capabilityInventory.capabilities;
