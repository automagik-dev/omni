# WISH: UI Project Setup

> Monorepo infrastructure for the UI package with Bun, Tailwind v4, Biome, and production serving.

**Status:** DRAFT
**Created:** 2026-02-05
**Author:** WISH Agent
**Beads:** omni-j2s
**Priority:** P1

---

## Context

Before building the UI, we need proper project infrastructure:

1. **Monorepo integration** - `apps/ui` as a workspace package
2. **Bun** - Package management and scripts
3. **Tailwind v4** - CSS-first configuration
4. **Biome** - Linting and formatting (consistent with rest of monorepo)
5. **Quality hooks** - Pre-commit checks
6. **Production serving** - API serves built UI (not Vite)

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | Tailwind v4 + shadcn/ui work together |
| **DEC-1** | Decision | Use Bun for all package management |
| **DEC-2** | Decision | Use Biome (not ESLint/Prettier) |
| **DEC-3** | Decision | API serves UI static files in production |
| **DEC-4** | Decision | Vite for dev only |
| **DEC-5** | Decision | Tailwind v4 with CSS-first config |
| **DEC-6** | Decision | husky for git hooks (already in project) |

---

## Scope

### IN SCOPE

1. **Package setup**
   - Create `apps/ui/` directory
   - Configure as Bun workspace package
   - Setup package.json with proper scripts

2. **Vite + React**
   - Vite config for development
   - React 18 + TypeScript
   - Path aliases (@/ imports)
   - Dev proxy to API

3. **Tailwind v4**
   - CSS-first configuration
   - @theme directive for design tokens
   - shadcn/ui compatibility layer (if needed)

4. **Biome**
   - Extend root biome.json
   - UI-specific rules if needed
   - Format on save config

5. **Git hooks**
   - Pre-commit: lint (via `make lint`)
   - Pre-push: typecheck (via `make typecheck`)
   - Use existing husky setup - just update Makefile targets

6. **Production build**
   - Vite build to `dist/`
   - API serves static files from `apps/ui/dist/`
   - SPA fallback for client-side routing

7. **Makefile targets**
   - `make dev-ui` - Start UI dev server
   - `make build-ui` - Production build
   - `make lint-ui` - Lint UI package

### OUT OF SCOPE

- Actual UI components (that's UI Foundation wish)
- shadcn component installation (part of UI Foundation)
- Authentication logic
- API changes

---

## Technical Design

### Directory Structure

```
apps/
└── ui/
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── index.css          # Tailwind v4 entry
    │   └── vite-env.d.ts
    ├── public/
    │   └── favicon.svg
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    └── README.md
```

### Workspace Configuration

```json
// Root package.json - add to workspaces
{
  "workspaces": [
    "packages/*",
    "apps/*"
  ]
}
```

```json
// apps/ui/package.json
{
  "name": "@omni/ui",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src/",
    "lint:fix": "biome check --write src/"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@omni/sdk": "workspace:*"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^6.0.0",
    "tailwindcss": "^4.0.0"
  }
}
```

### Vite Configuration

```typescript
// apps/ui/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8882',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
});
```

### Tailwind v4 Setup

```css
/* apps/ui/src/index.css */
@import "tailwindcss";

@theme {
  /* Colors */
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.145 0 0);
  --color-primary: oklch(0.546 0.245 262.881);
  --color-primary-foreground: oklch(0.985 0.001 106.423);
  --color-secondary: oklch(0.97 0.001 106.424);
  --color-secondary-foreground: oklch(0.205 0.015 285.823);
  --color-muted: oklch(0.97 0.001 106.424);
  --color-muted-foreground: oklch(0.556 0.014 285.938);
  --color-accent: oklch(0.97 0.001 106.424);
  --color-accent-foreground: oklch(0.205 0.015 285.823);
  --color-destructive: oklch(0.577 0.245 27.325);
  --color-destructive-foreground: oklch(0.985 0.001 106.423);
  --color-border: oklch(0.922 0.004 286.067);
  --color-input: oklch(0.922 0.004 286.067);
  --color-ring: oklch(0.546 0.245 262.881);

  /* Radius */
  --radius-sm: 0.25rem;
  --radius-md: 0.375rem;
  --radius-lg: 0.5rem;
  --radius-xl: 0.75rem;

  /* Fonts */
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, monospace;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  @theme {
    --color-background: oklch(0.145 0 0);
    --color-foreground: oklch(0.985 0 0);
    --color-primary: oklch(0.707 0.165 254.624);
    --color-primary-foreground: oklch(0.205 0.015 285.823);
    --color-secondary: oklch(0.269 0.015 285.786);
    --color-secondary-foreground: oklch(0.985 0.001 106.423);
    --color-muted: oklch(0.269 0.015 285.786);
    --color-muted-foreground: oklch(0.711 0.014 285.938);
    --color-accent: oklch(0.269 0.015 285.786);
    --color-accent-foreground: oklch(0.985 0.001 106.423);
    --color-destructive: oklch(0.704 0.191 22.216);
    --color-destructive-foreground: oklch(0.985 0.001 106.423);
    --color-border: oklch(0.269 0.015 285.786);
    --color-input: oklch(0.269 0.015 285.786);
    --color-ring: oklch(0.707 0.165 254.624);
  }
}
```

### TypeScript Configuration

```json
// apps/ui/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

```json
// apps/ui/tsconfig.node.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["vite.config.ts"]
}
```

### Biome Configuration

UI extends the root biome.json automatically. If UI-specific rules are needed:

```json
// apps/ui/biome.json (optional, only if overrides needed)
{
  "extends": ["../../biome.json"],
  "files": {
    "include": ["src/**/*.ts", "src/**/*.tsx"]
  }
}
```

### Husky Integration

The project uses husky with simple hooks:

```bash
# .husky/pre-commit (current)
make lint

