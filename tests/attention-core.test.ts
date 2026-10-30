import test from 'node:test';
import assert from 'node:assert/strict';
import { SensorySimulation, Simulation, VisionSimulation, validateCheckpoint, type DeterministicEvent, type OrderedInput } from '../server/simulation.js';
import { propagateSound } from '../server/hearing.js';
import { DEFAULT_ATTENTION_CONFIG, type SensorFeedbackCommand, type SensorPose } from '../shared/attention-protocol.js';
import { eyePose } from '../shared/eye-pose.js';
import { replay } from '../server/replay.js';
import { hashCanonical } from '../server/canonical.js';
import { BranchRuntime, hashRuntimeCheckpoint } from '../server/branch-runtime.js';
import { mkdtemp,rm } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportIncident,replayBundle,inspectBundle} from '../server/diagnostics/bundle.js';
import {strFromU8} from 'fflate';
import {CaptureManager} from '../server/vision/capture-manager.js';
import type {HeadAction} from '../shared/vision-protocol.js';

const source={x:-1.6,y:2.5,z:2.8,intensity:1,suddenness:1,sourceId:'private-a'};
const fixed=()=>{
  const cp=new SensorySimulation({mode:'EXPERIMENT'}).checkpoint();cp.character.heading=0;cp.character.moving=false;cp.pauseUntilTick=100000;
  return new SensorySimulation({mode:'EXPERIMENT',checkpoint:cp});
};
const pose=(s:SensorySimulation):SensorPose=>{const p=eyePose(s.snapshot());return {x:p.position[0],y:p.position[1],z:p.position[2],bodyHeading:p.bodyHeading,headYaw:p.headYaw,headPitch:p.headPitch};};
const steps=(s:SensorySimulation,n:number)=>Array.from({length:n},()=>s.step()).flat();
const emit=(s:SensorySimulation,overrides:Partial<typeof source>={})=>{s.enqueue({type:'emit_sound',...source,...overrides});return s.step();};
function submitted(s:SensorySimulation,id='capture-one'):SensorFeedbackCommand {
  const cp=s.checkpoint();assert.ok(cp.attention.pending);
  return {type:'sensor_feedback',intentId:cp.attention.pending.id,stage:'admitted',captureId:id,capturedTick:cp.tick,sceneRevision:cp.scene.revision,pose:pose(s),outcome:'success',signature:null,frameHash:null};
}
function result(s:SensorySimulation,signature:number[],id='capture-one'):SensorFeedbackCommand {
  const admitted=submitted(s,id);s.enqueue(admitted);s.step();return {...admitted,stage:'result',signature,frameHash:'a'.repeat(64)};
}

test('2b-1 received hearing attenuates distance and actual posed walls/door once, including behind',()=>{
  const sim=fixed(),snapshot=sim.snapshot(),cfg=DEFAULT_ATTENTION_CONFIG;
  const near=propagateSound(source,snapshot,'near',cfg),far=propagateSound({...source,z:-3},snapshot,'far',cfg);
  assert.ok(near.received.intensity>far.received.intensity);assert.equal(far.received.bearingDegrees,180);
  assert.ok(far.received.directionUncertaintyDegrees>near.received.directionUncertaintyDegrees);
  const doorway=structuredClone(snapshot);doorway.character.x=2.97;doorway.character.z=-1.5;doorway.scene!.doorOpenRadians=0;
  const outside={...source,x:2.97,z:-4.3};
  const shut=propagateSound(outside,doorway,'shut',cfg);assert.deepEqual(shut.barriers,['door-leaf']);
  doorway.scene!.doorOpenRadians=Math.PI/2;
  const open=propagateSound(outside,doorway,'open',cfg);assert.equal(open.barriers.length,0);assert.ok(open.received.intensity>shut.received.intensity);
  doorway.character.x=0;
  const wall=propagateSound({...outside,x:0},doorway,'wall',cfg);assert.deepEqual(wall.barriers,['wall-back-left']);
  const front=structuredClone(snapshot);front.character.z=1.5;
  const cutaway=propagateSound({...source,z:4.4},front,'cutaway',cfg);assert.deepEqual(cutaway.barriers,['wall-front']);
  const surface=propagateSound({...source,x:0,z:-3.6},doorway,'surface',cfg);assert.deepEqual(surface.barriers,[]);
  assert.ok(shut.received.directionUncertaintyDegrees>open.received.directionUncertaintyDegrees);
});

