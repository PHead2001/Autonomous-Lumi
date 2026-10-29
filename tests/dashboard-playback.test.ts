import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENT_PLAYBACK, type PlaybackReport } from '../shared/lab-protocol.js';
import { parsePlaybackSpeed, playbackPresentation } from '../src/dashboard-playback.js';

const report = (overrides: Partial<PlaybackReport> = {}): PlaybackReport => ({ requestedSpeed: 30, achievedSpeed: 17.5, status: 'running', sampleHostSeconds: 2, sampleWorldSeconds: 35, catchupLostSeconds: 0, underperforming: false, ...overrides });

test('playback copy keeps actual advancement separate from the requested speed', () => {
  const result = playbackPresentation(report());
  assert.equal(result.requested, 'Requested 30×');
  assert.equal(result.achieved, 'Achieved 17.5×');
  assert.match(result.detail, /35 world seconds \/ 2 measured host seconds/);
});

test('exceptional playback states never display a requested or stale measured rate as achieved', () => {
  for (const status of ['paused', 'fast_forward', 'suspended', 'insufficient_sample'] as const) {
    const result = playbackPresentation(report({ status, achievedSpeed: 30 }));
    assert.equal(result.achieved, 'Achieved —');
    assert.doesNotMatch(result.detail, /measured host seconds/);
  }
  assert.equal(playbackPresentation(report({ achievedSpeed: null })).achieved, 'Achieved —');
});

test('playback loss and sustained underperformance remain visible', () => {
  const result = playbackPresentation(report({ catchupLostSeconds: 4, underperforming: true }));
  assert.equal(result.warning, true);
  assert.match(result.detail, /4 world seconds of catch-up discarded/);
  assert.match(result.detail, /below the requested speed/);
});

test('dashboard speed admission uses the shared active playback limit', () => {
  assert.equal(parsePlaybackSpeed(String(EXPERIMENT_PLAYBACK.defaultSpeed)), EXPERIMENT_PLAYBACK.defaultSpeed);
  assert.equal(parsePlaybackSpeed(String(EXPERIMENT_PLAYBACK.maxSpeed)), EXPERIMENT_PLAYBACK.maxSpeed);
  for (const value of ['', '0', '60', 'Infinity', 'NaN']) assert.throws(() => parsePlaybackSpeed(value), /Playback speed must be/);
});
