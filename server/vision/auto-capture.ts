import type { BranchRuntime } from '../branch-runtime.js';
import type { ActiveTarget } from '../../shared/lab-protocol.js';
import type { CaptureIntent, SensorFeedbackCommand, SensorPose } from '../../shared/attention-protocol.js';
import type { CaptureMetadata } from '../../shared/capture-protocol.js';
import { eyePose } from '../../shared/eye-pose.js';
import { CaptureManager } from './capture-manager.js';
import { imageSignature } from './image-signature.js';

/** Resource controls use real host time. Their accepted/refused outcomes enter the
 * recorded sensor-input boundary; they never become unrecorded canonical choices. */
export const AUTO_CAPTURE_HOST_LIMITS = { globalIntervalMs: 2000, perRunIntervalMs: 5000, width: 256, height: 256, maxAutomaticOutstanding: 1 } as const;
const key = (scope: ActiveTarget) => `${scope.worldId}/${scope.branchId}/${scope.runId}`;
interface HostRun { lastIntentId: number; lastAttemptMs: number; lastOutcome: string; captureId: string | null }
interface ActiveWork { runtime: BranchRuntime; intentId: number; captureId: string }
export interface AutomaticCaptureHostView {
  inFlight: { intentId: number; captureId: string } | null;
  lastIntentId: number | null; lastOutcome: string | null; captureId: string | null;
  nextHostOpportunityMs: number; limits: typeof AUTO_CAPTURE_HOST_LIMITS;
}
function captureState(runtime: BranchRuntime) {
  const cp = runtime.simulation.checkpoint();
  return cp.schemaVersion === 4 || cp.schemaVersion === 5 || (cp.schemaVersion === 6 || cp.schemaVersion === 7) ? cp : null;
}
function pose(runtime: BranchRuntime): SensorPose {
  const p = eyePose(runtime.viewerState(), AUTO_CAPTURE_HOST_LIMITS.width, AUTO_CAPTURE_HOST_LIMITS.height);
  return { x:p.position[0], y:p.position[1], z:p.position[2], bodyHeading:p.bodyHeading, headYaw:p.headYaw, headPitch:p.headPitch };
}
function snapshotFields(metadata: CaptureMetadata) {
  const p = metadata.camera;
  return { capturedTick:metadata.tick,sceneRevision:metadata.dynamicRevision,pose:{x:p.position[0],y:p.position[1],z:p.position[2],bodyHeading:p.bodyHeading,headYaw:p.headYaw,headPitch:p.headPitch} };
}
/** One global automatic job leaves three existing queue slots for developer use.
 * LIVE and experiment opportunities alternate while both wait; experiments rotate. */