test('2b-1 zero/quiet/invalid sound stays finite and never fabricates direction or source identity',()=>{
  const sim=fixed(),snapshot=sim.snapshot(),eye=eyePose(snapshot).position;
  const zero=propagateSound({...source,x:eye[0],y:eye[1],z:eye[2]},snapshot,'zero',DEFAULT_ATTENTION_CONFIG);
  assert.equal(zero.received.bearingDegrees,null);assert.equal(zero.received.directionUncertaintyDegrees,180);assert.equal(zero.received.intensity,1);
  const quiet=propagateSound({...source,intensity:.001},snapshot,'quiet',DEFAULT_ATTENTION_CONFIG);assert.equal(quiet.received.bearingDegrees,null);assert.equal(quiet.received.distanceBand,'unknown');
  assert.throws(()=>propagateSound({...source,x:NaN},snapshot,'invalid',DEFAULT_ATTENTION_CONFIG),/Invalid/);
  assert.throws(()=>propagateSound({...source,sourceId:''},snapshot,'unknown',DEFAULT_ATTENTION_CONFIG),/unknown/);
  assert.throws(()=>sim.enqueue({type:'emit_sound',...source,intensity:Infinity}),/Invalid/);
  assert.deepEqual(Object.keys(zero.received).sort(),['observationId','tick','intensity','suddenness','bearingDegrees','directionUncertaintyDegrees','distanceBand','distanceUncertainty','bodyHeading','headYaw','provenance'].sort());
  assert.equal(JSON.stringify(zero.received).includes('private-a'),false);
});

test('2b-1 a segmented back-wall seam has one material loss, matching either epsilon-offset side',()=>{
  const snapshot=fixed().snapshot(),seamX=-1.275+6.65/2;snapshot.character.x=seamX;snapshot.character.z=-1.5;
  const at=(offset:number)=>{const s=structuredClone(snapshot);s.character.x+=offset;return propagateSound({...source,x:seamX+offset,y:3.6,z:-4.3},s,'seam',DEFAULT_ATTENTION_CONFIG);};
  const seam=at(0),left=at(-.001),right=at(.001);
  assert.ok(seam.barriers.length>1);assert.deepEqual(seam.barrierGroups,['wall-back']);assert.equal(seam.transmission,DEFAULT_ATTENTION_CONFIG.wallTransmission);
  assert.equal(seam.received.intensity,left.received.intensity);assert.equal(seam.received.intensity,right.received.intensity);assert.equal(seam.received.directionUncertaintyDegrees,right.received.directionUncertaintyDegrees);
  const along=structuredClone(snapshot);along.character.x=2.5;
  const self=propagateSound({...source,x:2.049,y:3.1,z:-3.6},along,'surface-seam',DEFAULT_ATTENTION_CONFIG);
  assert.equal(self.transmission,1);assert.deepEqual(self.barriers,[],'one emitting wall group never muffles against its adjacent primitive');
});

test('2b-1 sound records pre-movement listener pose and reflex at the emission tick without renderer',()=>{
  const sim=new SensorySimulation({mode:'EXPERIMENT'}),before=sim.snapshot();
  const events=emit(sim),prop=events.find(e=>e.type==='ACOUSTIC_PROPAGATION')!,reflex=events.find(e=>e.type==='REFLEX_STATE')!;
  const reception=structuredClone(before);reception.tick=1;reception.time=1/30;
  assert.equal(prop.data.listenerX,eyePose(reception).position[0]);assert.equal(prop.data.listenerZ,eyePose(reception).position[2]);
  assert.equal(reflex.tick,1);assert.equal(sim.checkpoint().reflex.startTick,1);assert.notEqual(sim.snapshot().character.z,before.character.z);
  assert.equal(events.find(e=>e.type==='SOUND_RECEIVED')!.parentSequence,prop.sequence);
  assert.equal(sim.checkpoint().experiences.length,0);
  const live=new SensorySimulation({mode:'LIVE'});assert.ok(emit(live).some(e=>e.outcome==='rejected'));assert.equal(live.checkpoint().genericSoundCount,0);
});

