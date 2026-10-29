import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BranchRuntime } from '../server/branch-runtime.js';
import { CaptureManager } from '../server/vision/capture-manager.js';
import { AutomaticCaptureCoordinator } from '../server/vision/auto-capture.js';
import { ChromiumRenderer } from '../server/vision/renderer.js';
import { CognitionCoordinator } from '../server/cognition/coordinator.js';
import { CognitionProviders } from '../server/cognition/providers.js';
import { DurableBudget } from '../server/cognition/budget.js';
import { loadCognitionConfig } from '../server/cognition/config.js';
import { createVisibilityFixture } from '../shared/vision-fixture.js';
import { COGNITION_PROMPT_REVISION, COGNITION_SCHEMA_REVISION } from '../shared/cognition-protocol.js';

// Explicit real-browser regression; npm test remains offline and has no browser requirement.
for(const black of [false,true])test(`actual renderer + FAKE provider ${black?'black image rejects fabricated handle without encoding':'visible image inspects and encodes supported hint'}`,async t=>{
 const directory=await mkdtemp(join(tmpdir(),'lumi-pixel-qualified-real-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const source=new BranchRuntime({mode:'LIVE',worldId:'pixel-qualified-real',branchId:'live',historyId:'isolated-history',offline:true}),checkpoint=source.checkpoint();await source.close();
 const cp=checkpoint.simulation;if(cp.schemaVersion!==5)throw new Error('Current checkpoint required');const visual=createVisibilityFixture();cp.character=visual.character;cp.scene=visual.scene!;cp.head=visual.head!;cp.pauseUntilTick=100000;
 if(black)cp.scene.illumination=0;
 cp.attention.pending={id:1,createdTick:0,expiresTick:300,reasons:['activity_outcome'],triggers:[{reason:'activity_outcome',tick:0,parentSequence:null}],parentSequence:null,status:'pending',captureId:null,requestedTick:null};cp.attention.nextIntentId=2;
 const runtime=new BranchRuntime({mode:'LIVE',worldId:'pixel-qualified-real',branchId:'live',historyId:'isolated-history',checkpoint,directory});await runtime.prepare();
 const renderer=new ChromiumRenderer('angle-d3d11'),manager=new CaptureManager(()=>true,renderer);
 const config=loadCognitionConfig({loadEnv:false,env:{LUMI_COGNITION_ENABLED:'true',OPENROUTER_API_KEY:'FAKE-NO-EXTERNAL-TRANSPORT',LUMI_COGNITION_BUDGET_DIRECTORY:join(directory,'fake-budget'),LUMI_COGNITION_MIN_REAL_INTERVAL_MS:'100'}});
 let calls=0;const providers=new CognitionProviders(config,new DurableBudget(config.budget.directory),async(_url,init)=>{
  calls++;const body=JSON.parse(init.body as string),context=JSON.parse(body.messages[1].content[0].text);assert.deepEqual(Object.keys(context).sort(),['activity','experiences','shapes','sound']);assert.deepEqual(context.experiences,[]);
  if(black)assert.deepEqual(context.shapes,[]);else{assert.ok(context.shapes.length>0);assert.ok(context.shapes.every((shape:{uncertainty:string})=>shape.uncertainty==='geometry_candidates_pixel_checked'));assert.ok(context.shapes.some((shape:{sampleVisibilityBand:string;qualityFlags:string[]})=>shape.sampleVisibilityBand==='low'&&shape.qualityFlags.includes('limited_pixel_support')));}
  for(const field of ['privateMask','physicalIds','pixelQualification','visiblePixels','fixture-ahead'])assert.equal(JSON.stringify(context).includes(field),false);
  assert.ok(body.messages[1].content[1].image_url.url.startsWith('data:image/png;base64,'));
  const handle=black?'fabricated-handle':context.shapes[0].handle;
  return Response.json({model:config.main.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify({interpretation:'FAKE provider: uncertain image-based perception.',uncertainty:.8,evidenceHandles:[handle],action:{type:'inspect',handle}})}}],usage:{prompt_tokens:100,completion_tokens:30,cost:0}});
 });
 let completed!:()=>void;const done=new Promise<void>(resolve=>{completed=resolve;});
 const client={status:()=>providers.status(),budget:providers.budget,interpret:async(input:Parameters<typeof providers.interpret>[0])=>{try{return await providers.interpret(input);}finally{completed();}}};
 let hostMs=1000;const cognition=new CognitionCoordinator(config,client,manager,()=>true,'isolated-history'),automatic=new AutomaticCaptureCoordinator(manager,()=>true,()=>hostMs,(r,i)=>cognition.selectedCapture(r,i));
 try{
  automatic.pump([runtime]);const selected=manager.view(runtime.target).latest!;assert.equal(selected.width,512);runtime.simulation.step();await manager.wait(runtime.target,selected.captureId);await new Promise<void>(resolve=>setImmediate(resolve));runtime.simulation.step();
  assert.equal(manager.observation(runtime.target,selected.captureId).observation.shapes.length>0,!black,'black captures must expose no shape handles');
  cognition.pump([runtime]);runtime.simulation.step();cognition.pump([runtime]);await done;await new Promise<void>(resolve=>setImmediate(resolve));runtime.simulation.step();
  const state=runtime.simulation.checkpoint();if(state.schemaVersion!==5)throw new Error();assert.equal(calls,1);assert.equal(state.cognition.requests[0].request.promptRevision,COGNITION_PROMPT_REVISION);assert.equal(state.cognition.requests[0].request.schemaRevision,COGNITION_SCHEMA_REVISION);
  if(black){assert.equal(state.cognition.requests[0].result?.outcome,'malformed');assert.equal(state.cognition.requests[0].action,null);assert.equal(state.realExperiences.length,0);}else{assert.equal(state.cognition.requests[0].action?.reason,'inspection_orient_started');assert.equal(state.realExperiences.length,1);assert.equal(state.realExperiences[0].evidenceHandles.length,1);}
  const api=await cognition.summary(runtime);assert.ok(api.requests[0].context);assert.equal(api.requests[0].context!.shapes.length>0,!black);assert.equal(api.requests[0].contextProfile,'pixel_checked_v4');
  if(!black){for(let i=0;i<30;i++)runtime.simulation.step();hostMs=6000;automatic.pump([runtime]);const fresh=manager.view(runtime.target).latest!;assert.notEqual(fresh.captureId,selected.captureId);await manager.wait(runtime.target,fresh.captureId);assert.equal(manager.view(runtime.target).latest?.status,'success');}
  t.diagnostic(JSON.stringify({backend:manager.observation(runtime.target,selected.captureId).metadata.backend?.configuration,calls,externalTransportCalls:0,currentProfile:api.requests[0].contextProfile,admitted:state.realExperiences.length,freshCapture:!black,blackImage:black,fabricatedHandleRejected:black&&state.cognition.requests[0].result?.outcome==='malformed'}));
 }finally{automatic.close();cognition.close([runtime]);await manager.close();await runtime.close();}
});

