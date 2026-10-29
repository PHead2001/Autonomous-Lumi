import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import { Simulation } from './simulation.js';
import type { ServerMessage } from '../shared/protocol.js';

export function createWorldServer() {
  const simulation = new Simulation();
  const root = resolve('dist');
  const server = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ worldId: simulation.state.worldId, time: simulation.state.time, tick: simulation.state.tick, viewers: sockets.clients.size }));
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404).end('Viewer not built. Run npm run build, or use npm run dev.'); }
  });
  const sockets = new WebSocketServer({ server, path: '/world', maxPayload: 1024 });
  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 64_000) socket.send(JSON.stringify(message));
  };
  const broadcast = (message: ServerMessage) => { for (const socket of sockets.clients) send(socket, message); };
  sockets.on('connection', socket => {
    send(socket, { type: 'state', state: simulation.snapshot() });
    socket.on('error', () => { /* A viewer failure does not stop the world. */ });
    socket.on('message', data => {
      try {
        const command: unknown = JSON.parse(data.toString());
        if (typeof command !== 'object' || command === null || !('type' in command) || command.type !== 'slam') return;
        const event = simulation.slamDoor();
        if (event) broadcast({ type: 'sound', event, state: simulation.snapshot() });
      } catch { /* Ignore malformed viewer input. */ }
    });
  });
  // Created once with the server, never from a connection callback.
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    simulation.update((now - last) / 1000);
    last = now;
    broadcast({ type: 'state', state: simulation.snapshot() });
  }, 1000 / 30);
  return {
    server, simulation, sockets,
    listen: (port = 3001) => new Promise<number>((resolvePort, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        const address = server.address();
        resolvePort(typeof address === 'object' && address ? address.port : port);
      });
    }),
    close: () => new Promise<void>((resolveClose, reject) => {
      clearInterval(timer);
      for (const client of sockets.clients) client.terminate();
      sockets.close(() => server.close(error => error ? reject(error) : resolveClose()));
    }),
  };
}