test('2b-2 perceptual repetition habituates independently of private IDs; change and recovery renew attention',()=>{
  const sim=fixed(),outcomes:string[]=[];
  for(let i=0;i<5;i++){emit(sim,{sourceId:`private-${i}`});outcomes.push(sim.attentionState().lastDecision!.outcome);steps(sim,99);}
  assert.notEqual(outcomes[0],'ignored');assert.equal(outcomes.at(-1),'ignored');
  emit(sim,{intensity:.65});assert.notEqual(sim.attentionState().lastDecision!.outcome,'ignored');
  steps(sim,950);emit(sim);assert.notEqual(sim.attentionState().lastDecision!.outcome,'ignored');
  const a=fixed(),b=fixed();emit(a,{sourceId:'one'});emit(b,{sourceId:'two'});
  assert.deepEqual(a.attentionState(),b.attentionState());
});

test('inaudible cues leave exposure history unchanged and cannot suppress a later audible cue',()=>{
  const sim=fixed(),control=fixed(),eye=eyePose(sim.snapshot()).position;
  const cue={x:eye[0],y:eye[1],z:eye[2],intensity:.001};
  for(let i=0;i<12;i++) {
    const events=emit(sim,{...cue,sourceId:`silent-${i}`});control.step();
    assert.ok(events.some(e=>e.type==='SOUND_RECEIVED'&&e.outcome==='below_floor'));
    assert.equal(sim.attentionState().lastDecision!.reason,'below_hearing_floor');
    assert.deepEqual(sim.attentionState().exposures,[]);
  }
  emit(sim,{...cue,intensity:.02});emit(control,{...cue,intensity:.02});
  const {observationId:actualId,...actual}=sim.attentionState().lastDecision!;
  const {observationId:controlId,...expected}=control.attentionState().lastDecision!;
  assert.notEqual(actualId,controlId);assert.deepEqual(actual,expected);
  assert.equal(actual.outcome,'unreachable');assert.equal(actual.reason,'direction_undefined');
  assert.deepEqual(sim.attentionState().exposures,control.attentionState().exposures);
  assert.deepEqual(sim.attentionState().pending!.reasons,['salient_sound']);
  // Even expired entries must survive an inaudible cue unchanged; pruning and
  // bounded-history eviction belong to audible perception only.
  const checkpoint=sim.checkpoint();checkpoint.tick+=1000;
  const aged=new SensorySimulation({mode:'EXPERIMENT',checkpoint});
  const history=aged.attentionState().exposures;emit(aged,cue);
  assert.deepEqual(aged.attentionState().exposures,history);
  assert.equal(sim.checkpoint().experiences.length,0);
});

test('2b-2 commitment/cooldown prevents thrash and activity resumes without repeated effects',()=>{
  const sim=fixed();sim.applyAction({type:'activity-start',totalTicks:80});
  const events:DeterministicEvent[]=[];
  for(let i=0;i<160;i++){if(i<90)sim.enqueue({type:'emit_sound',...source,sourceId:`s-${i}`});events.push(...sim.step());}
  assert.equal(events.filter(e=>e.type==='HEAD_ACTION_STARTED').length,1);
  assert.equal(sim.checkpoint().activity.status,'complete');assert.equal(sim.checkpoint().activity.completionCount,1);
  assert.equal(new Set(events.filter(e=>e.type==='ACTIVITY_EFFECT').map(e=>e.data.cursor)).size,8);
  assert.equal(events.filter(e=>e.type==='ACTIVITY_ATTENTION_PAUSED').length,1);assert.equal(events.filter(e=>e.type==='ACTIVITY_ATTENTION_RESUMED').length,1);
  assert.ok(events.filter(e=>e.type==='REFLEX_STATE').length>50,'reflex remains immediate during habituation');
});

test('manual activity pause during attention releases its hold without a false resume or changed cursor',()=>{
  const sim=fixed();sim.applyAction({type:'activity-start',totalTicks:80});emit(sim);steps(sim,3);
  sim.applyAction({type:'activity-pause'});const cursor=sim.checkpoint().activity.cursor,events=steps(sim,70);
  assert.equal(sim.checkpoint().activity.status,'paused');assert.equal(sim.checkpoint().activity.cursor,cursor);assert.equal(events.some(e=>e.type==='ACTIVITY_ATTENTION_RESUMED'),false);
  sim.applyAction({type:'activity-resume'});sim.step();assert.equal(sim.checkpoint().activity.cursor,cursor+1);
  const newlyStarted=fixed();emit(newlyStarted);newlyStarted.applyAction({type:'activity-start',totalTicks:10});newlyStarted.step();assert.equal(newlyStarted.checkpoint().activity.cursor,1,'a new developer-started activity does not inherit the previous idle attention hold');
});

