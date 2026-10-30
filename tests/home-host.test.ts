import { HomeLab,publishHomeLabResult,homeLabSleepBatchTicks,pumpHomeLabSleep,type HomeLabView } from '../server/home-lab.js';
import { BranchRegistry } from '../server/branch-registry.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorldServer } from '../server/world-server.js';
import { loadCognitionConfig } from '../server/cognition/config.js';
import { CognitionProviders } from '../server/cognition/providers.js';
import { DurableBudget } from '../server/cognition/budget.js';
import { validateHomeObservationProof } from '../server/home-observation.js';
import { recognizeHomeCues } from '../server/vision/home-perception.js';
import { PNG } from 'pngjs';
test('home lab excludes paid cognition before reopened experiment activates or awaits checkpoint I/O',async()=>{const directory=await mkdtemp(join(tmpdir(),'lumi-home-host-'));const config=loadCognitionConfig({env:{LUMI_COGNITION_ENABLED:'true',OPENROUTER_API_KEY:'FAKE-NO-PAID-TRANSPORT',LUMI_COGNITION_BUDGET_DIRECTORY:join(directory,'budget')},loadEnv:false});let calls=0,activationChecks=0;const providers=new CognitionProviders(config,new DurableBudget(config.budget.directory),async()=>{calls++;throw new Error('Lab must never dispatch');});const app=createWorldServer({diagnosticsDirectory:directory,autoSchedule:false,automaticCaptures:false,cognition:{config,providers}});try{const port=await app.listen(0),original=app.registry.checkpoint.bind(app.registry);app.registry.checkpoint=async scope=>{if(scope.branchId.startsWith('home-')){await Promise.resolve();const candidate=app.registry.active(scope);assert.equal(app.cognition.selectedCapture(candidate,{id:1,reasons:['head_milestone'],createdTick:candidate.simulation.state.tick,expiresTick:candidate.simulation.state.tick+300,triggers:[{reason:'head_milestone',tick:candidate.simulation.state.tick,parentSequence:null}],parentSequence:null,status:'pending',captureId:null,requestedTick:null}),false);app.cognition.pump([candidate]);activationChecks++;}return original(scope);};const response=await fetch(`http://127.0.0.1:${port}/api/home-lab/start`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:'food'})});assert.equal(response.status,200,await response.clone().text());const run=await response.json();assert.equal(run.status,'RUNNING');assert.ok(run.viewerUrl.includes('branchId=home-'));assert.equal(activationChecks,1);assert.equal(calls,0);const status=await(await fetch(`http://127.0.0.1:${port}/api/home-lab?scenarioId=${run.scenarioId}`)).json();assert.equal(status.scenarioId,run.scenarioId);assert.equal(status.status,'RUNNING');}finally{await app.close();await rm(directory,{recursive:true,force:true});}});
test('unreadable synthetic RGB and fabricated semantic proof cannot mint a target',()=>{const png=new PNG({width:256,height:256});png.data.fill(180);assert.deepEqual(recognizeHomeCues(PNG.sync.write(png)),[]);const command={type:'home_observation' as const,captureId:'capture',frameHash:'a'.repeat(64),capturedTick:0,attentionTick:1,sensorSource:'actual_renderer' as const,observations:[{handle:'visible-handle',resourceId:'home-pantry',kind:'pantry' as const,observedAnchor:{x:0,z:0},recognition:'authored-rgb-v1' as const}]};assert.throws(()=>validateHomeObservationProof(command,{authority:'actual-home-capture-proof'},{worldId:'lumi',branchId:'live',runId:'run'}),/Untrusted/);});

test('concurrent guided starts reserve the shared four-run limit before awaiting preparation',async()=>{const directory=await mkdtemp(join(tmpdir(),'lumi-home-admission-')),registry=new BranchRegistry({directory});let entered=0,release:()=>void=()=>{},ready:()=>void=()=>{};const barrier=new Promise<void>(resolve=>{release=resolve;}),allEntered=new Promise<void>(resolve=>{ready=resolve;}),original=registry.reopen.bind(registry);registry.reopen=async(...args)=>{if(++entered===4)ready();await barrier;return original(...args);};const lab=new HomeLab(registry,()=>{},async()=>'/unused');try{const starts=Array.from({length:5},()=>lab.start('food'));await assert.rejects(starts[4],/limit reached/);await allEntered;assert.equal(entered,4);release();const results=await Promise.all(starts.slice(0,4));assert.equal(new Set(results.map(r=>r.scenarioId)).size,4);await assert.rejects(lab.start('bed'),/limit reached/);}finally{release();await registry.close();await rm(directory,{recursive:true,force:true});}});

test('guided terminal status waits for the actual export URL',async()=>{const view:HomeLabView={scenarioId:'scenario',status:'RUNNING',phase:'Finished eating',expected:'Actual meal and export',observed:'Meal completed',viewerUrl:'/?branchId=scenario'};let release:(url:string)=>void=()=>{};const exported=new Promise<string>(resolve=>{release=resolve;}),pending=publishHomeLabResult(view,'PASS',()=>exported);await Promise.resolve();assert.equal(view.status,'RUNNING');assert.equal(view.exportUrl,undefined);assert.equal(view.phase,'Preparing diagnostic export');release('/api/download?exportId=actual');await pending;assert.equal(view.status,'PASS');assert.equal(view.exportUrl,'/api/download?exportId=actual');});

