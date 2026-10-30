import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceBody, applyAcceptedBodyEffect, bodyImpairment, circadianPhase, createBody } from '../server/physiology.js';
import { validateBodyState, validatePhysiologyConfig, type BodyState, type PhysiologyEffect } from '../shared/physiology-protocol.js';

const step=(state:BodyState,effects:PhysiologyEffect[]=[],distanceMetres=0)=>advanceBody(state,{tick:state.lastIntegratedTick+1,hz:state.hz,executed:{distanceMetres,taskProgress:0,headRadians:0},safetyPreempted:false,capableAtIntervalStart:true},effects);
function hours(state:BodyState,count:number):BodyState {for(let i=0;i<Math.round(count*3600*state.hz);i++)state=step(state).state;return state;}

test('experimental calibration has gradual hunger/debt, distinct reserves and no damage after a missed meal or delayed bedtime',()=>{
  const start=createBody(0,1,true),six=hours(start,6),twelve=hours(six,6),twentyFour=hours(twelve,12);
  assert.ok(Math.abs(six.satiety-.52)<.00001);assert.ok(Math.abs(six.reserves-.816)<.00001);
  assert.ok(Math.abs(twelve.satiety-.19)<.00001);assert.ok(Math.abs(twelve.reserves-.732)<.00001);
  assert.ok(Math.abs(twelve.sleepPressure-.51)<.00001);assert.equal(twelve.condition,1);assert.equal(twelve.mode,'awake');
  assert.ok(Math.abs(twentyFour.sleepPressure-.87)<.00001);assert.equal(twentyFour.condition,1);assert.equal(twentyFour.mode,'awake');
  assert.ok(twentyFour.fatigue>twelve.fatigue);assert.ok(bodyImpairment(twentyFour).taskScale<bodyImpairment(start).taskScale);
  assert.equal(circadianPhase(twentyFour),0);
});

test('gate freezes physiology and migration anchors to the actual current tick rather than simulating a past',()=>{
  const state=createBody(123456,30),next=step(state).state;
  assert.equal(next.satiety,state.satiety);assert.equal(next.reserves,state.reserves);assert.equal(next.sleepPressure,state.sleepPressure);
  assert.equal(next.circadianAnchorTick,123457);assert.equal(next.activationTick,123456);assert.equal(circadianPhase(next),circadianPhase(state));assert.deepEqual(bodyImpairment(next),{movementScale:1,headScale:1,taskScale:1,ordinaryAttentionScale:1});
  assert.throws(()=>advanceBody(next,{tick:next.lastIntegratedTick+2,hz:30,executed:{distanceMetres:0,taskProgress:0,headRadians:0},safetyPreempted:false,capableAtIntervalStart:true}),/consecutive/);
  assert.throws(()=>step(state,[],Infinity),/Invalid/);
});

test('intake promptly relieves satiety, gradually absorbs once, and restore preserves pending absorption exactly',()=>{
  let state=hours(createBody(0,1,true),12);
  const intake:PhysiologyEffect={sequence:1,type:'intake',satiety:.6,reserves:.25,absorptionSeconds:3600};
  const reserves=state.reserves;state=step(state,[intake]).state;
  assert.ok(state.satiety>.78);assert.ok(state.reserves-reserves<.001);assert.equal(state.absorption.length,1);
  const restored=validateBodyState(JSON.parse(JSON.stringify(state)),state.lastIntegratedTick,1);
  const originalFuture=hours(state,1),restoredFuture=hours(restored,1);
  assert.deepEqual(originalFuture,restoredFuture);assert.equal(originalFuture.absorption.length,0);
  assert.ok(originalFuture.reserves>reserves+.23);
  const duplicate=step(originalFuture,[intake]);assert.ok(duplicate.events.some(e=>e.type==='BODY_EFFECT_DUPLICATE'));
  assert.equal(duplicate.state.absorption.length,0);assert.ok(duplicate.state.satiety<=originalFuture.satiety);
  assert.throws(()=>step(state,[{...intake,sequence:3}]),/Nonconsecutive/);
});

