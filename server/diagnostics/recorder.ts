import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { Gunzip } from 'fflate';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { dirname, join, resolve, sep } from 'node:path';
import { validateCommand, type Checkpoint, type DeterministicEvent, type OrderedInput } from '../simulation.js';
import {validateRuntimeCheckpoint,validateRuntimeOperation,type RuntimeCheckpoint,type RuntimeOperation} from '../branch-runtime.js';
import {assertOwnedPath} from '../checkpoint-storage.js';
type SimulationCheckpoint = Checkpoint;

export type Category = 'WORLD_TRUTH' | 'FOX_EXPERIENCE' | 'PRIVATE_SENSOR' | 'OPERATIONAL_REPLAY';
export type Severity = 'debug' | 'info' | 'warn' | 'error';
export type LoggingMode = 'off' | 'default' | 'verbose';
export type Primitive = string | number | boolean | null;
export interface RecordRequest {
  tick: number; category: Category; eventType: string; component: string; outcome: string;
  severity?: Severity; eventSequence?: number; inputSequence?: number; parentSequence?: number;
  data?: Record<string, Primitive>;
}
export interface DiagnosticRecord {
  schema_version: 1 | 2; utc: string; world_tick: number; world_elapsed_seconds: number; mode: 'LOCAL_DEV' | 'LIVE' | 'EXPERIMENT';
  branch_id?: string;
  world_id: string; run_id: string; sequence: number; event_id: string; event_type: string;
  category: Category; severity: Severity; component: string; state_version: number; outcome: string;
  deterministic_event_sequence?: number; input_sequence?: number; causal_event_id?: string;
  data: Record<string, Primitive>;
  ordered_input?: OrderedInput;
  runtime_operation?: RuntimeOperation;
}
export interface RecorderLimits {
  queueRecords: number; queueBytes: number; reserveCriticalRecords: number; recordBytes: number;
  fileBytes: number; fileAgeMs: number; retainedFiles: number; diskBytes: number; flushIntervalMs: number;
  retainedRuns: number; globalDiskBytes: number;
}
export const DEFAULT_LIMITS: RecorderLimits = {
  queueRecords: 1024, queueBytes: 1024 * 1024, reserveCriticalRecords: 128, recordBytes: 16 * 1024,
  fileBytes: 256 * 1024, fileAgeMs: 15 * 60_000, retainedFiles: 8, diskBytes: 2 * 1024 * 1024, flushIntervalMs: 100,
  retainedRuns: 4, globalDiskBytes: 8 * 1024 * 1024,
};
export interface RecorderHealth {
  status: 'HEALTHY' | 'INCOMPLETE'; queuedRecords: number; queuedBytes: number; writtenRecords: number;
  inFlightRecords: number; inFlightBytes: number;
  droppedRecords: number; criticalDroppedRecords: number; filteredRecords: number; writerFailures: number;
  evictedRecords: number; retainedFiles: number; retainedBytes: number; lastError: string | null;
  gaps: string[];
  globalRetainedBytes: number; globalRetainedRuns: number; globalCapExceeded: boolean; globalAccountingComplete: boolean; protectedActiveRuns: number;
  loggingMode: LoggingMode; disabledRecords: number;
  compressClosed: boolean;
}
export interface RunSnapshot {metadata:Record<string,unknown>;start:unknown;end:unknown;records:DiagnosticRecord[];readGaps:string[];runtimeStart?:unknown;runtimeEnd?:unknown}
interface RecorderOptions {
  directory?: string; worldId: string; runId: string; branchId?: string; worldMode?: 'LIVE' | 'EXPERIMENT'; loggingMode?: LoggingMode; compressClosed?: boolean;
  hz?: number; now?: () => number; minSeverity?: Severity;
  limits?: Partial<RecorderLimits>; append?: (path: string, data: string) => Promise<void>;
}
const ranks: Record<Severity, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const compress = promisify(gzip);
const safeId = (value: string) => /^[A-Za-z0-9_-]{1,100}$/.test(value);
const dataKeys = new Set([
  'sequence', 'receivedTick', 'applyTick', 'admission', 'reason', 'type', 'command', 'id', 'time', 'intensity', 'suddenness', 'x', 'z', 'slamCount', 'startTick', 'durationSeconds',
  'strength', 'duration', 'start', 'thresholdIntensity', 'thresholdSuddenness', 'intensityThreshold', 'suddennessThreshold',
  'waypoint', 'nextWaypoint', 'pauseUntilTick', 'cooldownUntilTick', 'count', 'recipients', 'sent', 'failed', 'skipped',
  'monotonicGapMs', 'wallGapMs', 'wallDowntimeMs', 'skippedTicks', 'skippedCatchupTicks', 'discardedBacklogMs', 'skippedMs', 'backlogMs', 'gapMs', 'stepMs',
  'detectedBy', 'classification', 'stateHash', 'eventHash', 'checkpointTick', 'available', 'evidence', 'queued',
  'queuedViewers', 'connectedViewers', 'displayed', 'audioPlayed', 'viewers',
  'provenance', 'attended', 'encoded', 'observationId', 'cue', 'valueSeconds', 'estimateSeconds', 'uncertaintySeconds', 'calibrated', 'rate', 'bias',
  'activityId', 'cursor', 'total', 'progress', 'completed', 'completionCount', 'paused', 'speed', 'ticks', 'remainingTicks', 'controlSequence', 'action', 'checkpointHash',
  'sensed','experienceId','observedSeconds','totalTicks','control','kind','historyId','generation','fallback','checkpointAgeMs','enabled',
  'fromSchema','toSchema','actionId','yaw','pitch','targetYaw','targetPitch','sceneRevision','illumination','fixture','fixtureColor','doorOpenRadians','frameHash','capturedTick',
  'captureId','stateVersion','dynamicRevision','renderRevision','captureReason','width','height','bodyHeading','headYaw','headPitch','eyeX','eyeY','eyeZ','horizontalFovDegrees','backend','webglRenderer','visibleCount','validationTick','durationMs','completionUtc',
  'format','chromium','webglVendor','webglVersion',
]);
const safeLabel = (value: string) => value.replace(/[^A-Za-z0-9_. :/-]/g, '_').slice(0, 160);
export function sanitizeData(data: Record<string, Primitive> = {}): Record<string, Primitive> {
  const result: Record<string, Primitive> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!dataKeys.has(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
    else if (typeof value === 'boolean' || value === null) result[key] = value;
    else if (typeof value === 'string') result[key] = safeLabel(value);
  }
  return result;
}

