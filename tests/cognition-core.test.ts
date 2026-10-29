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
import {COGNITION_SCHEMA_REVISION,COGNITION_PROMPT_REVISION,parseCognitionProposal,type CognitionRequestCommand,type CognitionResultCommand,type CognitionAction} from '../shared/cognition-protocol.js';
const frameHash='a'.repeat(64);
function fixture(mode:'LIVE'|'EXPERIMENT'='LIVE',source:'actual_renderer'|'test_fixture'='actual_renderer') {
 const fresh=new CognitionSimulation({mode,worldId:'world',branchId:'live',historyId:'history',runId:'run'}).checkpoint();fresh.pauseUntilTick=10000;fresh.character.moving=false;
 fresh.attention.pending={id:1,createdTick:0,expiresTick:300,reasons:['activity_outcome'],triggers:[{reason:'activity_outcome',tick:0,parentSequence:null}],parentSequence:null,status:'pending',captureId:null,requestedTick:null};fresh.attention.nextIntentId=2;
 const sim=new CognitionSimulation({mode,checkpoint:fresh,historical:true});const inputs:OrderedInput[]=[];
 const enqueue=(command:Parameters<typeof sim.enqueue>[0])=>{const r=sim.enqueue(command);inputs.push(r.input);return r;};
 const eye=eyePose(sim.snapshot()),pose={x:eye.position[0],y:eye.position[1],z:eye.position[2],bodyHeading:eye.bodyHeading,headYaw:eye.headYaw,headPitch:eye.headPitch};
 enqueue({type:'sensor_feedback',intentId:1,stage:'admitted',captureId:'capture',capturedTick:0,sceneRevision:0,pose,outcome:'success',signature:null,frameHash:null});sim.step();
 enqueue({type:'sensor_feedback',intentId:1,stage:'result',captureId:'capture',capturedTick:0,sceneRevision:0,pose,outcome:'success',signature:Array(48).fill(10),frameHash});sim.step();
 const request:CognitionRequestCommand={type:'cognition_request',purpose:'interpretation',requestId:'request',selection:{identity:fresh.cognition.identity,captureId:'capture',observationId:'observation',frameHash,intentId:1,capturedTick:0,attentionTick:2,pose,source,context:{observationId:'observation',frameHash,shapes:[{handle:'shape',bearingDegrees:15,elevationDegrees:0,distanceBand:'near',sampleVisibilityBand:'high',uncertainty:'geometric_samples_only'}],sound:null,activity:{status:'idle'},experiences:[]}},provider:'fixture',model:'offline',promptRevision:'prompt-v1',schemaRevision:'lumi-interpretation-v1'};
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

function capacityHistory(count:number):CheckpointV5 {
 const f=fixture();f.enqueue(f.request);f.sim.step();const result=f.result();result.proposal!.interpretation='x'.repeat(220);f.enqueue(result);f.sim.step();const cp=f.sim.checkpoint(),request=cp.cognition.requests[0],experience=cp.realExperiences[0];
 cp.cognition.requests=Array.from({length:count},(_,index)=>{
  const record=structuredClone(request),id='record-'+String(index).padStart(3,'0');record.request.requestId=id;record.result!.requestId=id;record.encoding!.experienceId=index+1;
  record.request.selection.context.experiences=Array.from({length:8},()=>({interpretation:experience.interpretation,uncertainty:experience.uncertainty}));return record;
 });
 cp.realExperiences=Array.from({length:count},(_,index)=>({...structuredClone(experience),id:index+1,requestId:cp.cognition.requests[index].request.requestId,encodingId:cp.cognition.identity.historyId+'_'+cp.cognition.requests[index].request.requestId}));
 cp.cognition.responses=count;cp.cognition.nextRequestTick=0;return cp;
}

test('2c maximum escaped normalized reply and real experience fit the explicit terminal and delivery reserves',async t=>{
 const {cognitionEnvelopeBytes,COGNITION_TERMINAL_BYTES,COGNITION_PENDING_BYTES}=await import('../server/checkpoint-capacity.js');
 const f=fixture();f.enqueue(f.request);f.sim.step();const pending=f.sim.checkpoint(),record=pending.cognition.requests[0],selection=record.request.selection;
 const id='i'.repeat(100),escaped='\ud800'.repeat(1200),identity={worldId:id,historyId:id,branchId:id,runId:id,mode:'LIVE' as const};
 record.request.requestId=id;selection.identity=identity;selection.captureId=id;selection.observationId=id;selection.context.observationId=id;
 selection.context.shapes=Array.from({length:32},(_,index)=>({handle:String(index).padStart(3,'0')+'h'.repeat(97),bearingDegrees:180,elevationDegrees:90,distanceBand:'unknown',sampleVisibilityBand:'medium',uncertainty:'geometric_samples_only'}));
 selection.context.experiences=Array.from({length:8},()=>({interpretation:escaped,uncertainty:1.2345678901234567e-100}));
 record.request.provider='\ud800'.repeat(80);record.request.model='\ud800'.repeat(120);record.request.promptRevision=id;
 const result:CognitionResultCommand={type:'cognition_result',requestId:id,identity,outcome:'success',proposal:{observationId:id,frameHash,interpretation:escaped,uncertainty:1.2345678901234567e-100,evidenceHandles:selection.context.shapes.slice(0,16).map(shape=>shape.handle),action:{type:'inspect',handle:selection.context.shapes[0].handle}},metrics:{latencyMs:1.2345678901234567e-100,attempts:10,inputTokens:Number.MAX_SAFE_INTEGER,outputTokens:Number.MAX_SAFE_INTEGER,costUsd:Number.MAX_VALUE,costBasis:'reported',modelRevision:'\ud800'.repeat(160)}};
 assert.doesNotThrow(()=>parseCognitionProposal(result.proposal));const {validateCognitionCommand}=await import('../shared/cognition-protocol.js');assert.doesNotThrow(()=>validateCognitionCommand(result));
 const delivered=structuredClone(pending);delivered.pendingInputs.push({sequence:1,receivedTick:3,applyTick:4,command:result,admission:'queued'});
 const completed=structuredClone(pending),r=completed.cognition.requests[0];r.status='completed';r.resultTick=4;r.result=result;r.action={status:'rejected',reason:'r'.repeat(100),actionId:Number.MAX_SAFE_INTEGER,tick:Number.MAX_SAFE_INTEGER};r.encoding={status:'admitted',reason:'trusted_attended_interpretation',experienceId:1};
 const sample=capacityHistory(1).realExperiences[0];completed.realExperiences=[{...sample,id:1,requestId:id,encodingId:id+'_'+id,identity,captureId:id,observationId:id,interpretation:escaped,uncertainty:result.proposal!.uncertainty,evidenceHandles:result.proposal!.evidenceHandles,actionOutcome:{status:'executed',reason:'\ud800'.repeat(100),actionId:Number.MAX_SAFE_INTEGER,tick:Number.MAX_SAFE_INTEGER}}];
 const combined=structuredClone(completed);combined.pendingInputs=delivered.pendingInputs;
 const terminal=cognitionEnvelopeBytes(completed)-cognitionEnvelopeBytes(pending),delivery=cognitionEnvelopeBytes(delivered)-cognitionEnvelopeBytes(pending),total=cognitionEnvelopeBytes(combined)-cognitionEnvelopeBytes(pending);
 t.diagnostic(JSON.stringify({terminalBytes:terminal,deliveryBytes:delivery,combinedBytes:total,terminalReserve:COGNITION_TERMINAL_BYTES,combinedReserve:COGNITION_PENDING_BYTES}));
 assert.ok(terminal<COGNITION_TERMINAL_BYTES,`terminal ${terminal} exceeds reserve`);assert.ok(delivery<COGNITION_TERMINAL_BYTES,`delivery ${delivery} exceeds reserve`);assert.ok(total<COGNITION_PENDING_BYTES,`combined ${total} exceeds reserve`);
});

test('2c near-capacity admission measures actual pretty recovery/named envelopes and keeps pending and encoded state savable',async t=>{
 const {fitsCognitionStorage,cognitionStorageBytes}=await import('../server/checkpoint-capacity.js');const {checkpointBytes,MAX_CHECKPOINT_BYTES,namedCheckpointPayload,recoveryCheckpointPayload,atomicJson}=await import('../server/checkpoint-storage.js');
 const directory=await mkdtemp(join(tmpdir(),'lumi-cognition-storage-capacity-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const first=fixture();const candidate=structuredClone(first.request);candidate.requestId='capacity-request';candidate.selection.context.experiences=Array.from({length:8},()=>({interpretation:'x'.repeat(220),uncertainty:.6}));
 let checkpoint:CheckpointV5|null=null,low=1,high=255;
 while(low<=high){
  const count=Math.floor((low+high)/2),cp=capacityHistory(count),projected=structuredClone(cp);projected.cognition.requests.push({request:candidate,requestedTick:cp.tick+1,status:'pending',resultTick:null,result:null,action:null,encoding:null});
  if(fitsCognitionStorage(projected)){checkpoint=cp;low=count+1;}else high=count-1;
 }
 assert.ok(checkpoint);assert.ok(checkpoint.cognition.requests.length>100);assert.doesNotThrow(()=>validateCheckpoint(checkpoint));
 const sim=new CognitionSimulation({mode:'LIVE',checkpoint,historical:true});assert.equal(sim.enqueue(candidate).input.admission,'queued');sim.step();assert.equal(sim.cognitionState().requests.at(-1)?.status,'pending');
 const base=new BranchRuntime({mode:'LIVE',worldId:'world',branchId:'live',historyId:'history',offline:true});const runtime=(simulation:CheckpointV5)=>({...base.checkpoint(),simulation});
 const {store}=await RecoveryStore.open({directory});await store.save(runtime(sim.checkpoint()));
 const response=first.result();response.requestId=candidate.requestId;response.proposal!.interpretation='\ud800'.repeat(1200);response.metrics.modelRevision='\ud800'.repeat(160);response.metrics.costUsd=123.45;response.metrics.costBasis='reported';
 assert.equal(sim.enqueue(response).input.admission,'queued');await store.save(runtime(sim.checkpoint()));sim.step();assert.equal(sim.cognitionState().requests.at(-1)?.encoding?.status,'admitted');
 const encoded=sim.checkpoint();assert.ok(cognitionStorageBytes(encoded)<=MAX_CHECKPOINT_BYTES);const payload=recoveryCheckpointPayload(runtime(encoded),store.historyId,Number.MAX_SAFE_INTEGER),named=namedCheckpointPayload(runtime(encoded),{worldId:'world',branchId:'live',historyId:'history',mode:'LIVE',createdAt:new Date().toISOString()});
 assert.ok(checkpointBytes(payload)<=MAX_CHECKPOINT_BYTES);assert.ok(checkpointBytes(named)<=MAX_CHECKPOINT_BYTES);assert.ok(checkpointBytes(payload)>MAX_CHECKPOINT_BYTES* .7,'fixture must exercise near-capacity persisted bytes');
 t.diagnostic(JSON.stringify({records:encoded.realExperiences.length,recoveryBytes:checkpointBytes(payload),namedBytes:checkpointBytes(named),requiredWithFutureGrowth:cognitionStorageBytes(encoded),limit:MAX_CHECKPOINT_BYTES}));
 const oldHistory=capacityHistory(256);for(const [index,record] of oldHistory.cognition.requests.entries()){const id=String(index).padStart(3,'0')+'r'.repeat(77);record.request.requestId=id;record.result!.requestId=id;oldHistory.realExperiences[index].requestId=id;oldHistory.realExperiences[index].encodingId='history_'+id;record.request.selection.context.shapes[0].handle='h'.repeat(100);record.result!.proposal!.evidenceHandles=['h'.repeat(100)];oldHistory.realExperiences[index].evidenceHandles=['h'.repeat(100)];}
 const oldUnchecked=runtime(oldHistory),oldCompact=Buffer.byteLength(JSON.stringify(oldUnchecked.simulation)),oldPretty=checkpointBytes(recoveryCheckpointPayload(oldUnchecked,store.historyId,1));t.diagnostic(JSON.stringify({oldCompactBytes:oldCompact,oldPersistedBytes:oldPretty}));assert.ok(oldCompact<1400000,`old compact ${oldCompact}`);assert.ok(oldPretty>MAX_CHECKPOINT_BYTES,`old pretty ${oldPretty}`);assert.doesNotThrow(()=>validateCheckpoint(oldHistory));
 await store.save(runtime(encoded));await atomicJson(join(directory,'near-capacity-named.json'),named);const loaded=await RecoveryStore.open({directory});assert.deepEqual((loaded.checkpoint as import('../server/branch-runtime.js').RuntimeCheckpoint).simulation,encoded);
 const rejected=structuredClone(candidate);rejected.requestId='too-large-request';rejected.selection.context.experiences=Array.from({length:8},()=>({interpretation:'\ud800'.repeat(1200),uncertainty:.6}));rejected.selection.context.shapes=Array.from({length:32},(_,index)=>({...candidate.selection.context.shapes[0],handle:'shape-'+index}));
 const before=sim.cognitionState().requests.length,admission=sim.enqueue(rejected);assert.equal(admission.input.admission,'queue_full');assert.ok(admission.events.some(event=>event.type==='INPUT_ADMITTED'&&event.data.reason==='checkpoint_capacity'));assert.equal(sim.cognitionState().requests.length,before);await store.save(runtime(sim.checkpoint()));
 const {BranchRegistry}=await import('../server/branch-registry.js');const registry=new BranchRegistry({directory:join(directory,'fork'),checkpoint:runtime(encoded),historyId:'history'});
 try {
  const saved=await registry.checkpoint(registry.live.target),experiment=await registry.fork(registry.live.target,saved.id,'near-capacity');
  for(let index=0;index<256;index++)experiment.applyControl({type:'synthetic-clock',sensed:true,attended:true,encoded:true,observedSeconds:1.2345678901234567e-100,uncertaintySeconds:1.2345678901234567e-100});
  const full=experiment.checkpoint();full.simulation.tick=100000;full.simulation.activity={status:'complete',cursor:100000,totalTicks:100000,appliedMilestones:Array.from({length:10000},(_,index)=>(index+1)*10),completionCount:1,activityId:1};
  assert.doesNotThrow(()=>validateRuntimeCheckpoint(full));const namedFull=namedCheckpointPayload(full,{worldId:'lumi',branchId:'near-capacity',historyId:'history',mode:'EXPERIMENT',createdAt:new Date().toISOString()});assert.ok(checkpointBytes(namedFull)<=MAX_CHECKPOINT_BYTES);await atomicJson(join(directory,'full-fork-named.json'),namedFull);await registry.checkpoint(experiment.target);
  t.diagnostic(JSON.stringify({forkSyntheticCount:full.simulation.experiences.length,fullActivityMilestones:full.simulation.activity.appliedMilestones.length,forkBytes:checkpointBytes(namedFull)}));
 } finally {await registry.close();}
 await base.close();
});

function pixelFixture() {const f=fixture();f.request.promptRevision=COGNITION_PROMPT_REVISION;f.request.schemaRevision=COGNITION_SCHEMA_REVISION;f.request.selection.context.shapes[0].uncertainty='geometry_candidates_pixel_checked';f.request.selection.context.shapes[0].qualityFlags=[];return f;}
test('current profile rejects unqualified geometry contexts and dropped/fabricated handles cannot encode',()=>{
 const old=fixture();old.request.promptRevision=COGNITION_PROMPT_REVISION;old.request.schemaRevision=COGNITION_SCHEMA_REVISION;old.enqueue(old.request);const events=old.sim.step();assert.equal(old.sim.cognitionState().requests.length,0);assert.ok(events.some(e=>e.data.reason==='unqualified_shape_context'));
 const f=pixelFixture();f.request.selection.context.shapes=[];f.enqueue(f.request);f.sim.step();f.enqueue(f.result({type:'inspect',handle:'shape'}));f.sim.step();assert.equal(f.sim.cognitionState().requests[0].encoding?.reason,'unknown_handle');assert.equal(f.sim.admittedExperiences().length,0);
});
test('current qualified handle inspection executes with normal fresh capture and exact replay/recovery',async t=>{
 const f=pixelFixture();f.enqueue(f.request);f.sim.step();const start=f.sim.checkpoint(),input=f.sim.enqueue(f.result({type:'inspect',handle:'shape'})).input;f.sim.step();for(let i=0;i<30;i++)f.sim.step();const end=f.sim.checkpoint();
 assert.equal(end.cognition.requests[0].action?.reason,'inspection_orient_started');assert.ok(f.sim.attentionState().pending?.reasons.includes('head_milestone'));assert.equal(f.sim.admittedExperiences().length,1);const offline=replay(start,[input],end.tick);assert.equal(offline.stateHash,hashCheckpoint(end));assert.equal(offline.eventHash,end.eventHash);
 const directory=await mkdtemp(join(tmpdir(),'lumi-pixel-recovery-'));t.after(()=>rm(directory,{recursive:true,force:true}));const base=new BranchRuntime({mode:'LIVE',worldId:'world',branchId:'live',historyId:'history',offline:true});try{const {store}=await RecoveryStore.open({directory});await store.save({...base.checkpoint(),simulation:end});const restored=await RecoveryStore.open({directory});assert.deepEqual((restored.checkpoint as import('../server/branch-runtime.js').RuntimeCheckpoint).simulation,end);}finally{await base.close();}
});
test('future provider context excludes legacy geometry-aided prose without altering stored history',async()=>{
 const {providerExperiences}=await import('../server/cognition/observation.js');const f=fixture();f.enqueue(f.request);f.sim.step();f.enqueue(f.result());f.sim.step();const cp=f.sim.checkpoint(),before=hashCheckpoint(cp);assert.equal(providerExperiences(cp,cp.cognition.identity).length,0);assert.equal(hashCheckpoint(cp),before);assert.equal(cp.realExperiences.length,1);
 const current=structuredClone(cp);current.cognition.requests[0].request.promptRevision=COGNITION_PROMPT_REVISION;current.cognition.requests[0].request.schemaRevision=COGNITION_SCHEMA_REVISION;assert.equal(providerExperiences(current,current.cognition.identity).length,1);
});


test('v4 deterministic reference validation keeps exact categories and independently rejects effects',()=>{
 for(const [category,change]of [
  ['observation_mismatch',(p:NonNullable<CognitionResultCommand['proposal']>)=>{p.observationId='other';}],
  ['frame_hash_mismatch',(p:NonNullable<CognitionResultCommand['proposal']>)=>{p.frameHash='b'.repeat(64);}],
  ['unknown_handle',(p:NonNullable<CognitionResultCommand['proposal']>)=>{p.evidenceHandles=['invented'];}],
 ] as const){const f=pixelFixture();f.enqueue(f.request);f.sim.step();const start=f.sim.checkpoint(),result=f.result();change(result.proposal!);const input=f.sim.enqueue(result).input;const events=f.sim.step(),end=f.sim.checkpoint();assert.equal(end.realExperiences.length,0);assert.equal(end.cognition.requests[0].action?.reason,category);assert.equal(end.cognition.requests[0].encoding?.reason,category);assert.ok(events.some(e=>e.data.reason===category));const offline=replay(start,[input],end.tick);assert.equal(offline.stateHash,hashCheckpoint(end));assert.equal(offline.eventHash,end.eventHash);}
});

test('v4 categorical provider failure persists without raw output and exactly replays through diagnostics',async t=>{
 const {FlightRecorder}=await import('../server/diagnostics/recorder.js');const {exportIncident,replayBundle}=await import('../server/diagnostics/bundle.js');
 const directory=await mkdtemp(join(tmpdir(),'lumi-cognition-rejected-bundle-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const f=pixelFixture();f.enqueue(f.request);f.sim.step();const base=new BranchRuntime({mode:'LIVE',worldId:'world',branchId:'live',historyId:'history',offline:true}),start={...base.checkpoint(),simulation:f.sim.checkpoint()};
 const runtime=new BranchRuntime({mode:'LIVE',worldId:'world',branchId:'live',historyId:'history',checkpoint:start,offline:true}),recorder=new FlightRecorder({directory,worldId:'world',branchId:'live',worldMode:'LIVE',runId:runtime.target.runId});recorder.captureRuntimeCheckpoint(start);
 const result:CognitionResultCommand={...f.result(),outcome:'malformed',proposal:null,validationError:'unknown_handle'};
 const cp=runtime.simulation.checkpoint(),input={sequence:cp.nextInputSequence,receivedTick:cp.tick,applyTick:cp.tick+1,command:result,admission:'queued' as const};
 const operations:import('../server/branch-runtime.js').RuntimeOperation[]=[{sequence:1,kind:'input',tick:cp.tick,input},{sequence:2,kind:'advance',tick:cp.tick,ticks:1,backlogMs:0,source:'scheduled'}];
 for(const operation of operations){runtime.replayOperation(operation);recorder.recordRuntimeOperation(operation);if(operation.kind==='input')recorder.recordInput(operation.input);for(const event of runtime.drainEvents())recorder.recordEvent(event);}
 const end=runtime.simulation.checkpoint() as CheckpointV5;assert.equal(end.cognition.requests[0].result?.validationError,'unknown_handle');assert.equal(end.cognition.requests[0].encoding?.reason,'unknown_handle');assert.doesNotThrow(()=>validateCheckpoint(end));
 recorder.captureRuntimeCheckpoint(runtime.checkpoint());await recorder.flush();try{const snapshot=await recorder.snapshotForExport();assert.ok(snapshot.records.some(record=>record.event_type==='COGNITION_RESULT'&&record.data.reason==='unknown_handle'));assert.ok(snapshot.records.some(record=>record.ordered_input?.command.type==='cognition_result'&&record.ordered_input.command.validationError==='unknown_handle'));const out=join(directory,'rejected.zip'),exported=await exportIncident({runDirectory:recorder.runDirectory,out});assert.equal(exported.manifest.evidence_status,'COMPLETE');const offline=await replayBundle(out);assert.equal(offline.status,'PASS');assert.equal(offline.stateHash,hashCheckpoint(end));assert.equal(offline.eventHash,end.eventHash);}finally{await recorder.close();await runtime.close();await base.close();}
});

test('pixel-qualified v3 memories remain eligible verbatim while earlier prompt memories stay excluded',async()=>{
 const {providerExperiences}=await import('../server/cognition/observation.js');const f=pixelFixture();f.request.promptRevision='lumi-vision-prompt-v3';f.request.schemaRevision='lumi-interpretation-v1';f.enqueue(f.request);f.sim.step();const result=f.result();result.proposal!.interpretation='I think the blue shape may be a chair, although I cannot tell.';f.enqueue(result);f.sim.step();const cp=f.sim.checkpoint(),before=hashCheckpoint(cp);assert.deepEqual(providerExperiences(cp,cp.cognition.identity),[{interpretation:result.proposal!.interpretation,uncertainty:.6}]);assert.equal(hashCheckpoint(cp),before);
 const legacy=structuredClone(cp);legacy.cognition.requests[0].request.promptRevision='lumi-vision-prompt-v2';assert.deepEqual(providerExperiences(legacy,legacy.cognition.identity),[]);assert.equal(legacy.realExperiences[0].interpretation,result.proposal!.interpretation);
});
