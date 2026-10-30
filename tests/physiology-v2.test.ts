import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PhysiologySimulation,HistoricalPhysiologySimulation,validateCheckpoint,hashCheckpoint,type CheckpointV7,type CheckpointV6} from '../server/simulation.js';
import {createBody,createInteroception,upgradeInteroceptionV2,advanceBody,advanceInteroceptionV2} from '../server/physiology.js';
import {validateInteroceptionStateV2} from '../shared/physiology-protocol.js';
import {SeededRandom} from '../server/prng.js';
import {replay} from '../server/replay.js';

function fixture(fatigue:number,seed=1){const sim=new PhysiologySimulation({mode:'EXPERIMENT',seed,physiology:{active:true}}),cp=sim.checkpoint();cp.body.fatigue=fatigue;return cp;}
function restore(cp:CheckpointV7){return new PhysiologySimulation({mode:'EXPERIMENT',checkpoint:cp,historical:true});}
function steps(sim:PhysiologySimulation,count:number){const events=[];for(let i=0;i<count;i++)events.push(...sim.step());return events;}

test('v2 fatigue reduces actual collision-validated distance and task work, with expenditure based on executed work',t=>{
 const rested=restore(fixture(.05)),tired=restore(fixture(.95));for(const s of [rested,tired])s.applyAction({type:'activity-start',totalTicks:10000});
 const distance=(s:PhysiologySimulation)=>{let result=0;for(let i=0;i<600;i++){const a=s.state.character;s.step();const b=s.state.character;result+=Math.hypot(b.x-a.x,b.z-a.z);}return result;};
 const restedDistance=distance(rested),tiredDistance=distance(tired),a=rested.checkpoint(),b=tired.checkpoint();assert.ok(tiredDistance<restedDistance*.85);assert.ok(b.activity.cursor<a.activity.cursor*.65);assert.ok(a.body.reserves<b.body.reserves,'greater actual execution spends greater reserves');assert.equal(a.tick,b.tick);
 t.diagnostic(JSON.stringify({worldSeconds:a.tick/a.config.hz,restedDistance,tiredDistance,restedWork:a.activity.cursor,tiredWork:b.activity.cursor,restedReserve:a.body.reserves,tiredReserve:b.body.reserves}));
 const recovering=fixture(.95);recovering.pauseUntilTick=100000;recovering.body.mode='resting';recovering.body.config.restFatigueRecoveryPerSecond=.1;const recovered=restore(recovering);steps(recovered,300);assert.equal(recovered.bodyState().fatigue,0);const restart=recovered.checkpoint();restart.pauseUntilTick=restart.tick;const moving=restore(restart),before=moving.state.character;moving.step();const after=moving.state.character;assert.ok(Math.hypot(after.x-before.x,after.z-before.z)>.024,'restored rested movement recovers toward 0.75m/s');
});

test('v2 fractional task credit survives pause, sleep and restore, resets only for a new activity and never duplicates milestones',()=>{
 const cp=fixture(.95);cp.pauseUntilTick=100000;cp.body.sleepPressure=.3;const sim=restore(cp);sim.applyAction({type:'activity-start',totalTicks:30});sim.step();const credit=sim.checkpoint().physiology.taskCredit;assert.ok(credit>0&&credit<1);assert.equal(sim.checkpoint().activity.cursor,0);
 sim.applyAction({type:'activity-pause'});steps(sim,10);assert.equal(sim.checkpoint().physiology.taskCredit,credit);sim.enqueue({type:'physiology_fixture',effect:{sequence:1,type:'sleep'}});steps(sim,10);assert.equal(sim.checkpoint().physiology.taskCredit,credit);const slept=sim.checkpoint();slept.body.sleepPressure=.19;const a=restore(slept),b=restore(slept);
 for(const s of [a,b]){s.enqueue({type:'physiology_fixture',effect:{sequence:2,type:'wake'}});s.applyAction({type:'activity-resume'});}assert.deepEqual(steps(a,100),steps(b,100));assert.equal(hashCheckpoint(a.checkpoint()),hashCheckpoint(b.checkpoint()));assert.equal(a.checkpoint().activity.completionCount,1);assert.deepEqual(a.checkpoint().activity.appliedMilestones,[10,20,30]);a.applyAction({type:'activity-start',totalTicks:10});assert.equal(a.checkpoint().physiology.taskCredit,0);assert.equal(a.checkpoint().physiology.taskCreditActivityId,a.checkpoint().activity.activityId);
 const corrupt=a.checkpoint();corrupt.physiology.taskCreditActivityId--;assert.throws(()=>validateCheckpoint(corrupt),/task credit association/);
});

