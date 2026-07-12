# KhalOS-Native Design Reference (distilled from app-kit design-system-showcase)

> Paths: `BASE = /private/tmp/claude-501/-Users-feliperosa-workspace-omni/be63a481-c885-4f35-86c0-ee5d6e4ceb09/scratchpad/app-kit`
> `os-ui = BASE/packages/os-ui` · `showcase = BASE/packages/design-system-showcase`

## The one critical fact: TWO token namespaces
- `--ds-*` (Geist grayscale + accent) → `os-ui/tokens.css`; Tailwind utilities (`bg-gray-1000`, `text-copy-13`); flips via next-themes `.dark`. Used by Button, Badge, Note, Command, primitives.
- `--khal-*` (OKLCH, copper accent, dark-first) → `os-ui/styles/khal-tokens.css`; used by GlassCard, SectionCard, DataRow, MetricDisplay, PillBadge, StatusDot, ProgressBar, `.k-*` classes. Re-tints ONLY under `.khal-light` (NOT `.dark`).
- **A consuming app must bridge both**: mirror next-themes `resolvedTheme` onto `.khal-light` on the root (see `showcase/src/providers/CatalogProviders.tsx:34-40`).

## Stylesheet contract (import once, in order — `showcase/src/styles.css:16-32`)
```css
@import url("...Geist:wght@300;400;500;550;600;650;700&family=Geist+Mono:wght@400;500;650...");
@import "tailwindcss";
@import "@khal-os/ui/tokens.css";
@import "@khal-os/ui/styles/khal-os.css"; /* barrel: khal-tokens → khal-motion → khal-components → khal-light */
@source "<path-to-@khal-os/ui>/dist";
@custom-variant dark (&:where(.dark, .dark *));
```
`khal-wallpaper.css` is opt-in (NOT in barrel): `class="khal-wallpaper"` on the desktop root (variants `.is-flat/.is-grid/.has-grain`).

## Screen scaffold (showcase/src/App.tsx:393-411)
```
shell grid: 268px sidebar | 1fr main, height 100vh, overflow hidden
├─ aside: brand (KhalLogo) + search Input + SidebarNav (compound: .Group/.Item{active,icon,suffix})
└─ main column
   ├─ content: padding 44px clamp(24px,4vw,56px); children max-width 1040px
   └─ StatusBar footer: mono 11.5px — version/counts/path (compound .Item{icon,variant}/.Separator/.Spacer)
```
Page header `.entry-head`: PillBadge eyebrow → h1 clamp(26px,2.4vw,34px) weight 650 tracking -0.02em → lede 15px/1.6 max 60ch. Section heads: mono 11px uppercase tracking 0.14em.

