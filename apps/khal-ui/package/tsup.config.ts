import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  // The KHAL runtime injects ONLY React and the @khal-os/* packages. Everything
  // else the pack needs is bundled so the pack is self-contained when embedded:
  // the data layer (@omni/sdk), the router (react-router-dom), the query cache
  // (@tanstack/react-query), and any zod runtime. tsup externalizes package.json
  // `dependencies` by default, so these are force-bundled via `noExternal`.
  external: ['react', 'react-dom', 'react/jsx-runtime', /^@khal-os\//],
  // Regex for react-router* so subpath specifiers (e.g. `react-router/dom`,
  // which react-router-dom re-exports from) are bundled too, not just the
  // package entry.
  noExternal: ['@omni/sdk', /^react-router/, '@tanstack/react-query', 'zod'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
