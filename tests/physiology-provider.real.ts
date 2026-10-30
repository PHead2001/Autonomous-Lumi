import { runPhysiologyVerification, verificationOptions } from '../server/cognition/verify.js';
import { CognitionProviders } from '../server/cognition/providers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorldServer } from '../server/world-server.js';
import { ChromiumRenderer } from '../server/vision/renderer.js';
import { loadCognitionConfig, safeCognitionConfig } from '../server/cognition/config.js';
import type { CognitionProviderClient } from '../server/cognition/coordinator.js';
import type { InterpretationInput } from '../server/cognition/providers.js';
const waitFor=(predicate:()=>boolean)=>new Promise<void>((done,reject)=>{const deadline=setTimeout(()=>{clearInterval(timer);reject(new Error('Preflight timeout'));},10000),timer=setInterval(()=>{if(predicate()){clearTimeout(deadline);clearInterval(timer);done();}},20);});
test('actual renderer and FAKE provider preflight attends before an independently requested head milestone frame',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'lumi-body-wire-real-'));
 const config=loadCognitionConfig({loadEnv:false,env:{LUMI_COGNITION_ENABLED:'true',OPENROUTER_API_KEY:'FAKE-NO-TRANSPORT'}});let calls=0,sent:InterpretationInput|null=null;
 const providers:CognitionProviderClient={budget:{snapshot:async()=>({ceilingUsd:1,accountedUsd:0,pending:0,unknown:0,reportedUsd:0,estimatedUsd:0})},status:()=>({...safeCognitionConfig(config),pending:0,queued:0}),interpret:async input=>{calls++;sent=input;return {status:'refused',content:null,provider:'openrouter',model:'FAKE/offline',modelRevision:null,latencyMs:0,attempts:0,inputTokens:null,outputTokens:null,costUsd:null,costBasis:'unknown',reservedUsd:0};}};
 const world=createWorldServer({historyId:'fake-provider-body-preflight',diagnosticsDirectory:directory,renderer:new ChromiumRenderer(),physiology:{active:true,genesisPreset:'acceptance-fast-v1'},cognition:{config,providers}});
 try{
  await world.listen(0);await waitFor(()=>{const cp=world.simulation.checkpoint();return cp.schemaVersion===6&&cp.interoception.transient.length>0;});assert.equal(calls,0);
  world.registry.live.enqueue({type:'turn_head',yawDelta:.15,pitchDelta:0,sceneRevision:world.simulation.snapshot().scene!.revision});
  await waitFor(()=>calls===1);const input=sent as InterpretationInput|null;assert.ok(input);assert.deepEqual(input.context.internalSensations,[{kind:'hunger',band:'severe',description:'My stomach feels insistently empty.',uncertainty:'coarse_internal_signal'}]);
  const cp=world.simulation.checkpoint();if(cp.schemaVersion!==6)throw new Error('Schema6 required');assert.equal(cp.cognition.requests[0].request.promptRevision,'lumi-vision-prompt-v5');
  assert.equal(cp.cognition.requests[0].request.selection.source,'actual_renderer');assert.equal(cp.body.lastEffectSequence,0);assert.equal(cp.physiology.origin.evidenceEligibility,'eligible');assert.equal(calls,1);
  t.diagnostic(JSON.stringify({externalCalls:0,profile:'lumi-vision-prompt-v5',attendedSensations:input.context.internalSensations,source:cp.cognition.requests[0].request.selection.source}));
 }finally{await world.close();await rm(directory,{recursive:true,force:true});}
});

for(const failureStage of ['initial-close','restored-close','restart-listen'] as const)test(`physiology verification preserves normalized response and evidence after ${failureStage} failure without external calls`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lumi-physiology-cleanup-'));
 const config=loadCognitionConfig({loadEnv:false,env:{LUMI_COGNITION_ENABLED:'true',OPENROUTER_API_KEY:'FAKE-NO-EXTERNAL-CALLS',LUMI_COGNITION_BUDGET_DIRECTORY:join(directory,'budget'),LUMI_COGNITION_MIN_REAL_INTERVAL_MS:'100'}});
 const options=verificationOptions(['--paid','--physiology','--out',directory]);let normalizedCalls=0,worldIndex=0;const worlds:ReturnType<typeof createWorldServer>[]=[];

 try{
  const report=await runPhysiologyVerification(options,config,{
   createProvider:(settings,ledger)=>new CognitionProviders(settings,ledger,async()=>{normalizedCalls++;return Response.json({model:'qwen/qwen3.7-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify({interpretation:'FAKE transport: an uncertain room image.',uncertainty:.9,evidenceHandles:[],action:{type:'continue'}})}}],usage:{prompt_tokens:100,completion_tokens:40,cost:.00001}});}),
   createWorld:settings=>{const index=++worldIndex,world=createWorldServer({...settings,renderer:new ChromiumRenderer()});worlds.push(world);return {...world,listen:index===2&&failureStage==='restart-listen'?async()=>{throw new Error('PRIVATE restart error');}:world.listen,close:async()=>{await world.close();if(index===1&&failureStage==='initial-close'||index===2&&failureStage==='restored-close')throw new Error('PRIVATE cleanup error');}};},
  });
  assert.equal(normalizedCalls,1);assert.equal(report.actualProviderAcceptance,false);assert.equal(report.status,'failed');
  if(!('requests' in report))throw new Error('Missing completed-response evidence');
  assert.equal(report.requests[0].status,'success');assert.equal(report.mainCalls,1);assert.equal(report.inputs.length,1);assert.ok(report.internalEncodedCount>0);
  assert.ok(report.budgetAfter);assert.equal(report.budgetAfter.reportedUsd,.00001);assert.equal(report.sentInternalSensations[0].kind,'hunger');
  assert.equal(report.bundle?.evidence,'COMPLETE');assert.equal(report.bundle?.replay.status,'PASS');
  assert.ok(report.failures.includes(failureStage==='restart-listen'?'restart_verification_failed':'runtime_cleanup_failed'));
  if(failureStage==='initial-close')assert.equal(report.cleanup.runtime,'failed');
  if(failureStage==='restored-close')assert.equal(report.cleanup.restartRuntime,'failed');
  if(failureStage==='restart-listen')assert.equal(report.internalExperienceSurvivedRestart,false);
  const saved=JSON.parse(await readFile(join(directory,'physiology-verification.json'),'utf8'));assert.equal(saved.actualProviderAcceptance,false);assert.equal(saved.requests[0].status,'success');assert.equal(saved.inputs.length,1);
  assert.equal(JSON.parse(await readFile(join(directory,'input-evidence.json'),'utf8')).length,1);assert.equal(JSON.stringify(saved).includes('PRIVATE'),false);
 }finally{await Promise.all(worlds.map(world=>world.close()));await rm(directory,{recursive:true,force:true});}
});
