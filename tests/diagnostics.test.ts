import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { zipSync, strToU8, strFromU8 } from 'fflate';
import { Simulation, hashCheckpoint,validateCheckpoint } from '../server/simulation.js';
import { FlightRecorder, readRun } from '../server/diagnostics/recorder.js';
import { exportIncident, inspectBundle, replayBundle } from '../server/diagnostics/bundle.js';
import { createWorldServer } from '../server/world-server.js';

async function temp(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(),'lumi-diagnostics-'));
  t.after(async () => { if (!resolve(directory).startsWith(resolve(tmpdir())+sep)) throw new Error('Temporary cleanup escaped test root'); await rm(directory,{recursive:true,force:true}); });
  return directory;
}
function recordSteps(sim: Simulation, recorder: FlightRecorder, count: number) { for(let i=0;i<count;i++) for(const event of sim.step()) recorder.recordEvent(event); }

test('sanitized ZIP contains traceable slam/rejected-input evidence and replays from its own contents', async t => {
  const directory=await temp(t), sim=new Simulation({seed:41}), recorder=new FlightRecorder({directory,worldId:'test-world',runId:'incident'});
  recorder.captureCheckpoint(sim.checkpoint());
  for(const command of [{type:'slam'} as const,{type:'invalid',reason:'unknown_command'} as const]) {
    const received=sim.enqueue(command); recorder.recordInput(received.input); received.events.forEach(e=>recorder.recordEvent(e));
  }
  recordSteps(sim,recorder,5);
  recorder.record({tick:sim.state.tick,category:'OPERATIONAL_REPLAY',eventType:'VIEWER_NOTIFICATION',component:'transport',outcome:'sent',data:{sent:1,token:'SECRET_TOKEN',message:'PRIVATE_TEXT'}},true);
  recorder.captureCheckpoint(sim.checkpoint()); await recorder.close();
  const out=join(directory,'incident.zip'), exported=await exportIncident({runDirectory:recorder.runDirectory,out,fromTick:0,toTick:5});
  assert.equal(exported.manifest.evidence_status,'COMPLETE');
  const files=await inspectBundle(out), contents=Object.values(files).map(value=>strFromU8(value)).join('\n');
  assert.equal(Object.keys(files).length,10); assert.ok(contents.includes('REFLEX_DECISION')); assert.ok(contents.includes('INPUT_VALIDATED'));
  assert.ok(!contents.includes('SECRET_TOKEN')); assert.ok(!contents.includes('PRIVATE_TEXT')); assert.ok(!contents.includes('"category":"FOX_EXPERIENCE"'));
  assert.match(strFromU8(files['TIMELINE.md']),/intensity/); assert.match(strFromU8(files['SUMMARY.md']),/record:/);
  assert.equal((await replayBundle(out)).stateHash,hashCheckpoint(sim.checkpoint()));
});

test('bounded queue reserves critical capacity and reports lost evidence truthfully', async t => {
  const directory=await temp(t), sim=new Simulation(), recorder=new FlightRecorder({directory,worldId:'world',runId:'burst',limits:{queueRecords:8,reserveCriticalRecords:2,queueBytes:12000,recordBytes:1200,flushIntervalMs:60000}});
  recorder.captureCheckpoint(sim.checkpoint());
  for(let i=0;i<100;i++) recorder.record({tick:0,category:'OPERATIONAL_REPLAY',eventType:'TEST_BURST',component:'test',outcome:'observed'});
  const input=sim.enqueue({type:'slam'}); recorder.recordInput(input.input); input.events.forEach(e=>recorder.recordEvent(e)); recordSteps(sim,recorder,1);
  assert.ok(recorder.health().queuedRecords<=8); assert.ok(recorder.health().queuedBytes<=12000); assert.ok(recorder.health().droppedRecords>0);
  recorder.captureCheckpoint(sim.checkpoint()); await recorder.close();
  const out=join(directory,'burst.zip'), result=await exportIncident({runDirectory:recorder.runDirectory,out});
  assert.equal(result.manifest.evidence_status,'INCOMPLETE'); await assert.rejects(replayBundle(out),/INCOMPLETE/);
});

