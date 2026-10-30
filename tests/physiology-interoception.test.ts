import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceBody, advanceInteroception, applyAcceptedBodyEffect, bodyCapability, createBody, createInteroception, presentInternalSensations, providerInternalSensations } from '../server/physiology.js';
import { validateInteroceptionState, validateInternalSensation, type BodyState, type InteroceptionState } from '../shared/physiology-protocol.js';

function step(body:BodyState,senses:InteroceptionState,options:{safety?:boolean;capable?:boolean;ordinary?:boolean}={}) {
  const tick=body.lastIntegratedTick+1,hz=body.hz,capableAtIntervalStart=options.capable??bodyCapability(body).canAttend;
  body=advanceBody(body,{tick,hz,executed:{distanceMetres:0,taskProgress:0,headRadians:0},safetyPreempted:options.safety??false,capableAtIntervalStart}).state;
  const result=advanceInteroception(senses,body,{tick,hz,safetyPreempted:options.safety??false,capableAtIntervalStart,ordinaryAttentionAllowed:options.ordinary??false});
  return {body,senses:result.state,events:result.events,attended:result.attended};
}

test('mild cues may be ignored and present attention is separately available without any memory or model operation',()=>{
  const body=createBody(0,1,true);body.satiety=.5;
  let result=step(body,createInteroception());assert.equal(result.attended.length,0);assert.ok(result.events.some(e=>e.type==='INTERNAL_IGNORED'));
  result=step(result.body,result.senses,{ordinary:true});assert.equal(result.attended.length,1);
  const percept=presentInternalSensations(result.senses,true)[0];assert.equal(percept.band,'mild');assert.equal(percept.description,'My stomach feels a little empty.');
  assert.deepEqual(Object.keys(percept).sort(),['observationId','attentionId','kind','band','description','uncertainty','provenance'].sort());
  assert.equal(JSON.stringify(percept).includes('satiety'),false);assert.equal(JSON.stringify(percept).includes('tick'),false);
  assert.deepEqual(Object.keys(providerInternalSensations(result.senses,true)[0]).sort(),['kind','band','description','uncertainty'].sort());
  assert.deepEqual(providerInternalSensations(result.senses,false),[]);assert.deepEqual(presentInternalSensations(result.senses,false),[]);
  assert.deepEqual(validateInternalSensation(percept),percept);assert.throws(()=>validateInternalSensation({...percept,reserves:.1}),/Invalid/);
});

test('all three severe essential needs override focus one fixed step before the maximum deadline, without providers or encoding',()=>{
  const body=createBody(0,1,true);body.satiety=.05;body.sleepPressure=.8;body.condition=.29;
  let result=step(body,createInteroception());const crossing=result.senses.slots.map(s=>s.urgent!.crossingTick);
  for(let i=0;i<28;i++){result=step(result.body,result.senses);assert.equal(result.attended.length,0);}
  result=step(result.body,result.senses);assert.equal(result.attended.length,3);
  assert.deepEqual(result.senses.slots.map(s=>s.urgent!.crossingTick),crossing);
  assert.ok(result.senses.slots.every(s=>s.urgent!.eligibleTicks===29&&s.urgent!.firstAttendedTick===30&&s.urgent!.breachTick===null));
  assert.equal(result.events.filter(e=>e.type==='INTERNAL_ATTENDED').length,3);
  validateInteroceptionState(result.senses,result.body.lastIntegratedTick,1,result.body.config);
});

test('hazard and incapacity exclusions, retries, coalescing and restore preserve the original deadline',()=>{
  const body=createBody(0,1,true);body.satiety=.05;
  let result=step(body,createInteroception());
  for(let i=0;i<10;i++)result=step(result.body,result.senses);
  for(let i=0;i<20;i++)result=step(result.body,result.senses,{safety:true});
  for(let i=0;i<15;i++)result=step(result.body,result.senses,{capable:false});
  const before=result.senses.slots[0].urgent!;assert.equal(before.crossingTick,1);assert.equal(before.eligibleTicks,10);assert.equal(before.excludedSafetyTicks,20);assert.equal(before.excludedIncapacityTicks,15);assert.ok(before.retries>0);
  const restored=validateInteroceptionState(JSON.parse(JSON.stringify(result.senses)),result.body.lastIntegratedTick,1,result.body.config);
  let control=result,copy={...result,senses:restored};
  for(let i=0;i<19;i++){control=step(control.body,control.senses);copy=step(copy.body,copy.senses);}
  assert.deepEqual(copy,control);assert.equal(copy.attended.length,1);
  const event=copy.events.find(e=>e.type==='INTERNAL_ATTENDED')!;assert.equal(event.data.elapsedWorldSeconds,64);assert.equal(event.data.eligibleSeconds,29);assert.equal(event.data.excludedSafetySeconds,20);assert.equal(event.data.excludedIncapacitySeconds,15);
});

