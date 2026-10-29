import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendFile,mkdtemp,readdir,rm,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {BranchRuntime,type RuntimeOperation} from '../server/branch-runtime.js';
import {FlightRecorder} from '../server/diagnostics/recorder.js';
import {exportIncident,replayBundle} from '../server/diagnostics/bundle.js';
import {hashCheckpoint} from '../server/simulation.js';

async function temporary(t:{after(fn:()=>Promise<void>):void}){const path=await mkdtemp(join(tmpdir(),'lumi-export-barrier-'));t.after(async()=>{if(!resolve(path).startsWith(resolve(tmpdir())+sep))throw new Error('Unsafe cleanup');await rm(path,{recursive:true,force:true});});return path;}
function advance(runtime:BranchRuntime,recorder:FlightRecorder,ticks:number){
  const cp=runtime.checkpoint(),operation:RuntimeOperation={sequence:cp.control.nextOperationSequence,tick:cp.simulation.tick,kind:'advance',ticks,backlogMs:0,source:'scheduled'};
  runtime.replayOperation(operation);recorder.recordRuntimeOperation(operation);runtime.drainEvents().forEach(event=>recorder.recordEvent(event));
}

test('active LIVE export drains a terminal prefix behind an in-flight writer while later world work continues',async t=>{
  const directory=await temporary(t),runtime=new BranchRuntime({worldId:'world',branchId:'live',mode:'LIVE',offline:true});
  let release!:()=>void,started!:()=>void;const blocked=new Promise<void>(resolveBlock=>{release=resolveBlock;}),entered=new Promise<void>(resolveEntered=>{started=resolveEntered;});let calls=0;
  const recorder=new FlightRecorder({directory,worldId:'world',branchId:'live',worldMode:'LIVE',runId:'run',limits:{queueRecords:8,reserveCriticalRecords:2,flushIntervalMs:60000},append:async(path,data)=>{if(++calls===1){started();await blocked;}await appendFile(path,data,'utf8');}});
  recorder.captureRuntimeCheckpoint(runtime.checkpoint());advance(runtime,recorder,30);
  const oldBatch=recorder.flush();await entered;
  advance(runtime,recorder,15);const expected=runtime.checkpoint();recorder.captureRuntimeCheckpoint(expected);
  const captured=recorder.snapshotForExport();
  advance(runtime,recorder,15);recorder.captureRuntimeCheckpoint(runtime.checkpoint());
  for(let i=0;i<20;i++)recorder.record({tick:60,category:'OPERATIONAL_REPLAY',eventType:'AFTER_EXPORT_BOUNDARY',component:'test',outcome:'continued'});
  assert.equal(runtime.simulation.state.tick,60);assert.ok(recorder.health().droppedRecords>0);
  release();await oldBatch;const snapshot=await captured;
  assert.equal(snapshot.records.at(-1)!.sequence,snapshot.metadata.checkpointRecorderSequence);
  assert.ok(!snapshot.records.some(record=>record.event_type==='AFTER_EXPORT_BOUNDARY'));
  assert.equal((snapshot.metadata.health as {status:string}).status,'HEALTHY');
  const out=join(directory,'live-prefix.zip'),result=await exportIncident({runDirectory:recorder.runDirectory,snapshot,out});
  assert.equal(result.manifest.evidence_status,'COMPLETE');assert.equal(result.manifest.included_replay_range.to_tick,45);
  assert.equal((await replayBundle(out)).stateHash,hashCheckpoint(expected.simulation));assert.equal(runtime.simulation.state.tick,60);
  await recorder.close();await runtime.close();
});

test('a pinned prefix still reports incomplete evidence when its blocked writer fails',async t=>{
  const directory=await temporary(t),runtime=new BranchRuntime({worldId:'world',branchId:'live',mode:'LIVE',offline:true});
  let release!:()=>void,started!:()=>void;const blocked=new Promise<void>(resolveBlock=>{release=resolveBlock;}),entered=new Promise<void>(resolveEntered=>{started=resolveEntered;});let calls=0;
  const recorder=new FlightRecorder({directory,worldId:'world',branchId:'live',worldMode:'LIVE',runId:'failure',limits:{flushIntervalMs:60000},append:async(path,data)=>{if(++calls===1){started();await blocked;throw new Error('injected writer failure');}await appendFile(path,data,'utf8');}});
  recorder.captureRuntimeCheckpoint(runtime.checkpoint());advance(runtime,recorder,1);const oldBatch=recorder.flush();await entered;
  advance(runtime,recorder,1);recorder.captureRuntimeCheckpoint(runtime.checkpoint());const captured=recorder.snapshotForExport();release();await oldBatch;const snapshot=await captured;
  assert.equal((snapshot.metadata.health as {status:string}).status,'INCOMPLETE');
  const out=join(directory,'incomplete.zip'),result=await exportIncident({runDirectory:recorder.runDirectory,snapshot,out});assert.equal(result.manifest.evidence_status,'INCOMPLETE');await assert.rejects(replayBundle(out),/INCOMPLETE/);
  await recorder.close();await runtime.close();
});

test('recorder preparation and timer writes cannot traverse a linked branch storage component',async t=>{
  const directory=await temporary(t),root=join(directory,'owned'),outside=join(directory,'outside');await mkdir(root);await mkdir(outside);await symlink(outside,join(root,'world'),'junction');
  const recorder=new FlightRecorder({directory:root,worldId:'world',branchId:'live',worldMode:'LIVE',runId:'run',limits:{flushIntervalMs:60000}});
  recorder.record({tick:0,category:'OPERATIONAL_REPLAY',eventType:'TEST',component:'test',outcome:'observed'});
  await assert.rejects(recorder.prepare(),/Linked storage|initialization failed/);await recorder.flush();await recorder.close();assert.deepEqual(await readdir(outside),[]);
});
