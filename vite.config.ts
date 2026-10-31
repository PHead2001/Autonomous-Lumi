import { defineConfig } from 'vite';
// Keep the browser's Host aligned with Origin. Visit requires an exact match;
// Vite's shorthand string proxy would rewrite Host to the backend port.
export default defineConfig({ server: { port: 5173, strictPort: true, proxy: {
  '/visit': { target: 'ws://127.0.0.1:3001', ws: true, changeOrigin: false },
  '/world': { target: 'ws://127.0.0.1:3001', ws: true, changeOrigin: false },
  '/health': { target: 'http://127.0.0.1:3001', changeOrigin: false },
  '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false },
} } });
