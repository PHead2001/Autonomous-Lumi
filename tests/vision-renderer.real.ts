import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { ChromiumRenderer } from '../server/vision/renderer.js';
import { createVisibilityFixture } from '../shared/vision-fixture.js';
import { CaptureManager } from '../server/vision/capture-manager.js';
import { BranchRuntime } from '../server/branch-runtime.js';
import { qualifyPixelGrounding } from '../server/vision/pixel-qualification.js';
import { groundSnapshot } from '../server/vision/grounding.js';
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { waitForOwnedExit } from '../server/vision/cleanup.js';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
for (const configuration of ['angle-d3d11', 'swiftshader'] as const) {
  test(`actual ${configuration} image agrees with fixture occlusion, color and light; warm GPU allocations stay bounded`, async () => {
    const renderer = new ChromiumRenderer(configuration), fixture = createVisibilityFixture();
    try {
      const frame = await renderer.render(fixture, 512, 512), png = PNG.sync.read(Buffer.from(frame.bytes));
      assert.equal(png.width, 512); assert.equal(png.height, 512);
      let red = 0, yellow = 0, magenta = 0;
      for (let i = 0; i < png.data.length; i += 4) { const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]]; if (r > 60 && r > g * 1.5 && r > b * 1.5) red++; if (r > 70 && g > 65 && r > b * 1.5 && g > b * 1.5) yellow++; if (r > 60 && b > 60 && r > g * 1.6 && b > g * 1.6) magenta++; }
      assert.ok(red > 50); assert.ok(yellow > 50); assert.equal(magenta, 0);
      assert.equal(groundSnapshot(fixture).objects.find(o => o.id === 'fixture-behind-wall')?.status, 'fully_occluded');
      const changed = structuredClone(fixture); changed.scene!.fixtureColor = '#21df68'; changed.scene!.revision++;
      assert.notEqual(digest((await renderer.render(changed, 512, 512)).bytes), digest(frame.bytes));
      const doorFixture = structuredClone(fixture); doorFixture.character = { x: 2.97, z: -1.5, heading: Math.PI, moving: false, gait: 0 }; doorFixture.scene!.doorOpenRadians = 0;
      const shut = await renderer.render(doorFixture, 512, 512);
      assert.equal(groundSnapshot(doorFixture).objects.find(o => o.id === 'fixture-beyond-door')?.status, 'fully_occluded');
      doorFixture.scene!.doorOpenRadians = -Math.PI / 2; doorFixture.scene!.revision++;
      const open = await renderer.render(doorFixture, 512, 512);
      assert.ok(groundSnapshot(doorFixture).objects.find(o => o.id === 'fixture-beyond-door')?.eligible);
      const magentaCount = (bytes: Uint8Array) => { const data = PNG.sync.read(Buffer.from(bytes)).data; let count = 0; for (let i = 0; i < data.length; i += 4) if (data[i] > 60 && data[i + 2] > 60 && data[i] > data[i + 1] * 1.6 && data[i + 2] > data[i + 1] * 1.6) count++; return count; };
      assert.equal(magentaCount(shut.bytes), 0); assert.ok(magentaCount(open.bytes) > 50);
      const dark = structuredClone(fixture); dark.scene!.illumination = 0; dark.scene!.revision++;
      const darkPng = PNG.sync.read(Buffer.from((await renderer.render(dark, 512, 512)).bytes));
      assert.equal(darkPng.data.filter((_, index) => index % 4 !== 3).reduce((a, b) => a + b, 0), 0);
      const counts = []; for (let i = 0; i < 4; i++) counts.push((await renderer.render(fixture, 512, 512)).resources);
      assert.ok(counts.every(c => !!c)); assert.equal(new Set(counts.map(c => JSON.stringify(c))).size, 1);
      const before = renderer.pid; assert.ok(before); await renderer.crash(); assert.equal(renderer.pid, undefined);
      assert.throws(() => process.kill(before!, 0)); assert.ok((await renderer.render(fixture, 256, 256)).bytes.length > 100);
    } finally { await renderer.close(); }
  });
}
test('actual browser startup crash before CDP readiness is contained and next explicit attempt succeeds', async () => {
  let once = true, crashedPid: number | undefined;
  const renderer = new ChromiumRenderer('angle-d3d11', 20000, 30000, { onSpawn: child => { if (once) { once = false; crashedPid = child.pid; child.kill(); } } });
  try { await assert.rejects(renderer.render(createVisibilityFixture(), 256, 256), /startup/); assert.equal(renderer.pid, undefined); assert.ok(crashedPid); assert.throws(() => process.kill(crashedPid!, 0)); assert.ok((await renderer.render(createVisibilityFixture(), 256, 256)).bytes.length > 100); }
  finally { await renderer.close(); }
});
test('actual delayed zero-viewer capture preserves admission snapshot while world ticks and reflex continue', async () => {
  const runtime = new BranchRuntime({ worldId: 'zero-viewer', branchId: 'live', mode: 'LIVE', offline: true });
  const renderer = new ChromiumRenderer('angle-d3d11', 20000, 30000, { renderDelayMs: 300 });
  const admittedSnapshot = runtime.viewerState();
  const manager = new CaptureManager(() => true, renderer), requested = manager.request(runtime, { reason: 'diagnostic' });
  const timer = setInterval(() => runtime.simulation.step(), 1000 / 30);
  runtime.enqueue({ type: 'slam' });
  try { const completed = await manager.wait(runtime.target, requested.captureId); assert.equal(completed.status, 'success'); assert.equal(completed.tick, requested.tick); assert.equal(completed.stateHash, requested.stateHash); assert.ok(runtime.simulation.state.tick > requested.tick); assert.equal(runtime.simulation.state.door.slamCount, 1); assert.ok(runtime.simulation.state.reflex.strength > 0 && runtime.simulation.state.reflex.strength < 1); assert.equal(runtime.simulation.state.reflex.start, runtime.simulation.state.door.lastSlam); const capturedBytes = manager.frame(runtime.target, requested.captureId); assert.ok(capturedBytes.length > 100); const reproduced = await renderer.render(admittedSnapshot, 512, 512); assert.equal(digest(capturedBytes), digest(reproduced.bytes)); assert.ok(reproduced.privateMask, 'reproduced admission snapshot has paired private mask'); const geometry = groundSnapshot(admittedSnapshot, 512, 512, { ignoreLegacyIlluminationGate: true, pixelEvidenceCandidates: true }); const expected = qualifyPixelGrounding(geometry, capturedBytes, reproduced.privateMask, 512, 512); assert.equal(expected.pixelQualification.status, 'checked'); assert.deepEqual(expected.camera, requested.camera); assert.deepEqual(manager.view(runtime.target).privateGrounding, expected, 'retained admission geometry and measured pixel confidence match its original RGB/mask, not the later moving world'); }
  finally { clearInterval(timer); await manager.close(); await runtime.close(); }
});
test('idle cleanup failure is contained, visible, and retried only by an explicit new capture', async () => {
  let first = true, cleanupAttempted!: () => void;
  const attempted = new Promise<void>(done => { cleanupAttempted = done; });
  const renderer = new ChromiumRenderer('angle-d3d11', 20000, 1, { removeProfile: async profile => { if (first) { first = false; cleanupAttempted(); throw new Error('controlled profile removal failure'); } await rm(profile, { recursive: true, force: true }); } });
  try { await renderer.render(createVisibilityFixture(), 128, 128); await attempted; await new Promise(done => setImmediate(done)); assert.match(renderer.cleanupError ?? '', /cleanup failed/); assert.equal(renderer.pid, undefined); assert.ok((await renderer.render(createVisibilityFixture(), 128, 128)).bytes.length > 100); }
  finally { await renderer.close(); }
});
test('actual Chromium capture deadline cleans its process while world/reflex continue and a later capture succeeds', async () => {
  const hooks = { renderDelayMs: 0 }, renderer = new ChromiumRenderer('angle-d3d11', 2000, 30000, hooks);
  const runtime = new BranchRuntime({ worldId: 'timeout-world', branchId: 'live', mode: 'LIVE', offline: true });
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await renderer.render(createVisibilityFixture(), 128, 128); hooks.renderDelayMs = 3000;
    const tick = runtime.simulation.state.tick; timer = setInterval(() => runtime.simulation.step(), 1000 / 30); runtime.enqueue({ type: 'slam' });
    await assert.rejects(renderer.render(createVisibilityFixture(), 128, 128), /timed out/);
    assert.equal(renderer.pid, undefined); assert.ok(runtime.simulation.state.tick > tick); assert.ok(runtime.simulation.state.reflex.strength > 0 && runtime.simulation.state.reflex.strength < 1); assert.equal(runtime.simulation.state.reflex.start, runtime.simulation.state.door.lastSlam);
    hooks.renderDelayMs = 0; assert.ok((await renderer.render(createVisibilityFixture(), 128, 128)).bytes.length > 100);
  } finally { clearInterval(timer); await renderer.close(); await runtime.close(); }
});

