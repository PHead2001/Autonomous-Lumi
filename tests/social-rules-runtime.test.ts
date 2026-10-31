import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEGACY_SOCIAL_RULES, SOCIAL_RULES } from '../shared/social-protocol.js';
import { SocialSimulation, hashCheckpoint, validateCheckpoint } from '../server/simulation.js';
import { BranchRuntime, hashRuntimeCheckpoint, validateRuntimeCheckpoint } from '../server/branch-runtime.js';
import { RecoveryStore } from '../server/recovery-store.js';
import { replay } from '../server/replay.js';
import { exportIncident, replayBundle } from '../server/diagnostics/bundle.js';
import { readRun } from '../server/diagnostics/recorder.js';

test('CP11 rules are explicit and immutable: historical v1 stays v1; active upgrade preserves saved fields', () => {
  const identity = { mode: 'EXPERIMENT' as const, worldId: 'policy', branchId: 'policy', historyId: 'policy-history', runId: 'policy-run' };
  const initial = new SocialSimulation(identity).checkpoint();
  initial.rulesVersion = initial.social.rulesVersion = LEGACY_SOCIAL_RULES;
  const legacy = new SocialSimulation({ ...identity, checkpoint: initial, historical: true });
  legacy.enqueue({ type: 'visit_start', runId: identity.runId, generation: 1 }); legacy.step();
  const fixture = legacy.checkpoint(); fixture.visit.actor!.x = 2.97; fixture.visit.actor!.z = -10.8;
  const purchaser = new SocialSimulation({ ...identity, checkpoint: fixture, historical: true });
  purchaser.enqueue({ type: 'visit_interact', runId: identity.runId, generation: 1, sequence: 1, actionId: 1, action: 'purchase', door: null, good: 'fruit' }); purchaser.step();
  assert.equal(purchaser.visitState().balance, 17);
  purchaser.enqueue({ type: 'visit_control', runId: identity.runId, generation: 1, sequence: 2, forward: 1, strafe: 0, yaw: 0, pitch: 0, expiresTick: 20 });
  const saved = purchaser.checkpoint(), untouched = structuredClone(saved);
  const historical = new SocialSimulation({ ...identity, checkpoint: saved, historical: true });
  assert.deepEqual(historical.checkpoint(), saved);
  const current = new SocialSimulation({ ...identity, checkpoint: saved });
  const expected = structuredClone(saved); expected.rulesVersion = expected.social.rulesVersion = SOCIAL_RULES;
  assert.deepEqual(current.checkpoint(), expected, 'upgrade changes only matching policy labels before any ticks');
  assert.deepEqual(saved, untouched, 'activation does not mutate the source checkpoint');
  const wrong = structuredClone(saved); wrong.social.rulesVersion = SOCIAL_RULES;
  assert.throws(() => validateCheckpoint(wrong), /social schema\/rules/);
  for (let i = 0; i < 3; i++) historical.step();
  assert.equal(historical.checkpoint().rulesVersion, LEGACY_SOCIAL_RULES);
  assert.equal(current.checkpoint().rulesVersion, SOCIAL_RULES);
  assert.equal(replay(saved, [], historical.state.tick).stateHash, hashCheckpoint(historical.checkpoint()));
});

test('runtime v1 offline restore stays exact while active migration records v2 and exports exact replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lumi-social-policy-'));
  const seed = new SocialSimulation({ mode: 'EXPERIMENT' }).checkpoint(); seed.rulesVersion = seed.social.rulesVersion = LEGACY_SOCIAL_RULES;
  const historical = new BranchRuntime({ worldId: 'policy', branchId: 'legacy', mode: 'EXPERIMENT', checkpoint: seed, offline: true });
  const active = new BranchRuntime({ worldId: 'policy', branchId: 'active', mode: 'EXPERIMENT', checkpoint: seed, directory });
  try {
    assert.equal(hashCheckpoint(historical.checkpoint().simulation), hashCheckpoint(seed));
    active.applyControl({ type: 'pause' }); active.applyControl({ type: 'step' }); active.capture();
    const cp = active.checkpoint(); assert.equal(cp.schemaVersion, 11); assert.equal(cp.simulation.rulesVersion, 'lumi-daily-v1');
    await active.recorder!.flush(); const records = (await readRun(active.recorder!.runDirectory)).records;
    assert.ok(records.some(record => record.event_type === 'STATE_RULES_MIGRATED' && record.data.fromRules === LEGACY_SOCIAL_RULES && record.data.toRules === 'lumi-daily-v1'));
    const out = join(directory, 'v2.zip'); const exported = await exportIncident({ runDirectory: active.recorder!.runDirectory, out, snapshot: await active.recorder!.snapshotForExport() });
    assert.equal(exported.manifest.evidence_status, 'COMPLETE');
    assert.equal((await replayBundle(out)).runtimeHash, hashRuntimeCheckpoint(cp));
  } finally { await historical.close(); await active.close(); await rm(directory, { recursive: true, force: true }); }
});

test('recovery retains a validated v1 generation beyond normal rotation before active v2 upgrade', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lumi-social-policy-recovery-'));
  let historical: BranchRuntime | undefined, active: BranchRuntime | undefined;
  try {
    const opened = await RecoveryStore.open({ directory });
    const seed = new SocialSimulation({ mode: 'LIVE', worldId: 'policy', branchId: 'live', historyId: opened.store.historyId }).checkpoint();
    seed.rulesVersion = seed.social.rulesVersion = LEGACY_SOCIAL_RULES;
    historical = new BranchRuntime({ worldId: 'policy', branchId: 'live', historyId: opened.store.historyId, mode: 'LIVE', checkpoint: { schemaVersion: 10, kind: 'lumi-branch-runtime', mode: 'LIVE', simulation: seed, control: { paused: false, speed: 1, fastForwardRemaining: 0, nextOperationSequence: 1, loggingMode: 'default', compressClosed: false }, scheduler: { config: { hz: seed.config.hz, maxStepsPerPump: 8, maxBacklogSteps: 16, suspendThresholdMs: 1000 }, backlogMs: 0 } }, offline: true });
    const original = historical.checkpoint(); await opened.store.save(original);
    const recovered = await RecoveryStore.open({ directory });
    assert.equal(hashRuntimeCheckpoint(validateRuntimeCheckpoint(recovered.checkpoint)), hashRuntimeCheckpoint(original));
    const archive = (await readdir(recovered.store.directory)).find(file => file.startsWith('pre-social-rules-v1-'));
    assert.ok(archive, 'validated v1 source archived before activation');
    const backup = JSON.parse(await readFile(join(recovered.store.directory, archive), 'utf8')) as { checkpoint: unknown };
    assert.equal(hashRuntimeCheckpoint(validateRuntimeCheckpoint(backup.checkpoint)), hashRuntimeCheckpoint(original));
    active = new BranchRuntime({ worldId: 'policy', branchId: 'live', historyId: opened.store.historyId, mode: 'LIVE', checkpoint: recovered.checkpoint, directory: join(directory, 'runs'), dormant: true });
    assert.equal(active.checkpoint().simulation.rulesVersion, 'lumi-daily-v1');
    await recovered.store.save(active.checkpoint()); await recovered.store.save(active.checkpoint());
    assert.ok((await readdir(recovered.store.directory)).includes(archive));
  } finally { await historical?.close(); await active?.close(); await rm(directory, { recursive: true, force: true }); }
});