// A branch's recorders share retention ownership. Serialize their filesystem
// publication, scans and readers: a scan must never stat another writer's
// disappearing .tmp file or hold its metadata open during a Windows rename.
// Other branches and the authoritative simulation do not acquire this lock.
const storageQueues = new Map<string, Promise<void>>();
async function withStorage<T>(runDirectory:string,work:()=>Promise<T>):Promise<T> {
  const directory=resolve(dirname(runDirectory)),key=process.platform==='win32'?directory.toLowerCase():directory;
  const previous=storageQueues.get(key)??Promise.resolve();let release!:()=>void;
  const gate=new Promise<void>(done=>{release=done;}),tail=previous.then(()=>gate);storageQueues.set(key,tail);
  await previous;
  try{return await work();}
  finally{release();if(storageQueues.get(key)===tail)storageQueues.delete(key);}
}

/** Observational writer. It never throws from record/capture or consumes simulation IDs/randomness. */
export class FlightRecorder {
  readonly runDirectory: string;
  private readonly ownedRoot:string;
  readonly limits: RecorderLimits;
  private readonly now: () => number;
  private readonly append: (path: string, data: string) => Promise<void>;
  private readonly identity: { worldId: string; runId: string; branchId?: string; worldMode?: 'LIVE'|'EXPERIMENT' };
  private readonly minimum: Severity;
  private readonly hz: number;
  private loggingMode: LoggingMode;
  private disabledRecords = 0;
  private compressClosed: boolean;
  private queue: { line: string; critical: boolean; sequence:number }[] = [];
  private bytes = 0;
  private inFlightRecords = 0;
  private inFlightBytes = 0;
  private sequence = 0;
  private fileSequence = 0;
  private fileBytes = 0;
  private fileStarted = 0;
  private files: { name: string; bytes: number; records: number }[] = [];
  private initial: SimulationCheckpoint | null = null;
  private latest: SimulationCheckpoint | null = null;
  private initialRuntime:RuntimeCheckpoint|null=null;
  private latestRuntime:RuntimeCheckpoint|null=null;
  private dirtyCheckpoint = false;
  private startRecorderSequence = 0;
  private checkpointRecorderSequence = 0;
  private closed = false;
  private pending: Promise<void> = Promise.resolve();
  private writing = false;
  private snapshotInProgress = false;
  private snapshotFinished:Promise<void>|null=null;
  private durableCheckpointRecorderSequence = 0;
  private durableLastRecorderSequence = 0;
  private writerDroppedRecords = 0;
  private writerCriticalDroppedRecords = 0;
  private timer: ReturnType<typeof setInterval>;
  private counters = { writtenRecords: 0, droppedRecords: 0, criticalDroppedRecords: 0, filteredRecords: 0, writerFailures: 0, evictedRecords: 0 };
  private lastError: string | null = null;
  private gaps: string[] = [];
  private persistedHealth = '';
  private activeMarkerWritten = false;
  private globalHealth = { globalRetainedBytes: 0, globalRetainedRuns: 0, globalCapExceeded: false, globalAccountingComplete: true, protectedActiveRuns: 0 };
  constructor(options: RecorderOptions) {
    if (!safeId(options.worldId) || !safeId(options.runId) || (options.branchId!==undefined&&!safeId(options.branchId))) throw new Error('Invalid diagnostic identity');
    if ((options.branchId===undefined)!==(options.worldMode===undefined))throw new Error('Branch identity and mode must be supplied together');
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    for (const value of Object.values(this.limits)) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid recorder limit');
    if (this.limits.reserveCriticalRecords >= this.limits.queueRecords || this.limits.recordBytes > this.limits.queueBytes || this.limits.recordBytes > this.limits.fileBytes || this.limits.fileBytes > this.limits.diskBytes) throw new Error('Inconsistent recorder limits');
    this.identity = { worldId: options.worldId, runId: options.runId,...(options.branchId===undefined?{}:{branchId:options.branchId,worldMode:options.worldMode}) };
    this.ownedRoot=resolve(options.directory??'diagnostics/runs');
    this.runDirectory = options.branchId===undefined?join(options.directory ?? 'diagnostics/runs', options.runId):join(options.directory??'diagnostics/runs',options.worldId,options.branchId,'runs',options.runId);
    this.loggingMode=options.loggingMode??'default';this.compressClosed=options.compressClosed??false;
    if(this.loggingMode==='off')this.gap('logging_disabled');
    this.now = options.now ?? Date.now;
    this.append = options.append ?? ((path, data) => appendFile(path, data, 'utf8'));
    this.minimum = options.minSeverity ?? 'info';
    this.hz = options.hz ?? 30;
    if (!Number.isInteger(this.hz) || this.hz < 1 || this.hz > 120) throw new Error('Invalid recorder tick rate');
    this.timer = setInterval(() => { void this.flush(); }, this.limits.flushIntervalMs);
    this.timer.unref();
  }
  private gap(message: string): void { if (!this.gaps.includes(message) && this.gaps.length < 32) this.gaps.push(message); }
  /** Preparation is a failable lifecycle boundary; ordinary observational flushes remain nonthrowing. */
  async prepare():Promise<void>{await this.flush();if(this.counters.writerFailures)throw new Error('Diagnostic writer initialization failed; replacement was not activated');}
  private async prepareDirectory():Promise<void>{await mkdir(this.ownedRoot,{recursive:true});await assertOwnedPath(this.ownedRoot,this.runDirectory);await mkdir(this.runDirectory,{recursive:true});await assertOwnedPath(this.ownedRoot,this.runDirectory);}
  setLoggingMode(mode:LoggingMode,compressClosed=this.compressClosed):void{if(!['off','default','verbose'].includes(mode)||typeof compressClosed!=='boolean')throw new Error('Invalid logging mode');this.loggingMode=mode;this.compressClosed=compressClosed;if(mode==='off')this.gap('logging_disabled');}
  private enabled():boolean{if(this.closed)return false;if(this.loggingMode==='off'){this.disabledRecords++;this.gap('logging_disabled');return false;}return true;}
  record(request: RecordRequest, critical = false): void {
    this.recordTrusted(request,critical,false);
  }
  private recordTrusted(request:RecordRequest,critical:boolean,experienceEligible:boolean):void {
    if(!this.enabled())return;
    if (!critical && ranks[request.severity ?? 'info'] < ranks[this.loggingMode==='verbose'?'debug':this.minimum]) { this.counters.filteredRecords++; return; }
    try {
      const tick = request.tick;
      const record: DiagnosticRecord = {
        schema_version: this.identity.branchId?2:1, utc: new Date(this.now()).toISOString(), world_tick: tick,
        world_elapsed_seconds: tick / this.hz, mode: this.identity.worldMode??'LOCAL_DEV', world_id: this.identity.worldId, run_id: this.identity.runId,
        ...(this.identity.branchId?{branch_id:this.identity.branchId}:{}),
        sequence: ++this.sequence, event_id: `record:${this.sequence}`, event_type: safeLabel(request.eventType),
        category: request.category==='FOX_EXPERIENCE'&&!experienceEligible?'PRIVATE_SENSOR':request.category, severity: request.severity ?? 'info', component: safeLabel(request.component),
        state_version: tick, outcome: safeLabel(request.outcome), data: sanitizeData(request.data),
        ...(request.eventSequence === undefined ? {} : { deterministic_event_sequence: request.eventSequence }),
        ...(request.inputSequence === undefined ? {} : { input_sequence: request.inputSequence }),
        ...(request.parentSequence === undefined ? {} : { causal_event_id: `simulation:${request.parentSequence}` }),
      };
      this.enqueueRecord(record, critical);
    } catch { this.counters.droppedRecords++; if (critical) this.counters.criticalDroppedRecords++; this.gap('record_serialization_failed'); }
  }
  private enqueueRecord(record: DiagnosticRecord, critical: boolean): void {
    const line = JSON.stringify(record) + '\n', bytes = Buffer.byteLength(line);
    const countCap = critical ? this.limits.queueRecords : this.limits.queueRecords - this.limits.reserveCriticalRecords;
    if (bytes > this.limits.recordBytes || this.queue.length + this.inFlightRecords >= countCap || this.bytes + this.inFlightBytes + bytes > this.limits.queueBytes) {
      this.counters.droppedRecords++; if (critical) this.counters.criticalDroppedRecords++;
      this.gap(critical ? 'critical_queue_or_record_limit' : 'queue_or_record_limit'); return;
    }
    this.queue.push({ line, critical,sequence:record.sequence }); this.bytes += bytes;
  }
  recordInput(input: OrderedInput): void {
    if(!this.enabled())return;
    try {
    const command = validateCommand(input.command,true);
    const safe: OrderedInput = { sequence: input.sequence, receivedTick: input.receivedTick, applyTick: input.applyTick, command, admission: input.admission };
    const record: DiagnosticRecord = {
      schema_version: this.identity.branchId?2:1, utc: new Date(this.now()).toISOString(), world_tick: input.receivedTick, world_elapsed_seconds: input.receivedTick / this.hz,
      mode: this.identity.worldMode??'LOCAL_DEV', world_id: this.identity.worldId, run_id: this.identity.runId,...(this.identity.branchId?{branch_id:this.identity.branchId}:{}), sequence: ++this.sequence, event_id: `record:${this.sequence}`,
      event_type: 'ORDERED_INPUT', category: 'OPERATIONAL_REPLAY', severity: 'info', component: 'transport', state_version: input.receivedTick,
      outcome: input.admission, input_sequence: input.sequence, data: {}, ordered_input: safe,
    };
    this.enqueueRecord(record, true);
    } catch { this.counters.droppedRecords++; this.counters.criticalDroppedRecords++; this.gap('input_serialization_failed'); }
  }
  recordEvent(event: DeterministicEvent): void {
    const experienceEligible=this.identity.worldMode==='EXPERIMENT'&&event.type==='EXPERIENCE_ENCODED'&&event.data.provenance==='TEST STUB'&&event.data.sensed===true&&event.data.attended===true&&event.data.encoded===true;
    this.recordTrusted({ tick: event.tick, category: experienceEligible?'FOX_EXPERIENCE':event.type === 'EXPERIENCE_ENCODED'||event.type === 'REFLEX_DECISION'||event.type.startsWith('SYNTHETIC_') ? 'PRIVATE_SENSOR' : event.type.startsWith('INPUT_') ? 'OPERATIONAL_REPLAY' : 'WORLD_TRUTH',
      eventType: event.type, component: event.component, outcome: event.outcome, eventSequence: event.sequence,
      inputSequence: event.inputSequence, parentSequence: event.parentSequence, data: event.data }, true,experienceEligible);
  }
  recordVerboseTick(tick:number,data:Record<string,Primitive>={}):void{
    if(this.loggingMode!=='verbose')return;
    this.record({tick,category:'OPERATIONAL_REPLAY',eventType:'TICK_TRACE',component:'recorder',severity:'debug',outcome:'sampled',data});
  }
  recordRuntimeOperation(operation:RuntimeOperation):void{
    if(!this.enabled())return;
    try {
      const op=validateRuntimeOperation(operation);
      this.enqueueRecord({schema_version:2,utc:new Date(this.now()).toISOString(),world_tick:op.tick,world_elapsed_seconds:op.tick/this.hz,mode:this.identity.worldMode??'LOCAL_DEV',
        world_id:this.identity.worldId,run_id:this.identity.runId,branch_id:this.identity.branchId,sequence:++this.sequence,event_id:`record:${this.sequence}`,event_type:'RUNTIME_OPERATION',category:'OPERATIONAL_REPLAY',severity:'info',component:'runtime',state_version:op.tick,outcome:op.kind,data:{},runtime_operation:op},true);
    }catch{this.counters.droppedRecords++;this.counters.criticalDroppedRecords++;this.gap('runtime_operation_serialization_failed');}
  }
  captureRuntimeCheckpoint(checkpoint:RuntimeCheckpoint):void{
    try{const cp=validateRuntimeCheckpoint(checkpoint);if(cp.mode!==this.identity.worldMode)throw new Error('Runtime checkpoint mode mismatch');this.latestRuntime=cp;this.initialRuntime??=structuredClone(cp);this.captureCheckpoint(cp.simulation);}
    catch{this.gap('runtime_checkpoint_capture_failed');}
  }
  captureCheckpoint(checkpoint: SimulationCheckpoint): void {
    try {
      this.latest = structuredClone(checkpoint); this.checkpointRecorderSequence=this.sequence;
      if(!this.initial){this.initial=structuredClone(checkpoint);this.startRecorderSequence=this.sequence;}
      this.dirtyCheckpoint = true;
    }
    catch { this.gap('checkpoint_capture_failed'); }
  }
  health(): RecorderHealth {
    return { status: this.gaps.length ? 'INCOMPLETE' : 'HEALTHY', queuedRecords: this.queue.length, queuedBytes: this.bytes,
      inFlightRecords: this.inFlightRecords, inFlightBytes: this.inFlightBytes, ...this.counters,
      retainedFiles: this.files.length, retainedBytes: this.files.reduce((n, f) => n + f.bytes, 0), lastError: this.lastError, gaps: [...this.gaps], ...this.globalHealth,loggingMode:this.loggingMode,disabledRecords:this.disabledRecords,compressClosed:this.compressClosed };
  }
  flush(): Promise<void> {
    if (this.snapshotInProgress) return this.pending;
    if (this.writing) return this.pending;
    this.writing = true;
    this.pending = this.writeBatch().finally(() => { this.writing = false; });
    return this.pending;
  }
  /** Pin a complete evidence prefix without pausing LIVE or waiting for future arrivals. */
  async snapshotForExport():Promise<RunSnapshot>{
    if(this.closed)throw new Error('Closed recorder exports must use its durable run');
    if(this.snapshotInProgress)throw new Error('Diagnostic export snapshot is already in progress');
    if(!this.initial||!this.latest)throw new Error('Export requires captured checkpoints');
    const pin={start:structuredClone(this.initial),end:structuredClone(this.latest),runtimeStart:this.initialRuntime?structuredClone(this.initialRuntime):undefined,runtimeEnd:this.latestRuntime?structuredClone(this.latestRuntime):undefined,
      startSequence:this.startRecorderSequence,endSequence:this.checkpointRecorderSequence,health:this.health(),writerDropped:this.writerDroppedRecords,writerCriticalDropped:this.writerCriticalDroppedRecords};
    if(pin.endSequence!==this.sequence)throw new Error('Capture the current runtime immediately before pinning its export');
    this.snapshotInProgress=true;
    let finish!:()=>void;this.snapshotFinished=new Promise<void>(resolveFinished=>{finish=resolveFinished;});
    try{
      // The current batch may predate the captured terminal operation. Drain that prefix as a second batch.
      await this.pending;
      this.writing=true;
      this.pending=this.writeBatch(pin.endSequence).finally(()=>{this.writing=false;});
      await this.pending;
      // Writer exclusion makes this bounded file read stable; simulation may still enqueue newer evidence.
      await assertOwnedPath(this.ownedRoot,this.runDirectory);
      const durable=await readRun(this.runDirectory),now=this.health();
      const relevantGaps=new Set(pin.health.gaps);
      for(const gap of now.gaps)if(gap==='writer_failure'||gap==='retention_evicted_records'||gap.startsWith('global_')||gap.startsWith('unaccounted_')||gap.startsWith('unowned_'))relevantGaps.add(gap);
      const health:RecorderHealth={...pin.health,queuedRecords:0,queuedBytes:0,inFlightRecords:0,inFlightBytes:0,writtenRecords:now.writtenRecords,
        droppedRecords:pin.health.droppedRecords+this.writerDroppedRecords-pin.writerDropped,criticalDroppedRecords:pin.health.criticalDroppedRecords+this.writerCriticalDroppedRecords-pin.writerCriticalDropped,
        writerFailures:now.writerFailures,evictedRecords:now.evictedRecords,retainedFiles:now.retainedFiles,retainedBytes:now.retainedBytes,lastError:now.lastError,
        globalRetainedBytes:now.globalRetainedBytes,globalRetainedRuns:now.globalRetainedRuns,globalCapExceeded:now.globalCapExceeded,globalAccountingComplete:now.globalAccountingComplete,protectedActiveRuns:now.protectedActiveRuns,
        gaps:[...relevantGaps],status:relevantGaps.size?'INCOMPLETE':'HEALTHY'};
      return {...durable,start:pin.start,end:pin.end,runtimeStart:pin.runtimeStart,runtimeEnd:pin.runtimeEnd,
        records:durable.records.filter(record=>record.sequence>pin.startSequence&&record.sequence<=pin.endSequence),
        metadata:{...durable.metadata,...this.identity,startRecorderSequence:pin.startSequence,checkpointRecorderSequence:pin.endSequence,lastRecorderSequence:pin.endSequence,health}};
    }finally{this.snapshotInProgress=false;this.snapshotFinished=null;finish();if(this.queue.length||this.dirtyCheckpoint)void this.flush();}
  }
  private async atomic(name: string, value: unknown): Promise<void> {
    const target = join(this.runDirectory, name), temp = target + '.tmp';
    await assertOwnedPath(this.ownedRoot,target);await assertOwnedPath(this.ownedRoot,temp);
    await writeFile(temp, JSON.stringify(value, null, 2), 'utf8'); await rename(temp, target);
  }
  private async enforceGlobalRetention(): Promise<void> {
    const root = resolve(dirname(this.runDirectory));
    await assertOwnedPath(this.ownedRoot,root);
    const generated = /^(events-\d{5}\.jsonl(\.gz)?|checkpoint-(start|end)\.json|runtime-(start|end)\.json|run\.json|_active\.json)(\.tmp)?$/;
    const runs: { path: string; bytes: number; modified: number; removable: boolean; active: boolean; files: string[] }[] = [];
    let unownedBytes = 0, accountingComplete = true;
    const boundedRetentionJSON=async(path:string)=>{await assertOwnedPath(this.ownedRoot,path);if((await stat(path)).size>64*1024)throw new Error('Oversized retention metadata');return JSON.parse(await readFile(path,'utf8'));};
    for (const entry of await readdir(root,{withFileTypes:true})) {
      if (!entry.isDirectory() || !safeId(entry.name)) {
        if (entry.isFile()) unownedBytes += (await stat(join(root,entry.name))).size;
        else { accountingComplete=false; this.gap('global_disk_accounting_incomplete_unowned_directory_or_link'); }
        continue;
      }
      const path=resolve(root,entry.name);
      if (!path.startsWith(root+sep)) throw new Error('Retention path escaped root');
      await assertOwnedPath(this.ownedRoot,path);
      const entries=await readdir(path,{withFileTypes:true}); let bytes=0, removable=true;
      const files:string[]=[];
      for(const file of entries) {
        if (!file.isFile() || !generated.test(file.name)) { removable=false; if(file.isFile())bytes+=(await stat(join(path,file.name))).size;else {accountingComplete=false;this.gap('unaccounted_unowned_directory');}continue; }
        files.push(file.name);bytes+=(await stat(join(path,file.name))).size;
      }
      // A folder is owned only if its run metadata identifies this exact generated run.
      try { const meta=await boundedRetentionJSON(join(path,'run.json')); if(meta.schema_version!==1 || meta.runId!==entry.name){removable=false;this.gap('unowned_or_malformed_retention_metadata');} } catch {removable=false;this.gap('unowned_oversized_or_missing_retention_metadata');}
      let active=path===resolve(this.runDirectory);
      try {
        const marker=await boundedRetentionJSON(join(path,'_active.json'));
        if (Number.isSafeInteger(marker.pid) && marker.pid>0) { try {process.kill(marker.pid,0);active=true;}catch(error){ if((error as NodeJS.ErrnoException).code!=='ESRCH')active=true; } }
        else active=true;
      } catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT'){active=true;this.gap('unowned_oversized_or_malformed_active_marker');}}
      runs.push({path,bytes,modified:(await stat(path)).mtimeMs,removable,active,files});
    }
    let total=runs.reduce((n,r)=>n+r.bytes,unownedBytes),count=runs.length;
    for(const run of [...runs].sort((a,b)=>a.modified-b.modified)) {
      if(count<=this.limits.retainedRuns && total<=this.limits.globalDiskBytes)break;
      if(run.active || !run.removable)continue;
      // Only known generated files are unlinked, followed by an empty-directory removal.
      for(const name of run.files){await assertOwnedPath(this.ownedRoot,join(run.path,name));await unlink(join(run.path,name));}
      const {rmdir}=await import('node:fs/promises');await rmdir(run.path);
      total-=run.bytes;count--;
    }
    this.globalHealth={globalRetainedBytes:total,globalRetainedRuns:count,globalCapExceeded:count>this.limits.retainedRuns || total>this.limits.globalDiskBytes,globalAccountingComplete:accountingComplete,protectedActiveRuns:runs.filter(r=>r.active).length};
    if(this.globalHealth.globalCapExceeded)this.gap('global_retention_cap_blocked_by_active_or_unowned_data');
  }
  private writeBatch(throughSequence=Number.MAX_SAFE_INTEGER):Promise<void>{return withStorage(this.runDirectory,()=>this.writeBatchLocked(throughSequence));}
  /** Called only while this branch's storage serializer is held. */
  private async writeBatchLocked(throughSequence=Number.MAX_SAFE_INTEGER): Promise<void> {
    if (!this.queue.length && !this.dirtyCheckpoint && this.persistedHealth === JSON.stringify(this.health())) return;
    const count=this.queue.findIndex(entry=>entry.sequence>throughSequence);
    const batch=this.queue.splice(0,count<0?this.queue.length:count),batchBytes=batch.reduce((sum,entry)=>sum+Buffer.byteLength(entry.line),0);
    this.bytes-=batchBytes;this.inFlightRecords=batch.length;this.inFlightBytes=batchBytes;
    // Capture one immutable checkpoint generation before asynchronous writes begin.
    const checkpoint=this.dirtyCheckpoint&&this.initial&&this.latest&&this.checkpointRecorderSequence<=throughSequence?{
      start:this.initial,end:this.latest,runtimeStart:this.initialRuntime,runtimeEnd:this.latestRuntime,sequence:this.checkpointRecorderSequence}:null;
    let written = 0;
    try {
      await this.prepareDirectory();
      if(!this.activeMarkerWritten){await this.atomic('_active.json',{pid:process.pid,runId:this.identity.runId});this.activeMarkerWritten=true;}
      for (const entry of batch) {
        const bytes = Buffer.byteLength(entry.line);
        if (this.fileBytes && (this.fileBytes + bytes > this.limits.fileBytes || this.now() - this.fileStarted >= this.limits.fileAgeMs)) { if(this.compressClosed)await this.compressFile(this.files.at(-1)!);this.fileSequence++; this.fileBytes = 0; }
        const newFile = !this.fileBytes;
        const file = newFile ? { name: `events-${this.fileSequence.toString().padStart(5, '0')}.jsonl`, bytes: 0, records: 0 } : this.files.at(-1)!;
        await assertOwnedPath(this.ownedRoot,join(this.runDirectory,file.name));await this.append(join(this.runDirectory, file.name), entry.line);
        // A failed first append must not create phantom descriptors for the same filename.
        if (newFile) { this.fileStarted=this.now(); this.files.push(file); }
        this.fileBytes += bytes; file.bytes += bytes; file.records++; this.counters.writtenRecords++; written++;
        this.durableLastRecorderSequence=entry.sequence;
        while (this.files.length > this.limits.retainedFiles || this.files.reduce((n, f) => n + f.bytes, 0) > this.limits.diskBytes) {
          const old = this.files.shift()!; await assertOwnedPath(this.ownedRoot,join(this.runDirectory,old.name));await unlink(join(this.runDirectory, old.name)); this.counters.evictedRecords += old.records; this.gap('retention_evicted_records');
          if (!this.files.length) { this.fileSequence++; this.fileBytes = 0; }
        }
      }
      if (checkpoint) {
        await this.atomic('checkpoint-start.json', checkpoint.start); await this.atomic('checkpoint-end.json', checkpoint.end);
        if(checkpoint.runtimeStart&&checkpoint.runtimeEnd){await this.atomic('runtime-start.json',checkpoint.runtimeStart);await this.atomic('runtime-end.json',checkpoint.runtimeEnd);}
        this.durableCheckpointRecorderSequence=checkpoint.sequence;
        if (checkpoint.end === this.latest&&checkpoint.sequence===this.checkpointRecorderSequence) this.dirtyCheckpoint = false;
      }
      this.inFlightRecords = 0; this.inFlightBytes = 0;
      const health = this.health();
      const metadata={schema_version:1,...this.identity,limits:this.limits,startRecorderSequence:this.startRecorderSequence,checkpointRecorderSequence:this.durableCheckpointRecorderSequence,lastRecorderSequence:this.durableLastRecorderSequence};
      await this.atomic('run.json', { ...metadata, health });
      await this.enforceGlobalRetention();
      if(JSON.stringify(this.health())!==JSON.stringify(health))await this.atomic('run.json',{...metadata,health:this.health()});
      this.persistedHealth = JSON.stringify(health);
    } catch {
      this.counters.writerFailures++; this.counters.droppedRecords += batch.length - written;
      this.counters.criticalDroppedRecords += batch.slice(written).filter(entry => entry.critical).length;
      this.writerDroppedRecords+=batch.length-written;this.writerCriticalDroppedRecords+=batch.slice(written).filter(entry=>entry.critical).length;
      this.lastError = 'diagnostic_write_failed'; this.gap('writer_failure');
      // No raw exception messages/paths are persisted: they can contain private payloads.
    } finally { this.inFlightRecords = 0; this.inFlightBytes = 0; }
  }
  async close(): Promise<void> {
    if (this.closed) return; clearInterval(this.timer); if(this.snapshotFinished)await this.snapshotFinished;await this.flush(); if (this.queue.length || this.dirtyCheckpoint) await this.flush(); this.closed = true;
    try {await withStorage(this.runDirectory,async()=>{if(this.compressClosed&&this.files.at(-1)&&!this.files.at(-1)!.name.endsWith('.gz')){await this.compressFile(this.files.at(-1)!);await this.writeBatchLocked();}await assertOwnedPath(this.ownedRoot,join(this.runDirectory,'_active.json'));await unlink(join(this.runDirectory,'_active.json'));});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'){this.gap('active_marker_cleanup_failed');}}
  }
  private async compressFile(file:{name:string;bytes:number;records:number}):Promise<void>{
    if(file.name.endsWith('.gz'))return;
    const original=join(this.runDirectory,file.name);await assertOwnedPath(this.ownedRoot,original);await assertOwnedPath(this.ownedRoot,original+'.gz');await assertOwnedPath(this.ownedRoot,original+'.gz.tmp');if((await stat(original)).size>this.limits.fileBytes)throw new Error('Closed log exceeds compression bound');
    const bytes=await compress(await readFile(original));const compressed=original+'.gz';await writeFile(compressed+'.tmp',bytes);await rename(compressed+'.tmp',compressed);await unlink(original);
    file.name+='.gz';file.bytes=bytes.length;
  }
}

export function readRun(directory:string):Promise<RunSnapshot>{return withStorage(directory,()=>readRunLocked(directory));}
async function readRunLocked(directory: string): Promise<RunSnapshot> {
  const allNames=await readdir(directory);const names = allNames.filter(name => /^events-\d{5}\.jsonl(\.gz)?$/.test(name)).sort();
  let bytes = 0; const records: DiagnosticRecord[] = [],readGaps:string[]=[];
  for (const name of names) {
    bytes += (await stat(join(directory, name))).size;
    if (bytes > 8 * 1024 * 1024 || names.length > 32) throw new Error('Run exceeds bounded export input limits');
    const stored=await readFile(join(directory,name));const decoded=name.endsWith('.gz')?boundedGunzip(stored,8*1024*1024-bytes):stored;
    if(name.endsWith('.gz'))bytes+=decoded.length;
    if(bytes>8*1024*1024)throw new Error('Decompressed run exceeds export limit');
    const text = decoded.toString();
    for (const line of text.split('\n').filter(Boolean)) {
      if (records.length >= 20_000) throw new Error('Run exceeds record limit');
      try {records.push(JSON.parse(line) as DiagnosticRecord);}catch{if(!readGaps.length)readGaps.push('corrupt_or_partial_jsonl_record');}
    }
  }
  const boundedJSON=async(name:string)=>{const path=join(directory,name);bytes+=(await stat(path)).size;if(bytes>8*1024*1024||(await stat(path)).size>2*1024*1024)throw new Error('Run metadata/checkpoint exceeds export limit');return JSON.parse(await readFile(path,'utf8'));};
  const result={ metadata: await boundedJSON('run.json'), start: await boundedJSON('checkpoint-start.json'), end: await boundedJSON('checkpoint-end.json'), records,readGaps };
  if(allNames.includes('runtime-start.json')||allNames.includes('runtime-end.json')){
    if(!allNames.includes('runtime-start.json')||!allNames.includes('runtime-end.json')){readGaps.push('runtime_checkpoint_pair_missing');return result;}
    return {...result,runtimeStart:await boundedJSON('runtime-start.json'),runtimeEnd:await boundedJSON('runtime-end.json')};
  }
  return result;
}

export function boundedGunzip(bytes:Uint8Array,limit:number):Buffer{
  const chunks:Uint8Array[]=[];let length=0;
  const decoder=new Gunzip((chunk)=>{length+=chunk.length;if(length>limit)throw new Error('Compressed log exceeds decompression bound');chunks.push(chunk);});
  for(let offset=0;offset<bytes.length;offset+=16384)decoder.push(bytes.subarray(offset,offset+16384),offset+16384>=bytes.length);
  return Buffer.concat(chunks,length);
}
