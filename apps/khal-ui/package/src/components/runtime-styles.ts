/**
 * Runtime-injected interaction styles for the pack's own chrome.
 *
 * A handful of KhalOS-native affordances need pseudo-classes (`:hover`,
 * `:focus-visible`, sticky headers) that inline styles can't express. Rather
 * than depend on the host's Tailwind build generating arbitrary-value utilities,
 * the pack injects one tiny stylesheet at runtime — it works identically
 * standalone and embedded because it's plain DOM, not a build artifact. Every
 * rule is scoped to an `omni-` prefix and styled purely from `--khal-*` tokens,
 * so it tracks the theme and never collides with host or component styles.
 *
 * Importing this module injects once (guarded by element id). Components opt in
 * by adding the class names.
 */
const STYLE_ID = 'omni-khal-ui-runtime';

const CSS = `
/* Copper easing, matching os-ui khalEasing [0.22,1,0.36,1]. */
.omni-row {
  transition: background 120ms cubic-bezier(0.22, 1, 0.36, 1);
}
.omni-row:hover {
  background: color-mix(in oklch, var(--khal-fg) 4%, transparent);
}
.omni-row-clickable { cursor: pointer; }
.omni-row-clickable:hover {
  box-shadow: inset 2px 0 0 var(--khal-accent);
}
.omni-row-clickable:focus-visible {
  outline: none;
  background: color-mix(in oklch, var(--khal-accent) 12%, transparent);
  box-shadow: inset 2px 0 0 var(--khal-accent);
}

/* Card lift on hover — the OS "reach for" motion. */
.omni-card-hover {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 220ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.omni-card-hover:hover {
  transform: translateY(-2px);
  border-color: var(--khal-border-strong);
  box-shadow: 0 10px 30px color-mix(in oklch, black 32%, transparent);
}

/* Sticky, quiet table head. */
.omni-th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--khal-bg-elevated, var(--khal-chrome));
}

/* ── Flagship surfaces: live chat, instances, registries ─────────────────── */

/* Media card — rounded frame with a subtle hover-zoom "reach for" affordance. */
.omni-media {
  overflow: hidden;
  border-radius: 12px;
  display: block;
  transition: box-shadow 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.omni-media img,
.omni-media video {
  display: block;
  transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
}
.omni-media:hover {
  box-shadow: 0 8px 24px color-mix(in oklch, black 34%, transparent);
}
.omni-media:hover img {
  transform: scale(1.035);
}

/* Message row arrival — the LiveFeed-style insert motion. Plays once on mount,
   so a newly polled message animates in while existing rows stay put. */
.omni-msg-in {
  animation: omni-msg-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes omni-msg-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Composer shell — copper focus ring when the field (or its controls) has focus. */
.omni-composer:focus-within {
  border-color: var(--khal-accent);
  box-shadow: 0 0 0 3px var(--khal-accent-glow);
}

/* Copy-on-click mono id affordance. */
.omni-copy {
  cursor: pointer;
  transition: color 120ms cubic-bezier(0.22, 1, 0.36, 1);
}
.omni-copy:hover { color: var(--khal-accent); }

/* Segmented-control button (instance selector, view toggle). */
.omni-seg-btn {
  transition: background 120ms cubic-bezier(0.22, 1, 0.36, 1), color 120ms cubic-bezier(0.22, 1, 0.36, 1);
}
.omni-seg-btn:hover { color: var(--khal-fg); }

/* Quiet icon button (composer +, lens collapse, list affordances). */
.omni-iconbtn {
  transition: background 120ms cubic-bezier(0.22, 1, 0.36, 1), color 120ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 120ms cubic-bezier(0.22, 1, 0.36, 1);
}
.omni-iconbtn:hover {
  background: color-mix(in oklch, var(--khal-fg) 6%, transparent);
  color: var(--khal-fg);
}

@media (prefers-reduced-motion: reduce) {
  .omni-row, .omni-card-hover { transition: none; }
  .omni-card-hover:hover { transform: none; }
  .omni-media img, .omni-media video { transition: none; }
  .omni-media:hover img { transform: none; }
  .omni-msg-in { animation: none; }
}
`;

if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

/** No-op export so importers can force the side-effect without a bare import. */
export const runtimeStylesInjected = true;
