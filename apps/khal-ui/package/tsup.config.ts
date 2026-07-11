import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  // React and the KHAL host packages are provided by the KHAL runtime; @omni/sdk
  // is bundled so the pack carries its own typed data layer.
  external: ['react', 'react-dom', /^@khal-os\//],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
