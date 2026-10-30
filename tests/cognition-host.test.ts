import { CognitionSimulation, PhysiologySimulation, validateCheckpoint, type CheckpointV7 } from '../server/simulation.js';
import { RecoveryStore } from '../server/recovery-store.js';
import { eyePose } from '../shared/eye-pose.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { BranchRuntime } from '../server/branch-runtime.js';
import { CaptureManager } from '../server/vision/capture-manager.js';
import { AutomaticCaptureCoordinator } from '../server/vision/auto-capture.js';
import { CognitionCoordinator,type CognitionProviderClient } from '../server/cognition/coordinator.js';
import { assembleCognitionObservation, providerExperiences } from '../server/cognition/observation.js';
import { loadCognitionConfig,safeCognitionConfig,type CognitionConfig } from '../server/cognition/config.js';
import type { InterpretationInput,ProviderResult } from '../server/cognition/providers.js';
import type { FrameRenderer,RenderedFrame } from '../server/vision/renderer.js';
import { createVisibilityFixture } from '../shared/vision-fixture.js';
import { createWorldServer } from '../server/world-server.js';

const turn=()=>new Promise<void>(done=>setImmediate(done));
const config=(enabled=true)=>loadCognitionConfig({loadEnv:false,env:enabled?{LUMI_COGNITION_ENABLED:'true',OPENROUTER_API_KEY:'mock-key',LUMI_COGNITION_MIN_REAL_INTERVAL_MS:'100',LUMI_COGNITION_MIN_WORLD_INTERVAL_SECONDS:'1'}:{}});
class MockRenderer implements FrameRenderer {
  calls:{width:number;height:number}[]=[];
  value=180;
  async render(_snapshot:unknown,width:number,height:number):Promise<RenderedFrame>{this.calls.push({width,height});const png=new PNG({width,height});png.data.fill(this.value);return {bytes:PNG.sync.write(png),backend:{configuration:'angle-d3d11',chromium:'MOCK offline fixture',webglVendor:'mock',webglRenderer:'mock',version:'mock',flags:[]}};}
  async close(){}
}
class MockProviders implements CognitionProviderClient {
  calls:InterpretationInput[]=[];private resolve:((r:ProviderResult)=>void)|undefined;
  constructor(private config:CognitionConfig){}
  budget={snapshot:async()=>({ceilingUsd:1,accountedUsd:0,pending:0,unknown:0,reportedUsd:0,estimatedUsd:0})};
  status(){return {...safeCognitionConfig(this.config),pending:this.calls.length,queued:0};}
  interpret(input:InterpretationInput):Promise<ProviderResult>{this.calls.push(input);return new Promise(done=>{this.resolve=done;});}
  finish(content?:string,status:ProviderResult['status']='ok'){
    const context=this.calls[0].context;
    this.resolve?.({status,content:content??JSON.stringify({observationId:context.observationId,frameHash:context.frameHash,interpretation:'MOCK: a fallible visible shape.',uncertainty:.6,evidenceHandles:context.shapes.slice(0,1).map(s=>s.handle),action:{type:'continue'}}),provider:'openrouter',model:'mock/offline',modelRevision:null,latencyMs:12,attempts:1,inputTokens:null,outputTokens:null,costUsd:null,costBasis:'unknown',reservedUsd:0});
  }
}
async function fixture(probe=false,physiology=false){
  const directory=await mkdtemp(join(tmpdir(),'lumi-cognition-host-'));
  const source=new BranchRuntime({worldId:'host-fixture',branchId:'experiment',historyId:'mock-history',mode:'EXPERIMENT',offline:true,...(physiology?{physiology:{active:true,genesisPreset:'acceptance-fast-v1' as const,encodingEnabled:false}}:{})}),checkpoint=source.checkpoint();await source.close();
  const cp=checkpoint.simulation;if(cp.schemaVersion!==5&&cp.schemaVersion!==7)throw new Error('Current cognition schema required');
  const visual=createVisibilityFixture();cp.character=visual.character;cp.scene=visual.scene!;cp.head=visual.head!;cp.pauseUntilTick=100000;
  cp.attention.pending={id:1,createdTick:0,expiresTick:300,reasons:['activity_outcome'],triggers:[{reason:'activity_outcome',tick:0,parentSequence:null}],parentSequence:null,status:'pending',captureId:null,requestedTick:null};cp.attention.nextIntentId=2;
  if(probe){cp.attention.pending.reasons=['uncertainty_probe'];cp.attention.pending.triggers=[{reason:'uncertainty_probe',tick:0,parentSequence:null}];cp.attention.config.probeIntervalTicks=100;}
  const runtime=new BranchRuntime({worldId:'host-fixture',branchId:'experiment',historyId:'mock-history',mode:'EXPERIMENT',checkpoint,directory});await runtime.prepare();
  const renderer=new MockRenderer(),manager=new CaptureManager(()=>true,renderer),settings=config(),providers=new MockProviders(settings);
  let current=true;
  const clock={now:1000};
  const cognition=new CognitionCoordinator(settings,providers,manager,()=>current,'mock-history',()=>clock.now);
  const automatic=new AutomaticCaptureCoordinator(manager,()=>current,()=>clock.now,(r,i)=>cognition.selectedCapture(r,i));
  return {directory,runtime,renderer,manager,providers,cognition,automatic,clock,settings,retire:()=>{current=false;},close:async()=>{automatic.close();cognition.close([runtime]);await manager.close();await runtime.close();await rm(directory,{recursive:true,force:true});}};
}
async function selected(f:Awaited<ReturnType<typeof fixture>>){
  f.automatic.pump([f.runtime]);const request=f.manager.view(f.runtime.target).latest!;
  f.runtime.simulation.step();await f.manager.wait(f.runtime.target,request.captureId);await turn();f.runtime.simulation.step();
  return request;
}
test('MOCK host sends copied exact selected 512 PNG only after ordered request; context is allowlisted and world continues',async()=>{
  const f=await fixture();
  try{
    const request=await selected(f);assert.equal(request.width,512);assert.equal(f.renderer.calls.length,1);
    assembleCognitionObservation(f.runtime,f.manager,request.captureId,{...f.runtime.target,historyId:'mock-history',mode:'EXPERIMENT'},1_000_000,24_576);
    f.cognition.pump([f.runtime]);assert.equal(f.providers.calls.length,0);
    const queued=f.runtime.simulation.checkpoint().pendingInputs;assert.equal(queued.at(-1)?.command.type,'cognition_request');
    // Evict the original sensor cache after the host has copied its selected bytes.
    for(let i=0;i<5;i++){const extra=f.manager.request(f.runtime,{reason:'developer'});await f.manager.wait(f.runtime.target,extra.captureId);}
    assert.throws(()=>f.manager.observation(f.runtime.target,request.captureId),/evicted/);
    f.runtime.simulation.step();f.cognition.pump([f.runtime]);assert.equal(f.providers.calls.length,1);
    const sent=f.providers.calls[0];assert.equal(PNG.sync.read(Buffer.from(sent.png)).width,512);
    assert.equal(sent.context.observationId,request.captureId);assert.equal(sent.context.sound,null);
    const json=JSON.stringify(sent.context);for(const forbidden of ['fixture-','engineTargetId','position','sceneRevision','capturedTick','historyId','TEST STUB','totalTicks','bodyHeading'])assert.ok(!json.includes(forbidden),forbidden);
    f.runtime.enqueue({type:'slam'});const before=f.runtime.simulation.state.tick;f.runtime.simulation.step();assert.equal(f.runtime.simulation.state.tick,before+1);assert.ok(f.runtime.simulation.state.reflex.strength>0);
    assert.equal((await f.cognition.summary(f.runtime)).worldSecondsPerModelResponse,null);
    f.providers.finish();await turn();
    let cp=f.runtime.simulation.checkpoint();assert.equal(cp.schemaVersion,7);if(cp.schemaVersion!==7)throw new Error();assert.equal(cp.cognition.requests[0].status,'pending','provider callback only enqueues');
    f.runtime.simulation.step();cp=f.runtime.simulation.checkpoint();if(cp.schemaVersion!==5&&cp.schemaVersion!==7)throw new Error();
    assert.equal(cp.cognition.requests[0].result?.outcome,'success');assert.equal(cp.cognition.requests[0].encoding?.reason,'test_source');assert.equal(cp.realExperiences.length,0);
    assert.ok((await f.cognition.summary(f.runtime)).worldSecondsPerModelResponse!==null);
    f.cognition.pump([f.runtime]);assert.equal(f.providers.calls.length,1);
  }finally{await f.close();}
});
test('MOCK malformed and retired callbacks cannot directly execute or mutate a replacement run',async()=>{
  const f=await fixture();
  try{
    await selected(f);f.cognition.pump([f.runtime]);f.runtime.simulation.step();f.cognition.pump([f.runtime]);
    f.providers.finish('{"privileged":true}');await turn();f.runtime.simulation.step();
    const cp=f.runtime.simulation.checkpoint();if(cp.schemaVersion!==5&&cp.schemaVersion!==7)throw new Error();
    assert.equal(cp.cognition.requests[0].result?.outcome,'malformed');assert.equal(cp.realExperiences.length,0);assert.equal(cp.cognition.requests[0].action,null);
  }finally{await f.close();}
  const retired=await fixture();
  try{
    await selected(retired);retired.cognition.pump([retired.runtime]);retired.runtime.simulation.step();retired.cognition.pump([retired.runtime]);
    const before=retired.runtime.simulation.checkpoint();retired.retire();retired.cognition.retire(retired.runtime.target);retired.providers.finish();await turn();
    assert.deepEqual(retired.runtime.simulation.checkpoint(),before);
  }finally{await retired.close();}
});
test('MOCK restored pending work is reconciled once without a provider resend, even when cognition disabled',async()=>{
  const f=await fixture();let restored:BranchRuntime|undefined;
  try{
    await selected(f);f.cognition.pump([f.runtime]);f.runtime.simulation.step();
    restored=new BranchRuntime({worldId:f.runtime.target.worldId,branchId:f.runtime.target.branchId,historyId:'mock-history',mode:'EXPERIMENT',checkpoint:f.runtime.checkpoint(),directory:f.directory});await restored.prepare();
    const settings=config(false),providers=new MockProviders(settings),host=new CognitionCoordinator(settings,providers,f.manager,()=>true,'mock-history');
    for(let i=0;i<restored.simulation.checkpoint().config.maxPendingInputs;i++)restored.enqueue({type:'invalid',reason:'unknown_command'});
    const saturated=restored.simulation.checkpoint();for(let i=0;i<10;i++)host.pump([restored]);
    assert.deepEqual(restored.simulation.checkpoint(),saturated,'a full queue neither drops reconciliation nor creates retry admissions');
    restored.simulation.step();for(let i=0;i<10;i++)host.pump([restored]);
    assert.equal(restored.simulation.checkpoint().pendingInputs.filter(i=>i.command.type==='cognition_result').length,1);assert.equal(providers.calls.length,0);
    restored.simulation.step();const cp=restored.simulation.checkpoint();if(cp.schemaVersion!==5&&cp.schemaVersion!==7)throw new Error();assert.equal(cp.cognition.requests[0].result?.outcome,'interrupted');host.close([restored]);
  }finally{await restored?.close();await f.close();}
});
test('MOCK terminal result waits for ordered queue capacity without dropping or resending paid work',async()=>{
  const f=await fixture();
  try{
    await selected(f);f.cognition.pump([f.runtime]);f.runtime.simulation.step();f.cognition.pump([f.runtime]);assert.equal(f.providers.calls.length,1);
    for(let i=0;i<f.runtime.simulation.checkpoint().config.maxPendingInputs;i++)f.runtime.enqueue({type:'invalid',reason:'unknown_command'});
    f.providers.finish();await turn();const saturated=f.runtime.simulation.checkpoint();
    for(let i=0;i<10;i++)f.cognition.pump([f.runtime]);assert.deepEqual(f.runtime.simulation.checkpoint(),saturated);
    f.runtime.simulation.step();f.cognition.pump([f.runtime]);
    assert.equal(f.runtime.simulation.checkpoint().pendingInputs.filter(i=>i.command.type==='cognition_result').length,1);
    f.runtime.simulation.step();const cp=f.runtime.simulation.checkpoint();if(cp.schemaVersion!==5&&cp.schemaVersion!==7)throw new Error();assert.equal(cp.cognition.requests[0].result?.outcome,'success');assert.equal(f.providers.calls.length,1);
  }finally{await f.close();}
});
test('MOCK restored host derives configured world cadence from accepted checkpoint requests',async()=>{
  const f=await fixture();let restored:BranchRuntime|undefined;
  try{
    f.settings.limits.minWorldIntervalSeconds=20;
    await selected(f);f.cognition.pump([f.runtime]);f.runtime.simulation.step();f.cognition.pump([f.runtime]);f.providers.finish();await turn();f.runtime.simulation.step();
    while(f.runtime.simulation.state.tick<100)f.runtime.simulation.step();
    restored=new BranchRuntime({worldId:f.runtime.target.worldId,branchId:f.runtime.target.branchId,historyId:'mock-history',mode:'EXPERIMENT',checkpoint:f.runtime.checkpoint(),directory:f.directory});await restored.prepare();
    const fresh=new CognitionCoordinator(f.settings,f.providers,f.manager,()=>true,'mock-history',()=>1_000_000);
    const intent={id:2,createdTick:100,expiresTick:900,reasons:['activity_outcome' as const],triggers:[{reason:'activity_outcome' as const,tick:100,parentSequence:null}],parentSequence:null,status:'pending' as const,captureId:null,requestedTick:null};
    const before=restored.simulation.checkpoint();if(before.schemaVersion!==5&&before.schemaVersion!==7)throw new Error();assert.ok(before.tick>=before.cognition.nextRequestTick,'fixed local cooldown has elapsed');
    assert.equal(fresh.selectedCapture(restored,intent),false,'a new host must retain the configured 20-second world request interval');
    const nextTick=before.cognition.requests[0].requestedTick+20*before.config.hz;
    while(restored.simulation.state.tick<nextTick)restored.simulation.step();
    assert.equal(fresh.selectedCapture(restored,{...intent,createdTick:nextTick}),true,'a fresh eligible capture becomes available at the recorded request deadline');
    assert.equal(f.providers.calls.length,1,'cadence inspection never redispatches the completed request');fresh.close([restored]);
  }finally{await restored?.close();await f.close();}
});
test('MOCK changed 256 probe obtains an ordered selected 512 followup before interpretation',async()=>{
  const f=await fixture(true);
  try{
    const first=await selected(f);assert.equal(first.width,256);f.cognition.pump([f.runtime]);assert.equal(f.providers.calls.length,0);
    f.renderer.value=40;f.clock.now+=5000;
    while(true){const cp=f.runtime.simulation.checkpoint();if(cp.schemaVersion!==5&&cp.schemaVersion!==7)throw new Error();if(cp.attention.pending)break;f.runtime.simulation.step();assert.ok(f.runtime.simulation.state.tick<200);}
    const changed=await selected(f);assert.equal(changed.width,256);
    let cp=f.runtime.simulation.checkpoint();if(cp.schemaVersion!==5&&cp.schemaVersion!==7)throw new Error();assert.ok(cp.attention.lastCapture?.reasons.includes('visible_change'));
    f.cognition.pump([f.runtime]);assert.equal(f.providers.calls.length,0);assert.equal(f.runtime.simulation.checkpoint().pendingInputs.at(-1)?.command.type,'cognition_observation_request');
    f.runtime.simulation.step();f.clock.now+=5000;
    while(true){cp=f.runtime.simulation.checkpoint();if(cp.schemaVersion!==5&&cp.schemaVersion!==7)throw new Error();if(cp.attention.pending)break;f.runtime.simulation.step();assert.ok(f.runtime.simulation.state.tick<400);}
    const richer=await selected(f);assert.equal(richer.width,512);
    f.cognition.pump([f.runtime]);f.runtime.simulation.step();f.cognition.pump([f.runtime]);assert.equal(f.providers.calls.length,1);assert.equal(f.providers.calls[0].context.observationId,richer.captureId);assert.notEqual(richer.captureId,changed.captureId);
    f.providers.finish();await turn();f.runtime.simulation.step();
  }finally{await f.close();}
});
test('manual captures never become attended cognition, disabled/keyless preserves 256 probes, evicted selection fails explicitly',async()=>{
  const f=await fixture();
  try{
    const settings=loadCognitionConfig({loadEnv:false,env:{LUMI_COGNITION_ENABLED:'true'}}),providers=new MockProviders(settings),host=new CognitionCoordinator(settings,providers,f.manager,()=>true,'mock-history');
    const probe=new AutomaticCaptureCoordinator(f.manager,()=>true,()=>1000,(r,i)=>host.selectedCapture(r,i));probe.pump([f.runtime]);const requested=f.manager.view(f.runtime.target).latest!;assert.equal(requested.width,256);await f.manager.wait(f.runtime.target,requested.captureId);await turn();f.runtime.simulation.step();
    const manual=f.manager.request(f.runtime,{reason:'developer'});await f.manager.wait(f.runtime.target,manual.captureId);host.pump([f.runtime]);assert.equal(providers.calls.length,0);
    assert.throws(()=>assembleCognitionObservation(f.runtime,f.manager,manual.captureId,{...f.runtime.target,historyId:'mock-history',mode:'EXPERIMENT'},1_000_000,24_576),/association/);
    probe.close();host.close([f.runtime]);
  }finally{await f.close();}
});
test('cognition status uses private loopback boundary, redacts keys and reports N/A without responses',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'lumi-cognition-http-')),settings=config(false),providers=new MockProviders(settings),world=createWorldServer({diagnosticsDirectory:directory,autoSchedule:false,cognition:{config:settings,providers}});
  try{
    const port=await world.listen(0),query=new URLSearchParams({...world.registry.live.target}),url=`http://127.0.0.1:${port}/api/cognition?${query}`;
    const result=await fetch(url);assert.equal(result.status,200);const json=await result.json();assert.equal(json.worldSecondsPerModelResponse,null);assert.equal(json.configuration.main.enabled,false);assert.equal(json.decisions.liveEnabled,false);
    assert.ok(!JSON.stringify(json).includes('mock-key'));assert.equal((await fetch(url,{headers:{Origin:'https://hostile.example'}})).status,403);
  }finally{await world.close();await rm(directory,{recursive:true,force:true});}
});

 test('active schema6 assembles attended unencoded sensations into explicit v5 context without triggering a camera or provider for the need',async()=>{
  const f=await fixture(false,true);
  try{
    for(let i=0;i<31*30&&!(f.runtime.simulation.checkpoint() as CheckpointV7).interoception.transient.some(s=>s.percept.kind==='hunger'&&s.percept.band==='severe');i++)f.runtime.simulation.step();
    assert.equal(f.providers.calls.length,0);assert.equal(f.renderer.calls.length,0);
    const cp=f.runtime.simulation.checkpoint();if(cp.schemaVersion!==7)throw new Error('Schema6 required');
    assert.equal(cp.internalExperiences.length,0);
    assert.equal(cp.interoception.transient[0].percept.band,'severe');
    const capture=await selected(f);
    const assembled=assembleCognitionObservation(f.runtime,f.manager,capture.captureId,{...f.runtime.target,historyId:'mock-history',mode:'EXPERIMENT'},1_000_000,24_576);
    assert.deepEqual(assembled.selection.context.internalSensations,[{kind:'hunger',band:'severe',description:'My stomach feels insistently empty.',uncertainty:'coarse_internal_signal'}]);
    f.cognition.pump([f.runtime]);
    const queued=f.runtime.simulation.checkpoint().pendingInputs.find(i=>i.command.type==='cognition_request')!;
    assert.equal(queued.command.type==='cognition_request'&&queued.command.promptRevision,'lumi-vision-prompt-v5');
    f.runtime.simulation.step();f.cognition.pump([f.runtime]);
    assert.equal(f.providers.calls.length,1);
    assert.deepEqual(f.providers.calls[0].context.internalSensations,assembled.selection.context.internalSensations);
    const wire=JSON.stringify(f.providers.calls[0].context);
    for(const secret of ['satiety','reserves','sleepPressure','condition','fatigue','genesisPreset','crossingTick','attentionId','internal-observation','physiology'])assert.equal(wire.includes(secret),false,secret);
    assert.equal(f.runtime.simulation.checkpoint().schemaVersion,7);
  }finally{await f.close();}
});