test('2b-2 perceived sound ray respects limits, own-body rotation and developer priority',()=>{
  const sim=fixed();emit(sim,{x:-.6,z:2.8});let cp=sim.checkpoint();
  assert.ok(cp.head.observedAim);const worldYaw=cp.head.observedAim!.worldYaw;
  cp.character.heading=.2;cp.head.targetYaw=Math.atan2(Math.sin(worldYaw-.2),Math.cos(worldYaw-.2));
  const restored=new SensorySimulation({mode:'EXPERIMENT',checkpoint:cp});restored.step();
  assert.equal(restored.checkpoint().head.observedAim!.worldYaw,worldYaw);
  restored.enqueue({type:'turn_head',yawDelta:-.1,pitchDelta:0,sceneRevision:cp.scene.revision});const interrupted=restored.step();
  assert.ok(interrupted.some(e=>e.type==='ATTENTION_ACTION'&&e.outcome==='interrupted'));
  emit(restored);assert.equal(restored.attentionState().lastDecision!.reason,'developer_priority');
  const behind=fixed();emit(behind,{z:.5});cp=behind.checkpoint();assert.equal(cp.attention.lastDecision!.outcome,'unreachable');assert.ok(Math.abs(cp.head.targetYaw)<=75*Math.PI/180);assert.equal(cp.head.observedAim,null);
});

test('rejected developer head commands preserve automatic ownership, observation and completion capture causes',()=>{
  const original=fixed();emit(original,{x:.6});const start=original.checkpoint();start.scene.revision++;
  assert.ok(start.attention.automaticActionId);assert.equal(start.attention.pending,null);
  const rejected:HeadAction[]=[
    {type:'turn_head',yawDelta:-.1,pitchDelta:0,sceneRevision:0},
    {type:'look_at',yaw:0,pitch:0,sceneRevision:0},
    {type:'scan_area',minYaw:-.5,maxYaw:.5,pitch:0,passes:1,sceneRevision:0},
    {type:'cancel_head',sceneRevision:0},
    {type:'look_at',yaw:0,pitch:0,sceneRevision:start.scene.revision,evidence:{kind:'captured_filtered_bearing_v1',observationId:'outside-head-range',frameHash:'a'.repeat(64),capturedTick:start.tick,handle:'outside',capturedBodyHeading:0,capturedHeadYaw:0,capturedHeadPitch:0,bearingDegrees:180,elevationDegrees:0}},
  ];
  for(const command of rejected) {
    const sim=new SensorySimulation({mode:'EXPERIMENT',checkpoint:start}),input=sim.enqueue(command).input;
    const events=sim.step(),attention=sim.attentionState();
    assert.ok(events.some(e=>e.type==='INPUT_VALIDATED'&&e.outcome==='rejected'));
    assert.equal(events.some(e=>e.type==='ATTENTION_ACTION'&&e.outcome==='interrupted'),false);
    assert.equal(attention.developerUntilTick,start.attention.developerUntilTick);
    assert.equal(attention.automaticActionId,start.attention.automaticActionId);
    assert.equal(attention.automaticObservationId,start.attention.automaticObservationId);
    const completed=steps(sim,30).find(e=>e.type==='ATTENTION_ACTION'&&e.outcome==='completed');
    assert.ok(completed);assert.equal(completed.data.observationId,start.attention.automaticObservationId);
    assert.deepEqual(sim.attentionState().pending!.reasons,['salient_sound','head_milestone']);
    assert.equal(sim.attentionState().pending!.parentSequence,completed.sequence);
    const replayed=replay(start,[input],sim.state.tick);
    assert.equal(replayed.stateHash,hashCanonical(sim.checkpoint()));assert.equal(replayed.eventHash,sim.checkpoint().eventHash);
  }
});

