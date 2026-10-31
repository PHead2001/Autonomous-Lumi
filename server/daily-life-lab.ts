import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setImmediate as immediate,setTimeout as delay} from 'node:timers/promises';
import {BranchRuntime,type RuntimeCheckpoint} from './branch-runtime.js';
import {SocialSimulation,hashCheckpoint,type CheckpointV11,type CheckpointV12,type DeterministicEvent} from './simulation.js';
import {createBody} from './physiology.js';
import {createHomeState,homeTaskBusy} from './home.js';
import {townTaskBusy} from './town.js';
import {CaptureManager} from './vision/capture-manager.js';
import {ChromiumRenderer} from './vision/renderer.js';
import {AutomaticCaptureCoordinator} from './vision/auto-capture.js';
import {exportIncident,replayBundle} from './diagnostics/bundle.js';

type CurrentCheckpoint=CheckpointV11|CheckpointV12;
export interface DailyLifeOptions {hours:number;seed:number;out:string;adverse?:boolean}
export function urgentAttentionSample(event:DeterministicEvent):{key:string;seconds:number}|null{
  return event.type==='INTERNAL_ATTENDED'&&event.data.band==='severe'&&typeof event.data.crossingTick==='number'&&typeof event.data.eligibleSeconds==='number'?{key:String(event.data.kind)+':'+event.data.crossingTick,seconds:event.data.eligibleSeconds}:null;
}
/** Sensor-aware setup followed by explicitly numerical endurance. Fixed one-second
 * logical steps retain production rates and action durations. No final decisions,
 * known targets, or recognized observations are injected. */