# .husky/pre-push (current)
make typecheck
```

**No changes needed to husky hooks.** Just update the Makefile targets to include UI:

```makefile
# Makefile updates
.PHONY: lint
lint: ## Lint all packages
	bunx biome check packages/ apps/

.PHONY: typecheck
typecheck: ## Typecheck all packages
	bunx turbo run typecheck
```

The existing `make lint` and `make typecheck` will automatically include UI once it's in `apps/`.

### Single Server: API + UI (Hono)

**Goal:** One entry point serves everything.

```
omni.namastex.ai/           → UI (React SPA)
omni.namastex.ai/api/v2/*   → API routes
```

```typescript
// packages/api/src/app.ts
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { existsSync } from 'fs';

const app = new Hono();

// ============================================
// 1. API Routes (must come FIRST - more specific)
// ============================================
app.route('/api/v2', apiRouter);

// ============================================
// 2. UI Static Files (production only)
// ============================================
const uiDistPath = './apps/ui/dist';
const serveUI = existsSync(uiDistPath);

if (serveUI) {
  // Serve static assets (JS, CSS, images)
  app.use('*', serveStatic({
    root: uiDistPath,
    // Only serve if file exists, otherwise fall through
    onNotFound: (path, c) => {
      // Let SPA fallback handle it
    }
  }));

  // SPA fallback - all non-API routes serve index.html
  // This enables client-side routing (/instances, /chats, etc.)
  app.get('*', (c) => {
    // Don't catch API routes
    if (c.req.path.startsWith('/api')) {
      return c.notFound();
    }
    return c.html(Bun.file(`${uiDistPath}/index.html`));
  });
}

export default app;
```

**Why this pattern:**
- Single deployment (one process, one port)
- No CORS issues (same origin)
- Simple infrastructure
- Hono's `serveStatic` is optimized for Bun

**Route priority:**
1. `/api/v2/*` → API handlers
2. `/assets/*` → Static files (if exists)
3. `/*` → `index.html` (SPA routing)

**Development vs Production:**

| Mode | UI | API |
|------|-----|-----|
| Dev | Vite on :5173 (proxies /api to :8882) | Hono on :8882 |
| Prod | Hono serves dist/ | Hono on :8882 |

### Makefile Targets

```makefile
# Add to Makefile

# UI Development
.PHONY: dev-ui
dev-ui: ## Start UI development server
	cd apps/ui && bun run dev

.PHONY: build-ui
build-ui: ## Build UI for production
	cd apps/ui && bun run build

.PHONY: lint-ui
lint-ui: ## Lint UI package
	cd apps/ui && bun run lint

.PHONY: typecheck-ui
typecheck-ui: ## Typecheck UI package
	cd apps/ui && bun run typecheck

# Update existing targets to include UI
.PHONY: build
build: build-ui ## Build all packages including UI
	turbo run build

.PHONY: lint
lint: lint-ui ## Lint all packages including UI
	turbo run lint
```

---

## Execution Group A: Package Structure

**Goal:** Create `apps/ui` as a workspace package.

**Deliverables:**
- [ ] Create `apps/` directory
- [ ] Create `apps/ui/` with package.json
- [ ] Update root package.json workspaces
- [ ] Verify `bun install` works from root
- [ ] Create basic index.html and main.tsx

**Acceptance Criteria:**
- [ ] `bun install` installs UI dependencies
- [ ] UI is recognized as workspace package
- [ ] Can import `@omni/sdk` from UI

---

## Execution Group B: Vite + React

**Goal:** Working Vite dev server with React.

**Deliverables:**
- [ ] Configure vite.config.ts
- [ ] Setup React 18 entry point
- [ ] Configure path aliases
- [ ] Setup dev proxy to API
- [ ] Basic App.tsx with "Hello World"

**Acceptance Criteria:**
- [ ] `bun run dev` starts on port 5173
- [ ] React renders correctly
- [ ] API proxy works (/api/* → localhost:8882)

---

## Execution Group C: Tailwind v4

**Goal:** Tailwind v4 with CSS-first config.

**Deliverables:**
- [ ] Install tailwindcss v4
- [ ] Create index.css with @theme
- [ ] Setup design tokens (colors, radius, fonts)
- [ ] Dark mode support
- [ ] Verify utility classes work

**Acceptance Criteria:**
- [ ] Tailwind classes render correctly
- [ ] Design tokens accessible via CSS variables
- [ ] Dark mode toggles properly

---

## Execution Group D: Biome + Hooks

**Goal:** Linting and quality gates.

**Deliverables:**
- [ ] Biome configuration (extend root or UI-specific)
- [ ] Update Makefile lint/typecheck to include `apps/`
- [ ] Verify lint catches errors
- [ ] Verify typecheck works

**Acceptance Criteria:**
- [ ] `bun run lint` works in UI package
- [ ] `bun run typecheck` works in UI package
- [ ] `make lint` includes UI (husky pre-commit)
- [ ] `make typecheck` includes UI (husky pre-push)

---

## Execution Group E: Production Build

**Goal:** API serves built UI in production.

**Deliverables:**
- [ ] Vite production build works
- [ ] Add static serving to API
- [ ] SPA fallback for routing
- [ ] Add Makefile targets
- [ ] Test production mode

**Acceptance Criteria:**
- [ ] `bun run build` creates dist/
- [ ] API serves UI at root path
- [ ] Client-side routing works
- [ ] `make build-ui` works

---

## Success Criteria

- [ ] `bun install` works from root
- [ ] `make dev-ui` starts UI dev server
- [ ] `make build-ui` creates production build
- [ ] API serves UI in production mode
- [ ] Tailwind v4 classes work
- [ ] Biome linting works
- [ ] Husky hooks include UI in lint/typecheck
- [ ] Can import and use `@omni/sdk`

---

## Dependencies

- Bun workspace support (exists)
- `@omni/sdk` package (exists)
- husky (exists in project)

## Enables

- **UI Foundation** wish - provides the infrastructure
- All future UI development
- Production deployments

---

## shadcn/ui Note

shadcn/ui may need adaptation for Tailwind v4. Options:

1. **Wait for official v4 support** - shadcn is actively updating
2. **Use compatibility layer** - CSS variable mapping
3. **Manual component updates** - Adjust as we add components

This will be handled in UI Foundation wish when adding components.
