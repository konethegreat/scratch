import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  // Relative base so built assets (images, CSS, JS) resolve under Electron's
  // file:// protocol in the packaged app, not just http:// in dev.
  base: './',
  define: {
    // Compile-time switch. `vite build --mode web` is the only way to set it;
    // the Electron/desktop build leaves it false.
    __SAJAS_WEB__: JSON.stringify(mode === 'web')
  },
  plugins: [react()],
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
}));
