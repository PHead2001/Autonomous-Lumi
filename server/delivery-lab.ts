import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate as immediate, setTimeout as delay } from 'node:timers/promises';
import { BranchRuntime } from './branch-runtime.js';
import { DeliverySimulation } from './simulation.js';
import { CaptureManager } from './vision/capture-manager.js';
import { ChromiumRenderer } from './vision/renderer.js';
import { AutomaticCaptureCoordinator } from './vision/auto-capture.js';
import { canOccupyVisitActor, canSweepVisitActor } from '../shared/visit-geometry.js';
import { canChangeTownDoor, TOWN_GEOMETRY } from '../shared/town-geometry.js';
import { VISIT_LIMITS } from '../shared/visit-protocol.js';
import { planTownRoute, planHomeRoute } from './home-navigation.js';
import { exportIncident, replayBundle } from './diagnostics/bundle.js';
import { DAILY_RULES,DELIVERY_ANCHOR } from '../shared/delivery-protocol.js';
import {canonicalStringify} from './canonical.js';

export interface DeliveryLabOptions {out:string}
/** Actual-eye delivery evidence in a disposable history. Owner intentions are
 * scripted; discovery, collection and consumption use production policies. */
export async function runDeliveryLab(options:DeliveryLabOptions) {
  const out=resolve(options.out);await mkdir(dirname(out),{recursive:true});
  const identity={worldId:'delivery-lab',branchId:'experiment',historyId:randomUUID(),mode:'EXPERIMENT' as const};
  const initial=new DeliverySimulation({...identity,physiology:{active:true,genesisPreset:'production-v1'}}).checkpoint();
  assert.equal(initial.rulesVersion,DAILY_RULES);
  // Initial moderate hunger, safe stationary position and head direction are
  // declared fixtures. No known resource, visitor, item or recognition is added.
  initial.body.satiety=.24;initial.body.sleepPressure=.1;
  initial.character.x=.9;initial.character.z=.5;initial.character.heading=Math.atan2(-.9,-3.75);
  initial.head.yaw=initial.head.targetYaw=0;initial.head.pitch=initial.head.targetPitch=0;
  initial.pauseUntilTick=100000;initial.home.controller.searchNextTick=100000;
  let runtime=new BranchRuntime({...identity,checkpoint:initial,directory:out+'.purchase-runs'});
  const manager=new CaptureManager(()=>true,new ChromiumRenderer());
  let automatic=new AutomaticCaptureCoordinator(manager,()=>true,undefined,()=>true);
  const captures:unknown[]=[];let lastCaptureReal=-Infinity;
  const cp=()=>{const checkpoint=runtime.simulation.checkpoint();if(checkpoint.schemaVersion!==12)throw new Error('Daily schema required');return checkpoint;};
  const advance=async(ticks:number)=>{assert.ok(ticks>=1&&ticks<=128);runtime.applyControl({type:'fast-forward',ticks});await immediate();assert.equal(runtime.captureAvailability().fastForwardRemaining,0);};
  const state=()=>cp().visit;
  const control=async(forward=0,yaw=state().actor!.heading,ticks=1)=>{
    const v=state();runtime.enqueueVisit({type:'visit_control',runId:runtime.target.runId,generation:v.control.generation,sequence:v.control.lastSequence+1,forward,strafe:0,yaw,pitch:0,expiresTick:runtime.simulation.state.tick+Math.ceil(.75*cp().config.hz)});await advance(ticks);
  };
  const face=async(yaw:number)=>{for(let i=0;i<8;i++){const difference=Math.atan2(Math.sin(yaw-state().actor!.heading),Math.cos(yaw-state().actor!.heading));if(Math.abs(difference)<.001)return;await control(0,yaw,Math.min(8,Math.max(1,Math.ceil(Math.abs(difference)/(VISIT_LIMITS.turnRadiansPerSecond/cp().config.hz)))));}assert.ok(Math.abs(Math.atan2(Math.sin(yaw-state().actor!.heading),Math.cos(yaw-state().actor!.heading)))<.001,'bounded owner turn');};
  const walk=async(goal:{x:number;z:number})=>{
    const world=runtime.viewerState(),a=state().actor!,geometry={canOccupy:(p:{x:number;z:number})=>canOccupyVisitActor(world,p.x,p.z),canSweep:(from:{x:number;z:number},to:{x:number;z:number})=>canSweepVisitActor(world,from.x,from.z,to.x,to.z)};let route=planTownRoute(a,goal,geometry);if(route.status!=='reachable')route=planHomeRoute(a,goal,geometry,{minX:-4.05,maxX:5.5,minZ:-14.7,maxZ:3.1,maxExpansions:3000});
    assert.equal(route.status,'reachable','owner route '+JSON.stringify({from:{x:a.x,z:a.z},goal,doors:cp().town.doors})+': '+route.reason);
    for(const point of route.points)for(let attempt=0;attempt<160;attempt++){
      const actor=state().actor!,distance=Math.hypot(point.x-actor.x,point.z-actor.z);if(distance<.035)break;
      const yaw=Math.atan2(point.x-actor.x,point.z-actor.z);await face(yaw);
      const ticks=Math.min(8,Math.max(1,Math.ceil(distance/(VISIT_LIMITS.speed/cp().config.hz))));
      await control(Math.min(1,distance/(VISIT_LIMITS.speed/cp().config.hz*ticks)),yaw,ticks);
      if(attempt===159)throw new Error('Owner walk did not reach waypoint');
    }
    await control();assert.ok(Math.hypot(state().actor!.x-goal.x,state().actor!.z-goal.z)<.08,'owner reached planned endpoint');await runtime.recorder!.flush();
  };
  const interact=async(action:'door'|'purchase',value:'home'|'shop'|'fruit')=>{const v=state();runtime.enqueueVisit({type:'visit_interact',runId:runtime.target.runId,generation:v.control.generation,sequence:v.control.lastSequence+1,actionId:v.lastActionId+1,action,door:action==='door'?value as 'home'|'shop':null,good:action==='purchase'?'fruit':null});await advance(1);assert.equal(state().feedback?.outcome,'accepted','owner interaction: '+state().feedback?.reason);};
  const capture=async(label:string)=>{
    while(runtime.simulation.state.tick<cp().attention.captureCooldownUntilTick)await advance(Math.min(8,cp().attention.captureCooldownUntilTick-runtime.simulation.state.tick));
    const remaining=5100-(performance.now()-lastCaptureReal);if(remaining>0)await delay(remaining);
    runtime.enqueue({type:'turn_head',yawDelta:0,pitchDelta:0,sceneRevision:runtime.viewerState().scene!.revision});await advance(1);
    for(let i=0;i<8&&!cp().attention.pending;i++)await advance(1);
    assert.ok(cp().attention.pending,'normal head completion supplies capture intention');
    runtime.applyControl({type:'resume'});automatic.pump([runtime]);runtime.applyControl({type:'pause'});
    const request=automatic.summary(runtime.target).inFlight;assert.ok(request,'automatic capture admitted');lastCaptureReal=performance.now();
    const metadata=await manager.wait(runtime.target,request.captureId);await immediate();assert.equal(metadata.status,'success',metadata.error??'actual render');
    await advance(1);automatic.pump([runtime]);await advance(1);
    const view=manager.view(runtime.target);await writeFile(out+'.'+label+'.png',manager.frame(runtime.target,metadata.captureId));captures.push({label,metadata,observation:view.observation,after:{delivery:cp().delivery,bodyEffectSequence:cp().body.lastEffectSequence}});await runtime.recorder!.flush();
  };
  try {
    runtime.applyControl({type:'pause'});runtime.enqueueVisit({type:'visit_start',runId:runtime.target.runId,generation:1});await advance(1);
    // Open from the clear right-hand approach, before entering the leaf's
    // reserved sweep. The threshold waypoint itself is safe only once open.
    await walk({x:3.76,z:2.72});await walk({x:3.76,z:-2.2});
    assert.ok(canChangeTownDoor(runtime.viewerState(),'home',true),'owner door approach leaves the full physical swing clear');
    await interact('door','home');await walk({x:3.76,z:-2.56});await walk({x:3.12,z:-2.56});await walk({x:3.12,z:-5.8});
    await walk({x:2.97,z:-8.1});await interact('door','shop');await walk(TOWN_GEOMETRY.checkout);await interact('purchase','fruit');
    const purchased=cp();assert.equal(purchased.visit.balance,17);assert.equal(purchased.town.items.filter(item=>item.owner==='owner'&&item.consumedTick===null).length,1);
    await writeFile(out+'.purchase-runtime.json',canonicalStringify(runtime.capture()));
    await walk({x:3.12,z:-2.56});await walk(DELIVERY_ANCHOR);await control();
    const itemId=state().actor!.heldItemId!,before=cp().body.lastEffectSequence;
    const v=state();runtime.enqueueDelivery({type:'delivery_deposit',runId:runtime.target.runId,generation:v.control.generation,sequence:v.control.lastSequence+1,actionId:v.lastActionId+1,itemId});await advance(1);
    assert.equal(cp().delivery.feedback?.outcome,'accepted','deposit: '+cp().delivery.feedback?.reason);
    assert.equal(cp().delivery.receipts[0].noticedTick,null,'unobserved deposit supplies no awareness');
    assert.equal(cp().delivery.known,null);assert.deepEqual(cp().delivery.experiences,[]);
    assert.equal(cp().body.lastEffectSequence,before,'deposit supplies no nutrition');
    const parkedPose={x:state().actor!.x,z:state().actor!.z,heading:state().actor!.heading};
    runtime.enqueueVisit({type:'visit_stop',runId:runtime.target.runId,generation:state().control.generation,reason:'disconnect'});await advance(1);
    assert.equal(state().control.status,'parked');assert.equal(state().actor!.heldItemId,null);
    const saved=runtime.capture(),depositOut=out.replace(/\.zip$/i,'')+'.deposit.zip';
    await writeFile(out+'.restore.json',canonicalStringify(saved));
    const deposited=await exportIncident({runDirectory:runtime.recorder!.runDirectory,out:depositOut,snapshot:await runtime.recorder!.snapshotForExport()});assert.equal(deposited.manifest.evidence_status,'COMPLETE');
    const depositReplay=await replayBundle(depositOut);assert.equal(depositReplay.status,'PASS');
    automatic.close();await runtime.close();
    runtime=new BranchRuntime({...identity,checkpoint:JSON.parse(await readFile(out+'.restore.json','utf8')),directory:out+'.discovery-runs'});
    automatic=new AutomaticCaptureCoordinator(manager,()=>true,undefined,()=>true);
    await advance(1);assert.equal(state().control.status,'parked');assert.deepEqual({x:state().actor!.x,z:state().actor!.z,heading:state().actor!.heading},parkedPose,'restore preserves the actual deposit pose');
    assert.equal(cp().delivery.receipts[0].noticedTick,null);assert.equal(cp().delivery.experiences.length,0);
    await capture('indicator');assert.equal(cp().delivery.known?.kind,'occupied','actual attended indicator discovered');assert.equal(cp().delivery.receipts[0].noticedTick,null,'closed contents are not individually noticed');
    for(let i=0;i<100&&cp().delivery.task?.stage!=='observe';i++)await advance(8);
    assert.equal(cp().delivery.task?.stage,'observe','computed route and real opening complete');
    assert.equal(cp().delivery.open,true);assert.equal(cp().town.items.find(i=>i.id===itemId)!.owner,'dropoff','opening is not collection');
    assert.equal(cp().body.lastEffectSequence,before,'opening supplies no nutrition');
    await capture('contents');
    for(let i=0;i<64&&cp().delivery.receipts[0].status!=='consumed';i++)await advance(8);
    const ending=cp(),receipt=ending.delivery.receipts[0];assert.equal(receipt.status,'consumed','separate collection and production eating complete');
    assert.ok(receipt.openedTick!<receipt.noticedTick!&&receipt.noticedTick!<receipt.collectedTick!&&receipt.collectedTick!<receipt.consumedTick!);
    assert.equal(ending.body.lastEffectSequence,before+1,'exactly one nutrition effect');assert.equal(ending.town.items.find(i=>i.id===itemId)!.consumedTick,receipt.consumedTick);
    assert.deepEqual({x:state().actor!.x,z:state().actor!.z,heading:state().actor!.heading},parkedPose,'owner never moves aside after deposit');
    assert.equal(ending.social.firstRecognizedEncounter,null);assert.equal(ending.social.experiences.length,0,'parcel is not a witnessed visitor encounter');
    assert.ok(ending.delivery.experiences.length>=2,'actual indicator and contents evidence admitted');
    assert.ok(ending.delivery.experiences.every(e=>e.source==='actual_renderer'&&e.provenance==='ATTENDED_DELIVERY_RGB'&&!e.interpretation.includes('creator')));
    runtime.capture();const exported=await exportIncident({runDirectory:runtime.recorder!.runDirectory,out,snapshot:await runtime.recorder!.snapshotForExport()});assert.equal(exported.manifest.evidence_status,'COMPLETE');
    const replay=await replayBundle(out);assert.equal(replay.status,'PASS');
    const summary={fixture:'Fresh isolated EXPERIMENT, initial moderate hunger and fixed safe pose/head. Home unknown-target search delayed. Owner buys fruit through normal normalized controls and real door/payment interactions, deposits at the nominal interaction point, then disconnects and remains parked at that exact pose. File-backed complete runtime restoration precedes all camera captures. Actual attended RGB indicator -> computed alternative approach -> opening -> separate actual contents capture -> collection -> normal four-second eating. No post-start coordinate edits, recognition, semantic fact, sender, creator cue or final action/choice injected.',scope:runtime.target,out,checks:{paidCalls:0,modelCostUsd:0,actualRenderer:true,productionPurchase:true,unobservedDeposit:true,ownerParkedWithoutMovingAside:true,fileBackedRestore:true,separateOpeningCollectionConsumption:true,exactlyOneNutritionEffect:true,noMeetingOrSenderAttribution:true,complete:exported.manifest.evidence_status,replay,depositSegment:{out:depositOut,complete:deposited.manifest.evidence_status,replay:depositReplay}},ending:{tick:ending.tick,delivery:ending.delivery,owner:runtime.viewerState().visit,items:ending.town.items,bodyEffectSequence:ending.body.lastEffectSequence},captures};
    await writeFile(out+'.summary.json',JSON.stringify(summary,null,2));return summary;

  } finally {automatic.close();await manager.close();await runtime.close();}
}

async function main(){const args=process.argv.slice(2);let out='diagnostics/phase25d/delivery.zip';for(let i=0;i<args.length;i+=2){if(args[i]==='--out'&&args[i+1])out=args[i+1];else throw new Error('Use --out <zip>');}const result=await runDeliveryLab({out});console.log(JSON.stringify({out:result.out,checks:result.checks,endingTick:result.ending.tick},null,2));}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void main().catch(error=>{console.error(error instanceof Error?error.stack:'Delivery lab failed');process.exitCode=1;});
