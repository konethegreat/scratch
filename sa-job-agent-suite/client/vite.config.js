import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  // Relative base so built assets (images, CSS, JS) resolve under Electron's
  // file:// protocol in the packaged app, not just http:// in dev.
  base: './',
  plugins: [react()],
  // Ensure a single React instance. Pre-bundle every React entry point in one
  // optimize pass so react and react-dom can't end up on mismatched generations
  // (the cause of the "Invalid hook call / Cannot read useState of null" crash),
  // and dedupe in case workspace hoisting ever resolves two copies.
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 4173,
    strictPort: false
  }
});
