import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Simulation, normalizeCommand, type DeterministicEvent } from './simulation.js';
import { FixedScheduler, type HostClock, type SchedulerConfig } from './scheduler.js';
import { FlightRecorder } from './diagnostics/recorder.js';
import type { AcousticEvent, ServerMessage } from '../shared/protocol.js';

export interface WorldServerOptions { seed?: number; checkpoint?: unknown; diagnosticsDirectory?: string; clock?: HostClock; schedulerConfig?: Partial<SchedulerConfig>; autoSchedule?: boolean }
export function createWorldServer(options: WorldServerOptions = {}) {
  const worldId = randomUUID(), runId = randomUUID();
  const simulation = new Simulation({ seed: options.seed, checkpoint: options.checkpoint, worldId, runId });
  const hz = simulation.checkpoint().config.hz;
  const recorder = new FlightRecorder({ directory: options.diagnosticsDirectory, worldId, runId, hz, now: options.clock ? () => options.clock!.utcMs() : undefined });
  recorder.captureCheckpoint(simulation.checkpoint());
  const root = resolve('dist');
  const server = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ worldId, runId, time: simulation.state.time, tick: simulation.state.tick, viewers: sockets.clients.size, scheduler: scheduler.config, logging: recorder.health() })); return;
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      const types: Record<string,string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }); res.end(body);
    } catch { res.writeHead(404).end('Viewer not built. Run npm run build, or use npm run dev.'); }
  });
  const sockets = new WebSocketServer({ server, path: '/world', maxPayload: 1024 });
  const send = (socket: WebSocket, message: ServerMessage): boolean => {
    if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount >= 64_000) return false;
    try { socket.send(JSON.stringify(message), () => {}); return true; } catch { return false; }
  };
  function operational(eventType: string, outcome: string, data: Record<string, number|string|boolean> = {}, parentSequence?: number, inputSequence?: number) {
    recorder.record({ tick: simulation.state.tick, category: 'OPERATIONAL_REPLAY', eventType, component: 'transport', outcome, data, ...(parentSequence === undefined ? {} : { parentSequence }), ...(inputSequence === undefined ? {} : { inputSequence }) });
  }
  const observe = (events: DeterministicEvent[]) => {
    // step() completed authoritative changes before any transport side effects.
    for (const event of events) recorder.recordEvent(event);
    for (const event of events) {
      if (event.type !== 'ACOUSTIC_EVENT') continue;
      let queued = 0;
      for (const socket of sockets.clients) if (send(socket, { type: 'sound', event: event.data as unknown as AcousticEvent, state: simulation.snapshot() })) queued++;
      const reflex = events.find(candidate => candidate.type === 'REFLEX_STATE' && candidate.inputSequence === event.inputSequence);
      operational('VIEWER_NOTIFICATION', queued ? 'queued' : 'no_viewers_or_backpressure', { queuedViewers: queued, connectedViewers: sockets.clients.size, displayed: 'unavailable', audioPlayed: 'unavailable' }, reflex?.sequence ?? event.sequence, event.inputSequence);
    }
  };
  sockets.on('connection', socket => {
    send(socket, { type: 'state', state: simulation.snapshot() }); operational('VIEWER_CONNECTED', 'state_queued', { viewers: sockets.clients.size });
    socket.on('error', () => {});
    socket.on('close', () => operational('VIEWER_DISCONNECTED', 'closed', { viewers: sockets.clients.size }));
    socket.on('message', data => {
      const accepted = simulation.enqueue(normalizeCommand(data.toString()));
      recorder.recordInput(accepted.input); observe(accepted.events);
    });
  });
  let lastCheckpointTick = simulation.state.tick;
  const scheduler = new FixedScheduler(() => {
    observe(simulation.step());
    for (const socket of sockets.clients) send(socket, { type: 'state', state: simulation.snapshot() });
    if (simulation.state.tick - lastCheckpointTick >= hz * 30) {
      recorder.captureCheckpoint(simulation.checkpoint()); lastCheckpointTick = simulation.state.tick;
    }
  }, event => recorder.record({ tick: simulation.state.tick, category: 'OPERATIONAL_REPLAY', eventType: event.type, component: 'scheduler', severity: 'warn', outcome: event.type === 'HOST_RESUME' ? 'resumed_without_catchup' : 'observed', data: event.data }), options.clock, { ...options.schedulerConfig, hz });
  const timer = options.autoSchedule === false ? undefined : setInterval(() => scheduler.pump(), 1000 / hz);
  let closing: Promise<void> | undefined;
  return {
    server, simulation, sockets, scheduler, recorder,
    listen: (port = 3001) => new Promise<number>((resolvePort,reject) => {
      server.once('error', reject); server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject); const address = server.address(); resolvePort(typeof address === 'object' && address ? address.port : port);
      });
    }),
    close: () => closing ??= new Promise<void>((resolveClose,reject) => {
      clearInterval(timer); for (const client of sockets.clients) client.terminate();
      sockets.close(() => server.close(error => {
        recorder.captureCheckpoint(simulation.checkpoint());
        void recorder.close().then(() => error ? reject(error) : resolveClose(), reject);
      }));
    }),
  };
}
