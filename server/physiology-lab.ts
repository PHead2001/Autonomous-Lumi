import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BranchRuntime } from './branch-runtime.js';
import { createWorldServer } from './world-server.js';
import { loadCognitionConfig } from './cognition/config.js';
import { exportIncident, replayBundle } from './diagnostics/bundle.js';
import { readRun } from './diagnostics/recorder.js';
import type { CheckpointV6 } from './simulation.js';

export interface LabAssertion { name:string; expected:string; observed:unknown; status:'PASS'|'FAIL'|'INCONCLUSIVE' }
const bodyCheckpoint=(runtime:BranchRuntime):CheckpointV6=>{const cp=runtime.simulation.checkpoint();if(cp.schemaVersion!==6)throw new Error('Physiology schema required');return cp;};
/** This entry owns a disposable namespace. It never loads owner recovery, dotenv,
 * provider credentials or the application budget, even if normal cognition is on. */
export async function runHungerLab(options:{out:string;directory?:string}) {
  const out=resolve(options.out),directory=resolve(options.directory??out+'.runs','lab-'+randomUUID()),historyId=randomUUID();
  await mkdir(dirname(out),{recursive:true});
  let elapsed=0;
  const clock={monotonicMs:()=>elapsed,utcMs:()=>1800000000000+elapsed};
  const genesis=new BranchRuntime({worldId:'lumi',branchId:'live',historyId,mode:'LIVE',offline:true,seed:2501,physiology:{active:true}});
  const fixture=genesis.checkpoint();await genesis.close();
  // Explicit laboratory genesis fixture: one-second ticks, production rates and
  // initial stores. This is a calibration experiment, never an owner migration.
  fixture.simulation.config.hz=1;
  if(fixture.simulation.schemaVersion!==6)throw new Error('Physiology schema required');
  fixture.simulation.body.hz=1;fixture.simulation.pauseUntilTick=100000;fixture.simulation.character.moving=false;fixture.scheduler.config.hz=1;
  const app=createWorldServer({checkpoint:fixture,historyId,diagnosticsDirectory:directory,clock,autoSchedule:false,automaticCaptures:false,cognition:{config:loadCognitionConfig({env:{},loadEnv:false})}});
  const assertions:LabAssertion[]=[];
  const check=(name:string,expected:string,observed:unknown,pass:boolean|null)=>assertions.push({name,expected,observed,status:pass===null?'INCONCLUSIVE':pass?'PASS':'FAIL'});
  let runtime:BranchRuntime|undefined;
  try {
    await app.listen(0);
    const source=await app.registry.checkpoint(app.registry.live.target);
    runtime=await app.registry.fork(app.registry.live.target,source.id,'hunger-during-task');
    runtime.applyControl({type:'speed',speed:1});runtime.enqueueInternalEncoding(false);
    const advance=async(ticks:number)=>{for(let i=0;i<ticks;i++){elapsed+=1000;if(runtime!.pump()!==1)throw new Error('Laboratory clock failed to advance one fixed tick');if(i%512===511){await runtime!.recorder?.flush();await new Promise<void>(done=>setImmediate(done));}}};
    await advance(18000);runtime.applyControl({type:'activity-start',totalTicks:100000});
    await advance(2000);const mild=bodyCheckpoint(runtime);
    check('mild cue ignored during focus','mild hunger sensed, no attended hunger', {band:mild.interoception.slots[0].band,transient:mild.interoception.transient.length,activity:mild.activity.status},mild.interoception.slots[0].band==='mild'&&!mild.interoception.transient.some(s=>s.percept.kind==='hunger')&&mild.activity.status==='running');
    await advance(20000);const rising=bodyCheckpoint(runtime);
    check('rising need','moderate hunger while activity continues',{band:rising.interoception.slots[0].band,status:rising.activity.status},rising.interoception.slots[0].band==='moderate'&&rising.activity.status==='running');
    await advance(9125);const severe=bodyCheckpoint(runtime),urgent=severe.interoception.slots[0].urgent;
    const present='providerInternalSensations' in runtime.simulation?runtime.simulation.providerInternalSensations():[];
    check('urgent awareness','severe hunger attended within 30 eligible world seconds',{...urgent,worldSeconds:urgent?.firstAttendedTick===null||!urgent?null:(urgent.firstAttendedTick-urgent.crossingTick)/severe.config.hz},!!urgent&&urgent.firstAttendedTick!==null&&urgent.eligibleTicks/severe.config.hz<=30&&urgent.breachTick===null);
    check('transient without encoding','present severe hunger is consumable with encoder disabled',{present,episodes:severe.internalExperiences.length},present.some(s=>s.kind==='hunger'&&s.band==='severe')&&severe.internalExperiences.length===0&&!severe.physiology.encodingEnabled);
    check('voluntary action remains separate','task continues, no meal action or meal memory',{activity:severe.activity.status,realExperiences:severe.realExperiences.length},severe.activity.status==='running'&&severe.realExperiences.length===0);
    const before={satiety:severe.body.satiety,reserves:severe.body.reserves};
    runtime.enqueuePhysiologyFixture({sequence:1,type:'intake',satiety:.7,reserves:.15,absorptionSeconds:1800});
    await advance(1);const promptRelief=bodyCheckpoint(runtime);
    await app.registry.checkpoint(runtime.target);
    await advance(1800);const recovered=bodyCheckpoint(runtime);
    check('explicit fixture recovery','prompt satiety relief then slower reserve absorption; experiment only',{before,promptSatiety:promptRelief.body.satiety,promptReserves:promptRelief.body.reserves,afterSatiety:recovered.body.satiety,afterReserves:recovered.body.reserves,absorption:recovered.body.absorption.length,mode:runtime.mode},promptRelief.body.satiety>before.satiety+.65&&promptRelief.body.reserves<before.reserves+.01&&recovered.body.reserves>before.reserves+.1&&recovered.body.absorption.length===0&&runtime.mode==='EXPERIMENT');
    check('models suppressed','zero cognition requests and both providers disabled',{requests:recovered.cognition.requests.length,main:app.cognition.config.main.enabled,decisions:app.cognition.config.decisions.enabled},recovered.cognition.requests.length===0&&!app.cognition.config.main.enabled&&!app.cognition.config.decisions.enabled);
    const runDirectory=runtime.recorder!.runDirectory,target=runtime.target;
    runtime.capture();await app.close();
    const exported=await exportIncident({runDirectory,out,expectedWorldId:target.worldId,expectedBranchId:target.branchId,expectedRunId:target.runId});
    check('sanitized diagnostic evidence','COMPLETE recorded deterministic evidence',exported.manifest.evidence_status,exported.manifest.evidence_status==='COMPLETE');
    let replay:Awaited<ReturnType<typeof replayBundle>>|null=null;
    try{replay=await replayBundle(out);check('offline replay','matching final state, event and runtime hashes',replay,replay.status==='PASS');}catch(error){check('offline replay','matching final state, event and runtime hashes',String(error),false);}
    const run=await readRun(runDirectory);
    const timeline=run.records.filter(r=>r.event_type.startsWith('INTERNAL_')||r.event_type.startsWith('BODY_')).map(r=>({tick:r.world_tick,type:r.event_type,outcome:r.outcome,data:r.data}));
    const result={scenario:'Hunger during a task',status:assertions.some(a=>a.status==='FAIL')?'FAIL':assertions.some(a=>a.status==='INCONCLUSIVE')?'INCONCLUSIVE':'PASS',fixture:'Isolated EXPERIMENT; explicit one-second genesis ticks, production-v1 initial stores/rates; intake is a nutrition fixture, not an acquired or eaten meal.',historyId,target,out,runDirectory,worldSeconds:recovered.tick/recovered.config.hz,assertions,timeline,replay,limitations:['No food acquisition or eating behavior is asserted.','No paid provider request or prolonged desktop uptime is exercised.','Positive eligible LIVE encoding is covered separately by disposable acceptance tests.']};
    await writeFile(out+'.summary.json',JSON.stringify(result,null,2)+'\n');return result;
  } finally {await app.close();}
}
async function main(){const args=process.argv.slice(2);if(args.length%2)throw new Error('Use --out <zip> [--directory <new-isolated-directory>]');const opts:Record<string,string>={};for(let i=0;i<args.length;i+=2){if(!['--out','--directory'].includes(args[i])||!args[i+1])throw new Error('Unknown or missing lab option');opts[args[i].slice(2)]=args[i+1];}const result=await runHungerLab({out:opts.out??'diagnostics/physiology-lab/hunger-'+randomUUID()+'.zip',directory:opts.directory});console.log(JSON.stringify(result,null,2));if(result.status!=='PASS')process.exitCode=2;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void main().catch(error=>{console.error(error);process.exitCode=1;});
