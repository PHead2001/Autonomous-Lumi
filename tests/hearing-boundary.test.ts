import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SensorySimulation, validateCheckpoint } from '../server/simulation.js';
import { propagateSound, type AcousticSource } from '../server/hearing.js';
import { DEFAULT_ATTENTION_CONFIG, type SensorFeedbackCommand } from '../shared/attention-protocol.js';
import { eyePose } from '../shared/eye-pose.js';
import { replay } from '../server/replay.js';
import { BranchRuntime, hashRuntimeCheckpoint } from '../server/branch-runtime.js';
import { RecoveryStore } from '../server/recovery-store.js';
import { readRun } from '../server/diagnostics/recorder.js';

const fixture=()=>{
  const cp=new SensorySimulation({mode:'EXPERIMENT'}).checkpoint();
  cp.character.x=0;cp.character.z=-1.5;cp.character.heading=0;cp.character.moving=false;cp.pauseUntilTick=100000;
  return new SensorySimulation({mode:'EXPERIMENT',checkpoint:cp});
};
const pose=(sim:SensorySimulation)=>{const p=eyePose(sim.snapshot());return {x:p.position[0],y:p.position[1],z:p.position[2],bodyHeading:p.bodyHeading,headYaw:p.headYaw,headPitch:p.headPitch};};
const reception=(sim:SensorySimulation)=>({...sim.snapshot(),tick:1,time:1/30});
function matchedSource(sim:SensorySimulation,offset:number):AcousticSource {
  const snapshot=reception(sim),eye=eyePose(snapshot).position,config=sim.attentionState().config;
  const raw={x:0,y:eye[1],z:eye[2]+offset,intensity:1,suddenness:1,sourceId:'private'};
  const physical=propagateSound(raw,snapshot,'calibration',config);
  return {...raw,intensity:.125*(1+config.distanceFalloff*physical.distance**2)/physical.transmission,suddenness:.5/(.85+.15*physical.transmission)};
}
function captureFixture(historical=false){
  const cp=fixture().checkpoint();cp.attention.pending={id:1,createdTick:0,expiresTick:300,reasons:['uncertainty_probe'],triggers:[{reason:'uncertainty_probe',tick:0,parentSequence:null}],parentSequence:null,status:'pending',captureId:null,requestedTick:null};cp.attention.nextIntentId=2;
  if(historical)cp.rulesVersion='lumi-attention-v1';
  const sim=new SensorySimulation({mode:'EXPERIMENT',checkpoint:cp,historical});
  const admitted:SensorFeedbackCommand={type:'sensor_feedback',intentId:1,stage:'admitted',captureId:'first',capturedTick:0,sceneRevision:0,pose:pose(sim),outcome:'success',signature:null,frameHash:null};
  sim.enqueue(admitted);sim.step();
  return {sim,result:{...admitted,stage:'result' as const,signature:Array(48).fill(50),frameHash:'a'.repeat(64)}};
}

test('v2 matched received cues have identical evidence and attention across distinct distance, strength and barrier count',()=>{
  // Binary-exact physical coefficients make matched strengths identical, without
  // introducing rounding into the production sensor or weakening the assertion.
  const cp=fixture().checkpoint();cp.attention.config.distanceFalloff=.125;cp.attention.config.wallTransmission=.5;
  const a=new SensorySimulation({mode:'EXPERIMENT',checkpoint:cp}),b=new SensorySimulation({mode:'EXPERIMENT',checkpoint:cp});
  const near=matchedSource(a,-1),far=matchedSource(b,-4),config=a.attentionState().config;
  const pa=propagateSound(near,reception(a),'same',config),pb=propagateSound(far,reception(b),'same',config);
  assert.notEqual(pa.distance,pb.distance);assert.notEqual(pa.barrierGroups.length,pb.barrierGroups.length);assert.notEqual(near.intensity,far.intensity);assert.notEqual(near.suddenness,far.suddenness);
  assert.deepEqual(pa.received,pb.received);
  for(const [sim,source] of [[a,near],[b,far]] as const){sim.enqueue({type:'emit_sound',...source});sim.step();}
  assert.deepEqual(a.attentionState(),b.attentionState());
  // The old extra-field inversion cannot reconstruct either physical distance.
  for(const p of [pa,pb]) {
    const inverted=(p.received.directionUncertaintyDegrees-15-p.barrierGroups.length*15-(1-p.received.intensity)*15)/2;
    assert.notEqual(inverted,p.distance);
  }
  assert.equal(pa.received.distanceBand,'far','a quiet nearby emitter can be heuristically mistaken for far');
});

