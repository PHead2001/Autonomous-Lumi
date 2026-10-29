import { randomUUID } from 'node:crypto';
import { hashCanonical, canonicalStringify } from './canonical.js';
import { LabSimulation, validateCheckpoint, hashCheckpoint, type CheckpointV2, type OrderedInput, type NormalizedCommand, type DeterministicEvent } from './simulation.js';
import { FixedScheduler, type HostClock, type SchedulerState } from './scheduler.js';
import { FlightRecorder } from './diagnostics/recorder.js';
import type { ActiveTarget, BranchSummary, ControlAction, WorldMode } from '../shared/lab-protocol.js';

export interface RuntimeControl {paused:boolean;speed:number;fastForwardRemaining:number;nextOperationSequence:number;loggingMode:'off'|'default'|'verbose';compressClosed:boolean}
export interface RuntimeCheckpoint {schemaVersion:1;kind:'lumi-branch-runtime';mode:WorldMode;simulation:CheckpointV2;control:RuntimeControl;scheduler:SchedulerState}
export type RuntimeOperation =
  | {sequence:number;tick:number;kind:'advance';ticks:number;backlogMs:number;source:'scheduled'|'fast-forward'}
  | {sequence:number;tick:number;kind:'input';input:OrderedInput}
  | {sequence:number;tick:number;kind:'control';action:ControlAction};
