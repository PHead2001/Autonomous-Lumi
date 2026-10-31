import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { dirname,join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BranchRegistry } from './branch-registry.js';
import { BranchRuntime } from './branch-runtime.js';
import { atomicJson,namedCheckpointPayload } from './checkpoint-storage.js';
import { publishHomeLabResult,type HomeLabCheck,type HomeLabView } from './home-lab.js';
import type { CheckpointV9 } from './simulation.js';
import { replayBundle } from './diagnostics/bundle.js';

export type TownLabScenario='shop'|'shop-closed';
type Run={view:HomeLabView;runtime:BranchRuntime;scenario:TownLabScenario;started:number;finishing:boolean;speed:number;closureQueued:boolean};

/** The fixture supplies an initial present need and a visible open doorway.
 * Target knowledge and the voluntary shopping choice require actual attended RGB.
 * Both paths retain the stocked home pantry and production body/controller rules. */
export class TownLab {
  private readonly runs=new Map<string,Run>();private pending=0;
  constructor(private readonly registry:BranchRegistry,private readonly excludeCognition:(branchId:string)=>void,private readonly exportRun:(runtime:BranchRuntime)=>Promise<string>){}
  async start(scenario:unknown):Promise<HomeLabView>{
    if(scenario!=='shop'&&scenario!=='shop-closed')throw new Error('Choose shop or shop-closed');
    if(this.runs.size+this.pending>=4)throw new Error('Town laboratory run limit reached');
    this.pending++;
    try{
      const scenarioId='town-'+randomUUID(),seedBranch='seed-'+randomUUID(),historyId=randomUUID();
      const initial=new BranchRuntime({worldId:'lumi',branchId:seedBranch,historyId,mode:'EXPERIMENT',offline:true,physiology:{active:true,genesisPreset:'production-v1'}});
      const cp=initial.checkpoint();await initial.close();
      if(cp.simulation.schemaVersion!==9)throw new Error('Current town schema required');
      const s=cp.simulation;s.config.hz=1;s.body.hz=1;s.body.satiety=.25;s.body.sleepPressure=.15;s.interoception.sampling.nextSampleTick=5;
      for(const [key,value]of Object.entries(s.attention.config))if(key.endsWith('Ticks'))(s.attention.config as unknown as Record<string,number>)[key]=Math.max(1,Math.round(Number(value)/30));
      s.character.x=-1;s.character.z=2.5;s.character.heading=Math.PI;s.character.moving=false;s.pauseUntilTick=30;s.home.controller.searchNextTick=30;
      s.town.doors.home=true;s.town.doors.homeAngle=Math.PI/2;s.scene.doorOpenRadians=Math.PI/2;
      cp.scheduler.config.hz=1;cp.scheduler.backlogMs=0;cp.control.speed=6;
      const named=namedCheckpointPayload(cp,{worldId:'lumi',branchId:seedBranch,historyId,mode:'EXPERIMENT',createdAt:new Date().toISOString()});
      await atomicJson(join(this.registry.directory,'lumi',seedBranch,'checkpoints','genesis.json'),named,true,this.registry.directory);
      // Exclusion precedes activation, including async checkpoint preparation.
      this.excludeCognition(scenarioId);
      const runtime=await this.registry.reopen({worldId:'lumi',branchId:seedBranch},'genesis',scenarioId);
      runtime.applyControl({type:'speed',speed:6});
      // A recorded normal head completion requests the real initial frame.
      // Neither attention feedback nor a semantic target/final task is supplied.
      runtime.enqueue({type:'turn_head',yawDelta:0,pitchDelta:0,sceneRevision:s.scene.revision});
      runtime.recorder?.record({tick:0,category:'OPERATIONAL_REPLAY',eventType:'TOWN_LAB_GENESIS',component:'town_lab',outcome:'isolated_fixture',data:{fixture:'present_need_open_home_door_30_world_second_idle_initial_head_orientation',kind:scenario}});
      const view:HomeLabView={scenarioId,status:'RUNNING',phase:'Looking for a readable shop opportunity',expected:scenario==='shop'?'Attend a present need, discover an actual visible opportunity, calculate a route, buy food and return home to use it.':'Discover and choose a real opportunity, encounter an actual shop closure, then use the dependable home food fallback.',observed:'Fresh isolated EXPERIMENT with a labelled stable initial view and recorded head-orientation setup. No target knowledge or shopping choice is injected. Pantry remains stocked; paid cognition is disabled.',viewerUrl:'/?'+new URLSearchParams({worldId:runtime.target.worldId,branchId:runtime.target.branchId})};
      this.runs.set(scenarioId,{view,runtime,scenario,started:performance.now(),finishing:false,speed:6,closureQueued:false});
      return structuredClone(view);
    }finally{this.pending--;}
  }
  get(id:unknown):HomeLabView{if(typeof id!=='string'||!this.runs.has(id))throw new Error('Unknown town scenario');return structuredClone(this.runs.get(id)!.view);}
  pump():void{
    for(const run of this.runs.values()){
      if(run.finishing||run.view.status!=='RUNNING')continue;
      const cp=run.runtime.simulation.checkpoint();if(cp.schemaVersion!==9)continue;
      const busy=!!cp.town.task&&['selected','started','interrupted'].includes(cp.town.task.status),homeBusy=!!cp.home.task&&['selected','started','interrupted'].includes(cp.home.task.status),speed=busy||homeBusy||run.scenario==='shop-closed'&&run.closureQueued?1:6;
      if(speed!==run.speed){run.runtime.applyControl({type:'speed',speed});run.speed=speed;}
      if(run.scenario==='shop-closed'&&!run.closureQueued&&cp.town.task?.stage==='outbound'&&cp.town.known.some(k=>k.kind==='shop'&&k.open)){
        const admission=run.runtime.enqueueTownFixture({type:'town_fixture',stock:{...cp.town.shop.stock},balance:cp.town.balance,openingOffsetSeconds:2700,shopAvailable:true});
        if(admission.input.admission==='queued')run.closureQueued=true;
      }
      run.view.phase=busy?run.runtime.viewerState().town!.activity.label:homeBusy?run.runtime.viewerState().home!.activity.label:'Looking for a readable shop opportunity';
      run.view.observed=`${cp.town.known.length} grounded route/shop cues; ${cp.town.purchases.filter(p=>p.outcome==='purchased').length} actual purchases. ${run.scenario==='shop-closed'&&run.closureQueued?'A labelled world fixture closed the store after the observed opportunity was selected. ':''}Travel and interactions run at 1×; search/waiting uses isolated 6×.`;
      const returnedTick=cp.town.timeline.filter(e=>e.type==='returned').at(-1)?.tick??Infinity;
      const done=run.scenario==='shop'?cp.town.task?.status==='completed'&&cp.town.timeline.some(e=>e.type==='consumed'):run.closureQueued&&cp.town.task?.status==='failed'&&cp.home.known.some(k=>k.kind==='pantry')&&cp.home.timeline.some(e=>e.type==='consumed'&&e.tick>returnedTick)&&cp.home.task?.status==='completed'&&cp.home.task.selectedTick>=returnedTick;
      const timeout=performance.now()-run.started>180000;
      if(done||timeout){run.finishing=true;void this.finish(run,cp,done,timeout).catch(()=>{run.view.status='INCONCLUSIVE';run.view.phase='Diagnostic export unavailable';run.view.observed='No passing result is asserted. The isolated run remains inspectable.';});}
    }
  }
  private async finish(run:Run,cp:CheckpointV9,done:boolean,timeout:boolean){
    run.runtime.applyControl({type:'pause'});
    const checks:HomeLabCheck[]=[],check=(name:string,expected:string,observed:string,pass:boolean)=>checks.push({name,expected,observed,status:pass?'PASS':'FAIL'});
    check('Grounded discovery','Actual RGB recognition precedes the selected shop journey',cp.town.known.map(k=>k.kind+':'+k.recognition).join(', '),cp.town.known.some(k=>k.kind==='shop'&&k.recognition==='authored-town-rgb-v1'));
    check('Controller choice','A local current-context choice, not an injected final action',cp.town.timeline.filter(e=>e.type==='selected').map(e=>e.label).join(', '),cp.town.timeline.some(e=>e.type==='selected'));
    if(run.scenario==='shop'){
      const purchased=cp.town.purchases.filter(p=>p.outcome==='purchased');
      check('Purchase consistency','One payment, stock decrement and owned item',`${purchased.length} committed purchases; ${cp.town.items.length} retained item records`,purchased.length===1&&cp.town.balance===20-purchased[0].price&&cp.town.items.some(i=>i.id===purchased[0].itemId));
      check('Return and valid use','Return home before once-only production consumption',cp.town.timeline.map(e=>e.type).join(', '),done&&cp.town.timeline.filter(e=>e.type==='consumed').length===1&&cp.body.lastEffectSequence===1);
    }else{
      check('Real closure','Selected observed opportunity becomes unavailable',cp.town.task?.reason??'No failure reported',run.closureQueued&&cp.town.task?.status==='failed'&&cp.town.purchases.every(p=>p.outcome!=='purchased'));
      check('Home fallback','Actual pantry recognition, then a real serving consumed after returning',cp.home.timeline.map(e=>e.type).join(', '),done&&cp.home.resources.stock===3&&cp.home.resources.held===null&&cp.body.lastEffectSequence===1);
    }
    check('Production provenance','No post-genesis body fixture taint or paid request',`${cp.physiology.origin.evidenceEligibility}; ${cp.cognition.requests.length} model requests`,cp.physiology.origin.evidenceEligibility==='eligible'&&cp.cognition.requests.length===0);
    run.view.checks=checks;
    await publishHomeLabResult(run.view,done&&checks.every(c=>c.status==='PASS')?'PASS':timeout?'INCONCLUSIVE':'FAIL',()=>this.exportRun(run.runtime));
  }
}