test('v2 derived hearing classes are finite, coarse, loudness-only and unresolved below floor or without bearing',()=>{
  const sim=fixture(),eye=eyePose(sim.snapshot()).position;
  const cue={x:eye[0],y:eye[1],z:eye[2]+1,intensity:1,suddenness:1,sourceId:'private'};
  const observed=[.8,.4,.1,.001].map(intensity=>propagateSound({...cue,intensity:intensity*(1+DEFAULT_ATTENTION_CONFIG.distanceFalloff)},sim.snapshot(),'same',DEFAULT_ATTENTION_CONFIG).received);
  assert.deepEqual(observed.map(r=>[r.distanceBand,r.directionUncertaintyDegrees,r.distanceUncertainty]),[['near',30,.5],['middle',60,.75],['far',90,1],['unknown',180,1]]);
  const coincident=propagateSound({...cue,x:eye[0],y:eye[1],z:eye[2]},sim.snapshot(),'same',DEFAULT_ATTENTION_CONFIG).received;
  assert.equal(coincident.bearingDegrees,null);assert.equal(coincident.directionUncertaintyDegrees,180);
  for(const r of [...observed,coincident])assert.ok([r.directionUncertaintyDegrees,r.distanceUncertainty].every(Number.isFinite));
});

test('v2 hidden revision changes between capture and receipt cannot alter image decision, backoff or probe timing',()=>{
  const control=captureFixture(),hidden=captureFixture();
  hidden.sim.enqueue({type:'configure_scene',illumination:1,fixture:'none',fixtureColor:'#21df68',doorOpenRadians:null});
  hidden.sim.enqueue(hidden.result);control.sim.enqueue(control.result);
  const left=control.sim.step(),right=hidden.sim.step();
  assert.equal(hidden.sim.snapshot().scene!.revision,1);
  assert.deepEqual(hidden.sim.attentionState(),control.sim.attentionState());
  assert.equal(hidden.sim.attentionState().baseline!.sceneRevision,0,'original revision remains capture diagnostics');
  assert.deepEqual(right.filter(e=>e.component==='attention').map(e=>[e.type,e.outcome,e.data]),left.filter(e=>e.component==='attention').map(e=>[e.type,e.outcome,e.data]));
  assert.equal(hidden.sim.attentionState().lastCapture!.freshness,'applicable');
  const old=captureFixture(true);old.sim.enqueue({type:'configure_scene',illumination:1,fixture:'none',fixtureColor:'#21df68',doorOpenRadians:null});old.sim.enqueue(old.result);old.sim.step();
  assert.equal(old.sim.attentionState().lastCapture!.freshness,'scene_changed');assert.equal(old.sim.checkpoint().rulesVersion,'lumi-attention-v1');
});

test('v2 accepts visible pixel change across revision and retains age, pose, association and ordering guards',()=>{
  const {sim,result}=captureFixture();sim.enqueue(result);sim.step();
  const next=sim.checkpoint();next.attention.pending={id:2,createdTick:next.tick,expiresTick:next.tick+1000,reasons:['uncertainty_probe'],triggers:[{reason:'uncertainty_probe',tick:next.tick,parentSequence:null}],parentSequence:null,status:'pending',captureId:null,requestedTick:null};next.attention.nextIntentId=3;
  for(const variant of ['visible','age','pose','association','order'] as const){
    const cp=structuredClone(next);
    if(variant==='age'){cp.attention.config.resultMaxAgeTicks=1;}
    if(variant==='order'){cp.attention.pending!.createdTick=0;cp.attention.pending!.triggers[0].tick=0;}
    const copy=new SensorySimulation({mode:'EXPERIMENT',checkpoint:cp});
    const admitted:SensorFeedbackCommand={...result,stage:'admitted',intentId:2,captureId:'second',capturedTick:variant==='order'?0:cp.tick,signature:null,frameHash:null};
    copy.enqueue(admitted);copy.step();
    copy.enqueue({type:'configure_scene',illumination:1,fixture:'none',fixtureColor:'#21df68',doorOpenRadians:null});
    copy.enqueue({...result,...admitted,stage:'result',captureId:variant==='association'?'wrong':'second',pose:variant==='pose'?{...result.pose,x:result.pose.x+3}:result.pose,signature:Array(48).fill(100),frameHash:'b'.repeat(64)});
    const events=copy.step(),state=copy.attentionState();
    if(variant==='association'){assert.ok(events.some(e=>e.data.reason==='capture_association_mismatch'));assert.equal(state.baseline!.captureId,'first');}
    else if(variant==='visible'){assert.ok(events.some(e=>e.type==='VISUAL_CHANGE'));assert.equal(state.failureCount,0);assert.equal(state.lastCapture!.freshness,'applicable');}
    else {assert.equal(state.lastCapture!.freshness,variant==='age'?'age_expired':variant==='pose'?'pose_changed':'superseded');assert.equal(state.failureCount,1);assert.equal(state.baseline!.captureId,'first');}
  }
});