test('size/time rotation and retention keep JSONL within configured caps and mark evicted coverage', async t => {
  const directory=await temp(t); let now=1000;
  const recorder=new FlightRecorder({directory,worldId:'world',runId:'rotation',now:()=>now,limits:{fileBytes:1200,recordBytes:1000,diskBytes:2400,retainedFiles:2,fileAgeMs:10,flushIntervalMs:60000}});
  const sim=new Simulation(); recorder.captureCheckpoint(sim.checkpoint());
  for(let i=0;i<12;i++) {
    recorder.record({tick:0,category:'OPERATIONAL_REPLAY',eventType:'ROTATION',component:'test',outcome:'observed'});
    await recorder.flush(); now+=11;
  }
  await recorder.close();
  const names=(await readdir(recorder.runDirectory)).filter(n=>n.endsWith('.jsonl'));
  assert.ok(names.length<=2); let bytes=0; for(const name of names) bytes+=(await stat(join(recorder.runDirectory,name))).size;
  assert.ok(bytes<=2400); assert.ok(recorder.health().evictedRecords>0); assert.equal(recorder.health().status,'INCOMPLETE');
  const run=await readRun(recorder.runDirectory); assert.ok((run.metadata.health as {evictedRecords:number}).evictedRecords>0);
});

test('injected writer failure and severity filtering cannot change deterministic progression', async t => {
  const directory=await temp(t), baseline=new Simulation({seed:123}), observed=new Simulation({seed:123});
  const recorder=new FlightRecorder({directory,worldId:'world',runId:'failure',minSeverity:'error',append:async()=>{throw new Error('SECRET_WRITER_DETAIL');},limits:{flushIntervalMs:60000}});
  recorder.captureCheckpoint(observed.checkpoint());
  recorder.record({tick:0,category:'OPERATIONAL_REPLAY',eventType:'FILTERED',component:'test',outcome:'observed',severity:'debug'});
  const start=performance.now();
  for(let tick=0;tick<600;tick++) {
    if(tick===0 || tick===120) {baseline.enqueue({type:'slam'}); const input=observed.enqueue({type:'slam'});recorder.recordInput(input.input);input.events.forEach(e=>recorder.recordEvent(e));}
    baseline.step(); observed.step().forEach(e=>recorder.recordEvent(e));
  }
  const elapsed=performance.now()-start; t.diagnostic(`600 paired ticks with semantic recorder enqueue: ${elapsed.toFixed(1)} ms (sanity check, not a benchmark)`);
  assert.ok(elapsed<2000); assert.equal(hashCheckpoint(baseline.checkpoint()),hashCheckpoint(observed.checkpoint()));
  recorder.captureCheckpoint(observed.checkpoint()); await recorder.flush();
  assert.ok(recorder.health().writerFailures>0); assert.ok(recorder.health().criticalDroppedRecords>0); assert.equal(recorder.health().filteredRecords,1);
  await recorder.close();
  const meta=await readFile(join(recorder.runDirectory,'run.json'),'utf8'); assert.ok(!meta.includes('SECRET_WRITER_DETAIL')); assert.match(meta,/INCOMPLETE/);
});

test('bundle replay rejects tampering and unsafe ZIP paths before extracting anything', async t => {
  const directory=await temp(t), unsafe=join(directory,'unsafe.zip');
  await writeFile(unsafe,zipSync({'../private.txt':strToU8('secret')})); await assert.rejects(inspectBundle(unsafe),/Unsafe/);
  const recorder=new FlightRecorder({directory,worldId:'world',runId:'tamper'}),sim=new Simulation();recorder.captureCheckpoint(sim.checkpoint());
  const input=sim.enqueue({type:'slam'});recorder.recordInput(input.input);input.events.forEach(e=>recorder.recordEvent(e));recordSteps(sim,recorder,3);recorder.captureCheckpoint(sim.checkpoint());await recorder.close();
  const out=join(directory,'tampered.zip');await exportIncident({runDirectory:recorder.runDirectory,out});const files=await inspectBundle(out);
  files['inputs.jsonl']=strToU8('');await writeFile(out,zipSync(files));await assert.rejects(replayBundle(out),/mismatch/);
});

