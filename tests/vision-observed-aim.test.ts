import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BranchRuntime, hashRuntimeCheckpoint } from '../server/branch-runtime.js';
import { VisionSimulation, hashCheckpoint, validateCheckpoint } from '../server/simulation.js';
import { CaptureManager } from '../server/vision/capture-manager.js';
import { ChromiumRenderer, type FrameRenderer } from '../server/vision/renderer.js';
import { groundSnapshot, filterVisibleGrounding } from '../server/vision/grounding.js';
import { createVisibilityFixture } from '../shared/vision-fixture.js';
import { isCapturedBearingEvidence, observedHeadTarget, type CapturedBearingEvidence } from '../shared/vision-protocol.js';
import { RecoveryStore } from '../server/recovery-store.js';
import { readRun } from '../server/diagnostics/recorder.js';
import { exportIncident, replayBundle } from '../server/diagnostics/bundle.js';
import { replay } from '../server/replay.js';

const radians=(degrees:number)=>degrees*Math.PI/180;
const close=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);
const step=(s:VisionSimulation,n:number)=>{for(let i=0;i<n;i++)s.step();};
const fakeRenderer=():FrameRenderer=>({render:async()=>({bytes:new Uint8Array([137,80,78,71]),backend:{configuration:'angle-d3d11',chromium:'TEST STUB',webglVendor:'TEST STUB',webglRenderer:'TEST STUB',version:'TEST STUB',flags:[]}}),close:async()=>{}});
function fixtureRuntime(moving=false,directory?:string) {
  const initial=new BranchRuntime({worldId:'aim-test',branchId:'fixture',mode:'EXPERIMENT',offline:true}),base=initial.checkpoint(),cp={...base,schemaVersion:2 as const,simulation:new VisionSimulation({mode:'EXPERIMENT'}).checkpoint()},fixture=createVisibilityFixture();
  if(cp.simulation.schemaVersion!==3)throw new Error('Vision checkpoint required');
  cp.simulation.character={...fixture.character,moving};cp.simulation.head=fixture.head!;cp.simulation.scene=fixture.scene!;cp.simulation.pauseUntilTick=moving?0:10000;
  const runtime=new BranchRuntime({worldId:'aim-test',branchId:'fixture',mode:'EXPERIMENT',offline:!directory,directory,checkpoint:cp});runtime.applyControl({type:'pause'});return runtime;
}
async function observed(manager:CaptureManager,runtime:BranchRuntime) {
  const request=manager.request(runtime,{reason:'diagnostic'});assert.equal((await manager.wait(runtime.target,request.captureId)).status,'success');
  const view=manager.view(runtime.target),shape=view.observation!.shapes.find(s=>s.bearingDegrees===-15)!;assert.ok(shape);
  return {request,shape,action:()=>manager.resolveHeadAction(runtime,{type:'look_at',observationId:request.captureId,handle:shape.handle,sceneRevision:runtime.viewerState().scene!.revision})};
}
const evidence=(overrides:Partial<CapturedBearingEvidence>={}):CapturedBearingEvidence=>({kind:'captured_filtered_bearing_v1',observationId:'captured-ray',handle:'coarse-shape',frameHash:'a'.repeat(64),capturedTick:0,capturedBodyHeading:0,capturedHeadYaw:0,capturedHeadPitch:0,bearingDegrees:-15,elevationDegrees:0,...overrides});

test('observed look uses the captured coarse bearing after a head turn and can turn back toward an unseen shape',async()=>{
  const runtime=fixtureRuntime(),manager=new CaptureManager(()=>true,fakeRenderer());
  try {
    const old=await observed(manager,runtime);runtime.enqueue({type:'turn_head',yawDelta:radians(60),pitchDelta:radians(15),sceneRevision:0});for(let i=0;i<21;i++)runtime.applyControl({type:'step'});
    const current=groundSnapshot(runtime.viewerState()).objects.find(o=>o.id==='fixture-ahead')!;assert.equal(current.eligible,false);
    const fresh=manager.request(runtime,{reason:'diagnostic'});await manager.wait(runtime.target,fresh.captureId);assert.equal((manager.view(runtime.target).privateGrounding as ReturnType<typeof groundSnapshot>).objects.find(o=>o.id==='fixture-ahead')!.eligible,false);
    const action=old.action();assert.equal(action.type,'look_at');if(action.type!=='look_at'||!action.evidence||!isCapturedBearingEvidence(action.evidence))throw new Error('Expected captured direction');
    close(action.yaw,radians(old.shape.bearingDegrees));close(action.pitch,radians(old.shape.elevationDegrees));assert.ok(Math.abs(action.yaw-(runtime.viewerState().head!.yaw+current.bearingRadians))>.01);
    assert.ok(!JSON.stringify(action).includes('engineTargetId'));runtime.enqueue(action);runtime.applyControl({type:'step'});close(runtime.viewerState().head!.targetYaw,radians(-15));
    assert.equal(runtime.simulation.checkpoint().experiences.length,0);
  }finally{await manager.close();await runtime.close();}
});