import { groundSnapshot } from '../server/vision/grounding.js';
import { qualifyPixelGrounding, filterPixelQualifiedGrounding } from '../server/vision/pixel-qualification.js';
test('actual RGB/masks retain weak positive hints and suppress unsupported black geometry',async t=>{
 const renderer=new ChromiumRenderer('angle-d3d11'),base=createVisibilityFixture();const rows:Record<string,unknown>[]=[];
 try{
  for(const name of ['visible','dim','black','same-wall-material'] as const){const snapshot=structuredClone(base);if(name==='dim')snapshot.scene!.illumination=.04;if(name==='black')snapshot.scene!.illumination=0;if(name==='same-wall-material')snapshot.scene!.fixtureColor='#aac0af';
   const frame=await renderer.render(snapshot,512,512),geometry=groundSnapshot(snapshot,512,512,{ignoreLegacyIlluminationGate:true,pixelEvidenceCandidates:true}),result=qualifyPixelGrounding(geometry,frame.bytes,frame.privateMask,512,512),shapes=filterPixelQualifiedGrounding(result,id=>id);
   assert.equal(result.pixelQualification.status,'checked');assert.ok(!shapes.some(s=>s.handle==='fixture-behind-wall'||s.handle==='fixture-outside-fov'));
   const ahead=result.pixelQualification.objects.find(o=>o.privateId==='fixture-ahead')!,small=shapes.find(s=>s.handle==='fixture-small');
   if(name!=='black'){assert.equal(shapes.length,geometry.objects.filter(o=>o.eligible).length);assert.ok(shapes.find(s=>s.handle==='fixture-partial'));assert.ok(small);assert.equal(small.sampleVisibilityBand,'low');}
   if(name==='dim'){assert.equal(shapes.find(s=>s.handle==='fixture-ahead')?.sampleVisibilityBand,'low');assert.ok(shapes.find(s=>s.handle==='fixture-ahead')?.qualityFlags.includes('low_rgb_signal'));}
   if(name==='black'){assert.deepEqual(shapes,[]);assert.equal(ahead.reason,'no_rgb_support');assert.ok(result.objects.filter(o=>geometry.objects.find(g=>g.id===o.id)?.eligible).every(o=>!o.eligible));}
   rows.push({case:name,...ahead,shapeCount:shapes.length,band:shapes.find(s=>s.handle==='fixture-ahead')?.sampleVisibilityBand,smallBand:small?.sampleVisibilityBand,partial:result.pixelQualification.objects.find(o=>o.privateId==='fixture-partial')});
  }
  const visible=rows[0],camo=rows[3];assert.ok((camo.absoluteRgbContrast as number)<(visible.absoluteRgbContrast as number),'same geometry/material-color comparison must demonstrate lower measured contrast');assert.equal(camo.band,'low');
  t.diagnostic(JSON.stringify(rows));
 }finally{await renderer.close();}
});
