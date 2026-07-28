import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // Override when the API runs on a non-default port (e.g. 8882 taken).
        target: process.env.OMNI_API_PROXY_TARGET || 'http://localhost:8882',
        changeOrigin: true,
        configure: (proxy) => {
          // Fix ERR_CONTENT_DECODING_FAILED by removing accept-encoding
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('accept-encoding');
          });
        },
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