test('v2 idle moderate sleepiness remains noticeable below severe pressure despite fatigue, without a blanket attention cutoff',t=>{
 const delays=[];for(let seed=1;seed<=32;seed++){const cp=fixture(.8,seed);cp.body.sleepPressure=.74;cp.pauseUntilTick=100000;const sim=restore(cp);let first:number|null=null;for(let i=0;i<1800;i++){const e=sim.step().find(e=>e.type==='INTERNAL_ATTENDED'&&e.data.kind==='sleep'&&e.data.band==='moderate');if(e){first=e.tick;break;}}assert.notEqual(first,null,`seed ${seed} never attended moderate sleepiness`);assert.equal(sim.checkpoint().interoception.slots[1].urgent,null);delays.push(first!/cp.config.hz);}
 t.diagnostic(JSON.stringify({seeds:delays.length,firstAttentionSeconds:delays,min:Math.min(...delays),max:Math.max(...delays)}));
});

test('v2 noise is bounded, seeded and sampled at a fixed cadence; severe truth and urgent delivery never depend on noise or ordinary lapses',()=>{
 const seen=new Set<string>();for(let seed=1;seed<=32;seed++){
  let body=createBody(0,1,true);body.satiety=.55;body.sleepPressure=.449;body.fatigue=0;let internal=upgradeInteroceptionV2(createInteroception(),seed,1);const initialRng=internal.sampling.state;const expected=new SeededRandom(initialRng,initialRng);for(let i=0;i<6;i++)expected.next();
  for(let tick=1;tick<=25;tick++){body=advanceBody(body,{tick,hz:1,executed:{distanceMetres:0,taskProgress:0,headRadians:0},safetyPreempted:false,capableAtIntervalStart:true}).state;internal=advanceInteroceptionV2(internal,body,{tick,hz:1,safetyPreempted:false,capableAtIntervalStart:true,ordinaryAttentionAllowed:true,ordinaryAttentionScale:1}).state;if(tick<5)assert.equal(internal.sampling.state,initialRng);if(tick===5)assert.equal(internal.sampling.state,expected.state);if(tick%5===0)seen.add(String(internal.slots[0].sampledBand));}
  assert.equal(internal.sampling.nextSampleTick,30);validateInteroceptionStateV2(internal,25,1,body.config);
 }
 assert.deepEqual(seen,new Set(['mild','null']));
 // A positive ordinary-noise excursion cannot manufacture a severe urgent need.
 let body=createBody(0,1,true);body.satiety=.12;let internal=upgradeInteroceptionV2(createInteroception(),7,1);for(let tick=1;tick<=10;tick++){body=advanceBody(body,{tick,hz:1,executed:{distanceMetres:0,taskProgress:0,headRadians:0},safetyPreempted:false,capableAtIntervalStart:true}).state;internal=advanceInteroceptionV2(internal,body,{tick,hz:1,safetyPreempted:false,capableAtIntervalStart:true,ordinaryAttentionAllowed:false,ordinaryAttentionScale:.4}).state;}assert.equal(internal.slots[0].urgent,null);assert.notEqual(internal.slots[0].sampledBand,'severe');
 for(const seed of [1,2,7,99]){let body=createBody(0,1,true);body.satiety=.07;body.fatigue=.95;let s=upgradeInteroceptionV2(createInteroception(),seed,1);for(let tick=1;tick<=30;tick++){body=advanceBody(body,{tick,hz:1,executed:{distanceMetres:0,taskProgress:0,headRadians:0},safetyPreempted:false,capableAtIntervalStart:true}).state;s=advanceInteroceptionV2(s,body,{tick,hz:1,safetyPreempted:false,capableAtIntervalStart:true,ordinaryAttentionAllowed:false,ordinaryAttentionScale:.4}).state;}assert.equal(s.slots[0].urgent!.crossingTick,1);assert.equal(s.slots[0].urgent!.firstAttendedTick,30);assert.equal(s.slots[0].urgent!.breachTick,null);}
});

test('v2 inactive/asleep intervals consume no sensor draws, wake takes one sample without catchup, and pending stochastic state restores exactly',()=>{
 const cp=fixture(.8,81);cp.body.sleepPressure=.74;cp.pauseUntilTick=100000;const sim=restore(cp);steps(sim,153);const saved=sim.checkpoint(),copy=restore(saved);assert.deepEqual(steps(sim,600),steps(copy,600));assert.equal(hashCheckpoint(sim.checkpoint()),hashCheckpoint(copy.checkpoint()));
 const off=restore({...saved,body:{...saved.body,active:false}}),rng=saved.interoception.sampling.state;steps(off,300);assert.equal(off.checkpoint().interoception.sampling.state,rng);const asleep=structuredClone(saved);asleep.body.mode='asleep';asleep.body.modeSinceTick=asleep.tick;asleep.physiology.unconsciousWindows.push({startTick:asleep.tick,endTick:null});const sleeping=restore(asleep);steps(sleeping,300);assert.equal(sleeping.checkpoint().interoception.sampling.state,rng);const waking=sleeping.checkpoint();waking.body.sleepPressure=.19;const awake=restore(waking),expected=new SeededRandom(rng,rng);for(let i=0;i<6;i++)expected.next();awake.enqueue({type:'physiology_fixture',effect:{sequence:1,type:'wake'}});awake.step();assert.equal(awake.checkpoint().interoception.sampling.state,expected.state);assert.equal(awake.checkpoint().interoception.sampling.nextSampleTick,awake.state.tick+150);
});

