import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LabSimulation, Simulation, VisionSimulation, hashCheckpoint, validateCheckpoint, type CheckpointV2 } from '../server/simulation.js';
import { BranchRuntime, hashRuntimeCheckpoint, replayRuntime, validateRuntimeCheckpoint, type RuntimeCheckpoint } from '../server/branch-runtime.js';
import { HEAD_LIMITS, validateHeadAction } from '../shared/vision-protocol.js';
import { RecoveryStore } from '../server/recovery-store.js';
import { exportIncident, replayBundle } from '../server/diagnostics/bundle.js';
import { groundSnapshot } from '../server/vision/grounding.js';
import { replay } from '../server/replay.js';
import { createWorldServer } from '../server/world-server.js';
import { BranchRegistry } from '../server/branch-registry.js';
import { readRun } from '../server/diagnostics/recorder.js';

const turn=(yawDelta=.9,pitchDelta=.3,sceneRevision=0)=>({type:'turn_head' as const,yawDelta,pitchDelta,sceneRevision});
const step=(s:Simulation,n:number)=>{for(let i=0;i<n;i++)s.step();};
const fixture=()=>{const cp=new VisionSimulation({mode:'EXPERIMENT'}).checkpoint();cp.character={x:0,z:-2,heading:0,moving:false,gait:0};cp.pauseUntilTick=10000;cp.scene.fixture='visibility';return new VisionSimulation({mode:'EXPERIMENT',checkpoint:cp});};
const historicalVisionFixture=()=>{const cp=fixture().checkpoint();cp.rulesVersion='lumi-eyes-v1';delete cp.head.observedAim;return new VisionSimulation({mode:'EXPERIMENT',checkpoint:cp,historical:true});};
const historical=(tick=200):RuntimeCheckpoint=>{const s=new LabSimulation({mode:'LIVE',seed:527});step(s,tick);const current=new BranchRuntime({worldId:'lumi',branchId:'live',mode:'LIVE',offline:true}).checkpoint();return {...current,schemaVersion:1,simulation:s.checkpoint() as CheckpointV2};};
async function temp(t:{after(fn:()=>Promise<void>):void}){const directory=await mkdtemp(join(tmpdir(),'lumi-eyes-core-'));t.after(()=>rm(directory,{recursive:true,force:true}));return directory;}

test('head commands execute in order at next tick and obey combined angular speed and limits',()=>{
  const s=new VisionSimulation({mode:'LIVE'});const a=s.enqueue(turn());assert.equal(a.input.applyTick,1);assert.equal(s.snapshot().head!.yaw,0);
  const events=s.step(),h=s.checkpoint().head;assert.equal(h.status,'turning');assert.ok(Math.abs(Math.hypot(h.yaw,h.pitch)-HEAD_LIMITS.radiansPerSecond/30)<1e-12);assert.ok(events.some(e=>e.type==='HEAD_ACTION_STARTED'));
  step(s,40);assert.equal(s.checkpoint().head.yaw,.9);assert.equal(s.checkpoint().head.pitch,.3);assert.equal(s.checkpoint().head.status,'idle');
  for(const action of [turn(3),turn(0,NaN),{...turn(),sceneRevision:-1},{...turn(),engineTargetId:'secret'}, {...turn(),pitchDelta:Infinity}])assert.throws(()=>s.enqueue(action));
  s.enqueue(turn(-.5,0));s.enqueue({type:'cancel_head',sceneRevision:0});s.step();assert.equal(s.checkpoint().head.status,'idle');assert.equal(s.checkpoint().head.yaw,.9);
});