test('active attention-v1 upgrade preserves complete state and queued feedback, sanitizes derived evidence and archives source',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'lumi-attention-rules-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const {sim,result}=captureFixture(true);sim.enqueue(result);
  const old=sim.checkpoint();old.attention.lastReceived={observationId:'heard-old',tick:0,intensity:.4,suddenness:.7,bearingDegrees:15,directionUncertaintyDegrees:73.123,distanceBand:'near',distanceUncertainty:.654,bodyHeading:0,headYaw:0,provenance:'SIMULATED_HEARING'};
  old.attention.commitmentUntilTick=20;old.attention.cooldownUntilTick=30;old.attention.developerUntilTick=40;old.attention.resumeActivity=true;
  const base=new BranchRuntime({worldId:'lumi',branchId:'live',mode:'LIVE',offline:true});
  const envelope={...base.checkpoint(),schemaVersion:3 as const,simulation:old};await base.close();
  const historic=new BranchRuntime({worldId:'lumi',branchId:'live',mode:'LIVE',offline:true,checkpoint:envelope});
  assert.equal(hashRuntimeCheckpoint(historic.checkpoint()),hashRuntimeCheckpoint(envelope));await historic.close();
  const {store}=await RecoveryStore.open({directory});await store.save(envelope);
  const manifest=JSON.parse(await readFile(join(store.directory,'committed.json'),'utf8'));
  const loaded=await RecoveryStore.open({directory});
  const active=new BranchRuntime({worldId:'lumi',branchId:'live',mode:'LIVE',directory,checkpoint:loaded.checkpoint,historyId:store.historyId,physiology:{active:false}});
  try{
    const complete=active.checkpoint().simulation;assert.equal(complete.schemaVersion,11);const baseFields=structuredClone(complete) as unknown as Record<string,unknown>;for(const key of ['cognition','realExperiences','body','interoception','physiology','internalExperiences','home','town','visit','social'])delete baseFields[key];const upgraded={...baseFields,schemaVersion:4 as const,rulesVersion:'lumi-attention-v2' as const};
    assert.equal(upgraded.rulesVersion,'lumi-attention-v2');
    assert.deepEqual(upgraded,{...old,rulesVersion:'lumi-attention-v2',attention:{...old.attention,lastReceived:{...old.attention.lastReceived,directionUncertaintyDegrees:60,distanceBand:'middle',distanceUncertainty:.75}}});
    assert.deepEqual(upgraded.pendingInputs,old.pendingInputs);assert.doesNotThrow(()=>validateCheckpoint(upgraded));
    const expected=new SensorySimulation({mode:'LIVE',checkpoint:upgraded});expected.step();active.simulation.step();const advancedBase=active.simulation.checkpoint() as unknown as Record<string,unknown>;for(const key of ['cognition','realExperiences','body','interoception','physiology','internalExperiences','home','town','visit','social'])delete advancedBase[key];assert.deepEqual({...advancedBase,schemaVersion:4,rulesVersion:'lumi-attention-v2'},expected.checkpoint());
    assert.equal((active.simulation as SensorySimulation).attentionState().lastCapture!.freshness,'applicable');
    for(let i=0;i<4;i++){active.simulation.step();await loaded.store.save(active.checkpoint());}
    const archive='pre-attention-rules-v1-'+manifest.latest.file;assert.ok((await readdir(store.directory)).includes(archive));
    const payload=JSON.parse(await readFile(join(store.directory,archive),'utf8'));assert.equal(hashRuntimeCheckpoint(payload.checkpoint),hashRuntimeCheckpoint(envelope));
    await active.recorder!.flush();const migrated=(await readRun(active.recorder!.runDirectory)).records.find(r=>r.event_type==='STATE_RULES_MIGRATED');
    assert.equal(migrated?.data.fromRules,'lumi-attention-v1');assert.equal(migrated?.data.toRules,'lumi-social-v1');
    assert.equal(replay(old,[],old.tick).checkpoint.rulesVersion,'lumi-attention-v1');
  }finally{await active.close();}
});