test('observed look compensates own body rotation and translation without remeasuring the object',async()=>{
  const runtime=fixtureRuntime(true),manager=new CaptureManager(()=>true,fakeRenderer());
  try {
    const old=await observed(manager,runtime),captured=runtime.viewerState();runtime.applyControl({type:'step'});
    const now=runtime.viewerState();assert.notEqual(now.character.heading,captured.character.heading);assert.notEqual(now.character.x,captured.character.x);
    const action=old.action();if(action.type!=='look_at'||!action.evidence||!isCapturedBearingEvidence(action.evidence))throw new Error('Expected captured direction');
    close(action.yaw,observedHeadTarget(action.evidence,now.character.heading).yaw);
    const exact=groundSnapshot(now).objects.find(o=>o.id==='fixture-ahead')!;assert.ok(Math.abs(action.yaw-(now.head!.yaw+exact.bearingRadians))>1e-4);
    runtime.enqueue(action);runtime.applyControl({type:'step'});close(runtime.viewerState().head!.targetYaw,observedHeadTarget(action.evidence,runtime.viewerState().character.heading).yaw);
  }finally{await manager.close();await runtime.close();}
});

test('queued observed motor rebases after same-tick body movement and restores its captured ray midway',()=>{
  const runtime=fixtureRuntime(true),cp=runtime.checkpoint();if(cp.simulation.schemaVersion!==3)throw new Error('Vision required');
  const s=new VisionSimulation({mode:'EXPERIMENT',checkpoint:cp.simulation}),ray=evidence(),input=s.enqueue({type:'look_at',yaw:radians(-15),pitch:0,sceneRevision:0,evidence:ray});
  s.step();assert.notEqual(s.state.character.heading,0);close(s.checkpoint().head.targetYaw,observedHeadTarget(ray,s.state.character.heading).yaw);assert.ok(s.checkpoint().head.observedAim);
  const midpoint=s.checkpoint(),restored=new VisionSimulation({mode:'EXPERIMENT',checkpoint:midpoint});
  const broken=structuredClone(midpoint);broken.head.observedAim=null;assert.throws(()=>validateCheckpoint({...broken,head:{...broken.head,observedAim:undefined}}));
  const changed=structuredClone(midpoint);changed.character.heading+=.1;assert.throws(()=>validateCheckpoint(changed),/observed aim/);
  for(let i=0;i<25;i++){assert.deepEqual(restored.step(),s.step());assert.equal(hashCheckpoint(restored.checkpoint()),hashCheckpoint(s.checkpoint()));}
  assert.equal(s.checkpoint().head.status,'idle');assert.equal(s.checkpoint().head.observedAim,null);
  const reproduced=replay(cp.simulation,[input.input],s.state.tick);assert.equal(reproduced.stateHash,hashCheckpoint(s.checkpoint()));
});

test('observed motor cancels without clamping or snapping when own body rotation puts the ray out of range',()=>{
  const runtime=fixtureRuntime(true),cp=runtime.checkpoint();if(cp.simulation.schemaVersion!==3)throw new Error('Vision required');
  const s=new VisionSimulation({mode:'EXPERIMENT',checkpoint:cp.simulation});s.enqueue({type:'look_at',yaw:radians(60),pitch:0,sceneRevision:0,evidence:evidence({bearingDegrees:60})});
  const events=s.step(),head=s.checkpoint().head;assert.ok(events.some(e=>e.type==='HEAD_INTERRUPTED'&&e.data.reason==='observed_direction_out_of_head_range'));
  assert.equal(head.status,'idle');assert.equal(head.yaw,0);assert.equal(head.targetYaw,0);assert.equal(head.observedAim,null);
});