test('turn_head applies relative deltas at execution and clamps target limits while preserving rate bounds',()=>{
  const s=new VisionSimulation({mode:'LIVE'}),delta=Math.PI/6;s.enqueue(turn(delta,0));step(s,20);assert.equal(s.checkpoint().head.yaw,delta);
  s.enqueue(turn(delta,0));step(s,20);assert.equal(s.checkpoint().head.yaw,delta*2);
  s.enqueue(turn(delta,Math.PI/3));const before=s.checkpoint().head; s.step();const after=s.checkpoint().head;
  assert.equal(after.targetYaw,HEAD_LIMITS.maxYaw);assert.equal(after.targetPitch,HEAD_LIMITS.maxPitch);assert.ok(Math.hypot(after.yaw-before.yaw,after.pitch-before.pitch)<=HEAD_LIMITS.radiansPerSecond/30+1e-12);
  step(s,40);assert.equal(s.checkpoint().head.yaw,HEAD_LIMITS.maxYaw);assert.equal(s.checkpoint().head.pitch,HEAD_LIMITS.maxPitch);
  s.enqueue(turn(-2,0));s.enqueue(turn(.2,0));const current=s.checkpoint().head.yaw;s.step();assert.equal(s.checkpoint().head.targetYaw,Math.min(HEAD_LIMITS.maxYaw,current+.2));
  assert.throws(()=>s.enqueue({type:'turn_head',yaw:0,pitch:0,sceneRevision:0} as never));
});

test('mid-turn, pending head input and mid-scan checkpoints continue with identical hashes/effects',()=>{
  const s=new VisionSimulation({mode:'EXPERIMENT'});s.enqueue(turn());step(s,5);const mid=s.checkpoint(),a=new VisionSimulation({mode:'EXPERIMENT',checkpoint:mid});
  step(s,10);step(a,10);assert.equal(hashCheckpoint(s.checkpoint()),hashCheckpoint(a.checkpoint()));
  s.enqueue({type:'scan_area',minYaw:-.7,maxYaw:.8,pitch:.1,passes:2,sceneRevision:0});const pending=s.checkpoint(),b=new VisionSimulation({mode:'EXPERIMENT',checkpoint:pending});
  const events=[];for(let i=0;i<18;i++){events.push(...s.step());b.step();}assert.equal(hashCheckpoint(s.checkpoint()),hashCheckpoint(b.checkpoint()));
  const c=new VisionSimulation({mode:'EXPERIMENT',checkpoint:s.checkpoint()});const left=[],right=[];for(let i=0;i<160;i++){left.push(...s.step());right.push(...c.step());}
  assert.deepEqual(right,left);assert.equal(hashCheckpoint(s.checkpoint()),hashCheckpoint(c.checkpoint()));assert.equal(left.filter(e=>e.type==='HEAD_ACTION_COMPLETE').length,1);assert.equal(s.checkpoint().head.status,'idle');
  const replayed=replay(pending,[],pending.tick+178);assert.equal(replayed.stateHash,hashCheckpoint(s.checkpoint()));
});

test('historical eyes-v1 private target evidence retains exact visibility rechecks in offline replay',()=>{
  const s=historicalVisionFixture();assert.equal(groundSnapshot(s.snapshot()).objects.find(o=>o.id==='fixture-ahead')?.eligible,true);
  const evidence={observationId:'obs-test',handle:'target-test',frameHash:'a'.repeat(64),capturedTick:0,captureWidth:512,captureHeight:512,engineTargetId:'fixture-ahead'};
  const target={type:'look_at' as const,yaw:-.3,pitch:0,sceneRevision:0,evidence};s.enqueue(target);assert.ok(s.step().some(e=>e.type==='HEAD_ACTION_STARTED'));
  const hidden=historicalVisionFixture();hidden.enqueue({...target,evidence:{...evidence,engineTargetId:'fixture-behind-wall'}});assert.ok(hidden.step().some(e=>e.data.reason==='target_no_longer_visible'));
  const changed=historicalVisionFixture();changed.enqueue({type:'configure_scene',illumination:.01,fixture:'visibility',fixtureColor:'#ed6050',doorOpenRadians:null});changed.enqueue(target);assert.ok(changed.step().some(e=>e.data.reason==='scene_revision_changed'));
  const door=historicalVisionFixture();door.enqueue({type:'slam'});door.enqueue(target);assert.ok(door.step().some(e=>e.data.reason==='scene_revision_changed'));
  const old=historicalVisionFixture(),cp=old.checkpoint();cp.tick=400;cp.subjective.lastCalibrationTick=null;const expired=new VisionSimulation({mode:'EXPERIMENT',checkpoint:cp,historical:true});expired.enqueue(target);assert.ok(expired.step().some(e=>e.data.reason==='observation_expired'));
  assert.throws(()=>validateHeadAction({...target,evidence:{...evidence,hiddenCoordinates:[1,2,3]}}));
});