test('accepted developer cancel and turn override automatic attention before later inputs at the same tick',()=>{
  const commands:HeadAction[]=[{type:'cancel_head',sceneRevision:0},{type:'turn_head',yawDelta:-.1,pitchDelta:0,sceneRevision:0}];
  for(const command of commands) {
    const sim=fixed();emit(sim,{x:.6});const previous=sim.attentionState();
    sim.enqueue(command);sim.enqueue({type:'emit_sound',...source});const events=sim.step(),attention=sim.attentionState();
    const interruption=events.find(e=>e.type==='ATTENTION_ACTION'&&e.outcome==='interrupted');
    assert.ok(interruption);assert.equal(interruption.data.actionId,previous.automaticActionId);
    assert.equal(interruption.data.observationId,previous.automaticObservationId);
    assert.equal(attention.automaticActionId,null);assert.equal(attention.automaticObservationId,null);
    assert.equal(attention.developerUntilTick,sim.state.tick+attention.config.developerPriorityTicks);
    assert.equal(attention.lastDecision!.reason,'developer_priority');
  }
});

test('2b-3 automatic intentions coalesce and sensor results are ordered, fresh, image based and duplicate suppressed',()=>{
  const sim=fixed();emit(sim);assert.ok(sim.attentionState().pending);
  assert.deepEqual(sim.attentionState().pending!.reasons,['salient_sound','head_milestone']);
  let feedback=result(sim,Array(48).fill(50));sim.enqueue(feedback);let events=sim.step();
  assert.equal(sim.attentionState().lastCapture!.freshness,'applicable');assert.equal(sim.attentionState().baseline!.capturedTick,feedback.capturedTick);
  steps(sim,901);feedback=result(sim,Array(48).fill(50),'capture-two');sim.enqueue(feedback);events=sim.step();assert.ok(events.some(e=>e.type==='VISUAL_COMPARISON'&&e.outcome==='duplicate_suppressed'));
  steps(sim,901);feedback=result(sim,Array(48).fill(100),'capture-three');sim.enqueue(feedback);events=sim.step();assert.ok(events.some(e=>e.type==='VISUAL_CHANGE'));
  assert.equal(events.some(e=>e.type==='HEAD_ACTION_STARTED'),false,'image change cannot turn into a head-turn feedback loop');assert.ok(sim.attentionState().lastCapture!.reasons.includes('visible_change'));
  assert.equal(sim.checkpoint().experiences.length,0);
});

test('submitted historical capture cannot absorb a later sound/head milestone; one deferred capture retains its own cause',()=>{
  const sim=fixed();steps(sim,901);const original=submitted(sim,'before-sound');sim.enqueue(original);sim.step();
  emit(sim);let cp=sim.checkpoint();assert.deepEqual(cp.attention.pending!.reasons,['uncertainty_probe']);assert.ok(cp.attention.deferred);assert.deepEqual(cp.attention.deferred!.reasons,['salient_sound','head_milestone']);assert.ok(cp.attention.deferred!.createdTick>original.capturedTick);
  const restored=new SensorySimulation({mode:'EXPERIMENT',checkpoint:cp});assert.deepEqual(restored.checkpoint(),cp);
  const feedback:SensorFeedbackCommand={...original,stage:'result',signature:Array(48).fill(50),frameHash:'a'.repeat(64)};sim.enqueue(feedback);sim.step();
  assert.deepEqual(sim.attentionState().lastCapture!.reasons,['uncertainty_probe']);steps(sim,90);cp=sim.checkpoint();assert.equal(cp.attention.deferred,null);assert.ok(cp.attention.pending!.reasons.includes('salient_sound'));
  sim.enqueue({...original,intentId:cp.attention.pending!.id});assert.ok(sim.step().some(e=>e.data.reason==='snapshot_predates_intention'));
});

test('sound queued before capture-admission ack is split by original snapshot tick into a later intention',()=>{
  const sim=fixed();steps(sim,901);const original=submitted(sim,'prior-snapshot');
  // Both inputs arrive at tick901; sound executes first at902, before ack can mark submission.
  sim.enqueue({type:'emit_sound',...source});sim.enqueue(original);sim.step();
  let state=sim.attentionState();assert.equal(state.pending!.status,'submitted');assert.deepEqual(state.pending!.reasons,['uncertainty_probe']);assert.ok(state.deferred);assert.ok(state.deferred!.reasons.includes('salient_sound'));
  assert.ok(state.deferred!.createdTick>original.capturedTick);assert.equal(state.pending!.triggers.some(t=>t.tick>original.capturedTick),false);
  sim.enqueue({...original,stage:'result',signature:Array(48).fill(30),frameHash:'d'.repeat(64)});sim.step();state=sim.attentionState();assert.deepEqual(state.lastCapture!.reasons,['uncertainty_probe']);assert.ok(state.deferred!.reasons.includes('salient_sound'));
  assert.doesNotThrow(()=>validateCheckpoint(sim.checkpoint()));
});

