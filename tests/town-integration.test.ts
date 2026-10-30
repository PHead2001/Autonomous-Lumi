import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8 } from 'fflate';
import { BranchRuntime,hashRuntimeCheckpoint,replayRuntime,validateRuntimeCheckpoint,type RuntimeOperation } from '../server/branch-runtime.js';
import { HomeSimulation,TownSimulation,hashCheckpoint } from '../server/simulation.js';
import { replay } from '../server/replay.js';
import { exportIncident,inspectBundle,replayBundle } from '../server/diagnostics/bundle.js';
import { BranchRegistry } from '../server/branch-registry.js';
import { cognitionEnvelopeBytes,cognitionStorageBytes,TOWN_FUTURE_BYTES } from '../server/checkpoint-capacity.js';
import { MAX_CHECKPOINT_BYTES } from '../server/checkpoint-storage.js';
import { validateTownState,TOWN_LIMITS,type KnownTownAffordance } from '../shared/town-protocol.js';
import { createWorldServer } from '../server/world-server.js';
import { loadCognitionConfig } from '../server/cognition/config.js';
import { CognitionProviders } from '../server/cognition/providers.js';
import { DurableBudget } from '../server/cognition/budget.js';
import type { TownObservationCommand } from '../shared/town-protocol.js';

test('town activation preserves a saved home history and held serving while historical runtime keeps home rules',async()=>{
  const old=new HomeSimulation({mode:'EXPERIMENT',historyId:'saved-home-history'}).checkpoint();
  old.body.satiety=.62;old.home.resources.stock=3;old.home.resources.held={id:1,kind:'basic-serving',acquiredByAction:1};old.home.resources.nextServingId=2;old.home.nextActionId=2;
  const historical=new BranchRuntime({worldId:'test',branchId:'historical',mode:'EXPERIMENT',checkpoint:old,offline:true});
  const saved=historical.checkpoint();assert.equal(saved.schemaVersion,7);assert.equal(saved.simulation.schemaVersion,8);
  const directory=await mkdtemp(join(tmpdir(),'lumi-town-upgrade-'));
  const current=new BranchRuntime({worldId:'test',branchId:'current',mode:'EXPERIMENT',checkpoint:saved,directory});
  try{
    const upgraded=current.checkpoint();assert.equal(upgraded.schemaVersion,9);assert.equal(upgraded.simulation.schemaVersion,10);
    assert.ok(current.simulation instanceof TownSimulation);
    const now=upgraded.simulation;if(now.schemaVersion!==10)throw new Error('Town schema missing');
    assert.deepEqual(now.home,old.home);assert.deepEqual(now.body,old.body);assert.deepEqual(now.character,old.character);
    assert.deepEqual(now.realExperiences,old.realExperiences);assert.deepEqual(now.internalExperiences,old.internalExperiences);
    assert.equal(now.cognition.identity.historyId,old.cognition.identity.historyId);
    assert.throws(()=>validateRuntimeCheckpoint({...upgraded,schemaVersion:7}),/matching explicit/);
    assert.throws(()=>new BranchRuntime({worldId:'test',branchId:'live',mode:'LIVE',checkpoint:now,offline:true}),/LIVE runtime envelope/);
    assert.throws(()=>new BranchRuntime({worldId:'test',branchId:'live',mode:'LIVE',checkpoint:upgraded,offline:true}),/promote experimental/);
    const recorded=replay(old,[],old.tick+3),reference=new HomeSimulation({checkpoint:old,mode:'EXPERIMENT',historical:true});
    for(let i=0;i<3;i++)reference.step();assert.equal(recorded.stateHash,hashCheckpoint(reference.checkpoint()));
    assert.equal(recorded.checkpoint.schemaVersion,8);
  }finally{await current.close();await historical.close();await rm(directory,{recursive:true,force:true});}
});

