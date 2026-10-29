import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { eyePose } from '../shared/eye-pose.js';
import { createVisibilityFixture } from '../shared/vision-fixture.js';
import { physicalSceneSnapshot, canOccupyCharacter, validatePhysicalSceneState, defaultPhysicalSceneState } from '../shared/physical-scene.js';
import { groundSnapshot, filterVisibleGrounding, rayBoxDistance, isTargetEligible } from '../server/vision/grounding.js';
import { createPhysicalRenderScene } from '../src/render-scene.js';

test('same physical scene distinguishes ahead, center-blocked partial, hidden wall, FOV and tiny shapes', () => {
  const state = createVisibilityFixture(), result = groundSnapshot(state), byId = new Map(result.objects.map(o => [o.id, o]));
  assert.equal(byId.get('fixture-ahead')?.status, 'visible');
  const partial = byId.get('fixture-partial')!;
  assert.equal(partial.status, 'partially_occluded'); assert.ok(partial.visibleSamples > 0 && partial.visibleSamples < 27);
  assert.equal(byId.get('fixture-behind-wall')?.status, 'fully_occluded');
  assert.equal(byId.get('fixture-outside-fov')?.status, 'outside_frustum');
  assert.equal(byId.get('fixture-small')?.status, 'poor_observability');
  const scene = physicalSceneSnapshot(state), blocker = scene.boxes.find(b => b.id === 'fixture-screen')!, target = scene.boxes.find(b => b.id === 'fixture-partial')!;
  const origin = result.camera.position, delta = target.position.map((v, i) => v - origin[i]) as [number, number, number], distance = Math.hypot(...delta);
  assert.notEqual(rayBoxDistance(origin, delta.map(v => v / distance) as [number, number, number], blocker, distance), null, 'center ray is blocked but the whole target is not hidden');
  assert.ok(isTargetEligible(state, 'fixture-partial')); assert.ok(!isTargetEligible(state, 'fixture-behind-wall'));
});

test('filtered grounding only includes eligible unknown shapes and opaque handles', () => {
  const privateResult = groundSnapshot(createVisibilityFixture());
  let cursor = 0;
  const filtered = filterVisibleGrounding(privateResult, () => `opaque-${++cursor}`), text = JSON.stringify(filtered);
  assert.ok(filtered.length > 0); assert.ok(filtered.every(o => o.identity === 'unknown' && o.uncertainty === 'geometric_samples_only'));
  for (const forbidden of ['fixture-', 'painted-window', 'door-leaf', 'position', 'distance":', 'engineTargetId', 'fully_occluded']) assert.ok(!text.includes(forbidden), forbidden);
  assert.ok(filtered.every(o => Number.isInteger(o.bearingDegrees / 15) && ['near', 'room', 'far'].includes(o.distanceBand)));
});

test('darkness and resolution reduce eligible evidence without inventing recognition', () => {
  const state = createVisibilityFixture(); state.scene!.illumination = 0;
  const result = groundSnapshot(state);
  assert.equal(result.objects.find(o => o.id === 'fixture-ahead')?.status, 'poor_observability');
  assert.deepEqual(filterVisibleGrounding(result, () => 'unused'), []);
  assert.equal(result.objects.find(o => o.id === 'fixture-behind-wall')?.status, 'fully_occluded');
  const low = groundSnapshot(createVisibilityFixture(), 64, 64), high = groundSnapshot(createVisibilityFixture(), 1024, 1024);
  assert.ok(low.objects.find(o => o.id === 'fixture-ahead')!.projectedPixels < high.objects.find(o => o.id === 'fixture-ahead')!.projectedPixels);
});

test('actual door transform opens the doorway and painted window remains opaque', () => {
  const state = createVisibilityFixture(); Object.assign(state.character, { x: 2.97, z: -2.3, heading: Math.PI });
  state.scene!.doorOpenRadians = 0;
  assert.equal(groundSnapshot(state).objects.find(o => o.id === 'fixture-beyond-door')?.status, 'fully_occluded');
  state.scene!.doorOpenRadians = Math.PI / 2;
  assert.ok(groundSnapshot(state).objects.find(o => o.id === 'fixture-beyond-door')!.visibleSamples > 0);
  const scene = physicalSceneSnapshot(state);
  assert.ok(scene.boxes.some(b => b.id === 'wall-left' && b.occludes));
  assert.ok(!scene.boxes.some(b => b.id === 'door-backing'));
});

test('render camera and articulated head agree exactly through body heading, bob, yaw and pitch', () => {
  const state = createVisibilityFixture(); Object.assign(state.character, { x: 0.7, z: 0.2, heading: 1.1, moving: true, gait: 2.3 });
  state.head!.yaw = -0.6; state.head!.pitch = 0.4;
  const world = createPhysicalRenderScene(state, { firstPerson: true, width: 768, height: 384 }), pose = eyePose(state, 768, 384);
  const eye = new THREE.Vector3(0, 0.015, 0.39).applyMatrix4(world.avatar.head.matrixWorld);
  assert.ok(eye.distanceTo(new THREE.Vector3(...pose.position)) < 1e-12);
  assert.ok(world.camera.position.distanceTo(eye) < 1e-12);
  const headForward = new THREE.Vector3(0, 0, 1).transformDirection(world.avatar.head.matrixWorld);
  assert.ok(headForward.distanceTo(new THREE.Vector3(...pose.direction)) < 1e-12);
  assert.ok(world.camera.getWorldDirection(new THREE.Vector3()).distanceTo(headForward) < 1e-12);
  assert.equal(world.avatar.head.visible, false);
  assert.ok(Math.abs(Math.tan(world.camera.fov * Math.PI / 360) * 2 - Math.tan(80 * Math.PI / 360)) < 1e-12);
  world.dispose();
});

test('spectator cutaways do not delete physical occluders or alter first-person environment', () => {
  const state = createVisibilityFixture(), spectator = createPhysicalRenderScene(state, { firstPerson: false }), firstPerson = createPhysicalRenderScene(state, { firstPerson: true });
  const wall = physicalSceneSnapshot(state).boxes.find(b => b.id === 'wall-front')!;
  const findWall = (scene: THREE.Scene) => scene.children.flatMap(c => c.children).find(c => c.position.distanceTo(new THREE.Vector3(...wall.position)) < 1e-12)!;
  assert.equal(findWall(spectator.scene).visible, false); assert.equal(findWall(firstPerson.scene).visible, true);
  // A genuine Three.js geometry ray intersects the same wall used by grounding.
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 2.4, 2.5), new THREE.Vector3(0, 0, 1));
  assert.ok(ray.intersectObject(findWall(firstPerson.scene), false).length > 0);
  assert.equal(spectator.avatar.head.visible, true);
  spectator.dispose(); firstPerson.dispose();
});

test('physical configuration is strict, immutable on validation, and navigation shares colliders', () => {
  const config = defaultPhysicalSceneState(), copy = validatePhysicalSceneState(config); copy.illumination = 0; assert.equal(config.illumination, 1);
  for (const bad of [{ ...config, illumination: NaN }, { ...config, extra: true }, { ...config, fixtureColor: 'red' }, { ...config, doorOpenRadians: 9 }]) assert.throws(() => validatePhysicalSceneState(bad));
  assert.equal(canOccupyCharacter(config, 0, 0), true); assert.equal(canOccupyCharacter(config, 4, 0), false);
  config.fixture = 'visibility'; assert.equal(canOccupyCharacter(config, 0.83, 0.2), false);
});
