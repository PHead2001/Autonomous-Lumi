import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runSocialLab } from '../social-lab.js';
import { assembleCognitionObservation } from './observation.js';
import { loadCognitionConfig, type CognitionConfig } from './config.js';
import { DurableBudget } from './budget.js';
import { CognitionProviders } from './providers.js';
import { SOCIAL_PROMPT_REVISION, COGNITION_SCHEMA_REVISION, parseCognitionProposal, type CognitionFailure, type CognitionResultCommand } from '../../shared/cognition-protocol.js';

/** Explicit root-run acceptance mode. Reuses the existing durable budget and
 * actual local social chain, with at most one main network call and no Decisions. */
export async function runSocialProviderVerification(options:{paid:boolean;out:string},configured?:CognitionConfig) {
  if(!options.paid)throw new Error('Social provider check requires explicit --paid');
  const original=configured??loadCognitionConfig(),config={...original,decisions:{...original.decisions,enabled:false,available:false}};
  await mkdir(options.out,{recursive:true});
  const preflight={kind:'social-single-provider-check',maximumMainCalls:1,maximumDecisionsCalls:0,profile:SOCIAL_PROMPT_REVISION,classification:'DISPOSABLE EXPERIMENT / ACTUAL GPU / AUTHORED SOCIAL ENCODING / ONE REAL PROVIDER',ceilingUsd:config.budget.ceilingUsd};
  if(!config.main.available){const report={...preflight,status:'unavailable',actualProviderAcceptance:false,mainCalls:0,decisionsCalls:0,reason:'Existing main provider configuration unavailable; no configuration or budget changed'};await writeFile(join(options.out,'social-verification.json'),JSON.stringify(report,null,2));return report;}
  const ledger=new DurableBudget(config.budget.directory,config.budget.ceilingUsd),budgetBefore=await ledger.snapshot();let networkCalls=0,adapterAttempts=0;
  const providers=new CognitionProviders(config,ledger,async(url,init)=>{if(networkCalls>=1)throw new Error('Single-provider-call limit');networkCalls++;return fetch(url,init);});
  let providerEvidence:unknown=null,failure:string|null=null,resultStatus='not_called',diagnostic:unknown=null;let runtimeAdmissionPassed=false,exactReplayPassed=false;
  try {
    const lab=await runSocialLab({out:join(options.out,'social-provider.zip'),scenario:'accept',onEncodedObservation:async(runtime,manager,captureId)=>{
      const cp=runtime.simulation.checkpoint();if((cp.schemaVersion!==11&&cp.schemaVersion!==12)||!cp.social.firstRecognizedEncounter||cp.social.experiences.length<2)throw new Error('Actual encoded social evidence is required before provider work');
      const observation=assembleCognitionObservation(runtime,manager,captureId,cp.cognition.identity,config.limits.maxImageBytes,config.limits.maxContextBytes),requestId=randomUUID();
      const privateKeys=['actorId','offerId','accountId','encodedTick','capturedTick','satiety','reserves','sleepPressure','generation'];
      const text=JSON.stringify(observation.selection.context);if(privateKeys.some(key=>text.includes('"'+key+'"'))||!observation.selection.context.creatorFoundation||!observation.selection.context.experiences.some(e=>typeof e.uncertainty==='string'))throw new Error('Provider-safe social context validation failed');
      runtime.enqueueCognitionRequest({type:'cognition_request',requestId,purpose:'interpretation',selection:observation.selection,provider:'openrouter',model:config.main.model,promptRevision:SOCIAL_PROMPT_REVISION,schemaRevision:COGNITION_SCHEMA_REVISION},observation.evidence);runtime.applyControl({type:'step'});
      const admitted=runtime.simulation.checkpoint();if((admitted.schemaVersion!==11&&admitted.schemaVersion!==12)||!admitted.cognition.requests.some(entry=>entry.request.requestId===requestId&&entry.status==='pending'))throw new Error('Ordered cognition request was rejected; no provider call made');
      if(++adapterAttempts>1)throw new Error('Single-provider-attempt limit');
      const result=await providers.interpret({requestId,worldTimeSeconds:runtime.simulation.state.time,worldScope:runtime.target.worldId+'/'+runtime.target.branchId+'/'+runtime.target.runId,context:observation.selection.context,png:observation.png});resultStatus=result.status;
      const allowedFailures:CognitionFailure[]=['failed','refused','malformed','timeout','unavailable','rate_limit','budget_exhausted','cancelled','interrupted','superseded'];
      const outcome=result.status==='ok'?'success':allowedFailures.includes(result.status as CognitionFailure)?result.status as CognitionFailure:'failed';
      const terminal:CognitionResultCommand={type:'cognition_result',requestId,identity:cp.cognition.identity,outcome,proposal:result.status==='ok'&&result.content?parseCognitionProposal(result.content):null,metrics:{latencyMs:result.latencyMs,attempts:result.attempts,inputTokens:result.inputTokens,outputTokens:result.outputTokens,costUsd:result.costUsd,costBasis:result.costBasis,modelRevision:result.modelRevision},...(result.validationError?{validationError:result.validationError}:{})};
      runtime.enqueueCognitionResult(terminal);runtime.applyControl({type:'step'});
      const after=runtime.simulation.checkpoint();if((after.schemaVersion!==11&&after.schemaVersion!==12))throw new Error('Social schema required');const recorded=after.cognition.requests.find(entry=>entry.request.requestId===requestId);
      runtimeAdmissionPassed=recorded?.result?.outcome==='success'&&recorded.encoding?.status==='admitted';if(result.status==='ok'&&!runtimeAdmissionPassed)failure='provider_transport_succeeded_but_runtime_admission_failed';
      providerEvidence={requestId,mainCalls:networkCalls,decisionsCalls:0,context:observation.selection.context,contextHash:observation.contextHash,promptRevision:SOCIAL_PROMPT_REVISION,status:result.status,metrics:terminal.metrics,orderedOutcome:recorded?.result?.outcome??null,modelExperienceEncoding:recorded?.encoding??null,source:'actual_renderer',authoredSocialExperienceCount:cp.social.experiences.length,firstRecognizedEncounter:cp.social.firstRecognizedEncounter};
      return providerEvidence;
    }});diagnostic=lab.checks.replay;exactReplayPassed=lab.checks.replay.status==='PASS';
  }catch(error){failure=error instanceof Error?error.message.slice(0,240):'Local social/provider check failed';}
  const budgetAfter=await ledger.snapshot(),providerTransportPassed=networkCalls===1&&resultStatus==='ok',passed=!failure&&providerTransportPassed&&runtimeAdmissionPassed&&exactReplayPassed;
  const report={...preflight,status:passed?'passed':failure?'failed':'incomplete',actualProviderAcceptance:passed,providerTransportPassed,runtimeAdmissionPassed,exactReplayPassed,failure,mainCalls:networkCalls,mainAdapterAttempts:adapterAttempts,decisionsCalls:0,providerEvidence,budgetBefore,budgetAfter,diagnostic,limitations:['Single versioned-context integration, not a provider campaign or recognition benchmark.','Local acceptance/identity already required actual authored RGB and encoding before the provider call.','Initial need/view/search are declared isolated fixtures; owner LIVE and normal pairing were never opened.','No budget ceiling change, Decisions enablement, automatic retry or fallback.']};
  await writeFile(join(options.out,'social-verification.json'),JSON.stringify(report,null,2));return report;
}
