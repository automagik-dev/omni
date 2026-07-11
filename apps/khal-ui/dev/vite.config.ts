import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Resolve workspace packages by name to their TS source, so the harness gets HMR
// on the real code without a build step (@omni/sdk otherwise resolves to unbuilt dist).
const packSrc = fileURLToPath(new URL('../package/src/index.ts', import.meta.url));
const sdkSrc = fileURLToPath(new URL('../../../packages/sdk/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@omni/khal-ui-pack': packSrc,
      '@omni/sdk': sdkSrc,
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    open: false,
    proxy: {
      // Forward the SDK/UI data path to the BFF. `ws:false` + streaming
      // response keep Server-Sent-Events unbuffered (BFF sets no idle timeout).
      '/omni': {
        target: 'http://127.0.0.1:8899',
        changeOrigin: true,
        ws: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // Ask upstream for identity encoding so SSE frames flush immediately.
            proxyReq.setHeader('accept-encoding', 'identity');
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