test('an in-flight observed ray survives restore and follows later own body turns until interrupted',()=>{
  const cp=new VisionSimulation({mode:'EXPERIMENT'}).checkpoint();cp.character={x:-2.6,z:-1.325,heading:0,moving:true,gait:0};cp.config.pauseTicks=1;
  const s=new VisionSimulation({mode:'EXPERIMENT',checkpoint:cp}),ray=evidence({capturedHeadYaw:radians(30),bearingDegrees:30});
  s.enqueue({type:'look_at',yaw:radians(60),pitch:0,sceneRevision:0,evidence:ray});s.step();close(s.checkpoint().head.targetYaw,radians(60));
  const midpoint=s.checkpoint(),restored=new VisionSimulation({mode:'EXPERIMENT',checkpoint:midpoint});assert.deepEqual(restored.step(),s.step());
  assert.ok(s.state.character.heading>Math.PI/2);close(s.checkpoint().head.targetYaw,observedHeadTarget(ray,s.state.character.heading).yaw);assert.equal(hashCheckpoint(restored.checkpoint()),hashCheckpoint(s.checkpoint()));
  for(const command of [{type:'cancel_head' as const,sceneRevision:0},{type:'turn_head' as const,yawDelta:.1,pitchDelta:0,sceneRevision:0},{type:'scan_area' as const,minYaw:-.2,maxYaw:.2,pitch:0,passes:1,sceneRevision:0}]) {
    const interrupted=new VisionSimulation({mode:'EXPERIMENT',checkpoint:s.checkpoint()});interrupted.enqueue(command);interrupted.step();assert.equal(interrupted.checkpoint().head.observedAim,null);
  }
});

test('current observed direction retains age, scene and anatomical gates without private visibility gates',()=>{
  const runtime=fixtureRuntime(),cp=runtime.checkpoint();if(cp.simulation.schemaVersion!==3)throw new Error('Vision required');
  const make=()=>new VisionSimulation({mode:'EXPERIMENT',checkpoint:cp.simulation});
  const changed=make();changed.enqueue({type:'slam'});changed.enqueue({type:'look_at',yaw:0,pitch:0,sceneRevision:0,evidence:evidence()});assert.ok(changed.step().some(e=>e.data.reason==='scene_revision_changed'));
  const old=structuredClone(cp.simulation);old.tick=301;const expired=new VisionSimulation({mode:'EXPERIMENT',checkpoint:old});expired.enqueue({type:'look_at',yaw:0,pitch:0,sceneRevision:0,evidence:evidence()});assert.ok(expired.step().some(e=>e.data.reason==='observation_expired'));
  const outside=make();outside.enqueue({type:'look_at',yaw:0,pitch:0,sceneRevision:0,evidence:evidence({bearingDegrees:90})});assert.ok(outside.step().some(e=>e.data.reason==='observed_bearing_exceeds_head_limits'));
  assert.throws(()=>make().enqueue({type:'look_at',yaw:0,pitch:0,sceneRevision:0,evidence:{...evidence(),bearingDegrees:17}}),/captured bearing/);
});

test('observation handle admission still rejects unknown, expired and changed-scene contexts',async()=>{
  const runtime=fixtureRuntime(),manager=new CaptureManager(()=>true,fakeRenderer());
  try {
    const old=await observed(manager,runtime);assert.throws(()=>manager.resolveHeadAction(runtime,{type:'look_at',observationId:old.request.captureId,handle:'unknown-shape',sceneRevision:0}),/Unknown observation/);
    for(let i=0;i<301;i++)runtime.applyControl({type:'step'});assert.throws(old.action,/expired/);
    const fresh=await observed(manager,runtime);runtime.enqueue({type:'configure_scene',illumination:.5,fixture:'visibility',fixtureColor:'#ed6050',doorOpenRadians:null});runtime.applyControl({type:'step'});assert.throws(fresh.action,/scene revision/);
  }finally{await manager.close();await runtime.close();}
});

test('filtered visibility exposes rough thirds while exact ray fractions remain private',()=>{
  const result=groundSnapshot(createVisibilityFixture()),original=result.objects.find(o=>o.eligible)!;
  result.objects=[1/27,1/3,17/27,2/3,1].map((fraction,i)=>({...original,id:'private-'+i,sampleVisibilityFraction:fraction}));
  const filtered=filterVisibleGrounding(result,id=>'handle-'+id.length);
  assert.deepEqual(filtered.map(o=>o.sampleVisibilityBand),['low','low','medium','medium','high']);assert.ok(!JSON.stringify(filtered).includes('sampleVisibilityFraction'));
  assert.equal(result.objects[2].sampleVisibilityFraction,17/27);
});

