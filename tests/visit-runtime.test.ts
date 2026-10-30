import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BranchRuntime, hashRuntimeCheckpoint, replayRuntime, type RuntimeOperation } from '../server/branch-runtime.js';
import { TownSimulation, VisitSimulation, hashCheckpoint } from '../server/simulation.js';
import { replay } from '../server/replay.js';
import { cognitionEnvelopeBytes, cognitionStorageBytes, VISIT_FUTURE_BYTES } from '../server/checkpoint-capacity.js';
import { MAX_CHECKPOINT_BYTES } from '../server/checkpoint-storage.js';
import { validateVisitState, VISIT_LIMITS } from '../shared/visit-protocol.js';
import { exportIncident, replayBundle } from '../server/diagnostics/bundle.js';

test('runtime recovery revokes moving control before ticks while preserving public avatar and replaying recorded stop', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lumi-visit-restore-'));
  // A labelled isolated spatial fixture makes the real production purchase timely.
  // Its ledger starts empty; the held item below must come from validated payment.
  const fixture = new VisitSimulation({ mode: 'EXPERIMENT', runId: 'fixture-run' });
  fixture.enqueue({ type: 'visit_start', runId: 'fixture-run', generation: 1 }); fixture.step();
  const seed = fixture.checkpoint(); seed.visit.actor!.x = 2.97; seed.visit.actor!.z = -10.8; seed.visit.actor!.moving = false;
  const original = new BranchRuntime({ worldId: 'test', branchId: 'original', mode: 'EXPERIMENT', directory, checkpoint: seed });
  let restored: BranchRuntime | undefined;
  try {
    original.applyControl({ type: 'pause' }); original.applyControl({ type: 'step' });
    assert.throws(() => original.enqueue({ type: 'visit_start', runId: original.target.runId, generation: 2 }), /authenticated host/);
    original.enqueueVisit({ type: 'visit_start', runId: original.target.runId, generation: 2 }); original.applyControl({ type: 'step' });
    original.enqueueVisit({ type: 'visit_interact', runId: original.target.runId, generation: 2, sequence: 1, actionId: 1, action: 'purchase', door: null, good: 'fruit' }); original.applyControl({ type: 'step' });
    assert.equal(original.viewerState().visit!.inventory.length, 1, 'held item purchased through real stock/payment boundary');
    original.enqueueVisit({ type: 'visit_control', runId: original.target.runId, generation: 2, sequence: 2, forward: 1, strafe: 0, yaw: 0, pitch: 0, expiresTick: original.simulation.state.tick + 20 }); original.applyControl({ type: 'step' });
    original.enqueueVisit({ type: 'visit_control', runId: original.target.runId, generation: 2, sequence: 3, forward: -1, strafe: 0, yaw: 1, pitch: 0, expiresTick: original.simulation.state.tick + 20 });
    original.enqueueVisit({ type: 'visit_interact', runId: original.target.runId, generation: 2, sequence: 4, actionId: 2, action: 'purchase', door: null, good: 'fruit' });
    original.enqueueVisit({ type: 'visit_stop', runId: original.target.runId, generation: 2, reason: 'observe' });
    const saved = original.checkpoint(); assert.equal(saved.schemaVersion, 10); assert.equal(saved.simulation.schemaVersion, 11);
    if (saved.simulation.schemaVersion !== 11) throw new Error('Visit schema required');
    const actor = saved.simulation.visit.actor!; assert.ok(actor.moving);
    restored = new BranchRuntime({ worldId: 'test', branchId: 'restored', mode: 'EXPERIMENT', directory, checkpoint: saved, dormant: true });
    const pending = restored.checkpoint(); assert.equal(pending.simulation.pendingInputs.filter(input => input.command.type === 'visit_stop').length, 1); assert.ok(pending.simulation.pendingInputs.some(input => input.command.type === 'visit_stop' && input.command.reason === 'restart' && input.command.runId === restored!.target.runId));
    assert.throws(() => restored!.enqueueVisit({ type: 'visit_start', runId: original.target.runId, generation: 3 }), /stale/);
    await restored.prepare(); restored.activate(); restored.applyControl({ type: 'step' });
    const current = restored.checkpoint().simulation; if (current.schemaVersion !== 11) throw new Error('Visit schema required');
    assert.equal(current.visit.control.status, 'parked'); assert.equal(current.visit.actor!.moving, false);
    assert.equal(current.visit.actor!.id, actor.id); assert.equal(current.visit.actor!.x, actor.x); assert.equal(current.visit.actor!.z, actor.z);
    assert.deepEqual(current.town.items, saved.simulation.town.items); assert.equal(current.visit.balance, saved.simulation.visit.balance);
    assert.equal(current.visit.lastActionId, saved.simulation.visit.lastActionId, 'old-run interaction never executes');
    restored.capture(); const snapshot = await restored.recorder!.snapshotForExport(), operations = snapshot.records.filter(record => record.runtime_operation).map(record => record.runtime_operation!) as RuntimeOperation[];
    assert.equal(replayRuntime(snapshot.runtimeStart, operations, restored.checkpoint()).runtimeHash, hashRuntimeCheckpoint(restored.checkpoint()));
    assert.ok(snapshot.records.some(record => record.event_type === 'VISIT_STOP_SUPERSEDED'), 'pre-activation reserved-stop replacement is recorded');
    const out = join(directory, 'restored.zip'), bundle = await exportIncident({ runDirectory: restored.recorder!.runDirectory, out, snapshot });
    assert.equal(bundle.manifest.evidence_status, 'COMPLETE'); assert.equal((await replayBundle(out)).runtimeHash, hashRuntimeCheckpoint(restored.checkpoint()));
  } finally { await original.close(); await restored?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('historical town checkpoint and runtime stay schema9/runtime8 under offline replay', async () => {
  const old = new TownSimulation({ mode: 'EXPERIMENT', historical: true }).checkpoint();
  const runtime = new BranchRuntime({ worldId: 'old', branchId: 'town', mode: 'EXPERIMENT', offline: true, checkpoint: old });
  try {
    assert.equal(runtime.checkpoint().schemaVersion, 8); assert.equal(runtime.checkpoint().simulation.schemaVersion, 9);
    const expected = new TownSimulation({ mode: 'EXPERIMENT', checkpoint: old, historical: true }); for (let i = 0; i < 3; i++) expected.step();
    assert.equal(replay(old, [], old.tick + 3).stateHash, hashCheckpoint(expected.checkpoint()));
  } finally { await runtime.close(); }
});

test('actual durable envelopes reserve bounded visitor history and the safety stop slot without trimming memories', t => {
  const initial = new VisitSimulation({ mode: 'EXPERIMENT' }).checkpoint(), grown = structuredClone(initial), max = Number.MAX_SAFE_INTEGER;
  const visit = grown.visit;
  visit.actor = { id: 'owner-avatar-v1', appearance: 'visitor-neutral-v1', x: 1.2345678901234567, z: -1.2345678901234567, heading: Math.PI, pitch: .9, moving: true, gait: max, heldItemId: null, spawnedTick: max, distanceSinceFootstep: VISIT_LIMITS.footstepDistance };
  visit.balance = 1000000; visit.lastActionId = max; visit.droppedCount = max;
  visit.control = { generation: max, lastSequence: max, status: 'active', runId: 'r'.repeat(100), expiresTick: max, forward: 1, strafe: -1, targetYaw: Math.PI, targetPitch: .9 };
  visit.feedback = { actionId: max, type: 'purchase', outcome: 'rejected', reason: 'r'.repeat(100), tick: max };
  visit.timeline = Array.from({ length: VISIT_LIMITS.timeline }, () => ({ ...visit.feedback! }));
  validateVisitState(visit, max, 120);
  grown.pendingInputs.push({ sequence: max, receivedTick: max - 1, applyTick: max, admission: 'queued', command: { type: 'visit_stop', runId: 'r'.repeat(100), generation: max, reason: 'restart' } });
  const growth = cognitionEnvelopeBytes(grown) - cognitionEnvelopeBytes(initial);
  t.diagnostic(`Maximum bounded visitor history and safety slot envelope growth: ${growth} bytes; reserve ${VISIT_FUTURE_BYTES} bytes.`);
  assert.ok(growth > 0 && growth < VISIT_FUTURE_BYTES); assert.ok(cognitionStorageBytes(initial) < MAX_CHECKPOINT_BYTES);
  assert.deepEqual(grown.realExperiences, initial.realExperiences); assert.deepEqual(grown.internalExperiences, initial.internalExperiences);
});
