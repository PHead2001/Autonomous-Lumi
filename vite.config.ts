import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 5173, strictPort: true, proxy: { '/visit': { target: 'ws://127.0.0.1:3001', ws: true }, '/world': { target: 'ws://127.0.0.1:3001', ws: true }, '/health': 'http://127.0.0.1:3001', '/api': 'http://127.0.0.1:3001' } } });
