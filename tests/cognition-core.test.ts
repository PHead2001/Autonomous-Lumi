import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CognitionSimulation,validateCheckpoint,hashCheckpoint,type CheckpointV5,type OrderedInput} from '../server/simulation.js';
import {replay} from '../server/replay.js';
import {BranchRuntime,validateRuntimeCheckpoint,replayRuntime} from '../server/branch-runtime.js';
import {RecoveryStore} from '../server/recovery-store.js';
import {eyePose} from '../shared/eye-pose.js';
import {COGNITION_SCHEMA_REVISION,parseCognitionProposal,type CognitionRequestCommand,type CognitionResultCommand,type CognitionAction} from '../shared/cognition-protocol.js';
const frameHash='a'.repeat(64);
function fixture(mode:'LIVE'|'EXPERIMENT'='LIVE',source:'actual_renderer'|'test_fixture'='actual_renderer') {
 const fresh=new CognitionSimulation({mode,worldId:'world',branchId:'live',historyId:'history',runId:'run'}).checkpoint();fresh.pauseUntilTick=10000;fresh.character.moving=false;
 fresh.attention.pending={id:1,createdTick:0,expiresTick:300,reasons:['activity_outcome'],triggers:[{reason:'activity_outcome',tick:0,parentSequence:null}],parentSequence:null,status:'pending',captureId:null,requestedTick:null};fresh.attention.nextIntentId=2;
 const sim=new CognitionSimulation({mode,checkpoint:fresh,historical:true});const inputs:OrderedInput[]=[];
 const enqueue=(command:Parameters<typeof sim.enqueue>[0])=>{const r=sim.enqueue(command);inputs.push(r.input);return r;};
 const eye=eyePose(sim.snapshot()),pose={x:eye.position[0],y:eye.position[1],z:eye.position[2],bodyHeading:eye.bodyHeading,headYaw:eye.headYaw,headPitch:eye.headPitch};
 enqueue({type:'sensor_feedback',intentId:1,stage:'admitted',captureId:'capture',capturedTick:0,sceneRevision:0,pose,outcome:'success',signature:null,frameHash:null});sim.step();
 enqueue({type:'sensor_feedback',intentId:1,stage:'result',captureId:'capture',capturedTick:0,sceneRevision:0,pose,outcome:'success',signature:Array(48).fill(10),frameHash});sim.step();
 const request:CognitionRequestCommand={type:'cognition_request',purpose:'interpretation',requestId:'request',selection:{identity:fresh.cognition.identity,captureId:'capture',observationId:'observation',frameHash,intentId:1,capturedTick:0,attentionTick:2,pose,source,context:{observationId:'observation',frameHash,shapes:[{handle:'shape',bearingDegrees:15,elevationDegrees:0,distanceBand:'near',sampleVisibilityBand:'high',uncertainty:'geometric_samples_only'}],sound:null,activity:{status:'idle'},experiences:[]}},provider:'fixture',model:'offline',promptRevision:'prompt-v1',schemaRevision:COGNITION_SCHEMA_REVISION};
 const result=(action:CognitionAction={type:'continue'}):CognitionResultCommand=>({type:'cognition_result',requestId:'request',identity:structuredClone(fresh.cognition.identity),outcome:'success',proposal:{observationId:'observation',frameHash,interpretation:'A possibly red shape; identity is uncertain.',uncertainty:.6,evidenceHandles:['shape'],action},metrics:{latencyMs:10,attempts:1,inputTokens:100,outputTokens:20,costUsd:.0001,costBasis:'estimated',modelRevision:null}});
 return {sim,inputs,enqueue,request,result,start:fresh};
}
test('2c strict output contract rejects privilege, fabricated structure and noncoarse actions',()=>{
 const {result}=fixture();assert.doesNotThrow(()=>parseCognitionProposal(result().proposal));
 for(const p of [{...result().proposal,remember:true},{...result().proposal,uncertainty:2},{...result().proposal,action:{type:'look',bearingDegrees:13,elevationDegrees:0}},{...result().proposal,action:{type:'move',target:'engine-secret'}}])assert.throws(()=>parseCognitionProposal(p));
});
test('2c ordered normalized interpretation independently encodes, deduplicates and exactly replays with no external calls',()=>{
 const f=fixture();f.enqueue(f.request);f.sim.step();assert.equal(f.sim.cognitionState().requests.length,1);f.enqueue(f.result());f.sim.step();f.enqueue(f.result());f.sim.step();
 const cp=f.sim.checkpoint();assert.equal(cp.realExperiences.length,1);assert.equal(cp.realExperiences[0].interpretation,'A possibly red shape; identity is uncertain.');assert.equal(cp.realExperiences[0].uncertainty,.6);assert.equal(cp.realExperiences[0].capturedTick,0);assert.equal(cp.realExperiences[0].attentionTick,2);assert.equal(cp.realExperiences[0].actionOutcome?.reason,'continued');assert.doesNotThrow(()=>validateCheckpoint(cp));
 const offline=replay(f.start,f.inputs,cp.tick);assert.equal(offline.stateHash,hashCheckpoint(cp));assert.equal(offline.eventHash,cp.eventHash);
});
test('2c authentic stale interpretation is retained at original timing while stale action cannot execute',()=>{
 const f=fixture();f.enqueue(f.request);f.sim.step();for(let i=0;i<610;i++)f.sim.step();f.enqueue(f.result({type:'look',bearingDegrees:15,elevationDegrees:0}));f.sim.step();const r=f.sim.cognitionState().requests[0];
 assert.equal(r.action?.reason,'stale_action');assert.equal(r.encoding?.status,'admitted');assert.equal(f.sim.checkpoint().realExperiences[0].actionOutcome,null);assert.equal(f.sim.checkpoint().realExperiences[0].capturedTick,0);
});
test('2c fabricated handles, unselected captures and fixture sources cannot create LIVE autobiography',()=>{
 const f=fixture();const bogus=structuredClone(f.request);bogus.selection.captureId='manual';f.enqueue(bogus);f.sim.step();assert.equal(f.sim.cognitionState().requests.length,0);
 const g=fixture();g.enqueue(g.request);g.sim.step();const bad=g.result();bad.proposal!.evidenceHandles=['fabricated'];g.enqueue(bad);g.sim.step();assert.equal(g.sim.checkpoint().realExperiences.length,0);assert.equal(g.sim.cognitionState().requests[0].encoding?.reason,'fabricated_evidence');
 const h=fixture('LIVE','test_fixture');h.enqueue(h.request);h.sim.step();assert.equal(h.sim.cognitionState().requests.length,0);
 const e=fixture('EXPERIMENT','test_fixture');e.enqueue(e.request);e.sim.step();e.enqueue(e.result());e.sim.step();assert.equal(e.sim.checkpoint().realExperiences.length,0);
});
test('2c foreign and failed responses preserve world/reflex continuity and Decisions never encode',()=>{
 const f=fixture();f.request.purpose='decisions_evaluation';f.enqueue(f.request);f.sim.step();const foreign=f.result();foreign.identity.runId='retired';f.enqueue(foreign);f.sim.step();assert.equal(f.sim.cognitionState().requests[0].status,'pending');f.enqueue(f.result());f.sim.step();assert.equal(f.sim.cognitionState().requests[0].encoding?.reason,'decision_not_experience');
 const g=fixture();g.enqueue(g.request);g.sim.step();g.enqueue({...g.result(),outcome:'budget_exhausted',proposal:null});g.enqueue({type:'slam'});g.sim.step();assert.equal(g.sim.cognitionState().requests[0].encoding?.reason,'budget_exhausted');assert.equal(g.sim.checkpoint().door.slamCount,1);assert.ok(g.sim.checkpoint().reflex.strength>0);
});
test('2c recovery persists admitted experience with logging off and cannot promote experiment ancestry',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'lumi-cognition-core-'));t.after(()=>rm(directory,{recursive:true,force:true}));const f=fixture();f.enqueue(f.request);f.sim.step();f.enqueue(f.result());f.sim.step();
 const runtime=new BranchRuntime({mode:'LIVE',worldId:'world',branchId:'live',historyId:'history',offline:true});const cp={...runtime.checkpoint(),simulation:f.sim.checkpoint()};cp.control.loggingMode='off';validateRuntimeCheckpoint(cp);
 const {store}=await RecoveryStore.open({directory});await store.save(cp);const loaded=await RecoveryStore.open({directory});const restored=new BranchRuntime({mode:'LIVE',worldId:'world',branchId:'live',historyId:'history',checkpoint:loaded.checkpoint,offline:true});
 assert.deepEqual((restored.checkpoint().simulation as CheckpointV5).realExperiences,f.sim.checkpoint().realExperiences);assert.equal(replayRuntime(cp,[],cp).stateHash,hashCheckpoint(f.sim.checkpoint()));
 const forbidden=structuredClone(cp);(forbidden.simulation as CheckpointV5).realExperiences[0].identity.mode='EXPERIMENT';assert.throws(()=>validateRuntimeCheckpoint(forbidden));await restored.close();await runtime.close();
});
test('2c interrupted pending logical request is reconciled without resend; old-run answer cannot mutate replacement',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'lumi-cognition-reconcile-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const f=fixture();f.enqueue(f.request);f.sim.step();const base=new BranchRuntime({mode:'LIVE',worldId:'world',branchId:'live',historyId:'history',offline:true});const cp={...base.checkpoint(),simulation:f.sim.checkpoint()};
 const restored=new BranchRuntime({mode:'LIVE',worldId:'world',branchId:'live',historyId:'history',checkpoint:cp,offline:false,directory});
 try{restored.reconcileCognitionRequests();restored.simulation.step();const sim=restored.simulation as CognitionSimulation;assert.equal(sim.cognitionState().requests[0].result?.outcome,'interrupted');restored.enqueueCognitionResult(f.result());restored.simulation.step();assert.equal(sim.admittedExperiences().length,0);}finally{await restored.close();await base.close();}
});
test('2c frozen coarse bearing re-expresses own rotation and inspect obtains only a normal fresh capture',()=>{
 const f=fixture();f.enqueue(f.request);f.sim.step();const cp=f.sim.checkpoint();cp.character.heading=15*Math.PI/180;cp.scene.fixtureColor='#00ff00';cp.scene.revision++;
 const sim=new CognitionSimulation({mode:'LIVE',checkpoint:cp,historical:true});sim.enqueue(f.result({type:'look',bearingDegrees:15,elevationDegrees:0}));sim.step();assert.ok(Math.abs(sim.checkpoint().head.targetYaw)<1e-10);assert.equal(sim.admittedExperiences().length,1);assert.equal(sim.admittedExperiences()[0].interpretation,'A possibly red shape; identity is uncertain.');
 const g=fixture();g.enqueue(g.request);g.sim.step();g.enqueue(g.result({type:'inspect',handle:'shape'}));g.sim.step();for(let i=0;i<20;i++)g.sim.step();assert.ok(g.sim.attentionState().pending?.reasons.includes('head_milestone'));assert.equal(g.sim.cognitionState().observationRequestedTick,4);assert.equal(g.sim.admittedExperiences()[0].actionOutcome?.reason,'inspection_orient_started');
});
test('2c reordered newer selection supersedes old action but retains both admitted perceptions',()=>{
 const f=fixture();f.enqueue(f.request);f.sim.step();const cp=f.sim.checkpoint();cp.tick=100;cp.cognition.nextRequestTick=0;cp.attention.lastCapture!.receivedTick=100;cp.attention.baseline!.capturedTick=100;cp.attention.lastAcceptedCaptureTick=100;cp.attention.lastCapture!.capturedTick=100;
 const sim=new CognitionSimulation({mode:'LIVE',checkpoint:cp,historical:true});const newer=structuredClone(f.request);newer.requestId='new-request';newer.selection.capturedTick=100;newer.selection.attentionTick=100;sim.enqueue(newer);sim.step();
 const result=structuredClone(f.result());result.requestId='new-request';sim.enqueue(result);sim.step();sim.enqueue(f.result({type:'look',bearingDegrees:15,elevationDegrees:0}));sim.step();const old=sim.cognitionState().requests[0];assert.equal(old.action?.reason,'superseded_action');assert.equal(old.encoding?.status,'admitted');assert.equal(sim.admittedExperiences().length,2);assert.doesNotThrow(()=>validateCheckpoint(sim.checkpoint()));
});
test('2c request ledger capacity rejects explicitly and preserves all existing admission/dedup state',()=>{
 const f=fixture();f.enqueue(f.request);f.sim.step();const cp=f.sim.checkpoint(),template=cp.cognition.requests[0];cp.cognition.nextRequestTick=0;
 cp.cognition.requests=Array.from({length:256},(_,index)=>{const request=structuredClone(template.request);request.requestId='old-'+index;const result={...f.result(),requestId:request.requestId,outcome:'failed' as const,proposal:null};return {...structuredClone(template),request,status:'completed' as const,resultTick:3,result,encoding:{status:'rejected' as const,reason:'failed',experienceId:null}};});
 const sim=new CognitionSimulation({mode:'LIVE',checkpoint:cp,historical:true});sim.enqueue(f.request);const events=sim.step();assert.ok(events.some(e=>e.data.reason==='request_history_capacity'));assert.equal(sim.cognitionState().requests.length,256);assert.equal(sim.admittedExperiences().length,0);assert.doesNotThrow(()=>validateCheckpoint(sim.checkpoint()));
});
test('2c selected visual change requests a bounded richer capture through ordered replay and cooldown',()=>{
 const f=fixture();const cp=f.sim.checkpoint();cp.attention.lastCapture!.reasons.push('visible_change');cp.attention.captureCooldownUntilTick=10;
 const sim=new CognitionSimulation({mode:'LIVE',checkpoint:cp,historical:true});const command={type:'cognition_observation_request' as const,requestId:'upgrade',identity:cp.cognition.identity,captureId:'capture',frameHash,intentId:1};const accepted=sim.enqueue(command);sim.step();assert.equal(sim.cognitionState().captureUpgrade?.status,'pending');assert.equal(sim.attentionState().pending,null);
 for(let i=0;i<7;i++)sim.step();assert.equal(sim.cognitionState().captureUpgrade?.status,'requested');assert.ok(sim.attentionState().pending?.reasons.includes('visible_change'));const repeated=sim.enqueue(command);assert.ok(sim.step().some(e=>e.data.reason==='duplicate_upgrade'));
 const end=sim.checkpoint(),offline=replay(cp,[accepted.input,repeated.input],end.tick);assert.equal(offline.stateHash,hashCheckpoint(end));assert.equal(offline.eventHash,end.eventHash);
});
test('2c normalized model chain exports complete prose and replays exact canonical state without providers or renderer',async t=>{
 const {FlightRecorder}=await import('../server/diagnostics/recorder.js');const {exportIncident,replayBundle}=await import('../server/diagnostics/bundle.js');
 const directory=await mkdtemp(join(tmpdir(),'lumi-cognition-bundle-'));t.after(()=>rm(directory,{recursive:true,force:true}));const f=fixture();const base=new BranchRuntime({mode:'LIVE',worldId:'world',branchId:'live',historyId:'history',offline:true});const start={...base.checkpoint(),simulation:f.sim.checkpoint()};
 const runtime=new BranchRuntime({mode:'LIVE',worldId:'world',branchId:'live',historyId:'history',checkpoint:start,offline:true});const recorder=new FlightRecorder({directory,worldId:'world',branchId:'live',worldMode:'LIVE',runId:runtime.target.runId});recorder.captureRuntimeCheckpoint(start);
 let sequence=1;const apply=(op:Omit<import('../server/branch-runtime.js').RuntimeOperation,'sequence'>)=>{const operation={...op,sequence:sequence++} as import('../server/branch-runtime.js').RuntimeOperation;runtime.replayOperation(operation);recorder.recordRuntimeOperation(operation);if(operation.kind==='input')recorder.recordInput(operation.input);for(const event of runtime.drainEvents())recorder.recordEvent(event);};
 const input=(command:Parameters<typeof runtime.enqueue>[0])=>{const cp=runtime.simulation.checkpoint();apply({kind:'input',tick:cp.tick,input:{sequence:cp.nextInputSequence,receivedTick:cp.tick,applyTick:cp.tick+1,command,admission:'queued'}} as Omit<import('../server/branch-runtime.js').RuntimeOperation,'sequence'>);apply({kind:'advance',tick:cp.tick,ticks:1,backlogMs:0,source:'scheduled'} as Omit<import('../server/branch-runtime.js').RuntimeOperation,'sequence'>);};
 input(f.request);const response=f.result();response.proposal!.interpretation='Possibly a red, curved shape — uncertain; not a named object. '.repeat(5);input(response);input(response);
 recorder.captureRuntimeCheckpoint(runtime.checkpoint());await recorder.flush();const out=join(directory,'fixture-only.zip');const bundle=await exportIncident({runDirectory:recorder.runDirectory,out});assert.equal(bundle.manifest.evidence_status,'COMPLETE');const offline=await replayBundle(out);assert.equal(offline.stateHash,hashCheckpoint(runtime.simulation.checkpoint()));assert.equal(offline.eventHash,runtime.simulation.checkpoint().eventHash);await recorder.close();await runtime.close();await base.close();
});