test('actual renderer refuses an eye-inside-occluder frame and the next explicit valid capture succeeds', async () => {
  const renderer = new ChromiumRenderer('angle-d3d11'), invalid = createVisibilityFixture();
  invalid.character = { x: 2.1, z: 1.6, heading: -Math.PI / 2, moving: false, gait: 0 };
  try {
    await assert.rejects(renderer.render(invalid, 512, 512), /Renderer process failed/);
    assert.equal(renderer.pid, undefined, 'failed camera capture leaves no renderer process');
    const valid = await renderer.render(createVisibilityFixture(), 512, 512);
    const png = PNG.sync.read(Buffer.from(valid.bytes));
    assert.equal(png.width, 512); assert.equal(png.height, 512);
    assert.ok(valid.bytes.length > 100);
  } finally { await renderer.close(); }
});

test('an exited browser root does not discard a live owned-profile holder or delete its profile', { skip: process.platform !== 'win32' }, async () => {
  let root: ChildProcess | undefined, profile: string | undefined, removals = 0, holder: ChildProcess | undefined;
  const renderer = new ChromiumRenderer('angle-d3d11', 20000, 30000, {
    onSpawn: child => { if (!root) { root = child; profile = child.spawnargs.find(arg => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length); } },
    removeProfile: async path => { removals++; await rm(path, { recursive: true, force: true }); },
  });
  try {
    await renderer.render(createVisibilityFixture(), 128, 128); assert.ok(root); assert.ok(profile);
    // This separately owned test process models an orphan still using the unique renderer profile.
    holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${profile}`], { stdio: 'ignore', windowsHide: true });
    root.kill(); await waitForOwnedExit(root, 1000);
    await assert.rejects(renderer.close(), /profile processes remain/);
    assert.equal(removals, 0); assert.equal(existsSync(profile), true); assert.match(renderer.cleanupError ?? '', /cleanup failed/);
    await assert.rejects(renderer.render(createVisibilityFixture(), 128, 128), /cleanup failed/);
    assert.equal(removals, 0); assert.equal(existsSync(profile), true);
    holder.kill(); await waitForOwnedExit(holder, 1000);
    assert.ok((await renderer.render(createVisibilityFixture(), 128, 128)).bytes.length > 100);
    assert.equal(existsSync(profile), false); assert.equal(removals, 1);
  } finally {
    if (holder && holder.exitCode === null && holder.signalCode === null) { holder.kill(); await waitForOwnedExit(holder, 1000); }
    await renderer.close();
  }
});