export class AutomaticCaptureCoordinator {
  private readonly runs = new Map<string,HostRun>();
  private active: ActiveWork | null = null;
  private lastGlobalMs = -Infinity;
  private lastMode: 'LIVE'|'EXPERIMENT'|null = null;
  private lastExperiment = '';
  private closed = false;
  constructor(private readonly manager: CaptureManager, private readonly current: (scope:ActiveTarget)=>boolean, private readonly monotonicMs:()=>number = ()=>performance.now(), private readonly selectedForCognition:(runtime:BranchRuntime,intent:CaptureIntent)=>boolean=()=>false) {}
  private submit(runtime:BranchRuntime,command:SensorFeedbackCommand):boolean {
    if (this.closed || !this.current(runtime.target)) return false;
    try {
      const admission=runtime.enqueueSensorFeedback(command);
      if(admission.input.admission==='queue_full')runtime.recorder?.record({tick:runtime.simulation.state.tick,category:'OPERATIONAL_REPLAY',eventType:'AUTO_CAPTURE_FEEDBACK',component:'capture_host',severity:'warn',outcome:'queue_full',data:{intentId:command.intentId,stage:command.stage,captureId:command.captureId??'none',reason:'ordered_input_capacity'}});
      return admission.input.admission==='queued';
    } catch {
      // The old recorder is no longer writable after retirement. An unexpected
      // failure on the still-current run stays visible without mutating its state.
      if(this.current(runtime.target))runtime.recorder?.record({tick:runtime.simulation.state.tick,category:'OPERATIONAL_REPLAY',eventType:'AUTO_CAPTURE_FEEDBACK',component:'capture_host',severity:'error',outcome:'failed',data:{intentId:command.intentId,stage:command.stage,captureId:command.captureId??'none',reason:'ordered_feedback_admission_failed'}});
      return false;
    }
  }
  private reject(runtime:BranchRuntime,intent:CaptureIntent,outcome:'quota'|'queue_full'|'stale'|'interrupted',stage:'rejected'|'recovered'='rejected') {
    this.submit(runtime,{type:'sensor_feedback',intentId:intent.id,stage,captureId:intent.captureId,capturedTick:runtime.simulation.state.tick,sceneRevision:runtime.viewerState().scene!.revision,pose:pose(runtime),outcome,signature:null,frameHash:null});
  }
  pump(all:Iterable<BranchRuntime>):void {
    if (this.closed) return;
    const candidates: {runtime:BranchRuntime;intent:CaptureIntent}[] = [];
    const currentKeys = new Set<string>();
    for (const runtime of all) {
      const scope = key(runtime.target); currentKeys.add(scope);
      if (!this.current(runtime.target)) continue;
      const checkpoint = captureState(runtime), intent = checkpoint?.attention.pending;
      if (!intent) continue;
      const summary = runtime.captureAvailability();
      // Paused/fast-forward experiments never release accumulated renderer work.
      // Ordered result inputs can still arrive while paused and apply on a later step.
      if (summary.paused || summary.fastForwardRemaining) continue;
      // A checkpoint can retain a pending intention whose admission is already
      // queued. Let its recorded feedback apply in order before deciding whether
      // the submitted worker survived; redispatch would race the saved capture ID.
      if (checkpoint!.pendingInputs.some(input=>input.command.type==='sensor_feedback'&&input.command.intentId===intent.id)) continue;
      const state = this.runs.get(scope);
      if (intent.status === 'submitted' && !(this.active?.runtime === runtime && this.active.intentId === intent.id && this.active.captureId === intent.captureId)) {
        if (state?.lastIntentId !== intent.id || state.lastOutcome !== 'interrupted' || state.captureId !== intent.captureId) {
          this.runs.set(scope,{lastIntentId:intent.id,lastAttemptMs:state?.lastAttemptMs??-Infinity,lastOutcome:'interrupted',captureId:intent.captureId});
          this.reject(runtime,intent,'interrupted','recovered');
        }
        continue;
      }
      if (intent.status === 'pending' && state?.lastIntentId !== intent.id) candidates.push({runtime,intent});
    }
    for (const scope of this.runs.keys()) if (!currentKeys.has(scope)) this.runs.delete(scope);
    if (this.active || !candidates.length) return;
    const live = candidates.find(c => c.runtime.mode === 'LIVE');
    const experiments = candidates.filter(c => c.runtime.mode === 'EXPERIMENT').sort((a,b)=>key(a.runtime.target).localeCompare(key(b.runtime.target)));
    const nextExperiment = experiments.find(c=>key(c.runtime.target)>this.lastExperiment)??experiments[0];
    const selected = live && (this.lastMode !== 'LIVE' || !nextExperiment) ? live : nextExperiment??live!;
    const {runtime,intent}=selected,scope=key(runtime.target),now=this.monotonicMs(),old=this.runs.get(scope);
    const state:HostRun={lastIntentId:intent.id,lastAttemptMs:old?.lastAttemptMs??-Infinity,lastOutcome:'pending',captureId:null};
    this.runs.set(scope,state);
    if (runtime.simulation.state.tick > intent.expiresTick) { state.lastOutcome='stale';this.reject(runtime,intent,'stale');return; }
    if (now-this.lastGlobalMs<AUTO_CAPTURE_HOST_LIMITS.globalIntervalMs || now-state.lastAttemptMs<AUTO_CAPTURE_HOST_LIMITS.perRunIntervalMs) { state.lastOutcome='quota';this.reject(runtime,intent,'quota');return; }
    if (this.manager.queued >= this.manager.capacity) { state.lastOutcome='queue_full';this.reject(runtime,intent,'queue_full');return; }
    state.lastAttemptMs=now;this.lastGlobalMs=now;this.lastMode=runtime.mode;
    if (runtime.mode==='EXPERIMENT') this.lastExperiment=scope;
    let requested:CaptureMetadata;
    try {
      const dimension=this.selectedForCognition(runtime,intent)?512:AUTO_CAPTURE_HOST_LIMITS.width;
      requested=this.manager.request(runtime,{reason:intent.reasons[0],width:dimension,height:dimension},{intentId:intent.id,reasons:intent.reasons,parentSequence:intent.parentSequence});
    } catch {
      state.lastOutcome='queue_full';this.reject(runtime,intent,'queue_full');return;
    }
    state.captureId=requested.captureId;state.lastOutcome='admitted';
    this.active={runtime,intentId:intent.id,captureId:requested.captureId};
    this.submit(runtime,{type:'sensor_feedback',intentId:intent.id,stage:'admitted',captureId:requested.captureId,...snapshotFields(requested),outcome:'success',signature:null,frameHash:null});
    void this.complete(runtime,intent.id,requested,state);
  }
  private async complete(runtime:BranchRuntime,intentId:number,requested:CaptureMetadata,state:HostRun):Promise<void> {
    const captureId=requested.captureId;
    try {
      const result=await this.manager.wait(runtime.target,captureId);
      if (this.closed || !this.current(runtime.target)) return;
      let signature:number[]|null=null;
      let outcome:SensorFeedbackCommand['outcome']=result.status==='success'?'success':result.status==='timeout'?'timeout':result.status==='unavailable'?'unavailable':result.status==='stale'?'stale':'failed';
      if (outcome==='success') {
        try { signature=imageSignature(this.manager.frame(runtime.target,captureId)); }
        catch { outcome='failed'; }
      }
      state.lastOutcome=outcome;
      this.submit(runtime,{type:'sensor_feedback',intentId,stage:'result',captureId,...snapshotFields(result),outcome,signature:outcome==='success'?signature:null,frameHash:outcome==='success'?result.frameHash:null});
    } catch {
      state.lastOutcome='failed';
      this.submit(runtime,{type:'sensor_feedback',intentId,stage:'result',captureId,...snapshotFields(requested),outcome:'failed',signature:null,frameHash:null});
    }
    finally { if (this.active?.runtime===runtime && this.active.captureId===captureId) this.active=null; }
  }
  summary(scope:ActiveTarget):AutomaticCaptureHostView {
    const state=this.runs.get(key(scope)),now=this.monotonicMs();
    return {inFlight:this.active && key(this.active.runtime.target)===key(scope)?{intentId:this.active.intentId,captureId:this.active.captureId}:null,lastIntentId:state?.lastIntentId??null,lastOutcome:state?.lastOutcome??null,captureId:state?.captureId??null,nextHostOpportunityMs:Math.max(0,AUTO_CAPTURE_HOST_LIMITS.globalIntervalMs-(now-this.lastGlobalMs),AUTO_CAPTURE_HOST_LIMITS.perRunIntervalMs-(now-(state?.lastAttemptMs??-Infinity))),limits:AUTO_CAPTURE_HOST_LIMITS};
  }
  retire(scope:ActiveTarget):void { this.runs.delete(key(scope)); }
  close():void { this.closed=true;this.runs.clear(); }
}
