import { randomUUID } from 'node:crypto';
import { hashCanonical, canonicalStringify } from './canonical.js';
import { LabSimulation, VisionSimulation, validateCheckpoint, validateCommand, hashCheckpoint, type CheckpointV2, type CheckpointV3, type OrderedInput, type NormalizedCommand, type DeterministicEvent } from './simulation.js';
import { FixedScheduler, systemClock, type HostClock, type SchedulerState, type SchedulerDiagnostic } from './scheduler.js';
import { FlightRecorder } from './diagnostics/recorder.js';
import type { ActiveTarget, BranchSummary, ControlAction, WorldMode } from '../shared/lab-protocol.js';
import { EXPERIMENT_PLAYBACK, type PlaybackReport } from '../shared/lab-protocol.js';

export interface RuntimeControl {paused:boolean;speed:number;fastForwardRemaining:number;nextOperationSequence:number;loggingMode:'off'|'default'|'verbose';compressClosed:boolean}
export interface RuntimeCheckpoint {schemaVersion:1|2;kind:'lumi-branch-runtime';mode:WorldMode;simulation:CheckpointV2|CheckpointV3;control:RuntimeControl;scheduler:SchedulerState}
export type RuntimeOperation =
  | {sequence:number;tick:number;kind:'advance';ticks:number;backlogMs:number;source:'scheduled'|'fast-forward'}
  | {sequence:number;tick:number;kind:'input';input:OrderedInput}
  | {sequence:number;tick:number;kind:'control';action:ControlAction};