test('V3 validation refuses partial/mismatched scan/camera/schema state and legacy replay refuses new commands',()=>{
  const s=new VisionSimulation({mode:'EXPERIMENT'}),cp=s.checkpoint();
  for(const bad of [{...cp,head:undefined},{...cp,head:{...cp.head,camera:{...cp.head.camera,width:0}}},{...cp,head:{...cp.head,status:'scanning'}},{...cp,rulesVersion:'lumi-lab-v1'},{...cp,scene:{...cp.scene,revision:Infinity}}])assert.throws(()=>validateCheckpoint(bad));
  const overlapping=structuredClone(cp);overlapping.scene.fixture='visibility';overlapping.character.x=.83;overlapping.character.z=.2;assert.throws(()=>validateCheckpoint(overlapping),/overlaps physical collider/);
  assert.throws(()=>new Simulation().enqueue(turn()));assert.throws(()=>new LabSimulation({mode:'LIVE'}).enqueue(turn()));
  const r=new BranchRuntime({worldId:'lumi',branchId:'live',mode:'LIVE',offline:true});assert.throws(()=>validateRuntimeCheckpoint({...r.checkpoint(),schemaVersion:1}));
});

test('historical eyes-v1 target execution preserves captured resolution in offline replay',()=>{
  const cp=historicalVisionFixture().checkpoint();cp.character.x=.1;cp.character.z=.8;
  const s=new VisionSimulation({mode:'EXPERIMENT',checkpoint:cp,historical:true}),high=groundSnapshot(s.snapshot(),1024,1024).objects.find(o=>o.id==='fixture-small')!,baseline=groundSnapshot(s.snapshot(),512,512).objects.find(o=>o.id==='fixture-small')!;
  assert.equal(high.eligible,true);assert.equal(baseline.eligible,false);assert.ok(high.projectedPixels>=8&&baseline.projectedPixels<8);
  const evidence={observationId:'obs-1024',handle:'small-shape',frameHash:'b'.repeat(64),capturedTick:cp.tick,captureWidth:1024,captureHeight:1024,engineTargetId:'fixture-small'};
  const input=s.enqueue({type:'look_at',yaw:0,pitch:0,sceneRevision:0,evidence}),events=s.step();assert.ok(events.some(e=>e.type==='HEAD_ACTION_STARTED'));assert.ok(!events.some(e=>e.data.reason==='target_no_longer_visible'));
  const reproduced=replay(cp,[input.input],cp.tick+1);assert.equal(reproduced.stateHash,hashCheckpoint(s.checkpoint()));assert.equal(reproduced.eventHash,s.checkpoint().eventHash);
  const low=new VisionSimulation({mode:'EXPERIMENT',checkpoint:cp,historical:true});low.enqueue({type:'look_at',yaw:0,pitch:0,sceneRevision:0,evidence:{...evidence,captureWidth:512,captureHeight:512}});assert.ok(low.step().some(e=>e.data.reason==='target_no_longer_visible'));
  for(const captureWidth of [127,1025,NaN,512.5])assert.throws(()=>validateHeadAction({type:'look_at',yaw:0,pitch:0,sceneRevision:0,evidence:{...evidence,captureWidth}}));
});

