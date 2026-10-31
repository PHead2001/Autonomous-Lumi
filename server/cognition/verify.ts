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

export interface VerificationOptions {social?:boolean;physiology?:boolean;paid:boolean;mock:boolean;decisions:boolean;serveSeconds:number;out:string}
export function verificationOptions(args:string[]):VerificationOptions {
  const result:VerificationOptions={paid:false,mock:false,decisions:false,serveSeconds:0,out:resolve('diagnostics','cognition-checks',new Date().toISOString().replace(/[^0-9]/g,''))};
  for(let i=0;i<args.length;i++){
    const arg=args[i];if(arg==='--paid')result.paid=true;else if(arg==='--mock')result.mock=true;else if(arg==='--decisions')result.decisions=true;
    else if(arg==='--social')result.social=true;
    else if(arg==='--physiology')result.physiology=true;
    else if(arg==='--out'&&args[i+1])result.out=resolve(args[++i]);
    else if(arg==='--serve'&&args[i+1]){result.serveSeconds=Number(args[++i]);if(!Number.isInteger(result.serveSeconds)||result.serveSeconds<1||result.serveSeconds>600)throw new Error('--serve requires 1 through 600 seconds');}
    else throw new Error('Use --paid or --mock, optional --decisions, --out <directory>, --serve <1..600 seconds>');
  }
  if(result.paid===result.mock||result.paid&&result.serveSeconds>0)throw new Error('Choose exactly one of --paid or --mock; --serve is for the MOCK companion');
  if(result.social&&(!result.paid||result.decisions||result.serveSeconds||result.physiology))throw new Error('--social requires --paid, no Decisions, no --physiology and no --serve');
  if(result.physiology&&(!result.paid||result.decisions||result.serveSeconds))throw new Error('--physiology requires --paid, no Decisions and no --serve');
  return result;
}
export function verificationPreflight(options:VerificationOptions,config:CognitionConfig){
  return {status:options.mock?'MOCK':config.main.available?'ready':'unavailable',actualProviderAcceptance:false,reason:options.mock?'MOCK provider; actual renderer only':config.main.available?'explicit paid opt-in; bounded six main requests':'Set LUMI_COGNITION_ENABLED=true and OPENROUTER_API_KEY locally; credentials alone do not enable calls',maximumMainCalls:options.mock?2:6,maximumDecisionsCalls:options.decisions?1:0,ceilingUsd:config.budget.ceilingUsd};
}
export interface CaseAcceptanceEvidence {case:string;failure?:string;requests?:{status?:string}[];bundle?:{evidence?:string;replay?:{status?:string}};restartWithCognitionDisabled?:{survived?:boolean}}
/** Image capability and end-to-end acceptance are separate evidence claims. A
 * persisted memory cannot compensate for an incomplete diagnostic/replay chain. */
