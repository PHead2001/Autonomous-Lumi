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
import { assembleCognitionObservation } from '../server/cognition/observation.js';
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
async function fixture(probe=false){
  const directory=await mkdtemp(join(tmpdir(),'lumi-cognition-host-'));
  const source=new BranchRuntime({worldId:'host-fixture',branchId:'experiment',historyId:'mock-history',mode:'EXPERIMENT',offline:true}),checkpoint=source.checkpoint();await source.close();
  const cp=checkpoint.simulation;if(cp.schemaVersion!==5)throw new Error('Current cognition schema required');
  const visual=createVisibilityFixture();cp.character=visual.character;cp.scene=visual.scene!;cp.head=visual.head!;cp.pauseUntilTick=100000;
  cp.attention.pending={id:1,createdTick:0,expiresTick:300,reasons:['activity_outcome'],triggers:[{reason:'activity_outcome',tick:0,parentSequence:null}],parentSequence:null,status:'pending',captureId:null,requestedTick:null};cp.attention.nextIntentId=2;
  if(probe){cp.attention.pending.reasons=['uncertainty_probe'];cp.attention.pending.triggers=[{reason:'uncertainty_probe',tick:0,parentSequence:null}];cp.attention.config.probeIntervalTicks=100;}
  const runtime=new BranchRuntime({worldId:'host-fixture',branchId:'experiment',historyId:'mock-history',mode:'EXPERIMENT',checkpoint,directory});await runtime.prepare();
  const renderer=new MockRenderer(),manager=new CaptureManager(()=>true,renderer),settings=config(),providers=new MockProviders(settings);
  let current=true;
  const clock={now:1000};
  const cognition=new CognitionCoordinator(settings,providers,manager,()=>current,'mock-history',()=>clock.now);
  const automatic=new AutomaticCaptureCoordinator(manager,()=>current,()=>clock.now,(r,i)=>cognition.selectedCapture(r,i));
  return {directory,runtime,renderer,manager,providers,cognition,automatic,clock,retire:()=>{current=false;},close:async()=>{automatic.close();cognition.close([runtime]);await manager.close();await runtime.close();await rm(directory,{recursive:true,force:true});}};
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
    let cp=f.runtime.simulation.checkpoint();assert.equal(cp.schemaVersion,5);if(cp.schemaVersion!==5)throw new Error();assert.equal(cp.cognition.requests[0].status,'pending','provider callback only enqueues');
    f.runtime.simulation.step();cp=f.runtime.simulation.checkpoint();if(cp.schemaVersion!==5)throw new Error();
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
    const cp=f.runtime.simulation.checkpoint();if(cp.schemaVersion!==5)throw new Error();
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
    restored.simulation.step();const cp=restored.simulation.checkpoint();if(cp.schemaVersion!==5)throw new Error();assert.equal(cp.cognition.requests[0].result?.outcome,'interrupted');host.close([restored]);
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
    f.runtime.simulation.step();const cp=f.runtime.simulation.checkpoint();if(cp.schemaVersion!==5)throw new Error();assert.equal(cp.cognition.requests[0].result?.outcome,'success');assert.equal(f.providers.calls.length,1);
  }finally{await f.close();}
});
test('MOCK changed 256 probe obtains an ordered selected 512 followup before interpretation',async()=>{
  const f=await fixture(true);
  try{
    const first=await selected(f);assert.equal(first.width,256);f.cognition.pump([f.runtime]);assert.equal(f.providers.calls.length,0);
    f.renderer.value=40;f.clock.now+=5000;
    while(true){const cp=f.runtime.simulation.checkpoint();if(cp.schemaVersion!==5)throw new Error();if(cp.attention.pending)break;f.runtime.simulation.step();assert.ok(f.runtime.simulation.state.tick<200);}
    const changed=await selected(f);assert.equal(changed.width,256);
    let cp=f.runtime.simulation.checkpoint();if(cp.schemaVersion!==5)throw new Error();assert.ok(cp.attention.lastCapture?.reasons.includes('visible_change'));
    f.cognition.pump([f.runtime]);assert.equal(f.providers.calls.length,0);assert.equal(f.runtime.simulation.checkpoint().pendingInputs.at(-1)?.command.type,'cognition_observation_request');
    f.runtime.simulation.step();f.clock.now+=5000;
    while(true){cp=f.runtime.simulation.checkpoint();if(cp.schemaVersion!==5)throw new Error();if(cp.attention.pending)break;f.runtime.simulation.step();assert.ok(f.runtime.simulation.state.tick<400);}
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
