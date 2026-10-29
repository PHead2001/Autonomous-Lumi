import test from 'node:test';
import assert from 'node:assert/strict';
import { LabSimulation, VisionSimulation, validateCheckpoint, type CheckpointV2 } from '../server/simulation.js';
import { BranchRuntime } from '../server/branch-runtime.js';
import { AVATAR_RIG } from '../shared/avatar-rig.js';
import { assertCameraClearance, eyePose } from '../shared/eye-pose.js';
import { canMoveCharacter, canOccupyCharacter, physicalSceneSnapshot } from '../shared/physical-scene.js';
import { HEAD_LIMITS } from '../shared/vision-protocol.js';
import { createVisibilityFixture } from '../shared/vision-fixture.js';
import { groundSnapshot, isTargetEligible } from '../server/vision/grounding.js';
import { createPhysicalRenderScene } from '../src/render-scene.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('fixture wandering keeps every permitted head direction clear through tick 563 and subsequent routes', () => {
  const simulation = new VisionSimulation({ mode: 'EXPERIMENT', seed: 1 });
  // The initial spawn is too close to a new test prop for the full head envelope;
  // wait until normal walking reaches a safe configuration-admission point.
  for (let i = 0; i < 60; i++) simulation.step();
  simulation.enqueue({ type: 'configure_scene', illumination: 1, fixture: 'visibility', fixtureColor: '#ed6050', doorOpenRadians: null });
  assert.ok(simulation.step().some(event => event.type === 'SCENE_CONFIGURED'));
  const initial = simulation.snapshot().character;
  let moved = 0, blocked = 0, sawReportedTick = false;
  for (let i = 0; i < 3000; i++) {
    if (i % 100 === 0) simulation.enqueue({ type: 'turn_head', yawDelta: i % 200 ? -2 : 2, pitchDelta: i % 200 ? -1 : 1, sceneRevision: simulation.snapshot().scene!.revision });
    const events = simulation.step(), state = simulation.snapshot();
    if (state.character.moving) moved++;
    blocked += events.filter(event => event.type === 'MOVEMENT_BLOCKED').length;
    if (state.tick === 563) sawReportedTick = true;
    assertCameraClearance(state);
    if (i % 30 === 0 || state.tick === 563) {
      for (const yaw of [HEAD_LIMITS.minYaw, 0, HEAD_LIMITS.maxYaw]) for (const pitch of [HEAD_LIMITS.minPitch, 0, HEAD_LIMITS.maxPitch]) {
        const turn = structuredClone(state); turn.head!.yaw = yaw; turn.head!.pitch = pitch;
        assertCameraClearance(turn);
        const eye = eyePose(turn).position;
        for (const box of physicalSceneSnapshot(turn).boxes.filter(box => box.occludes)) {
          const dx = eye[0] - box.position[0], dz = eye[2] - box.position[2];
          const x = dx * Math.cos(box.yaw) - dz * Math.sin(box.yaw), z = dx * Math.sin(box.yaw) + dz * Math.cos(box.yaw);
          assert.ok(Math.abs(x) > box.size[0] / 2 || Math.abs(eye[1] - box.position[1]) > box.size[1] / 2 || Math.abs(z) > box.size[2] / 2, `eye inside ${box.id} at tick ${state.tick}`);
        }
      }
    }
  }
  assert.ok(sawReportedTick); assert.ok(moved > 300, 'walking continues between blocked waypoints'); assert.ok(blocked > 0);
  assert.notDeepEqual(simulation.snapshot().character, initial);
});

test('scene and checkpoint admission reject the old body-clear but eye-inside fixture pose', () => {
  const simulation = new VisionSimulation({ mode: 'EXPERIMENT' }), cp = simulation.checkpoint();
  cp.character = { x: 2.1, z: 1.6, heading: -Math.PI / 2, moving: false, gait: 0 };
  const before = new VisionSimulation({ mode: 'EXPERIMENT', checkpoint: cp });
  before.enqueue({ type: 'configure_scene', illumination: 1, fixture: 'visibility', fixtureColor: '#ed6050', doorOpenRadians: null });
  assert.ok(before.step().some(event => event.data.reason === 'fixture_overlaps_character'));
  cp.scene.fixture = 'visibility'; assert.throws(() => validateCheckpoint(cp), /overlaps physical collider/);
  const invalid = createVisibilityFixture(); invalid.character = { ...cp.character };
  assert.throws(() => groundSnapshot(invalid), /Camera clipping volume/);
  assert.throws(() => createPhysicalRenderScene(invalid, { firstPerson: true }), /Camera clipping volume/);
  assert.equal(isTargetEligible(invalid, 'fixture-partial'), false);
});