import { BranchRuntime } from '../server/branch-runtime.js';
import { HomeSimulation,type CheckpointV8 } from '../server/simulation.js';
import { eyePose } from '../shared/eye-pose.js';
test('sleep time-lapse stops on actual wake before wake/exit progress, then schedules physical exit at 1x',async()=>{
 const initial=new HomeSimulation({mode:'EXPERIMENT'}).checkpoint();initial.config.hz=initial.body.hz=1;initial.body.sleepPressure=.79;initial.body.satiety=.85;initial.interoception.sampling.nextSampleTick=5;
 for(const key of Object.keys(initial.attention.config))if(key.endsWith('Ticks')){const config=initial.attention.config as unknown as Record<string,number>;config[key]=Math.max(1,Math.round(config[key]/30));}
 const sim=new HomeSimulation({checkpoint:initial,mode:'EXPERIMENT'});
 for(let i=0;i<200&&!sim.checkpoint().attention.pending;i++)sim.step();
 const cp=sim.checkpoint(),intent=cp.attention.pending!;assert.ok(intent);const eye=eyePose(sim.state),pose={x:eye.position[0],y:eye.position[1],z:eye.position[2],bodyHeading:eye.bodyHeading,headYaw:eye.headYaw,headPitch:eye.headPitch},common={type:'sensor_feedback' as const,intentId:intent.id,captureId:'sleep-boundary',capturedTick:cp.tick,sceneRevision:cp.scene.revision,pose,outcome:'success' as const};
 sim.enqueue({...common,stage:'admitted',signature:null,frameHash:null});sim.enqueue({...common,stage:'result',signature:Array(48).fill(100),frameHash:'a'.repeat(64)});sim.step();const bed=cp.home.layout!.bed;
 sim.enqueue({type:'home_observation',captureId:common.captureId,frameHash:'a'.repeat(64),capturedTick:cp.tick,attentionTick:sim.state.tick,sensorSource:'test_fixture',observations:[{handle:'bed-sign',resourceId:bed.id,kind:'bed',observedAnchor:bed.anchor,recognition:'authored-rgb-v1'}]});
 for(let i=0;i<500&&sim.homeState().task?.stage!=='sleep';i++)sim.step();
 const asleep=sim.checkpoint();assert.equal(asleep.home.task?.stage,'sleep');assert.equal(asleep.body.mode,'asleep');assert.equal(homeLabSleepBatchTicks(asleep.body),300);
 // Explicit near-wake test fixture; production rates and the actual selected task stay intact.
 asleep.body.sleepPressure=asleep.body.config.wakePressure+2.25*asleep.body.config.sleepPressureRecoveryPerSecond;
 const rates=structuredClone(asleep.body.config),base=new BranchRuntime({worldId:'test',branchId:'sleep-boundary',mode:'EXPERIMENT',checkpoint:asleep,offline:true}),envelope=base.checkpoint();await base.close();envelope.scheduler.config.hz=1;envelope.control.speed=1;
 let now=0;const runtime=new BranchRuntime({worldId:'test',branchId:'sleep-boundary',mode:'EXPERIMENT',checkpoint:envelope,offline:true,clock:{monotonicMs:()=>now,utcMs:()=>now}});
 try{
  let batches=0;while((runtime.simulation.checkpoint() as CheckpointV8).body.mode==='asleep'){
   const before=runtime.simulation.checkpoint() as CheckpointV8;pumpHomeLabSleep(runtime,before);const pending=runtime.checkpoint();assert.equal(pending.control.fastForwardRemaining,1);runtime.replayOperation({sequence:pending.control.nextOperationSequence,tick:before.tick,kind:'advance',ticks:1,backlogMs:0,source:'fast-forward'});assert.ok(++batches<=3);
  }
  const wake=runtime.checkpoint();assert.equal(wake.simulation.tick,asleep.tick+3);assert.equal((wake.simulation as CheckpointV8).home.task?.stage,'sleep');assert.equal((wake.simulation as CheckpointV8).home.posture.kind,'reclined');assert.equal((wake.simulation as CheckpointV8).home.timeline.some(e=>e.type==='waking'),false);assert.equal(wake.control.paused,true);assert.equal(wake.control.fastForwardRemaining,0);
  pumpHomeLabSleep(runtime,wake.simulation as CheckpointV8);assert.equal(runtime.checkpoint().control.speed,1);assert.equal(runtime.captureAvailability().paused,false);
  now+=999;assert.equal(runtime.pump(),0);now++;assert.equal(runtime.pump(),1);assert.equal((runtime.simulation.checkpoint() as CheckpointV8).home.task?.stage,'wake');
  now+=1000;assert.equal(runtime.pump(),1);assert.equal((runtime.simulation.checkpoint() as CheckpointV8).home.task?.stage,'exit');assert.equal((runtime.simulation.checkpoint() as CheckpointV8).home.posture.kind,'reclined');
  for(let i=0;i<3;i++){now+=999;assert.equal(runtime.pump(),0);now++;assert.equal(runtime.pump(),1);}
  const done=runtime.simulation.checkpoint() as CheckpointV8;assert.equal(done.home.task?.status,'completed');assert.equal(done.home.posture.kind,'upright');assert.deepEqual(done.body.config,rates);
  assert.equal(homeLabSleepBatchTicks({...asleep.body,config:{...rates,sleepPressureRecoveryPerSecond:0}}),null);assert.equal(homeLabSleepBatchTicks({...asleep.body,config:{...rates,sleepPressureRecoveryPerSecond:NaN}}),null);
 }finally{await runtime.close();}
});