test('2b-3 stale, mismatched, failed and expired sensor work remains missing evidence with bounded backoff',()=>{
  const sim=fixed();emit(sim);const admitted=submitted(sim);sim.enqueue(admitted);sim.step();
  sim.enqueue({...admitted,stage:'result',captureId:'wrong',signature:Array(48).fill(1),frameHash:'a'.repeat(64)});assert.ok(sim.step().some(e=>e.data.reason==='capture_association_mismatch'));
  sim.enqueue({...admitted,stage:'result',pose:{...admitted.pose,x:admitted.pose.x+3},signature:Array(48).fill(1),frameHash:'a'.repeat(64)});sim.step();
  assert.equal(sim.attentionState().lastCapture!.freshness,'pose_changed');assert.equal(sim.attentionState().baseline,null);
  steps(sim,950);const pending=sim.attentionState().pending;assert.ok(pending);
  sim.enqueue({type:'sensor_feedback',intentId:pending!.id,stage:'rejected',captureId:null,capturedTick:sim.state.tick,sceneRevision:0,pose:pose(sim),outcome:'quota',signature:null,frameHash:null});sim.step();
  assert.ok(sim.attentionState().retryAfterTick>sim.state.tick);assert.equal(sim.attentionState().pending,null);
  steps(sim,950);assert.ok(sim.attentionState().pending);const expired=steps(sim,302);assert.ok(expired.some(e=>e.type==='CAPTURE_POLICY'&&e.outcome==='expired'));assert.equal(sim.attentionState().pending,null);
});

test('V4 complete checkpoint restores mid-attention/activity and replay injects normalized feedback exactly',()=>{
  const sim=fixed();sim.applyAction({type:'activity-start',totalTicks:100});emit(sim,{x:-.6});steps(sim,3);
  const start=sim.checkpoint(),copy=new SensorySimulation({mode:'EXPERIMENT',checkpoint:start}),inputs:OrderedInput[]=[];
  for(let tick=0;tick<120;tick++) {
    if(tick===30&&sim.attentionState().pending){const command=submitted(sim);inputs.push(sim.enqueue(command).input);copy.enqueue(command);}
    if(tick===31&&sim.attentionState().pending?.status==='submitted'){const p=sim.attentionState().pending!;const command:SensorFeedbackCommand={type:'sensor_feedback',intentId:p.id,stage:'result',captureId:p.captureId,capturedTick:p.requestedTick!,sceneRevision:sim.snapshot().scene!.revision,pose:pose(sim),outcome:'success',signature:Array(48).fill(40),frameHash:'c'.repeat(64)};inputs.push(sim.enqueue(command).input);copy.enqueue(command);}
    sim.step();copy.step();
  }
  assert.deepEqual(copy.checkpoint(),sim.checkpoint());const replayed=replay(start,inputs,sim.state.tick);assert.equal(replayed.stateHash,hashCanonical(sim.checkpoint()));assert.equal(replayed.eventHash,sim.checkpoint().eventHash);
  const corrupt=sim.checkpoint();corrupt.attention.exposures[0].count=Infinity;assert.throws(()=>validateCheckpoint(corrupt),/exposure/);
  const incomplete=sim.checkpoint() as unknown as Record<string,unknown>;delete incomplete.attention;assert.throws(()=>validateCheckpoint(incomplete),/fields/);
});

