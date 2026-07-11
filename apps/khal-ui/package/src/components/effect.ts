/**
 * Effect labels — the safety vocabulary shared by {@link ConfirmDialog},
 * {@link LiveTestResult}, and {@link MutationResult}. Every action the UI can
 * trigger declares its blast radius so an operator always sees, before and
 * after, whether something merely observed, faked, dry-ran, or actually changed
 * production state.
 */
export type EffectLabel = 'read-only' | 'synthetic' | 'dry-run' | 'live';

export interface EffectMeta {
  label: string;
  /** CSS color for the badge. */
  color: string;
  /** True for effects that change real state (live) — used to gate confirmation. */
  mutating: boolean;
  description: string;
}

export const EFFECTS: Record<EffectLabel, EffectMeta> = {
  'read-only': {
    label: 'READ-ONLY',
    color: 'var(--ds-gray-900, #8a8a8a)',
    mutating: false,
    description: 'Observes state without changing anything.',
  },
  synthetic: {
    label: 'SYNTHETIC',
    color: 'var(--ds-blue-700, #2563eb)',
    mutating: false,
    description: 'Runs against fabricated data; production is untouched.',
  },
  'dry-run': {
    label: 'DRY-RUN',
    color: 'var(--ds-amber-700, #d97706)',
    mutating: false,
    description: 'Simulates the change and reports what would happen.',
  },
  live: {
    label: 'LIVE',
    color: 'var(--ds-red-700, #dc2626)',
    mutating: true,
    description: 'Changes real production state.',
  },
};

/** Whether the typed confirmation satisfies a destructive gate. */
export function confirmSatisfied(input: string, phrase: string, destructive: boolean): boolean {
  if (!destructive) return true;
  return input.trim() === phrase.trim() && phrase.trim().length > 0;
}
