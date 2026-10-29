import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedDescendants, type ProcessResource } from '../server/vision/resources.js';
test('resource ownership rejects older processes whose dead parent PID was reused', () => {
  const p = (processId: number, parentProcessId: number, age: number): ProcessResource => ({ processId, parentProcessId, startedAt: new Date(age * 1000).toISOString(), cpuMs: age, rssBytes: 100 });
  const rows = [p(10, 1, 100), p(20, 10, 110), p(30, 10, 20), p(40, 30, 30), p(50, 20, 120), p(60, 20, 5), p(70, 10, 130), p(80, 70, 140)];
  assert.deepEqual(ownedDescendants(rows, 10, 70).map(process => process.processId), [20, 50]);
});
