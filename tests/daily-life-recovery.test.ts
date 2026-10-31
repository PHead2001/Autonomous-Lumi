import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceBody,createBody,type BodyRecoveryPolicy} from '../server/physiology.js';
import {validateBodyState,type BodyState} from '../shared/physiology-protocol.js';
import {urgentAttentionSample} from '../server/daily-life-lab.js';
import {DeliverySimulation,PhysiologySimulation,validateCheckpoint,type DeterministicEvent} from '../server/simulation.js';
import {eyePose} from '../shared/eye-pose.js';

const step=(body:BodyState,policy:BodyRecoveryPolicy)=>advanceBody(body,{tick:body.lastIntegratedTick+1,hz:body.hz,executed:{distanceMetres:0,headRadians:0,taskProgress:0},capableAtIntervalStart:body.mode==='awake'||body.mode==='resting',safetyPreempted:false},[],policy);
test('urgent measurement never presents an ordinary sensation as a zero-latency urgent episode',()=>{
  const event={type:'INTERNAL_ATTENDED',data:{kind:'hunger',band:'moderate',crossingTick:'none',eligibleSeconds:0}} as unknown as DeterministicEvent;
  assert.equal(urgentAttentionSample(event),null);
  assert.deepEqual(urgentAttentionSample({...event,data:{...event.data,band:'severe',crossingTick:20,eligibleSeconds:29}}),{key:'hunger:20',seconds:29});
});
test('production neglect reaches the zero-reserve deadlock under historical rules',()=>{
  let body=createBody(0,1,true);let collapsed=false;
  // No effects/fixtures: unattended production expenditure eventually exhausts reserves.
  for(let i=0;i<150*3600;i++){const result=step(body,'historical');body=result.state;if(body.mode==='incapacitated')collapsed=true;}
  assert.ok(collapsed);assert.equal(body.reserves,0);assert.deepEqual(body.absorption,[]);
  assert.equal(body.mode,'incapacitated');assert.equal(body.condition,.1);
  for(let i=0;i<12*3600;i++)body=step(body,'historical').state;
  assert.equal(body.mode,'incapacitated');assert.equal(body.condition,.1);
});
test('versioned reversible weakness restores action capability without inventing nutrition or effects',()=>{
  const original=createBody(0,1,true);Object.assign(original,{reserves:0,satiety:0,condition:.201,sleepPressure:.5});
  let body=original,started=0,completed=0,recoveredAt=0;
  for(let i=0;i<8*3600;i++){
    const result=step(body,'daily-life-v1');body=result.state;
    started+=result.events.filter(e=>e.type==='BODY_RECOVERY_STARTED').length;
    completed+=result.events.filter(e=>e.type==='BODY_RECOVERY_COMPLETED').length;
    assert.equal(body.reserves,0);assert.equal(body.satiety,0);assert.equal(body.lastEffectSequence,0);assert.deepEqual(body.absorption,[]);
    if(completed){recoveredAt=body.lastIntegratedTick;break;}
  }
  assert.equal(started,1);assert.equal(completed,1);assert.ok(recoveredAt>4*3600&&recoveredAt<6*3600);assert.equal(body.mode,'awake');
  validateBodyState(body,body.lastIntegratedTick,1);
});
test('mid-recovery restoration retains deterministic progress and exactly one completion',()=>{
  let body=createBody(0,1,true);Object.assign(body,{reserves:0,satiety:0,condition:.15,sleepPressure:.3,mode:'incapacitated'});
  for(let i=0;i<3600;i++)body=step(body,'daily-life-v1').state;
  let restored=validateBodyState(structuredClone(body),body.lastIntegratedTick,1),completion=0;
  for(let i=0;i<6*3600;i++){
    const actual=step(body,'daily-life-v1'),copy=step(restored,'daily-life-v1');
    assert.deepEqual(copy,actual);body=actual.state;restored=copy.state;
    completion+=actual.events.filter(e=>e.type==='BODY_RECOVERY_COMPLETED').length;
    if(completion)break;
  }
  assert.equal(completion,1);assert.equal(body.mode,'awake');
});
test('unavailable fresh images, disabled encoding and full external input queue do not veto previously observed local food',()=>{
  const cp=new DeliverySimulation({mode:'EXPERIMENT',physiology:{active:true,genesisPreset:'production-v1'}}).checkpoint();
  cp.config.hz=cp.body.hz=1;cp.interoception.sampling.nextSampleTick=5;cp.body.satiety=.07;cp.body.sleepPressure=.1;
  cp.physiology.encodingEnabled=false;cp.home.controller.searchNextTick=10000;cp.config.maxPendingInputs=1;
  // Declared unit fixture: a previously attended layout anchor. Actual-RGB
  // establishment is separately exercised by the endurance harness.
  const pantry=cp.home.layout!.pantry;
  cp.home.known=[{resourceId:pantry.id,kind:'pantry',anchor:{...pantry.anchor},handle:'fixture-shape',captureId:'fixture-prior-capture',frameHash:'a'.repeat(64),capturedTick:0,attentionTick:0,recognition:'authored-rgb-v1'}];
  const sim=new DeliverySimulation({checkpoint:cp,mode:'EXPERIMENT'});
  assert.equal(sim.enqueue({type:'turn_head',yawDelta:0,pitchDelta:0,sceneRevision:cp.scene.revision}).input.admission,'queued');
  assert.equal(sim.enqueue({type:'doorbell'}).input.admission,'queue_full');sim.step();
  for(let i=0;i<100&&!sim.checkpoint().attention.pending;i++)sim.step();
  const pending=sim.checkpoint().attention.pending;assert.ok(pending);
  const eye=eyePose(sim.state);
  sim.enqueue({type:'sensor_feedback',intentId:pending.id,stage:'rejected',captureId:null,capturedTick:sim.state.tick,sceneRevision:cp.scene.revision,pose:{x:eye.position[0],y:eye.position[1],z:eye.position[2],bodyHeading:eye.bodyHeading,headYaw:eye.headYaw,headPitch:eye.headPitch},outcome:'unavailable',signature:null,frameHash:null});
  const events:DeterministicEvent[]=[];
  for(let i=0;i<300&&!sim.homeState().timeline.some(e=>e.type==='consumed');i++)events.push(...sim.step());
  assert.equal(events.filter(e=>e.type==='HOME_FOOD_CONSUMED').length,1);assert.equal(events.filter(e=>e.type==='BODY_INTAKE_ACCEPTED').length,1);
  assert.equal(sim.admittedInternalExperiences().length,0);assert.ok(sim.bodyState().satiety>.5);assert.equal(sim.bodyState().mode,'awake');
});
test('genuinely full internal episode storage refuses another memory while current local care still consumes real food',()=>{
  // Reuse the bounded historical saturation fixture: real body integration,
  // sensing, attention and encoding create all128 episodes. No episode cloning
  // or invented capture/audit timestamps; this is not an endurance-rate trial.
  const initial=new PhysiologySimulation({mode:'EXPERIMENT',worldId:'capacity-care',branchId:'fixture',historyId:'capacity-history',runId:'capacity-run',physiology:{active:true,genesisPreset:'acceptance-fast-v1'}}).checkpoint();
  initial.config.hz=initial.body.hz=1;initial.interoception.sampling.nextSampleTick=5;initial.body.config.awakePressurePerSecond=.002;initial.body.config.sleepPressureRecoveryPerSecond=.1;initial.body.sleepPressure=.77;initial.pauseUntilTick=100000;initial.character.moving=false;
  const source=new PhysiologySimulation({checkpoint:initial,mode:'EXPERIMENT',historical:true});source.applyAction({type:'activity-start',totalTicks:100000});
  for(let i=0;i<80000&&source.admittedInternalExperiences().length<128;i++)source.step();
  assert.equal(source.admittedInternalExperiences().length,128);source.applyAction({type:'activity-pause'});
  const saturated=source.admittedInternalExperiences(),crossings=source.checkpoint().physiology.encodedNeedCrossings;
  const current=new DeliverySimulation({checkpoint:source.checkpoint(),mode:'EXPERIMENT'});
  let refused=false,attended=false;
  for(let i=0;i<1000&&!refused;i++){const events=current.step();attended||=events.some(e=>e.type==='INTERNAL_ATTENDED');refused=events.some(e=>e.type==='INTERNAL_ENCODING'&&e.data.reason==='experience_capacity');}
  assert.ok(refused,'current schema must explicitly refuse the new encoded episode');assert.ok(attended);
  const cp=current.checkpoint(),pantry=cp.home.layout!.pantry;
  // Previously-observed-layout unit fixture; actual RGB establishment is covered
  // by the independent daily-life harness. No eat/goal/body command is injected.
  cp.home.known=[{resourceId:pantry.id,kind:'pantry',anchor:{...pantry.anchor},handle:'fixture-shape',captureId:'fixture-prior-capture',frameHash:'a'.repeat(64),capturedTick:cp.tick,attentionTick:cp.tick,recognition:'authored-rgb-v1'}];
  const sim=new DeliverySimulation({checkpoint:cp,mode:'EXPERIMENT'}),effects=sim.bodyState().lastEffectSequence,events:DeterministicEvent[]=[];
  for(let i=0;i<1200&&!sim.homeState().timeline.some(e=>e.type==='consumed');i++)events.push(...sim.step());
  assert.equal(events.filter(e=>e.type==='HOME_FOOD_CONSUMED').length,1);assert.equal(events.filter(e=>e.type==='BODY_INTAKE_ACCEPTED').length,1);assert.equal(sim.bodyState().lastEffectSequence,effects+1);
  assert.deepEqual(sim.admittedInternalExperiences(),saturated);assert.deepEqual(sim.checkpoint().physiology.encodedNeedCrossings,crossings);assert.equal(sim.checkpoint().physiology.encodingEnabled,true);assert.ok(sim.bodyState().satiety>.4);validateCheckpoint(sim.checkpoint());
});
