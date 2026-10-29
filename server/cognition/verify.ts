import { mkdir,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { BranchRuntime } from '../branch-runtime.js';
import { createWorldServer } from '../world-server.js';
import { RecoveryStore } from '../recovery-store.js';
import { CaptureManager } from '../vision/capture-manager.js';
import { AutomaticCaptureCoordinator } from '../vision/auto-capture.js';
import { ChromiumRenderer } from '../vision/renderer.js';
import { groundSnapshot } from '../vision/grounding.js';
import { exportIncident,replayBundle } from '../diagnostics/bundle.js';
import { hashCanonical } from '../canonical.js';
import { createVisibilityFixture } from '../../shared/vision-fixture.js';
import type { CognitionRequestState } from '../../shared/cognition-protocol.js';
import { CognitionCoordinator,type CognitionProviderClient } from './coordinator.js';
import { loadCognitionConfig,safeCognitionConfig,type CognitionConfig } from './config.js';
import { DurableBudget } from './budget.js';
import { CognitionProviders,type InterpretationInput,type ProviderResult,type DecisionInput } from './providers.js';

export interface VerificationOptions {paid:boolean;mock:boolean;decisions:boolean;serveSeconds:number;out:string}
export function verificationOptions(args:string[]):VerificationOptions {
  const result:VerificationOptions={paid:false,mock:false,decisions:false,serveSeconds:0,out:resolve('diagnostics','cognition-checks',new Date().toISOString().replace(/[^0-9]/g,''))};
  for(let i=0;i<args.length;i++){
    const arg=args[i];if(arg==='--paid')result.paid=true;else if(arg==='--mock')result.mock=true;else if(arg==='--decisions')result.decisions=true;
    else if(arg==='--out'&&args[i+1])result.out=resolve(args[++i]);
    else if(arg==='--serve'&&args[i+1]){result.serveSeconds=Number(args[++i]);if(!Number.isInteger(result.serveSeconds)||result.serveSeconds<1||result.serveSeconds>600)throw new Error('--serve requires 1 through 600 seconds');}
    else throw new Error('Use --paid or --mock, optional --decisions, --out <directory>, --serve <1..600 seconds>');
  }
  if(result.paid===result.mock||result.paid&&result.serveSeconds>0)throw new Error('Choose exactly one of --paid or --mock; --serve is for the MOCK companion');
  return result;
}
export function verificationPreflight(options:VerificationOptions,config:CognitionConfig){
  return {status:options.mock?'MOCK':config.main.available?'ready':'unavailable',actualProviderAcceptance:false,reason:options.mock?'MOCK provider; actual renderer only':config.main.available?'explicit paid opt-in; bounded six main requests':'Set LUMI_COGNITION_ENABLED=true and OPENROUTER_API_KEY locally; credentials alone do not enable calls',maximumMainCalls:options.mock?2:6,maximumDecisionsCalls:options.decisions?1:0,ceilingUsd:config.budget.ceilingUsd};
}
interface CaseAcceptanceEvidence {case:string;requests?:{status?:string}[];bundle?:{evidence?:string;replay?:{status?:string}};restartWithCognitionDisabled?:{survived?:boolean}}
/** Image capability and end-to-end acceptance are separate evidence claims. A
 * persisted memory cannot compensate for an incomplete diagnostic/replay chain. */
export function verificationAcceptance(cases:readonly CaseAcceptanceEvidence[],failure:string|null){
  const required=['visible','partial','dark','absent','hidden','temporary-live'],gaps:string[]=[];
  const imageCases=required.slice(0,5).map(name=>cases.find(c=>c.case===name));
  const actualImageInterpretationEvidence=imageCases.every(c=>c?.requests?.[0]?.status==='success');
  for(const name of required){
    const c=cases.find(c=>c.case===name);
    if(!c){gaps.push(name+': missing scenario');continue;}
    if(c.requests?.[0]?.status!=='success')gaps.push(name+': no successful interpretation');
    if(c.bundle?.evidence!=='COMPLETE'||c.bundle.replay?.status!=='PASS')gaps.push(name+': complete offline replay evidence unavailable');
  }
  const livePersistenceVerified=cases.find(c=>c.case==='temporary-live')?.restartWithCognitionDisabled?.survived===true;
  if(!livePersistenceVerified)gaps.push('temporary-live: admitted experience did not survive disabled-cognition restart');
  const actualProviderAcceptance=!failure&&gaps.length===0;
  return {status:failure?'failed':actualProviderAcceptance?'passed':'incomplete',actualProviderAcceptance,actualImageInterpretationEvidence,livePersistenceVerified,offlineReplayComplete:required.every(name=>{const c=cases.find(c=>c.case===name);return c?.bundle?.evidence==='COMPLETE'&&c.bundle.replay?.status==='PASS';}),evidenceGaps:gaps};
}
const empty=(model:string,status:ProviderResult['status']):ProviderResult=>({status,content:null,provider:'openrouter',model,modelRevision:null,latencyMs:0,attempts:0,inputTokens:null,outputTokens:null,costUsd:null,costBasis:'unknown',reservedUsd:0});

/** Private evidence files contain bounded filtered DTOs and PNGs, never credentials,
 * raw full prompts or provider envelopes. Case labels never enter provider input. */
class EvidenceClient implements CognitionProviderClient {
  readonly inputs:Record<string,unknown>[]=[];
  private mainCalls=0;private decisionsCalls=0;private caseName='';private caseCalls=0;private lastCallMs=-Infinity;
  private refusal=false;
  readonly budget:CognitionProviderClient['budget'];
  constructor(private readonly config:CognitionConfig,private readonly directory:string,private readonly actual:CognitionProviders|null){this.budget=actual?.budget??{snapshot:async()=>({ceilingUsd:config.budget.ceilingUsd,accountedUsd:0,pending:0,unknown:0,reportedUsd:0,estimatedUsd:0})};}
  begin(name:string,refusal=false){this.caseName=name;this.caseCalls=0;this.refusal=refusal;}
  status(){return {...(this.actual?.status()??{...safeCognitionConfig(this.config),pending:0,queued:0}),mode:this.actual?'REAL PROVIDER CONFIGURED':'MOCK TEST PROVIDER'};}
  async interpret(input:InterpretationInput):Promise<ProviderResult>{
    if(this.mainCalls>=(this.actual?6:2)||this.caseCalls>=1)return empty(this.config.main.model,'budget_exhausted');
    this.mainCalls++;this.caseCalls++;
    if(this.actual)await delay(Math.max(0,this.config.limits.minRealIntervalMs-(performance.now()-this.lastCallMs)));
    this.lastCallMs=performance.now();
    const image=Buffer.from(input.png),context=structuredClone(input.context),contextText=JSON.stringify(context),imageHash=createHash('sha256').update(image).digest('hex');
    await writeFile(join(this.directory,input.requestId+'.png'),image);
    // Dedicated context evidence is an allowlisted DTO, not the full request prompt.
    await writeFile(join(this.directory,input.requestId+'-context.json'),JSON.stringify(context,null,2));
    let result:ProviderResult;
    if(this.actual)result=await this.actual.interpret(input);
    else if(this.refusal)result={...empty(this.config.main.model,'refused'),attempts:1,latencyMs:1};
    else result={...empty(this.config.main.model,'ok'),attempts:1,latencyMs:1,content:JSON.stringify({observationId:context.observationId,frameHash:context.frameHash,interpretation:'MOCK TEST PROVIDER: a fallible interpretation of the supplied visible image; this is offline fixture evidence.',uncertainty:.65,evidenceHandles:context.shapes.slice(0,1).map(s=>s.handle),action:{type:'continue'}})};
    const forbidden=new Set(['x','y','z','position','engineTargetId','sourceId','cause','case','label','tick','time','capturedTick','worldTimeSeconds','worldScope','historyId','worldId','branchId','runId']);
    const fields:string[]=[];const inspect=(value:unknown)=>{if(Array.isArray(value))for(const child of value)inspect(child);else if(value&&typeof value==='object')for(const [field,child]of Object.entries(value)){if(forbidden.has(field))fields.push(field);inspect(child);}};inspect(context);
    this.inputs.push({case:this.caseName,requestId:input.requestId,imageHash,contextHash:hashCanonical(context),imageBytes:image.length,contextBytes:Buffer.byteLength(contextText),dimensions:[image.readUInt32BE(16),image.readUInt32BE(20)],shapeCount:context.shapes.length,inputBoundaryInspection:{validator:'exact validateCognitionContext allowlist',forbiddenFieldCount:fields.length,forbiddenFields:fields},status:result.status,provider:this.actual?'openrouter':'MOCK TEST PROVIDER',model:result.model,latencyMs:result.latencyMs,inputTokens:result.inputTokens,outputTokens:result.outputTokens,costUsd:result.costUsd,costBasis:result.costBasis});
    return result;
  }
  async decide(input:DecisionInput){
    if(!this.actual||this.decisionsCalls++>=1)return {...empty(this.config.decisions.model,'unavailable'),provider:'openai' as const,answer:null};
    await delay(Math.max(0,this.config.limits.minRealIntervalMs-(performance.now()-this.lastCallMs)));this.lastCallMs=performance.now();
    return this.actual.decide(input);
  }
}
function requests(runtime:BranchRuntime):CognitionRequestState[]{const cp=runtime.simulation.checkpoint();return cp.schemaVersion===5?cp.cognition.requests:[];}
async function waitFor(predicate:()=>boolean,pump:()=>void,timeoutMs=60000):Promise<void>{
  await new Promise<void>((done,reject)=>{
    const timer=setTimeout(()=>{clearInterval(interval);reject(new Error('Bounded scenario deadline exceeded'));},timeoutMs);
    const interval=setInterval(()=>{try{pump();if(predicate()){clearTimeout(timer);clearInterval(interval);done();}}catch(e){clearTimeout(timer);clearInterval(interval);reject(e);}},1000/30);
  });
}
async function bundle(runtime:BranchRuntime,out:string){
  runtime.capture();const snapshot=await runtime.recorder!.snapshotForExport();
  const exported=await exportIncident({runDirectory:runtime.recorder!.runDirectory,out,snapshot,expectedWorldId:runtime.target.worldId,expectedBranchId:runtime.target.branchId,expectedRunId:runtime.target.runId});
  const replay=exported.manifest.evidence_status==='COMPLETE'?await replayBundle(out):{status:'INCOMPLETE'};
  return {path:out,evidence:exported.manifest.evidence_status,replay,hashes:exported.manifest.hashes};
}
function resultView(runtime:BranchRuntime){return requests(runtime).map(r=>({requestId:r.request.requestId,purpose:r.request.purpose,captureId:r.request.selection.captureId,frameHash:r.request.selection.frameHash,capturedTick:r.request.selection.capturedTick,attentionTick:r.request.selection.attentionTick,requestedTick:r.requestedTick,receiptTick:r.resultTick,status:r.result?.outcome,interpretation:r.result?.proposal?.interpretation,uncertainty:r.result?.proposal?.uncertainty,action:r.action,encoding:r.encoding,metrics:r.result?.metrics}));}

async function experimentCase(name:string,config:CognitionConfig,client:EvidenceClient,directory:string,compareDecisions:boolean){
  client.begin(name);
  const source=new BranchRuntime({worldId:'capability-check',branchId:name,historyId:'isolated-capability-history',mode:'EXPERIMENT',offline:true}),checkpoint=source.checkpoint();await source.close();
  const cp=checkpoint.simulation;if(cp.schemaVersion!==5)throw new Error('Cognition schema required');
  const fixture=createVisibilityFixture();cp.character=fixture.character;cp.head=fixture.head!;cp.scene=fixture.scene!;cp.pauseUntilTick=100000;
  if(name==='partial'){cp.head.yaw=.25;cp.head.targetYaw=.25;}
  if(name==='dark')cp.scene.illumination=0;
  if(name==='absent')cp.scene.fixture='none';
  if(name==='hidden')cp.character.heading=Math.PI;
  const runtime=new BranchRuntime({worldId:'capability-check',branchId:name,historyId:'isolated-capability-history',mode:'EXPERIMENT',checkpoint,directory});await runtime.prepare();runtime.applyControl({type:'speed',speed:1});
  const renderer=new ChromiumRenderer(),manager=new CaptureManager(scope=>scope.runId===runtime.target.runId,renderer),host=new CognitionCoordinator(config,client,manager,()=>true,'isolated-capability-history'),automatic=new AutomaticCaptureCoordinator(manager,()=>true,undefined,(r,i)=>host.selectedCapture(r,i));
  try{
    const privateCoverage=groundSnapshot(runtime.viewerState()).objects.map(o=>({measurementKey:o.id,status:o.status,eligible:o.eligible}));
    runtime.applyControl({type:'activity-start',totalTicks:3});
    await waitFor(()=>requests(runtime).some(r=>r.status==='completed'),()=>{runtime.pump();automatic.pump([runtime]);host.pump([runtime]);});
    let decisions:unknown={status:'not_requested',adoption:'insufficient evidence to adopt'};
    if(compareDecisions){
      if(!config.decisions.available)decisions={status:'unavailable',adoption:'insufficient evidence to adopt; LIVE disabled'};
      else{
        const initial=requests(runtime)[0];
        await waitFor(()=>{const cp=runtime.simulation.checkpoint();return cp.schemaVersion===5&&runtime.simulation.state.tick>=cp.cognition.nextRequestTick;},()=>runtime.pump(),10000);
        await delay(config.limits.minRealIntervalMs);
        const admitted=host.requestDecisionEvaluation(runtime,initial.request.selection.captureId);
        if(admitted.queued){await waitFor(()=>requests(runtime).some(r=>r.request.requestId===admitted.requestId&&r.status==='completed'),()=>{runtime.pump();host.pump([runtime]);});decisions={status:'evaluated',localBaseline:'continue',fixedLegalChoices:['continue','request_observation'],comparison:resultView(runtime).find(r=>r.requestId===admitted.requestId),adoption:'one matched case is insufficient evidence to adopt; LIVE disabled'};}
        else decisions={status:admitted.reason,adoption:'insufficient evidence to adopt; LIVE disabled'};
      }
    }
    const report={case:name,classification:'ACTUAL RENDERER / EXPERIMENT',privateEvaluationCoverage:privateCoverage,requests:resultView(runtime),decisions,bundle:await bundle(runtime,join(directory,name+'.zip'))};
    console.log(JSON.stringify({case:name,status:requests(runtime)[0]?.result?.outcome,actualRenderer:true}));return report;
  }finally{automatic.close();host.close([runtime]);await manager.close();await runtime.close();}
}
async function liveRecoveryCase(config:CognitionConfig,client:EvidenceClient,directory:string){
  client.begin('temporary-live');const liveDirectory=join(directory,'temporary-live');
  const selected=await RecoveryStore.open({directory:liveDirectory,newWorld:true});
  const world=createWorldServer({diagnosticsDirectory:liveDirectory,recoveryStore:selected.store,checkpoint:selected.checkpoint,cognition:{config,providers:client}});
  let first:ReturnType<typeof resultView>=[],ids:string[]=[],historyId='',diagnostic:Awaited<ReturnType<typeof bundle>>|undefined;
  try{
    await world.listen(0);historyId=world.registry.historyId;
    // Unmodified fresh LIVE world: genuine door event -> local attention -> capture.
    world.registry.live.enqueue({type:'slam'});
    await waitFor(()=>requests(world.registry.live).some(r=>r.status==='completed'),()=>{});
    const cp=world.registry.live.simulation.checkpoint();if(cp.schemaVersion!==5)throw new Error('Cognition schema required');
    ids=cp.realExperiences.map(e=>e.encodingId);first=resultView(world.registry.live);diagnostic=await bundle(world.registry.live,join(directory,'temporary-live.zip'));
  }finally{await world.close();}
  const recovered=await RecoveryStore.open({directory:liveDirectory});
  const disabled=loadCognitionConfig({loadEnv:false,env:{}}),restored=createWorldServer({diagnosticsDirectory:liveDirectory,recoveryStore:recovered.store,checkpoint:recovered.checkpoint,automaticCaptures:false,cognition:{config:disabled}});
  try{
    await restored.listen(0);const cp=restored.registry.live.simulation.checkpoint();if(cp.schemaVersion!==5)throw new Error('Cognition schema required');
    const retained=cp.realExperiences.map(e=>e.encodingId),survived=ids.length>0&&ids.every(id=>retained.includes(id))&&restored.registry.historyId===historyId;
    return {case:'temporary-live',classification:'ACTUAL RENDERER AND REAL PROVIDER / TEMPORARY LIVE',requests:first,encodedCount:ids.length,restartWithCognitionDisabled:{survived,retainedCount:retained.length,sameHistory:restored.registry.historyId===historyId},bundle:diagnostic};
  }finally{await restored.close();}
}
async function mockCompanion(options:VerificationOptions,config:CognitionConfig,client:EvidenceClient){
  const data=join(options.out,'mock-data'),world=createWorldServer({diagnosticsDirectory:data,cognition:{config,providers:client,experimentsOnly:true}});
  try{
    const port=await world.listen(0),saved=await world.registry.checkpoint(world.registry.live.target),runtime=await world.registry.fork(world.registry.live.target,saved.id,'mock-observation');runtime.applyControl({type:'speed',speed:1});
    client.begin('MOCK-success');runtime.enqueue({type:'configure_scene',illumination:1,fixture:'visibility',fixtureColor:'#ed6050',doorOpenRadians:0});runtime.applyControl({type:'activity-start',totalTicks:3});
    await waitFor(()=>requests(runtime).some(r=>r.status==='completed'),()=>{});
    // Re-deliver the exact completed advisory result through the private ordered
    // gate. The bundle demonstrates duplicate rejection without a second effect.
    const first=requests(runtime)[0];if(first.result)runtime.enqueueCognitionResult(first.result);
    await waitFor(()=>runtime.simulation.checkpoint().pendingInputs.length===0,()=>{});
    runtime.applyControl({type:'pause'});
    // An independent fresh branch avoids turning normal capture backoff into a
    // fixture bypass merely to manufacture a second provider call.
    await delay(2100);
    const failureSaved=await world.registry.checkpoint(world.registry.live.target),refused=await world.registry.fork(world.registry.live.target,failureSaved.id,'mock-refused');refused.applyControl({type:'speed',speed:1});
    client.begin('MOCK-refused',true);refused.enqueue({type:'configure_scene',illumination:1,fixture:'visibility',fixtureColor:'#ed6050',doorOpenRadians:0});refused.applyControl({type:'activity-start',totalTicks:3});
    await waitFor(()=>requests(refused).some(r=>r.status==='completed'),()=>{});refused.applyControl({type:'pause'});
    const diagnostic=await bundle(runtime,join(options.out,'mock-observation.zip'));
    const failureBundle=await bundle(refused,join(options.out,'mock-refused.zip'));
    const summary={classification:'MOCK TEST PROVIDER / ACTUAL RENDERER / EXPERIMENT ONLY',actualProviderAcceptance:false,url:`http://127.0.0.1:${port}`,target:runtime.target,failureTarget:refused.target,requests:resultView(runtime),failureRequests:resultView(refused),bundle:diagnostic,failureBundle};
    await writeFile(join(options.out,'mock-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
    if(options.serveSeconds)await new Promise<void>(done=>{
      const stop=()=>{clearTimeout(timer);process.removeListener('SIGINT',stop);process.stdin.removeListener('data',input);process.stdin.pause();done();};
      const input=(value:Buffer|string)=>{if(String(value).trim()==='stop')stop();};
      const timer=setTimeout(stop,options.serveSeconds*1000);process.once('SIGINT',stop);process.stdin.on('data',input);process.stdin.resume();
    });
    return summary;
  }finally{await world.close();}
}
export async function runVerification(options:VerificationOptions,configured?:CognitionConfig){
  const config=options.mock?loadCognitionConfig({loadEnv:false,env:{LUMI_COGNITION_ENABLED:'true',OPENROUTER_API_KEY:'MOCK-NOT-A-CREDENTIAL',LUMI_COGNITION_MODEL:'MOCK/offline',LUMI_COGNITION_ROUTE_CONTEXT_TOKENS:'1000000',LUMI_COGNITION_MIN_REAL_INTERVAL_MS:'100',LUMI_COGNITION_MIN_WORLD_INTERVAL_SECONDS:'1'}}):configured??loadCognitionConfig();
  const preflight=verificationPreflight(options,config);await mkdir(options.out,{recursive:true});
  if(preflight.status==='unavailable'){await writeFile(join(options.out,'verification.json'),JSON.stringify(preflight,null,2));console.log(JSON.stringify(preflight));return preflight;}
  const evidence=join(options.out,'private-observations');await mkdir(evidence,{recursive:true});
  const actual=options.paid?new CognitionProviders(config,new DurableBudget(config.budget.directory,config.budget.ceilingUsd)):null,client=new EvidenceClient(config,evidence,actual);
  if(options.mock){const report=await mockCompanion(options,config,client);await writeFile(join(options.out,'input-evidence.json'),JSON.stringify(client.inputs,null,2));return report;}
  const cases:CaseAcceptanceEvidence[]=[];let failure:string|null=null;
  try{
    for(const name of ['visible','partial','dark','absent','hidden']){
      const result=await experimentCase(name,config,client,options.out,options.decisions&&name==='partial');cases.push(result);
      if(result.requests[0]?.status!=='success'){failure='Selected route did not return a usable interpretation; no fallback model was called';break;}
    }
    if(!failure)cases.push(await liveRecoveryCase(config,client,options.out));
  }catch(error){failure=error instanceof Error?error.message:'Bounded verification failed';}
  const report={...preflight,...verificationAcceptance(cases,failure),cases,inputs:client.inputs,failure,decisionsAdoption:'insufficient evidence to adopt; normal LIVE disabled',limitations:['Five controlled experiment frames plus one genuine temporary LIVE chain; qualitative model interpretations require human inspection.','Case labels and private evaluation coverage exist only in this report.','Reported uncertainty is a model estimate, not calibrated accuracy.','App-wide budget ledger is shared and is never reset by this harness.']};
  await writeFile(join(options.out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,actualProviderAcceptance:report.actualProviderAcceptance,out:options.out,failure}));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  void runVerification(verificationOptions(process.argv.slice(2))).then(report=>{if('status'in report&&report.status==='unavailable')process.exitCode=2;else if('status'in report&&['failed','incomplete'].includes(String(report.status)))process.exitCode=1;}).catch(error=>{console.error('Cognition verification failed: '+(error instanceof Error?error.message.slice(0,240):'local scenario failure'));process.exitCode=1;});
}