test('2c completed model look leaves local sound attention eligible without developer priority',()=>{
 const f=fixture('EXPERIMENT');f.enqueue(f.request);f.sim.step();f.enqueue(f.result({type:'look',bearingDegrees:45,elevationDegrees:0}));f.sim.step();
 assert.equal(f.sim.cognitionState().requests[0].action?.reason,'look_started');
 while(f.sim.checkpoint().tick<34)f.sim.step();assert.equal(f.sim.checkpoint().head.status,'idle');
 const eye=eyePose(f.sim.snapshot()).position;f.enqueue({type:'emit_sound',x:eye[0],y:eye[1],z:eye[2]+1,intensity:1,suddenness:1,sourceId:'nearby-after-model'});const events=f.sim.step();
 assert.equal(f.sim.checkpoint().tick,35);assert.equal(f.sim.attentionState().developerUntilTick,0);assert.notEqual(f.sim.attentionState().lastDecision?.outcome,'ignored');assert.notEqual(f.sim.attentionState().lastDecision?.reason,'developer_priority');assert.ok(events.some(event=>event.type==='ATTENTION_ACTION'&&event.outcome==='started'));assert.ok(events.some(event=>event.type==='REFLEX_STATE'));
});

test('2c genuine developer override interrupts model look and retains developer attention priority',()=>{
 const f=fixture('EXPERIMENT');f.enqueue(f.request);f.sim.step();f.enqueue(f.result({type:'look',bearingDegrees:45,elevationDegrees:0}));f.sim.step();
 assert.equal(f.sim.checkpoint().head.status,'turning');f.enqueue({type:'cancel_head',sceneRevision:0});const cancelled=f.sim.step();assert.ok(cancelled.some(event=>event.type==='HEAD_INTERRUPTED'));assert.equal(f.sim.checkpoint().head.status,'idle');
 const priorityUntil=f.sim.checkpoint().tick+f.sim.attentionState().config.developerPriorityTicks;assert.equal(f.sim.attentionState().developerUntilTick,priorityUntil);
 const eye=eyePose(f.sim.snapshot()).position;f.enqueue({type:'emit_sound',x:eye[0],y:eye[1],z:eye[2]+1,intensity:1,suddenness:1,sourceId:'nearby-after-developer'});const events=f.sim.step();
 assert.equal(f.sim.attentionState().lastDecision?.outcome,'ignored');assert.equal(f.sim.attentionState().lastDecision?.reason,'developer_priority');assert.equal(f.sim.attentionState().developerUntilTick,priorityUntil);assert.ok(events.some(event=>event.type==='REFLEX_STATE'));
});