## Signature components (real prop signatures)
- **GlassCard** (`glass-card.tsx:28`): `{variant:'default'|'raised', padding:'sm'|'md'|'lg', hover?, glow?:hex}` — frosted blur(16px), floating HUDs/overlays/hero callouts, radius 16.
- **SectionCard** (`section-card.tsx:35`): `{variant:'default'|'inset'|'solid', padding:'none'|'sm'|'md'|'lg', glow?}` — DEFAULT page-content card. Never hand-roll bordered divs; use these or `.k-card` (khal-components.css:639).
- **DataRow** (`data-row.tsx:34`): `{variant:'default'|'inline'|'rule', label, value?, accentColor?, statusDot?, dotColor?, tag?('IF'), tagColor?}` — mono key/value workhorse for config/rule lists.
- **MetricDisplay** (`metric-display.tsx:45`): `{size:'sm'|'md'|'lg', value, label, description?, prefix?, suffix?, accentColor?}` — value always tabular-nums semibold negative-tracking.
- **LiveFeed** (`live-feed.tsx:25`): `{events:[{id,type:'info'|'success'|'warning'|'error'|'agent'|'system',message,timestamp?}], maxVisible=50, showTimestamps=true, height=300}` — auto-scroll mono console, AnimatePresence row insert 0.25s.
- **TickerBar** (`ticker-bar.tsx:6`): `{duration=30, pauseOnHover=true}` — KPI marquee, fill with PillBadge + mono stats.
- **NumberFlow** (`number-flow.tsx`): animated numbers, spring 800ms cubic-bezier(0.34,1.56,0.64,1).
- **CostCounter** (`cost-counter.tsx:8`): `{value, prefix?, suffix?, label, description?, budget?:0-100, budgetColor?}` — counts up on viewport enter.
- **PillBadge** (`pill-badge.tsx:45`): `{variant:'default'|'muted'|'accent', size:'sm'|'md'|'lg', dot?, dotColor?}` — ALWAYS uppercase wide-tracking rounded-full; THE section/category eyebrow.
- **StatusDot** (`status-dot.tsx:22`): `{state:'live'|'online'|'active'|'working'|'idle'|'away'|'queued'|'error', pulse?, size?, label?, showLabel?}` — typed state → color+pulse+glow automatically.
- **Note** (`note.tsx:34`): `{type:'default'|'error'|'warning'|'success', size?, label?, action?}` (ds-namespace).
- **EmptyState** (`primitives/empty-state.tsx:17`): `{icon?, title, description?, action?, compact?}`.
- **Command palette** (`command.tsx`): Command/CommandDialog(blur 24px)/CommandInput/CommandList/CommandEmpty/CommandGroup/CommandItem{prefix,callback}/CommandSeparator/CommandShortcut.
- **ContextMenu**: Radix wrappers, `--khal-menu-*`, rounded-xl.
- **ThemeProvider/ThemeSwitcher** (`theme-provider.tsx`, `theme-switcher.tsx`): next-themes + reduce-motion/glass prefs; segmented System/Light/Dark.
- Supporting: **Button**{variant default|secondary|tertiary|error|warning|ghost|link, size, loading, prefix,suffix}, **Badge**{gray|blue|green|amber|red|purple|pink|teal} (status chips ≠ eyebrows), **Avatar**{name,size,status,src}, **ProgressBar**{value,max,color,size,showLabel}, **SidebarNav**, **Toolbar**{.Button{tooltip,active}/.Group/.Separator/.Spacer/.Text/.Input}, **StatusBar**, **SplitPane**{children:[a,b],direction,defaultSize,min,max,collapseBelow}+.Panel, **ListView**{items,selected,onSelect,onActivate,renderItem,getKey,multiSelect} (keyboard nav).
- TS tokens: `khalOsTokens` + `khalVar('colors.accent')` (`os-ui/src/tokens/khal-os-tokens.ts`).

## Motion (os-ui/src/lib/animations.ts)
ONE easing: `khalEasing = [0.22,1,0.36,1]`; spring {stiffness:300,damping:22}; overshoot `--khal-ease-spring` cubic-bezier(0.34,1.56,0.64,1).
- `fadeUp` (+y12→0, blur4→0, 0.7s) = page/window mount · `scaleUp` (.96→1, blur6→0, 0.9s) = app launch · `staggerContainer` (staggerChildren 0.12) + `staggerChild` (+y8→0, 0.4s) = lists (120ms between siblings) · `fadeIn` 0.5s = simple reveals.
- Hover: -translate-y-0.5 + border-strong + shadow-lg. In-view: CostCounter onViewportEnter. CSS classes: `.khal-anim-fade-up/-scale-in/-pop/-pulse-loop/-shimmer-loop`; durations fast 120/normal 220/slow 480/app 900ms. Reduced-motion collapses to 1ms globally.