export async function runDailyLifeLab(options:DailyLifeOptions){
  assert.ok(Number.isInteger(options.hours)&&options.hours>=1&&options.hours<=96);
  const started=performance.now(),out=resolve(options.out);await mkdir(dirname(out),{recursive:true});
  const source=new BranchRuntime({worldId:'daily-life',branchId:'seed',mode:'EXPERIMENT',seed:options.seed,offline:true,physiology:{active:true,genesisPreset:'production-v1'}});
  const initial=source.checkpoint();await source.close();
  const seed=initial.simulation as CurrentCheckpoint;
  assert.ok(seed.schemaVersion>=11,'complete accepted social baseline');
  seed.config.hz=1;seed.body=createBody(0,1,true);seed.interoception.sampling.nextSampleTick=5;
  for(const [key,value]of Object.entries(seed.attention.config))if(key.endsWith('Ticks'))(seed.attention.config as unknown as Record<string,number>)[key]=Math.max(1,Math.round(Number(value)/30));
  seed.home=createHomeState(0,1,seed.home.layout);
  seed.character.x=0;seed.character.z=2.4;seed.character.heading=Math.PI;seed.character.moving=false;
  seed.head.yaw=seed.head.targetYaw=0;seed.head.pitch=seed.head.targetPitch=-.12;
  seed.pauseUntilTick=30;seed.home.controller.searchNextTick=30;
  if(options.adverse){seed.town.balance=0;seed.town.shop.available=false;}
  initial.scheduler.config.hz=1;initial.scheduler.backlogMs=0;initial.control.speed=1;initial.control.paused=true;
  const learning=new BranchRuntime({worldId:'daily-life',branchId:'learning',mode:'EXPERIMENT',checkpoint:initial,directory:out+'.learning-runs'});
  const manager=new CaptureManager(()=>true,new ChromiumRenderer()),automatic=new AutomaticCaptureCoordinator(manager,()=>true,undefined,()=>true);
  const captures:unknown[]=[];
  let learned:RuntimeCheckpoint;
  const step=async(runtime:BranchRuntime,n=1)=>{assert.ok(n>0&&n<=128);runtime.applyControl({type:'fast-forward',ticks:n});while(runtime.captureAvailability().fastForwardRemaining)await immediate();};
  try{
    learning.enqueue({type:'turn_head',yawDelta:0,pitchDelta:0,sceneRevision:seed.scene.revision});
    for(let attempts=0;attempts<24;attempts++){
      await step(learning);learning.applyControl({type:'resume'});automatic.pump([learning]);learning.applyControl({type:'pause'});
      const work=automatic.summary(learning.target).inFlight;
      if(work){const metadata=await manager.wait(learning.target,work.captureId);await immediate();await step(learning);automatic.pump([learning]);await step(learning);
        captures.push({metadata,known:(learning.simulation.checkpoint() as CurrentCheckpoint).home.known});
        if(metadata.status==='success')await writeFile(out+'.initial-'+captures.length+'.png',manager.frame(learning.target,work.captureId));
      }
      const cp=learning.simulation.checkpoint() as CurrentCheckpoint;
      if(cp.home.known.some(k=>k.kind==='bed')&&cp.home.known.some(k=>k.kind==='pantry'))break;
      // Real host quota remains authoritative. Bounded world steps let the
      // normal stable-pose search propose further actual images when needed.
      await step(learning,5);await delay(5100);
    }
    learned=learning.capture();const known=(learned.simulation as CurrentCheckpoint).home.known;
    assert.ok(known.some(k=>k.kind==='bed')&&known.some(k=>k.kind==='pantry'),'actual attended RGB must establish both home resources');
    const snapshot=await learning.recorder!.snapshotForExport();await exportIncident({runDirectory:learning.recorder!.runDirectory,out:out+'.learning.zip',snapshot});
    const replay=await replayBundle(out+'.learning.zip');assert.equal(replay.status,'PASS');
  }finally{automatic.close();await manager.close();await learning.close();}
  const numeric=new BranchRuntime({worldId:'daily-life',branchId:'endurance',mode:'EXPERIMENT',checkpoint:learned!,offline:true});
  const simulation=numeric.simulation as SocialSimulation;
  const startCheckpoint=numeric.checkpoint(),startTick=simulation.state.tick,endTick=startTick+options.hours*3600;
  const seconds={awake:0,sleep:0,incapacitated:0,compulsoryMaintenance:0,free:0,optionalActivity:0};
  const counts:Record<string,number>={},urgentLatencies:number[]=[],critical:unknown[]=[];
  const samples:unknown[]=[],windows:unknown[]=[],seenUrgent=new Set<string>();let peakPending=0,foodWindow:RuntimeCheckpoint|null=null;
  const observe=(events:DeterministicEvent[])=>{for(const e of events){counts[e.type]=(counts[e.type]??0)+1;const sample=urgentAttentionSample(e);if(sample&&!seenUrgent.has(sample.key)){seenUrgent.add(sample.key);urgentLatencies.push(sample.seconds);}if(e.type==='BODY_RECOVERY_STARTED'||e.type==='BODY_RECOVERY_COMPLETED'||e.type==='BODY_MODE_CHANGED'&&e.data.to==='incapacitated')critical.push({tick:e.tick,...e.data});}};
  while(simulation.state.tick<endTick){
    const body=simulation.bodyState(),home=simulation.homeState(),town=simulation.townState(),percepts=simulation.presentInternalSensations();
    const asleep=body.mode==='asleep',incapacitated=body.mode==='incapacitated';
    if(asleep)seconds.sleep++;else if(incapacitated)seconds.incapacitated++;else{
      seconds.awake++;
      // Evaluator-only thresholds conservatively include unmet-need waiting even
      // after a transient expires. These values never enter the controller.
      const need=percepts.some(p=>p.band!=='mild')||body.satiety<=.3||body.sleepPressure>=.65;
      const maintaining=homeTaskBusy(home)||townTaskBusy(town)||home.resources.held!==null||home.controller.searchOriginHeading!==null||need||body.mode==='resting'||body.condition<body.config.recoveryCondition;
      if(maintaining)seconds.compulsoryMaintenance++;else if((simulation.checkpoint() as CurrentCheckpoint).activity.status==='running')seconds.optionalActivity++;else seconds.free++;
    }
    const events=simulation.step();observe(events);
    if(foodWindow===null&&events.some(e=>e.type==='HOME_GOAL_SELECTED'&&e.data.kind==='eat'))foodWindow=numeric.checkpoint();
    if(simulation.state.tick%3600===0){const checkpoint=simulation.checkpoint() as CurrentCheckpoint;peakPending=Math.max(peakPending,checkpoint.pendingInputs.length);samples.push({tick:checkpoint.tick,body:checkpoint.body,homeTask:checkpoint.home.task,townTask:checkpoint.town.task,known:checkpoint.home.known.length});await immediate();}
  }
  const ending=numeric.checkpoint(),final=ending.simulation as CurrentCheckpoint;
  const maintenanceFraction=seconds.compulsoryMaintenance/Math.max(1,seconds.awake);
  if(foodWindow){
    const window=new BranchRuntime({worldId:'daily-life',branchId:'food-window',mode:'EXPERIMENT',checkpoint:foodWindow,directory:out+'.food-runs'});
    try{
      for(let i=0;i<1200;i++){await step(window);const cp=window.simulation.checkpoint() as CurrentCheckpoint;if(cp.home.task?.status==='completed'||cp.home.task?.status==='failed')break;}
      window.capture();const snapshot=await window.recorder!.snapshotForExport();const exported=await exportIncident({runDirectory:window.recorder!.runDirectory,out:out+'.food.zip',snapshot});
      const replay=await replayBundle(out+'.food.zip');assert.equal(exported.manifest.evidence_status,'COMPLETE');assert.equal(replay.status,'PASS');windows.push({kind:'representative_home_food',sourceTick:foodWindow.simulation.tick,scope:'isolated copy from whole-trial selected action checkpoint',coverage:'COMPLETE',replay});
    }finally{await window.close();}
  }
  const summary={seed:options.seed,hours:options.hours,actualWorldSeconds:endTick-startTick,actualHostSeconds:(performance.now()-started)/1000,fixture:'One-second fixed logical ticks; production body/action rates; actual initial RGB learning; no model/provider; numerical continuation retains known home layout. No fresh numerical images are claimed.',adverse:options.adverse?'Shop unavailable and unaffordable from declared genesis; stocked replenishing home pantry/bed retained':'Production nominal state, stocked pantry/bed, no owner',seconds,maintenanceFraction,counts,urgentLatencies,critical,observations:{actualCaptures:captures,failed:captures.filter(c=>(c as {metadata:{status:string}}).metadata.status!=='success').length,numericalFreshCaptures:0,coverage:'Initial actual captured/attended learning only; later numerical endurance does not prove fresh external discoveries.'},models:{requests:final.cognition.requests.length,costUsd:0},state:{startingHash:hashCheckpoint(startCheckpoint.simulation),endingHash:hashCheckpoint(final),startingTick:startTick,endingTick:endTick,peakPending,finalBody:final.body},checks:{noCriticalState:seconds.incapacitated===0,minorityAwakeMaintenance:maintenanceFraction<.5,foodCompleted:(counts.HOME_FOOD_CONSUMED??0)>0,restCompleted:(counts.HOME_SLEEP_STARTED??0)>0,noUrgentMiss:(counts.INTERNAL_DEADLINE_BREACH??0)===0},replay:{fullTrial:'NOT_CLAIMED: numerical aggregate/start/end plus COMPLETE initial-learning and copied-action causal ZIPs; no fabricated retained prefix.',windows},samples};
  await writeFile(out+'.start.json',JSON.stringify(startCheckpoint));await writeFile(out+'.end.json',JSON.stringify(ending));await writeFile(out+'.summary.json',JSON.stringify(summary,null,2));await numeric.close();
  assert.ok(summary.checks.noCriticalState,'ordinary daily care must not leave critical incapacity');assert.ok(summary.checks.minorityAwakeMaintenance,'maintenance must remain below half of awake time');assert.ok(summary.checks.foodCompleted,'actual production home food consumed');assert.ok(summary.checks.restCompleted,'production bed sleep completed');assert.ok(summary.checks.noUrgentMiss,'no eligible urgent attention deadline missed');
  return summary;
}
/** Declared overdue-needs fixture copies legitimately learned layout knowledge.
 * No sensor/body debug command, eaten meal or final controller choice is used. */
