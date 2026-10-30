import { readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { canonicalStringify, hashCanonical } from '../canonical.js';
import { replay } from '../replay.js';
import { hashCheckpoint, validateCheckpoint, validateCommand, type DeterministicEvent, type OrderedInput } from '../simulation.js';
import { readRun, sanitizeData, type DiagnosticRecord,type RunSnapshot } from './recorder.js';
import {validateRuntimeCheckpoint,validateRuntimeOperation,replayRuntime,hashRuntimeCheckpoint,type RuntimeCheckpoint} from '../branch-runtime.js';

const MAX_BYTES = 8 * 1024 * 1024;
const ENTRIES = ['README.md','manifest.json','SUMMARY.md','TIMELINE.md','REPRODUCTION.md','events.jsonl','inputs.jsonl','checkpoint-start.json','checkpoint-end.json','assertions.json'];
const RUNTIME_ENTRIES=['runtime-start.json','runtime-end.json','operations.jsonl'];
const identity = (value: unknown): string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : 'unknown';
export function cleanRecord(raw: DiagnosticRecord): DiagnosticRecord {
  const safe = (value: unknown) => typeof value === 'string' ? value.replace(/[^A-Za-z0-9_. :/-]/g, '_').slice(0,160) : 'unknown';
  if (!Number.isSafeInteger(raw.sequence) || !Number.isSafeInteger(raw.world_tick) || !['WORLD_TRUTH','FOX_EXPERIENCE','PRIVATE_SENSOR','OPERATIONAL_REPLAY'].includes(raw.category)) throw new Error('Invalid structured record');
  if(raw.schema_version!==1&&raw.schema_version!==2)throw new Error('Incompatible diagnostic record');
  if(raw.schema_version===2&&(!raw.branch_id||identity(raw.branch_id)==='unknown'||!['LIVE','EXPERIMENT'].includes(raw.mode)))throw new Error('Missing diagnostic branch identity');
  const result: DiagnosticRecord = { schema_version: raw.schema_version, utc: new Date(raw.utc).toISOString(), world_tick: raw.world_tick,
    world_elapsed_seconds: raw.world_elapsed_seconds, mode: raw.schema_version===2?raw.mode:'LOCAL_DEV', world_id: identity(raw.world_id), run_id: identity(raw.run_id),
    ...(raw.schema_version===2?{branch_id:raw.branch_id}:{}),
    sequence: raw.sequence, event_id: `record:${raw.sequence}`, event_type: safe(raw.event_type), category: raw.category,
    severity: ['debug','info','warn','error'].includes(raw.severity) ? raw.severity : 'info', component: safe(raw.component), state_version: raw.world_tick,
    outcome: safe(raw.outcome), data: sanitizeData(raw.data) };
  if (Number.isSafeInteger(raw.deterministic_event_sequence)) result.deterministic_event_sequence = raw.deterministic_event_sequence;
  if (Number.isSafeInteger(raw.input_sequence)) result.input_sequence = raw.input_sequence;
  if (typeof raw.causal_event_id === 'string' && /^simulation:\d+$/.test(raw.causal_event_id)) result.causal_event_id = raw.causal_event_id;
  // Ordered input payloads are rebuilt from the normalized command enum; raw visitor payloads never enter the archive.
  if (raw.ordered_input) {
    const i = raw.ordered_input;
    result.ordered_input = { sequence: i.sequence, receivedTick: i.receivedTick, applyTick: i.applyTick, admission: i.admission,
      command: validateCommand(i.command,true,true,true,true) };
  }
  if(raw.runtime_operation)result.runtime_operation=validateRuntimeOperation(raw.runtime_operation);
  return result;
}
function deterministic(record: DiagnosticRecord): DeterministicEvent {
  const event: DeterministicEvent = { sequence: record.deterministic_event_sequence!, tick: record.world_tick, type: record.event_type,
    component: record.component, outcome: record.outcome, data: record.data as DeterministicEvent['data'] };
  if (record.input_sequence !== undefined) event.inputSequence = record.input_sequence;
  if (record.causal_event_id) event.parentSequence = Number(record.causal_event_id.slice('simulation:'.length));
  return event;
}
function software() {
  let revision = 'unavailable', workingTree='unknown';
  try { revision = execFileSync('git', ['rev-parse','--short','HEAD'], { encoding:'utf8', stdio:['ignore','pipe','ignore'] }).trim(); } catch { /* Optional metadata, not a provenance gate. */ }
  try {workingTree=execFileSync('git',['status','--porcelain'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()?'modified':'clean';}catch{/* Optional metadata only. */}
  return { application: 'autonomous-lumi', node: process.version, revision, working_tree:workingTree, revision_note:'Available base revision; modified source is not identified by this revision alone.', build: 'TypeScript source via tsx; viewer built with Vite' };
}
export interface ExportOptions { runDirectory: string; out: string; fromTick?: number; toTick?: number; incident?: number;
  snapshot?:RunSnapshot;expectedWorldId?:string;expectedBranchId?:string;expectedRunId?:string;category?:string;component?:string;severity?:string;causalId?:string;search?:string;eventType?:string }
export async function exportIncident(options: ExportOptions) {
  const run = options.snapshot??await readRun(options.runDirectory);
  if([options.expectedWorldId,options.expectedBranchId,options.expectedRunId].some(value=>value!==undefined)){
    if([options.expectedWorldId,options.expectedBranchId,options.expectedRunId].some(value=>typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value)))throw new Error('Invalid export target');
    if(run.metadata.worldId!==options.expectedWorldId||run.metadata.branchId!==options.expectedBranchId||run.metadata.runId!==options.expectedRunId)throw new Error('Export target does not match recorded namespace');
  }
  const start = validateCheckpoint(run.start), end = validateCheckpoint(run.end);
  const from = options.fromTick ?? start.tick, to = options.toTick ?? end.tick;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < start.tick || to < from || to > end.tick) throw new Error('Requested range is outside retained checkpoint coverage');
  const records = run.records.map(cleanRecord).filter(record => record.world_tick >= start.tick && record.world_tick <= end.tick);
  if(records.some(record=>record.world_id!==run.metadata.worldId||record.run_id!==run.metadata.runId||record.branch_id!==run.metadata.branchId))throw new Error('Export contains a foreign recorded namespace');
  const inputs = records.filter(r => r.ordered_input && r.ordered_input.sequence >= start.nextInputSequence).map(r => r.ordered_input!);
  const metadataHealth = run.metadata.health && typeof run.metadata.health === 'object' ? run.metadata.health as Record<string, unknown> : {};
  const gaps: string[] = [...run.readGaps];
  if(metadataHealth.status!=='HEALTHY' || !Array.isArray(metadataHealth.gaps))gaps.push('recorder_health_missing_or_incomplete');
  if(Array.isArray(metadataHealth.gaps)&&metadataHealth.gaps.length)gaps.push('recorder_declared_coverage_gaps');
  for(const key of ['queuedRecords','queuedBytes','inFlightRecords','inFlightBytes'])if(metadataHealth[key]!==0)gaps.push('recorder_not_fully_flushed');
  const startSequence=run.metadata.startRecorderSequence,endSequence=run.metadata.checkpointRecorderSequence;
  if(!Number.isSafeInteger(startSequence)||!Number.isSafeInteger(endSequence)||!Number.isSafeInteger(run.metadata.lastRecorderSequence))gaps.push('recorder_boundaries_missing');
  else {
    if(run.metadata.lastRecorderSequence!==endSequence)gaps.push('checkpoint_does_not_cover_terminal_records');
    if(records.length!==(endSequence as number)-(startSequence as number) || (records.length && (records[0].sequence!==(startSequence as number)+1 || records.at(-1)!.sequence!==endSequence)))gaps.push('recorder_prefix_or_terminal_records_missing');
  }
  for (const key of ['droppedRecords','criticalDroppedRecords','writerFailures','evictedRecords']) {
    if(!Number.isSafeInteger(metadataHealth[key]) || (metadataHealth[key] as number)<0)gaps.push('recorder_health_counters_missing_or_invalid');
    else if(metadataHealth[key]!==0)gaps.push(`${key}:${metadataHealth[key]}`);
  }
  if (!records.length) gaps.push('no_structured_records');
  let previous = 0;
  for (const record of records) { if (previous && record.sequence !== previous + 1) gaps.push('recorder_sequence_gap'); previous = record.sequence; }
  const observed = records.filter(r => r.deterministic_event_sequence !== undefined && r.deterministic_event_sequence >= start.nextEventSequence).map(deterministic);
  let runtimeStart:RuntimeCheckpoint|null=null,runtimeEnd:RuntimeCheckpoint|null=null;
  const operations=records.filter(r=>r.runtime_operation).map(r=>validateRuntimeOperation(r.runtime_operation));
  let runtimeResult:ReturnType<typeof replayRuntime>|null=null;
  let replayResult: {stateHash:string;eventHash:string;events:DeterministicEvent[]} | null = null;
  try {
    if(run.runtimeStart!==undefined&&run.runtimeEnd!==undefined){
      runtimeStart=validateRuntimeCheckpoint(run.runtimeStart);runtimeEnd=validateRuntimeCheckpoint(run.runtimeEnd);
      if(runtimeStart.mode!==run.metadata.worldMode||runtimeEnd.mode!==run.metadata.worldMode||canonicalStringify(runtimeStart.simulation)!==canonicalStringify(start)||canonicalStringify(runtimeEnd.simulation)!==canonicalStringify(end))throw new Error('Runtime checkpoint namespace/state mismatch');
      if(canonicalStringify(operations.filter(op=>op.kind==='input').map(op=>op.input))!==canonicalStringify(inputs))throw new Error('Runtime/input evidence mismatch');
      runtimeResult=replayRuntime(runtimeStart,operations,runtimeEnd);replayResult=runtimeResult;
    }else {if(start.schemaVersion!==1)gaps.push('complete_runtime_checkpoint_missing');replayResult = replay(start, inputs, end.tick);}
    if (replayResult.stateHash !== hashCheckpoint(end)) gaps.push('final_state_hash_mismatch');
    if (replayResult.eventHash !== end.eventHash) gaps.push('final_event_hash_mismatch');
    if (canonicalStringify(observed) !== canonicalStringify(replayResult.events)) gaps.push('deterministic_event_records_missing_or_changed');
  } catch { gaps.push('ordered_input_replay_failed'); }
  const focus = records.filter(r => r.world_tick >= from && r.world_tick <= to && (options.incident === undefined || r.input_sequence === options.incident)&&(options.category===undefined||r.category===options.category)&&(options.component===undefined||r.component===options.component)&&(options.eventType===undefined||r.event_type===options.eventType)&&(options.severity===undefined||r.severity===options.severity)&&(options.causalId===undefined||r.event_id===options.causalId||r.causal_event_id===options.causalId)&&(options.search===undefined||JSON.stringify(r).toLowerCase().includes(options.search.toLowerCase())));
  if (options.incident !== undefined && !focus.length) throw new Error('Incident input sequence not found');
  const complete = gaps.length === 0;
  const hashes = { startState: hashCheckpoint(start), endState: hashCheckpoint(end), endEvents: end.eventHash,
    inputs: hashCanonical(inputs), deterministicEvents: hashCanonical(observed), recordIntegrity:hashCanonical(records),
    ...(runtimeStart&&runtimeEnd?{runtimeStart:hashRuntimeCheckpoint(runtimeStart),runtimeEnd:hashRuntimeCheckpoint(runtimeEnd),runtimeOperations:hashCanonical(operations)}:{}) };
  const manifest = { schema_version: start.schemaVersion!==1?2:1, evidence_status: complete ? 'COMPLETE' : 'INCOMPLETE', world_id: identity(run.metadata.worldId), run_id: identity(run.metadata.runId),...(run.metadata.branchId?{branch_id:identity(run.metadata.branchId),mode:run.metadata.worldMode}:{}),
    requested_range: { from_tick: from, to_tick: to, incident_input_sequence: options.incident ?? null },
    included_replay_range: { from_tick: start.tick, to_tick: end.tick, note: 'Full retained checkpoint interval and warm-up inputs included to verify the requested incident.' },
    fixed_step: { numerator_seconds: 1, denominator: start.config.hz }, seed: start.seed, prng: start.prng, configuration: start.config,
    snapshot_schema: start.schemaVersion, simulation_rules: start.rulesVersion, software: software(), hashes,
    coverage: { records: records.length, recorder_start_sequence:startSequence, recorder_end_sequence:endSequence,
      ordered_inputs: inputs.length, deterministic_events: observed.length, gaps: [...new Set(gaps)],
      drop_health: { dropped: metadataHealth.droppedRecords ?? 'unknown', critical_dropped: metadataHealth.criticalDroppedRecords ?? 'unknown', writer_failures: metadataHealth.writerFailures ?? 'unknown', evicted: metadataHealth.evictedRecords ?? 'unknown' },
      fox_experience: start.schemaVersion===6?'Visual episodes retain trusted renderer admission. Internal episodes independently require actual internal sensing, attended sensation, declared eligible ancestry and successful first-severe local encoding. Post-genesis body fixtures taint future LIVE internal admission; awareness remains available.':start.schemaVersion===5?'Real experience requires trusted renderer evidence, explicit attention selection, correlated normalized interpretation and encoding. Experiment ancestry remains barred from LIVE; proposed actions are distinct from actual effects.':start.schemaVersion!==1?'Only EXPERIMENT TEST STUB observations that are sensed, attended and encoded may be personal experience. Capturing an image is not experience. Diagnostics cannot promote experience into LIVE.':'No attended-and-encoded experience system exists; no personal memories fabricated.',
      presentation: 'VIEWER_NOTIFICATION records prove transport send/queue attempts only. Browser display, articulated motion and audible output are unavailable to this recorder.',
      selection: 'Structured events include complete replay warm-up; timeline focuses on the requested range/incident.' },
    reproduction: 'npm ci; npm.cmd run replay -- --bundle <path-to-this.zip> (PowerShell)' };
  const assertions = { source: 'Exporter assertions computed from included checkpoint, ordered inputs and records',
    replayExecuted: replayResult !== null, finalStateMatches: replayResult?.stateHash === hashes.endState,
    finalEventHashMatches: replayResult?.eventHash === hashes.endEvents,
    deterministicEventRecordsMatch: replayResult !== null && canonicalStringify(observed) === canonicalStringify(replayResult.events),
    runtimeControlStateMatches:runtimeStart!==null?runtimeResult!==null:null,
    testSuite: 'No external test result is asserted by this export. Run npm test for repository regressions.' };
  const timeline = focus.map(r => `- tick ${r.world_tick} (${r.world_elapsed_seconds.toFixed(3)} s) [${r.event_id}] ${r.category} / ${r.event_type}: ${r.outcome}${r.input_sequence ? `; input ${r.input_sequence}` : ''}${r.causal_event_id ? `; caused by ${r.causal_event_id}` : ''}${Object.keys(r.data).length ? `; ${JSON.stringify(r.data)}` : ''}`).join('\n');
  const summary = `# Incident summary\n\nEvidence: **${manifest.evidence_status}**. World ${manifest.world_id}; ${run.metadata.branchId?`branch ${run.metadata.branchId}; `:''}run ${manifest.run_id}.\n\nRequested ticks ${from}–${to}; included checkpoint/replay ticks ${start.tick}–${end.tick}. ${inputs.length} ordered inputs and ${observed.length} deterministic events.\n\n${focus.filter(r => ['INPUT_VALIDATED','ACOUSTIC_EVENT','REFLEX_DECISION','REFLEX_STATE','VIEWER_NOTIFICATION','SYNTHETIC_GATE','EXPERIENCE_ENCODED','ACTIVITY_COMPLETE','CONTROL_APPLIED','LIVE_RECOVERED','LIVE_INITIALIZED','RECOVERY_COMMITTED','RECOVERY_SAVE_FAILED','RESTORE_PREPARATION_FAILED','RESTORE_RETIRE_FAILED','BRANCH_RESTORED','EXPERIMENT_REOPENED','ACOUSTIC_PROPAGATION','SOUND_RECEIVED','ATTENTION_DECISION','ATTENTION_ACTION','CAPTURE_INTENTION','CAPTURE_POLICY','CAPTURE_FEEDBACK','VISUAL_CHANGE','COGNITION_OBSERVATION','COGNITION_ATTENTION','COGNITION_REQUEST','COGNITION_RESULT','COGNITION_INTERPRETATION','COGNITION_ACTION_PROPOSED','COGNITION_ACTION','COGNITION_VALIDATION','EXPERIENCE_ENCODING'].includes(r.event_type)).map(r => `- [${r.event_id}] ${r.event_type} at tick ${r.world_tick}: ${r.outcome}; ${JSON.stringify(r.data)}`).join('\n')}\n\nCoverage gaps: ${gaps.length ? [...new Set(gaps)].join(', ') : 'none in retained deterministic replay evidence'}. A committed recovery checkpoint establishes a saved recovery point; deterministic replay only covers this run\u0027s included operations. Recovery does not prove complete pre-crash evidence or replay across downtime. Checkpoint age includes any unsaved uptime before a crash. Browser display/audio is not observed by this recorder.\n\n${manifest.coverage.fox_experience}\n`;
  const visionStart=runtimeStart&&runtimeStart.simulation.schemaVersion>=3?runtimeStart.simulation as import('../simulation.js').CheckpointV3|import('../simulation.js').CheckpointV4|import('../simulation.js').CheckpointV5|import('../simulation.js').CheckpointV6:null;
  const savedActivityMidpoint=runtimeStart!==null&&runtimeStart.simulation.activity.cursor>0&&runtimeStart.simulation.activity.cursor<runtimeStart.simulation.activity.totalTicks;
  const restorationDetail=visionStart?'including the saved head/eye pose, scene state and ordered actions; capture metadata and original pixel hashes are recorded without raw pixels':savedActivityMidpoint?'including a saved activity midpoint':'including the saved simulation and runtime controls';
  const labExpected=runtimeStart?[
    `The starting runtime is ${runtimeStart.mode}, ${runtimeStart.control.paused?'paused':'running'} at ${runtimeStart.control.speed}x, tick ${runtimeStart.simulation.tick}. Restore its complete control/scheduler and simulation state before applying the recorded operations.`,
    ...(visionStart?.schemaVersion===6?['Schema 6 preserves the private body, once-only recovery effect cursor and absorption progress, urgent threshold crossing/deadline counters, transient internal sensations, separate internal encoding policy and evidence, and suspended activity. Physiology is an experimental simulation model. Internal sensation episodes require actual internal sensing and attention, and independent successful local encoding; fixture body effects permanently taint future physiological LIVE admission. Offline replay executes no model or renderer.']:[]),
    ...(visionStart?[`The schema ${visionStart.schemaVersion} head/scene snapshot starts with head status ${visionStart.head.status}, yaw ${visionStart.head.yaw}, pitch ${visionStart.head.pitch}, target yaw ${visionStart.head.targetYaw}, target pitch ${visionStart.head.targetPitch}, and scene revision ${visionStart.scene.revision}. Restore these complete fields and the ordered actions below. Capture records in events.jsonl identify their original tick, pose, scene/render revision, backend and pixel hash. This sanitized bundle includes capture metadata and pixel hashes without raw pixels. Offline replay reproduces simulation/actions; it does not launch a renderer or regenerate images.`]:[]),
    ...((visionStart?.schemaVersion===5||visionStart?.schemaVersion===6)?['Schema 5 retains immutable model request context, original capture and attention ticks, ordered normalized provider results, local action outcomes and independently admitted real experiences. Apply cognition_request and cognition_result commands in their original order. Offline replay performs zero provider and renderer calls. Raw images, credentials and prompts are excluded.']:[]),
    ...(visionStart?.schemaVersion===4?['Schema 4 preserves received acoustic evidence, bounded habituation, attention commitments, deferred capture intentions and compact image comparison state. Apply recorded sensor_feedback inputs at their receipt tick and ordering cursor; their capturedTick remains the original image tick. Offline replay injects these normalized results and host admission outcomes. It never launches Chromium, waits for host time or regenerates images. Source truth, received hearing, reflex, attention and image receipt each retain their own causal event/tick; no semantic interpretation or real FOX_EXPERIENCE is asserted.']:[]),
    `Activity starts at cursor ${runtimeStart.simulation.activity.cursor}/${runtimeStart.simulation.activity.totalTicks}, status ${runtimeStart.simulation.activity.status}, completion count ${runtimeStart.simulation.activity.completionCount}. ${savedActivityMidpoint?'This case includes a saved activity midpoint; saved progress resumes from that cursor.':'No saved activity midpoint is asserted for this case.'} Completed effects must not repeat and completion must apply at most once.`,
    'A TEST STUB cue that is not sensed, not attended or not encoded remains PRIVATE_SENSOR evidence and must not enter FOX_EXPERIENCE. Only sensed AND attended AND encoded observations qualify in an EXPERIMENT.',
    'An eligible TEST STUB synthetic-clock operation recalibrates the subjective estimate to its observedSeconds and uncertaintySeconds. It does not establish visual watch reading or exact personal knowledge in LIVE.',
    ...(inputs.length?['The ordered input list below may also contain door slams and rejected commands; replay retains their original tick/sequence and deterministic reflex behavior.']:['This incident has no viewer commands; the case is reproduced through its recorded laboratory controls and whole-step operations.']),
  ].join('\n\n'):'';
  const operationNotes=runtimeStart?operations.map(op=>op.kind==='control'?`- operation ${op.sequence}, tick ${op.tick}: control ${JSON.stringify(op.action)}`:op.kind==='advance'?`- operation ${op.sequence}, tick ${op.tick}: ${op.source} advance ${op.ticks} whole ticks; backlog ${op.backlogMs} ms`:`- operation ${op.sequence}, tick ${op.tick}: input ${op.input.sequence} ${JSON.stringify(op.input.command)}`).join('\n'):'';
  const labObserved=runtimeEnd?`Ending activity: cursor ${runtimeEnd.simulation.activity.cursor}/${runtimeEnd.simulation.activity.totalTicks}, status ${runtimeEnd.simulation.activity.status}, completion count ${runtimeEnd.simulation.activity.completionCount}. Ending synthetic experience count: ${runtimeEnd.simulation.experiences.length}. ${(runtimeEnd.simulation.schemaVersion===5||runtimeEnd.simulation.schemaVersion===6)?`Ending real experience count: ${runtimeEnd.simulation.realExperiences.length}. `:''}Ending subjective estimate: ${runtimeEnd.simulation.subjective.estimateSeconds} s with uncertainty ${runtimeEnd.simulation.subjective.uncertaintySeconds} s. These values are included in the verified runtime checkpoint.`:'';
  const reproduction = `# Reproduction\n\nExpected: ${runtimeStart?labExpected:'Normalized slam inputs outside cooldown emit a door action, source acoustic intensity/suddenness 1, threshold-qualified reflex and authoritative ear state. Invalid commands are rejected and still retain their ordered input sequence.'}\n\nObserved: see SUMMARY.md and TIMELINE.md linked to events.jsonl. ${assertions.finalStateMatches && assertions.finalEventHashMatches ? 'Included replay reproduced final canonical state and event hashes.' : 'Replay did not establish the recorded result; evidence is INCOMPLETE.'} ${labObserved}\n\n1. Use this repository with Node 22+. Run npm ci.\n2. In PowerShell run: npm.cmd run replay -- --bundle <path-to-this.zip>\n3. ${runtimeStart?'Schema2 loads runtime-start.json and operations.jsonl, reproduces the ordered operations listed below, and verifies runtime-end.json including control/scheduler state.':'Schema1 loads checkpoint-start.json, admits inputs.jsonl at receivedTick and steps to the ending tick.'} Both paths compare complete simulation, event, input and structured-record integrity hashes. They fail on incomplete/missing/reordered evidence or different deterministic results.\n\n${runtimeStart?`## Recorded operations\n\n${operationNotes}\n\nFor interactive inspection, run npm run dev, open http://127.0.0.1:5173/?view=dashboard and select world ${manifest.world_id}, branch ${run.metadata.branchId}, run ${manifest.run_id}. The ZIP replay command is the exact restoration/reproduction path, ${restorationDetail}; selecting a different starting checkpoint is a different case.`:'To repeat interactively: npm run dev; open http://127.0.0.1:5173 and press Slam the door. Exact replay uses recorded ticks, not human click timing.'}\n`;
  const files: Record<string, Uint8Array> = {
    'README.md': strToU8('# Autonomous Lumi diagnostic incident\n\nStart with SUMMARY.md, then TIMELINE.md. manifest.json declares evidence coverage, config, seed, hashes and software metadata. REPRODUCTION.md gives exact replay steps. Generated diagnostics are private local developer evidence, never character knowledge.\n'),
    'manifest.json': strToU8(JSON.stringify(manifest,null,2)), 'SUMMARY.md': strToU8(summary), 'TIMELINE.md': strToU8('# Causal timeline\n\n' + timeline + '\n'),
    'REPRODUCTION.md': strToU8(reproduction), 'events.jsonl': strToU8(records.map(r => JSON.stringify(r)).join('\n')+'\n'),
    'inputs.jsonl': strToU8(inputs.map(i => JSON.stringify(i)).join('\n')+'\n'), 'checkpoint-start.json': strToU8(JSON.stringify(start,null,2)),
    'checkpoint-end.json': strToU8(JSON.stringify(end,null,2)), 'assertions.json': strToU8(JSON.stringify(assertions,null,2)),
  };
  if(runtimeStart&&runtimeEnd){files['runtime-start.json']=strToU8(JSON.stringify(runtimeStart,null,2));files['runtime-end.json']=strToU8(JSON.stringify(runtimeEnd,null,2));files['operations.jsonl']=strToU8(operations.map(op=>JSON.stringify(op)).join('\n')+'\n');}
  if (Object.values(files).reduce((n, bytes) => n+bytes.length,0) > MAX_BYTES) throw new Error('Export exceeds bounded ZIP size');
  await writeFile(options.out, zipSync(files, { level: 6 }));
  return { manifest, assertions, files: Object.keys(files), out: options.out };
}

export async function inspectBundle(path: string) {
  if ((await stat(path)).size > MAX_BYTES) throw new Error('ZIP exceeds compressed size limit');
  let total = 0, count = 0;
  const files = unzipSync(await readFile(path), { filter(entry) {
    if (![...ENTRIES,...RUNTIME_ENTRIES].includes(entry.name) || ++count > ENTRIES.length+RUNTIME_ENTRIES.length || entry.originalSize > MAX_BYTES || (total += entry.originalSize) > MAX_BYTES) throw new Error('Unsafe or oversized diagnostic ZIP');
    return true;
  } });
  const keys=Object.keys(files);if(ENTRIES.some(name=>!keys.includes(name))||(RUNTIME_ENTRIES.some(name=>keys.includes(name))&&!RUNTIME_ENTRIES.every(name=>keys.includes(name)))) throw new Error('Incomplete diagnostic ZIP entries');
  return files;
}
export async function replayBundle(path: string) {
  const files = await inspectBundle(path), parse = (name: string) => JSON.parse(strFromU8(files[name]));
  const manifest = parse('manifest.json');
  if (![1,2].includes(manifest.schema_version) || manifest.evidence_status !== 'COMPLETE') throw new Error('Diagnostic evidence is INCOMPLETE or incompatible');
  if(!manifest.coverage || !Array.isArray(manifest.coverage.gaps) || manifest.coverage.gaps.length || !manifest.coverage.drop_health || Object.values(manifest.coverage.drop_health).some(value=>value!==0))throw new Error('Diagnostic coverage is INCOMPLETE');
  const start = validateCheckpoint(parse('checkpoint-start.json')), end = validateCheckpoint(parse('checkpoint-end.json'));
  const inputs = strFromU8(files['inputs.jsonl']).split('\n').filter(Boolean).map(line => JSON.parse(line) as OrderedInput);
  const records = strFromU8(files['events.jsonl']).split('\n').filter(Boolean).map(line => cleanRecord(JSON.parse(line) as DiagnosticRecord));
  const coverage=manifest.coverage;
  if(!Number.isSafeInteger(coverage.recorder_start_sequence)||!Number.isSafeInteger(coverage.recorder_end_sequence)||coverage.records!==records.length||coverage.recorder_end_sequence-coverage.recorder_start_sequence!==records.length||records.some((record,index)=>record.sequence!==coverage.recorder_start_sequence+index+1)||hashCanonical(records)!==manifest.hashes.recordIntegrity)throw new Error('Diagnostic record integrity or coverage mismatch');
  const events = records.filter(r => r.deterministic_event_sequence !== undefined && r.deterministic_event_sequence >= start.nextEventSequence).map(deterministic);
  let result:{stateHash:string;eventHash:string;events:DeterministicEvent[];runtimeHash?:string};
  if(manifest.schema_version===2){
    if(!RUNTIME_ENTRIES.every(name=>files[name]))throw new Error('Complete runtime replay evidence missing');
    const runtimeStart=validateRuntimeCheckpoint(parse('runtime-start.json')),runtimeEnd=validateRuntimeCheckpoint(parse('runtime-end.json'));
    if(runtimeStart.mode!==manifest.mode||runtimeEnd.mode!==manifest.mode||canonicalStringify(runtimeStart.simulation)!==canonicalStringify(start)||canonicalStringify(runtimeEnd.simulation)!==canonicalStringify(end))throw new Error('Runtime/simulation evidence mismatch');
    const operations=strFromU8(files['operations.jsonl']).split('\n').filter(Boolean).map(line=>validateRuntimeOperation(JSON.parse(line)));
    if(hashRuntimeCheckpoint(runtimeStart)!==manifest.hashes.runtimeStart||hashRuntimeCheckpoint(runtimeEnd)!==manifest.hashes.runtimeEnd||hashCanonical(operations)!==manifest.hashes.runtimeOperations||canonicalStringify(operations.filter(op=>op.kind==='input').map(op=>op.input))!==canonicalStringify(inputs)||canonicalStringify(records.filter(r=>r.runtime_operation).map(r=>r.runtime_operation))!==canonicalStringify(operations))throw new Error('Runtime operation integrity mismatch');
    result=replayRuntime(runtimeStart,operations,runtimeEnd);
  }else result = replay(start, inputs, end.tick);
  if (hashCheckpoint(start) !== manifest.hashes.startState || hashCheckpoint(end) !== manifest.hashes.endState || result.stateHash !== manifest.hashes.endState || result.eventHash !== manifest.hashes.endEvents || end.eventHash !== manifest.hashes.endEvents || hashCanonical(inputs) !== manifest.hashes.inputs || hashCanonical(events) !== manifest.hashes.deterministicEvents || canonicalStringify(events) !== canonicalStringify(result.events)) throw new Error('Diagnostic replay hash or event mismatch');
  return { status: 'PASS', tick: end.tick, stateHash: result.stateHash, eventHash: result.eventHash, inputCount: inputs.length, eventCount: events.length,...(result.runtimeHash?{runtimeHash:result.runtimeHash}:{}) };
}