## Typography & color
- Geist everywhere; **Geist Mono for EVERY status/ID/timestamp/metric/shortcut** + `tabular-nums` (helper `.khal-tabular`). h1-h4 weight 650 tracking -0.02em; Button 550; labels 500. Scale: 48/26/17/15/13/12/11(mono eyebrow)/10(uppercase nav). Tailwind text classes: `text-copy-13/14`, `text-label-12/13`.
- Canonical six: `--khal-bg`(14% near-black) · `--khal-surface` · `--khal-fg` · `--khal-muted` · `--khal-border` · `--khal-accent`(copper oklch 71.49% 0.1112 63.09). Layers: bg < chrome < surface < cell. Text tiers `--khal-text-primary/secondary/tertiary/muted`. Borders default/subtle(60%)/strong(focus).
- **Copper = brand/selection. Blue = operational signal/links ONLY. Status colors sparingly, never decorative.** Each status has a `-glow` at 0.20 alpha.
- **Dark is canonical.** Light = opt-in contrast moment via `.khal-light` on a section root (never global invert); `.khal-dark` nested flips back. Copper stays copper.
- Radii 6(chips)/10(button/input)/12(card/window)/16(glass); spacing 4px base (4/8/12/16/24/32/48/64); glass `saturate(180%) blur(16px)`; shadows only on floating surfaces.

## Layout patterns (catalog entries)
- Shell/chrome: SidebarNav + Toolbar + StatusBar (`primitive-sidebar-nav/-toolbar/-status-bar`).
- Dashboard: MetricDisplay tiles in SectionCards, CostCounter, NumberFlow, TickerBar, ProgressBar; CSS chart helpers `.k-metric/.k-gauge/.k-donut/.k-spark/.k-chart` (khal-components.css:1475-1981).
- List+detail: SplitPane + ListView + property panel; selection `.k-row.k-row-active` (inset copper bar).
- Feed/console: LiveFeed + StatusDot + TickerBar; mono; ANSI contract khal-tokens.css:94-121.
- Settings/forms: SectionHeader, Switch, Input, DropdownMenu, Note; `.k-fieldset/.k-form-row/.k-helper` (khal-components.css:1296-1359); `.khal-light` contrast card moments.
- Hero/landing: MeshGradient + KhalLogo, SectionCard thumbnail grid, GlassCard raised callout (`showcase/src/pages/Landing.tsx`).
- Command surfaces: ⌘K CommandDialog, right-click ContextMenu.

## Top 10 "instantly KhalOS"
1. Dark-first on `--khal-bg`, never #000/light default. 2. Copper accent for brand/selection; blue only for signal/links. 3. Geist + Geist Mono on every status/ID/timestamp/metric, tabular-nums. 4. PillBadge eyebrows on every section. 5. GlassCard/SectionCard/.k-card, never raw bordered divs; layered surfaces. 6. One easing + blur-in reveals + 120ms list stagger. 7. StatusDot pulse + glow for live states. 8. Radii 6/10/12/16, 4px spacing, hairline borders. 9. Bottom StatusBar + left SidebarNav = OS silhouette. 10. Animated numbers + subtle khal-wallpaper K mark / MeshGradient heroes.

## Top 5 anti-patterns (= generic admin scaffold)
1. Raw Tailwind grays / hardcoded hex instead of tokens. 2. Body font for metrics/IDs/timestamps. 3. Rectangular Badge chips as section labels instead of PillBadge eyebrows. 4. No motion or generic ease-in-out instead of khalEasing + blur + stagger. 5. Global light invert / unbridged `.khal-light`; decorative status colors.

## Key files
Tokens: `os-ui/styles/khal-tokens.css`, `os-ui/tokens.css`, `khal-light.css`, TS `khal-os-tokens.ts`. Motion: `lib/animations.ts`, `styles/khal-motion.css`. CSS lib: `styles/khal-components.css`. Wallpaper: `styles/khal-wallpaper.css`. Assembly reference: `showcase/src/App.tsx`, `pages/Landing.tsx`, `styles.css`, `providers/CatalogProviders.tsx`. Per-component recipes: `showcase/src/catalog/entries/<id>/Preview.tsx`.