export async function runCriticalRecoveryLab(from:string,outValue:string){
  const out=resolve(outValue);await mkdir(dirname(out),{recursive:true});
  const initial=JSON.parse(await readFile(resolve(from),'utf8')) as RuntimeCheckpoint,cp=initial.simulation as CurrentCheckpoint;
  // Awake just above the hard boundary: the ordinary next fixed-step deficit
  // causes collapse and starts its real unconscious interval, not a fixture event.
  Object.assign(cp.body,{satiety:0,reserves:0,condition:.200001,sleepPressure:.8,mode:'awake',modeSinceTick:cp.tick,absorption:[]});
  const startPosition={x:cp.character.x,z:cp.character.z};
  let recoveredTick:number|null=null,consumedTick:number|null=null,completionEvents=0,recoveryPosition:unknown=null,midRestore=false;
  const events:Record<string,number>={};
  const startEffects=cp.body.lastEffectSequence;
  const runtime=new BranchRuntime({worldId:'daily-life',branchId:'critical-recovery',mode:'EXPERIMENT',checkpoint:initial,directory:out+'.runs',onEvents:changes=>{
    for(const event of changes){events[event.type]=(events[event.type]??0)+1;
      if(event.type==='BODY_RECOVERY_COMPLETED'){completionEvents++;recoveredTick??=event.tick;const current=runtime.simulation.checkpoint() as CurrentCheckpoint;recoveryPosition={x:current.character.x,z:current.character.z};assert.deepEqual(recoveryPosition,startPosition);assert.equal(current.body.reserves,0);assert.equal(current.body.satiety,0);assert.equal(current.body.lastEffectSequence,startEffects);}
      if(event.type==='HOME_FOOD_CONSUMED')consumedTick??=event.tick;
    }
  }});
  try{
    const start=runtime.capture();
    for(let elapsed=0;elapsed<8*3600;elapsed+=128){
      runtime.applyControl({type:'fast-forward',ticks:128});while(runtime.captureAvailability().fastForwardRemaining)await immediate();
      const current=runtime.simulation.checkpoint() as CurrentCheckpoint;
      // Lifecycle and body state are checked each step; event totals are derived
      // from the retained causal snapshot, never invented from UI labels.
      if(elapsed>=3600&&!midRestore){const copied=new BranchRuntime({worldId:'daily-life',branchId:'recovery-copy',mode:'EXPERIMENT',checkpoint:runtime.checkpoint(),offline:true});assert.equal(hashCheckpoint(copied.simulation.checkpoint()),hashCheckpoint(current));await copied.close();midRestore=true;}
      if(consumedTick!==null)break;
      await runtime.recorder!.flush();await immediate();
    }
    const end=runtime.capture(),snapshot=await runtime.recorder!.snapshotForExport();
    const exported=await exportIncident({runDirectory:runtime.recorder!.runDirectory,out:out+'.zip',snapshot}),replay=await replayBundle(out+'.zip');
    const ending=end.simulation as CurrentCheckpoint;
    const result={fixture:'Initial overdue awake state copied from actual learned-layout checkpoint; zero reserves/satiety/absorption, condition .200001. The next ordinary deficit step causes collapse. Reversible-weakness rest is engine recovery, not nutrition. No provider or fresh sensory claims while unconscious.',startTick:start.simulation.tick,recoveredTick,consumedTick,recoveryPosition,midRestore,completionEvents,events,bodyEffects:ending.body.lastEffectSequence-startEffects,finalBody:ending.body,coverage:exported.manifest.evidence_status,replay,checks:{recovered:recoveredTick!==null,actualFood:consumedTick!==null,oneNutrition:events.BODY_INTAKE_ACCEPTED===1&&events.HOME_FOOD_CONSUMED===1,oneRecovery:events.BODY_RECOVERY_STARTED===1&&completionEvents===1,locationPreserved:JSON.stringify(recoveryPosition)===JSON.stringify(startPosition),noFalseVisualMemory:ending.realExperiences.length===(start.simulation as CurrentCheckpoint).realExperiences.length}};
    await writeFile(out+'.summary.json',JSON.stringify(result,null,2));assert.equal(result.coverage,'COMPLETE');assert.equal(replay.status,'PASS');for(const [key,value]of Object.entries(result.checks))assert.ok(value,key);return result;
  }finally{await runtime.close();}
}
async function main(){const args=process.argv.slice(2);const values=new Map<string,string>();for(let i=0;i<args.length;i+=2){assert.ok(args[i+1]);values.set(args[i],args[i+1]);}if(values.get('--scenario')==='recovery'){const result=await runCriticalRecoveryLab(values.get('--from')??'diagnostics/daily-life/nominal.start.json',values.get('--out')??'diagnostics/daily-life/recovery');console.log(JSON.stringify(result,null,2));return;}const result=await runDailyLifeLab({hours:Number(values.get('--hours')??24),seed:Number(values.get('--seed')??13579),out:values.get('--out')??'diagnostics/daily-life/nominal',adverse:values.get('--adverse')==='true'});console.log(JSON.stringify({hours:result.hours,seconds:result.seconds,maintenanceFraction:result.maintenanceFraction,checks:result.checks,hostSeconds:result.actualHostSeconds},null,2));}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void main().catch(error=>{console.error(error);process.exitCode=1;});
