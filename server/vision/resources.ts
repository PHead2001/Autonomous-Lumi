import { spawn, type ChildProcess } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export interface ProcessResource { processId: number; parentProcessId: number; startedAt: string; cpuMs: number; rssBytes: number }
export interface ProcessSample { timestamp: string; processes: ProcessResource[] }
/** Windows retains the numeric parent PID after parent exit. Creation times prevent attaching an
 * unrelated older process whose dead parent's PID was reused by this benchmark or a child. */
export function ownedDescendants(processes: ProcessResource[], rootPid: number, excludedPid: number): ProcessResource[] {
  const root = processes.find(process => process.processId === rootPid); if (!root) return [];
  const owned = new Map<number, ProcessResource>([[rootPid, root]]); let added: boolean;
  do { added = false; for (const process of processes) { const parent = owned.get(process.parentProcessId); if (process.processId !== excludedPid && !owned.has(process.processId) && parent && Date.parse(process.startedAt) >= Date.parse(parent.startedAt)) { owned.set(process.processId, process); added = true; } } } while (added);
  owned.delete(rootPid); return [...owned.values()];
}
/** Samples only this benchmark's renderer descendants, excluding its PowerShell sampler. */
export class RendererResources {
  readonly samples: ProcessSample[] = [];
  private child: ChildProcess | undefined;
  private tail = '';
  private failure: string | null = null;
  constructor(private readonly stopFile: string) {}
  async start() {
    if (process.platform !== 'win32') throw new Error('This bounded resource sampler currently requires Windows CIM');
    await unlink(this.stopFile).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    this.child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./resource-sampler.ps1', import.meta.url)), '-RootProcessId', String(process.pid), '-StopFile', this.stopFile], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.child.once('error', () => { this.failure = 'Resource sampler could not start'; });
    this.child.stderr?.on('data', () => { this.failure = 'Resource sampler reported an error'; });
    this.child.stdout?.on('data', data => { this.tail += String(data); let end: number; while ((end = this.tail.indexOf('\n')) >= 0) { const line = this.tail.slice(0, end); this.tail = this.tail.slice(end + 1); try { const raw = JSON.parse(line) as ProcessSample & { samplerPid: number }; this.samples.push({ timestamp: raw.timestamp, processes: ownedDescendants(raw.processes, process.pid, raw.samplerPid) }); } catch { this.failure = 'Invalid resource sample'; } } });
  }
  summary(from: number, to = Date.now()) {
    const selected = this.samples.filter(sample => { const time = Date.parse(sample.timestamp); return time >= from && time <= to; });
    const baseline = this.samples.filter(sample => Date.parse(sample.timestamp) < from).at(-1);
    const identity = (process: ProcessResource) => `${process.processId}/${process.startedAt}`;
    const cpu = new Map<string, number>();
    for (const sample of selected) for (const process of sample.processes) cpu.set(identity(process), Math.max(cpu.get(identity(process)) ?? 0, process.cpuMs));
    const baselineCpu = new Map(baseline?.processes.map(process => [identity(process), process.cpuMs]));
    const rates: number[] = [];
    for (let i = 1; i < selected.length; i++) { const previous = selected[i - 1], next = selected[i], elapsed = Date.parse(next.timestamp) - Date.parse(previous.timestamp), prior = new Map(previous.processes.map(process => [identity(process), process.cpuMs])); if (elapsed <= 0) continue; let delta = 0; for (const process of next.processes) { const before = prior.get(identity(process)); if (before !== undefined) delta += Math.max(0, process.cpuMs - before); else if (Date.parse(process.startedAt) >= Date.parse(previous.timestamp)) delta += process.cpuMs; } rates.push(delta / elapsed * 100); }
    return { available: !this.failure && selected.length > 0, error: this.failure ?? (selected.length ? null : 'No resource samples for this interval'), sampleCount: selected.length, peakRssMiB: selected.length ? Math.max(...selected.map(sample => sample.processes.reduce((sum, process) => sum + process.rssBytes, 0))) / 1048576 : null, lastRssMiB: selected.length ? selected.at(-1)!.processes.reduce((sum, process) => sum + process.rssBytes, 0) / 1048576 : null, observedCpuMs: selected.length ? [...cpu].reduce((sum, [pid, value]) => sum + Math.max(0, value - (baselineCpu.get(pid) ?? 0)), 0) : null, peakCpuOneCorePercent: rates.length ? Math.max(...rates) : null, cpuRateSamples: rates.length, processCount: cpu.size };
  }
  async stop() { if (!this.child) return; await writeFile(this.stopFile, 'stop'); const child = this.child; await new Promise<void>(done => { if (child.exitCode !== null) return done(); const timer = setTimeout(() => { this.failure = 'Resource sampler did not stop'; child.kill(); done(); }, 5000); child.once('exit', () => { clearTimeout(timer); done(); }); }); }
}