test('town runtime exports normalized inputs and replays complete state without sockets or sensors',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'lumi-town-export-'));
  const runtime=new BranchRuntime({worldId:'town-test',branchId:'journey',mode:'EXPERIMENT',directory});
  try{
    runtime.applyControl({type:'pause'});runtime.enqueue({type:'slam'});
    runtime.enqueueTownFixture({type:'town_fixture',stock:{fruit:2,bread:5},balance:11,openingOffsetSeconds:2700,shopAvailable:false});
    runtime.applyControl({type:'step'});runtime.applyControl({type:'step'});
    const end=runtime.capture();assert.equal(end.simulation.schemaVersion,10);
    const snapshot=await runtime.recorder!.snapshotForExport(),out=join(directory,'town.zip');
    const exported=await exportIncident({runDirectory:runtime.recorder!.runDirectory,out,snapshot});
    assert.equal(exported.manifest.snapshot_schema,10);assert.equal(exported.manifest.evidence_status,'COMPLETE');
    const files=await inspectBundle(out),start=JSON.parse(strFromU8(files['runtime-start.json'])),operations=strFromU8(files['operations.jsonl']).trim().split('\n').map(line=>JSON.parse(line) as RuntimeOperation);
    const inputs=strFromU8(files['inputs.jsonl']).trim().split('\n').map(line=>JSON.parse(line));
    assert.deepEqual(inputs.find(i=>i.command.type==='town_fixture').command,{type:'town_fixture',stock:{fruit:2,bread:5},balance:11,openingOffsetSeconds:2700,shopAvailable:false});
    assert.equal(start.schemaVersion,9);assert.match(strFromU8(files['REPRODUCTION.md']),/lumi-town-v1/);
    const actual=replayRuntime(start,operations,end);assert.equal(actual.runtimeHash,hashRuntimeCheckpoint(end));
    assert.equal((await replayBundle(out)).stateHash,hashCheckpoint(end.simulation));
  }finally{await runtime.close();await rm(directory,{recursive:true,force:true});}
});

test('forked town state remains branch-owned through fixtures, save and restore',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'lumi-town-branches-')),registry=new BranchRegistry({directory});
  try{
    const saved=await registry.checkpoint(registry.live.target),left=await registry.fork(registry.live.target,saved.id,'left'),right=await registry.fork(registry.live.target,saved.id,'right');
    left.applyControl({type:'pause'});right.applyControl({type:'pause'});
    const liveBefore=hashRuntimeCheckpoint(registry.live.checkpoint()),rightBefore=hashRuntimeCheckpoint(right.checkpoint());
    const point=await registry.checkpoint(left.target);
    left.enqueueTownFixture({type:'town_fixture',stock:{fruit:0,bread:0},balance:0,openingOffsetSeconds:0,shopAvailable:false});left.applyControl({type:'step'});
    assert.equal(hashRuntimeCheckpoint(registry.live.checkpoint()),liveBefore);assert.equal(hashRuntimeCheckpoint(right.checkpoint()),rightBefore);
    const restored=await registry.restore(left.target,point.id),actual=restored.checkpoint().simulation,expected=structuredClone(left.checkpoints.get(point.id)!.simulation);
    if((actual.schemaVersion!==10&&actual.schemaVersion!==9)||(expected.schemaVersion!==10&&expected.schemaVersion!==9))throw new Error('Town schema required');
    // Restore deliberately creates a fresh transport/control run; all simulation fields otherwise match.
    expected.cognition.identity.runId=actual.cognition.identity.runId;
    assert.equal(hashCheckpoint(actual),hashCheckpoint(expected));
    assert.equal(hashRuntimeCheckpoint(registry.live.checkpoint()),liveBefore);assert.equal(hashRuntimeCheckpoint(right.checkpoint()),rightBefore);
    assert.throws(()=>registry.live.enqueueTownFixture({type:'town_fixture',stock:{fruit:0,bread:0},balance:0,openingOffsetSeconds:0,shopAvailable:false}),/experiment-only/);
  }finally{await registry.close();await rm(directory,{recursive:true,force:true});}
});