test('pre-retirement observers see the replacement and write before old recorder closes; failure does not roll back',async t=>{
  const directory=await temp(t);let observed=0,fail=false;
  const registry:BranchRegistry=new BranchRegistry({directory,beforeRetireRuntime:old=>{observed++;assert.notEqual(registry.get(old.target),old);old.recorder!.record({tick:old.simulation.state.tick,category:'PRIVATE_SENSOR',eventType:'TEST_RETIREMENT_EVIDENCE',component:'vision',outcome:'stale',data:{reason:'run_retired'}});if(fail)throw new Error('controlled observer failure');}});
  try{const cp=await registry.checkpoint(registry.live.target),old=await registry.fork(registry.live.target,cp.id,'retirement');old.applyControl({type:'pause'});const saved=await registry.checkpoint(old.target),replacement=await registry.restore(old.target,saved.id);assert.equal(observed,1);assert.equal(registry.active(replacement.target),replacement);assert.throws(()=>old.enqueue({type:'slam'}),/closed/);const records=await readRun(old.recorder!.runDirectory);assert.ok(records.records.some(r=>r.event_type==='TEST_RETIREMENT_EVIDENCE'));
    fail=true;const next=await registry.restore(replacement.target,saved.id);assert.equal(observed,2);assert.equal(registry.active(next.target),next);assert.throws(()=>replacement.enqueue({type:'slam'}),/closed/);next.capture();const activeRecords=(await next.recorder!.snapshotForExport()).records;assert.ok(activeRecords.some(r=>r.event_type==='RESTORE_RETIRE_OBSERVER_FAILED'));
  }finally{await registry.close();}
});

test('active schema2 upgrade preserves history/tick/existing state and archives recovery source beyond rotation',async t=>{
  const directory=await temp(t),legacy=historical(),{store}=await RecoveryStore.open({directory});await store.save(legacy);const oldManifest=JSON.parse(await readFile(join(store.directory,'committed.json'),'utf8'));
  const recovery=await RecoveryStore.open({directory}),runtime=new BranchRuntime({worldId:'lumi',branchId:'live',mode:'LIVE',checkpoint:recovery.checkpoint,historyId:recovery.store.historyId,directory});
  try{const cp=runtime.checkpoint();assert.equal(cp.schemaVersion,9);assert.equal(cp.simulation.schemaVersion,10);assert.equal(runtime.summary().historyId,store.historyId);assert.equal(cp.simulation.tick,legacy.simulation.tick);
    const oldState=structuredClone(cp.simulation) as unknown as Record<string,unknown>;delete oldState.head;delete oldState.scene;delete oldState.attention;delete oldState.genericSoundCount;delete oldState.cognition;delete oldState.realExperiences;delete oldState.body;delete oldState.interoception;delete oldState.physiology;delete oldState.internalExperiences;delete oldState.home;delete oldState.town;delete oldState.visit;assert.deepEqual({...oldState,schemaVersion:2,rulesVersion:'lumi-lab-v1'},legacy.simulation);
    for(let i=0;i<4;i++){runtime.simulation.step();await recovery.store.save(runtime.checkpoint());}
    const archive='pre-vision-schema2-'+oldManifest.latest.file;assert.ok((await readdir(store.directory)).includes(archive));const payload=JSON.parse(await readFile(join(store.directory,archive),'utf8'));assert.equal(hashRuntimeCheckpoint(payload.checkpoint),hashRuntimeCheckpoint(legacy));
    const again=await RecoveryStore.open({directory});assert.equal(again.store.historyId,store.historyId);assert.equal((again.checkpoint as RuntimeCheckpoint).simulation.schemaVersion,10);
    await runtime.recorder!.flush();runtime.capture();const records=(await runtime.recorder!.snapshotForExport()).records;assert.ok(records.some(r=>r.event_type==='STATE_SCHEMA_MIGRATED'&&r.data.fromSchema===2&&r.data.toSchema===10));
  }finally{await runtime.close();}
});