export function verificationAcceptance(cases:readonly CaseAcceptanceEvidence[],failure:string|null){
  const required=VERIFICATION_CASES,gaps:string[]=[];
  const imageCases=required.slice(0,5).map(name=>cases.find(c=>c.case===name));
  const actualImageInterpretationEvidence=imageCases.every(c=>c?.requests?.[0]?.status==='success');
  for(const name of required){
    const c=cases.find(c=>c.case===name);
    if(!c){gaps.push(name+': missing scenario');continue;}
    if(c.failure)gaps.push(name+': '+c.failure);
    if(c.requests?.[0]?.status!=='success')gaps.push(name+': no successful interpretation');
    if(c.bundle?.evidence!=='COMPLETE'||c.bundle.replay?.status!=='PASS')gaps.push(name+': complete offline replay evidence unavailable');
  }
  const livePersistenceVerified=cases.find(c=>c.case==='temporary-live')?.restartWithCognitionDisabled?.survived===true;
  if(!livePersistenceVerified)gaps.push('temporary-live: admitted experience did not survive disabled-cognition restart');
  const actualProviderAcceptance=!failure&&gaps.length===0;
  return {status:failure?'failed':actualProviderAcceptance?'passed':'incomplete',actualProviderAcceptance,actualImageInterpretationEvidence,livePersistenceVerified,offlineReplayComplete:required.every(name=>{const c=cases.find(c=>c.case===name);return c?.bundle?.evidence==='COMPLETE'&&c.bundle.replay?.status==='PASS';}),evidenceGaps:gaps};
}
export const VERIFICATION_CASES=['visible','partial','dark','absent','hidden','temporary-live'] as const;
/** One attempt per case, including LIVE recovery even after earlier failures. No retries. */
export async function verificationCases(experiment:(name:string)=>Promise<CaseAcceptanceEvidence>,live:()=>Promise<CaseAcceptanceEvidence>){
  const cases:CaseAcceptanceEvidence[]=[];
  for(const name of VERIFICATION_CASES){
    try{cases.push(await (name==='temporary-live'?live():experiment(name)));}
    catch{cases.push({case:name,failure:'scenario_failed',requests:[]});}
  }
  const failed=cases.filter(c=>c.failure||c.requests?.[0]?.status!=='success').map(c=>c.case);
  return {cases,failure:failed.length?'Scenarios failed: '+failed.join(', '):null};
}
const empty=(model:string,status:ProviderResult['status']):ProviderResult=>({status,content:null,provider:'openrouter',model,modelRevision:null,latencyMs:0,attempts:0,inputTokens:null,outputTokens:null,costUsd:null,costBasis:'unknown',reservedUsd:0});
export function sanitizedProviderFailure(status:number,payload:unknown){
  const envelope=payload&&typeof payload==='object'?payload as Record<string,unknown>:null;
  const error=envelope?.error&&typeof envelope.error==='object'?envelope.error as Record<string,unknown>:null;
  const known=new Set(['authentication_error','invalid_api_key','invalid_request_error','permission_error','rate_limit_error','rate_limit_exceeded','insufficient_quota','insufficient_credits','model_not_found','not_found','unsupported_parameter','provider_error','route_error','server_error','timeout','overloaded_error','content_filter']);
  const safe=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=599?value:typeof value==='string'&&known.has(value)?value:null;
  const message=typeof error?.message==='string'?error.message.toLowerCase():'';
  const category=/no endpoints|no providers|support.*parameters|unsupported.*parameter/.test(message)?'no_compatible_endpoint':/not a valid model|model.*not found|unknown model/.test(message)?'invalid_model':/insufficient.*credit|credit.*insufficient/.test(message)?'insufficient_credits':/invalid.*api.key|invalid.*credential/.test(message)?'invalid_credential':status===429?'rate_limit':'provider_http_error';
  return {httpStatus:status,code:safe(error?.code),type:safe(error?.type),category};
}

/** Private evidence files contain bounded filtered DTOs and PNGs, never credentials,
 * raw full prompts or provider envelopes. Case labels never enter provider input. */
