import { performance } from 'node:perf_hooks';
export interface HostClock { monotonicMs(): number; utcMs(): number }
export interface SchedulerConfig { hz: number; maxStepsPerPump: number; maxBacklogSteps: number; suspendThresholdMs: number }
export interface SchedulerDiagnostic { type: 'HOST_SUSPEND' | 'HOST_RESUME' | 'CATCHUP_SKIPPED' | 'CLOCK_ADJUSTMENT'; data: Record<string, number | string | boolean> }
export interface SchedulerState { config: SchedulerConfig; backlogMs: number }
export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = { hz: 30, maxStepsPerPump: 8, maxBacklogSteps: 16, suspendThresholdMs: 5000 };
export const systemClock: HostClock = { monotonicMs: () => performance.now(), utcMs: () => Date.now() };
/** Host scheduling is observational; skipped host time never advances authoritative ticks. */
export class FixedScheduler {
  private mono: number; private utc: number; private accumulator = 0;
  readonly config: SchedulerConfig;
  constructor(private readonly step: () => void, private readonly diagnostic: (event: SchedulerDiagnostic) => void = () => {}, private readonly clock: HostClock = systemClock, config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    const c = this.config;
    if (!Number.isInteger(c.hz) || c.hz < 1 || c.hz > 120 || !Number.isInteger(c.maxStepsPerPump) || c.maxStepsPerPump < 1 || c.maxStepsPerPump > 1000 || !Number.isInteger(c.maxBacklogSteps) || c.maxBacklogSteps < c.maxStepsPerPump || c.maxBacklogSteps > 10000 || !Number.isFinite(c.suspendThresholdMs) || c.suspendThresholdMs < 1000) throw new Error('Invalid scheduler configuration');
    this.mono = clock.monotonicMs(); this.utc = clock.utcMs();
  }
  private report(event: SchedulerDiagnostic) { try { this.diagnostic(event); } catch { /* An observer cannot control stepping. */ } }
  pump(speed = 1, enabled = true): number {
    if (!Number.isFinite(speed) || speed < 1 || speed > 60) throw new Error('Invalid scheduler speed');
    const mono = this.clock.monotonicMs(), utc = this.clock.utcMs(), elapsed = mono - this.mono, wallElapsed = utc - this.utc;
    this.mono = mono; this.utc = utc;
    if (![mono,utc,elapsed,wallElapsed].every(Number.isFinite)) throw new Error('Invalid host clock');
    const stepMs = 1000 / this.config.hz;
    if (elapsed >= this.config.suspendThresholdMs || wallElapsed >= this.config.suspendThresholdMs) {
      const data = { monotonicGapMs: elapsed, wallDowntimeMs: wallElapsed, skippedCatchupTicks: Math.floor(Math.max(0, elapsed, wallElapsed) / stepMs), discardedBacklogMs: this.accumulator, reason: 'detected_host_suspend_stall_or_clock_discontinuity' };
      this.accumulator = 0; this.report({ type: 'HOST_SUSPEND', data }); this.report({ type: 'HOST_RESUME', data }); return 0;
    }
    if (elapsed < 0 || Math.abs(elapsed - wallElapsed) >= 1000) this.report({ type: 'CLOCK_ADJUSTMENT', data: { monotonicGapMs: elapsed, wallGapMs: wallElapsed } });
    if (!enabled) { this.accumulator = 0; return 0; }
    this.accumulator += Math.max(0, elapsed) * speed;
    const cap = this.config.maxBacklogSteps * stepMs;
    if (this.accumulator > cap) {
      const skippedMs = this.accumulator - cap; this.accumulator = cap;
      this.report({ type: 'CATCHUP_SKIPPED', data: { skippedMs, skippedCatchupTicks: Math.floor(skippedMs / stepMs), reason: 'bounded_backlog' } });
    }
    const count = Math.min(this.config.maxStepsPerPump, Math.floor((this.accumulator + 1e-7) / stepMs));
    this.accumulator -= count * stepMs;
    for (let i = 0; i < count; i++) this.step();
    return count;
  }
  get backlogMs(): number { return Math.max(0, this.accumulator); }
  checkpoint(): SchedulerState { return {config:{...this.config},backlogMs:this.backlogMs}; }
  rebase(backlogMs = 0): void {
    if (!Number.isFinite(backlogMs) || backlogMs < 0 || backlogMs > this.config.maxBacklogSteps * 1000 / this.config.hz) throw new Error('Invalid scheduler backlog');
    this.accumulator=backlogMs;this.mono=this.clock.monotonicMs();this.utc=this.clock.utcMs();
  }
}
