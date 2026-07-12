/**
 * Theme tokens for the pack's own markup, as CSS-variable strings with layered
 * fallbacks: KHAL semantic token → harness convenience var → hard-coded value.
 *
 * The `--khal-*` tokens are the portable contract — defined both by the KHAL
 * host and reproduced by the dev harness — so styling with these renders
 * identically standalone and embedded, in light and dark. Prefer composing
 * `@khal-os/ui` components; reach for these only for custom layout/chrome.
 *
 * Palette intent (KhalOS-native): copper `accent` is brand + selection; `accentBlue`
 * is operational signal/links ONLY; status colors (`ok`/`warn`/`danger`) are used
 * sparingly, never decoratively. Surfaces layer bg < chrome < surface < cell.
 */
export const T = {
  fg: 'var(--khal-fg, var(--fg, #ededed))',
  muted: 'var(--khal-muted, var(--fg-dim, #8a8a8a))',
  secondary: 'var(--khal-text-secondary, var(--khal-muted, #8a8a8a))',
  tertiary: 'var(--khal-text-tertiary, var(--khal-tertiary, #6a6a6a))',
  border: 'var(--khal-border-default, var(--khal-border, var(--border, #2a2a2a)))',
  borderSubtle: 'var(--khal-border-subtle, var(--border, #232323))',
  borderStrong: 'var(--khal-border-strong, var(--border, #3a3a3a))',
  bg: 'var(--khal-bg, var(--bg, #0a0a0a))',
  chrome: 'var(--khal-chrome, var(--khal-bg-elevated, var(--bg-elev, #141414)))',
  surface: 'var(--khal-bg-surface, var(--bg-elev, #141414))',
  elevated: 'var(--khal-bg-elevated, var(--bg-elev, #141414))',
  sunken: 'var(--khal-bg-sunken, var(--bg, #0a0a0a))',
  cell: 'var(--khal-cell, var(--khal-bg-sunken, #0f0f0f))',
  accent: 'var(--khal-accent, #c88a5f)',
  accentGlow: 'var(--khal-accent-glow, color-mix(in oklch, var(--khal-accent, #c88a5f) 20%, transparent))',
  accentSoft: 'color-mix(in oklch, var(--khal-accent, #c88a5f) 14%, transparent)',
  accentBlue: 'var(--khal-accent-blue, #3b82f6)',
  danger: 'var(--khal-error, var(--ds-red-700, #dc2626))',
  warn: 'var(--khal-warning, var(--ds-amber-700, #d97706))',
  ok: 'var(--khal-success, var(--ds-green-700, #16a34a))',
  mono: 'var(--khal-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  radius: 'var(--khal-radius, 10px)',
  radiusCard: '12px',
  radiusGlass: '16px',
} as const;