test('CP6/v1 frozen historical fixture exactly replays; active migration adds only new state without resetting old cues/body/provenance',async()=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/physiology-v1-replay.json',import.meta.url),'utf8'));const historical=replay(fixture.start,fixture.inputs,fixture.endTick);assert.equal(historical.stateHash,fixture.stateHash);assert.equal(historical.eventHash,fixture.eventHash);assert.deepEqual(historical.checkpoint,fixture.expected);assert.equal(historical.checkpoint.schemaVersion,6);
 const old=new HistoricalPhysiologySimulation({checkpoint:fixture.start,mode:'EXPERIMENT'});assert.equal(old.checkpoint().schemaVersion,6);const source=old.checkpoint() as CheckpointV6,c=source.cognition.identity;
 const migrated=new PhysiologySimulation({checkpoint:source,mode:'EXPERIMENT',worldId:c.worldId,runId:c.runId,branchId:c.branchId,historyId:c.historyId}).checkpoint();assert.equal(migrated.schemaVersion,7);assert.deepEqual(migrated.body,source.body);assert.deepEqual(migrated.internalExperiences,source.internalExperiences);assert.deepEqual(migrated.interoception.transient,source.interoception.transient);assert.deepEqual(migrated.interoception.slots.map(({sampledBand,...s})=>{void sampledBand;return s;}),source.interoception.slots);const {taskCredit,taskCreditActivityId,...previous}=migrated.physiology;assert.equal(taskCredit,0);assert.equal(taskCreditActivityId,source.activity.activityId);assert.deepEqual(previous,source.physiology);assert.equal(migrated.interoception.sampling.nextSampleTick,source.tick+150);assert.doesNotThrow(()=>validateCheckpoint(migrated));
});


test('v2 every-tick snapshots retain mistaken ordinary evidence separately from truth and preserve the subsequent true urgent deadline',()=>{
 const cp=fixture(0,5);cp.config.hz=1;cp.body.hz=1;cp.body.satiety=.53;cp.body.config.satietyUsePerSecond=.002;cp.interoception.sampling.state=1;cp.interoception.sampling.nextSampleTick=5;cp.pauseUntilTick=100000;const sim=restore(cp);sim.applyAction({type:'activity-start',totalTicks:10000});let mistakenCandidate=false,crossing:number|null=null,first:number|null=null,severeObservation:string|null=null;const observations=new Map<string,{band:string;tick:number}>();
 for(let tick=1;tick<=250;tick++){
  const events=sim.step(),snapshot=sim.checkpoint();assert.doesNotThrow(()=>validateCheckpoint(snapshot));assert.deepEqual(restore(snapshot).checkpoint(),snapshot);const slot=snapshot.interoception.slots[0];if(tick===5){assert.equal(slot.band,'mild');assert.equal(slot.sampledBand,null);assert.equal(slot.candidate,null);}
  if(slot.candidate&&slot.candidate.band!==slot.band)mistakenCandidate=true;
  for(const e of events)if(e.type==='INTERNAL_SENSED')observations.set(String(e.data.observationId),{band:String(e.data.band),tick:e.tick});for(const e of events)if(e.type==='INTERNAL_ATTENDED'){const sensed=observations.get(String(e.data.observationId));assert.ok(sensed);assert.equal(sensed.band,e.data.band);assert.ok(sensed.tick<=e.tick);}
  const crossed=events.find(e=>e.type==='INTERNAL_URGENT_CROSSED'&&e.data.kind==='hunger');if(crossed){crossing=crossed.tick;const sensed=events.find(e=>e.type==='INTERNAL_SENSED'&&e.data.kind==='hunger'&&e.data.band==='severe');assert.ok(sensed);severeObservation=String(sensed.data.observationId);}const attended=events.find(e=>e.type==='INTERNAL_ATTENDED'&&e.data.kind==='hunger'&&e.data.forced===true);if(attended){first=attended.tick;assert.equal(attended.data.observationId,severeObservation);assert.equal(observations.get(severeObservation!)!.tick,crossing);}
 }
 assert.ok(mistakenCandidate,'a noisy ordinary candidate should sometimes differ from the private truth band');assert.notEqual(crossing,null);assert.equal(first!-crossing!,29);assert.equal(sim.checkpoint().interoception.slots[0].urgent!.crossingTick,crossing);assert.equal(sim.checkpoint().interoception.slots[0].urgent!.breachTick,null);
});
