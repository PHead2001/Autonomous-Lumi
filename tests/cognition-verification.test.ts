import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,readdir,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {CognitionProviders,type ProviderTransport} from '../server/cognition/providers.js';
import {DurableBudget} from '../server/cognition/budget.js';
import { loadCognitionConfig } from '../server/cognition/config.js';
import { runVerification,verificationOptions,verificationPreflight,verificationAcceptance,sanitizedProviderFailure,verificationCases,VERIFICATION_CASES,EvidenceClient,type VerificationPacing } from '../server/cognition/verify.js';

test('paid verification requires explicit mode; absent credentials finish preflight without renderer or provider work',async()=>{
  assert.throws(()=>verificationOptions([]),/exactly one/);
  assert.throws(()=>verificationOptions(['--mock','--paid']),/exactly one/);
  assert.throws(()=>verificationOptions(['--paid','--serve','180']),/MOCK companion/);
  const directory=await mkdtemp(join(tmpdir(),'lumi-cognition-preflight-'));
  try{
    const options=verificationOptions(['--paid','--out',directory]),config=loadCognitionConfig({env:{},loadEnv:false});
    assert.equal(verificationPreflight(options,config).maximumMainCalls,6);
    const report=await runVerification(options,config);assert.equal('status'in report&&report.status,'unavailable');assert.equal(report.actualProviderAcceptance,false);
    assert.deepEqual(await readdir(directory),['verification.json']);
    assert.equal(JSON.parse(await readFile(join(directory,'verification.json'),'utf8')).actualProviderAcceptance,false);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('HTTP capability evidence retains status and bounded failure categories without provider message contents',()=>{
  const failure=sanitizedProviderFailure(404,{error:{code:404,type:'route_error',message:'No endpoints found that support the requested parameters SECRET key and full prompt'}});
  assert.deepEqual(failure,{httpStatus:404,code:404,type:'route_error',category:'no_compatible_endpoint'});assert.ok(!JSON.stringify(failure).includes('SECRET'));
  assert.equal(sanitizedProviderFailure(401,{error:{code:'Bearer private-key',message:'Invalid API key private-key'}}).code,null);
  const token='sk-or-v1-fake-private-key';const secretShaped=sanitizedProviderFailure(401,{error:{code:token,type:token,message:token}});assert.equal(secretShaped.code,null);assert.equal(secretShaped.type,null);assert.ok(!JSON.stringify(secretShaped).includes(token));
});
test('incomplete replay evidence cannot become full acceptance even with images and a surviving LIVE experience',()=>{
  const cases=['visible','partial','dark','absent','hidden','temporary-live'].map(name=>({case:name,requests:[{status:'success'}],bundle:{evidence:'COMPLETE',replay:{status:'PASS'}},...(name==='temporary-live'?{restartWithCognitionDisabled:{survived:true}}:{})}));
  assert.equal(verificationAcceptance(cases,null).status,'passed');
  cases.at(-1)!.bundle={evidence:'INCOMPLETE',replay:{status:'INCOMPLETE'}};
  const report=verificationAcceptance(cases,null);assert.equal(report.status,'incomplete');assert.equal(report.actualProviderAcceptance,false);assert.equal(report.actualImageInterpretationEvidence,true);assert.equal(report.livePersistenceVerified,true);assert.equal(report.offlineReplayComplete,false);assert.ok(report.evidenceGaps.some(g=>g.includes('temporary-live: complete offline replay')));
});


test('one failed or thrown case cannot omit later scenarios or the bounded LIVE recovery attempt',async()=>{
 const visited:string[]=[];
 const {cases,failure}=await verificationCases(async name=>{visited.push(name);if(name==='visible')throw new Error('private rejected reply');return {case:name,requests:[{status:name==='partial'?'malformed':'success'}],bundle:{evidence:'COMPLETE',replay:{status:'PASS'}}};},async()=>{visited.push('temporary-live');return {case:'temporary-live',requests:[{status:'success'}],bundle:{evidence:'COMPLETE',replay:{status:'PASS'}},restartWithCognitionDisabled:{survived:true}};});
 assert.deepEqual(visited,[...VERIFICATION_CASES]);assert.equal(cases.length,6);assert.equal(cases[0].failure,'scenario_failed');assert.ok(!JSON.stringify(cases).includes('private rejected reply'));assert.ok(failure?.includes('visible, partial'));
 const report=verificationAcceptance(cases,failure);assert.equal(report.status,'failed');assert.equal(report.actualProviderAcceptance,false);assert.equal(report.livePersistenceVerified,true);assert.ok(report.evidenceGaps.some(g=>g.startsWith('visible:')));assert.ok(report.evidenceGaps.some(g=>g.startsWith('partial:')));
});

test('cleanup failure retains all six reports and prevents provider acceptance despite successful interpretations',async()=>{
 const {cases}=await verificationCases(async name=>({case:name,requests:[{status:'success'}],bundle:{evidence:'COMPLETE',replay:{status:'PASS'}},...(name==='dark'?{failure:'renderer_cleanup_failed'}:{})}),async()=>({case:'temporary-live',requests:[{status:'success'}],bundle:{evidence:'COMPLETE',replay:{status:'PASS'}},restartWithCognitionDisabled:{survived:true}}));
 const report=verificationAcceptance(cases,null);assert.equal(cases.length,6);assert.equal(report.actualProviderAcceptance,false);assert.equal(report.status,'incomplete');assert.ok(report.evidenceGaps.includes('dark: renderer_cleanup_failed'));
});


async function pacedEvidenceFixture(pacing:VerificationPacing,minIntervalMs:number,transport:ProviderTransport){
 const directory=await mkdtemp(join(tmpdir(),'lumi-verification-pacing-'));
 const config=loadCognitionConfig({loadEnv:false,env:{LUMI_COGNITION_ENABLED:'true',OPENROUTER_API_KEY:'fake-offline-key',LUMI_DECISIONS_ENABLED:'true',OPENAI_API_KEY:'fake-offline-key',LUMI_COGNITION_MIN_REAL_INTERVAL_MS:String(minIntervalMs),LUMI_COGNITION_BUDGET_DIRECTORY:join(directory,'budget')}});
 const budget=new DurableBudget(config.budget.directory,1,pacing.now),actual=new CognitionProviders(config,budget,transport),client=new EvidenceClient(config,directory,actual,pacing);
 const png=PNG.sync.write(new PNG({width:512,height:512,fill:true})),frameHash=createHash('sha256').update(png).digest('hex');
 const input=(id:string)=>({requestId:id,worldTimeSeconds:100,worldScope:id,png,context:{observationId:'observation',frameHash,shapes:[],sound:null,activity:{status:'idle'},experiences:[]}});
 return {client,input,close:async()=>{client.endCase();await rm(directory,{recursive:true,force:true});}};
}
const successfulInterpretation=()=>Response.json({model:'qwen/qwen3.7-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify({interpretation:'I cannot identify anything clearly.',uncertainty:.9,evidenceHandles:[],action:{type:'continue'}})}}],usage:{prompt_tokens:100,completion_tokens:40,cost:.00001}});

test('retiring a paced case aborts its wait and prevents any late main or Decisions transport',async()=>{
 let now=0,calls=0,activeWaits=0,enteredCount=0;let notifyEntered:()=>void=()=>{};const entered=new Promise<void>(resolve=>{notifyEntered=resolve;});
 const pacing:VerificationPacing={now:()=>now,wait:async(_ms,signal)=>{activeWaits++;if(++enteredCount===2)notifyEntered();try{await new Promise<void>((_resolve,reject)=>{const abort=()=>reject(new Error('cancelled pacing'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});}finally{activeWaits--;}}};
 const f=await pacedEvidenceFixture(pacing,1000,async()=>{calls++;return successfulInterpretation();});
 try{
  f.client.begin('visible');assert.equal((await f.client.interpret(f.input('first'))).status,'ok');
  const retired=f.client.begin('partial'),pending=f.client.interpret(f.input('retired-main')),decision=f.client.decide({...f.input('retired-decision'),choices:[{value:'continue',description:'Continue'},{value:'request_observation',description:'Look again'}]});
  await entered;f.client.endCase(retired);f.client.begin('dark');
  assert.equal((await pending).status,'unavailable');assert.equal((await decision).status,'unavailable');assert.equal(activeWaits,0);assert.equal(calls,1);assert.equal(f.client.inputs.at(-1)?.case,'partial');assert.equal(f.client.inputs.at(-1)?.caseGeneration,2);
  now=1000;assert.equal((await f.client.interpret(f.input('dark'))).status,'ok');assert.equal(calls,2);assert.equal(f.client.inputs.at(-1)?.case,'dark');
 }finally{await f.close();}
});

test('a 120 second configured cadence cannot outlive the 60 second case budget or dispatch later',async()=>{
 let now=0,calls=0,waits=0;const pacing:VerificationPacing={now:()=>now,wait:async ms=>{waits++;now+=ms;}};
 const f=await pacedEvidenceFixture(pacing,120000,async()=>{calls++;return successfulInterpretation();});
 try{
  f.client.begin('visible');assert.equal((await f.client.interpret(f.input('visible'))).status,'ok');
  f.client.begin('partial');assert.equal((await f.client.interpret(f.input('partial'))).status,'timeout');f.client.endCase();assert.equal(calls,1);assert.equal(waits,0);assert.equal(now,0);
  now=120000;f.client.begin('dark');assert.equal((await f.client.interpret(f.input('dark'))).status,'ok');assert.equal(calls,2);assert.equal(waits,0);
 }finally{await f.close();}
});

test('an already dispatched response retains its original immutable case label after replacement',async()=>{
 let calls=0;let notifyStarted:()=>void=()=>{},release:(response:Response)=>void=()=>{};const started=new Promise<void>(resolve=>{notifyStarted=resolve;});
 const pacing:VerificationPacing={now:()=>0,wait:async()=>{throw new Error('unexpected wait');}};
 const f=await pacedEvidenceFixture(pacing,100,async()=>{calls++;notifyStarted();return new Promise<Response>(resolve=>{release=resolve;});});
 try{
  const original=f.client.begin('visible'),pending=f.client.interpret(f.input('original'));
  await started;f.client.endCase(original);f.client.begin('partial');release(successfulInterpretation());
  assert.equal((await pending).status,'ok');assert.equal(calls,1);assert.equal(f.client.inputs[0].case,'visible');assert.equal(f.client.inputs[0].caseGeneration,1);
 }finally{await f.close();}
});
