import { recognizeCapturedHome } from '../home-observation.js';
import { recognizeCapturedTown } from '../town-observation.js';
import { randomUUID, createHash } from 'node:crypto';
import { hashCanonical } from '../canonical.js';
import type { BranchRuntime } from '../branch-runtime.js';
import type { ActiveTarget } from '../../shared/lab-protocol.js';
import type { WorldState } from '../../shared/protocol.js';
import { eyePose } from '../../shared/eye-pose.js';
import { physicalSceneSnapshot, RENDER_REVISION } from '../../shared/physical-scene.js';
import { HEAD_LIMITS, observedHeadTarget, validateHeadAction, type CapturedBearingEvidence, type HeadAction } from '../../shared/vision-protocol.js';
import type { AutomaticCaptureAssociation, CaptureMetadata, CaptureOptions, CaptureView, VisualObservation } from '../../shared/capture-protocol.js';
import { CAPTURE_LIMITS, MANUAL_CAPTURE_REASONS } from '../../shared/capture-protocol.js';
import { AUTOMATIC_CAPTURE_REASONS } from '../../shared/attention-protocol.js';
import { groundSnapshot } from './grounding.js';
import { qualifyPixelGrounding, filterPixelQualifiedGrounding, type PixelGroundingResult } from './pixel-qualification.js';
import { ChromiumRenderer, RendererFailure, type FrameRenderer } from './renderer.js';