test('actual WebSocket slam and invalid command export their transport causal chain and replay',async t=>{
  const directory=await temp(t);let now=1000;
  const app=createWorldServer({diagnosticsDirectory:directory,autoSchedule:false,clock:{monotonicMs:()=>now,utcMs:()=>now}});
  const port=await app.listen(0),socket=new WebSocket(`ws://127.0.0.1:${port}/world`);
  try {
    await once(socket,'open');const serverSocket=[...app.sockets.clients][0];
    let received=once(serverSocket,'message');socket.send(JSON.stringify({type:'slam'}));await received;
    received=once(serverSocket,'message');socket.send(JSON.stringify({type:'nope',token:'PRIVATE_TRANSPORT_TOKEN'}));await received;
    const sound=new Promise<void>(resolveSound=>socket.on('message',data=>{if(JSON.parse(data.toString()).type==='sound')resolveSound();}));
    now+=100;app.scheduler.pump();await sound;
    socket.close();await once(socket,'close');
  } finally {await app.close();}
  const out=join(directory,'transport.zip'),result=await exportIncident({runDirectory:app.recorder.runDirectory,out});
  assert.equal(result.manifest.evidence_status,'COMPLETE');const files=await inspectBundle(out),events=strFromU8(files['events.jsonl']);
  assert.match(events,/VIEWER_NOTIFICATION/);assert.match(events,/causal_event_id/);assert.match(events,/audioPlayed.*unavailable/);assert.ok(!events.includes('PRIVATE_TRANSPORT_TOKEN'));
  assert.equal((await replayBundle(out)).status,'PASS');
});

test('missing prefix or terminal operational record and declared recorder gaps cannot claim complete export',async t=>{
  const directory=await temp(t),recorder=new FlightRecorder({directory,worldId:'world',runId:'missing'}),sim=new Simulation();recorder.captureCheckpoint(sim.checkpoint());
  const input=sim.enqueue({type:'slam'});recorder.recordInput(input.input);input.events.forEach(e=>recorder.recordEvent(e));recordSteps(sim,recorder,1);
  recorder.record({tick:1,category:'OPERATIONAL_REPLAY',eventType:'VIEWER_NOTIFICATION',component:'transport',outcome:'queued'},true);
  recorder.captureCheckpoint(sim.checkpoint());await recorder.close();
  const log=join(recorder.runDirectory,(await readdir(recorder.runDirectory)).find(name=>name.endsWith('.jsonl'))!);
  const lines=(await readFile(log,'utf8')).trim().split('\n');await writeFile(log,lines.slice(0,-1).join('\n')+'\n');
  assert.equal((await exportIncident({runDirectory:recorder.runDirectory,out:join(directory,'missing.zip')})).manifest.evidence_status,'INCOMPLETE');
  await writeFile(log,lines.slice(1).join('\n')+'\n');
  assert.equal((await exportIncident({runDirectory:recorder.runDirectory,out:join(directory,'prefix.zip')})).manifest.evidence_status,'INCOMPLETE');
  await writeFile(log,lines.join('\n')+'\n');const metaPath=join(recorder.runDirectory,'run.json'),meta=JSON.parse(await readFile(metaPath,'utf8'));meta.health.gaps=['checkpoint_capture_failed'];meta.health.status='INCOMPLETE';await writeFile(metaPath,JSON.stringify(meta));
  assert.equal((await exportIncident({runDirectory:recorder.runDirectory,out:join(directory,'gap.zip')})).manifest.evidence_status,'INCOMPLETE');
  await writeFile(log,lines.join('\n')+'\n{"private":"truncated-secret');
  const corrupt=await exportIncident({runDirectory:recorder.runDirectory,out:join(directory,'corrupt.zip')});
  assert.equal(corrupt.manifest.evidence_status,'INCOMPLETE');assert.ok(corrupt.manifest.coverage.gaps.includes('corrupt_or_partial_jsonl_record'));
  assert.ok(!Object.values(await inspectBundle(join(directory,'corrupt.zip'))).map(value=>strFromU8(value)).join('').includes('truncated-secret'));
});

