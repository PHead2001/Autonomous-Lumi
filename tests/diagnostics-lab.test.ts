import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {gzipSync} from 'node:zlib';
import {strFromU8} from 'fflate';
import {Simulation,hashCheckpoint} from '../server/simulation.js';
import {FlightRecorder,readRun,boundedGunzip,type LoggingMode} from '../server/diagnostics/recorder.js';
import {queryTimeline} from '../server/diagnostics/query.js';
import {exportIncident,replayBundle,inspectBundle} from '../server/diagnostics/bundle.js';
import {BranchRuntime} from '../server/branch-runtime.js';

async function temporary(t:{after(fn:()=>Promise<void>):void}){const directory=await mkdtemp(join(tmpdir(),'lumi-lab-diag-'));t.after(async()=>{if(!resolve(directory).startsWith(resolve(tmpdir())+sep))throw new Error('Unsafe temp cleanup');await rm(directory,{recursive:true,force:true});});return directory;}
function fixture(sim:Simulation,recorder:FlightRecorder){recorder.captureCheckpoint(sim.checkpoint());const received=sim.enqueue({type:'slam'});recorder.recordInput(received.input);received.events.forEach(e=>recorder.recordEvent(e));for(let i=0;i<5;i++){sim.step().forEach(e=>recorder.recordEvent(e));recorder.recordVerboseTick(sim.state.tick,{count:i});}recorder.captureCheckpoint(sim.checkpoint());}

test('branch retention and timeline selection stay within exact world/branch/run before filtering',async t=>{
  const directory=await temporary(t),live=new FlightRecorder({directory,worldId:'w',branchId:'live',worldMode:'LIVE',runId:'live-run'}),other=new FlightRecorder({directory,worldId:'w',branchId:'other',worldMode:'EXPERIMENT',runId:'other-run'});
  fixture(new Simulation(),live);fixture(new Simulation(),other);await live.close();await other.close();
  const liveBefore=await readFile(join(live.runDirectory,'run.json'),'utf8'),otherBefore=await readFile(join(other.runDirectory,'run.json'),'utf8');
  let last:FlightRecorder|undefined;
  for(let i=0;i<4;i++){last=new FlightRecorder({directory,worldId:'w',branchId:'exp',worldMode:'EXPERIMENT',runId:`run-${i}`,limits:{retainedRuns:1}});fixture(new Simulation(),last);await last.close();}
  assert.equal(await readFile(join(live.runDirectory,'run.json'),'utf8'),liveBefore);assert.equal(await readFile(join(other.runDirectory,'run.json'),'utf8'),otherBefore);assert.equal((await readdir(join(directory,'w','exp','runs'))).length,1);
  const scope={runDirectory:last!.runDirectory,worldId:'w',branchId:'exp',runId:'run-3'};
  const timeline=await queryTimeline({...scope,category:'PRIVATE_SENSOR',search:'REFLEX_DECISION'});assert.equal(timeline.records.length,1);assert.equal(timeline.records[0].branch_id,'exp');
  await assert.rejects(queryTimeline({...scope,branchId:'live',category:'bad' as never}),/namespace/);
  await assert.rejects(exportIncident({runDirectory:last!.runDirectory,out:join(directory,'wrong.zip'),expectedWorldId:'w',expectedBranchId:'live',expectedRunId:'run-3'}),/namespace/);
});

test('OFF/default/verbose preserve simulation hashes while disabled evidence cannot claim complete replay',async t=>{
  const directory=await temporary(t);const hashes=[];
  for(const loggingMode of ['off','default','verbose'] as LoggingMode[]){
    const sim=new Simulation({seed:99}),recorder=new FlightRecorder({directory,worldId:'w',branchId:loggingMode,worldMode:'EXPERIMENT',runId:'r',loggingMode});fixture(sim,recorder);await recorder.close();hashes.push(hashCheckpoint(sim.checkpoint()));
    const run=await readRun(recorder.runDirectory);const result=await exportIncident({runDirectory:recorder.runDirectory,out:join(directory,`${loggingMode}.zip`)});
    if(loggingMode==='off'){assert.equal(run.records.length,0);assert.equal(recorder.health().status,'INCOMPLETE');assert.ok(recorder.health().disabledRecords>0);assert.equal(result.manifest.evidence_status,'INCOMPLETE');await assert.rejects(replayBundle(join(directory,`${loggingMode}.zip`)),/INCOMPLETE/);}
    else {assert.equal(result.manifest.evidence_status,'COMPLETE');assert.equal(run.records.some(r=>r.event_type==='TICK_TRACE'),loggingMode==='verbose');}
  }
  assert.equal(new Set(hashes).size,1);
});

