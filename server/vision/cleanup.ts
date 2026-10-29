import { spawn, type ChildProcess } from 'node:child_process';
import { win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WINDOWS_CLEANUP_TIMING = { treeKillMs: 2000, rootCleanupMs: 2500, profileQueryMs: 1250, queryStopGraceMs: 250 } as const;

export class CleanupCommandFailure extends Error {
  constructor(readonly kind: 'exit' | 'signal' | 'timeout' | 'launch', readonly exitCode: number | null = null) {
    super(kind === 'exit' ? `Renderer process tree cleanup failed (exit ${exitCode})` : kind === 'signal' ? 'Renderer cleanup command was interrupted' : kind === 'launch' ? 'Renderer cleanup command could not start' : 'Renderer cleanup command timed out');
  }
}
const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

/** Bounds the helper itself. A timeout or launch failure is never an ordinary exit race. */
export function waitForCleanupCommand(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((done, reject) => {
    let settled = false, expired = false, hardStop: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(hardStop);
      child.removeListener('error', onError); child.removeListener('exit', onExit);
      if (error) reject(error); else done();
    };
    const onError = () => finish(new CleanupCommandFailure('launch'));
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => finish(expired ? new CleanupCommandFailure('timeout') : signal || code === null ? new CleanupCommandFailure('signal') : code !== 0 ? new CleanupCommandFailure('exit', code) : undefined);
    child.once('error', onError); child.once('exit', onExit);
    const timer = setTimeout(() => {
      expired = true;
      try { child.kill(); } catch { finish(new CleanupCommandFailure('timeout')); return; }
      hardStop = setTimeout(() => finish(new CleanupCommandFailure('timeout')), 1000);
    }, timeoutMs);
    if (exited(child)) onExit(child.exitCode, child.signalCode);
  });
}

export function waitForOwnedExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((done, reject) => {
    if (exited(child)) return done();
    const onExit = () => { clearTimeout(timer); done(); };
    const timer = setTimeout(() => { child.removeListener('exit', onExit); try { child.kill('SIGKILL'); } catch { /* the failed exit is reported below */ } reject(new Error('Owned renderer did not exit')); }, timeoutMs);
    child.once('exit', onExit);
  });
}

/** Accept whole-argument quoting and Chromium's quoted-value form, but never a path prefix. */
export function commandLineUsesProfile(commandLine: string, profile: string): boolean {
  const match = /(?:^|\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\s"]+))(?=\s|$)/i.exec(commandLine);
  if (!match) return false;
  const normalize = (path: string) => win32.normalize(path).replace(/[\\/]+$/, '').toLowerCase();
  return normalize(match[1] ?? match[2] ?? match[3]) === normalize(profile);
}

/** Read-only reconciliation. The script emits only candidates containing this unique profile;
 * exact argument matching happens here. Process IDs are evidence and are never termination targets. */
export function readCleanupQueryOutput(child: ChildProcess): Promise<string> {
  const stdout = child.stdout;
  if (!stdout) return Promise.reject(new Error('Renderer profile cleanup verification output is unavailable'));
  return new Promise<string>((done, reject) => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '', settled = false, expired = false, hardStop: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(hardStop); stdout.removeListener('data', onData); if (error) reject(error); else done(text); };
    const timer = setTimeout(() => { expired = true; child.kill(); hardStop = setTimeout(() => finish(new Error('Renderer profile cleanup verification timed out')), WINDOWS_CLEANUP_TIMING.queryStopGraceMs); }, WINDOWS_CLEANUP_TIMING.profileQueryMs);
    const onData = (data: Buffer) => {
      try { text += decoder.decode(data, { stream: true }); }
      catch { child.kill(); finish(new Error('Renderer profile cleanup verification returned invalid UTF-8 encoding')); return; }
      if (text.length > 65536) { child.kill(); finish(new Error('Renderer profile cleanup verification exceeded its bound')); }
    };
    stdout.on('data', onData);
    child.once('error', () => finish(new Error('Renderer profile cleanup verification could not start')));
    // 'exit' can precede delivery of the final stdout chunk. Only 'close' proves
    // the JSON pipe has drained as well as the query process having terminated.
    child.once('close', code => {
      if (settled) return;
      if (expired || code !== 0) return finish(new Error(expired ? 'Renderer profile cleanup verification timed out' : 'Renderer profile cleanup verification failed'));
      try { text += decoder.decode(); }
      catch { return finish(new Error('Renderer profile cleanup verification returned invalid UTF-8 encoding')); }
      finish();
    });
  });
}
export async function windowsProfileProcesses(profile: string): Promise<number[]> {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./cleanup-profile.ps1', import.meta.url)), '-Profile', profile], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const output = await readCleanupQueryOutput(child);
  let rows: unknown;
  try { rows = JSON.parse(output); } catch { throw new Error('Renderer profile cleanup verification returned invalid data'); }
  if (!Array.isArray(rows) || rows.length > 128) throw new Error('Renderer profile cleanup verification returned invalid data');
  return rows.flatMap(row => {
    if (!row || typeof row !== 'object' || !Number.isSafeInteger(row.processId) || row.processId <= 0 || typeof row.commandLine !== 'string') throw new Error('Renderer profile cleanup verification returned invalid data');
    return commandLineUsesProfile(row.commandLine, profile) ? [row.processId as number] : [];
  });
}

export interface WindowsCleanupOperations {
  killTree(child: ChildProcess): Promise<void>;
  waitForExit(child: ChildProcess, timeoutMs: number): Promise<void>;
  profileProcesses(profile: string): Promise<number[]>;
  now?: () => number;
}
const operations: WindowsCleanupOperations = {
  killTree: child => waitForCleanupCommand(spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }), WINDOWS_CLEANUP_TIMING.treeKillMs),
  waitForExit: waitForOwnedExit,
  profileProcesses: windowsProfileProcesses,
};

/** A normal nonzero taskkill exit may race Chromium's own shutdown. Confirm the actual
 * owned root exit and absence of its unique profile processes before accepting that race. */
export async function cleanupWindowsBrowser(child: ChildProcess, profile: string | undefined, ops: WindowsCleanupOperations = operations): Promise<void> {
  const now = ops.now ?? (() => performance.now());
  const rootDeadline = now() + WINDOWS_CLEANUP_TIMING.rootCleanupMs;
  let reconcileProfile = exited(child);
  if (!reconcileProfile) {
    try { await ops.killTree(child); }
    catch (error) {
      if (!(error instanceof CleanupCommandFailure) || error.kind !== 'exit') throw error;
      reconcileProfile = true;
      // taskkill can report a descendant race while the original root is still alive.
      // Terminate only our retained process handle, then OBSERVE its exit before
      // consulting the read-only profile query. Never target a discovered PID.
      if (!exited(child)) child.kill('SIGKILL');
    }
    await ops.waitForExit(child, Math.max(0, rootDeadline - now()));
  }
  if (reconcileProfile) {
    if (!profile) throw new Error('Owned renderer profile is unavailable for cleanup verification');
    if ((await ops.profileProcesses(profile)).length) throw new Error('Owned renderer profile processes remain after cleanup');
  }
}