test('run retention bounds inactive runs while preserving active runs and unrelated data',async t=>{
  const directory=await temp(t);const make=(runId:string)=>new FlightRecorder({directory,worldId:'world',runId,limits:{retainedRuns:2,globalDiskBytes:200000,flushIntervalMs:60000}});
  for(let i=0;i<5;i++){const recorder=make(`closed-${i}`);recorder.captureCheckpoint(new Simulation().checkpoint());await recorder.close();}
  assert.ok((await readdir(directory)).length<=2);
  const active=make('active-one');active.captureCheckpoint(new Simulation().checkpoint());await active.flush();
  const other=make('active-two');other.captureCheckpoint(new Simulation().checkpoint());await other.flush();
  await writeFile(join(active.runDirectory,'unrelated.txt'),'preserve me');
  const third=make('active-three');third.captureCheckpoint(new Simulation().checkpoint());await third.flush();
  assert.equal(await readFile(join(active.runDirectory,'unrelated.txt'),'utf8'),'preserve me');
  assert.equal(third.health().globalCapExceeded,true);assert.equal(third.health().status,'INCOMPLETE');assert.ok(third.health().protectedActiveRuns>=3);
  await Promise.all([active.close(),other.close(),third.close()]);
});

test('export bounds checkpoint and metadata reads as well as JSONL',async t=>{
  const directory=await temp(t),recorder=new FlightRecorder({directory,worldId:'world',runId:'oversized'});recorder.captureCheckpoint(new Simulation().checkpoint());await recorder.close();
  await writeFile(join(recorder.runDirectory,'checkpoint-end.json'),' '.repeat(2*1024*1024+1));
  await assert.rejects(readRun(recorder.runDirectory),/metadata\/checkpoint exceeds/);
});

test('ZIP replay rejects loss of operational notification evidence and inconsistent coverage declarations',async t=>{
  const directory=await temp(t),sim=new Simulation(),recorder=new FlightRecorder({directory,worldId:'world',runId:'op-integrity'});recorder.captureCheckpoint(sim.checkpoint());
  const input=sim.enqueue({type:'slam'});recorder.recordInput(input.input);input.events.forEach(e=>recorder.recordEvent(e));recordSteps(sim,recorder,1);
  recorder.record({tick:1,category:'OPERATIONAL_REPLAY',eventType:'VIEWER_NOTIFICATION',component:'transport',outcome:'queued'},true);recorder.captureCheckpoint(sim.checkpoint());await recorder.close();
  const path=join(directory,'op.zip');await exportIncident({runDirectory:recorder.runDirectory,out:path});const files=await inspectBundle(path),original=files['events.jsonl'];
  files['events.jsonl']=strToU8(strFromU8(original).split('\n').filter(line=>!line.includes('VIEWER_NOTIFICATION')).join('\n'));await writeFile(path,zipSync(files));await assert.rejects(replayBundle(path),/integrity or coverage mismatch/);
  files['events.jsonl']=original;const manifest=JSON.parse(strFromU8(files['manifest.json']));manifest.coverage.gaps=['missing_notification'];files['manifest.json']=strToU8(JSON.stringify(manifest));await writeFile(path,zipSync(files));await assert.rejects(replayBundle(path),/INCOMPLETE/);
});

