import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectTimelineRun } from '../src/dashboard-selection.js';

const branch = 'world/experiment-a';

test('a restore selects its new run even when an earlier refresh already supplied the same run options', () => {
  const availableRuns = ['previous-run', 'restored-run'];
  const refreshed = selectTimelineRun({ targetKey: branch, currentRunId: 'restored-run', availableRuns, selectedRunId: 'previous-run' });
  assert.equal(refreshed.selectedRunId, 'previous-run');
  // The POST response arrives after that refresh, without any change to options.
  const restored = selectTimelineRun({ targetKey: branch, currentRunId: 'restored-run', availableRuns, selectedRunId: refreshed.selectedRunId, pendingRestore: { targetKey: branch, runId: 'restored-run' } });
  assert.equal(restored.selectedRunId, 'restored-run');
  assert.equal(restored.pendingRestore, undefined);
});

test('ordinary refresh preserves an explicitly selected historical run', () => {
  const result = selectTimelineRun({ targetKey: branch, currentRunId: 'current-run', availableRuns: ['previous-run', 'current-run'], selectedRunId: 'previous-run' });
  assert.equal(result.selectedRunId, 'previous-run');
  assert.equal(result.pendingRestore, undefined);
});

test('a different branch cannot consume or apply a pending restore selection', () => {
  const pendingRestore = { targetKey: branch, runId: 'restored-run' };
  const result = selectTimelineRun({ targetKey: 'world/experiment-b', currentRunId: 'branch-b-run', availableRuns: ['branch-b-run'], selectedRunId: 'branch-b-run', pendingRestore });
  assert.equal(result.selectedRunId, 'branch-b-run');
  assert.equal(result.pendingRestore, pendingRestore);
});

test('pending restored run is retained until it appears in available evidence', () => {
  const pendingRestore = { targetKey: branch, runId: 'restored-run' };
  const before = selectTimelineRun({ targetKey: branch, currentRunId: 'previous-run', availableRuns: ['previous-run'], selectedRunId: 'previous-run', pendingRestore });
  assert.equal(before.selectedRunId, 'previous-run');
  assert.equal(before.pendingRestore, pendingRestore);
  const after = selectTimelineRun({ targetKey: branch, currentRunId: 'restored-run', availableRuns: ['previous-run', 'restored-run'], selectedRunId: before.selectedRunId, pendingRestore: before.pendingRestore });
  assert.equal(after.selectedRunId, 'restored-run');
  assert.equal(after.pendingRestore, undefined);
});