test('sleeping sensors never manufacture observations and pending needs deliver after capability returns',()=>{
  const body=createBody(0,1,true);body.satiety=.05;body.mode='asleep';body.sleepPressure=.8;
  let result=step(body,createInteroception());
  for(let i=0;i<40;i++)result=step(result.body,result.senses,{ordinary:true});
  assert.equal(result.senses.nextObservationId,1);assert.equal(result.senses.transient.length,0);assert.equal(result.senses.slots[0].urgent!.excludedIncapacityTicks,40);
  result.body.mode='awake';result=step(result.body,result.senses,{ordinary:true});assert.ok(result.attended.some(p=>p.kind==='hunger'));assert.equal(result.senses.slots[0].urgent!.crossingTick,1);
});

test('repeated cue coalescing during a prolonged hazard retains elapsed and excluded world time',()=>{
  const body=createBody(0,1,true);body.satiety=.05;
  let result=step(body,createInteroception());
  for(let i=0;i<650;i++)result=step(result.body,result.senses,{safety:true});
  assert.equal(result.senses.slots[0].urgent!.crossingTick,1);assert.equal(result.senses.slots[0].urgent!.excludedSafetyTicks,650);
  assert.equal(result.senses.nextObservationId,4,'two cooldown replacements coalesce into the same bounded slot');
  for(let i=0;i<29;i++)result=step(result.body,result.senses);
  assert.equal(result.attended.length,1);assert.equal(result.senses.slots[0].urgent!.firstAttendedTick,680);
  assert.equal(result.events.find(e=>e.type==='INTERNAL_ATTENDED')!.data.elapsedWorldSeconds,679);
});

test('administrative deactivation preserves pending urgency and reports inactive time separately across restore',()=>{
  const body=createBody(0,1,true);body.satiety=.05;
  let result=step(body,createInteroception());
  for(let i=0;i<28;i++)result=step(result.body,result.senses);
  result.body=applyAcceptedBodyEffect(result.body,{sequence:1,type:'deactivate'}).state;
  for(let i=0;i<300;i++)result=step(result.body,result.senses);
  assert.equal(result.senses.slots[0].urgent!.crossingTick,1);assert.equal(result.senses.slots[0].urgent!.eligibleTicks,28);assert.equal(result.senses.slots[0].urgent!.excludedInactiveTicks,300);
  assert.deepEqual(providerInternalSensations(result.senses,result.body.active),[]);
  result.senses=validateInteroceptionState(JSON.parse(JSON.stringify(result.senses)),result.body.lastIntegratedTick,1,result.body.config);
  result.body=applyAcceptedBodyEffect(result.body,{sequence:2,type:'activate'}).state;
  result=step(result.body,result.senses);assert.equal(result.attended.length,1);
  const event=result.events.find(e=>e.type==='INTERNAL_ATTENDED')!;assert.equal(event.data.elapsedWorldSeconds,329);assert.equal(event.data.eligibleSeconds,29);assert.equal(event.data.excludedInactiveSeconds,300);
});

test('the last awake interval counts, unconscious endpoints cannot attend, and a wake endpoint delivers an already due cue',()=>{
  const body=createBody(0,1,true);body.satiety=.05;
  let result=step(body,createInteroception());
  for(let i=0;i<28;i++)result=step(result.body,result.senses);
  assert.equal(result.senses.slots[0].urgent!.eligibleTicks,28);
  result.body.sleepPressure=result.body.config.forcedSleepPressure-result.body.config.awakePressurePerSecond/2;
  result=step(result.body,result.senses);
  assert.equal(result.body.mode,'asleep');assert.equal(result.attended.length,0);
  assert.equal(result.senses.slots[0].urgent!.eligibleTicks,29);assert.equal(result.senses.slots[0].urgent!.excludedIncapacityTicks,0);
  assert.equal(result.events.some(e=>e.type==='INTERNAL_SENSED'||e.type==='INTERNAL_ATTENDED'),false,'no new observation or attention is manufactured after the hard sleep endpoint');
  result=step(result.body,result.senses);
  assert.equal(result.senses.slots[0].urgent!.excludedIncapacityTicks,1);assert.equal(result.attended.length,0);
  result.senses=validateInteroceptionState(JSON.parse(JSON.stringify(result.senses)),result.body.lastIntegratedTick,1,result.body.config);
  result.body.sleepPressure=result.body.config.wakePressure+result.body.config.sleepPressureRecoveryPerSecond/2;
  result=step(result.body,result.senses);
  assert.equal(result.body.mode,'awake');assert.ok(result.attended.some(p=>p.kind==='hunger'));
  const urgent=result.senses.slots[0].urgent!;assert.equal(urgent.crossingTick,1);assert.equal(urgent.eligibleTicks,29);assert.equal(urgent.excludedIncapacityTicks,2);assert.equal(urgent.breachTick,null);
  const event=result.events.find(e=>e.type==='INTERNAL_ATTENDED'&&e.data.kind==='hunger')!;
  assert.equal(event.data.elapsedWorldSeconds,31);assert.equal(event.data.eligibleSeconds,29);assert.equal(event.data.excludedIncapacitySeconds,2);
});

