import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setImmediate as immediate } from 'node:timers/promises';
import { EXPERIMENT_PLAYBACK } from '../shared/lab-protocol.js';
import { BranchRuntime, hashRuntimeCheckpoint, replayRuntime, validateControlAction, validateRuntimeCheckpoint } from '../server/branch-runtime.js';
import { readRun } from '../server/diagnostics/recorder.js';
import { FixedScheduler, type SchedulerDiagnostic } from '../server/scheduler.js';

async function temp(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), 'lumi-playback-'));
  t.after(async () => { if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe temp path'); await rm(directory, { recursive: true, force: true }); });
  return directory;
}

test('interactive speed admission shares the default and maximum; actual fixed steps measure 6x and 30x', async t => {
  const directory = await temp(t); let now = 0;
  const runtime = new BranchRuntime({ worldId: 'w', branchId: 'e', mode: 'EXPERIMENT', directory, clock: { monotonicMs: () => now, utcMs: () => now } });
  try {
    assert.equal(runtime.summary().speed, EXPERIMENT_PLAYBACK.defaultSpeed);
    assert.equal(runtime.playback().achievedSpeed, null);
    for (let i = 1; i <= 31; i++) { now = i * 1000 / 30; runtime.pump(); }
    assert.equal(runtime.simulation.state.tick, 186);
    assert.ok(Math.abs(runtime.playback().achievedSpeed! - 6) < 1e-9);
    runtime.applyControl({ type: 'speed', speed: EXPERIMENT_PLAYBACK.maxSpeed });
    const start = now, before = runtime.simulation.state.tick;
    assert.equal(runtime.playback().status, 'insufficient_sample');
    for (let i = 1; i <= 31; i++) { now = start + i * 1000 / 30; runtime.pump(); }
    assert.equal(runtime.simulation.state.tick - before, 930);
    assert.ok(Math.abs(runtime.playback().achievedSpeed! - EXPERIMENT_PLAYBACK.maxSpeed) < 1e-9);
    assert.equal(runtime.scheduler.config.maxStepsPerPump, 48);
    assert.throws(() => validateControlAction({ type: 'speed', speed: 60 }), /Unsupported playback speed.*30/);
    const cp = hashRuntimeCheckpoint(runtime.checkpoint());
    assert.throws(() => runtime.applyControl({ type: 'speed', speed: 60 }), /Unsupported playback speed.*30/);
    assert.equal(hashRuntimeCheckpoint(runtime.checkpoint()), cp);
  } finally { await runtime.close(); }
});

test('pause, manual steps, fast-forward and suspension expose explicit observational rate states', async t => {
  const directory = await temp(t); let now = 0;
  const runtime = new BranchRuntime({ worldId: 'w', branchId: 'e', mode: 'EXPERIMENT', directory, clock: { monotonicMs: () => now, utcMs: () => now } });
  try {
    now = 100; runtime.pump(); assert.equal(runtime.playback().status, 'insufficient_sample');
    runtime.applyControl({ type: 'pause' }); now += 1000; runtime.pump();
    assert.equal(runtime.playback().status, 'paused'); assert.equal(runtime.playback().achievedSpeed, null);
    runtime.applyControl({ type: 'step' }); assert.equal(runtime.playback().sampleWorldSeconds, 0);
    runtime.applyControl({ type: 'fast-forward', ticks: 1000 });
    assert.equal(runtime.playback().status, 'fast_forward'); assert.equal(runtime.playback().achievedSpeed, null);
    runtime.applyControl({ type: 'cancel-fast-forward' }); await immediate();
    runtime.applyControl({ type: 'resume' }); const tick = runtime.simulation.state.tick;
    now += 3600000; assert.equal(runtime.pump(), 0); assert.equal(runtime.simulation.state.tick, tick);
    assert.equal(runtime.playback().status, 'suspended'); assert.equal(runtime.playback().achievedSpeed, null);
    now += 30; runtime.pump(); assert.equal(runtime.playback().status, 'insufficient_sample');
    const checkpoint = runtime.checkpoint(); runtime.playback(); runtime.playback();
    assert.equal(hashRuntimeCheckpoint(runtime.checkpoint()), hashRuntimeCheckpoint(checkpoint));
  } finally { await runtime.close(); }
});

test('catch-up loss and sustained underperformance are truthful and diagnostic warnings are bounded', async t => {
  const directory = await temp(t); let now = 0;
  const runtime = new BranchRuntime({ worldId: 'w', branchId: 'e', mode: 'EXPERIMENT', directory, clock: { monotonicMs: () => now, utcMs: () => now } });
  try {
    runtime.applyControl({ type: 'speed', speed: EXPERIMENT_PLAYBACK.maxSpeed });
    for (let i = 0; i < 4; i++) { now += 1000; runtime.pump(); }
    const report = runtime.playback();
    assert.equal(report.requestedSpeed, 30); assert.equal(report.achievedSpeed, 1.6);
    assert.equal(report.underperforming, true); assert.ok(report.catchupLostSeconds > 100);
  } finally { await runtime.close(); }
  const records = (await readRun(runtime.recorder!.runDirectory)).records;
  assert.equal(records.filter(r => r.event_type === 'CATCHUP_SKIPPED').length, 1);
  assert.equal(records.filter(r => r.event_type === 'PLAYBACK_UNDERPERFORMING').length, 1);
});

test('historical 60x artifacts retain replay semantics while active restoration rejects their unsupported rate', () => {
  const offline = new BranchRuntime({ worldId: 'offline', branchId: 'e', mode: 'EXPERIMENT', offline: true });
  const start = offline.checkpoint();
  const operation = { sequence: start.control.nextOperationSequence, tick: start.simulation.tick, kind: 'control' as const, action: { type: 'speed' as const, speed: 60 } };
  offline.replayOperation(operation); const expected = offline.checkpoint();
  assert.equal(validateRuntimeCheckpoint(expected).control.speed, 60);
  assert.equal(replayRuntime(start, [operation], expected).runtimeHash, hashRuntimeCheckpoint(expected));
  assert.throws(() => new BranchRuntime({ worldId: 'w', branchId: 'e', mode: 'EXPERIMENT', checkpoint: expected }), /Saved experiment playback 60.*active 30.*offline/);
});

test('suspend diagnostics count requested scheduled work only, and label UTC jumps separately', () => {
  for (const enabled of [true, false]) {
    let now = 0; const diagnostics: SchedulerDiagnostic[] = [];
    const scheduler = new FixedScheduler(() => assert.fail('gap must not advance simulation'), e => diagnostics.push(e), { monotonicMs: () => now, utcMs: () => now }, { maxStepsPerPump: 48, maxBacklogSteps: 96 });
    now = 6000; assert.equal(scheduler.pump(30, enabled), 0);
    assert.equal(diagnostics[0].data.skippedCatchupTicks, enabled ? 5400 : 0);
    assert.equal(diagnostics[0].data.enabled, enabled); assert.equal(diagnostics[0].data.speed, 30);
  }
  let mono = 0, utc = 0; const diagnostics: SchedulerDiagnostic[] = [];
  const scheduler = new FixedScheduler(() => assert.fail('clock discontinuity must rebase'), e => diagnostics.push(e), { monotonicMs: () => mono, utcMs: () => utc });
  mono = 100; utc = 3600000; assert.equal(scheduler.pump(30), 0);
  assert.equal(diagnostics[0].data.skippedCatchupTicks, 90);
  assert.equal(diagnostics[0].data.monotonicGapMs, 100); assert.equal(diagnostics[0].data.wallGapMs, 3600000);
  assert.equal(diagnostics[0].data.reason, 'host_gap_or_clock_discontinuity');
});

test('dormant replacements preserve backlog and pending fast-forward without admitting any branch work', async t => {
  const directory = await temp(t); let now = 0;
  const source = new BranchRuntime({ worldId: 'offline', branchId: 'e', mode: 'EXPERIMENT', offline: true });
  source.applyControl({ type: 'fast-forward', ticks: 20 }); const saved = source.checkpoint();
  let events = 0;
  const candidate = new BranchRuntime({ worldId: 'w', branchId: 'e', mode: 'EXPERIMENT', checkpoint: saved, directory, dormant: true, clock: { monotonicMs: () => now, utcMs: () => now }, onEvents: e => { events += e.length; } });
  try {
    assert.throws(() => candidate.activate(), /prepared/);
    assert.throws(() => candidate.enqueue({ type: 'slam' }), /dormant/);
    assert.throws(() => candidate.applyControl({ type: 'resume' }), /dormant/);
    const dormantHash = hashRuntimeCheckpoint(candidate.checkpoint());
    assert.throws(() => candidate.replayOperation({ sequence: saved.control.nextOperationSequence, tick: saved.simulation.tick, kind: 'advance', ticks: 1, backlogMs: 0, source: 'fast-forward' }), /dormant/);
    assert.equal(hashRuntimeCheckpoint(candidate.checkpoint()), dormantHash);
    now = 1000; assert.equal(candidate.pump(), 0); await immediate();
    assert.equal(candidate.simulation.state.tick, saved.simulation.tick); assert.equal(events, 0);
    await candidate.prepare(); await immediate(); assert.equal(candidate.simulation.state.tick, saved.simulation.tick);
    candidate.activate(); await immediate(); assert.equal(candidate.simulation.state.tick, saved.simulation.tick + 20);
  } finally { await candidate.close(); }
  const scheduled = structuredClone(saved); scheduled.control.paused = false; scheduled.control.fastForwardRemaining = 0; scheduled.scheduler.backlogMs = 10;
  const candidateWithBacklog = new BranchRuntime({ worldId: 'w', branchId: 'backlog', mode: 'EXPERIMENT', checkpoint: scheduled, directory, dormant: true, clock: { monotonicMs: () => now, utcMs: () => now } });
  try { await candidateWithBacklog.prepare(); now += 3000; candidateWithBacklog.activate(); assert.equal(candidateWithBacklog.scheduler.backlogMs, 10); assert.equal(candidateWithBacklog.pump(), 0); }
  finally { await candidateWithBacklog.close(); }
});