interface VerificationCaseWork {readonly name:string;readonly generation:number;readonly refusal:boolean;readonly deadline:number;readonly controller:AbortController;calls:number}
export interface VerificationPacing {now:()=>number;wait:(ms:number,signal:AbortSignal)=>Promise<void>}
const defaultPacing:VerificationPacing={now:()=>performance.now(),wait:async(ms,signal)=>{await delay(ms,undefined,{signal});}};
export class EvidenceClient implements CognitionProviderClient {
  readonly inputs:Record<string,unknown>[]=[];
  private mainCalls=0;private decisionsCalls=0;private generation=0;private currentCase:VerificationCaseWork|null=null;private lastCallMs=-Infinity;
  readonly budget:CognitionProviderClient['budget'];
  constructor(private readonly config:CognitionConfig,private readonly directory:string,private readonly actual:CognitionProviders|null,private readonly pacing:VerificationPacing=defaultPacing){this.budget=actual?.budget??{snapshot:async()=>({ceilingUsd:config.budget.ceilingUsd,accountedUsd:0,pending:0,unknown:0,reportedUsd:0,estimatedUsd:0})};}
  begin(name:string,refusal=false){this.endCase();const work:VerificationCaseWork={name,generation:++this.generation,refusal,deadline:this.pacing.now()+60000,controller:new AbortController(),calls:0};this.currentCase=work;return work;}
  endCase(work=this.currentCase){if(!work)return;work.controller.abort();if(this.currentCase===work)this.currentCase=null;}
  private active(work:VerificationCaseWork){return this.currentCase===work&&work.generation===this.generation&&!work.controller.signal.aborted;}
  private canDispatch(work:VerificationCaseWork){return this.active(work)&&this.pacing.now()+this.config.limits.deadlineMs<work.deadline&&this.pacing.now()-this.lastCallMs>=this.config.limits.minRealIntervalMs;}
  /** Pacing consumes the case's existing deadline. It never schedules beyond it. */
  async waitForCadence(work=this.currentCase):Promise<boolean>{
    if(!work||!this.active(work))return false;
    const remaining=work.deadline-this.pacing.now(),waitMs=Math.max(0,this.config.limits.minRealIntervalMs-(this.pacing.now()-this.lastCallMs));
    if(waitMs+this.config.limits.deadlineMs>=remaining)return false;
    try{if(waitMs>0)await this.pacing.wait(waitMs,work.controller.signal);}catch{return false;}
    return this.canDispatch(work);
  }
  status(){return {...(this.actual?.status()??{...safeCognitionConfig(this.config),pending:0,queued:0}),mode:this.actual?'REAL PROVIDER CONFIGURED':'MOCK TEST PROVIDER'};}
  async interpret(input:InterpretationInput):Promise<ProviderResult>{
    const work=this.currentCase;if(!work||!this.active(work))return empty(this.config.main.model,'unavailable');
    if(this.mainCalls>=(this.actual?6:2)||work.calls>=1)return empty(this.config.main.model,'budget_exhausted');
    this.mainCalls++;work.calls++;
    const image=Buffer.from(input.png),context=structuredClone(input.context),contextText=JSON.stringify(context),imageHash=createHash('sha256').update(image).digest('hex');
    await writeFile(join(this.directory,input.requestId+'.png'),image);
    // Dedicated context evidence is an allowlisted DTO, not the full request prompt.
    await writeFile(join(this.directory,input.requestId+'-context.json'),JSON.stringify(context,null,2));
    let result:ProviderResult;
    if(this.actual){if(!await this.waitForCadence(work)||!this.canDispatch(work))result=empty(this.config.main.model,this.active(work)?'timeout':'unavailable');else{this.lastCallMs=this.pacing.now();result=await this.actual.interpret({...input,context,png:image});}}
    else if(!this.active(work))result=empty(this.config.main.model,'unavailable');
    else if(work.refusal)result={...empty(this.config.main.model,'refused'),attempts:1,latencyMs:1};
    else result={...empty(this.config.main.model,'ok'),attempts:1,latencyMs:1,content:JSON.stringify({observationId:context.observationId,frameHash:context.frameHash,interpretation:'MOCK TEST PROVIDER: a fallible interpretation of the supplied visible image; this is offline fixture evidence.',uncertainty:.65,evidenceHandles:context.shapes.slice(0,1).map(s=>s.handle),action:{type:'continue'}})};
    const forbidden=new Set(['x','y','z','position','engineTargetId','sourceId','cause','case','label','tick','time','capturedTick','worldTimeSeconds','worldScope','historyId','worldId','branchId','runId']);
    const fields:string[]=[];const inspect=(value:unknown)=>{if(Array.isArray(value))for(const child of value)inspect(child);else if(value&&typeof value==='object')for(const [field,child]of Object.entries(value)){if(forbidden.has(field))fields.push(field);inspect(child);}};inspect(context);
    this.inputs.push({case:work.name,caseGeneration:work.generation,requestId:input.requestId,imageHash,contextHash:hashCanonical(context),imageBytes:image.length,contextBytes:Buffer.byteLength(contextText),dimensions:[image.readUInt32BE(16),image.readUInt32BE(20)],shapeCount:context.shapes.length,inputBoundaryInspection:{validator:'exact validateCognitionContext allowlist',forbiddenFieldCount:fields.length,forbiddenFields:fields},status:result.status,validationError:result.validationError??null,provider:this.actual?'openrouter':'MOCK TEST PROVIDER',model:result.model,latencyMs:result.latencyMs,inputTokens:result.inputTokens,outputTokens:result.outputTokens,costUsd:result.costUsd,costBasis:result.costBasis});
    return result;
  }
  async decide(input:DecisionInput){
    const work=this.currentCase;
    if(!this.actual||!work||!this.active(work)||this.decisionsCalls++>=1)return {...empty(this.config.decisions.model,'unavailable'),provider:'openai' as const,answer:null};
    const context=structuredClone(input.context),choices=structuredClone(input.choices);
    if(!await this.waitForCadence(work)||!this.canDispatch(work))return {...empty(this.config.decisions.model,this.active(work)?'timeout':'unavailable'),provider:'openai' as const,answer:null};
    this.lastCallMs=this.pacing.now();return this.actual.decide({...input,context,choices});
  }
}
function requests(runtime:BranchRuntime):CognitionRequestState[]{const cp=runtime.simulation.checkpoint();return (cp.schemaVersion===5||(cp.schemaVersion===6||(cp.schemaVersion===7||cp.schemaVersion===8||(cp.schemaVersion===9||(cp.schemaVersion===10||(cp.schemaVersion===11||cp.schemaVersion===12))))))?cp.cognition.requests:[];}
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
function resultView(runtime:BranchRuntime){return requests(runtime).map(r=>({requestId:r.request.requestId,purpose:r.request.purpose,promptRevision:r.request.promptRevision,captureId:r.request.selection.captureId,frameHash:r.request.selection.frameHash,capturedTick:r.request.selection.capturedTick,attentionTick:r.request.selection.attentionTick,requestedTick:r.requestedTick,receiptTick:r.resultTick,status:r.result?.outcome,validationError:r.result?.validationError??null,proposal:r.result?.proposal??null,interpretation:r.result?.proposal?.interpretation,uncertainty:r.result?.proposal?.uncertainty,action:r.action,encoding:r.encoding,metrics:r.result?.metrics}));}

