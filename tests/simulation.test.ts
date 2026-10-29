import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, reflexStrength } from '../server/simulation.js';
import { ROOM, earFlick } from '../shared/protocol.js';
test('wandering moves, idles, resumes and stays within room bounds', () => {
  const world = new Simulation(), initial = world.snapshot(); let idle = false, resumed = false;
  for (let i = 0; i < 3600; i++) {
    world.update(1 / 30); const c = world.state.character;
    assert.ok(Math.abs(c.x) <= ROOM.walkX && Math.abs(c.z) <= ROOM.walkZ);
    if (!c.moving) idle = true; if (idle && c.moving) resumed = true;
  }
  assert.notDeepEqual(world.state.character, initial.character); assert.ok(idle && resumed);
});
test('sudden loud sound triggers the reflex and ears settle', () => {
  const world = new Simulation(); world.update(1);
  world.hear({ id: 1, time: 1, intensity: 0.9, suddenness: 0.95, x: 0, z: 0 });
  assert.equal(world.state.reflex.start, 1); assert.ok(earFlick(1.07, world.state.reflex) > 0.4);
  assert.equal(earFlick(2, world.state.reflex), 0);
});
test('quiet and gradual sounds do not trigger the reflex', () => {
  const world = new Simulation();
  for (const [intensity, suddenness] of [[0.2, 1], [1, 0.2], [0, 0]]) {
    assert.equal(reflexStrength({ intensity, suddenness }), 0);
    world.hear({ id: 1, time: 0, intensity, suddenness, x: 0, z: 0 });
  }
  assert.equal(world.state.reflex.start, -100);
});
test('door emits acoustic event and immediately changes authoritative reflex state', () => {
  const world = new Simulation(); world.update(2); const event = world.slamDoor(); assert.ok(event);
  assert.equal(event.time, world.state.reflex.start); assert.equal(world.state.door.slamCount, 1);
  assert.equal(world.slamDoor(), null); world.update(1); assert.ok(world.slamDoor());
});
