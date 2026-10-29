import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { CheckpointV1, DeterministicEvent, OrderedInput } from '../simulation.js';

export type Category = 'WORLD_TRUTH' | 'FOX_EXPERIENCE' | 'PRIVATE_SENSOR' | 'OPERATIONAL_REPLAY';
export type Severity = 'debug' | 'info' | 'warn' | 'error';
export type Primitive = string | number | boolean | null;
export interface RecordRequest {
  tick: number; category: Category; eventType: string; component: string; outcome: string;
  severity?: Severity; eventSequence?: number; inputSequence?: number; parentSequence?: number;
  data?: Record<string, Primitive>;
}
export interface DiagnosticRecord {
  schema_version: 1; utc: string; world_tick: number; world_elapsed_seconds: number; mode: 'LOCAL_DEV';
  world_id: string; run_id: string; sequence: number; event_id: string; event_type: string;
  category: Category; severity: Severity; component: string; state_version: number; outcome: string;
  deterministic_event_sequence?: number; input_sequence?: number; causal_event_id?: string;
  data: Record<string, Primitive>;
  ordered_input?: OrderedInput;
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
  globalRetainedBytes: number; globalRetainedRuns: number; globalCapExceeded: boolean; protectedActiveRuns: number;
}
interface RecorderOptions {
  directory?: string; worldId: string; runId: string; hz?: number; now?: () => number; minSeverity?: Severity;
  limits?: Partial<RecorderLimits>; append?: (path: string, data: string) => Promise<void>;
}
const ranks: Record<Severity, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const safeId = (value: string) => /^[A-Za-z0-9_-]{1,100}$/.test(value);
const dataKeys = new Set([
  'sequence', 'receivedTick', 'applyTick', 'admission', 'reason', 'type', 'command', 'id', 'time', 'intensity', 'suddenness', 'x', 'z', 'slamCount', 'startTick', 'durationSeconds',
  'strength', 'duration', 'start', 'thresholdIntensity', 'thresholdSuddenness', 'intensityThreshold', 'suddennessThreshold',
  'waypoint', 'nextWaypoint', 'pauseUntilTick', 'cooldownUntilTick', 'count', 'recipients', 'sent', 'failed', 'skipped',
  'monotonicGapMs', 'wallGapMs', 'wallDowntimeMs', 'skippedTicks', 'skippedCatchupTicks', 'discardedBacklogMs', 'skippedMs', 'backlogMs', 'gapMs', 'stepMs',
  'detectedBy', 'classification', 'stateHash', 'eventHash', 'checkpointTick', 'available', 'evidence', 'queued',
  'queuedViewers', 'connectedViewers', 'displayed', 'audioPlayed', 'viewers',
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

/** Observational writer. It never throws from record/capture or consumes simulation IDs/randomness. */
export class FlightRecorder {
  readonly runDirectory: string;
  readonly limits: RecorderLimits;
  private readonly now: () => number;
  private readonly append: (path: string, data: string) => Promise<void>;
  private readonly identity: { worldId: string; runId: string };
  private readonly minimum: Severity;
  private readonly hz: number;
  private queue: { line: string; critical: boolean }[] = [];
  private bytes = 0;
  private inFlightRecords = 0;
  private inFlightBytes = 0;
  private sequence = 0;
  private fileSequence = 0;
  private fileBytes = 0;
  private fileStarted = 0;
  private files: { name: string; bytes: number; records: number }[] = [];
  private initial: CheckpointV1 | null = null;
  private latest: CheckpointV1 | null = null;
  private dirtyCheckpoint = false;
  private startRecorderSequence = 0;
  private checkpointRecorderSequence = 0;
  private closed = false;
  private pending: Promise<void> = Promise.resolve();
  private writing = false;
  private timer: ReturnType<typeof setInterval>;
  private counters = { writtenRecords: 0, droppedRecords: 0, criticalDroppedRecords: 0, filteredRecords: 0, writerFailures: 0, evictedRecords: 0 };
  private lastError: string | null = null;
  private gaps: string[] = [];
  private persistedHealth = '';
  private activeMarkerWritten = false;
  private globalHealth = { globalRetainedBytes: 0, globalRetainedRuns: 0, globalCapExceeded: false, protectedActiveRuns: 0 };
  constructor(options: RecorderOptions) {
    if (!safeId(options.worldId) || !safeId(options.runId)) throw new Error('Invalid diagnostic identity');
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    for (const value of Object.values(this.limits)) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid recorder limit');
    if (this.limits.reserveCriticalRecords >= this.limits.queueRecords || this.limits.recordBytes > this.limits.queueBytes || this.limits.recordBytes > this.limits.fileBytes || this.limits.fileBytes > this.limits.diskBytes) throw new Error('Inconsistent recorder limits');
    this.identity = { worldId: options.worldId, runId: options.runId };
    this.runDirectory = join(options.directory ?? 'diagnostics/runs', options.runId);
    this.now = options.now ?? Date.now;
    this.append = options.append ?? ((path, data) => appendFile(path, data, 'utf8'));
    this.minimum = options.minSeverity ?? 'info';
    this.hz = options.hz ?? 30;
    if (!Number.isInteger(this.hz) || this.hz < 1 || this.hz > 120) throw new Error('Invalid recorder tick rate');
    this.timer = setInterval(() => { void this.flush(); }, this.limits.flushIntervalMs);
    this.timer.unref();
  }
  private gap(message: string): void { if (!this.gaps.includes(message) && this.gaps.length < 32) this.gaps.push(message); }
  record(request: RecordRequest, critical = false): void {
    if (this.closed) return;
    if (!critical && ranks[request.severity ?? 'info'] < ranks[this.minimum]) { this.counters.filteredRecords++; return; }
    try {
      const tick = request.tick;
      const record: DiagnosticRecord = {
        schema_version: 1, utc: new Date(this.now()).toISOString(), world_tick: tick,
        world_elapsed_seconds: tick / this.hz, mode: 'LOCAL_DEV', world_id: this.identity.worldId, run_id: this.identity.runId,
        sequence: ++this.sequence, event_id: `record:${this.sequence}`, event_type: safeLabel(request.eventType),
        category: request.category, severity: request.severity ?? 'info', component: safeLabel(request.component),
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
    this.queue.push({ line, critical }); this.bytes += bytes;
  }
  recordInput(input: OrderedInput): void {
    try {
    const command = input.command.type === 'slam' ? { type: 'slam' as const } : { type: 'invalid' as const, reason: input.command.reason };
    const safe: OrderedInput = { sequence: input.sequence, receivedTick: input.receivedTick, applyTick: input.applyTick, command, admission: input.admission };
    const record: DiagnosticRecord = {
      schema_version: 1, utc: new Date(this.now()).toISOString(), world_tick: input.receivedTick, world_elapsed_seconds: input.receivedTick / this.hz,
      mode: 'LOCAL_DEV', world_id: this.identity.worldId, run_id: this.identity.runId, sequence: ++this.sequence, event_id: `record:${this.sequence}`,
      event_type: 'ORDERED_INPUT', category: 'OPERATIONAL_REPLAY', severity: 'info', component: 'transport', state_version: input.receivedTick,
      outcome: input.admission, input_sequence: input.sequence, data: {}, ordered_input: safe,
    };
    this.enqueueRecord(record, true);
    } catch { this.counters.droppedRecords++; this.counters.criticalDroppedRecords++; this.gap('input_serialization_failed'); }
  }
  recordEvent(event: DeterministicEvent): void {
    this.record({ tick: event.tick, category: event.type === 'REFLEX_DECISION' ? 'PRIVATE_SENSOR' : event.type.startsWith('INPUT_') ? 'OPERATIONAL_REPLAY' : 'WORLD_TRUTH',
      eventType: event.type, component: event.component, outcome: event.outcome, eventSequence: event.sequence,
      inputSequence: event.inputSequence, parentSequence: event.parentSequence, data: event.data }, true);
  }
  captureCheckpoint(checkpoint: CheckpointV1): void {
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
      retainedFiles: this.files.length, retainedBytes: this.files.reduce((n, f) => n + f.bytes, 0), lastError: this.lastError, gaps: [...this.gaps], ...this.globalHealth };
  }
  flush(): Promise<void> {
    if (this.writing) return this.pending;
    this.writing = true;
    this.pending = this.writeBatch().finally(() => { this.writing = false; });
    return this.pending;
  }
  private async atomic(name: string, value: unknown): Promise<void> {
    const target = join(this.runDirectory, name), temp = target + '.tmp';
    await writeFile(temp, JSON.stringify(value, null, 2), 'utf8'); await rename(temp, target);
  }
  private async enforceGlobalRetention(): Promise<void> {
    const root = resolve(dirname(this.runDirectory));
    const generated = /^(events-\d{5}\.jsonl|checkpoint-(start|end)\.json|run\.json|_active\.json)(\.tmp)?$/;
    const runs: { path: string; bytes: number; modified: number; removable: boolean; active: boolean; files: string[] }[] = [];
    let unownedBytes = 0;
    const boundedRetentionJSON=async(path:string)=>{if((await stat(path)).size>64*1024)throw new Error('Oversized retention metadata');return JSON.parse(await readFile(path,'utf8'));};
    for (const entry of await readdir(root,{withFileTypes:true})) {
      if (!entry.isDirectory() || !safeId(entry.name)) {
        if (entry.isFile()) unownedBytes += (await stat(join(root,entry.name))).size;
        continue;
      }
      const path=resolve(root,entry.name);
      if (!path.startsWith(root+sep)) throw new Error('Retention path escaped root');
      const entries=await readdir(path,{withFileTypes:true}); let bytes=0, removable=true;
      const files:string[]=[];
      for(const file of entries) {
        if (!file.isFile() || !generated.test(file.name)) { removable=false; if(file.isFile())bytes+=(await stat(join(path,file.name))).size;else this.gap('unaccounted_unowned_directory');continue; }
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
      for(const name of run.files)await unlink(join(run.path,name));
      const {rmdir}=await import('node:fs/promises');await rmdir(run.path);
      total-=run.bytes;count--;
    }
    this.globalHealth={globalRetainedBytes:total,globalRetainedRuns:count,globalCapExceeded:count>this.limits.retainedRuns || total>this.limits.globalDiskBytes,protectedActiveRuns:runs.filter(r=>r.active).length};
    if(this.globalHealth.globalCapExceeded)this.gap('global_retention_cap_blocked_by_active_or_unowned_data');
  }
  private async writeBatch(): Promise<void> {
    if (!this.queue.length && !this.dirtyCheckpoint && this.persistedHealth === JSON.stringify(this.health())) return;
    const batch = this.queue; this.queue = []; this.inFlightRecords = batch.length; this.inFlightBytes = this.bytes; this.bytes = 0;
    let written = 0;
    try {
      await mkdir(this.runDirectory, { recursive: true });
      if(!this.activeMarkerWritten){await this.atomic('_active.json',{pid:process.pid,runId:this.identity.runId});this.activeMarkerWritten=true;}
      for (const entry of batch) {
        const bytes = Buffer.byteLength(entry.line);
        if (this.fileBytes && (this.fileBytes + bytes > this.limits.fileBytes || this.now() - this.fileStarted >= this.limits.fileAgeMs)) { this.fileSequence++; this.fileBytes = 0; }
        if (!this.fileBytes) { this.fileStarted = this.now(); this.files.push({ name: `events-${this.fileSequence.toString().padStart(5, '0')}.jsonl`, bytes: 0, records: 0 }); }
        const file = this.files.at(-1)!;
        await this.append(join(this.runDirectory, file.name), entry.line);
        this.fileBytes += bytes; file.bytes += bytes; file.records++; this.counters.writtenRecords++; written++;
        while (this.files.length > this.limits.retainedFiles || this.files.reduce((n, f) => n + f.bytes, 0) > this.limits.diskBytes) {
          const old = this.files.shift()!; await unlink(join(this.runDirectory, old.name)); this.counters.evictedRecords += old.records; this.gap('retention_evicted_records');
          if (!this.files.length) { this.fileSequence++; this.fileBytes = 0; }
        }
      }
      if (this.dirtyCheckpoint && this.initial && this.latest) {
        const latest = this.latest;
        await this.atomic('checkpoint-start.json', this.initial); await this.atomic('checkpoint-end.json', latest);
        if (latest === this.latest) this.dirtyCheckpoint = false;
      }
      this.inFlightRecords = 0; this.inFlightBytes = 0;
      const health = this.health();
      const metadata={schema_version:1,...this.identity,limits:this.limits,startRecorderSequence:this.startRecorderSequence,checkpointRecorderSequence:this.checkpointRecorderSequence,lastRecorderSequence:this.sequence};
      await this.atomic('run.json', { ...metadata, health });
      await this.enforceGlobalRetention();
      if(JSON.stringify(this.health())!==JSON.stringify(health))await this.atomic('run.json',{...metadata,health:this.health()});
      this.persistedHealth = JSON.stringify(health);
    } catch {
      this.counters.writerFailures++; this.counters.droppedRecords += batch.length - written;
      this.counters.criticalDroppedRecords += batch.slice(written).filter(entry => entry.critical).length;
      this.lastError = 'diagnostic_write_failed'; this.gap('writer_failure');
      // No raw exception messages/paths are persisted: they can contain private payloads.
    } finally { this.inFlightRecords = 0; this.inFlightBytes = 0; }
  }
  async close(): Promise<void> {
    if (this.closed) return; clearInterval(this.timer); await this.flush(); if (this.queue.length || this.dirtyCheckpoint) await this.flush(); this.closed = true;
    try {await unlink(join(this.runDirectory,'_active.json'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'){this.gap('active_marker_cleanup_failed');}}
  }
}

export async function readRun(directory: string): Promise<{ metadata: Record<string, unknown>; start: unknown; end: unknown; records: DiagnosticRecord[]; readGaps: string[] }> {
  const names = (await readdir(directory)).filter(name => /^events-\d{5}\.jsonl$/.test(name)).sort();
  let bytes = 0; const records: DiagnosticRecord[] = [],readGaps:string[]=[];
  for (const name of names) {
    bytes += (await stat(join(directory, name))).size;
    if (bytes > 8 * 1024 * 1024 || names.length > 32) throw new Error('Run exceeds bounded export input limits');
    const text = await readFile(join(directory, name), 'utf8');
    for (const line of text.split('\n').filter(Boolean)) {
      if (records.length >= 20_000) throw new Error('Run exceeds record limit');
      try {records.push(JSON.parse(line) as DiagnosticRecord);}catch{if(!readGaps.length)readGaps.push('corrupt_or_partial_jsonl_record');}
    }
  }
  const boundedJSON=async(name:string)=>{const path=join(directory,name);bytes+=(await stat(path)).size;if(bytes>8*1024*1024||(await stat(path)).size>2*1024*1024)throw new Error('Run metadata/checkpoint exceeds export limit');return JSON.parse(await readFile(path,'utf8'));};
  return { metadata: await boundedJSON('run.json'), start: await boundedJSON('checkpoint-start.json'), end: await boundedJSON('checkpoint-end.json'), records,readGaps };
}