async function experimentCase(name:string,config:CognitionConfig,client:EvidenceClient,directory:string,compareDecisions:boolean){
  const work=client.begin(name);
  try{
  const source=new BranchRuntime({worldId:'capability-check',branchId:name,historyId:'isolated-capability-history',mode:'EXPERIMENT',offline:true}),checkpoint=source.checkpoint();await source.close();
  const cp=checkpoint.simulation;if(cp.schemaVersion!==5&&(cp.schemaVersion!==6&&(cp.schemaVersion!==7&&cp.schemaVersion!==8&&(cp.schemaVersion!==9&&(cp.schemaVersion!==10&&(cp.schemaVersion!==11&&cp.schemaVersion!==12))))))throw new Error('Cognition schema required');
  const fixture=createVisibilityFixture();cp.character=fixture.character;cp.head=fixture.head!;cp.scene=fixture.scene!;cp.pauseUntilTick=100000;
  if(name==='partial'){cp.head.yaw=.25;cp.head.targetYaw=.25;}
  if(name==='dark')cp.scene.illumination=0;
  if(name==='absent')cp.scene.fixture='none';
  if(name==='hidden')cp.character.heading=Math.PI;
  const runtime=new BranchRuntime({worldId:'capability-check',branchId:name,historyId:'isolated-capability-history',mode:'EXPERIMENT',checkpoint,directory});await runtime.prepare();runtime.applyControl({type:'speed',speed:1});
  const renderer=new ChromiumRenderer(),manager=new CaptureManager(scope=>scope.runId===runtime.target.runId,renderer),host=new CognitionCoordinator(config,client,manager,()=>true,'isolated-capability-history'),automatic=new AutomaticCaptureCoordinator(manager,()=>true,undefined,(r,i)=>host.selectedCapture(r,i));
  let failure:string|undefined;let privateCoverage:unknown[]=[];let decisions:unknown={status:'not_requested',adoption:'insufficient evidence to adopt'};let diagnostic:Awaited<ReturnType<typeof bundle>>|undefined;
  try{
    privateCoverage=groundSnapshot(runtime.viewerState()).objects.map(o=>({measurementKey:o.id,status:o.status,eligible:o.eligible}));
    runtime.applyControl({type:'activity-start',totalTicks:3});
    await waitFor(()=>requests(runtime).some(r=>r.status==='completed'),()=>{runtime.pump();automatic.pump([runtime]);host.pump([runtime]);});

    if(compareDecisions){
      if(!config.decisions.available)decisions={status:'unavailable',adoption:'insufficient evidence to adopt; LIVE disabled'};
      else{
        const initial=requests(runtime)[0];
        await waitFor(()=>{const cp=runtime.simulation.checkpoint();return (cp.schemaVersion===5||(cp.schemaVersion===6||(cp.schemaVersion===7||cp.schemaVersion===8||(cp.schemaVersion===9||(cp.schemaVersion===10||(cp.schemaVersion===11||cp.schemaVersion===12))))))&&runtime.simulation.state.tick>=cp.cognition.nextRequestTick;},()=>runtime.pump(),10000);
        if(!await client.waitForCadence(work))throw new Error('Case pacing deadline');
        const admitted=host.requestDecisionEvaluation(runtime,initial.request.selection.captureId);
        if(admitted.queued){await waitFor(()=>requests(runtime).some(r=>r.request.requestId===admitted.requestId&&r.status==='completed'),()=>{runtime.pump();host.pump([runtime]);});decisions={status:'evaluated',localBaseline:'continue',fixedLegalChoices:['continue','request_observation'],comparison:resultView(runtime).find(r=>r.requestId===admitted.requestId),adoption:'one matched case is insufficient evidence to adopt; LIVE disabled'};}
        else decisions={status:admitted.reason,adoption:'insufficient evidence to adopt; LIVE disabled'};
      }
    }
  }catch{failure='scenario_failed';}
  finally{client.endCase(work);}
  try{diagnostic=await bundle(runtime,join(directory,name+'.zip'));}catch{failure??='bundle_failed';}
  automatic.close();host.close([runtime]);
  try{await manager.close();}catch{failure??='renderer_cleanup_failed';}
  try{await runtime.close();}catch{failure??='runtime_cleanup_failed';}
  const report={case:name,classification:'ACTUAL RENDERER / EXPERIMENT',privateEvaluationCoverage:privateCoverage,requests:resultView(runtime),decisions,bundle:diagnostic,...(failure?{failure}:{})};
  console.log(JSON.stringify({case:name,status:requests(runtime)[0]?.result?.outcome??'failed',actualRenderer:true,failure}));return report;
  }finally{client.endCase(work);}
}

