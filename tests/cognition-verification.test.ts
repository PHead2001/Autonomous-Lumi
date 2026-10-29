import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,readdir,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCognitionConfig } from '../server/cognition/config.js';
import { runVerification,verificationOptions,verificationPreflight,verificationAcceptance } from '../server/cognition/verify.js';

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
test('incomplete replay evidence cannot become full acceptance even with images and a surviving LIVE experience',()=>{
  const cases=['visible','partial','dark','absent','hidden','temporary-live'].map(name=>({case:name,requests:[{status:'success'}],bundle:{evidence:'COMPLETE',replay:{status:'PASS'}},...(name==='temporary-live'?{restartWithCognitionDisabled:{survived:true}}:{})}));
  assert.equal(verificationAcceptance(cases,null).status,'passed');
  cases.at(-1)!.bundle={evidence:'INCOMPLETE',replay:{status:'INCOMPLETE'}};
  const report=verificationAcceptance(cases,null);assert.equal(report.status,'incomplete');assert.equal(report.actualProviderAcceptance,false);assert.equal(report.actualImageInterpretationEvidence,true);assert.equal(report.livePersistenceVerified,true);assert.equal(report.offlineReplayComplete,false);assert.ok(report.evidenceGaps.some(g=>g.includes('temporary-live: complete offline replay')));
});
