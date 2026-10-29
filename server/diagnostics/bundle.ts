import { readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { canonicalStringify, hashCanonical } from '../canonical.js';
import { replay } from '../replay.js';
import { hashCheckpoint, validateCheckpoint, type DeterministicEvent, type OrderedInput } from '../simulation.js';
import { readRun, sanitizeData, type DiagnosticRecord } from './recorder.js';

const MAX_BYTES = 8 * 1024 * 1024;
const ENTRIES = ['README.md','manifest.json','SUMMARY.md','TIMELINE.md','REPRODUCTION.md','events.jsonl','inputs.jsonl','checkpoint-start.json','checkpoint-end.json','assertions.json'];
const identity = (value: unknown): string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : 'unknown';
function cleanRecord(raw: DiagnosticRecord): DiagnosticRecord {
  const safe = (value: unknown) => typeof value === 'string' ? value.replace(/[^A-Za-z0-9_. :/-]/g, '_').slice(0,160) : 'unknown';
  if (!Number.isSafeInteger(raw.sequence) || !Number.isSafeInteger(raw.world_tick) || !['WORLD_TRUTH','FOX_EXPERIENCE','PRIVATE_SENSOR','OPERATIONAL_REPLAY'].includes(raw.category)) throw new Error('Invalid structured record');
  const result: DiagnosticRecord = { schema_version: 1, utc: new Date(raw.utc).toISOString(), world_tick: raw.world_tick,
    world_elapsed_seconds: raw.world_elapsed_seconds, mode: 'LOCAL_DEV', world_id: identity(raw.world_id), run_id: identity(raw.run_id),
    sequence: raw.sequence, event_id: `record:${raw.sequence}`, event_type: safe(raw.event_type), category: raw.category,
    severity: ['debug','info','warn','error'].includes(raw.severity) ? raw.severity : 'info', component: safe(raw.component), state_version: raw.world_tick,
    outcome: safe(raw.outcome), data: sanitizeData(raw.data) };
  if (Number.isSafeInteger(raw.deterministic_event_sequence)) result.deterministic_event_sequence = raw.deterministic_event_sequence;
  if (Number.isSafeInteger(raw.input_sequence)) result.input_sequence = raw.input_sequence;
  if (typeof raw.causal_event_id === 'string' && /^simulation:\d+$/.test(raw.causal_event_id)) result.causal_event_id = raw.causal_event_id;
  // Ordered input payloads are rebuilt from the normalized command enum; raw visitor payloads never enter the archive.
  if (raw.ordered_input) {
    const i = raw.ordered_input;
    if (!['slam','invalid'].includes(i.command.type) || (i.command.type === 'invalid' && !['malformed_json','invalid_shape','unknown_command'].includes(i.command.reason))) throw new Error('Invalid ordered input command');
    result.ordered_input = { sequence: i.sequence, receivedTick: i.receivedTick, applyTick: i.applyTick, admission: i.admission,
      command: i.command.type === 'slam' ? { type: 'slam' } : { type: 'invalid', reason: i.command.reason } };
  }
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
export interface ExportOptions { runDirectory: string; out: string; fromTick?: number; toTick?: number; incident?: number }
export async function exportIncident(options: ExportOptions) {
  const run = await readRun(options.runDirectory), start = validateCheckpoint(run.start), end = validateCheckpoint(run.end);
  const from = options.fromTick ?? start.tick, to = options.toTick ?? end.tick;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < start.tick || to < from || to > end.tick) throw new Error('Requested range is outside retained checkpoint coverage');
  const records = run.records.map(cleanRecord).filter(record => record.world_tick >= start.tick && record.world_tick <= end.tick);
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
  let replayResult: ReturnType<typeof replay> | null = null;
  try {
    replayResult = replay(start, inputs, end.tick);
    if (replayResult.stateHash !== hashCheckpoint(end)) gaps.push('final_state_hash_mismatch');
    if (replayResult.eventHash !== end.eventHash) gaps.push('final_event_hash_mismatch');
    if (canonicalStringify(observed) !== canonicalStringify(replayResult.events)) gaps.push('deterministic_event_records_missing_or_changed');
  } catch { gaps.push('ordered_input_replay_failed'); }
  const focus = records.filter(r => r.world_tick >= from && r.world_tick <= to && (options.incident === undefined || r.input_sequence === options.incident));
  if (options.incident !== undefined && !focus.length) throw new Error('Incident input sequence not found');
  const complete = gaps.length === 0;
  const hashes = { startState: hashCheckpoint(start), endState: hashCheckpoint(end), endEvents: end.eventHash,
    inputs: hashCanonical(inputs), deterministicEvents: hashCanonical(observed), recordIntegrity:hashCanonical(records) };
  const manifest = { schema_version: 1, evidence_status: complete ? 'COMPLETE' : 'INCOMPLETE', world_id: identity(run.metadata.worldId), run_id: identity(run.metadata.runId),
    requested_range: { from_tick: from, to_tick: to, incident_input_sequence: options.incident ?? null },
    included_replay_range: { from_tick: start.tick, to_tick: end.tick, note: 'Full retained checkpoint interval and warm-up inputs included to verify the requested incident.' },
    fixed_step: { numerator_seconds: 1, denominator: start.config.hz }, seed: start.seed, prng: start.prng, configuration: start.config,
    snapshot_schema: start.schemaVersion, simulation_rules: start.rulesVersion, software: software(), hashes,
    coverage: { records: records.length, recorder_start_sequence:startSequence, recorder_end_sequence:endSequence,
      ordered_inputs: inputs.length, deterministic_events: observed.length, gaps: [...new Set(gaps)],
      drop_health: { dropped: metadataHealth.droppedRecords ?? 'unknown', critical_dropped: metadataHealth.criticalDroppedRecords ?? 'unknown', writer_failures: metadataHealth.writerFailures ?? 'unknown', evicted: metadataHealth.evictedRecords ?? 'unknown' },
      fox_experience: 'No attended-and-encoded experience system exists; no personal memories fabricated.',
      presentation: 'VIEWER_NOTIFICATION records prove transport send/queue attempts only. Browser display, articulated motion and audible output are unavailable to this recorder.',
      selection: 'Structured events include complete replay warm-up; timeline focuses on the requested range/incident.' },
    reproduction: 'npm ci; npm.cmd run replay -- --bundle <path-to-this.zip> (PowerShell)' };
  const assertions = { source: 'Exporter assertions computed from included checkpoint, ordered inputs and records',
    replayExecuted: replayResult !== null, finalStateMatches: replayResult?.stateHash === hashes.endState,
    finalEventHashMatches: replayResult?.eventHash === hashes.endEvents,
    deterministicEventRecordsMatch: replayResult !== null && canonicalStringify(observed) === canonicalStringify(replayResult.events),
    testSuite: 'No external test result is asserted by this export. Run npm test for repository regressions.' };
  const timeline = focus.map(r => `- tick ${r.world_tick} (${r.world_elapsed_seconds.toFixed(3)} s) [${r.event_id}] ${r.category} / ${r.event_type}: ${r.outcome}${r.input_sequence ? `; input ${r.input_sequence}` : ''}${r.causal_event_id ? `; caused by ${r.causal_event_id}` : ''}${Object.keys(r.data).length ? `; ${JSON.stringify(r.data)}` : ''}`).join('\n');
  const summary = `# Incident summary\n\nEvidence: **${manifest.evidence_status}**. World ${manifest.world_id}; run ${manifest.run_id}.\n\nRequested ticks ${from}–${to}; included checkpoint/replay ticks ${start.tick}–${end.tick}. ${inputs.length} ordered inputs and ${observed.length} deterministic events.\n\n${focus.filter(r => ['INPUT_VALIDATED','ACOUSTIC_EVENT','REFLEX_DECISION','REFLEX_STATE','VIEWER_NOTIFICATION'].includes(r.event_type)).map(r => `- [${r.event_id}] ${r.event_type} at tick ${r.world_tick}: ${r.outcome}; ${JSON.stringify(r.data)}`).join('\n')}\n\nCoverage gaps: ${gaps.length ? [...new Set(gaps)].join(', ') : 'none in retained deterministic replay evidence'}. Browser display/audio is not observed by this recorder.\n\nFOX_EXPERIENCE is empty because cognition, attention and personal memory are not implemented.\n`;
  const reproduction = `# Reproduction\n\nExpected: normalized slam inputs outside cooldown emit a door action, source acoustic intensity/suddenness 1, threshold-qualified reflex and authoritative ear state. Invalid commands are rejected and still retain their ordered input sequence.\n\nObserved: see SUMMARY.md and TIMELINE.md linked to events.jsonl. ${assertions.finalStateMatches && assertions.finalEventHashMatches ? 'Included replay reproduced final canonical state and event hashes.' : 'Replay did not establish the recorded result; evidence is INCOMPLETE.'}\n\n1. Use this repository with Node 22+. Run npm ci.\n2. In PowerShell run: npm.cmd run replay -- --bundle <path-to-this.zip>\n3. The command loads checkpoint-start.json, admits inputs.jsonl at receivedTick in sequence order, steps to tick ${end.tick}, and compares checkpoint-end.json plus manifest state/event/input hashes. It fails if evidence is incomplete, inputs are missing/reordered or deterministic results differ.\n\nTo repeat interactively: npm run dev; open http://127.0.0.1:5173 and press Slam the door. Exact replay uses the recorded ticks, not human click timing.\n`;
  const files: Record<string, Uint8Array> = {
    'README.md': strToU8('# Autonomous Lumi diagnostic incident\n\nStart with SUMMARY.md, then TIMELINE.md. manifest.json declares evidence coverage, config, seed, hashes and software metadata. REPRODUCTION.md gives exact replay steps. Generated diagnostics are private local developer evidence, never character knowledge.\n'),
    'manifest.json': strToU8(JSON.stringify(manifest,null,2)), 'SUMMARY.md': strToU8(summary), 'TIMELINE.md': strToU8('# Causal timeline\n\n' + timeline + '\n'),
    'REPRODUCTION.md': strToU8(reproduction), 'events.jsonl': strToU8(records.map(r => JSON.stringify(r)).join('\n')+'\n'),
    'inputs.jsonl': strToU8(inputs.map(i => JSON.stringify(i)).join('\n')+'\n'), 'checkpoint-start.json': strToU8(JSON.stringify(start,null,2)),
    'checkpoint-end.json': strToU8(JSON.stringify(end,null,2)), 'assertions.json': strToU8(JSON.stringify(assertions,null,2)),
  };
  if (Object.values(files).reduce((n, bytes) => n+bytes.length,0) > MAX_BYTES) throw new Error('Export exceeds bounded ZIP size');
  await writeFile(options.out, zipSync(files, { level: 6 }));
  return { manifest, assertions, files: Object.keys(files), out: options.out };
}

export async function inspectBundle(path: string) {
  if ((await stat(path)).size > MAX_BYTES) throw new Error('ZIP exceeds compressed size limit');
  let total = 0, count = 0;
  const files = unzipSync(await readFile(path), { filter(entry) {
    if (!ENTRIES.includes(entry.name) || ++count > ENTRIES.length || entry.originalSize > MAX_BYTES || (total += entry.originalSize) > MAX_BYTES) throw new Error('Unsafe or oversized diagnostic ZIP');
    return true;
  } });
  if (Object.keys(files).sort().join('|') !== [...ENTRIES].sort().join('|')) throw new Error('Incomplete diagnostic ZIP entries');
  return files;
}
export async function replayBundle(path: string) {
  const files = await inspectBundle(path), parse = (name: string) => JSON.parse(strFromU8(files[name]));
  const manifest = parse('manifest.json');
  if (manifest.schema_version !== 1 || manifest.evidence_status !== 'COMPLETE') throw new Error('Diagnostic evidence is INCOMPLETE or incompatible');
  if(!manifest.coverage || !Array.isArray(manifest.coverage.gaps) || manifest.coverage.gaps.length || !manifest.coverage.drop_health || Object.values(manifest.coverage.drop_health).some(value=>value!==0))throw new Error('Diagnostic coverage is INCOMPLETE');
  const start = validateCheckpoint(parse('checkpoint-start.json')), end = validateCheckpoint(parse('checkpoint-end.json'));
  const inputs = strFromU8(files['inputs.jsonl']).split('\n').filter(Boolean).map(line => JSON.parse(line) as OrderedInput);
  const records = strFromU8(files['events.jsonl']).split('\n').filter(Boolean).map(line => cleanRecord(JSON.parse(line) as DiagnosticRecord));
  const coverage=manifest.coverage;
  if(!Number.isSafeInteger(coverage.recorder_start_sequence)||!Number.isSafeInteger(coverage.recorder_end_sequence)||coverage.records!==records.length||coverage.recorder_end_sequence-coverage.recorder_start_sequence!==records.length||records.some((record,index)=>record.sequence!==coverage.recorder_start_sequence+index+1)||hashCanonical(records)!==manifest.hashes.recordIntegrity)throw new Error('Diagnostic record integrity or coverage mismatch');
  const events = records.filter(r => r.deterministic_event_sequence !== undefined && r.deterministic_event_sequence >= start.nextEventSequence).map(deterministic);
  const result = replay(start, inputs, end.tick);
  if (hashCheckpoint(start) !== manifest.hashes.startState || hashCheckpoint(end) !== manifest.hashes.endState || result.stateHash !== manifest.hashes.endState || result.eventHash !== manifest.hashes.endEvents || end.eventHash !== manifest.hashes.endEvents || hashCanonical(inputs) !== manifest.hashes.inputs || hashCanonical(events) !== manifest.hashes.deterministicEvents || canonicalStringify(events) !== canonicalStringify(result.events)) throw new Error('Diagnostic replay hash or event mismatch');
  return { status: 'PASS', tick: end.tick, stateHash: result.stateHash, eventHash: result.eventHash, inputCount: inputs.length, eventCount: events.length };
}