async function liveRecoveryCase(config:CognitionConfig,client:EvidenceClient,directory:string){
  const work=client.begin('temporary-live');try{const liveDirectory=join(directory,'temporary-live');
  const selected=await RecoveryStore.open({directory:liveDirectory,newWorld:true});
  const world=createWorldServer({diagnosticsDirectory:liveDirectory,recoveryStore:selected.store,checkpoint:selected.checkpoint,cognition:{config,providers:client}});
  let first:ReturnType<typeof resultView>=[],ids:string[]=[],historyId='',diagnostic:Awaited<ReturnType<typeof bundle>>|undefined,failure:string|undefined;
  try{
    await world.listen(0);historyId=world.registry.historyId;
    // Unmodified fresh LIVE world: genuine door event -> local attention -> capture.
    world.registry.live.enqueue({type:'slam'});
    await waitFor(()=>requests(world.registry.live).some(r=>r.status==='completed'),()=>{});
    const cp=world.registry.live.simulation.checkpoint();if(cp.schemaVersion!==5&&(cp.schemaVersion!==6&&(cp.schemaVersion!==7&&cp.schemaVersion!==8&&(cp.schemaVersion!==9&&(cp.schemaVersion!==10&&(cp.schemaVersion!==11&&cp.schemaVersion!==12))))))throw new Error('Cognition schema required');
    ids=cp.realExperiences.map(e=>e.encodingId);first=resultView(world.registry.live);diagnostic=await bundle(world.registry.live,join(directory,'temporary-live.zip'));
  }catch{failure='scenario_failed';}
  finally{client.endCase(work);const cp=world.registry.live.simulation.checkpoint();if(cp.schemaVersion===5||cp.schemaVersion===6||(cp.schemaVersion===7||cp.schemaVersion===8||(cp.schemaVersion===9||(cp.schemaVersion===10||(cp.schemaVersion===11||cp.schemaVersion===12))))){ids=cp.realExperiences.map(e=>e.encodingId);first=resultView(world.registry.live);}try{await world.close();}catch{failure??='runtime_cleanup_failed';}}
  const recovered=await RecoveryStore.open({directory:liveDirectory});
  const disabled=loadCognitionConfig({loadEnv:false,env:{}}),restored=createWorldServer({diagnosticsDirectory:liveDirectory,recoveryStore:recovered.store,checkpoint:recovered.checkpoint,automaticCaptures:false,cognition:{config:disabled}});
  try{
    await restored.listen(0);const cp=restored.registry.live.simulation.checkpoint();if(cp.schemaVersion!==5&&(cp.schemaVersion!==6&&(cp.schemaVersion!==7&&cp.schemaVersion!==8&&(cp.schemaVersion!==9&&(cp.schemaVersion!==10&&(cp.schemaVersion!==11&&cp.schemaVersion!==12))))))throw new Error('Cognition schema required');
    const retained=cp.realExperiences.map(e=>e.encodingId),survived=ids.length>0&&ids.every(id=>retained.includes(id))&&restored.registry.historyId===historyId;
    return {case:'temporary-live',classification:'ACTUAL RENDERER AND REAL PROVIDER / TEMPORARY LIVE',...(failure?{failure}:{}),requests:first,encodedCount:ids.length,restartWithCognitionDisabled:{survived,retainedCount:retained.length,sameHistory:restored.registry.historyId===historyId},bundle:diagnostic};
  }finally{await restored.close();}
  }finally{client.endCase(work);}
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
  }finally{client.endCase();await world.close();}
}
/** One paid active-context check, on the unchanged application ledger. No retry,
 * Decisions request, owner recovery import or fixture body effect is allowed. */