async function main(){
  const {createWorldServer}=await import('./world-server.js'),{loadCognitionConfig}=await import('./cognition/config.js');
  const args=process.argv.slice(2);let scenario='shop',out=resolve('diagnostics/town-lab/'+randomUUID()+'.zip');
  for(let i=0;i<args.length;i+=2){if(!args[i+1])throw new Error('Every option needs a value');if(args[i]==='--scenario')scenario=args[i+1];else if(args[i]==='--out')out=resolve(args[i+1]);else throw new Error('Use --scenario shop|shop-closed --out <zip>');}
  const app=createWorldServer({diagnosticsDirectory:out+'.runs',automaticCaptures:true,cognition:{config:loadCognitionConfig({env:{},loadEnv:false})}}),controller=new AbortController();
  const stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const port=await app.listen(0),origin='http://127.0.0.1:'+port;
    const start=await fetch(origin+'/api/town-lab/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario}),signal:controller.signal}),result=await start.json();
    if(!start.ok)throw new Error(String(result.error??'Town lab startup failed'));let view=result as HomeLabView;
    await new Promise<void>((done,reject)=>{
      let inFlight=false;
      const finish=(error?:unknown)=>{clearInterval(timer);clearTimeout(deadline);controller.signal.removeEventListener('abort',aborted);if(error)reject(error);else done();};
      const aborted=()=>finish(new Error('Town scenario interrupted; isolated evidence retained'));
      const deadline=setTimeout(()=>finish(new Error('Town scenario deadline')),200000);
      const timer=setInterval(()=>{if(inFlight)return;inFlight=true;void fetch(origin+'/api/town-lab?scenarioId='+view.scenarioId,{signal:controller.signal}).then(async response=>{const next=await response.json();if(!response.ok)throw new Error(String(next.error??'Town status unavailable'));view=next as HomeLabView;if(view.status!=='RUNNING')finish();}).catch(finish).finally(()=>{inFlight=false;});},500);
      controller.signal.addEventListener('abort',aborted,{once:true});if(controller.signal.aborted)aborted();
    });
    await mkdir(dirname(out),{recursive:true});if(view.exportUrl)await writeFile(out,Buffer.from(await(await fetch(origin+view.exportUrl,{signal:controller.signal})).arrayBuffer()));
    const replay=view.exportUrl?await replayBundle(out):null;await writeFile(out+'.summary.json',JSON.stringify({view,replay},null,2));console.log(JSON.stringify({out,view,replay},null,2));if(view.status!=='PASS'||replay?.status!=='PASS')process.exitCode=2;
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await app.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void main().catch(error=>{console.error(error);process.exitCode=1;});
