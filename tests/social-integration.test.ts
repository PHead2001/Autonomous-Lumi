import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SocialSimulation, VisitSimulation, hashCheckpoint, type DeterministicEvent } from '../server/simulation.js';
import { BranchRuntime } from '../server/branch-runtime.js';
import { replay } from '../server/replay.js';
import { FlightRecorder, readRun } from '../server/diagnostics/recorder.js';
import { providerExperiences } from '../server/cognition/observation.js';

test('historical Visit checkpoint/runtime retain their own rules and exact replay after CP11 activation', async () => {
  const old = new VisitSimulation({ mode: 'EXPERIMENT', runId: 'old-visit' });
  old.enqueue({ type: 'visit_start', runId: 'old-visit', generation: 1 }); old.step(); const checkpoint = old.checkpoint();
  const command = { type: 'visit_control' as const, runId: 'old-visit', generation: 1, sequence: 1, forward: 1, strafe: 0, yaw: 0, pitch: 0, expiresTick: 20 };
  const input = old.enqueue(command).input; for (let i = 0; i < 5; i++) old.step();
  assert.equal(replay(checkpoint, [input], old.state.tick).stateHash, hashCheckpoint(old.checkpoint()));
  const runtime = new BranchRuntime({ worldId: 'history', branchId: 'visit', mode: 'EXPERIMENT', offline: true, checkpoint });
  try { assert.equal(runtime.checkpoint().schemaVersion, 9); assert.equal(runtime.checkpoint().simulation.schemaVersion, 10); assert.ok(!('social' in runtime.viewerState())); }
  finally { await runtime.close(); }
});

test('ordinary inputs and forged RGB proof cannot create social intentions or creator memories', async () => {
  const runtime = new BranchRuntime({ worldId: 'isolated', branchId: 'social-proof', mode: 'EXPERIMENT', offline: true });
  try {
    assert.throws(() => runtime.enqueue({ type: 'social_badge', runId: runtime.target.runId, generation: 1, sequence: 1, actionId: 1, display: true }), /private authenticated/);
    assert.throws(() => runtime.enqueueSocialObservation({ type: 'social_observation', captureId: 'fixture', frameHash: 'a'.repeat(64), capturedTick: 0, attentionTick: 0, sensorSource: 'actual_renderer', actor: { x: 0, z: -1.75, heading: 0 }, offer: null, badge: { revision: 1, kind: 'verified_seal', handle: 'fixture-handle' } }, { authority: 'actual-social-capture-proof' }), /Untrusted social/);
    const cp = runtime.simulation.checkpoint(); assert.equal(cp.schemaVersion, 11); if (cp.schemaVersion !== 11) throw new Error('Social schema required');
    assert.deepEqual(cp.social.experiences, []); assert.equal(cp.social.firstRecognizedEncounter, null); assert.equal(cp.social.badge.display, false);
  } finally { await runtime.close(); }
});

test('provider projection includes admitted local authored semantics without fake model requests or operational fields', () => {
  const cp = new SocialSimulation({ mode: 'EXPERIMENT', historyId: 'semantic-history', branchId: 'semantic', runId: 'semantic-run' }).checkpoint();
  const identity = cp.cognition.identity, interpretation = 'I noticed an anonymous visitor physically offering food.', uncertainty = 'Identity unestablished; only the currently visible offering is evidenced.';
  cp.social.experiences.push({ id: 1, kind: 'social', provenance: 'ATTENDED_AUTHORED_SOCIAL_RGB', recognition: 'authored-social-rgb-v1', source: 'actual_renderer', identity: { ...identity }, encodingId: identity.historyId + '_capture_anonymous_visitor', captureId: 'capture', frameHash: 'a'.repeat(64), handle: 'opaque-handle', capturedTick: 0, attentionTick: 0, encodedTick: 0, perceivedIdentity: 'anonymous_visitor', interpretation, uncertainty });
  assert.equal(cp.cognition.requests.length, 0); assert.deepEqual(providerExperiences(cp, identity), [{ interpretation, uncertainty }]);
  const disabled = structuredClone(cp); disabled.physiology.encodingEnabled = false; assert.deepEqual(providerExperiences(disabled, identity), [{ interpretation, uncertainty }], 'disabling future encoding does not erase retained experience');
  assert.deepEqual(providerExperiences(cp, { ...identity, historyId: 'other-history' }), []);
  const context = JSON.stringify(providerExperiences(cp, identity)); for (const field of ['capture', 'encodedTick', 'runId', 'actorId', 'offerId', 'identity', 'handle']) assert.ok(!context.includes('"' + field + '"'));
});

test('diagnostics admit only fully gated authored-social encodings and keep rejected evidence private', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lumi-social-recorder-')), recorder = new FlightRecorder({ directory, worldId: 'test', branchId: 'experiment', runId: 'social-encoding', worldMode: 'EXPERIMENT' });
  const base: DeterministicEvent = { sequence: 1, tick: 0, type: 'SOCIAL_ENCODING', component: 'social_experience', outcome: 'admitted', data: { provenance: 'ATTENDED_AUTHORED_SOCIAL_RGB', source: 'actual_renderer', sensed: true, attended: true, encoded: true } };
  try {
    recorder.captureCheckpoint(new SocialSimulation({ mode: 'EXPERIMENT' }).checkpoint());
    recorder.record({ tick: 0, category: 'FOX_EXPERIENCE', eventType: 'SOCIAL_ENCODING', component: 'social_experience', outcome: 'forged_public_record', data: base.data });
    recorder.recordEvent(base);
    for (const data of [{ ...base.data, encoded: false }, { ...base.data, sensed: false }, { ...base.data, attended: false }, { ...base.data, source: 'test_fixture' }, { ...base.data, provenance: 'TEST STUB' }]) recorder.recordEvent({ ...base, sequence: ++base.sequence, data });
    recorder.recordEvent({ ...base, sequence: ++base.sequence, outcome: 'not_encoded' });
    recorder.recordEvent({ ...base, sequence: ++base.sequence, type: 'SOCIAL_OBSERVATION', component: 'social_sensor', outcome: 'rejected' });
    await recorder.close(); const records = (await readRun(recorder.runDirectory)).records;
    assert.equal(records.filter(record => record.category === 'FOX_EXPERIENCE').length, 1);
    assert.ok(records.filter(record => record.category !== 'FOX_EXPERIENCE').every(record => record.category === 'PRIVATE_SENSOR'));
  } finally { await recorder.close(); await rm(directory, { recursive: true, force: true }); }
});