test('actual storage envelopes reserve maximum bounded town growth without trimming history',t=>{
  const initial=new TownSimulation({mode:'EXPERIMENT'}).checkpoint(),grown=structuredClone(initial),s=grown.town,max=Number.MAX_SAFE_INTEGER;
  s.doors.home=false;s.doors.homeAngle=0;s.doors.shop=true;s.doors.shopAngle=Math.PI/2;s.doors.slam={startTick:max,sign:-1};
  s.balance=1000000;s.installedTick=0;s.shop.nextRestockTick=max;s.nextItemId=max;s.lastPurchaseId=max;s.nextActionId=max;s.nextOpportunityTick=max;
  const point={x:1.2345678901234567e-100,z:-1.2345678901234567e-100};
  s.items=Array.from({length:TOWN_LIMITS.items},(_,i)=>({id:i+1,kind:'fruit',owner:'lumi',purchaseId:i+1,acquiredTick:max,consumedTick:max}));
  s.purchases=Array.from({length:TOWN_LIMITS.purchases},(_,i)=>({id:i+1,tick:max,good:'fruit',outcome:'purchased',reason:'r'.repeat(100),itemId:i+1,price:3}));
  s.known=Array.from({length:TOWN_LIMITS.known},(_,i):KnownTownAffordance=>({resourceId:String(i)+'r'.repeat(99),kind:'shop',anchor:{...point},open:true,handle:'h'.repeat(100),captureId:'c'.repeat(100),frameHash:'a'.repeat(64),capturedTick:max,attentionTick:max,recognition:'authored-town-rgb-v1'}));
  s.task={id:max-1,status:'started',stage:'consume',target:structuredClone(s.known[0]),homeAnchor:{...point},route:Array.from({length:TOWN_LIMITS.routePoints},()=>({...point})),routeCursor:TOWN_LIMITS.routePoints,replans:TOWN_LIMITS.replans,nextReplanTick:max,stageStartedTick:max,stageTicks:172800*120,selectedTick:max,purchaseId:max,itemId:1,reason:'r'.repeat(100),effectSequence:max};
  s.droppedCount=max-65;s.nextTimelineSequence=max;
  s.timeline=Array.from({length:TOWN_LIMITS.timeline},(_,i)=>({sequence:s.droppedCount+i+1,tick:max,actionId:max-1,type:'interrupted',label:'l'.repeat(80)}));
  validateTownState(s,max,120);
  const growth=cognitionEnvelopeBytes(grown)-cognitionEnvelopeBytes(initial);
  t.diagnostic(`Maximum-shape town actual-envelope growth: ${growth} bytes; reserve: ${TOWN_FUTURE_BYTES} bytes.`);
  assert.ok(growth>0&&growth<TOWN_FUTURE_BYTES,`actual maximum town envelope growth ${growth} must fit ${TOWN_FUTURE_BYTES}`);
  assert.ok(cognitionStorageBytes(initial)<MAX_CHECKPOINT_BYTES);
  assert.deepEqual(grown.realExperiences,initial.realExperiences);assert.deepEqual(grown.internalExperiences,initial.internalExperiences);
});