test('normal slam navigation reserve prevents clipping at every door age; actual unsafe captures fail closed', () => {
  const state = createVisibilityFixture(); state.scene!.fixture = 'none';
  Object.assign(state.character, { x: 3.2, z: -2.3, heading: Math.PI - 0.5 });
  state.time = 10; state.door.lastSlam = -100;
  assert.doesNotThrow(() => assertCameraClearance(state));
  assert.equal(canOccupyCharacter(state.scene!, state.character.x, state.character.z), false, 'future sweep is reserved before the slam');
  state.door.lastSlam = state.time;
  assert.throws(() => groundSnapshot(state), /Camera clipping volume/, 'actual posed door clips this externally supplied near-plane volume');
  const ordinary = new VisionSimulation({ mode: 'LIVE' });
  for (let i = 0; i < 900; i++) {
    if (i % 120 === 0) ordinary.enqueue({ type: 'slam' });
    ordinary.step(); assertCameraClearance(ordinary.snapshot());
  }
});

test('unusual restored lens settings cannot expose geometry through a clipped near plane', () => {
  const state = createVisibilityFixture(); state.scene!.fixture = 'none';
  state.head!.camera = { ...state.head!.camera, near: 1, horizontalFovDegrees: 120, width: 128, height: 1024 };
  // The eye itself is in free space, but the very large near plane intersects walls.
  assert.ok(eyePose(state).position[1] > AVATAR_RIG.headPivot[1]);
  assert.throws(() => groundSnapshot(state), /Camera clipping volume/);
  assert.equal(isTargetEligible(state, 'door-leaf'), false);
});

test('V2 migration preserves near-door saved pose/history and escapes the new reserve without a teleport', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lumi-clearance-migration-'));
  const legacySimulation = new LabSimulation({ mode: 'LIVE', seed: 27 }).checkpoint() as CheckpointV2;
  legacySimulation.character = { x: 3.2, z: -2.3, heading: Math.PI - 0.5, moving: true, gait: 0 };
  const template = new BranchRuntime({ worldId: 'migration', branchId: 'live', mode: 'LIVE', offline: true }).checkpoint();
  const legacy = { ...template, schemaVersion: 1 as const, simulation: legacySimulation };
  const runtime = new BranchRuntime({ worldId: 'migration', branchId: 'live', mode: 'LIVE', checkpoint: legacy, historyId: 'preserved-history', directory });
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  const migrated = runtime.simulation.checkpoint();
  assert.equal(runtime.summary().historyId, 'preserved-history'); assert.equal(migrated.tick, legacySimulation.tick);
  assert.deepEqual(migrated.character, legacySimulation.character);
  assert.equal(canOccupyCharacter(runtime.viewerState().scene!, migrated.character.x, migrated.character.z), false);
  assert.doesNotThrow(() => validateCheckpoint(migrated));
  assert.equal(canMoveCharacter(runtime.viewerState().scene!, 3.2, -2.3, 3.2, -2.29), true);
  assert.equal(canMoveCharacter(runtime.viewerState().scene!, 3.2, -2.3, 3.2, -2.31), false);
  let escaped = false;
  for (let i = 0; i < 250; i++) {
    const previous = runtime.viewerState().character; runtime.simulation.step();
    const checkpoint = runtime.simulation.checkpoint(), current = runtime.viewerState();
    assert.doesNotThrow(() => validateCheckpoint(checkpoint));
    assert.ok(Math.hypot(current.character.x - previous.x, current.character.z - previous.z) <= 0.75 / 30 + 1e-12);
    escaped ||= canOccupyCharacter(current.scene!, current.character.x, current.character.z);
  }
  assert.ok(escaped); assert.equal(runtime.summary().historyId, 'preserved-history');
});
