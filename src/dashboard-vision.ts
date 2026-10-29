import type { ActiveTarget } from '../shared/lab-protocol';
import { captureResultDeadlineMs, type CaptureMetadata, type CaptureView } from '../shared/capture-protocol';

export const visionScopeKey = (target: ActiveTarget) => `${target.worldId}/${target.branchId}/${target.runId}`;
const same = (a: ActiveTarget, b: ActiveTarget) => visionScopeKey(a) === visionScopeKey(b);
export interface VisionRequest { target: ActiveTarget; generation: number; sequence: number }

/** One completion budget per pending capture, shared by admission and initial status loads. */
export class VisionCaptureDeadline {
  private captureId: string | null = null;
  private deadline = 0;
  constructor(private readonly now: () => number = Date.now) {}
  reset(): void { this.captureId = null; this.deadline = 0; }
  observe(capture: Pick<CaptureMetadata, 'captureId' | 'status'> | null | undefined): void {
    if (!capture || !['queued', 'pending'].includes(capture.status)) { this.reset(); return; }
    if (capture.captureId !== this.captureId) { this.captureId = capture.captureId; this.deadline = this.now() + captureResultDeadlineMs(); }
  }
  expired(capture: Pick<CaptureMetadata, 'captureId' | 'status'> | null | undefined): boolean {
    this.observe(capture);
    return this.captureId !== null && this.now() >= this.deadline;
  }
}

/** A delayed response may neither cross a run boundary nor overwrite a newer request. */
export class VisionRequestGate {
  private target: ActiveTarget | null = null;
  private generation = 0;
  private sequence = 0;
  select(target: ActiveTarget | null): boolean {
    if (this.target === null && target === null || this.target && target && same(this.target, target)) return false;
    this.target = target ? structuredClone(target) : null;
    this.generation++;
    return true;
  }
  begin(): VisionRequest {
    if (!this.target) throw new Error('No selected visual sensor scope');
    return { target: structuredClone(this.target), generation: this.generation, sequence: ++this.sequence };
  }
  accepts(request: VisionRequest): boolean {
    return !!this.target && same(request.target, this.target) && request.generation === this.generation && request.sequence === this.sequence;
  }
}

export function validateCaptureViewScope(view: CaptureView, target: ActiveTarget): void {
  for (const value of [view.latest, view.previousSuccess, view.observation]) {
    if (value && !same(value, target)) throw new Error('Visual evidence does not match the selected world, branch and run.');
  }
  if (view.previousSuccess && view.previousSuccess.status !== 'success') throw new Error('Previous capture is not a successful frame.');
}

export function displayedCapture(view: CaptureView): { frame: CaptureMetadata | null; previous: boolean } {
  const latest = view.latest?.status === 'success' ? view.latest : null;
  const frame = latest ?? view.previousSuccess;
  return { frame, previous: !!frame && frame.captureId !== view.latest?.captureId };
}