test('maximum supported pending checkpoint remains bounded and readable for export',async t=>{
  const directory=await temp(t),config=new Simulation().checkpoint();config.config.maxPendingInputs=4096;
  const sim=new Simulation({checkpoint:config});for(let i=0;i<4096;i++)sim.enqueue({type:'slam'});
  const recorder=new FlightRecorder({directory,worldId:'world',runId:'max-pending'});recorder.captureCheckpoint(sim.checkpoint());await recorder.close();
  const run=await readRun(recorder.runDirectory);assert.equal(validateCheckpoint(run.start).pendingInputs.length,4096);
  assert.ok((await stat(join(recorder.runDirectory,'checkpoint-start.json'))).size>512*1024);
});

test('retention protects oversized or malformed metadata without unbounded JSON reads',async t=>{
  const directory=await temp(t),recorder=new FlightRecorder({directory,worldId:'world',runId:'old',limits:{retainedRuns:1}});recorder.captureCheckpoint(new Simulation().checkpoint());await recorder.close();
  await writeFile(join(recorder.runDirectory,'run.json'),' '.repeat(65537));
  const next=new FlightRecorder({directory,worldId:'world',runId:'next',limits:{retainedRuns:1}});next.captureCheckpoint(new Simulation().checkpoint());await next.close();
  assert.equal((await stat(join(recorder.runDirectory,'run.json'))).size,65537);assert.equal(next.health().status,'INCOMPLETE');assert.equal(next.health().globalCapExceeded,true);
});

test('repeated first-append failures keep file tracking bounded and recovery retains successful evidence',async t=>{
  const directory=await temp(t);let failures=12;
  const recorder=new FlightRecorder({directory,worldId:'world',runId:'recover',append:async(path,data)=>{if(failures-->0)throw new Error('injected failure');await appendFile(path,data,'utf8');},limits:{flushIntervalMs:60000}});
  recorder.captureCheckpoint(new Simulation().checkpoint());
  for(let i=0;i<12;i++){
    recorder.record({tick:0,category:'OPERATIONAL_REPLAY',eventType:'FAILED_ATTEMPT',component:'test',outcome:'observed'},true);await recorder.flush();
    assert.equal(recorder.health().retainedFiles,0);assert.equal(recorder.health().retainedBytes,0);
  }
  recorder.record({tick:0,category:'OPERATIONAL_REPLAY',eventType:'RECOVERED_WRITE',component:'test',outcome:'observed'},true);await recorder.flush();await recorder.close();
  const files=(await readdir(recorder.runDirectory)).filter(name=>name.endsWith('.jsonl'));
  assert.equal(files.length,1);assert.equal(recorder.health().retainedFiles,1);assert.equal(recorder.health().writerFailures,12);assert.equal(recorder.health().evictedRecords,0);
  const contents=await readFile(join(recorder.runDirectory,files[0]),'utf8');assert.match(contents,/RECOVERED_WRITE/);assert.ok(!contents.includes('FAILED_ATTEMPT'));
});

test('unowned root directory is preserved and makes global disk coverage explicitly uncertain',async t=>{
  const directory=await temp(t),unowned=join(directory,'unowned data');await mkdir(unowned);await writeFile(join(unowned,'keep.txt'),'x'.repeat(10000));
  const recorder=new FlightRecorder({directory,worldId:'world',runId:'accounting',limits:{globalDiskBytes:5000}});recorder.captureCheckpoint(new Simulation().checkpoint());await recorder.close();
  assert.equal((await stat(join(unowned,'keep.txt'))).size,10000);assert.equal(recorder.health().status,'INCOMPLETE');assert.equal(recorder.health().globalAccountingComplete,false);
  assert.ok(recorder.health().gaps.includes('global_disk_accounting_incomplete_unowned_directory_or_link'));
  const metadata=JSON.parse(await readFile(join(recorder.runDirectory,'run.json'),'utf8'));assert.equal(metadata.health.globalAccountingComplete,false);assert.equal(metadata.health.status,'INCOMPLETE');
});
