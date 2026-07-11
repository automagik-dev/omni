/**
 * Theme tokens for the pack's own markup, as CSS-variable strings with layered
 * fallbacks: KHAL semantic token → harness convenience var → hard-coded value.
 *
 * The `--khal-*` tokens are the portable contract — defined both by the KHAL
 * host and reproduced by the dev harness — so styling with these renders
 * identically standalone and embedded, in light and dark. Prefer composing
 * `@khal-os/ui` components; reach for these only for custom layout/chrome.
 */
export const T = {
  fg: 'var(--khal-fg, var(--fg, #ededed))',
  muted: 'var(--khal-muted, var(--fg-dim, #8a8a8a))',
  border: 'var(--khal-border-default, var(--khal-border, var(--border, #2a2a2a)))',
  borderSubtle: 'var(--khal-border-subtle, var(--border, #232323))',
  borderStrong: 'var(--khal-border-strong, var(--border, #3a3a3a))',
  bg: 'var(--khal-bg, var(--bg, #0a0a0a))',
  surface: 'var(--khal-bg-surface, var(--bg-elev, #141414))',
  elevated: 'var(--khal-bg-elevated, var(--bg-elev, #141414))',
  sunken: 'var(--khal-bg-sunken, var(--bg, #0a0a0a))',
  accent: 'var(--khal-accent, #3b82f6)',
  accentBlue: 'var(--khal-accent-blue, #3b82f6)',
  danger: 'var(--ds-red-700, #dc2626)',
  warn: 'var(--ds-amber-700, #d97706)',
  ok: 'var(--ds-green-700, #16a34a)',
  mono: 'var(--khal-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
} as const;
