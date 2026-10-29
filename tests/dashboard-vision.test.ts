import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CaptureMetadata, CaptureView } from '../shared/capture-protocol.js';
import { VisionCaptureDeadline, VisionRequestGate, displayedCapture, validateCaptureViewScope } from '../src/dashboard-vision.js';

const scope = { worldId: 'lumi', branchId: 'experiment', runId: 'run-1' };
const metadata = (captureId: string, status: CaptureMetadata['status'], runId = scope.runId) => ({ ...scope, runId, captureId, status }) as CaptureMetadata;
const view = (latest: CaptureMetadata | null, previousSuccess: CaptureMetadata | null = null) => ({ latest, previousSuccess, observation: null, privateGrounding: null, cleanupError: null, limits: { queued: 0, capacity: 4, retainedFrames: 1, maxRetainedFrames: 8, timeoutMs: 20000 } }) satisfies CaptureView;

test('automatic dashboard refresh still accepts a queued completion after ninety seconds', async () => {
  let now = 0, fetched = 0;
  const deadline = new VisionCaptureDeadline(() => now);
  let current = metadata('late-fourth-job', 'queued');
  // Both an initial pending GET response and a successful POST admission enter this helper.
  deadline.observe(current);
  now = 95000;
  if (!deadline.expired(current)) {
    current = await Promise.resolve().then(() => { fetched++; return metadata('late-fourth-job', 'success'); });
    deadline.observe(current);
  }
  assert.equal(fetched, 1); assert.equal(current.status, 'success');
  assert.equal(deadline.expired(current), false);
});

test('pending refreshes preserve one full queue and cleanup budget without extending it', () => {
  let now = 1000;
  const deadline = new VisionCaptureDeadline(() => now), queued = metadata('bounded-job', 'queued');
  deadline.observe(queued);
  now = 106000 - 1;
  deadline.observe({ ...queued, status: 'pending' });
  assert.equal(deadline.expired(queued), false);
  now = 106000;
  assert.equal(deadline.expired(queued), true);
  now = 200000;
  assert.equal(deadline.expired(queued), true);
});

test('another pending capture gets a fresh budget after the previous capture expires or finishes', () => {
  let now = 0;
  const deadline = new VisionCaptureDeadline(() => now), first = metadata('first', 'queued');
  deadline.observe(first); now = 105001; assert.equal(deadline.expired(first), true);
  const second = metadata('second', 'queued');
  deadline.observe(second); now += 95000; assert.equal(deadline.expired(second), false);
  deadline.observe({ ...second, status: 'success' });
  const third = metadata('third', 'pending');
  now += 100000;
  assert.equal(deadline.expired(third), false);
  now += 105000;
  assert.equal(deadline.expired(third), true);
  deadline.reset(); assert.equal(deadline.expired(third), false);
});

test('late capture requests cannot cross a branch or restored run, including switching back', () => {
  const gate = new VisionRequestGate();
  gate.select(scope);
  const old = gate.begin();
  gate.select({ ...scope, branchId: 'other' });
  assert.equal(gate.accepts(old), false);
  gate.select(scope);
  assert.equal(gate.accepts(old), false);
  const current = gate.begin();
  gate.select({ ...scope, runId: 'run-2' });
  assert.equal(gate.accepts(current), false);
});

test('an older refresh cannot overwrite a newer capture response in the same run', () => {
  const gate = new VisionRequestGate(); gate.select(scope);
  const first = gate.begin(), second = gate.begin();
  assert.equal(gate.accepts(first), false); assert.equal(gate.accepts(second), true);
  assert.equal(gate.select(scope), false); assert.equal(gate.accepts(second), true);
});

test('failed and pending captures retain only an explicitly previous successful image', () => {
  const success = metadata('old', 'success');
  for (const status of ['pending', 'queued', 'timeout', 'unavailable', 'failed', 'stale'] as const) {
    assert.deepEqual(displayedCapture(view(metadata('new', status), success)), { frame: success, previous: true });
  }
  assert.deepEqual(displayedCapture(view(success)), { frame: success, previous: false });
  assert.deepEqual(displayedCapture(view(metadata('new', 'unavailable'))), { frame: null, previous: false });
  assert.deepEqual(displayedCapture(view(metadata('evicted', 'stale'))), { frame: null, previous: false });
  assert.deepEqual(displayedCapture({ ...view(success), cleanupError: 'profile cleanup failed' }), { frame: success, previous: false });
});

test('foreign preview or observation evidence is refused instead of rendered', () => {
  assert.throws(() => validateCaptureViewScope(view(metadata('foreign', 'success', 'run-2')), scope), /selected world/);
  assert.throws(() => validateCaptureViewScope(view(null, metadata('foreign', 'success', 'run-2')), scope), /selected world/);
  assert.doesNotThrow(() => validateCaptureViewScope(view(metadata('same', 'success')), scope));
});

