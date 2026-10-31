import { randomUUID } from 'node:crypto';
import type { BranchRuntime } from '../branch-runtime.js';
import type { CheckpointV5, CheckpointV6, CheckpointV7, CheckpointV8, CheckpointV9 } from '../simulation.js';
import { hashCanonical } from '../canonical.js';
import type { CaptureManager } from '../vision/capture-manager.js';
import type { ActiveTarget } from '../../shared/lab-protocol.js';
import type { CaptureIntent } from '../../shared/attention-protocol.js';
import { COGNITION_SCHEMA_REVISION, DECISIONS_PROMPT_REVISION, PHYSIOLOGY_PROMPT_REVISION, PHYSIOLOGY_DECISIONS_PROMPT_REVISION, currentCognitionProfile, parseCognitionProposal, cognitionValidationError, validateCognitionProposalReferences, type CognitionFailure, type CognitionMetrics, type CognitionRequestCommand, type CognitionResultCommand } from '../../shared/cognition-protocol.js';
import { assembleCognitionObservation, type ImmutableCognitionObservation } from './observation.js';
import { COGNITION_PROMPT_REVISION, type CognitionProviders, type ProviderResult } from './providers.js';
import { safeCognitionConfig, type CognitionConfig } from './config.js';

const key=(scope:ActiveTarget)=>`${scope.worldId}/${scope.branchId}/${scope.runId}`;
const selectedReasons=['salient_sound','head_milestone','visible_change','activity_outcome'];
const interruptedMetrics: CognitionMetrics={latencyMs:0,attempts:0,inputTokens:null,outputTokens:null,costUsd:null,costBasis:'unknown',modelRevision:null};
type Prepared={runtime:BranchRuntime;request:CognitionRequestCommand;observation:ImmutableCognitionObservation;dispatched:boolean;terminal?:CognitionResultCommand};
export interface CognitionProviderClient {interpret:CognitionProviders['interpret'];decide?:CognitionProviders['decide'];status:CognitionProviders['status'];budget:Pick<CognitionProviders['budget'],'snapshot'>}

/** Host work owns pixels and promises; only private ordered commands can affect
 * simulation. Restored pending requests are interrupted once, never resent. */
