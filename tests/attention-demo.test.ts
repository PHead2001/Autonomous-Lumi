import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { startAttentionDemo } from '../server/vision/attention-demo.js';

test('attention demo starts from the current simulation schema inside a current runtime envelope', async () => {
  const demo = await startAttentionDemo();
  try {
    const checkpoint = demo.experiment.checkpoint();
    assert.equal(checkpoint.schemaVersion, 8);
    assert.equal(checkpoint.simulation.schemaVersion, 9);
    assert.equal(checkpoint.mode, 'EXPERIMENT');
    assert.equal(demo.manifest.provenance, 'TEST STUB');
  } finally {
    await demo.world.close();
    await rm(demo.directory, { recursive: true, force: true });
  }
});
