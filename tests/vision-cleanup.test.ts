import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CleanupCommandFailure, cleanupWindowsBrowser, commandLineUsesProfile, readCleanupQueryOutput, waitForCleanupCommand, waitForOwnedExit, windowsProfileProcesses, WINDOWS_CLEANUP_TIMING, type WindowsCleanupOperations } from '../server/vision/cleanup.js';
import { CAPTURE_LIMITS } from '../shared/capture-protocol.js';

const profile = 'C:\\Temp\\lumi-renderer-owned profile';
const fakeChild = (alreadyExited = false) => Object.assign(new EventEmitter(), { pid: 54321, exitCode: alreadyExited ? 1 : null, signalCode: null, kill: () => true }) as unknown as ChildProcess;
const defaults = (): WindowsCleanupOperations => ({ killTree: async () => {}, waitForExit: async () => {}, profileProcesses: async () => [] });

test('nonzero taskkill is accepted only after owned-root exit and independent profile absence', async () => {
  const child = fakeChild(), calls: string[] = [];
  await cleanupWindowsBrowser(child, profile, {
    killTree: async () => { calls.push('kill'); throw new CleanupCommandFailure('exit', 128); },
    waitForExit: async (owned, timeout) => { assert.equal(owned, child); assert.equal(timeout, 500); calls.push('exit'); Object.assign(child, { exitCode: 1 }); },
    profileProcesses: async value => { assert.equal(value, profile); assert.equal(child.exitCode, 1); calls.push('profile'); return []; },
  });
  assert.deepEqual(calls, ['kill', 'exit', 'profile']);
});

test('Windows exit-race reconciliation stays within the existing manager cleanup budget', () => {
  const maximum = WINDOWS_CLEANUP_TIMING.treeKillMs + WINDOWS_CLEANUP_TIMING.nonzeroRootExitMs + WINDOWS_CLEANUP_TIMING.profileQueryMs + WINDOWS_CLEANUP_TIMING.queryStopGraceMs;
  assert.ok(maximum + 600 <= CAPTURE_LIMITS.cleanupTimeoutMs, 'leave room for the existing 100+200+300ms profile removal retries');
});

test('a live owned root remains a cleanup failure and does not consult a misleading empty profile result', async () => {
  let queried = false;
  await assert.rejects(cleanupWindowsBrowser(fakeChild(), profile, {
    ...defaults(), killTree: async () => { throw new CleanupCommandFailure('exit', 128); },
    waitForExit: async () => { throw new Error('Owned renderer did not exit'); },
    profileProcesses: async () => { queried = true; return []; },
  }), /did not exit/);
  assert.equal(queried, false);
});

test('surviving profile descendants remain a failure after root exit and are rechecked on explicit retry', async () => {
  const child = fakeChild(true); let kills = 0, checks = 0, remaining = [76543];
  const ops: WindowsCleanupOperations = { ...defaults(), killTree: async () => { kills++; }, profileProcesses: async () => { checks++; return remaining; } };
  await assert.rejects(cleanupWindowsBrowser(child, profile, ops), /profile processes remain/);
  remaining = []; await cleanupWindowsBrowser(child, profile, ops);
  assert.equal(kills, 0, 'an exited root PID is never reused as a kill target'); assert.equal(checks, 2);
});

test('helper timeout, launch error, signal and profile-query failure are not benign-exit success', async () => {
  for (const kind of ['timeout', 'launch', 'signal'] as const) {
    let waited = false, queried = false;
    await assert.rejects(cleanupWindowsBrowser(fakeChild(), profile, { killTree: async () => { throw new CleanupCommandFailure(kind); }, waitForExit: async () => { waited = true; }, profileProcesses: async () => { queried = true; return []; } }), error => error instanceof CleanupCommandFailure && error.kind === kind);
    assert.equal(waited, false); assert.equal(queried, false);
  }
  await assert.rejects(cleanupWindowsBrowser(fakeChild(true), profile, { ...defaults(), profileProcesses: async () => { throw new Error('query unavailable'); } }), /query unavailable/);
  await assert.rejects(cleanupWindowsBrowser(fakeChild(true), undefined, defaults()), /profile is unavailable/);
});