test('a hazard at the one-step guard defers attention without spending eligible time or breaching the deadline',()=>{
  const body=createBody(0,1,true);body.satiety=.05;
  let result=step(body,createInteroception());
  for(let i=0;i<28;i++)result=step(result.body,result.senses);
  result=step(result.body,result.senses,{safety:true});
  assert.equal(result.attended.length,0);assert.equal(result.senses.slots[0].urgent!.eligibleTicks,28);assert.equal(result.senses.slots[0].urgent!.excludedSafetyTicks,1);
  result=step(result.body,result.senses);
  assert.equal(result.attended.length,1);assert.equal(result.senses.slots[0].urgent!.eligibleTicks,29);assert.equal(result.senses.slots[0].urgent!.breachTick,null);
  assert.equal(result.events.find(e=>e.type==='INTERNAL_ATTENDED')!.data.elapsedWorldSeconds,30);
});

test('the one-step guard attends before a hard sleep transition tied to the 30-second maximum',()=>{
  const body=createBody(0,1,true);body.satiety=.05;
  body.sleepPressure=body.config.forcedSleepPressure-30.5*body.config.awakePressurePerSecond;
  let result=step(body,createInteroception());
  for(let i=0;i<28;i++)result=step(result.body,result.senses);
  result=step(result.body,result.senses);
  assert.equal(result.body.mode,'awake');assert.ok(result.attended.some(p=>p.kind==='hunger'));
  assert.equal(result.senses.slots[0].urgent!.firstAttendedTick,30);
  result=step(result.body,result.senses);
  assert.equal(result.body.mode,'asleep');assert.equal(result.senses.slots[0].urgent!.breachTick,null);assert.equal(result.attended.length,0);
});

test('the deadline guard uses the configured fixed rate at 1 Hz and 30 Hz',()=>{
  for(const hz of [1,30]) {
    const body=createBody(0,hz,true);body.satiety=.05;
    let result=step(body,createInteroception());
    const forceAt=Math.ceil(body.config.urgentAttentionSeconds*hz)-1;
    for(let i=0;i<forceAt-1;i++){result=step(result.body,result.senses);assert.equal(result.attended.length,0);}
    result=step(result.body,result.senses);
    assert.equal(result.attended.length,1);assert.equal(result.senses.slots[0].urgent!.eligibleTicks,forceAt);
    assert.equal(result.events.find(e=>e.type==='INTERNAL_ATTENDED')!.data.eligibleSeconds,30-1/hz);
    assert.equal(result.senses.slots[0].urgent!.breachTick,null);
  }
});

test('persistent signals and transients stay bounded over long focused deferral and repeated ordinary attention',()=>{
  const body=createBody(0,1,true);body.satiety=.05;
  let result=step(body,createInteroception());
  for(let i=0;i<4000;i++)result=step(result.body,result.senses,{ordinary:true});
  assert.equal(result.senses.slots.length,3);assert.ok(result.senses.transient.length<=3);assert.ok(JSON.stringify(result.senses).length<6000);
  assert.ok(result.senses.nextObservationId<40);assert.equal(result.senses.slots[0].urgent!.crossingTick,1);
  validateInteroceptionState(result.senses,result.body.lastIntegratedTick,1,result.body.config);
  assert.throws(()=>validateInteroceptionState({...result.senses,hidden:1},result.body.lastIntegratedTick,1),/Invalid/);
  const corrupt=structuredClone(result.senses);corrupt.slots[0].urgent!.crossingTick=result.body.lastIntegratedTick+1;
  assert.throws(()=>validateInteroceptionState(corrupt,result.body.lastIntegratedTick,1),/Invalid/);
});
