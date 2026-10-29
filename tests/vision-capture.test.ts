import test from 'node:test';
import assert from 'node:assert/strict';
import { BranchRuntime } from '../server/branch-runtime.js';
import { CaptureManager } from '../server/vision/capture-manager.js';
import { RendererFailure, type FrameRenderer, type RenderedFrame } from '../server/vision/renderer.js';
import { createVisibilityFixture } from '../shared/vision-fixture.js';
import type { WorldState } from '../shared/protocol.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { BranchRegistry } from '../server/branch-registry.js';
import { readRun } from '../server/diagnostics/recorder.js';
import { createVisionApi } from '../server/vision/http-api.js';
import { VisionSimulation } from '../server/simulation.js';

const frame: RenderedFrame = { bytes: new Uint8Array([137,80,78,71,13,10,26,10]), backend: { configuration: 'angle-d3d11', chromium: 'test', webglVendor: 'test', webglRenderer: 'test', version: 'test', flags: [] } };
function runtime(branchId = 'experiment') {
  const original = new BranchRuntime({ worldId: 'vision-test', branchId, mode: 'EXPERIMENT', offline: true });
  // Retain the Phase 2a replay fixture explicitly; new automatic-policy tests use V4.
  const cp = original.checkpoint(), fixture = createVisibilityFixture();
  cp.schemaVersion=2;cp.simulation=new VisionSimulation({mode:'EXPERIMENT'}).checkpoint();
  assert.equal(cp.simulation.schemaVersion, 3);
  if (cp.simulation.schemaVersion !== 3) throw new Error('Vision schema required');
  cp.simulation.character = fixture.character; cp.simulation.scene = fixture.scene!; cp.simulation.head = fixture.head!;
  const result = new BranchRuntime({ worldId: 'vision-test', branchId, mode: 'EXPERIMENT', offline: true, checkpoint: cp });
  result.applyControl({ type: 'pause' }); return result;
}
class DelayedRenderer implements FrameRenderer {
  received: WorldState[] = []; private finish: ((value: RenderedFrame) => void) | undefined;
  render(snapshot: WorldState) { this.received.push(snapshot); return new Promise<RenderedFrame>(done => { this.finish = done; }); }
  release() { this.finish?.(frame); }
  async close() { this.release(); }
}
test('immutable delayed capture retains original tick and bytes; foreign run cannot read frame or use handle', async () => {
  const a = runtime('a'), b = runtime('b'), renderer = new DelayedRenderer(), manager = new CaptureManager(() => true, renderer);
  try {
    const request = manager.request(a, { reason: 'diagnostic' });
    for (let i = 0; i < 10; i++) a.applyControl({ type: 'step' });
    assert.equal(renderer.received[0].tick, request.tick); renderer.release();
    const complete = await manager.wait(a.target, request.captureId); assert.equal(complete.status, 'success'); assert.equal(complete.tick, request.tick);
    assert.equal(complete.camera.position[2], request.camera.position[2]);
    assert.throws(() => manager.frame(b.target, request.captureId), /selected run/);
    const view = manager.view(a.target); assert.ok(view.observation?.shapes.length);
    assert.equal(view.observation!.experienceEncoded, false); assert.equal(a.simulation.checkpoint().experiences.length, 0);
    const json = JSON.stringify(view.observation); assert.ok(!json.includes('fixture-')); assert.ok(!json.includes('engineTargetId'));
    assert.throws(() => manager.resolveHeadAction(b, { type: 'look_at', observationId: request.captureId, handle: view.observation!.shapes[0].handle, sceneRevision: 0 }), /another run/);
    const copied = manager.frame(a.target, request.captureId); copied[0] = 0; assert.equal(manager.frame(a.target, request.captureId)[0], 137);
  } finally { await manager.close(); await a.close(); await b.close(); }
});
test('old-run result is discarded, never exposing observation or frame', async () => {
  const a = runtime(), renderer = new DelayedRenderer(); let active = true;
  const manager = new CaptureManager(() => active, renderer);
  try { const request = manager.request(a, { reason: 'developer' }); active = false; renderer.release(); assert.equal((await manager.wait(a.target, request.captureId)).status, 'stale'); assert.throws(() => manager.frame(a.target, request.captureId), /retired/); }
  finally { await manager.close(); await a.close(); }
});
test('capture admission and frame retention are bounded independently of simulation', async () => {
  const a = runtime(), delayed = new DelayedRenderer(), manager = new CaptureManager(() => true, delayed);
  try {
    for (let i = 0; i < 4; i++) manager.request(a, { reason: 'developer' });
    assert.throws(() => manager.request(a, { reason: 'developer' }), /queue is full/);
    assert.equal(manager.view(a.target).limits.queued, 4);
    a.applyControl({ type: 'step' }); assert.equal(a.simulation.state.tick, 1);
  } finally { await manager.close(); await a.close(); }
  const b = runtime('b'), immediate: FrameRenderer = { render: async () => frame, close: async () => {} }, retained = new CaptureManager(() => true, immediate);
  try { for (let i = 0; i < 20; i++) { const request = retained.request(b, { reason: 'developer' }); await retained.wait(b.target, request.captureId); } assert.equal(retained.view(b.target).limits.retainedFrames, 4); }
  finally { await retained.close(); await b.close(); }
});
test('renderer timeout/crash cannot stop world steps or immediate local reflex and admits a later attempt', async () => {
  const a = runtime(); let attempt = 0;
  const renderer: FrameRenderer = { render: async () => { attempt++; if (attempt === 1) return await new Promise<RenderedFrame>(() => {}); if (attempt === 2) throw new RendererFailure('failed', 'controlled crash'); return frame; }, close: async () => {} };
  const manager = new CaptureManager(() => true, renderer, 20);
  try {
    const pending = manager.request(a, { reason: 'diagnostic' }); a.enqueue({ type: 'slam' }); a.applyControl({ type: 'step' });
    assert.equal(a.simulation.state.reflex.strength, 1); assert.equal((await manager.wait(a.target, pending.captureId)).status, 'timeout');
    const crash = manager.request(a, { reason: 'diagnostic' }); assert.equal((await manager.wait(a.target, crash.captureId)).status, 'failed');
    const good = manager.request(a, { reason: 'diagnostic' }); assert.equal((await manager.wait(a.target, good.captureId)).status, 'success');
  } finally { await manager.close(); await a.close(); }
});
test('failed renderer cannot fabricate successful empty observation; public targeting rejects private evidence', async () => {
  const a = runtime(), bad: FrameRenderer = { render: async () => { throw new RendererFailure('unavailable', 'missing Chromium'); }, close: async () => {} }, manager = new CaptureManager(() => true, bad);
  try {
    const request = manager.request(a, { reason: 'developer' }); assert.equal((await manager.wait(a.target, request.captureId)).status, 'unavailable');
    const view = manager.view(a.target); assert.equal(view.observation, null); assert.equal(view.privateGrounding, null); assert.equal(view.previousSuccess, null);
    assert.throws(() => manager.resolveHeadAction(a, { type: 'look_at', yaw: 0, pitch: 0, sceneRevision: 0, evidence: {} }), /public head/);
    assert.throws(() => manager.request(a, { reason: 'developer', width: Number.NaN }), /dimensions/);
  } finally { await manager.close(); await a.close(); }
});
test('throwing cleanup cannot leave a pending capture or reject the asynchronous pump', async () => {
  const a = runtime();
  for (const timeout of [false, true]) {
    const bad: FrameRenderer = { render: async () => { if (timeout) return await new Promise<RenderedFrame>(() => {}); throw new RendererFailure('failed', 'controlled crash'); }, close: async () => { throw new Error('controlled cleanup failure'); } };
    const manager = new CaptureManager(() => true, bad, 10);
    try { const requested = manager.request(a, { reason: 'diagnostic' }); const terminal = await manager.wait(a.target, requested.captureId); assert.equal(terminal.status, timeout ? 'timeout' : 'failed'); assert.match(terminal.error!, /cleanup failed/); a.applyControl({ type: 'step' }); }
    finally { await manager.close(); }
  }
  await a.close();
});
test('a hanging renderer cleanup has a separate deadline so admitted queue slots still complete', async () => {
  const a = runtime(), renderer: FrameRenderer = { render: async () => { throw new RendererFailure('failed', 'controlled renderer fault'); }, close: async () => { await new Promise<void>(() => {}); } };
  const manager = new CaptureManager(() => true, renderer, 20, 10);
  try {
    const first = manager.request(a, { reason: 'diagnostic' }), second = manager.request(a, { reason: 'diagnostic' });
    assert.equal((await manager.wait(a.target, first.captureId)).status, 'failed'); assert.equal((await manager.wait(a.target, second.captureId)).status, 'failed');
    assert.equal(manager.view(a.target).limits.queued, 0); assert.match(manager.view(a.target).cleanupError ?? '', /deadline/);
    a.applyControl({ type: 'step' }); assert.equal(a.simulation.state.tick, 1);
  } finally { await manager.close(); await a.close(); }
});
test('actual registry restore records stale discard before retiring its recorder and clears queued work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lumi-vision-retire-')); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  const registry = new BranchRegistry({ directory, beforeRetireRuntime: old => manager.retire(old.target) });
  const renderer = new DelayedRenderer(), manager = new CaptureManager(target => { try { registry.active(target); return true; } catch { return false; } }, renderer);
  try {
    const liveCheckpoint = await registry.checkpoint(registry.live.target), experiment = await registry.fork(registry.live.target, liveCheckpoint.id, 'delayed');
    experiment.applyControl({ type: 'pause' }); const saved = await registry.checkpoint(experiment.target);
    const pending = manager.request(experiment, { reason: 'diagnostic' }), queued = manager.request(experiment, { reason: 'diagnostic' });
    const replacement = await registry.restore(experiment.target, saved.id);
    assert.notEqual(replacement.target.runId, experiment.target.runId);
    assert.equal((await manager.wait(experiment.target, pending.captureId)).status, 'stale'); assert.equal((await manager.wait(experiment.target, queued.captureId)).status, 'stale');
    renderer.release(); await new Promise(done => setImmediate(done));
    const run = await readRun(experiment.recorder!.runDirectory), discard = run.records.filter(record => record.event_type === 'CAPTURE_STALE_DISCARD');
    assert.equal(discard.length, 2); assert.ok(discard.every(record => record.data.captureId));
    assert.equal(manager.view(replacement.target).latest, null); assert.equal(manager.view(replacement.target).limits.queued, 0);
  } finally { await manager.close(); await registry.close(); await rm(directory, { recursive: true, force: true }); }
});
test('global frame eviction is explicit stale evidence rather than a success with a missing image', async () => {
  const branches = Array.from({ length: 5 }, (_, i) => runtime('branch-' + i));
  const manager = new CaptureManager(() => true, { render: async () => frame, close: async () => {} });
  try {
    const first = manager.request(branches[0], { reason: 'developer' }); await manager.wait(branches[0].target, first.captureId);
    for (const branch of branches.slice(1)) for (let i = 0; i < 4; i++) { const request = manager.request(branch, { reason: 'developer' }); await manager.wait(branch.target, request.captureId); }
    const evicted = manager.view(branches[0].target); assert.equal(evicted.latest?.status, 'stale'); assert.match(evicted.latest?.error ?? '', /retention/); assert.equal(evicted.previousSuccess, null); assert.equal(evicted.observation, null);
  } finally { await manager.close(); for (const branch of branches) await branch.close(); }
});
test('capture completed during failed restore preparation remains valid for the unchanged current run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lumi-vision-prepare-')); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  let restoring = false, preparationEntered = false, entered!: () => void, failPreparation!: (error: Error) => void;
  let restoreOutcome: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
  const started = new Promise<void>(done => { entered = done; });
  const preparation = new Promise<void>((_, reject) => { failPreparation = reject; });
  const registry = new BranchRegistry({ directory, prepareCandidate: async () => { if (restoring) { preparationEntered = true; entered(); await preparation; } } });
  const renderer = new DelayedRenderer(), api = createVisionApi({ registry, renderer });
  try {
    const liveCheckpoint = await registry.checkpoint(registry.live.target), experiment = await registry.fork(registry.live.target, liveCheckpoint.id, 'prepare');
    const saved = await registry.checkpoint(experiment.target), requested = api.manager.request(experiment, { reason: 'diagnostic' });
    restoring = true;
    restoreOutcome = registry.restore(experiment.target, saved.id).then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
    // An unexpected failure before the custom preparation hook must fail this await directly,
    // rather than leaving the start barrier pending and an assertion promise unhandled.
    await Promise.race([started, restoreOutcome.then(result => { throw result.ok ? new Error('Restore finished before the preparation barrier') : result.error; })]);
    assert.throws(() => registry.active(experiment.target), /progress/);
    renderer.release(); assert.equal((await api.manager.wait(experiment.target, requested.captureId)).status, 'success');
    failPreparation(new Error('controlled preparation failure')); const rejected = await restoreOutcome;
    assert.equal(rejected.ok, false); if (!rejected.ok) assert.match(String(rejected.error), /controlled preparation/);
    assert.equal(registry.active(experiment.target), experiment); assert.equal(api.manager.view(experiment.target).latest?.status, 'success');
    assert.ok((await api.get('/api/vision/frame', { ...experiment.target, captureId: requested.captureId }))?.bytes?.length);
    await experiment.recorder!.flush(); const records = (await readRun(experiment.recorder!.runDirectory)).records;
    assert.ok(records.some(record => record.event_type === 'CAPTURE_COMPLETE' && record.data.captureId === requested.captureId));
    assert.ok(!records.some(record => record.event_type === 'CAPTURE_STALE_DISCARD' && record.data.captureId === requested.captureId));
  } finally { if (preparationEntered) failPreparation(new Error('test preparation cleanup')); await restoreOutcome; await api.close(); await registry.close(); await rm(directory, { recursive: true, force: true }); }
});
test('invalid camera admission records a failed capture and retains the earlier image only as previous evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lumi-vision-admission-')); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  const source = runtime('source'), checkpoint = source.checkpoint();
  assert.equal(checkpoint.simulation.schemaVersion, 3); if (checkpoint.simulation.schemaVersion !== 3) throw new Error('Vision schema required');
  checkpoint.simulation.character = { x: 3.2, z: -2.3, heading: Math.PI - 0.5, moving: false, gait: 0 };
  checkpoint.simulation.pauseUntilTick = checkpoint.simulation.tick + 1000;
  checkpoint.simulation.scene.fixture = 'none'; checkpoint.simulation.scene.doorOpenRadians = null;
  const a = new BranchRuntime({ worldId: 'camera-admission', branchId: 'experiment', mode: 'EXPERIMENT', checkpoint, directory });
  let renders = 0;
  const manager = new CaptureManager(() => true, { render: async () => { renders++; return frame; }, close: async () => {} });
  try {
    const good = manager.request(a, { reason: 'diagnostic' }); assert.equal((await manager.wait(a.target, good.captureId)).status, 'success');
    // A valid migrated near-door pose becomes temporarily obstructed by the actual slam transform.
    a.enqueue({ type: 'slam' }); a.applyControl({ type: 'step' });
    const invalid = manager.request(a, { reason: 'diagnostic' }); assert.equal(invalid.status, 'failed');
    const terminal = await manager.wait(a.target, invalid.captureId); assert.match(terminal.error ?? '', /Camera/); assert.ok(terminal.completedAt); assert.equal(terminal.frameHash, null); assert.equal(terminal.backend, null);
    const view = manager.view(a.target); assert.equal(view.latest?.captureId, invalid.captureId); assert.equal(view.latest?.status, 'failed'); assert.equal(view.previousSuccess?.captureId, good.captureId);
    assert.equal(view.observation, null); assert.equal(view.privateGrounding, null); assert.equal(view.limits.queued, 0); assert.equal(renders, 1);
    assert.throws(() => manager.frame(a.target, invalid.captureId), /unavailable/); assert.ok(manager.frame(a.target, good.captureId).length);
    await a.recorder!.flush(); const records = (await readRun(a.recorder!.runDirectory)).records.filter(record => record.data.captureId === invalid.captureId);
    assert.deepEqual(records.map(record => record.event_type), ['CAPTURE_REQUEST', 'CAPTURE_SNAPSHOT', 'CAPTURE_FAILURE', 'CAPTURE_TIMING']);
    assert.equal(a.simulation.checkpoint().experiences.length, 0);
  } finally { await manager.close(); await a.close(); await source.close(); await rm(directory, { recursive: true, force: true }); }
});