test('exact profile recognition handles Windows quoting and excludes prefixes and incidental path text', () => {
  for (const line of [`chrome.exe "--user-data-dir=${profile}" --headless`, `chrome.exe --user-data-dir="${profile}" --type=gpu-process`, 'chrome.exe --user-data-dir=C:\\Temp\\lumi-renderer-simple']) assert.equal(commandLineUsesProfile(line, line.includes('simple') ? 'c:/temp/lumi-renderer-simple/' : profile), true);
  for (const line of [`chrome.exe "--user-data-dir=${profile}-other"`, `chrome.exe --database="${profile}"`, `chrome.exe "--user-data-dir=${profile}\\child"`, `chrome.exe --not-user-data-dir="${profile}"`]) assert.equal(commandLineUsesProfile(line, profile), false);
});

test('helper wait preserves typed normally-exited nonzero status', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(128)'], { stdio: 'ignore', windowsHide: true });
  await assert.rejects(waitForCleanupCommand(child, 2000), error => error instanceof CleanupCommandFailure && error.kind === 'exit' && error.exitCode === 128);
});

test('profile-query success waits for the stdout tail after process exit', async () => {
  const stdout = new PassThrough(), child = Object.assign(new EventEmitter(), { stdout, kill: () => true }) as unknown as ChildProcess;
  let complete = false; const result = readCleanupQueryOutput(child).then(value => { complete = true; return value; });
  stdout.write('[{"processId":123,'); child.emit('exit', 0, null); await new Promise(done => setImmediate(done));
  assert.equal(complete, false);
  stdout.end('"commandLine":"chrome.exe --user-data-dir=C:\\\\Temp\\\\lumi-renderer-owned"}]'); child.emit('close', 0, null);
  assert.equal(JSON.parse(await result)[0].processId, 123);
});

test('actual query-output reader receives the complete multi-chunk helper payload', async () => {
  const payload = JSON.stringify([{ processId: 123, commandLine: 'x'.repeat(48000) }]);
  const child = spawn(process.execPath, ['-e', "process.stdout.write(JSON.stringify([{processId:123,commandLine:'x'.repeat(48000)}]), () => process.exit(0));"], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  assert.equal(await readCleanupQueryOutput(child), payload);
});

test('profile-query output preserves a Unicode profile character split between chunks', async () => {
  const stdout = new PassThrough(), child = Object.assign(new EventEmitter(), { stdout, kill: () => true }) as unknown as ChildProcess;
  const expected = JSON.stringify([{ processId: 123, commandLine: 'chrome.exe --user-data-dir=C:\\Temp\\lumi-renderer-雪' }]);
  const bytes = Buffer.from(expected), split = bytes.indexOf(Buffer.from('雪')) + 1;
  const result = readCleanupQueryOutput(child);
  stdout.write(bytes.subarray(0, split)); await new Promise(done => setImmediate(done)); stdout.end(bytes.subarray(split)); child.emit('close', 0, null);
  assert.equal(await result, expected);
});

test('invalid profile-query UTF-8 fails closed instead of altering a process path', async () => {
  const stdout = new PassThrough(), child = Object.assign(new EventEmitter(), { stdout, kill: () => true }) as unknown as ChildProcess;
  const result = readCleanupQueryOutput(child); stdout.write(Buffer.from([0xff]));
  await assert.rejects(result, /invalid UTF-8 encoding/); child.emit('close', 0, null);
});

test('a real owned process can exit just after helper failure and reconcile safely', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  try {
    await cleanupWindowsBrowser(child, profile, { ...defaults(), killTree: async () => { setTimeout(() => child.kill(), 25); throw new CleanupCommandFailure('exit', 128); }, waitForExit: waitForOwnedExit });
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill(); await waitForOwnedExit(child, 1000); } }
});

test('Windows profile query finds a quoted owned argument and excludes a live prefix lookalike', { skip: process.platform !== 'win32' }, async () => {
  const ownedProfile = await mkdtemp(join(tmpdir(), 'lumi-renderer-query with spaces-雪-'));
  const owned = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${ownedProfile}`], { stdio: 'ignore', windowsHide: true });
  const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${ownedProfile}-other`], { stdio: 'ignore', windowsHide: true });
  try { assert.deepEqual(await windowsProfileProcesses(ownedProfile), [owned.pid]); }
  finally { owned.kill(); other.kill(); await Promise.all([waitForOwnedExit(owned, 1000), waitForOwnedExit(other, 1000)]); await rm(ownedProfile, { recursive: true, force: true }); }
});