test('writing a diagnostic with FOX_EXPERIENCE category cannot fabricate personal experience',async t=>{
  const directory=await temporary(t),recorder=new FlightRecorder({directory,worldId:'w',branchId:'exp',worldMode:'EXPERIMENT',runId:'r'});recorder.captureCheckpoint(new Simulation().checkpoint());
  recorder.record({tick:0,category:'FOX_EXPERIENCE',eventType:'EXPERIENCE_ENCODED',component:'untrusted-record',outcome:'claimed',data:{provenance:'TEST STUB',attended:true,encoded:true}});await recorder.close();
  const records=(await readRun(recorder.runDirectory)).records;assert.equal(records[0].category,'PRIVATE_SENSOR');assert.ok(!records.some(r=>r.category==='FOX_EXPERIENCE'));
});

test('experience-like deterministic event without sensed eligibility cannot be labelled FOX_EXPERIENCE',async t=>{
  const directory=await temporary(t),recorder=new FlightRecorder({directory,worldId:'w',branchId:'exp',worldMode:'EXPERIMENT',runId:'r'});recorder.captureCheckpoint(new Simulation().checkpoint());
  recorder.recordEvent({sequence:1,tick:0,type:'EXPERIENCE_ENCODED',component:'test',outcome:'claimed',data:{provenance:'TEST STUB',sensed:false,attended:true,encoded:true}});await recorder.close();
  const records=(await readRun(recorder.runDirectory)).records;assert.ok(!records.some(record=>record.category==='FOX_EXPERIENCE'));assert.equal(records[0].category,'PRIVATE_SENSOR');
});

test('optional closed-log gzip remains replayable, bounded and branch-local',async t=>{
  const directory=await temporary(t),sim=new Simulation(),recorder=new FlightRecorder({directory,worldId:'w',branchId:'compressed',worldMode:'EXPERIMENT',runId:'r',compressClosed:true});fixture(sim,recorder);await recorder.close();
  const files=await readdir(recorder.runDirectory);assert.ok(files.some(name=>name.endsWith('.jsonl.gz')));assert.ok(!files.some(name=>name.endsWith('.jsonl')));
  const run=await readRun(recorder.runDirectory);assert.ok(run.records.length>0);const path=join(directory,'compressed.zip');assert.equal((await exportIncident({runDirectory:recorder.runDirectory,out:path})).manifest.evidence_status,'COMPLETE');assert.equal((await replayBundle(path)).status,'PASS');
  assert.throws(()=>boundedGunzip(gzipSync('x'.repeat(100000)),100),/decompression bound/);assert.ok((await stat(path)).size>0);
});

test('runtime export restores controls, activity, eligible synthetic experience and complete operation order',async t=>{
  const directory=await temporary(t),runtime=new BranchRuntime({directory,worldId:'world',branchId:'experiment',mode:'EXPERIMENT',seed:123});
  runtime.applyControl({type:'pause'});runtime.enqueue({type:'slam'});runtime.applyControl({type:'step'});
  runtime.applyControl({type:'activity-start',totalTicks:12});
  runtime.applyControl({type:'synthetic-cue',sensed:true,attended:false,encoded:true});
  runtime.applyControl({type:'synthetic-cue',sensed:true,attended:true,encoded:true});
  runtime.applyControl({type:'synthetic-clock',sensed:true,attended:true,encoded:true,observedSeconds:30,uncertaintySeconds:2});
  for(let i=0;i<15;i++)runtime.applyControl({type:'step'});
  const expected=runtime.checkpoint();await runtime.close();
  const out=join(directory,'runtime.zip'),result=await exportIncident({runDirectory:runtime.recorder!.runDirectory,out,expectedWorldId:runtime.target.worldId,expectedBranchId:runtime.target.branchId,expectedRunId:runtime.target.runId});
  assert.equal(result.manifest.schema_version,2);assert.equal(result.manifest.evidence_status,'COMPLETE');assert.equal(result.assertions.runtimeControlStateMatches,true);
  const replayed=await replayBundle(out);assert.equal(replayed.stateHash,hashCheckpoint(expected.simulation));assert.equal(typeof replayed.runtimeHash,'string');
  const reproduction=strFromU8((await inspectBundle(out))['REPRODUCTION.md']);
  assert.ok(reproduction.includes(JSON.stringify({type:'synthetic-cue',sensed:true,attended:false,encoded:true})));assert.ok(reproduction.includes(JSON.stringify({type:'synthetic-clock',sensed:true,attended:true,encoded:true,observedSeconds:30,uncertaintySeconds:2})));
  assert.match(reproduction,/remains PRIVATE_SENSOR evidence and must not enter FOX_EXPERIENCE/);assert.match(reproduction,/completion count 1/);assert.match(reproduction,/at most once/);
  const timeline=await queryTimeline({runDirectory:runtime.recorder!.runDirectory,...runtime.target,category:'FOX_EXPERIENCE'});assert.equal(timeline.records.length,2);assert.ok(timeline.records.every(r=>r.data.provenance==='TEST STUB'&&r.data.attended&&r.data.encoded));
});