test('guided shop startup excludes paid work before activation and preserves unknown targets and home fallback',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'lumi-town-lab-admission-'));
  const config=loadCognitionConfig({env:{LUMI_COGNITION_ENABLED:'true',OPENROUTER_API_KEY:'FAKE-NO-PAID-TRANSPORT',LUMI_COGNITION_BUDGET_DIRECTORY:join(directory,'budget')},loadEnv:false});
  let calls=0,checks=0;
  const providers=new CognitionProviders(config,new DurableBudget(config.budget.directory),async()=>{calls++;throw new Error('Lab must never dispatch');});
  const app=createWorldServer({diagnosticsDirectory:directory,autoSchedule:false,automaticCaptures:false,cognition:{config,providers}});
  try{
    const port=await app.listen(0),origin=`http://127.0.0.1:${port}`,before=hashCheckpoint(app.registry.live.checkpoint().simulation),save=app.registry.checkpoint.bind(app.registry);
    app.registry.checkpoint=async scope=>{
      if(scope.branchId.startsWith('town-')){
        const candidate=app.registry.active(scope),cp=candidate.checkpoint().simulation;
        assert.equal(cp.schemaVersion,10);if(cp.schemaVersion!==10)throw new Error('Town schema required');
        assert.deepEqual(cp.town.known,[]);assert.deepEqual(cp.home.known,[]);assert.equal(cp.town.task,null);assert.equal(cp.home.task,null);
        assert.equal(cp.home.resources.stock,4);assert.equal(cp.physiology.origin.evidenceEligibility,'eligible');
        assert.equal(app.cognition.selectedCapture(candidate,{id:1,reasons:['head_milestone'],createdTick:0,expiresTick:300,triggers:[{reason:'head_milestone',tick:0,parentSequence:null}],parentSequence:null,status:'pending',captureId:null,requestedTick:null}),false);
        app.cognition.pump([candidate]);checks++;
      }
      return save(scope);
    };
    const response=await fetch(origin+'/api/town-lab/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:'shop'})});
    assert.equal(response.status,200,await response.clone().text());const view=await response.json();
    assert.equal(view.status,'RUNNING');assert.ok(view.viewerUrl.includes('branchId=town-'));assert.equal(checks,1);assert.equal(calls,0);
    const branchId=new URL(view.viewerUrl,origin).searchParams.get('branchId')!,experiment=app.registry.get({worldId:'lumi',branchId});
    const initial=experiment.checkpoint().simulation;if((initial.schemaVersion!==10&&initial.schemaVersion!==9))throw new Error('Town schema required');
    assert.deepEqual(initial.pendingInputs.map(i=>i.command),[{type:'turn_head',yawDelta:0,pitchDelta:0,sceneRevision:initial.scene.revision}]);
    experiment.applyControl({type:'pause'});experiment.applyControl({type:'step'});
    const afterViewSetup=experiment.checkpoint().simulation;if((afterViewSetup.schemaVersion!==10&&afterViewSetup.schemaVersion!==9))throw new Error('Town schema required');
    assert.equal(afterViewSetup.attention.pending?.reasons.includes('head_milestone'),true);assert.deepEqual(afterViewSetup.home.known,[]);assert.deepEqual(afterViewSetup.town.known,[]);
    assert.equal(afterViewSetup.character.x,-1);assert.equal(afterViewSetup.character.z,2.5);assert.equal(afterViewSetup.head.yaw,0);
    assert.equal(hashCheckpoint(app.registry.live.checkpoint().simulation),before);
    const status=await(await fetch(origin+'/api/town-lab?scenarioId='+view.scenarioId)).json();assert.equal(status.scenarioId,view.scenarioId);assert.equal(status.exportUrl,undefined);
    const rejected=await fetch(origin+'/api/town-lab/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:'force-shopping'})});assert.equal(rejected.status,400);
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});

test('public runtime input cannot manufacture a town affordance, purchase or door control',async()=>{
  const runtime=new BranchRuntime({worldId:'test',branchId:'private-boundary',mode:'EXPERIMENT',offline:true});
  try{
    const command:TownObservationCommand={type:'town_observation',captureId:'capture',frameHash:'a'.repeat(64),capturedTick:0,attentionTick:0,sensorSource:'actual_renderer',observations:[{handle:'opaque-handle',resourceId:'town-shop',kind:'shop',observedAnchor:{x:2.97,z:-10.8},open:true,recognition:'authored-town-rgb-v1'}]};
    assert.throws(()=>runtime.enqueue(command),/private town boundary/);
    assert.throws(()=>runtime.enqueueTownObservation(command,{authority:'actual-town-capture-proof'}),/Untrusted/);
    assert.throws(()=>runtime.enqueue({type:'shop_purchase',actor:'lumi',purchaseId:1,good:'fruit'}),/private town boundary/);
    assert.throws(()=>runtime.enqueue({type:'town_door',door:'home',open:true}),/private town boundary/);
    const cp=runtime.checkpoint().simulation;if((cp.schemaVersion!==10&&cp.schemaVersion!==9))throw new Error('Town schema required');
    assert.deepEqual(cp.town.known,[]);assert.deepEqual(cp.town.items,[]);assert.equal(cp.town.balance,20);assert.equal(cp.pendingInputs.length,0);
  }finally{await runtime.close();}
});
