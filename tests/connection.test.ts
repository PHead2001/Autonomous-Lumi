import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { WebSocket } from 'ws';
import { createWorldServer, type WorldServerOptions } from '../server/world-server.js';
import type { ServerMessage, WorldState } from '../shared/protocol.js';
async function testServer(options: WorldServerOptions = {}) {
  const prefix = join(tmpdir(), 'lumi-connection-'), directory = await mkdtemp(prefix);
  const app = createWorldServer({ ...options, diagnosticsDirectory: directory });
  const close = app.close;
  app.close = async () => {
    await close();
    const target = resolve(directory), allowed = resolve(tmpdir()) + sep;
    if (!target.startsWith(allowed) || !target.startsWith(resolve(prefix))) throw new Error('Unexpected test directory');
    await rm(target, { recursive: true, force: true });
  };
  return app;
}
async function viewer(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/world`), first = once(socket, 'message');
  await once(socket, 'open'); const [data] = await first;
  return { socket, state: (JSON.parse(data.toString()) as ServerMessage).state };
}
test('real timer advances with zero viewers; reconnect receives same current world', { timeout: 5000 }, async () => {
  const app = await testServer({physiology:{active:false}}), port = await app.listen(0);
  try {
    const first = await viewer(port), before = first.state;
    const serverSocket = [...app.sockets.clients][0], serverClosed = once(serverSocket, 'close');
    first.socket.close(); await serverClosed; assert.equal(app.sockets.clients.size, 0);
    await delay(180); const during = app.simulation.snapshot();
    assert.ok(during.tick > before.tick && during.time > before.time);
    assert.notEqual(during.character.z, before.character.z); assert.equal(app.sockets.clients.size, 0);
    await delay(180); assert.ok(app.simulation.state.tick > during.tick);
    const second = await viewer(port); assert.equal(second.state.worldId, before.worldId);
    assert.ok(second.state.time >= during.time && second.state.tick > during.tick);
    second.socket.close(); await once(second.socket, 'close');
  } finally { await app.close(); }
});
test('slam reaches multiple clients; malformed commands do not reset world', { timeout: 5000 }, async () => {
  const app = await testServer(), port = await app.listen(0);
  try {
    const a = await viewer(port), b = await viewer(port);
    const sound = (socket: WebSocket) => new Promise<WorldState>(resolve => socket.on('message', data => {
      const message = JSON.parse(data.toString()) as ServerMessage; if (message.type === 'sound') resolve(message.state);
    }));
    const heardA = sound(a.socket), heardB = sound(b.socket);
    a.socket.send('{broken'); a.socket.send(JSON.stringify({ type: 'set-position', x: 100 }));
    a.socket.send(JSON.stringify({ type: 'slam' }));
    const [stateA, stateB] = await Promise.all([heardA, heardB]);
    assert.equal(stateA.worldId, a.state.worldId); assert.equal(stateA.door.slamCount, 1);
    assert.equal(stateB.reflex.start, stateA.door.lastSlam);
    assert.ok(stateB.reflex.strength>0&&stateB.reflex.strength<1,'normal slam retains an immediate received-intensity reflex');assert.equal(stateB.reflex.strength,stateA.reflex.strength);
  } finally { await app.close(); }
});

test('injected host suspend freezes zero-viewer world, resumes and reconnects without reset', { timeout: 5000 }, async () => {
  let now = 0;
  const app = await testServer({ autoSchedule: false, clock: { monotonicMs: () => now, utcMs: () => 1700000000000 + now } }), port = await app.listen(0);
  try {
    const first = await viewer(port), closed = once([...app.sockets.clients][0], 'close'); first.socket.close(); await closed;
    now = 100; app.scheduler.pump(); const before = app.simulation.checkpoint();
    now += 8 * 3600000; assert.equal(app.scheduler.pump(), 0); assert.equal(app.simulation.state.tick, before.tick);
    assert.equal(app.sockets.clients.size, 0); now += 100; app.scheduler.pump();
    assert.equal(app.simulation.state.tick, before.tick + 3);
    const restored = await viewer(port); assert.equal(restored.state.worldId, first.state.worldId); assert.equal(restored.state.runId, first.state.runId);
    assert.equal(restored.state.tick, before.tick + 3); restored.socket.close(); await once(restored.socket, 'close');
  } finally { await app.close(); }
});