test('rules upgrade preserves the saved pose and queue, archives its source, and keeps historical replay exact',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'lumi-observed-rules-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const initial=new VisionSimulation({mode:'LIVE'}).checkpoint();initial.rulesVersion='lumi-eyes-v1';delete initial.head.observedAim;initial.pauseUntilTick=10000;
  const legacy=new VisionSimulation({mode:'LIVE',checkpoint:initial,historical:true});legacy.enqueue({type:'turn_head',yawDelta:.7,pitchDelta:0,sceneRevision:0});step(legacy,3);
  legacy.enqueue({type:'look_at',yaw:0,pitch:0,sceneRevision:0,evidence:{observationId:'old-observation',handle:'old-handle',frameHash:'b'.repeat(64),capturedTick:3,captureWidth:512,captureHeight:512,engineTargetId:'fixture-missing'}});
  const old=legacy.checkpoint(),base=new BranchRuntime({worldId:'lumi',branchId:'live',mode:'LIVE',offline:true}).checkpoint(),envelope={...base,schemaVersion:2 as const,simulation:old};
  const historicalRuntime=new BranchRuntime({worldId:'lumi',branchId:'live',mode:'LIVE',offline:true,checkpoint:envelope});assert.equal(hashRuntimeCheckpoint(historicalRuntime.checkpoint()),hashRuntimeCheckpoint(envelope));
  const historicalEnd=new VisionSimulation({mode:'LIVE',checkpoint:old,historical:true});assert.ok(historicalEnd.step().some(e=>e.data.reason==='target_no_longer_visible'));
  assert.equal(replay(old,[],old.tick+1).stateHash,hashCheckpoint(historicalEnd.checkpoint()));
  const {store}=await RecoveryStore.open({directory});await store.save(envelope);const manifest=JSON.parse(await readFile(join(store.directory,'committed.json'),'utf8'));
  const loaded=await RecoveryStore.open({directory}),active=new BranchRuntime({worldId:'lumi',branchId:'live',mode:'LIVE',directory,checkpoint:loaded.checkpoint,historyId:store.historyId});
  try {
    const upgraded=active.checkpoint();assert.equal(upgraded.simulation.rulesVersion,'lumi-attention-v1');if(upgraded.simulation.schemaVersion!==4)throw new Error('Attention required');
    const preserved=structuredClone(upgraded.simulation) as unknown as Record<string,unknown>;delete preserved.attention;delete preserved.genericSoundCount;preserved.schemaVersion=3;preserved.rulesVersion='lumi-eyes-v1';delete (preserved.head as {observedAim?:unknown}).observedAim;assert.deepEqual(preserved,old);
    const events=active.simulation.step();assert.ok(events.some(e=>e.data.reason==='legacy_observation_evidence'));assert.equal(active.simulation.snapshot().head!.observedAim,null);assert.equal(active.simulation.snapshot().head!.status,'turning');
    for(let i=0;i<4;i++){active.simulation.step();await loaded.store.save(active.checkpoint());}
    const archive='pre-vision-rules-v1-'+manifest.latest.file;assert.ok((await readdir(store.directory)).includes(archive));const payload=JSON.parse(await readFile(join(store.directory,archive),'utf8'));assert.equal(hashRuntimeCheckpoint(payload.checkpoint),hashRuntimeCheckpoint(envelope));
    await active.recorder!.flush();const migration=(await readRun(active.recorder!.runDirectory)).records.find(r=>r.event_type==='STATE_RULES_MIGRATED');assert.equal(migration?.data.fromRules,'lumi-eyes-v1');assert.equal(migration?.data.toRules,'lumi-attention-v1');
    assert.throws(()=>active.enqueue({type:'look_at',yaw:0,pitch:0,sceneRevision:0,evidence:{observationId:'old-observation',handle:'old-handle',frameHash:'b'.repeat(64),capturedTick:3,captureWidth:512,captureHeight:512,engineTargetId:'fixture-missing'}}),/Legacy observation/);
  }finally{await active.close();await historicalRuntime.close();}
});

test('captured coarse target commands export and replay offline without rendering or target coordinates',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'lumi-observed-export-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const runtime=fixtureRuntime(false,directory),manager=new CaptureManager(()=>true,process.env.LUMI_AIM_DIAGNOSTIC_OUT?new ChromiumRenderer():fakeRenderer());
  try {
    const captured=await observed(manager,runtime);runtime.enqueue({type:'turn_head',yawDelta:radians(10),pitchDelta:0,sceneRevision:0});for(let i=0;i<4;i++)runtime.applyControl({type:'step'});
    runtime.enqueue(captured.action());for(let i=0;i<20;i++)runtime.applyControl({type:'step'});runtime.capture();await runtime.recorder!.flush();
    const out=process.env.LUMI_AIM_DIAGNOSTIC_OUT?resolve(process.env.LUMI_AIM_DIAGNOSTIC_OUT):join(directory,'observed-aim.zip');await mkdir(dirname(out),{recursive:true});
    const bundle=await exportIncident({runDirectory:runtime.recorder!.runDirectory,out});assert.equal(bundle.manifest.evidence_status,'COMPLETE');const result=await replayBundle(out);assert.equal(result.runtimeHash,hashRuntimeCheckpoint(runtime.checkpoint()));assert.equal(runtime.simulation.checkpoint().experiences.length,0);
  }finally{await manager.close();await runtime.close();}
});
