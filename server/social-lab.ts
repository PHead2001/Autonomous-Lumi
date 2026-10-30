import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate as immediate, setTimeout as delay } from 'node:timers/promises';
import { BranchRuntime } from './branch-runtime.js';
import { SocialSimulation } from './simulation.js';
import { CaptureManager } from './vision/capture-manager.js';
import { ChromiumRenderer } from './vision/renderer.js';
import { AutomaticCaptureCoordinator } from './vision/auto-capture.js';
import { canOccupyVisitActor, canSweepVisitActor } from '../shared/visit-geometry.js';
import { TOWN_GEOMETRY } from '../shared/town-geometry.js';
import { VISIT_LIMITS } from '../shared/visit-protocol.js';
import { planTownRoute, planHomeRoute } from './home-navigation.js';
import { exportIncident, replayBundle } from './diagnostics/bundle.js';

export interface SocialLabOptions { out:string; scenario?:'accept'|'decline'; introduction?:boolean;onEncodedObservation?:(runtime:BranchRuntime,manager:CaptureManager,captureId:string)=>Promise<unknown> }
/** Disposable fixed-tick acceptance. Owner intentions are scripted, Lumi's
 * response and sensory/experience admissions are the production policies. */
export async function runSocialLab(options:SocialLabOptions) {
  const out=resolve(options.out),scenario=options.scenario??'accept';await mkdir(dirname(out),{recursive:true});
  const identity={worldId:'social-lab',branchId:'experiment',historyId:randomUUID(),runId:'genesis',mode:'EXPERIMENT' as const};
  const initial=new SocialSimulation({...identity,physiology:{active:true,genesisPreset:'production-v1'}}).checkpoint();
  // Declared initial need/view fixtures, with no resource knowledge, offer,
  // visitor, experience or final action/response injected.
  initial.body.satiety=scenario==='accept'?.24:.85;initial.body.sleepPressure=.1;
  initial.character.x=0;initial.character.z=0;initial.character.heading=Math.PI;
  initial.head.yaw=initial.head.targetYaw=0;initial.head.pitch=initial.head.targetPitch=-.55;
  initial.pauseUntilTick=100000;initial.home.controller.searchNextTick=100000;
  const runtime=new BranchRuntime({...identity,checkpoint:initial,directory:out+'.runs'});
  const renderer=new ChromiumRenderer(),manager=new CaptureManager(()=>true,renderer);
  const automatic=new AutomaticCaptureCoordinator(manager,()=>true,undefined,()=>true);
  const captures:unknown[]=[];let lastCaptureReal=-Infinity,lastCaptureId:string|null=null,providerCheck:unknown;
  const cp=()=>{const checkpoint=runtime.simulation.checkpoint();if(checkpoint.schemaVersion!==11)throw new Error('Social schema required');return checkpoint;};
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
  const social=async(action:'offer'|'badge',value:number|boolean)=>{const v=state();runtime.enqueueSocial({type:action==='offer'?'social_offer':'social_badge',runId:runtime.target.runId,generation:v.control.generation,sequence:v.control.lastSequence+1,actionId:v.lastActionId+1,...(action==='offer'?{itemId:Number(value)}:{display:!!value})} as import('../shared/social-protocol.js').SocialIntentCommand);await advance(1);};
  const capture=async(label:string)=>{
    while(runtime.simulation.state.tick<cp().attention.captureCooldownUntilTick)await control(0,state().actor!.heading,Math.min(8,cp().attention.captureCooldownUntilTick-runtime.simulation.state.tick));
    const remaining=5100-(performance.now()-lastCaptureReal);if(remaining>0)await delay(remaining);
    runtime.enqueue({type:'turn_head',yawDelta:0,pitchDelta:0,sceneRevision:runtime.viewerState().scene!.revision});await advance(1);
    for(let i=0;i<8&&!cp().attention.pending;i++)await advance(1);
    assert.ok(cp().attention.pending,'normal head completion supplies capture intention');
    runtime.applyControl({type:'resume'});automatic.pump([runtime]);runtime.applyControl({type:'pause'});
    const request=automatic.summary(runtime.target).inFlight;assert.ok(request,'automatic capture admitted');lastCaptureReal=performance.now();
    const metadata=await manager.wait(runtime.target,request.captureId);await immediate();assert.equal(metadata.status,'success',metadata.error??'actual render');
    await advance(1);automatic.pump([runtime]);await advance(1);
    lastCaptureId=metadata.captureId;const view=manager.view(runtime.target);await writeFile(out+'.'+label+'.png',manager.frame(runtime.target,metadata.captureId));captures.push({label,metadata,observation:view.observation,after:{offer:cp().social.offer,experiences:cp().social.experiences}});await runtime.recorder!.flush();
  };
  try {
    runtime.applyControl({type:'pause'});runtime.enqueueVisit({type:'visit_start',runId:runtime.target.runId,generation:1});await advance(1);
    await walk({x:2.97,z:-4.6});await interact('door','home');await walk({x:2.97,z:-2.65});
    await walk({x:2.97,z:-8.1});await interact('door','shop');await walk(TOWN_GEOMETRY.checkout);await interact('purchase','fruit');
    const purchased=cp();assert.equal(purchased.visit.balance,17);assert.equal(purchased.town.items.filter(item=>item.owner==='owner'&&item.consumedTick===null).length,1);
    await walk({x:2.97,z:-2.65});await walk({x:0,z:-1.75});await face(0);await control();
    const itemId=state().actor!.heldItemId!;assert.ok(itemId);await social('offer',itemId);assert.equal(cp().social.offer?.status,'pending');
    const effectsBefore=cp().body.lastEffectSequence;await capture('offer');
    const outcome=cp();assert.equal(outcome.social.offer?.response,scenario==='accept'?'accept':'decline');assert.equal(outcome.social.offer?.status,scenario==='accept'?'accepted':'declined');
    assert.equal(outcome.body.lastEffectSequence,effectsBefore,'acceptance alone supplies no nutrition');assert.equal(outcome.town.items.find(item=>item.id===itemId)!.consumedTick,null);
    assert.equal(outcome.social.experiences[0]?.perceivedIdentity,'anonymous_visitor');
    if(options.introduction!==false){await social('badge',true);await capture('introduction');assert.ok(cp().social.firstRecognizedEncounter);assert.equal(cp().social.experiences[0].perceivedIdentity,'anonymous_visitor','later identity does not rewrite earlier encounter');}
    if(options.onEncodedObservation&&lastCaptureId)providerCheck=await options.onEncodedObservation(runtime,manager,lastCaptureId);
    if(scenario==='accept'){for(let i=0;i<16&&cp().social.giftUse?.completedTick==null;i++)await advance(8);assert.equal(cp().body.lastEffectSequence,effectsBefore+1);assert.ok(cp().town.items.find(item=>item.id===itemId)!.consumedTick!==null);}
    const ending=runtime.capture();const snapshot=await runtime.recorder!.snapshotForExport();const exported=await exportIncident({runDirectory:runtime.recorder!.runDirectory,out,snapshot});assert.equal(exported.manifest.evidence_status,'COMPLETE','compact causal evidence must fit normal retention');
    const replay=await replayBundle(out);assert.equal(replay.status,'PASS');
    const summary={scenario,providerCheck,fixture:'Fresh isolated EXPERIMENT; initial present need, fixed head/view and delayed unknown-target search. Both actual doorways are opened by normal normalized interactions; a second bounded grid alignment covers the narrow valid bedside corridor. Owner uses recorded normalized controls and calculated collision-aware routes. No final Lumi response, recognition, frame feedback or semantic fact injected.',scope:runtime.target,out,checks:{paidCalls:options.onEncodedObservation?'see single-provider verification report':0,actualRenderer:true,productionPurchase:true,productionResponse:true,acceptanceNotConsumption:true,introduction:options.introduction!==false,complete:exported.manifest.evidence_status,replay},ending:{tick:ending.simulation.tick,social:cp().social,owner:runtime.viewerState().visit,items:cp().town.items,bodyEffectSequence:cp().body.lastEffectSequence},captures};
    await writeFile(out+'.summary.json',JSON.stringify(summary,null,2));return summary;
  } finally {automatic.close();await manager.close();await runtime.close();}
}

async function main(){const args=process.argv.slice(2);let out='diagnostics/social-increment3/combined.zip',scenario:'accept'|'decline'='accept';for(let i=0;i<args.length;i+=2){if(args[i]==='--out'&&args[i+1])out=args[i+1];else if(args[i]==='--scenario'&&['accept','decline'].includes(args[i+1]))scenario=args[i+1] as typeof scenario;else throw new Error('Use --scenario accept|decline --out <zip>');}const result=await runSocialLab({out,scenario});console.log(JSON.stringify({out:result.out,scenario:result.scenario,checks:result.checks,endingTick:result.ending.tick},null,2));}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void main().catch(error=>{console.error(error instanceof Error?error.message:'Social lab failed');process.exitCode=1;});
