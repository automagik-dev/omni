# @omni/ui

Omni Dashboard - React UI for the Universal Event-Driven Omnichannel Platform.

## Development

```bash
# Start dev server (Vite on :5173)
make dev-ui

# Or from this directory
bun run dev
```

The dev server proxies `/api/*` requests to the API at `localhost:8882`.

## Building

```bash
# Production build
make build-ui

# Or from this directory
bun run build
```

## Production

In production, the API serves the built UI:

1. Build: `make build-ui`
2. Start API: The API automatically serves `apps/ui/dist/` at the root path

## Stack

- **React 18** - UI framework
- **Vite** - Build tool
- **Tailwind v4** - CSS framework (CSS-first config)
- **TypeScript** - Type safety
- **Biome** - Linting and formatting
- **@omni/sdk** - API client

## Scripts

| Script | Description |
|--------|-------------|
| `dev` | Start Vite dev server |
| `build` | Build for production |
| `preview` | Preview production build |
| `typecheck` | TypeScript check |
| `lint` | Run Biome linter |
| `lint:fix` | Auto-fix lint issues |