export function validId(value:unknown):value is string {return typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);}
const exact=(raw:unknown,keys:string[])=>!!raw&&typeof raw==='object'&&!Array.isArray(raw)&&canonicalStringify(Object.keys(raw).sort())===canonicalStringify(keys.sort());
const int=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
export function validateControlAction(value:unknown,historical=false):ControlAction {
  if(!value||typeof value!=='object')throw new Error('Invalid control');const a=value as Record<string,unknown>;
  if(['pause','resume','step','cancel-fast-forward','activity-pause','activity-resume'].includes(a.type as string)&&exact(a,['type']))return structuredClone(a) as ControlAction;
  if(a.type==='speed'&&exact(a,['type','speed'])) {
    const maximum=historical?60:EXPERIMENT_PLAYBACK.maxSpeed;
    if(typeof a.speed==='number'&&Number.isFinite(a.speed)&&a.speed>=1&&a.speed<=maximum)return {type:'speed',speed:a.speed};
    throw new Error(`Unsupported playback speed; expected 1–${maximum}×${historical?' for historical replay':''}`);
  }
  if((a.type==='fast-forward'||a.type==='activity-start')&&exact(a,['type',a.type==='fast-forward'?'ticks':'totalTicks'])&&int(a[a.type==='fast-forward'?'ticks':'totalTicks'],1,100000))return structuredClone(a) as ControlAction;
  if(a.type==='logging'&&exact(a,['type','mode','compressClosed'])&&['off','default','verbose'].includes(a.mode as string)&&typeof a.compressClosed==='boolean')return structuredClone(a) as ControlAction;
  if((a.type==='synthetic-cue'||a.type==='synthetic-clock')&&['sensed','attended','encoded'].every(k=>typeof a[k]==='boolean')) {
    if(a.type==='synthetic-cue'&&exact(a,['type','sensed','attended','encoded']))return structuredClone(a) as ControlAction;
    if(a.type==='synthetic-clock'&&exact(a,['type','sensed','attended','encoded','observedSeconds','uncertaintySeconds'])&&typeof a.observedSeconds==='number'&&Number.isFinite(a.observedSeconds)&&a.observedSeconds>=0&&a.observedSeconds<=1e12&&typeof a.uncertaintySeconds==='number'&&Number.isFinite(a.uncertaintySeconds)&&a.uncertaintySeconds>=0&&a.uncertaintySeconds<=1e9)return structuredClone(a) as ControlAction;
  }
  throw new Error('Invalid control fields');
}
export function validateRuntimeCheckpoint(value:unknown):RuntimeCheckpoint {
  if(!exact(value,['schemaVersion','kind','mode','simulation','control','scheduler']))throw new Error('Invalid runtime checkpoint fields');
  const c=value as RuntimeCheckpoint;
  if(![1,2].includes(c.schemaVersion)||c.kind!=='lumi-branch-runtime'||!['LIVE','EXPERIMENT'].includes(c.mode))throw new Error('Incompatible runtime checkpoint');
  const sim=validateCheckpoint(c.simulation);if(sim.schemaVersion===1||c.schemaVersion!==(sim.schemaVersion===3?2:1))throw new Error('Runtime requires matching explicit simulation schema');
  const r=c.control;
  if(!exact(r,['paused','speed','fastForwardRemaining','nextOperationSequence','loggingMode','compressClosed'])||typeof r.paused!=='boolean'||typeof r.speed!=='number'||!Number.isFinite(r.speed)||r.speed<1||r.speed>60||!int(r.fastForwardRemaining,0,100000)||!int(r.nextOperationSequence,1,Number.MAX_SAFE_INTEGER)||!['off','default','verbose'].includes(r.loggingMode)||typeof r.compressClosed!=='boolean'||(r.fastForwardRemaining>0&&!r.paused))throw new Error('Invalid runtime controls');
  if(c.mode==='LIVE'&&(r.paused||r.speed!==1||r.fastForwardRemaining!==0||sim.experiences.length))throw new Error('Invalid LIVE state or experience promotion');
  if(!exact(c.scheduler,['config','backlogMs'])||!exact(c.scheduler.config,['hz','maxStepsPerPump','maxBacklogSteps','suspendThresholdMs'])||c.scheduler.config.hz!==sim.config.hz)throw new Error('Invalid scheduler snapshot');
  const scheduler=new FixedScheduler(()=>{},()=>{},undefined,c.scheduler.config);scheduler.rebase(c.scheduler.backlogMs);
  if(r.paused&&c.scheduler.backlogMs!==0)throw new Error('Paused runtime cannot retain scheduler backlog');
  return structuredClone(c);
}
export function validateRuntimeOperation(value:unknown):RuntimeOperation {
  if(!value||typeof value!=='object')throw new Error('Invalid runtime operation');const o=value as RuntimeOperation;
  if(!int(o.sequence,1,Number.MAX_SAFE_INTEGER)||!int(o.tick,0,Number.MAX_SAFE_INTEGER))throw new Error('Invalid runtime cursor');
  if(o.kind==='control'&&exact(o,['sequence','tick','kind','action'])){validateControlAction(o.action,true);return structuredClone(o);}
  if(o.kind==='input'&&exact(o,['sequence','tick','kind','input'])) {
    const i=o.input;
    if(!exact(i,['sequence','receivedTick','applyTick','command','admission'])||!int(i.sequence,1,Number.MAX_SAFE_INTEGER)||i.receivedTick!==o.tick||i.applyTick!==o.tick+1||!['queued','queue_full'].includes(i.admission))throw new Error('Invalid runtime input');
    validateCommand(i.command,true);
    return structuredClone(o);
  }
  if(o.kind==='advance'&&exact(o,['sequence','tick','kind','ticks','backlogMs','source'])&&int(o.ticks,0,10000000)&&typeof o.backlogMs==='number'&&Number.isFinite(o.backlogMs)&&o.backlogMs>=0&&['scheduled','fast-forward'].includes(o.source))return structuredClone(o);
  throw new Error('Invalid runtime operation fields');
}
export const hashRuntimeCheckpoint=(c:RuntimeCheckpoint)=>hashCanonical(validateRuntimeCheckpoint(c));
export interface RuntimeOptions {worldId:string;branchId:string;mode:WorldMode;checkpoint?:unknown;seed?:number;directory?:string;clock?:HostClock;offline?:boolean;dormant?:boolean;historyId?:string;onEvents?:(events:DeterministicEvent[],runtime:BranchRuntime)=>void}
export class BranchRuntime {
  readonly target:ActiveTarget; readonly simulation:LabSimulation|VisionSimulation; readonly scheduler:FixedScheduler; readonly recorder:FlightRecorder|null;
  readonly mode:WorldMode; readonly checkpoints=new Map<string,RuntimeCheckpoint>(); readonly runs:string[]=[];
  private controlState:RuntimeControl;private pendingAdvance:{tick:number;ticks:number;source:'scheduled'|'fast-forward'}|null=null;
  private events:DeterministicEvent[]=[];private fastJob:ReturnType<typeof setImmediate>|undefined;private disposed=false;private recordedBacklogMs=0;
  private activated:boolean;private prepared=false;private readonly hostClock:HostClock;
  private sampleHostMs=0;private sampleWorldSeconds=0;private completedSample:{hostMs:number;worldSeconds:number;speed:number}|null=null;
  private playbackStatus:PlaybackReport['status']='insufficient_sample';private slowWindows=0;private underperforming=false;private catchupLostSeconds=0;
  private lastCatchupWarningMs=-Infinity;private lastSlowWarningMs=-Infinity;
  constructor(private readonly options:RuntimeOptions) {
    if(!validId(options.worldId)||!validId(options.branchId))throw new Error('Invalid branch identity');
    if(options.historyId!==undefined&&!validId(options.historyId))throw new Error('Invalid history identity');
    this.target={worldId:options.worldId,branchId:options.branchId,runId:randomUUID()};this.mode=options.mode;this.hostClock=options.clock??systemClock;this.activated=!options.dormant;
    const envelope=options.checkpoint&&typeof options.checkpoint==='object'&&(options.checkpoint as {kind?:unknown}).kind==='lumi-branch-runtime'?validateRuntimeCheckpoint(options.checkpoint):null;
    if(this.mode==='LIVE'&&!envelope&&options.checkpoint&&typeof options.checkpoint==='object'&&[2,3].includes((options.checkpoint as {schemaVersion:number}).schemaVersion))throw new Error('LIVE restoration requires a LIVE runtime envelope; bare lab state has no trusted mode');
    if(envelope&&envelope.mode==='EXPERIMENT'&&this.mode==='LIVE')throw new Error('Cannot promote experimental runtime into LIVE');
    if(!options.offline&&this.mode==='EXPERIMENT'&&envelope&&envelope.control.speed>EXPERIMENT_PLAYBACK.maxSpeed)throw new Error(`Saved experiment playback ${envelope.control.speed}× exceeds the active ${EXPERIMENT_PLAYBACK.maxSpeed}× limit. Replay this artifact offline, or explicitly create a new experiment at a supported speed.`);
    const simulationOptions={checkpoint:envelope?.simulation??options.checkpoint,seed:options.seed,worldId:options.worldId,runId:this.target.runId,mode:options.mode};
    this.simulation=options.offline&&envelope?.simulation.schemaVersion===2?new LabSimulation(simulationOptions):new VisionSimulation({...simulationOptions,historical:options.offline});
    this.controlState=envelope?structuredClone(envelope.control):{paused:false,speed:this.mode==='LIVE'?1:EXPERIMENT_PLAYBACK.defaultSpeed,fastForwardRemaining:0,nextOperationSequence:1,loggingMode:'default',compressClosed:false};
    if(this.mode==='LIVE'){this.controlState.paused=false;this.controlState.speed=1;this.controlState.fastForwardRemaining=0;}
    this.scheduler=new FixedScheduler(()=>this.advanceOne('scheduled'),e=>this.schedulerDiagnostic(e),options.clock,envelope?.scheduler.config??{maxStepsPerPump:this.mode==='EXPERIMENT'?48:8,maxBacklogSteps:this.mode==='EXPERIMENT'?96:16});
    if(envelope)this.scheduler.rebase(envelope.scheduler.backlogMs);
    this.recordedBacklogMs=this.scheduler.backlogMs;
    this.recorder=options.offline?null:new FlightRecorder({directory:options.directory,worldId:options.worldId,branchId:options.branchId,worldMode:options.mode,runId:this.target.runId,hz:this.simulation.checkpoint().config.hz,loggingMode:this.controlState.loggingMode,compressClosed:this.controlState.compressClosed});
    this.runs.push(this.target.runId);this.capture();
    if(!options.offline&&options.checkpoint&&envelope?.simulation.schemaVersion!==3)this.recorder?.record({tick:this.simulation.state.tick,category:'OPERATIONAL_REPLAY',eventType:'STATE_SCHEMA_MIGRATED',component:'recovery',outcome:'history_and_tick_preserved',data:{fromSchema:envelope?.simulation.schemaVersion??1,toSchema:3,checkpointTick:this.simulation.state.tick,historyId:options.historyId??'unknown'}});
    if(!options.offline&&envelope?.simulation.schemaVersion===3&&envelope.simulation.rulesVersion!==this.simulation.checkpoint().rulesVersion)this.recorder?.record({tick:this.simulation.state.tick,category:'OPERATIONAL_REPLAY',eventType:'STATE_RULES_MIGRATED',component:'recovery',outcome:'history_tick_pose_and_queue_preserved',data:{fromRules:envelope.simulation.rulesVersion,toRules:this.simulation.checkpoint().rulesVersion,checkpointTick:this.simulation.state.tick,historyId:options.historyId??'unknown'}});
    if(this.controlState.fastForwardRemaining&&!options.offline&&this.activated)this.scheduleFastForward();
  }
  private observe(events:DeterministicEvent[]){if(!this.activated)return;if(this.options.offline)this.events.push(...events);for(const e of events)this.recorder?.recordEvent(e);this.options.onEvents?.(events,this);}
  private schedulerDiagnostic(event:SchedulerDiagnostic):void {
    if(event.type==='CATCHUP_SKIPPED') {
      this.catchupLostSeconds+=Number(event.data.skippedMs)/1000;
      const now=this.hostClock.monotonicMs();if(now-this.lastCatchupWarningMs<5000)return;this.lastCatchupWarningMs=now;
    }
    this.recorder?.record({tick:this.simulation.state.tick,category:'OPERATIONAL_REPLAY',eventType:event.type,component:'scheduler',severity:'warn',outcome:'observed',data:event.data});
  }
  private resetPlayback(status:PlaybackReport['status']='insufficient_sample'):void {this.sampleHostMs=0;this.sampleWorldSeconds=0;this.completedSample=null;this.playbackStatus=status;this.slowWindows=0;this.underperforming=false;}
  private observePlayback(ticks:number):void {
    const observation=this.scheduler.observation;
    if(observation.suspended){this.resetPlayback('suspended');return;}
    if(this.controlState.fastForwardRemaining){this.resetPlayback('fast_forward');return;}
    if(this.controlState.paused){this.resetPlayback('paused');return;}
    if(this.playbackStatus==='suspended')this.resetPlayback();
    this.sampleHostMs+=observation.hostElapsedMs;this.sampleWorldSeconds+=ticks/this.scheduler.config.hz;
    if(this.sampleHostMs<1000)return;
    const achieved=this.sampleWorldSeconds/(this.sampleHostMs/1000);this.completedSample={hostMs:this.sampleHostMs,worldSeconds:this.sampleWorldSeconds,speed:achieved};this.playbackStatus='running';
    this.slowWindows=achieved<this.controlState.speed*0.9?this.slowWindows+1:0;this.underperforming=this.slowWindows>=3;
    const now=this.hostClock.monotonicMs();if(this.underperforming&&now-this.lastSlowWarningMs>=5000){this.lastSlowWarningMs=now;this.recorder?.record({tick:this.simulation.state.tick,category:'OPERATIONAL_REPLAY',eventType:'PLAYBACK_UNDERPERFORMING',component:'scheduler',severity:'warn',outcome:'below_requested_rate',data:{speed:this.controlState.speed,rate:achieved}});}
    this.sampleHostMs=0;this.sampleWorldSeconds=0;
  }
  playback():PlaybackReport {
    const status=this.controlState.fastForwardRemaining?'fast_forward':this.controlState.paused?'paused':this.playbackStatus;
    return {requestedSpeed:this.controlState.speed,achievedSpeed:status==='running'?this.completedSample?.speed??null:null,status,sampleHostSeconds:(this.completedSample?.hostMs??this.sampleHostMs)/1000,sampleWorldSeconds:this.completedSample?.worldSeconds??this.sampleWorldSeconds,catchupLostSeconds:this.catchupLostSeconds,underperforming:this.underperforming};
  }
  /** Prepare all failable local resources without admitting branch work or viewer events. */
  async prepare():Promise<void>{if(this.disposed)throw new Error('Branch runtime is closed');await this.recorder?.prepare();this.prepared=true;}
  activate():void {if(this.disposed)throw new Error('Branch runtime is closed');if(this.activated)return;if(!this.prepared)throw new Error('Branch runtime must be prepared before activation');this.scheduler.rebase(this.scheduler.backlogMs);this.activated=true;this.resetPlayback();if(this.controlState.fastForwardRemaining&&!this.options.offline)this.scheduleFastForward();}
  private requireActive():void {if(this.disposed)throw new Error('Branch runtime is closed');if(!this.activated)throw new Error('Branch runtime is dormant until activation');}
  private recordOperation(operation:Omit<RuntimeOperation,'sequence'>):void {
    const op={...operation,sequence:this.controlState.nextOperationSequence++} as RuntimeOperation;
    this.recorder?.recordRuntimeOperation(op);this.recordedBacklogMs=this.scheduler.backlogMs;
  }
  private flushAdvance():void {
    if(!this.pendingAdvance&&this.scheduler.backlogMs!==this.recordedBacklogMs)this.pendingAdvance={tick:this.simulation.state.tick,ticks:0,source:'scheduled'};
    if(!this.pendingAdvance)return;const p=this.pendingAdvance;this.pendingAdvance=null;
    this.recordOperation({kind:'advance',tick:p.tick,ticks:p.ticks,source:p.source,backlogMs:this.scheduler.backlogMs} as Omit<RuntimeOperation,'sequence'>);
  }
  private advanceOne(source:'scheduled'|'fast-forward') {
    if(this.pendingAdvance?.source!==source)this.flushAdvance();
    this.pendingAdvance??={tick:this.simulation.state.tick,ticks:0,source};this.pendingAdvance.ticks++;
    this.observe(this.simulation.step());
    this.recorder?.recordVerboseTick(this.simulation.state.tick,{activityCursor:this.simulation.checkpoint().activity.cursor});
    if(source==='fast-forward')this.controlState.fastForwardRemaining--;
  }
  pump():number {if(this.disposed||!this.activated)return 0;const ticks=this.scheduler.pump(this.controlState.speed,!this.controlState.paused&&this.controlState.fastForwardRemaining===0);this.observePlayback(ticks);return ticks;}
  enqueue(command:NormalizedCommand) {
    this.requireActive();
    this.flushAdvance();const accepted=this.simulation.enqueue(command);
    this.recordOperation({kind:'input',tick:this.simulation.state.tick,input:accepted.input} as Omit<RuntimeOperation,'sequence'>);
    this.recorder?.recordInput(accepted.input);this.observe(accepted.events);return accepted;
  }
  applyControl(raw:unknown):void {
    this.requireActive();
    const action=validateControlAction(raw,this.options.offline);
    if(this.mode!=='EXPERIMENT'&&action.type!=='logging')throw new Error('Experiment controls cannot mutate LIVE');
    if(action.type==='step'&&(!this.controlState.paused||this.controlState.fastForwardRemaining))throw new Error('Single step requires a paused idle experiment');
    this.flushAdvance();
    const events=this.simulation.applyAction(action);
    if(action.type==='pause'||action.type==='resume'){this.controlState.paused=action.type==='pause';this.controlState.fastForwardRemaining=0;this.scheduler.rebase();}
    if(action.type==='step')this.observe(this.simulation.step());
    if(action.type==='speed'){this.controlState.speed=action.speed;this.scheduler.rebase();}
    if(action.type==='fast-forward'){this.controlState.paused=true;this.controlState.fastForwardRemaining=action.ticks;this.scheduler.rebase();}
    if(action.type==='cancel-fast-forward'){this.controlState.fastForwardRemaining=0;this.scheduler.rebase();}
    if(action.type==='logging'){this.controlState.loggingMode=action.mode;this.controlState.compressClosed=action.compressClosed;this.recorder?.setLoggingMode(action.mode,action.compressClosed);}
    if(['pause','resume','step','speed','fast-forward','cancel-fast-forward'].includes(action.type))this.resetPlayback();
    this.recordOperation({kind:'control',tick:action.type==='step'?this.simulation.state.tick-1:this.simulation.state.tick,action} as Omit<RuntimeOperation,'sequence'>);this.observe(events);
    this.recorder?.record({tick:this.simulation.state.tick,category:'OPERATIONAL_REPLAY',eventType:'CONTROL_APPLIED',component:'laboratory',outcome:action.type,data:{control:action.type}});
    if(action.type==='fast-forward'&&!this.options.offline)this.scheduleFastForward();
  }
  private scheduleFastForward(){if(this.fastJob||this.disposed||!this.activated)return;this.fastJob=setImmediate(()=>{this.fastJob=undefined;if(this.disposed||!this.activated)return;const n=Math.min(128,this.controlState.fastForwardRemaining);for(let i=0;i<n;i++)this.advanceOne('fast-forward');if(this.controlState.fastForwardRemaining)this.scheduleFastForward();else this.flushAdvance();});}
  checkpoint():RuntimeCheckpoint {this.flushAdvance();const simulation=this.simulation.checkpoint();return {schemaVersion:simulation.schemaVersion===3?2:1,kind:'lumi-branch-runtime',mode:this.mode,simulation,control:structuredClone(this.controlState),scheduler:this.scheduler.checkpoint()};}
  capture():RuntimeCheckpoint {const cp=this.checkpoint();this.recorder?.captureRuntimeCheckpoint(cp);return cp;}
  viewerState(){return {...this.simulation.snapshot(),branchId:this.target.branchId,mode:this.mode};}
  saveCheckpoint():{id:string;tick:number}{if(this.disposed)throw new Error('Branch runtime is closed');const cp=this.capture(),id=`checkpoint-${cp.simulation.tick}-${this.checkpoints.size+1}`;this.checkpoints.set(id,cp);return {id,tick:cp.simulation.tick};}
  drainEvents(){const events=this.events;this.events=[];return events;}
  summary():BranchSummary {
    const cp=this.simulation.checkpoint(),runtime=this.checkpoint();const checkpoints=[...this.checkpoints].map(([id,c])=>({id,tick:c.simulation.tick}));
    return {...this.target,historyId:this.options.historyId,playback:this.playback(),mode:this.mode,tick:cp.tick,time:cp.tick/cp.config.hz,paused:this.controlState.paused,speed:this.controlState.speed,fastForwardRemaining:this.controlState.fastForwardRemaining,subjective:cp.subjective,activity:cp.activity,stateHash:hashCheckpoint(cp),eventHash:cp.eventHash,runtimeHash:hashRuntimeCheckpoint(runtime),checkpoint:checkpoints.at(-1)??{id:'unsaved',tick:cp.tick},checkpoints,runs:[...this.runs],logging:this.recorder?.health()??null,worldSecondsPerModelResponse:null};
  }
  replayOperation(raw:unknown){this.requireActive();const op=validateRuntimeOperation(raw);this.flushAdvance();if(op.sequence!==this.controlState.nextOperationSequence||op.tick!==this.simulation.state.tick)throw new Error('Runtime replay operation order mismatch');
    if(op.kind==='input'){const result=this.enqueue(op.input.command);if(canonicalStringify(result.input)!==canonicalStringify(op.input))throw new Error('Runtime replay input mismatch');}
    else if(op.kind==='control')this.applyControl(op.action);
    else {if(op.source==='scheduled'&&this.controlState.paused&&op.ticks>0||op.source==='fast-forward'&&op.ticks>this.controlState.fastForwardRemaining)throw new Error('Invalid runtime advance state');for(let i=0;i<op.ticks;i++)this.advanceOne(op.source);this.scheduler.rebase(op.backlogMs);this.pendingAdvance??={tick:op.tick,ticks:0,source:op.source};this.flushAdvance();}
  }
  async close(){if(this.disposed)return;this.disposed=true;clearImmediate(this.fastJob);this.capture();await this.recorder?.close();}
}
export function replayRuntime(start:unknown,operations:unknown[],expected:unknown){const from=validateRuntimeCheckpoint(start),end=validateRuntimeCheckpoint(expected);if(from.mode!==end.mode)throw new Error('Runtime mode mismatch');const runtime=new BranchRuntime({worldId:'offline',branchId:'offline',mode:from.mode,checkpoint:from,offline:true});runtime.drainEvents();for(const op of operations)runtime.replayOperation(op);const checkpoint=runtime.checkpoint(),runtimeHash=hashRuntimeCheckpoint(checkpoint);if(runtimeHash!==hashRuntimeCheckpoint(end))throw new Error('Runtime replay hash mismatch');return {checkpoint,stateHash:hashCheckpoint(checkpoint.simulation),eventHash:checkpoint.simulation.eventHash,runtimeHash,events:runtime.drainEvents()};}