export interface PhysiologyVerificationDependencies {
  createWorld?:typeof createWorldServer;
  createProvider?:(config:CognitionConfig,ledger:DurableBudget)=>CognitionProviders;
}
export async function runPhysiologyVerification(options:VerificationOptions,configured?:CognitionConfig,dependencies:PhysiologyVerificationDependencies={}){
  const original=configured??loadCognitionConfig(),config={...original,decisions:{...original.decisions,enabled:false,available:false}};
  await mkdir(options.out,{recursive:true});
  const preflight={kind:'physiology-single-provider-check',maximumMainCalls:1,maximumDecisionsCalls:0,profile:'lumi-vision-prompt-v5',classification:'DISPOSABLE LIVE / ACCEPTANCE-FAST GENESIS / ACTUAL RENDERER / REAL PROVIDER',ceilingUsd:config.budget.ceilingUsd};
  if(!config.main.available){const report={...preflight,status:'unavailable',actualProviderAcceptance:false,reason:'Existing main provider configuration unavailable; no settings changed'};await writeFile(join(options.out,'physiology-verification.json'),JSON.stringify(report,null,2));return report;}
  const evidence=join(options.out,'private-observations');await mkdir(evidence,{recursive:true});
  const ledger=new DurableBudget(config.budget.directory,config.budget.ceilingUsd),budgetBefore=await ledger.snapshot();
  const client=new EvidenceClient(config,evidence,dependencies.createProvider?.(config,ledger)??new CognitionProviders(config,ledger));const work=client.begin('physiology-single');let calls=0;
  const guarded:CognitionProviderClient={budget:client.budget,status:()=>client.status(),interpret:async input=>++calls===1?client.interpret(input):empty(config.main.model,'budget_exhausted')};
  const directory=join(options.out,'disposable-history'),opened=await RecoveryStore.open({directory,newWorld:true});
  const createWorld=dependencies.createWorld??createWorldServer;
  // Declared disposable genesis holds the starting position while sensing and the
  // independent head-milestone frame complete; no stale image is forced through.
  const genesis=new BranchRuntime({worldId:'lumi',branchId:'live',historyId:opened.store.historyId,mode:'LIVE',offline:true,physiology:{active:true,genesisPreset:'acceptance-fast-v1'}}),checkpoint=genesis.checkpoint();
  checkpoint.simulation.pauseUntilTick=checkpoint.simulation.tick+120*checkpoint.simulation.config.hz;checkpoint.simulation.character.moving=false;await genesis.close();
  const world=createWorld({checkpoint,diagnosticsDirectory:directory,recoveryStore:opened.store,physiology:{active:true},cognition:{config,providers:guarded}});
  let failure:string|null=null,diagnostic:Awaited<ReturnType<typeof bundle>>|null=null,requestRecords:ReturnType<typeof resultView>=[],internalCount=0;
  let sentContext:InterpretationInput['context']|null=null;
  const failures:string[]=[];const failed=(category:string)=>{failure??=category;if(!failures.includes(category))failures.push(category);};
  const cleanup:{runtime:'pending'|'closed'|'failed';restartRuntime:'unavailable'|'closed'|'failed'}={runtime:'pending',restartRuntime:'unavailable'};
  try{
    await world.listen(0);
    const initial=world.registry.live.simulation.checkpoint();if(initial.schemaVersion!==6&&initial.schemaVersion!==7&&initial.schemaVersion!==8&&(initial.schemaVersion!==9&&(initial.schemaVersion!==10&&(initial.schemaVersion!==11&&initial.schemaVersion!==12))))throw new Error('Physiology schema required');
    // The local awareness contract allows the configured urgent interval; ordinary
    // stochastic samples need not attend on their first opportunity.
    const awarenessWaitMs=Math.ceil((initial.body.config.urgentAttentionSeconds+6)*1000);
    await waitFor(()=>{const cp=world.registry.live.simulation.checkpoint();return (cp.schemaVersion===6||(cp.schemaVersion===7||cp.schemaVersion===8||(cp.schemaVersion===9||(cp.schemaVersion===10||(cp.schemaVersion===11||cp.schemaVersion===12)))))&&cp.interoception.transient.some(s=>s.percept.kind==='hunger'&&s.percept.band==='severe');},()=>{},awarenessWaitMs);
    // An ordinary accepted head turn produces a real milestone/capture intent.
    // The internal sensor independently attends; no body event forces a camera.
    world.registry.live.enqueue({type:'turn_head',yawDelta:.15,pitchDelta:0,sceneRevision:world.registry.live.viewerState().scene!.revision});
    await waitFor(()=>requests(world.registry.live).some(r=>r.status==='completed'),()=>{});
    const cp=world.registry.live.simulation.checkpoint();if((cp.schemaVersion!==6&&(cp.schemaVersion!==7&&cp.schemaVersion!==8&&(cp.schemaVersion!==9&&(cp.schemaVersion!==10&&(cp.schemaVersion!==11&&cp.schemaVersion!==12))))))throw new Error('Physiology checkpoint required');
    requestRecords=resultView(world.registry.live);internalCount=cp.internalExperiences.length;
    sentContext=cp.cognition.requests[0]?.request.selection.context??null;
    if(requestRecords[0]?.status!=='success')failed('provider_'+(requestRecords[0]?.status??'missing_result'));
  }catch{failed('local_scenario_failed');}
  finally{
    client.endCase(work);
    // Preserve any completed response even when a later scenario/cleanup step fails.
    try{const cp=world.registry.live.simulation.checkpoint();requestRecords=resultView(world.registry.live);if((cp.schemaVersion===6||(cp.schemaVersion===7||cp.schemaVersion===8||(cp.schemaVersion===9||(cp.schemaVersion===10||(cp.schemaVersion===11||cp.schemaVersion===12)))))){internalCount=cp.internalExperiences.length;sentContext=cp.cognition.requests[0]?.request.selection.context??null;}}catch{failed('runtime_evidence_unavailable');}
    try{world.cognition.close(world.registry.branches.values());}catch{failed('runtime_cleanup_failed');}
    try{await world.close();cleanup.runtime='closed';}catch{cleanup.runtime='failed';failed('runtime_cleanup_failed');}
  }
  try{const out=join(options.out,'physiology-provider.zip'),runtime=world.registry.live;let snapshot;if(cleanup.runtime==='failed'){runtime.capture();try{snapshot=await runtime.recorder!.snapshotForExport();}catch(error){if(!(error instanceof Error&&error.message==='Closed recorder exports must use its durable run'))failed('diagnostic_snapshot_failed');/* A failed close may already have sealed its durable recorder. */}}const exported=await exportIncident({runDirectory:runtime.recorder!.runDirectory,out,snapshot,expectedWorldId:runtime.target.worldId,expectedBranchId:runtime.target.branchId,expectedRunId:runtime.target.runId});diagnostic={path:out,evidence:exported.manifest.evidence_status,replay:exported.manifest.evidence_status==='COMPLETE'?await replayBundle(out):{status:'INCOMPLETE'},hashes:exported.manifest.hashes};}catch{failed('diagnostic_export_failed');}
  let survived=false,restored:ReturnType<typeof createWorldServer>|undefined;
  try{
    const recovered=await RecoveryStore.open({directory}),disabled=loadCognitionConfig({loadEnv:false,env:{}});
    restored=createWorld({diagnosticsDirectory:directory,recoveryStore:recovered.store,checkpoint:recovered.checkpoint,automaticCaptures:false,autoSchedule:false,cognition:{config:disabled}});
    await restored.listen(0);const cp=restored.registry.live.simulation.checkpoint();survived=(cp.schemaVersion===6||(cp.schemaVersion===7||cp.schemaVersion===8||(cp.schemaVersion===9||(cp.schemaVersion===10||(cp.schemaVersion===11||cp.schemaVersion===12)))))&&cp.body.active&&cp.internalExperiences.length===internalCount&&internalCount>0;
  }catch{failed('restart_verification_failed');}
  finally{if(restored)try{await restored.close();cleanup.restartRuntime='closed';}catch{cleanup.restartRuntime='failed';failed('runtime_cleanup_failed');}}
  const numericPrivateFields=['satiety','reserves','sleepPressure','condition','fatigue','activationTick','genesisPreset','crossingTick','eligibleTicks','attentionId','provenance'];
  const sensations=sentContext?.internalSensations??[],privateLeak=numericPrivateFields.some(field=>JSON.stringify(sentContext).includes('"'+field+'"'));
  const contextValid=sensations.some(s=>s.kind==='hunger'&&s.band==='severe')&&!privateLeak;
  const actualProviderAcceptance=!failure&&calls===1&&contextValid&&survived&&diagnostic?.evidence==='COMPLETE'&&diagnostic.replay.status==='PASS';
  let budgetAfter:Awaited<ReturnType<DurableBudget['snapshot']>>|null=null;try{budgetAfter=await ledger.snapshot();}catch{failed('budget_snapshot_failed');}
  const report={...preflight,status:!failure&&actualProviderAcceptance?'passed':failure?'failed':'incomplete',actualProviderAcceptance:!failure&&actualProviderAcceptance,failure,failures,cleanup,mainCalls:calls,decisionsCalls:0,sentInternalSensations:sensations,privateFieldLeak:privateLeak,requests:requestRecords,internalEncodedCount:internalCount,internalExperienceSurvivedRestart:survived,bundle:diagnostic,inputs:client.inputs,budgetBefore,budgetAfter,limitations:['Single active-profile integration, not a visual perception benchmark.','Acceptance-fast genesis is a labelled disposable calibration fixture.','No food acquisition, sustainable daily routine or prolonged uptime is asserted.']};
  await writeFile(join(options.out,'input-evidence.json'),JSON.stringify(client.inputs,null,2));
  await writeFile(join(options.out,'physiology-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,actualProviderAcceptance:report.actualProviderAcceptance,out:options.out,failure}));return report;
}
export async function runVerification(options:VerificationOptions,configured?:CognitionConfig){
  if(options.social){const {runSocialProviderVerification}=await import('./social-verify.js');return runSocialProviderVerification(options,configured);}
  if(options.physiology)return runPhysiologyVerification(options,configured);
  const config=options.mock?loadCognitionConfig({loadEnv:false,env:{LUMI_COGNITION_ENABLED:'true',OPENROUTER_API_KEY:'MOCK-NOT-A-CREDENTIAL',LUMI_COGNITION_MODEL:'MOCK/offline',LUMI_COGNITION_ROUTE_CONTEXT_TOKENS:'1000000',LUMI_COGNITION_MIN_REAL_INTERVAL_MS:'100',LUMI_COGNITION_MIN_WORLD_INTERVAL_SECONDS:'1'}}):configured??loadCognitionConfig();
  const preflight=verificationPreflight(options,config);await mkdir(options.out,{recursive:true});
  if(preflight.status==='unavailable'){await writeFile(join(options.out,'verification.json'),JSON.stringify(preflight,null,2));console.log(JSON.stringify(preflight));return preflight;}
  const evidence=join(options.out,'private-observations');await mkdir(evidence,{recursive:true});
  const httpEvidence:Record<string,unknown>[]=[];
  const ledger=options.paid?new DurableBudget(config.budget.directory,config.budget.ceilingUsd):null;
  const budgetBefore=ledger?await ledger.snapshot():null;
  const actual=options.paid?new CognitionProviders(config,ledger!,async(url,init)=>{
    const started=performance.now();
    try{
      const response=await fetch(url,init);let failure:ReturnType<typeof sanitizedProviderFailure>|null=null;
      if(!response.ok){
        // The adapter discards HTTP failure bodies. Read at most 4 KiB directly
        // under its existing abort deadline; no cloned/tee stream can buffer an
        // unconsumed original. Successful response consumption stays unchanged.
        const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
        try{if(reader)while(size<4096){const part=await reader.read();if(part.done)break;const bounded=part.value.subarray(0,4096-size);chunks.push(bounded);size+=bounded.length;}let payload:unknown=null;try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{/* Bounded or non-JSON error body intentionally omitted. */}failure=sanitizedProviderFailure(response.status,payload);}
        finally{await reader?.cancel().catch(()=>{});}
      }
      httpEvidence.push({endpoint:url,httpStatus:response.status,latencyMs:performance.now()-started,failure});await writeFile(join(options.out,'http-evidence.json'),JSON.stringify(httpEvidence,null,2));return response.ok?response:new Response(null,{status:response.status,statusText:response.statusText});
    }catch(error){httpEvidence.push({endpoint:url,httpStatus:null,latencyMs:performance.now()-started,category:error instanceof Error&&error.name==='AbortError'?'aborted':'transport_error'});await writeFile(join(options.out,'http-evidence.json'),JSON.stringify(httpEvidence,null,2));throw error;}
  }):null,client=new EvidenceClient(config,evidence,actual);
  if(options.mock){const report=await mockCompanion(options,config,client);await writeFile(join(options.out,'input-evidence.json'),JSON.stringify(client.inputs,null,2));return report;}
  const {cases,failure}=await verificationCases(name=>experimentCase(name,config,client,options.out,options.decisions&&name==='partial'),()=>liveRecoveryCase(config,client,options.out));
  const report={...preflight,...verificationAcceptance(cases,failure),cases,inputs:client.inputs,httpEvidence,budgetBefore,budgetAfter:ledger?await ledger.snapshot():null,failure,decisionsAdoption:'insufficient evidence to adopt; normal LIVE disabled',limitations:['Five controlled experiment frames plus one genuine temporary LIVE chain; qualitative model interpretations require human inspection.','Case labels and private evaluation coverage exist only in this report.','Reported uncertainty is a model estimate, not calibrated accuracy.','App-wide budget ledger is shared and is never reset by this harness.']};
  await writeFile(join(options.out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,actualProviderAcceptance:report.actualProviderAcceptance,out:options.out,failure}));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  void runVerification(verificationOptions(process.argv.slice(2))).then(report=>{if('status'in report&&report.status==='unavailable')process.exitCode=2;else if('status'in report&&['failed','incomplete'].includes(String(report.status)))process.exitCode=1;}).catch(error=>{console.error('Cognition verification failed: '+(error instanceof Error?error.message.slice(0,240):'local scenario failure'));process.exitCode=1;});
}