export function validId(value:unknown):value is string {return typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);}
const exact=(raw:unknown,keys:string[])=>!!raw&&typeof raw==='object'&&!Array.isArray(raw)&&canonicalStringify(Object.keys(raw).sort())===canonicalStringify(keys.sort());
const int=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
export function validateControlAction(value:unknown):ControlAction {
  if(!value||typeof value!=='object')throw new Error('Invalid control');const a=value as Record<string,unknown>;
  if(['pause','resume','step','cancel-fast-forward','activity-pause','activity-resume'].includes(a.type as string)&&exact(a,['type']))return structuredClone(a) as ControlAction;
  if(a.type==='speed'&&exact(a,['type','speed'])&&typeof a.speed==='number'&&Number.isFinite(a.speed)&&a.speed>=1&&a.speed<=60)return {type:'speed',speed:a.speed};
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
  if(c.schemaVersion!==1||c.kind!=='lumi-branch-runtime'||!['LIVE','EXPERIMENT'].includes(c.mode))throw new Error('Incompatible runtime checkpoint');
  const sim=validateCheckpoint(c.simulation);if(sim.schemaVersion!==2)throw new Error('Runtime requires explicit lab simulation schema');
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
  if(o.kind==='control'&&exact(o,['sequence','tick','kind','action'])){validateControlAction(o.action);return structuredClone(o);}
  if(o.kind==='input'&&exact(o,['sequence','tick','kind','input'])) {
    const i=o.input;
    if(!exact(i,['sequence','receivedTick','applyTick','command','admission'])||!int(i.sequence,1,Number.MAX_SAFE_INTEGER)||i.receivedTick!==o.tick||i.applyTick!==o.tick+1||!['queued','queue_full'].includes(i.admission)||!(exact(i.command,['type'])&&i.command.type==='slam'||exact(i.command,['type','reason'])&&i.command.type==='invalid'&&['malformed_json','invalid_shape','unknown_command'].includes(i.command.reason)))throw new Error('Invalid runtime input');
    return structuredClone(o);
  }
  if(o.kind==='advance'&&exact(o,['sequence','tick','kind','ticks','backlogMs','source'])&&int(o.ticks,0,10000000)&&typeof o.backlogMs==='number'&&Number.isFinite(o.backlogMs)&&o.backlogMs>=0&&['scheduled','fast-forward'].includes(o.source))return structuredClone(o);
  throw new Error('Invalid runtime operation fields');
}
export const hashRuntimeCheckpoint=(c:RuntimeCheckpoint)=>hashCanonical(validateRuntimeCheckpoint(c));
interface RuntimeOptions {worldId:string;branchId:string;mode:WorldMode;checkpoint?:unknown;seed?:number;directory?:string;clock?:HostClock;offline?:boolean;onEvents?:(events:DeterministicEvent[],runtime:BranchRuntime)=>void}
export class BranchRuntime {
  readonly target:ActiveTarget; readonly simulation:LabSimulation; readonly scheduler:FixedScheduler; readonly recorder:FlightRecorder|null;
  readonly mode:WorldMode; readonly checkpoints=new Map<string,RuntimeCheckpoint>(); readonly runs:string[]=[];
  private controlState:RuntimeControl;private pendingAdvance:{tick:number;ticks:number;source:'scheduled'|'fast-forward'}|null=null;
  private events:DeterministicEvent[]=[];private fastJob:ReturnType<typeof setImmediate>|undefined;private disposed=false;private recordedBacklogMs=0;
  constructor(private readonly options:RuntimeOptions) {
    if(!validId(options.worldId)||!validId(options.branchId))throw new Error('Invalid branch identity');
    this.target={worldId:options.worldId,branchId:options.branchId,runId:randomUUID()};this.mode=options.mode;
    const envelope=options.checkpoint&&typeof options.checkpoint==='object'&&(options.checkpoint as {kind?:unknown}).kind==='lumi-branch-runtime'?validateRuntimeCheckpoint(options.checkpoint):null;
    if(this.mode==='LIVE'&&!envelope&&options.checkpoint&&typeof options.checkpoint==='object'&&(options.checkpoint as {schemaVersion?:unknown}).schemaVersion===2)throw new Error('LIVE restoration requires a LIVE runtime envelope; bare lab state has no trusted mode');
    if(envelope&&envelope.mode==='EXPERIMENT'&&this.mode==='LIVE')throw new Error('Cannot promote experimental runtime into LIVE');
    this.simulation=new LabSimulation({checkpoint:envelope?.simulation??options.checkpoint,seed:options.seed,worldId:options.worldId,runId:this.target.runId,mode:options.mode});
    this.controlState=envelope?structuredClone(envelope.control):{paused:false,speed:this.mode==='LIVE'?1:6,fastForwardRemaining:0,nextOperationSequence:1,loggingMode:'default',compressClosed:false};
    if(this.mode==='LIVE'){this.controlState.paused=false;this.controlState.speed=1;this.controlState.fastForwardRemaining=0;}
    this.scheduler=new FixedScheduler(()=>this.advanceOne('scheduled'),e=>this.recorder?.record({tick:this.simulation.state.tick,category:'OPERATIONAL_REPLAY',eventType:e.type,component:'scheduler',severity:'warn',outcome:'observed',data:e.data}),options.clock,envelope?.scheduler.config??{maxStepsPerPump:this.mode==='EXPERIMENT'?48:8,maxBacklogSteps:this.mode==='EXPERIMENT'?96:16});
    if(envelope)this.scheduler.rebase(envelope.scheduler.backlogMs);
    this.recordedBacklogMs=this.scheduler.backlogMs;
    this.recorder=options.offline?null:new FlightRecorder({directory:options.directory,worldId:options.worldId,branchId:options.branchId,worldMode:options.mode,runId:this.target.runId,hz:this.simulation.checkpoint().config.hz,loggingMode:this.controlState.loggingMode,compressClosed:this.controlState.compressClosed});
    this.runs.push(this.target.runId);this.capture();
    if(this.controlState.fastForwardRemaining&&!options.offline)this.scheduleFastForward();
  }
  private observe(events:DeterministicEvent[]){if(this.options.offline)this.events.push(...events);for(const e of events)this.recorder?.recordEvent(e);this.options.onEvents?.(events,this);}
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
  pump():number {if(this.disposed)return 0;return this.scheduler.pump(this.controlState.speed,!this.controlState.paused&&this.controlState.fastForwardRemaining===0);}
  enqueue(command:NormalizedCommand) {
    if(this.disposed)throw new Error('Branch runtime is closed');
    this.flushAdvance();const accepted=this.simulation.enqueue(command);
    this.recordOperation({kind:'input',tick:this.simulation.state.tick,input:accepted.input} as Omit<RuntimeOperation,'sequence'>);
    this.recorder?.recordInput(accepted.input);this.observe(accepted.events);return accepted;
  }
  applyControl(raw:unknown):void {
    if(this.disposed)throw new Error('Branch runtime is closed');
    const action=validateControlAction(raw);
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
    this.recordOperation({kind:'control',tick:action.type==='step'?this.simulation.state.tick-1:this.simulation.state.tick,action} as Omit<RuntimeOperation,'sequence'>);this.observe(events);
    this.recorder?.record({tick:this.simulation.state.tick,category:'OPERATIONAL_REPLAY',eventType:'CONTROL_APPLIED',component:'laboratory',outcome:action.type,data:{control:action.type}});
    if(action.type==='fast-forward'&&!this.options.offline)this.scheduleFastForward();
  }
  private scheduleFastForward(){if(this.fastJob||this.disposed)return;this.fastJob=setImmediate(()=>{this.fastJob=undefined;if(this.disposed)return;const n=Math.min(128,this.controlState.fastForwardRemaining);for(let i=0;i<n;i++)this.advanceOne('fast-forward');if(this.controlState.fastForwardRemaining)this.scheduleFastForward();else this.flushAdvance();});}
  checkpoint():RuntimeCheckpoint {this.flushAdvance();return {schemaVersion:1,kind:'lumi-branch-runtime',mode:this.mode,simulation:this.simulation.checkpoint(),control:structuredClone(this.controlState),scheduler:this.scheduler.checkpoint()};}
  capture():RuntimeCheckpoint {const cp=this.checkpoint();this.recorder?.captureRuntimeCheckpoint(cp);return cp;}
  viewerState(){return {...this.simulation.snapshot(),branchId:this.target.branchId,mode:this.mode};}
  saveCheckpoint():{id:string;tick:number}{if(this.disposed)throw new Error('Branch runtime is closed');const cp=this.capture(),id=`checkpoint-${cp.simulation.tick}-${this.checkpoints.size+1}`;this.checkpoints.set(id,cp);return {id,tick:cp.simulation.tick};}
  drainEvents(){const events=this.events;this.events=[];return events;}
  summary():BranchSummary {
    const cp=this.simulation.checkpoint(),runtime=this.checkpoint();const checkpoints=[...this.checkpoints].map(([id,c])=>({id,tick:c.simulation.tick}));
    return {...this.target,mode:this.mode,tick:cp.tick,time:cp.tick/cp.config.hz,paused:this.controlState.paused,speed:this.controlState.speed,fastForwardRemaining:this.controlState.fastForwardRemaining,subjective:cp.subjective,activity:cp.activity,stateHash:hashCheckpoint(cp),eventHash:cp.eventHash,runtimeHash:hashRuntimeCheckpoint(runtime),checkpoint:checkpoints.at(-1)??{id:'unsaved',tick:cp.tick},checkpoints,runs:[...this.runs],logging:this.recorder?.health()??null,worldSecondsPerModelResponse:null};
  }
  replayOperation(raw:unknown){const op=validateRuntimeOperation(raw);this.flushAdvance();if(op.sequence!==this.controlState.nextOperationSequence||op.tick!==this.simulation.state.tick)throw new Error('Runtime replay operation order mismatch');
    if(op.kind==='input'){const result=this.enqueue(op.input.command);if(canonicalStringify(result.input)!==canonicalStringify(op.input))throw new Error('Runtime replay input mismatch');}
    else if(op.kind==='control')this.applyControl(op.action);
    else {if(op.source==='scheduled'&&this.controlState.paused&&op.ticks>0||op.source==='fast-forward'&&op.ticks>this.controlState.fastForwardRemaining)throw new Error('Invalid runtime advance state');for(let i=0;i<op.ticks;i++)this.advanceOne(op.source);this.scheduler.rebase(op.backlogMs);this.pendingAdvance??={tick:op.tick,ticks:0,source:op.source};this.flushAdvance();}
  }
  async close(){if(this.disposed)return;this.disposed=true;clearImmediate(this.fastJob);this.capture();await this.recorder?.close();}
}
export function replayRuntime(start:unknown,operations:unknown[],expected:unknown){const from=validateRuntimeCheckpoint(start),end=validateRuntimeCheckpoint(expected);if(from.mode!==end.mode)throw new Error('Runtime mode mismatch');const runtime=new BranchRuntime({worldId:'offline',branchId:'offline',mode:from.mode,checkpoint:from,offline:true});runtime.drainEvents();for(const op of operations)runtime.replayOperation(op);const checkpoint=runtime.checkpoint(),runtimeHash=hashRuntimeCheckpoint(checkpoint);if(runtimeHash!==hashRuntimeCheckpoint(end))throw new Error('Runtime replay hash mismatch');return {checkpoint,stateHash:hashCheckpoint(checkpoint.simulation),eventHash:checkpoint.simulation.eventHash,runtimeHash,events:runtime.drainEvents()};}
