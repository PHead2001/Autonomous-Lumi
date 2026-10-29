import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { captureFromServer, captureResultDeadlineMs } from '../server/vision/client.js';
import { CAPTURE_LIMITS } from '../shared/capture-protocol.js';
import { spawn } from 'node:child_process';
import { waitForCleanupCommand } from '../server/vision/renderer.js';

test('CLI result deadline covers the full admitted capture queue and remains bounded', () => {
  assert.equal(captureResultDeadlineMs(), CAPTURE_LIMITS.capacity * (CAPTURE_LIMITS.timeoutMs + CAPTURE_LIMITS.cleanupTimeoutMs) + 5000);
  assert.equal(captureResultDeadlineMs(), 105000);
  for (const timing of [{ capacity: 0, timeoutMs: 20, cleanupTimeoutMs: 5, transportSlackMs: 1 }, { capacity: 4, timeoutMs: Number.NaN, cleanupTimeoutMs: 5, transportSlackMs: 1 }, { capacity: Number.MAX_SAFE_INTEGER, timeoutMs: 20, cleanupTimeoutMs: 5, transportSlackMs: 1 }]) assert.throws(() => captureResultDeadlineMs(timing), /bounded|bound/);
});
test('a stuck owned cleanup subprocess is terminated within its bounded helper wait', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  assert.ok(child.pid); await assert.rejects(waitForCleanupCommand(child, 20), /timed out/);
  assert.throws(() => process.kill(child.pid!, 0));
});
test('actual CLI HTTP client receives the fourth queued result after three full service slots', async () => {
  const scope = { worldId: 'queue-world', branchId: 'experiment', runId: 'queue-run' };
  const perSlotMs = 80, slackMs = 200, served: number[] = [], bytes = new Uint8Array([137, 80, 78, 71]);
  let complete!: () => void;
  const completed = new Promise<void>(done => { complete = done; });
  const metadata = { ...scope, captureId: 'fourth-capture', status: 'success' };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    if (url.pathname === '/api/vision/capture') {
      // The first three admitted jobs already occupy this sequential fixture's earlier slots.
      void (async () => { for (let slot = 1; slot <= 4; slot++) { await new Promise(done => setTimeout(done, perSlotMs)); served.push(slot); } complete(); })();
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ...metadata, status: 'queued' })); return;
    }
    assert.equal(url.searchParams.get('worldId'), scope.worldId); assert.equal(url.searchParams.get('branchId'), scope.branchId); assert.equal(url.searchParams.get('runId'), scope.runId); assert.equal(url.searchParams.get('captureId'), metadata.captureId);
    if (url.pathname === '/api/vision/result') { await completed; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(metadata)); return; }
    response.setHeader('Content-Type', 'image/png'); response.end(bytes);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const result = await captureFromServer(new URL(`http://127.0.0.1:${address.port}`), scope, 512, { capacity: 4, timeoutMs: perSlotMs, cleanupTimeoutMs: 5, transportSlackMs: slackMs });
    assert.deepEqual(served, [1, 2, 3, 4]); assert.deepEqual(result.bytes, bytes); assert.equal(result.metadata.captureId, metadata.captureId);
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});
