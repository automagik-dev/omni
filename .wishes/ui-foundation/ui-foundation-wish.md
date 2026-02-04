# WISH: UI Foundation

**Status:** DRAFT
**Beads:** omni-0yx
**Priority:** P1
**Depends On:** v1-api-wrapper

## Context

Omni v1 has a functional React dashboard that provides instance management, chat viewing, settings, batch jobs, and more. Rather than building from scratch, we should copy the v1 UI and adapt it to work with the v2 API.

**V1 UI Location:** `/home/cezar/dev/omni/resources/ui/`

**V1 UI Stack:**
- React + TypeScript
- Vite (build tool)
- Tailwind CSS
- shadcn/ui components
- TanStack Query (React Query)
- React Router v6

## Problem Statement

V2 has no UI. Users cannot:
- Manage instances visually
- View chats and messages
- Configure settings
- Monitor batch jobs
- See contact information

## Scope

### IN SCOPE

1. **Copy V1 UI Structure**
   - Copy `resources/ui/` to `apps/ui/`
   - Update dependencies to latest versions
   - Configure for v2 project structure

2. **Adapt API Client**
   - Update API base URL configuration
   - Use v1 compatibility endpoints initially
   - Maintain existing API client patterns

3. **Core Pages**
   - Dashboard
   - Instances (list, create, settings)
   - Chats (list, view, message bubble)
   - Contacts
   - Settings
   - Batch Jobs
   - Access Rules

4. **Authentication**
   - API key-based auth (same as v1)
   - Login page
   - Auth state management

5. **Build Integration**
   - Vite configuration
   - Production build
   - Static file serving from API

### OUT OF SCOPE

- New features not in v1
- Complete UI redesign
- Real-time WebSocket updates (use polling initially)
- Mobile responsive improvements

## Technical Design

### Directory Structure

```
apps/
└── ui/
    ├── src/
    │   ├── components/
    │   │   ├── chat/
    │   │   │   ├── ChatInput.tsx
    │   │   │   ├── ChatView.tsx
    │   │   │   ├── ChatList.tsx
    │   │   │   ├── ChatListItem.tsx
    │   │   │   └── MessageBubble.tsx
    │   │   ├── instances/
    │   │   ├── settings/
    │   │   └── ui/  # shadcn components
    │   ├── pages/
    │   │   ├── Dashboard.tsx
    │   │   ├── Instances.tsx
    │   │   ├── InstanceSettings.tsx
    │   │   ├── Chats.tsx
    │   │   ├── Contacts.tsx
    │   │   ├── Settings.tsx
    │   │   ├── BatchJobs.tsx
    │   │   ├── AccessRules.tsx
    │   │   └── Login.tsx
    │   ├── lib/
    │   │   ├── api.ts  # API client
    │   │   └── types.ts  # Type definitions
    │   ├── hooks/
    │   ├── App.tsx
    │   └── main.tsx
    ├── public/
    ├── index.html
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── tsconfig.json
    └── package.json
```

### API Client Updates

```typescript
// apps/ui/src/lib/api.ts

// Update base URL to use v2 server with v1 compat layer
const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

// Existing API functions should work as-is with v1 compat endpoints
export async function getInstances(): Promise<Instance[]> {
  const response = await fetch(`${API_BASE}/instances`, {
    headers: getAuthHeaders(),
  });
  return response.json();
}

// Later: Gradually migrate to v2 native endpoints
// export async function getInstancesV2(): Promise<Instance[]> {
//   const response = await fetch(`/trpc/instances.list`, ...);
// }
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
    proxy: {
      '/api': {
        target: 'http://localhost:3000', // v2 API server
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

### Package.json Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "biome lint src/",
    "typecheck": "tsc --noEmit"
  }
}
```

## Implementation Groups

### Group 1: Setup
- [ ] Create `apps/ui/` directory
- [ ] Copy v1 UI source files
- [ ] Update package.json dependencies
- [ ] Configure Vite for v2

### Group 2: API Integration
- [ ] Update API client base URL
- [ ] Test with v1 compat endpoints
- [ ] Verify auth flow works

### Group 3: Core Pages
- [ ] Verify Dashboard works
- [ ] Verify Instances pages work
- [ ] Verify Chats page works
- [ ] Verify Settings page works

### Group 4: Build & Deploy
- [ ] Configure production build
- [ ] Add static file serving to v2 API
- [ ] Update Makefile with UI commands

### Group 5: Testing
- [ ] Manual testing of all pages
- [ ] Fix any compatibility issues
- [ ] Document known limitations

## Success Criteria

- [ ] UI builds successfully
- [ ] UI can authenticate with v2 backend
- [ ] Instance management works
- [ ] Chat viewing works
- [ ] Settings can be modified
- [ ] Batch jobs page works

## Dependencies

- `v1-api-wrapper` wish (for API compatibility)

## V1 Files to Copy

**Key directories:**
- `src/components/` - All React components
- `src/pages/` - All page components
- `src/lib/` - API client and types
- `src/hooks/` - Custom hooks
- `public/` - Static assets

**Key files:**
- `vite.config.ts`
- `tailwind.config.js`
- `tsconfig.json`
- `postcss.config.js`
- `components.json` (shadcn config)

## Migration Path

1. **Phase 1 (this wish):** Copy v1 UI, use v1 compat endpoints
2. **Phase 2 (future):** Gradually migrate to v2 native endpoints
3. **Phase 3 (future):** Add new v2-specific features
4. **Phase 4 (future):** Remove v1 compat layer when UI fully migrated
