import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorldServer } from '../server/world-server.js';
import { loadCognitionConfig } from '../server/cognition/config.js';
import { setTimeout as delay } from 'node:timers/promises';
import { RecoveryStore } from '../server/recovery-store.js';
import { runHungerLab } from '../server/physiology-lab.js';

test('disposable LIVE accepts real body awareness/encoding without fixture effects and preserves it through host restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lumi-physiology-host-'));let elapsed=0;
 const clock={monotonicMs:()=>elapsed,utcMs:()=>1800000000000+elapsed};
 const config=loadCognitionConfig({env:{},loadEnv:false});
 const app=createWorldServer({historyId:'disposable-body-acceptance',diagnosticsDirectory:directory,clock,autoSchedule:false,automaticCaptures:false,physiology:{active:true,genesisPreset:'acceptance-fast-v1'},cognition:{config}});
 let restarted:ReturnType<typeof createWorldServer>|undefined;
 try{
  const port=await app.listen(0);for(let i=0;i<310&&(app.registry.live.simulation.checkpoint() as import('../server/simulation.js').CheckpointV7).internalExperiences.length===0;i++){elapsed+=100;app.registry.live.pump();}
  const cp=app.registry.live.checkpoint();if(((cp.simulation.schemaVersion!==11&&cp.simulation.schemaVersion!==12)&&cp.simulation.schemaVersion!==10))throw new Error('Current town physiology schema required');
  assert.equal(cp.simulation.body.lastEffectSequence,0);assert.equal(cp.simulation.physiology.origin.evidenceEligibility,'eligible');
  assert.equal(cp.simulation.internalExperiences.length,1);assert.equal(cp.simulation.internalExperiences[0].identity.mode,'LIVE');
  assert.equal(cp.simulation.cognition.requests.length,0);
  const scope=new URLSearchParams({...app.registry.live.target});
  const percept=await (await fetch(`http://127.0.0.1:${port}/api/physiology?${scope}`)).json();
  assert.equal(percept.active,true);assert.equal(percept.presentSensations[0].kind,'hunger');assert.equal('privateDiagnostics' in percept,false);
  const advanced=await (await fetch(`http://127.0.0.1:${port}/api/physiology?${scope}&advanced=true`)).json();assert.equal(advanced.privateDiagnostics.internalExperiences.length,1);
  const frozen=app.registry.live.simulation.checkpoint();elapsed+=60000;assert.equal(app.registry.live.pump(),0);assert.deepEqual(app.registry.live.simulation.checkpoint(),frozen,'host suspension cannot integrate hunger or in-world sleep recovery');
  await app.close();
  restarted=createWorldServer({historyId:'disposable-body-acceptance',checkpoint:cp,diagnosticsDirectory:directory,clock,autoSchedule:false,automaticCaptures:false,cognition:{config}});
  await restarted.listen(0);const restored=restarted.registry.live.simulation.checkpoint();if(((restored.schemaVersion!==11&&restored.schemaVersion!==12)&&restored.schemaVersion!==10))throw new Error('Current town physiology schema required');
  assert.deepEqual(restored.internalExperiences,cp.simulation.internalExperiences);assert.deepEqual(restored.character,cp.simulation.character);assert.equal(restored.body.active,true);
 }finally{await app.close();await restarted?.close();await rm(directory,{recursive:true,force:true});}
});

test('actual isolated Hunger during a task lab computes checks and exports a replayable sanitized bundle',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lumi-hunger-lab-'));
 try{
  const sentinel=join(directory,'owner-history-sentinel.txt');await writeFile(sentinel,'preserve owner history');
  const result=await runHungerLab({out:join(directory,'hunger.zip'),directory});
  assert.equal(result.status,'PASS',JSON.stringify(result.assertions));assert.equal(result.replay?.status,'PASS');
  assert.equal(result.target.branchId,'hunger-during-task');assert.equal(await readFile(sentinel,'utf8'),'preserve owner history');
  assert.ok(result.runDirectory.includes('lab-'));assert.ok(result.timeline.some(e=>e.type==='INTERNAL_IGNORED'));assert.ok(result.timeline.some(e=>e.type==='INTERNAL_ATTENDED'));assert.ok(result.timeline.some(e=>e.type==='BODY_ABSORPTION_COMPLETED'));
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('short actual zero-viewer host run commits and restarts disposable physiological history',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lumi-body-real-host-'));const config=loadCognitionConfig({env:{},loadEnv:false});
 const first=await RecoveryStore.open({directory,newWorld:true});
 const app=createWorldServer({diagnosticsDirectory:directory,recoveryStore:first.store,autoSchedule:true,automaticCaptures:false,physiology:{active:true,genesisPreset:'acceptance-fast-v1'},cognition:{config}});
 let restarted:ReturnType<typeof createWorldServer>|undefined;
 try{
  const port=await app.listen(0);await delay(350);
  const health=await(await fetch(`http://127.0.0.1:${port}/health`)).json();assert.equal(health.viewers,0);assert.ok(health.tick>=3);
  await app.close();const saved=await RecoveryStore.open({directory});
  restarted=createWorldServer({diagnosticsDirectory:directory,recoveryStore:saved.store,checkpoint:saved.checkpoint,autoSchedule:false,automaticCaptures:false,cognition:{config}});
  await restarted.listen(0);const cp=restarted.registry.live.simulation.checkpoint();if(((cp.schemaVersion!==11&&cp.schemaVersion!==12)&&cp.schemaVersion!==10))throw new Error('Current town physiology schema required');
  const savedState=(saved.checkpoint as import('../server/branch-runtime.js').RuntimeCheckpoint).simulation as import('../server/simulation.js').CheckpointV7;assert.ok(cp.tick>=health.tick);assert.equal(cp.body.active,true);assert.deepEqual(cp.body,savedState.body);assert.deepEqual(cp.interoception,savedState.interoception);assert.deepEqual(cp.internalExperiences,savedState.internalExperiences);assert.equal(cp.cognition.requests.length,0);
 }finally{await app.close();await restarted?.close();await rm(directory,{recursive:true,force:true});}
});