export class CognitionCoordinator {
  private readonly work=new Map<string,Prepared>();
  private readonly seen=new Map<string,string>();
  private readonly reconciled=new Map<string,string>();
  private readonly lastWorld=new Map<string,number>();
  private lastRealMs=-Infinity;
  private closed=false;
  private lastFailure:string|null=null;
  constructor(readonly config:CognitionConfig,private readonly providers:CognitionProviderClient,private readonly manager:CaptureManager,private readonly current:(scope:ActiveTarget)=>boolean,private readonly historyId:string,private readonly monotonicMs:()=>number=()=>performance.now(),private readonly permittedRuntime:(runtime:BranchRuntime)=>boolean=()=>true) {}
  private eligible(runtime:BranchRuntime,intent:Pick<CaptureIntent,'reasons'|'createdTick'>):boolean {
    const cp=runtime.simulation.checkpoint();
    return (cp.schemaVersion===5||(cp.schemaVersion===6||(cp.schemaVersion===7||cp.schemaVersion===8||cp.schemaVersion===9)))&&(intent.reasons.some(reason=>selectedReasons.includes(reason))||intent.reasons.includes('uncertainty_probe')&&cp.cognition.observationRequestedTick!==null&&intent.createdTick>=cp.cognition.observationRequestedTick);
  }
  private lastMainRequestWorld(runtime:BranchRuntime,checkpoint:CheckpointV5|CheckpointV6|CheckpointV7|CheckpointV8|CheckpointV9):number {
    const recorded=checkpoint.cognition.requests.reduce((latest,state)=>state.request.purpose==='interpretation'?Math.max(latest,state.requestedTick/checkpoint.config.hz):latest,-Infinity);
    return Math.max(recorded,this.lastWorld.get(key(runtime.target))??-Infinity);
  }
  selectedCapture(runtime:BranchRuntime,intent:CaptureIntent):boolean {
    if(this.closed||runtime.viewerState().capability?.canAttend===false||!runtime.recorder||!this.permittedRuntime(runtime)||!this.config.main.available||!this.current(runtime.target)||!this.eligible(runtime,intent))return false;
    const cp=runtime.simulation.checkpoint(),now=this.monotonicMs();
    return (cp.schemaVersion===5||(cp.schemaVersion===6||(cp.schemaVersion===7||cp.schemaVersion===8||cp.schemaVersion===9)))&&runtime.simulation.state.tick>=cp.cognition.nextRequestTick&&this.work.size<this.config.limits.maxConcurrent+this.config.limits.maxQueued&&now-this.lastRealMs>=this.config.limits.minRealIntervalMs&&runtime.simulation.state.time-this.lastMainRequestWorld(runtime,cp)>=this.config.limits.minWorldIntervalSeconds;
  }
  private submit(runtime:BranchRuntime,result:CognitionResultCommand):boolean {
    if(!this.current(runtime.target))return false;
    try{return runtime.enqueueCognitionResult(result).input.admission==='queued';}
    catch{this.lastFailure='ordered_result_admission_failed';return false;}
  }
  pump(all:Iterable<BranchRuntime>):void {
    if(this.closed)return;
    for(const runtime of all){
      if(!runtime.recorder||!this.permittedRuntime(runtime)||!this.current(runtime.target))continue;
      const cp=runtime.simulation.checkpoint();if((cp.schemaVersion!==5&&(cp.schemaVersion!==6&&(cp.schemaVersion!==7&&cp.schemaVersion!==8&&cp.schemaVersion!==9))))continue;
      const scope=key(runtime.target);
      for(const state of cp.cognition.requests){
        if(state.status!=='pending'||this.work.has(state.request.requestId)||this.reconciled.has(state.request.requestId)||cp.pendingInputs.some(input=>input.command.type==='cognition_result'&&input.command.requestId===state.request.requestId))continue;
        if(cp.pendingInputs.length>=cp.config.maxPendingInputs)continue;
        if(this.submit(runtime,{type:'cognition_result',requestId:state.request.requestId,identity:state.request.selection.identity,outcome:'interrupted',proposal:null,metrics:interruptedMetrics}))this.reconciled.set(state.request.requestId,scope);
      }
      for(const prepared of this.work.values()){
        if(prepared.runtime!==runtime)continue;
        const state=cp.cognition.requests.find(state=>state.request.requestId===prepared.request.requestId);
        if(prepared.terminal&&state?.status==='pending'){
          if(cp.pendingInputs.length<cp.config.maxPendingInputs&&this.submit(runtime,prepared.terminal))this.work.delete(prepared.request.requestId);
        }else if(state?.status==='pending'&&!prepared.dispatched){
          prepared.dispatched=true;void this.dispatch(prepared);
        }else if(state?.status==='completed'||!state&&!cp.pendingInputs.some(input=>input.command.type==='cognition_request'&&input.command.requestId===prepared.request.requestId))this.work.delete(prepared.request.requestId);
      }
      const availability=runtime.captureAvailability();
      if(!this.config.main.available||runtime.viewerState().capability?.canAttend===false||availability.paused||availability.fastForwardRemaining||this.work.size>=this.config.limits.maxConcurrent+this.config.limits.maxQueued)continue;
      const capture=cp.attention.lastCapture;
      if(!capture?.captureId||capture.outcome!=='success'||capture.freshness!=='applicable'||this.seen.get(scope)===capture.captureId||cp.cognition.requests.some(state=>state.request.selection.captureId===capture.captureId)||!this.eligible(runtime,{reasons:capture.reasons,createdTick:capture.capturedTick}))continue;
      // Visible change is discovered by the inexpensive probe. Its explicit
      // ordered upgrade intent obtains a new selected 512 frame, rather than
      // treating the signature or a later arbitrary frame as the observation.
      if(capture.reasons.includes('visible_change')){
        try{
          const retained=this.manager.observation(runtime.target,capture.captureId);
          if(retained.metadata.width===256&&retained.metadata.height===256){
            if(cp.cognition.captureUpgrade?.captureId!==capture.captureId&&!cp.pendingInputs.some(i=>i.command.type==='cognition_observation_request'&&i.command.captureId===capture.captureId)&&cp.pendingInputs.length<cp.config.maxPendingInputs){
              runtime.enqueueCognitionObservationRequest({type:'cognition_observation_request',requestId:randomUUID(),identity:{...runtime.target,historyId:runtime.summary().historyId??this.historyId,mode:runtime.mode},captureId:capture.captureId,frameHash:retained.observation.frameHash,intentId:capture.intentId});
            }
            continue;
          }
        }catch{this.lastFailure='selected_observation_unavailable';this.seen.set(scope,capture.captureId);continue;}
      }
      const now=this.monotonicMs();
      if(runtime.simulation.state.tick<cp.cognition.nextRequestTick||now-this.lastRealMs<this.config.limits.minRealIntervalMs||runtime.simulation.state.time-this.lastMainRequestWorld(runtime,cp)<this.config.limits.minWorldIntervalSeconds)continue;
      this.seen.set(scope,capture.captureId);
      try{
        const identity={...runtime.target,historyId:runtime.summary().historyId??this.historyId,mode:runtime.mode};
        const observation=assembleCognitionObservation(runtime,this.manager,capture.captureId,identity,this.config.limits.maxImageBytes,this.config.limits.maxContextBytes);
        const request:CognitionRequestCommand={type:'cognition_request',requestId:randomUUID(),purpose:'interpretation',selection:observation.selection,provider:'openrouter',model:this.config.main.model,promptRevision:observation.selection.context.internalSensations!==undefined?PHYSIOLOGY_PROMPT_REVISION:COGNITION_PROMPT_REVISION,schemaRevision:COGNITION_SCHEMA_REVISION};
        const accepted=runtime.enqueueCognitionRequest(request,observation.evidence);
        if(accepted.input.admission==='queued'){
          this.work.set(request.requestId,{runtime,request,observation,dispatched:false});this.lastRealMs=now;this.lastWorld.set(scope,runtime.simulation.state.time);
        }else this.lastFailure='ordered_request_queue_full';
      }catch{this.lastFailure='selected_observation_unavailable';}
    }
  }
  /** Explicit isolated comparison only; never called by the LIVE pump. Fixed
   * legal choices use the same immutable evidence and ordered action gate. */
  requestDecisionEvaluation(runtime:BranchRuntime,captureId:string):{queued:boolean;reason:string;requestId?:string} {
    if(this.closed||runtime.viewerState().capability?.canAttend===false||runtime.mode!=='EXPERIMENT'||!runtime.recorder||!this.current(runtime.target)||!this.config.decisions.available||!this.providers.decide)return {queued:false,reason:'decisions_unavailable_or_live'};
    const cp=runtime.simulation.checkpoint();
    if((cp.schemaVersion!==5&&(cp.schemaVersion!==6&&(cp.schemaVersion!==7&&cp.schemaVersion!==8&&cp.schemaVersion!==9)))||runtime.simulation.state.tick<cp.cognition.nextRequestTick||this.monotonicMs()-this.lastRealMs<this.config.limits.minRealIntervalMs||this.work.size>=this.config.limits.maxConcurrent+this.config.limits.maxQueued)return {queued:false,reason:'comparison_cooldown_or_capacity'};
    try {
      const observation=assembleCognitionObservation(runtime,this.manager,captureId,{...runtime.target,historyId:runtime.summary().historyId??this.historyId,mode:runtime.mode},this.config.limits.maxImageBytes,this.config.limits.maxContextBytes);
      if(observation.selection.context.shapes.length<2&&!observation.selection.context.shapes.some(s=>s.sampleVisibilityBand==='low'))return {queued:false,reason:'local_policy_not_ambiguous'};
      const request:CognitionRequestCommand={type:'cognition_request',requestId:randomUUID(),purpose:'decisions_evaluation',selection:observation.selection,provider:'openai',model:this.config.decisions.model,promptRevision:observation.selection.context.internalSensations!==undefined?PHYSIOLOGY_DECISIONS_PROMPT_REVISION:DECISIONS_PROMPT_REVISION,schemaRevision:COGNITION_SCHEMA_REVISION};
      if(runtime.enqueueCognitionRequest(request,observation.evidence).input.admission!=='queued')return {queued:false,reason:'ordered_request_queue_full'};
      this.work.set(request.requestId,{runtime,request,observation,dispatched:false});this.lastRealMs=this.monotonicMs();return {queued:true,reason:'experiment_comparison',requestId:request.requestId};
    }catch{return {queued:false,reason:'selected_observation_unavailable'};}
  }
  private async dispatch(prepared:Prepared):Promise<void> {
    const {runtime,request,observation}=prepared;
    let result:ProviderResult;
    try{
      if(request.purpose==='decisions_evaluation'&&this.providers.decide){
        const decision=await this.providers.decide({requestId:request.requestId,worldTimeSeconds:runtime.simulation.state.time,worldScope:hashCanonical(runtime.target),context:observation.selection.context,choices:[{value:'continue',description:'Keep the current local activity and attention policy.'},{value:'request_observation',description:'Request one fresh bounded observation through the normal sensor pipeline.'}]});
        result={...decision,content:decision.status==='ok'&&decision.answer?JSON.stringify({observationId:request.selection.observationId,frameHash:request.selection.frameHash,interpretation:'Experimental attention comparison; this is advice rather than personal experience.',uncertainty:1-decision.answer.confidence,evidenceHandles:[],action:{type:decision.answer.confidence>=.65&&decision.answer.choice==='request_observation'?'request_observation':'continue'}}):null};
      }else result=await this.providers.interpret({requestId:request.requestId,worldTimeSeconds:runtime.simulation.state.time,worldScope:hashCanonical(runtime.target),context:observation.selection.context,png:observation.png});
    }
    catch{result={status:'failed',content:null,provider:'openrouter',model:request.model,...interruptedMetrics,reservedUsd:0};}
    if(this.closed||!this.current(runtime.target)){this.work.delete(request.requestId);return;}
    const metrics:CognitionMetrics={latencyMs:result.latencyMs,attempts:result.attempts,inputTokens:result.inputTokens,outputTokens:result.outputTokens,costUsd:result.costUsd,costBasis:result.costBasis,modelRevision:result.modelRevision};
    let validationError=result.validationError;
    let proposal=null,outcome:CognitionResultCommand['outcome']=result.status==='ok'?'success':(['unavailable','rate_limit','budget_exhausted','timeout','refused','malformed'].includes(result.status)?result.status as CognitionFailure:'failed');
    if(outcome==='success')try{proposal=parseCognitionProposal(result.content);validateCognitionProposalReferences(proposal,request.selection.context);}catch(error){outcome='malformed';proposal=null;validationError=cognitionValidationError(error);}
    prepared.terminal={type:'cognition_result',requestId:request.requestId,identity:request.selection.identity,outcome,proposal,metrics,...(outcome==='malformed'&&validationError?{validationError}:{})};
    if(runtime.simulation.checkpoint().pendingInputs.length<runtime.simulation.checkpoint().config.maxPendingInputs&&this.submit(runtime,prepared.terminal))this.work.delete(request.requestId);
    if(outcome!=='success')this.lastFailure=validationError??outcome;
  }
  async summary(runtime:BranchRuntime){
    const cp=runtime.simulation.checkpoint(),state=(cp.schemaVersion===5||(cp.schemaVersion===6||(cp.schemaVersion===7||cp.schemaVersion===8||cp.schemaVersion===9)))?cp.cognition:null;
    const responses=state?.requests.filter(r=>r.result?.outcome==='success'&&r.request.purpose==='interpretation')??[];
    const first=responses.length?Math.min(...responses.map(r=>r.requestedTick)):null,last=responses.length?Math.max(...responses.map(r=>r.resultTick!)):null;
    let budget:unknown=null;
    if(this.config.main.enabled||this.config.decisions.enabled)try{budget=await this.providers.budget.snapshot();}catch{budget={status:'unavailable'};}
    return {...runtime.target,configuration:safeCognitionConfig(this.config),providers:{...this.providers.status(),contextProfile:(cp.schemaVersion===6||(cp.schemaVersion===7||cp.schemaVersion===8||cp.schemaVersion===9))&&cp.body.active?'pixel_internal_v5':'pixel_checked_v4',promptRevision:(cp.schemaVersion===6||(cp.schemaVersion===7||cp.schemaVersion===8||cp.schemaVersion===9))&&cp.body.active?PHYSIOLOGY_PROMPT_REVISION:COGNITION_PROMPT_REVISION},budget,lastFailure:this.lastFailure,decisions:{status:this.config.decisions.enabled?'experiment_evaluation_only':'disabled',liveEnabled:false},pending:state?.requests.filter(r=>r.status==='pending').length??0,worldSecondsPerModelResponse:first!==null&&last!==null?(last-first)/cp.config.hz/responses.length:null,metricDefinition:'world seconds from first included main interpretation request to latest successful main response, divided by successful main responses; N/A without a successful response',requests:state?.requests.slice(-16).map(s=>({requestId:s.request.requestId,context:currentCognitionProfile(s.request)?structuredClone(s.request.selection.context):null,contextProfile:currentCognitionProfile(s.request)?(s.request.promptRevision===PHYSIOLOGY_PROMPT_REVISION?'pixel_internal_v5':s.request.promptRevision===COGNITION_PROMPT_REVISION?'pixel_checked_v4':'pixel_checked_v3'):'legacy_geometry_context_retained_not_sent',promptRevision:s.request.promptRevision,purpose:s.request.purpose,captureId:s.request.selection.captureId,observationId:s.request.selection.observationId,frameHash:s.request.selection.frameHash,capturedTick:s.request.selection.capturedTick,attentionTick:s.request.selection.attentionTick,requestedTick:s.requestedTick,provider:s.request.provider,model:s.request.model,status:s.status,resultTick:s.resultTick,outcome:s.result?.outcome??null,validationError:s.result?.validationError??null,proposal:s.result?.proposal??null,interpretation:s.result?.proposal?.interpretation??null,uncertainty:s.result?.proposal?.uncertainty??null,proposedAction:s.result?.proposal?.action??null,action:s.action,encoding:s.encoding,metrics:s.result?.metrics??null}))??[],realExperiences:(cp.schemaVersion===5||(cp.schemaVersion===6||(cp.schemaVersion===7||cp.schemaVersion===8||cp.schemaVersion===9)))?cp.realExperiences.slice(-32).map(e=>({id:e.id,encodingId:e.encodingId,requestId:e.requestId,observationId:e.observationId,frameHash:e.frameHash,capturedTick:e.capturedTick,attentionTick:e.attentionTick,interpretationTick:e.interpretationTick,encodedTick:e.encodedTick,interpretation:e.interpretation,uncertainty:e.uncertainty,mode:e.identity.mode,actionOutcome:e.actionOutcome})):[]};
  }
  retire(scope:ActiveTarget):void{for(const [id,prepared]of this.work)if(key(prepared.runtime.target)===key(scope))this.work.delete(id);for(const [id,owner]of this.reconciled)if(owner===key(scope))this.reconciled.delete(id);this.seen.delete(key(scope));this.lastWorld.delete(key(scope));}
  close(all:Iterable<BranchRuntime>):void {
    if(this.closed)return;
    for(const runtime of all){const cp=runtime.simulation.checkpoint();if((cp.schemaVersion!==5&&(cp.schemaVersion!==6&&(cp.schemaVersion!==7&&cp.schemaVersion!==8&&cp.schemaVersion!==9))))continue;for(const state of cp.cognition.requests)if(state.status==='pending'&&!cp.pendingInputs.some(i=>i.command.type==='cognition_result'&&i.command.requestId===state.request.requestId))this.submit(runtime,{type:'cognition_result',requestId:state.request.requestId,identity:state.request.selection.identity,outcome:'interrupted',proposal:null,metrics:interruptedMetrics});}
    this.closed=true;this.work.clear();this.seen.clear();this.reconciled.clear();this.lastWorld.clear();
  }
}