test('provider context preserves verified imported LIVE ancestors verbatim and rejects foreign epochs or experiment records',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lumi-provider-ancestor-'));
 const initial=new CognitionSimulation({mode:'LIVE',worldId:'lumi',branchId:'live',historyId:'provider-source-history',runId:'source-run'}).checkpoint();
 initial.pauseUntilTick=10000;initial.character.moving=false;initial.attention.pending={id:1,createdTick:0,expiresTick:300,reasons:['activity_outcome'],triggers:[{reason:'activity_outcome',tick:0,parentSequence:null}],parentSequence:null,status:'pending',captureId:null,requestedTick:null};initial.attention.nextIntentId=2;
 // Explicit normalized sensor fixture: this test checks history admission, with
 // no renderer, provider transport, owner history or paid work.
 const source=new CognitionSimulation({mode:'LIVE',checkpoint:initial,historical:true}),eye=eyePose(source.snapshot()),pose={x:eye.position[0],y:eye.position[1],z:eye.position[2],bodyHeading:eye.bodyHeading,headYaw:eye.headYaw,headPitch:eye.headPitch},frameHash='a'.repeat(64),identity=initial.cognition.identity;
 source.enqueue({type:'sensor_feedback',intentId:1,stage:'admitted',captureId:'source-frame',capturedTick:0,sceneRevision:0,pose,outcome:'success',signature:null,frameHash:null});source.step();
 source.enqueue({type:'sensor_feedback',intentId:1,stage:'result',captureId:'source-frame',capturedTick:0,sceneRevision:0,pose,outcome:'success',signature:Array(48).fill(10),frameHash});source.step();
 source.enqueue({type:'cognition_request',purpose:'interpretation',requestId:'source-memory',selection:{identity,captureId:'source-frame',observationId:'source-observation',frameHash,intentId:1,capturedTick:0,attentionTick:2,pose,source:'actual_renderer',context:{observationId:'source-observation',frameHash,shapes:[],sound:null,activity:{status:'idle'},experiences:[]}},provider:'fixture',model:'offline',promptRevision:'lumi-vision-prompt-v3',schemaRevision:'lumi-interpretation-v1'});source.step();
 source.enqueue({type:'cognition_result',requestId:'source-memory',identity,outcome:'success',proposal:{observationId:'source-observation',frameHash,interpretation:'I see a dim room, but cannot identify the shape.',uncertainty:.7,evidenceHandles:[],action:{type:'continue'}},metrics:{latencyMs:0,attempts:1,inputTokens:null,outputTokens:null,costUsd:null,costBasis:'unknown',modelRevision:null}});source.step();
 const migrated=new PhysiologySimulation({mode:'LIVE',checkpoint:source.checkpoint(),historical:true}).checkpoint(),base=new BranchRuntime({worldId:'lumi',branchId:'live',historyId:identity.historyId,mode:'LIVE',offline:true}),envelope={...base.checkpoint(),simulation:migrated};await base.close();
 assert.equal(migrated.realExperiences.length,1);const original=structuredClone(migrated.realExperiences[0]);
 const opened=await RecoveryStore.open({directory,checkpoint:envelope});
 const app=createWorldServer({checkpoint:opened.checkpoint,recoveryStore:opened.store,diagnosticsDirectory:directory,autoSchedule:false,automaticCaptures:false,cognition:{config:config(false)}});
 try{
  await app.listen(0);const cp=app.registry.live.simulation.checkpoint();if(cp.schemaVersion!==7)throw new Error('Schema6 required');
  assert.doesNotThrow(()=>validateCheckpoint(cp));assert.notEqual(cp.cognition.identity.historyId,original.identity.historyId);assert.deepEqual(cp.realExperiences[0],original);
  const expected=[{interpretation:original.interpretation,uncertainty:original.uncertainty}];assert.deepEqual(providerExperiences(cp,cp.cognition.identity),expected);
  assert.deepEqual(providerExperiences(cp,{...cp.cognition.identity,historyId:original.identity.historyId}),[],'a mismatched selection identity cannot borrow the ancestry');
  for(const mutate of [
   (x:typeof cp)=>{x.realExperiences[0].identity.historyId='unverified-history';},
   (x:typeof cp)=>{x.realExperiences[0].encodedTick=cp.physiology.verifiedCheckpointImports[0].importTick+1;},
   (x:typeof cp)=>{x.realExperiences[0].identity.mode='EXPERIMENT';},
   (x:typeof cp)=>{x.realExperiences[0].identity.worldId='another-world';},
   (x:typeof cp)=>{x.cognition.requests[0].request.promptRevision='lumi-vision-prompt-v2';},
  ]){const adversarial:CheckpointV7=structuredClone(cp);mutate(adversarial);assert.deepEqual(providerExperiences(adversarial,cp.cognition.identity),[]);}
  assert.deepEqual(cp.realExperiences[0],original,'selection never rewrites admitted source records');
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