test('active V3 migration preserves old state/queue while historical replay stays V3',async()=>{
  const old=new VisionSimulation({mode:'LIVE'});old.enqueue({type:'slam'});const cp=old.checkpoint();assert.equal(cp.schemaVersion,3);
  const next=new SensorySimulation({mode:'LIVE',checkpoint:cp}).checkpoint();assert.equal(next.schemaVersion,4);assert.equal(next.tick,cp.tick);assert.deepEqual(next.pendingInputs,cp.pendingInputs);assert.deepEqual(next.head,cp.head);assert.deepEqual(next.subjective,cp.subjective);assert.equal(next.eventHash,cp.eventHash);
  const historical=replay(cp,[],5);assert.equal(historical.checkpoint.schemaVersion,3);
  const v1=new Simulation();assert.equal(replay(v1.checkpoint(),[],5).checkpoint.schemaVersion,1);
  const runtime=new BranchRuntime({worldId:'test',branchId:'experiment',mode:'EXPERIMENT',offline:true});
  try {assert.throws(()=>runtime.enqueue({type:'sensor_feedback',intentId:1,stage:'recovered',captureId:null,capturedTick:0,sceneRevision:0,pose:{x:0,y:0,z:0,bodyHeading:0,headYaw:0,headPitch:0},outcome:'interrupted',signature:null,frameHash:null}),/private/);assert.equal(runtime.checkpoint().simulation.schemaVersion,10);}finally{await runtime.close();}
});

test('normalized acoustic/attention/capture chain exports all causal fields and replays with no renderer',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'lumi-attention-core-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const runtime=new BranchRuntime({worldId:'hearing',branchId:'experiment',mode:'EXPERIMENT',checkpoint:fixed().checkpoint(),directory});
  const manager=new CaptureManager(()=>true,{render:async()=>({bytes:new Uint8Array([137,80,78,71]),backend:{configuration:'angle-d3d11',chromium:'TEST STUB',webglVendor:'TEST STUB',webglRenderer:'TEST STUB',version:'TEST STUB',flags:[]}}),close:async()=>{}});
  try {
    runtime.applyControl({type:'pause'});runtime.enqueue({type:'emit_sound',...source});runtime.applyControl({type:'step'});
    const attention=runtime.summary().attention!,intent=attention.pending!;assert.ok(intent);
    const metadata=manager.request(runtime,{reason:'salient_sound',width:128,height:128},{intentId:intent.id,reasons:intent.reasons,parentSequence:intent.parentSequence});await manager.wait(runtime.target,metadata.captureId);
    const feedback:SensorFeedbackCommand={type:'sensor_feedback',intentId:intent.id,stage:'admitted',captureId:metadata.captureId,capturedTick:metadata.tick,sceneRevision:metadata.dynamicRevision,pose:{x:metadata.camera.position[0],y:metadata.camera.position[1],z:metadata.camera.position[2],bodyHeading:metadata.camera.bodyHeading,headYaw:metadata.camera.headYaw,headPitch:metadata.camera.headPitch},outcome:'success',signature:null,frameHash:null};
    runtime.enqueueSensorFeedback(feedback);runtime.applyControl({type:'step'});runtime.enqueueSensorFeedback({...feedback,stage:'result',signature:Array(48).fill(40),frameHash:manager.view(runtime.target).latest!.frameHash});runtime.applyControl({type:'step'});
    runtime.capture();await runtime.recorder!.flush();const expected=runtime.checkpoint(),out=join(directory,'chain.zip');
    const exported=await exportIncident({runDirectory:runtime.recorder!.runDirectory,out});assert.equal(exported.manifest.evidence_status,'COMPLETE',JSON.stringify(exported.manifest.coverage));
    const replayed=await replayBundle(out);assert.equal(replayed.runtimeHash,hashRuntimeCheckpoint(expected));
    const files=await inspectBundle(out),records=strFromU8(files['events.jsonl']).trim().split('\n').map(line=>JSON.parse(line));
    const request=records.find(r=>r.event_type==='CAPTURE_REQUEST');assert.equal(request.data.captureReasons,'salient_sound head_milestone');assert.equal(request.data.originSequence,intent.parentSequence);assert.equal(request.causal_event_id,`simulation:${intent.parentSequence}`);
    assert.ok(records.some(r=>r.event_type==='CAPTURE_FEEDBACK'&&r.data.captureId===metadata.captureId));assert.ok(records.some(r=>r.event_type==='ACOUSTIC_PROPAGATION'&&'barrierGroups' in r.data));
    assert.match(strFromU8(files['REPRODUCTION.md']),/schema 10 head\/scene/);assert.match(strFromU8(files['REPRODUCTION.md']),/sensor_feedback/);assert.equal(Object.keys(files).some(name=>name.endsWith('.png')),false);assert.equal(runtime.simulation.checkpoint().experiences.length,0);
  }finally{await manager.close();await runtime.close();}
});