type Grounding = ReturnType<typeof groundSnapshot>;
interface Entry { metadata: CaptureMetadata; snapshot: WorldState; grounding: Grounding | PixelGroundingResult | null; handles: Map<string, string>; runtime: BranchRuntime; observation?: VisualObservation; bytes?: Uint8Array; completion: Promise<void>; complete(): void; retired: boolean; requestedMono: number }
const scopeKey = (target: ActiveTarget) => `${target.worldId}/${target.branchId}/${target.runId}`;
const exact = (value: unknown, keys: string[]) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(',');
export function validateCaptureOptions(raw: unknown): Required<CaptureOptions> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid capture options');
  const o = raw as Record<string, unknown>;
  if (Object.keys(o).some(key => !['reason', 'width', 'height'].includes(key)) || ![...MANUAL_CAPTURE_REASONS, ...AUTOMATIC_CAPTURE_REASONS].includes(o.reason as CaptureOptions['reason'])) throw new Error('Invalid capture reason or fields');
  const width = o.width ?? 512, height = o.height ?? 512;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height) || width < 128 || width > 1024 || height < 128 || height > 1024) throw new Error('Capture dimensions must be integers from 128 through 1024');
  return { reason: o.reason as CaptureOptions['reason'], width, height };
}
/** Non-authoritative sensor resources. No bytes, handles or worker timing enter checkpoints. */
export class CaptureManager {
  private readonly entries = new Map<string, Entry>();
  private readonly latest = new Map<string, string>();
  private readonly successes = new Map<string, string>();
  private readonly queue: Entry[] = [];
  private running: Entry | undefined;
  private closed = false;
  private cleanupFailure: string | null = null;
  readonly capacity = CAPTURE_LIMITS.capacity; readonly maxRetainedFrames = 16; readonly maxFramesPerRun = 4;
  constructor(private readonly current: (target: ActiveTarget) => boolean, private readonly renderer: FrameRenderer = new ChromiumRenderer(), readonly timeoutMs: number = CAPTURE_LIMITS.timeoutMs, readonly cleanupTimeoutMs: number = CAPTURE_LIMITS.cleanupTimeoutMs) {}
  get queued(): number { return this.queue.length + Number(!!this.running); }
  private async cleanupRenderer(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.renderer.close(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Renderer cleanup deadline exceeded')), this.cleanupTimeoutMs); })]);
      this.cleanupFailure = null;
    } catch (error) { this.cleanupFailure = 'Renderer cleanup failed or exceeded its deadline'; throw error; }
    finally { clearTimeout(timer); }
  }
  private record(entry: Entry, eventType: string, outcome: string, extra: Record<string, string | number | boolean | null> = {}) {
    const m = entry.metadata;
    entry.runtime.recorder?.record({ tick: m.tick, category: 'PRIVATE_SENSOR', eventType, component: 'virtual_eyes', outcome, severity: ['failed', 'timeout', 'unavailable', 'stale'].includes(outcome) ? 'warn' : 'info', ...(m.automatic?.parentSequence != null ? {parentSequence:m.automatic.parentSequence} : {}), data: { captureId: m.captureId, observationId: m.observationId, capturedTick: m.tick, stateVersion: m.stateVersion, stateHash: m.stateHash, sceneRevision: m.sceneRevision, dynamicRevision: m.dynamicRevision, renderRevision: m.renderRevision, captureReason: m.reason, ...(m.automatic ? {intentId:m.automatic.intentId,captureReasons:m.automatic.reasons.join(' '),originSequence:m.automatic.parentSequence??0}:{}), width: m.width, height: m.height, bodyHeading: m.camera.bodyHeading, headYaw: m.camera.headYaw, headPitch: m.camera.headPitch, eyeX: m.camera.position[0], eyeY: m.camera.position[1], eyeZ: m.camera.position[2], horizontalFovDegrees: m.camera.horizontalFovDegrees, ...extra } });
  }
  request(runtime: BranchRuntime, raw: CaptureOptions, automatic?: AutomaticCaptureAssociation): CaptureMetadata {
    if (this.closed) throw new Error('Capture manager is closed');
    if (!this.current(runtime.target)) throw new Error('Capture target is retired');
    const options = validateCaptureOptions(raw);
    if (automatic && (!Number.isSafeInteger(automatic.intentId) || automatic.intentId < 1 || !automatic.reasons.length || automatic.reasons.length > AUTOMATIC_CAPTURE_REASONS.length || new Set(automatic.reasons).size !== automatic.reasons.length || automatic.reasons.some(reason => !AUTOMATIC_CAPTURE_REASONS.includes(reason)) || (automatic.parentSequence !== null && (!Number.isSafeInteger(automatic.parentSequence) || automatic.parentSequence < 1)))) throw new Error('Invalid automatic capture association');
    if (this.queue.length + Number(!!this.running) >= this.capacity) throw new Error('Capture queue is full (4)');
    const snapshot = structuredClone(runtime.viewerState());
    if (!snapshot.head || !snapshot.scene) throw new Error('Capture requires the current vision state schema');
    const checkpoint = runtime.simulation.checkpoint();
    const id = randomUUID(), physical = physicalSceneSnapshot(snapshot);
    const metadata: CaptureMetadata = { ...runtime.target, captureId: id, observationId: id, tick: snapshot.tick, stateVersion: checkpoint.schemaVersion, stateHash: hashCanonical(checkpoint), sceneRevision: physical.revision, dynamicRevision: snapshot.scene.revision, renderRevision: RENDER_REVISION, camera: eyePose(snapshot, options.width, options.height), reason: options.reason, width: options.width, height: options.height, format: 'image/png', status: 'queued', requestedAt: new Date().toISOString(), completedAt: null, durationMs: null, frameHash: null, backend: null, error: null };
    if (automatic) metadata.automatic = structuredClone(automatic);
    let complete!: () => void; const completion = new Promise<void>(done => { complete = done; });
    const entry: Entry = { metadata, snapshot, grounding: null, handles: new Map(), runtime, completion, complete, retired: false, requestedMono: performance.now() };
    this.entries.set(id, entry); this.latest.set(scopeKey(runtime.target), id);
    this.record(entry, 'CAPTURE_REQUEST', 'received'); this.record(entry, 'CAPTURE_SNAPSHOT', 'immutable_snapshot');
    try { entry.grounding = groundSnapshot(snapshot, options.width, options.height, {ignoreLegacyIlluminationGate:true,pixelEvidenceCandidates:true}); }
    catch {
      metadata.status = 'failed'; metadata.error = 'Camera or physical scene is invalid for a visual observation';
      metadata.completedAt = new Date().toISOString(); metadata.durationMs = performance.now() - entry.requestedMono;
      this.record(entry, 'CAPTURE_FAILURE', 'failed', { reason: metadata.error });
      this.record(entry, 'CAPTURE_TIMING', 'failed', { durationMs: metadata.durationMs, completionUtc: metadata.completedAt });
      entry.complete(); this.trim(); return structuredClone(metadata);
    }
    this.queue.push(entry);
    this.trim(); void this.pump();
    return structuredClone(metadata);
  }
  private async pump(): Promise<void> {
    if (this.running || this.closed) return;
    const entry = this.queue.shift(); if (!entry) return;
    this.running = entry; entry.metadata.status = 'pending';
    try {
      if (!entry.grounding) throw new RendererFailure('failed', 'Capture snapshot has no valid geometric evidence');
      // The renderer receives a second clone: it cannot mutate even the retained admission snapshot.
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        this.renderer.render(structuredClone(entry.snapshot), entry.metadata.width, entry.metadata.height),
        new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new RendererFailure('timeout', 'Renderer request deadline exceeded')), this.timeoutMs); }),
      ]).finally(() => clearTimeout(deadline));
      if (entry.retired) return;
      if (this.closed || !this.current(entry.metadata)) { entry.metadata.status = 'stale'; entry.metadata.error = 'Capture belongs to a retired run'; this.record(entry, 'CAPTURE_STALE_DISCARD', 'stale'); }
      else {
        const m = entry.metadata; m.status = 'success'; m.frameHash = createHash('sha256').update(result.bytes).digest('hex'); m.backend = structuredClone(result.backend); entry.bytes = Uint8Array.from(result.bytes);
        const qualified=qualifyPixelGrounding(entry.grounding,result.bytes,result.privateMask,m.width,m.height);entry.grounding=qualified;
        const shapes = filterPixelQualifiedGrounding(qualified, id => { const handle = randomUUID(); entry.handles.set(handle, id); return handle; });
        entry.observation = { ...entry.runtime.target, observationId: m.observationId, tick: m.tick, stateVersion: m.stateVersion, sceneRevision: m.sceneRevision, dynamicRevision: m.dynamicRevision, frameHash: m.frameHash, camera: structuredClone(m.camera), shapes, interpretation: 'uninterpreted sensor evidence', experienceEncoded: false };
        this.successes.set(scopeKey(m), m.captureId);
        this.record(entry, 'CAPTURE_COMPLETE', 'success', { frameHash: m.frameHash, format: m.format, backend: m.backend.configuration, chromium: m.backend.chromium, webglVendor: m.backend.webglVendor, webglRenderer: m.backend.webglRenderer, webglVersion: m.backend.version, visibleCount: shapes.length });
      }
    } catch (error) {
      if (entry.retired) return;
      entry.metadata.status = error instanceof RendererFailure ? error.status : 'failed';
      entry.metadata.error = error instanceof RendererFailure ? error.message.slice(0, 240) : 'Renderer capture failed';
      this.record(entry, 'CAPTURE_FAILURE', entry.metadata.status, { reason: entry.metadata.error });
      try { await this.cleanupRenderer(); }
      catch { this.record(entry, 'CAPTURE_CLEANUP_FAILURE', 'failed', { reason: 'Renderer cleanup failed; inspect sensor health before retry' }); entry.metadata.error += '; renderer cleanup failed'; }
    } finally {
      if (!entry.retired) { entry.metadata.completedAt = new Date().toISOString(); entry.metadata.durationMs = performance.now() - entry.requestedMono;
        this.record(entry, 'CAPTURE_TIMING', entry.metadata.status, { durationMs: entry.metadata.durationMs, completionUtc: entry.metadata.completedAt }); }
      this.running = undefined; entry.complete(); this.trim(); if (!this.closed) void this.pump();
    }
  }
  private trim() {
    const frames = [...this.entries.values()].filter(entry => entry.bytes);
    const counts = new Map<string, number>();
    for (let i = frames.length - 1; i >= 0; i--) { const entry = frames[i], key = scopeKey(entry.metadata), n = (counts.get(key) ?? 0) + 1; counts.set(key, n); if (n > this.maxFramesPerRun || i < frames.length - this.maxRetainedFrames) { delete entry.bytes; delete entry.observation; entry.handles.clear(); entry.metadata.status = 'stale'; entry.metadata.error = 'Frame evicted by bounded retention'; this.record(entry, 'CAPTURE_EVICTED', 'stale', { reason: 'bounded_retention' }); } }
    for (const [id, entry] of this.entries) { if (this.entries.size <= 32) break; if (entry !== this.running && !this.queue.includes(entry)) { this.entries.delete(id); const key = scopeKey(entry.metadata); if (this.latest.get(key) === id) this.latest.delete(key); if (this.successes.get(key) === id) this.successes.delete(key); } }
  }
  view(target: ActiveTarget): CaptureView {
    if (!this.current(target)) throw new Error('Vision target is retired');
    const key = scopeKey(target), latest = this.entries.get(this.latest.get(key) ?? ''), success = this.entries.get(this.successes.get(key) ?? '');
    return structuredClone({ latest: latest?.metadata ?? null, previousSuccess: success?.bytes ? success.metadata : null, observation: latest?.metadata.status === 'success' && latest.bytes ? latest.observation ?? null : null, privateGrounding: latest?.metadata.status === 'success' && latest.bytes ? latest.grounding : null, cleanupError: this.cleanupFailure ?? this.renderer.cleanupError ?? null, limits: { queued: this.queue.length + Number(!!this.running), capacity: this.capacity, retainedFrames: [...this.entries.values()].filter(entry => entry.bytes).length, maxRetainedFrames: this.maxRetainedFrames, timeoutMs: this.timeoutMs } });
  }
  frame(target: ActiveTarget, captureId: string): Uint8Array {
    if (!this.current(target)) throw new Error('Vision target is retired');
    const entry = this.entries.get(captureId);
    if (!entry || scopeKey(entry.metadata) !== scopeKey(target) || entry.metadata.status !== 'success' || !entry.bytes) throw new Error('Frame is unavailable for the selected run');
    return entry.bytes.slice();
  }
  homeObservation(target:ActiveTarget,captureId:string,attentionTick:number){const entry=this.entries.get(captureId);if(!this.current(target)||!entry||scopeKey(entry.metadata)!==scopeKey(target)||entry.retired||entry.metadata.status!=='success'||!entry.bytes||!entry.observation)return null;return recognizeCapturedHome({snapshot:entry.snapshot,metadata:entry.metadata,observation:entry.observation,png:entry.bytes,sensorSource:this.renderer instanceof ChromiumRenderer?'actual_renderer':'test_fixture',handles:entry.handles,attentionTick});}
  townObservation(target:ActiveTarget,captureId:string,attentionTick:number){const entry=this.entries.get(captureId);if(!this.current(target)||!entry||scopeKey(entry.metadata)!==scopeKey(target)||entry.retired||entry.metadata.status!=='success'||!entry.bytes||!entry.observation)return null;return recognizeCapturedTown({snapshot:entry.snapshot,metadata:entry.metadata,observation:entry.observation,png:entry.bytes,sensorSource:this.renderer instanceof ChromiumRenderer?'actual_renderer':'test_fixture',handles:entry.handles,attentionTick});}
  /** ID-bound filtered evidence for cognition. Never substitutes the latest frame.
   * The caller owns the copied pixels before it enters any provider queue. */
  observation(target: ActiveTarget, captureId: string): { metadata: CaptureMetadata; observation: VisualObservation; png: Uint8Array; sensorSource: 'actual_renderer'|'mock_renderer' } {
    if (!this.current(target)) throw new Error('Vision target is retired');
    const entry = this.entries.get(captureId);
    if (!entry || scopeKey(entry.metadata) !== scopeKey(target) || entry.retired || entry.metadata.status !== 'success' || !entry.bytes || !entry.observation) throw new Error('Selected observation is unavailable or evicted');
    return {metadata:structuredClone(entry.metadata),observation:structuredClone(entry.observation),png:entry.bytes.slice(),sensorSource:this.renderer instanceof ChromiumRenderer?'actual_renderer':'mock_renderer'};
  }
  /** Completion-aware local API for scripts/tests; dashboard uses bounded status refreshes. */
  async wait(target: ActiveTarget, captureId: string): Promise<CaptureMetadata> {
    const entry = this.entries.get(captureId); if (!entry || scopeKey(entry.metadata) !== scopeKey(target)) throw new Error('Capture is unavailable for the selected run');
    await entry.completion; return structuredClone(entry.metadata);
  }
  /** Only this path may mint trusted normalized target evidence for ordered replay. */
  resolveHeadAction(runtime: BranchRuntime, raw: unknown): HeadAction {
    const a = raw as Record<string, unknown>;
    if (!a || typeof a !== 'object' || Array.isArray(a) || 'evidence' in a || 'engineTargetId' in a) throw new Error('Only public head action fields are accepted');
    if (a.type !== 'look_at' || !('handle' in a)) return validateHeadAction(raw);
    if (!exact(a, ['type', 'observationId', 'handle', 'sceneRevision']) || typeof a.observationId !== 'string' || typeof a.handle !== 'string') throw new Error('Invalid observation-scoped target fields');
    const entry = this.entries.get(a.observationId), now = runtime.viewerState();
    const reject = (reason: string): never => { runtime.recorder?.record({ tick: now.tick, category: 'PRIVATE_SENSOR', eventType: 'VISION_TARGET_REJECTED', component: 'virtual_eyes', severity: 'warn', outcome: 'rejected', data: { reason } }); throw new Error(reason); };
    if (!this.current(runtime.target) || !entry || scopeKey(entry.metadata) !== scopeKey(runtime.target) || entry.metadata.status !== 'success' || !entry.bytes) return reject('Observation is missing or belongs to another run');
    if (!now.scene || a.sceneRevision !== now.scene.revision || entry.metadata.dynamicRevision !== now.scene.revision || now.tick < entry.metadata.tick || now.tick - entry.metadata.tick > 300) return reject('Observation is expired or its scene revision changed');
    const shape = entry.observation?.shapes.find(shape=>shape.handle===a.handle);
    if (!entry.handles.has(a.handle)||!shape) return reject('Unknown observation handle');
    const evidence:CapturedBearingEvidence={kind:'captured_filtered_bearing_v1',observationId:entry.metadata.observationId,frameHash:entry.metadata.frameHash!,capturedTick:entry.metadata.tick,handle:a.handle,capturedBodyHeading:entry.metadata.camera.bodyHeading,capturedHeadYaw:entry.metadata.camera.headYaw,capturedHeadPitch:entry.metadata.camera.headPitch,bearingDegrees:shape.bearingDegrees,elevationDegrees:shape.elevationDegrees};
    const {yaw,pitch}=observedHeadTarget(evidence,now.character.heading);
    if (yaw < HEAD_LIMITS.minYaw || yaw > HEAD_LIMITS.maxYaw || pitch < HEAD_LIMITS.minPitch || pitch > HEAD_LIMITS.maxPitch) return reject('Observed bearing exceeds head limits');
    const action = validateHeadAction({ type: 'look_at', yaw, pitch, sceneRevision: now.scene.revision, evidence });
    this.record(entry, 'VISION_TARGET_VALIDATED', 'normalized_observed_bearing', { validationTick: now.tick }); return action;
  }
  /** Called synchronously after registry swap and before its old recorder closes. */
  retire(target: ActiveTarget): void {
    const key = scopeKey(target);
    for (const entry of this.entries.values()) if (scopeKey(entry.metadata) === key && !entry.retired) {
      entry.retired = true; entry.metadata.status = 'stale'; entry.metadata.error = 'Capture belongs to a retired run'; entry.metadata.completedAt = new Date().toISOString(); entry.metadata.durationMs = performance.now() - entry.requestedMono;
      delete entry.bytes; delete entry.observation; entry.handles.clear();
      this.record(entry, 'CAPTURE_STALE_DISCARD', 'stale', { durationMs: entry.metadata.durationMs, completionUtc: entry.metadata.completedAt }); entry.complete();
    }
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].retired) this.queue.splice(i, 1);
    this.latest.delete(key); this.successes.delete(key);
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const entry of this.queue.splice(0)) { entry.metadata.status = 'failed'; entry.metadata.error = 'Renderer closed before capture'; entry.complete(); }
    try { await this.cleanupRenderer(); }
    catch { if (this.running) this.record(this.running, 'CAPTURE_CLEANUP_FAILURE', 'failed', { reason: 'Renderer cleanup failed during shutdown' }); }
  }
}
