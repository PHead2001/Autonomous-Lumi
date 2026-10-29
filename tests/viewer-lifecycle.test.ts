import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ViewerLifecycle } from '../src/viewer-lifecycle.js';

function harness() {
  const page = new EventTarget();
  const sockets: { closed: boolean }[] = [];
  let retryPending = false;
  const lifecycle = new ViewerLifecycle(page, {
    resume() { retryPending = false; sockets.push({ closed: false }); },
    suspend() { retryPending = false; const socket = sockets.at(-1); if (socket) socket.closed = true; },
  });
  const show = (persisted: boolean) => page.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }));
  return { page, sockets, lifecycle, show, scheduleRetry: () => { retryPending = true; }, hasRetry: () => retryPending };
}

test('BFCache restore reconnects a suspended active viewer exactly once', () => {
  const h = harness(); h.lifecycle.connect();
  h.page.dispatchEvent(new Event('pagehide'));
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.lifecycle.shouldReconnect, false);
  h.show(true);
  assert.equal(h.sockets.length, 2);
  assert.equal(h.sockets[1].closed, false);
  assert.equal(h.lifecycle.shouldReconnect, true);
  h.show(true);
  assert.equal(h.sockets.length, 2);
});

test('BFCache restore preserves deliberate Disconnect viewer until manual reconnect', () => {
  const h = harness(); h.lifecycle.connect(); h.lifecycle.disconnect();
  h.page.dispatchEvent(new Event('pagehide')); h.show(true);
  assert.equal(h.sockets.length, 1);
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.lifecycle.shouldReconnect, false);
  h.lifecycle.connect();
  assert.equal(h.sockets.length, 2);
  assert.equal(h.lifecycle.shouldReconnect, true);
});

test('pagehide cancels pending retries and BFCache restore resumes an interrupted connection', () => {
  const h = harness(); h.lifecycle.connect(); h.sockets[0].closed = true; h.scheduleRetry();
  h.page.dispatchEvent(new Event('pagehide'));
  assert.equal(h.hasRetry(), false);
  assert.equal(h.lifecycle.shouldReconnect, false);
  h.show(true);
  assert.equal(h.sockets.length, 2);
  assert.equal(h.lifecycle.shouldReconnect, true);
});

test('ordinary initial pageshow does not create a duplicate connection', () => {
  const h = harness(); h.lifecycle.connect(); h.show(false);
  assert.equal(h.sockets.length, 1);
});