test('committed recovery preserves mid-scan eye/head state and future deterministic continuation',async t=>{
  const directory=await temp(t),{store}=await RecoveryStore.open({directory}),runtime=new BranchRuntime({worldId:'lumi',branchId:'live',mode:'LIVE',offline:true});runtime.enqueue({type:'scan_area',minYaw:-.7,maxYaw:.8,pitch:.2,passes:2,sceneRevision:0});step(runtime.simulation,12);const cp=runtime.checkpoint();await store.save(cp);
  const loaded=await RecoveryStore.open({directory}),restored=new BranchRuntime({worldId:'lumi',branchId:'live',mode:'LIVE',offline:true,checkpoint:loaded.checkpoint});assert.equal(hashRuntimeCheckpoint(restored.checkpoint()),hashRuntimeCheckpoint(cp));step(runtime.simulation,100);step(restored.simulation,100);assert.equal(hashRuntimeCheckpoint(restored.checkpoint()),hashRuntimeCheckpoint(runtime.checkpoint()));
});

test('historical V2 runtime replay retains its original hash while new V3 head inputs export/replay offline',async t=>{
  const old=historical(10),historicalReplay=replayRuntime(old,[],old);assert.equal(historicalReplay.runtimeHash,hashRuntimeCheckpoint(old));assert.equal(historicalReplay.checkpoint.simulation.schemaVersion,2);
  const directory=await temp(t),runtime=new BranchRuntime({worldId:'lumi',branchId:'eyes',mode:'EXPERIMENT',directory});
  try{runtime.applyControl({type:'pause'});runtime.enqueue(turn());for(let i=0;i<8;i++)runtime.applyControl({type:'step'});runtime.enqueue({type:'scan_area',minYaw:-.4,maxYaw:.5,pitch:0,passes:1,sceneRevision:0});for(let i=0;i<8;i++)runtime.applyControl({type:'step'});runtime.capture();await runtime.recorder!.flush();
    const out=join(directory,'eyes.zip'),bundle=await exportIncident({runDirectory:runtime.recorder!.runDirectory,out});assert.equal(bundle.manifest.evidence_status,'COMPLETE');const result=await replayBundle(out);assert.equal(result.runtimeHash,hashRuntimeCheckpoint(runtime.checkpoint()));
  }finally{await runtime.close();}
});

test('head/scene checkpoint copies stay isolated and LIVE refuses experiment scene mutation',()=>{
  const live=new VisionSimulation({mode:'LIVE'}),cp=live.checkpoint(),a=new VisionSimulation({mode:'EXPERIMENT',checkpoint:cp}),b=new VisionSimulation({mode:'EXPERIMENT',checkpoint:cp});a.enqueue(turn());step(a,8);assert.equal(hashCheckpoint(live.checkpoint()),hashCheckpoint(cp));assert.equal(hashCheckpoint(b.checkpoint()),hashCheckpoint(cp));
  live.enqueue({type:'configure_scene',illumination:0,fixture:'none',fixtureColor:'#ed6050',doorOpenRadians:null});assert.ok(live.step().some(e=>e.data.reason==='scene_fixture_experiment_only'));assert.equal(live.checkpoint().scene.illumination,1);
});

test('private vision GETs and head action requests enforce scope/origin without requiring a renderer',async t=>{
  const directory=await temp(t),app=createWorldServer({diagnosticsDirectory:directory,autoSchedule:false}),port=await app.listen(0),scope=app.registry.live.target,base=`http://127.0.0.1:${port}`;
  try{const query=new URLSearchParams({...scope});assert.equal((await fetch(base+'/api/vision?'+query,{headers:{Origin:'https://evil.example'}})).status,403);
    assert.equal((await fetch(base+'/api/vision?'+new URLSearchParams({...scope,runId:'wrong'}))).status,400);
    const post=(action:unknown)=>fetch(base+'/api/vision/head',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...scope,action})});
    assert.equal((await post(turn())).status,200);app.simulation.step();assert.ok(app.simulation.snapshot().head!.yaw>0);
    assert.equal((await post({type:'look_at',yaw:0,pitch:0,sceneRevision:0,evidence:{observationId:'fake'}})).status,400);
  }finally{await app.close();}
});