test('rest and sleep differ, forced sleep recovers and wakes, and depletion remains recoverable',()=>{
  let tired=hours(createBody(0,1,true),24);
  const rested=hours(step(tired,[{sequence:1,type:'rest'}]).state,2);
  const slept=hours(step(tired,[{sequence:1,type:'sleep'}]).state,2);
  assert.ok(rested.sleepPressure<tired.sleepPressure-.015);
  assert.ok(slept.sleepPressure<rested.sleepPressure-.2);assert.ok(slept.fatigue<=rested.fatigue);
  tired=hours(tired,4);assert.equal(tired.mode,'asleep');
  const contradictory=step(tired,[{sequence:1,type:'wake'}]);assert.equal(contradictory.state.mode,'asleep');assert.ok(contradictory.events.some(e=>e.type==='BODY_EFFECT_REJECTED'));
  const recovered=hours(tired,8);assert.equal(recovered.mode,'awake');assert.ok(recovered.sleepPressure<.25);
  const starved=hours(createBody(0,1,true),130);assert.equal(starved.mode,'incapacitated');assert.ok(starved.condition>=.1);
  const fed=step(starved,[{sequence:1,type:'intake',satiety:1,reserves:1,absorptionSeconds:3600}]).state;
  const rescued=hours(fed,12);assert.ok(rescued.condition>.35);assert.notEqual(rescued.mode,'incapacitated');assert.ok(rescued.fatigue<.25);
});

test('ordered rest/sleep effects constrain execution before integration and remain once-only',()=>{
  const before=createBody(0,30,true),effect={sequence:1,type:'sleep'} as const;
  const ordered=applyAcceptedBodyEffect(before,effect,1);assert.equal(ordered.state.mode,'asleep');
  const integrated=step(ordered.state,[effect]);assert.equal(integrated.state.mode,'awake','low-pressure voluntary sleep can finish immediately');
  assert.equal(integrated.events.filter(e=>e.type==='BODY_EFFECT_DUPLICATE').length,1);assert.equal(integrated.state.lastEffectSequence,1);
  assert.equal(before.mode,'awake');assert.equal(before.lastEffectSequence,0);
});

test('activation is reversible and inactive intervals freeze stores, sleep recovery, absorption and circadian phase',()=>{
  let state=createBody(0,1,true);
  state=hours(state,1);state=step(state,[{sequence:1,type:'intake',satiety:.2,reserves:.4,absorptionSeconds:3600},{sequence:2,type:'sleep'},{sequence:3,type:'deactivate'}]).state;
  const stocks={satiety:state.satiety,reserves:state.reserves,sleepPressure:state.sleepPressure,condition:state.condition,fatigue:state.fatigue,absorption:state.absorption,phase:circadianPhase(state)};
  state=hours(state,24);
  assert.deepEqual({satiety:state.satiety,reserves:state.reserves,sleepPressure:state.sleepPressure,condition:state.condition,fatigue:state.fatigue,absorption:state.absorption,phase:circadianPhase(state)},stocks);
  validateBodyState(state,state.lastIntegratedTick,1);
  state=step(state,[{sequence:4,type:'activate'}]).state;assert.equal(state.active,true);assert.ok(state.absorption[0].secondsRemaining<3600);assert.ok(circadianPhase(state)>stocks.phase);
});

test('only actual activity incurs expenditure; deterministic fixed steps are scheduling independent',()=>{
  const state=createBody(0,30,true),idle=step(state).state,moved=step(state,[],.05).state;
  assert.ok(moved.reserves<idle.reserves);
  let single=state,batched=state;
  for(let i=0;i<900;i++)single=step(single).state;
  for(let batch=0;batch<30;batch++)for(let i=0;i<30;i++)batched=step(batched).state;
  assert.deepEqual(single,batched);
  assert.deepEqual(validateBodyState(single,single.lastIntegratedTick,30),single);
});

test('the two selected cross effects independently increase fatigue and rest reverses their bounded effects',()=>{
  const control=createBody(0,1,true);control.fatigue=.2;
  const lowReserve={...control,reserves:.1},sleepDebt={...control,sleepPressure:.8};
  const normal=hours(control,1),hungry=hours(lowReserve,1),sleepy=hours(sleepDebt,1);
  assert.ok(hungry.fatigue>normal.fatigue+.02);assert.ok(sleepy.fatigue>normal.fatigue+.01);
  assert.ok(hours(step(hungry,[{sequence:1,type:'rest'}]).state,2).fatigue<hungry.fatigue);
  assert.ok(hours(step(sleepy,[{sequence:1,type:'sleep'}]).state,2).fatigue<sleepy.fatigue);
});

test('complete validators reject corrupt, unsupported, extra and unbounded future state',()=>{
  const state=createBody(10,30,true);
  for(const patch of [{reserves:NaN},{sleepPressure:1.1},{condition:.05},{unknown:1},{rulesVersion:'future'},{circadianAnchorTick:11},{absorption:[{sequence:1,reservesRemaining:.4,secondsRemaining:Infinity}]}])assert.throws(()=>validateBodyState({...state,...patch},10,30),/Invalid/);
  assert.throws(()=>validatePhysiologyConfig({...state.config,urgentAttentionSeconds:1000}),/Invalid/);
  assert.throws(()=>validatePhysiologyConfig({...state.config,wakePressure:.99}),/Invalid/);
});
