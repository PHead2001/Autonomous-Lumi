import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ControlAction } from '../shared/lab-protocol.js';
import { runCapturedControl } from '../src/dashboard-control.js';

test('a control captures edited speed before the busy render refreshes the form', async () => {
  let field = 30, reads = 0;
  let submitted: ControlAction | undefined;
  await runCapturedControl(() => { reads++; return { type: 'speed', speed: field }; }, async payload => {
    // Starting the actual dashboard operation renders authoritative state first.
    field = 6;
    submitted = payload;
  });
  assert.deepEqual(submitted, { type: 'speed', speed: 30 });
  assert.equal(reads, 1);
});

test('logging fields are captured together before a state refresh changes selection', async () => {
  const fields: ControlAction = { type: 'logging', mode: 'verbose', compressClosed: true };
  let submitted: ControlAction | undefined;
  await runCapturedControl(() => fields, async payload => {
    fields.mode = 'default'; fields.compressClosed = false;
    submitted = payload;
  });
  assert.deepEqual(submitted, { type: 'logging', mode: 'verbose', compressClosed: true });
});

test('validation failure rejects before starting a render or sending a control', async () => {
  let started = false;
  await assert.rejects(runCapturedControl(() => { throw new Error('unsupported speed'); }, async () => { started = true; }), /unsupported speed/);
  assert.equal(started, false);
});
