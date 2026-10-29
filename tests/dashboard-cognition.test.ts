import test from 'node:test';
import assert from 'node:assert/strict';
import { cognitionActionLabel, cognitionFrameUrl, modelResponseMetric, selectCognitionRequest, validateCognitionViewScope, type CognitionRequestView, type CognitionView } from '../src/dashboard-cognition.js';
import { VisionRequestGate } from '../src/dashboard-vision.js';

const target = { worldId: 'lumi', branchId: 'trial', runId: 'run-one' };
const item = (id: string) => ({ requestId: id, observationId: `capture-${id}`, frameHash: 'a'.repeat(64) }) as CognitionRequestView;
test('cognition selection keeps the inspected request as newer responses arrive and clears an empty run', () => {
  const first = item('first'), second = item('second');
  assert.equal(selectCognitionRequest([first, second], first.requestId), first);
  assert.equal(selectCognitionRequest([second], first.requestId), second);
  assert.equal(selectCognitionRequest([], first.requestId), null);
});
test('cognition response scope and asynchronous selection reject stale or foreign evidence', () => {
  const gate = new VisionRequestGate(); gate.select(target); const old = gate.begin();
  gate.select({ ...target, runId: 'replacement' }); assert.equal(gate.accepts(old), false);
  const view = { ...target, requests: [item('one')] } as CognitionView;
  assert.doesNotThrow(() => validateCognitionViewScope(view, target));
  assert.throws(() => validateCognitionViewScope(view, { ...target, runId: 'replacement' }), /selected world/);
  assert.throws(() => validateCognitionViewScope({ ...view, requests: [item('one'), item('one')] }, target), /bounded request/);
});
test('associated model frame uses the immutable recorded capture rather than another latest image', () => {
  const request = { ...item('original'), captureId: 'bound-image' };
  const url = new URL(cognitionFrameUrl(target, request), 'http://127.0.0.1');
  assert.equal(url.searchParams.get('captureId'), 'bound-image'); assert.equal(url.searchParams.get('runId'), target.runId);
  assert.equal(new URL(cognitionFrameUrl(target, item('legacy')), 'http://127.0.0.1').searchParams.get('captureId'), 'capture-legacy');
  assert.throws(() => cognitionFrameUrl(target, { ...request, captureId: '../other' }), /invalid identity/);
});
test('model metrics stay N/A without data and action execution never implies physical completion', () => {
  for (const value of [null, undefined, NaN, Infinity, -1]) assert.equal(modelResponseMetric(value), 'N/A');
  assert.equal(modelResponseMetric(0), '0 s');
  assert.match(cognitionActionLabel({ status: 'executed', reason: 'head_action_started', actionId: 9, tick: 31 }), /Started \/ queued.*does not establish physical completion/);
  assert.match(cognitionActionLabel({ status: 'rejected', reason: 'stale', actionId: null, tick: 31 }), /No proposed action was executed/);
});
