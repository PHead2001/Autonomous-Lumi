import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {setImmediate as immediate} from 'node:timers/promises';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {BranchRuntime,hashRuntimeCheckpoint,replayRuntime} from '../server/branch-runtime.js';
import {BranchRegistry} from '../server/branch-registry.js';
import {hashCheckpoint,Simulation} from '../server/simulation.js';
import {readRun} from '../server/diagnostics/recorder.js';
import {createWorldServer} from '../server/world-server.js';
async function temp(t:{after(fn:()=>Promise<void>):void}){const directory=await mkdtemp(join(tmpdir(),'lumi-lab-core-'));t.after(async()=>{if(!resolve(directory).startsWith(resolve(tmpdir())+sep))throw new Error('Unsafe temp path');await rm(directory,{recursive:true,force:true});});return directory;}
test('forked experiments own state, queues, PRNG, checkpoints and storage without writing LIVE or sibling',async t=>{
  const directory=await temp(t),registry=new BranchRegistry({directory});const saved=await registry.checkpoint(registry.live.target);
  try{const a=await registry.fork(registry.live.target,saved.id,'a'),b=await registry.fork(registry.live.target,saved.id,'b');const liveHash=hashCheckpoint(registry.live.simulation.checkpoint()),bHash=hashCheckpoint(b.simulation.checkpoint());
    a.applyControl({type:'pause'});a.enqueue({type:'slam'});a.applyControl({type:'activity-start',totalTicks:20});a.applyControl({type:'synthetic-cue',sensed:true,attended:true,encoded:true});a.applyControl({type:'step'});a.simulation.random.next();
    assert.equal(hashCheckpoint(registry.live.simulation.checkpoint()),liveHash);assert.equal(hashCheckpoint(b.simulation.checkpoint()),bHash);
    const own=await registry.checkpoint(a.target),before=a.checkpoint();a.applyControl({type:'step'});const old=a.target.runId,restored=await registry.restore(a.target,own.id);
    assert.notEqual(restored.target.runId,old);const restoredState=restored.checkpoint();if(restoredState.simulation.schemaVersion!==10||before.simulation.schemaVersion!==10)throw new Error('Current physiology state required');assert.notEqual(restoredState.simulation.cognition.identity.runId,before.simulation.cognition.identity.runId);assert.equal(restoredState.simulation.cognition.identity.branchId,before.simulation.cognition.identity.branchId);assert.equal(hashRuntimeCheckpoint({...restoredState,simulation:{...restoredState.simulation,cognition:{...restoredState.simulation.cognition,identity:before.simulation.cognition.identity}}}),hashRuntimeCheckpoint(before));assert.throws(()=>registry.active(a.target),/stale/);assert.throws(()=>a.enqueue({type:'slam'}),/closed/);
    assert.equal(hashCheckpoint(registry.live.simulation.checkpoint()),liveHash);assert.equal(hashCheckpoint(b.simulation.checkpoint()),bHash);
    assert.ok((await readdir(join(directory,'lumi','a','checkpoints'))).includes(own.id+'.json'));
    assert.notEqual(a.recorder!.runDirectory,b.recorder!.runDirectory);assert.notEqual(a.recorder!.runDirectory,registry.live.recorder!.runDirectory);
  }finally{await registry.close();}
});
test('LIVE 1x and experiment 6x fixed steps, pause freeze, exact step, bounded yielding fast-forward and restore activity effects',async t=>{
  const directory=await temp(t);let now=0;const clock={monotonicMs:()=>now,utcMs:()=>now};
  const live=new BranchRuntime({worldId:'w',branchId:'live',mode:'LIVE',directory,clock,physiology:{active:false}}),exp=new BranchRuntime({worldId:'w',branchId:'exp',mode:'EXPERIMENT',directory,clock,physiology:{active:false}});
  try{now=100;live.pump();exp.pump();assert.equal(live.simulation.state.tick,3);assert.equal(exp.simulation.state.tick,18);
    exp.applyControl({type:'pause'});const at=exp.checkpoint();now+=1000;exp.pump();assert.equal(exp.simulation.state.tick,18);assert.equal(exp.scheduler.backlogMs,0);assert.deepEqual(exp.simulation.checkpoint().subjective,at.simulation.subjective);
    exp.applyControl({type:'step'});assert.equal(exp.simulation.state.tick,19);exp.applyControl({type:'activity-start',totalTicks:35});exp.applyControl({type:'fast-forward',ticks:35});
    let turns=0;while(exp.summary().fastForwardRemaining){await immediate();assert.ok(++turns<100);}
    const cp=exp.checkpoint();assert.equal(cp.simulation.activity.cursor,35);assert.equal(cp.simulation.activity.completionCount,1);assert.deepEqual(cp.simulation.activity.appliedMilestones,[10,20,30]);
    const restored=new BranchRuntime({worldId:'w',branchId:'restored',mode:'EXPERIMENT',checkpoint:cp,offline:true});for(let i=0;i<5;i++)restored.applyControl({type:'step'});assert.equal(restored.simulation.checkpoint().activity.completionCount,1);
    exp.applyControl({type:'resume'});now+=100;exp.pump();assert.equal(exp.simulation.state.tick,cp.simulation.tick+18);assert.throws(()=>live.applyControl({type:'pause'}),/LIVE/);
    exp.applyControl({type:'pause'});exp.applyControl({type:'fast-forward',ticks:100000});await immediate();const progress=exp.simulation.state.tick;assert.ok(progress<100000);exp.applyControl({type:'cancel-fast-forward'});await immediate();assert.equal(exp.simulation.state.tick,progress);
  }finally{await live.close();await exp.close();}
});
test('host gap is detected before acceleration and subjective gates calibrate only eligible experiment TEST STUBs',async t=>{
  const directory=await temp(t);let now=0;const runtime=new BranchRuntime({worldId:'w',branchId:'e',mode:'EXPERIMENT',directory,clock:{monotonicMs:()=>now,utcMs:()=>now}});
  try{now=100;runtime.pump();const tick=runtime.simulation.state.tick,estimate=runtime.simulation.checkpoint().subjective.estimateSeconds;now+=8*3600000;assert.equal(runtime.pump(),0);assert.equal(runtime.simulation.state.tick,tick);
    runtime.applyControl({type:'synthetic-clock',sensed:true,attended:false,encoded:true,observedSeconds:300,uncertaintySeconds:1});assert.equal(runtime.simulation.checkpoint().experiences.length,0);assert.equal(runtime.simulation.checkpoint().subjective.estimateSeconds,estimate);
    runtime.applyControl({type:'synthetic-clock',sensed:true,attended:true,encoded:true,observedSeconds:300,uncertaintySeconds:1});const cp=runtime.simulation.checkpoint();assert.equal(cp.subjective.estimateSeconds,300);assert.equal(cp.subjective.uncertaintySeconds,1);assert.equal(cp.experiences[0].provenance,'TEST STUB');assert.equal(cp.experiences[0].kind,'clock');
    runtime.applyControl({type:'pause'});runtime.applyControl({type:'step'});assert.ok(runtime.simulation.checkpoint().subjective.estimateSeconds>300);
  }finally{await runtime.close();}
});
test('fast-forward matches fixed steps and interrupted activity resumes its cursor without duplicate effects',async()=>{
  const source=new BranchRuntime({worldId:'offline',branchId:'a',mode:'EXPERIMENT',offline:true,physiology:{active:false}});source.applyControl({type:'pause'});source.applyControl({type:'activity-start',totalTicks:30});for(let i=0;i<12;i++)source.applyControl({type:'step'});source.applyControl({type:'activity-pause'});for(let i=0;i<3;i++)source.applyControl({type:'step'});
  const saved=source.checkpoint();assert.equal(saved.simulation.activity.cursor,12);assert.deepEqual(saved.simulation.activity.appliedMilestones,[10]);
  const stepped=new BranchRuntime({worldId:'offline',branchId:'steps',mode:'EXPERIMENT',checkpoint:saved,offline:true}),fast=new BranchRuntime({worldId:'offline',branchId:'fast',mode:'EXPERIMENT',checkpoint:saved,offline:true});stepped.applyControl({type:'activity-resume'});fast.applyControl({type:'activity-resume'});
  for(let i=0;i<18;i++)stepped.applyControl({type:'step'});fast.applyControl({type:'fast-forward',ticks:18});const start=fast.checkpoint();fast.replayOperation({sequence:start.control.nextOperationSequence,tick:start.simulation.tick,kind:'advance',ticks:18,source:'fast-forward',backlogMs:0});
  assert.equal(hashCheckpoint(fast.simulation.checkpoint()),hashCheckpoint(stepped.simulation.checkpoint()));assert.equal(fast.simulation.checkpoint().activity.completionCount,1);assert.deepEqual(fast.simulation.checkpoint().activity.appliedMilestones,[10,20,30]);
});
test('zero-tick scheduler backlog transitions replay and full experience rejection is atomic',async t=>{
  const directory=await temp(t);let now=0;const runtime=new BranchRuntime({worldId:'w',branchId:'e',mode:'EXPERIMENT',directory,clock:{monotonicMs:()=>now,utcMs:()=>now}}),start=runtime.checkpoint();
  runtime.applyControl({type:'speed',speed:1});now=10;assert.equal(runtime.pump(),0);const end=runtime.checkpoint();await runtime.close();const records=(await readRun(runtime.recorder!.runDirectory)).records;const ops=records.filter(r=>r.runtime_operation).map(r=>r.runtime_operation!);
  assert.ok(ops.some(op=>op.kind==='advance'&&op.ticks===0));assert.equal(replayRuntime(start,ops,end).runtimeHash,hashRuntimeCheckpoint(end));
  const pure=new BranchRuntime({worldId:'offline',branchId:'e',mode:'EXPERIMENT',offline:true});for(let i=0;i<256;i++)pure.applyControl({type:'synthetic-cue',sensed:true,attended:true,encoded:true});const before=hashRuntimeCheckpoint(pure.checkpoint());assert.throws(()=>pure.applyControl({type:'synthetic-cue',sensed:true,attended:true,encoded:true}),/capacity/);assert.equal(hashRuntimeCheckpoint(pure.checkpoint()),before);
  assert.throws(()=>new BranchRuntime({worldId:'offline',branchId:'live',mode:'LIVE',checkpoint:runtime.simulation.checkpoint(),offline:true}),/LIVE/);const cleanExperiment=new BranchRuntime({worldId:'offline',branchId:'empty',mode:'EXPERIMENT',offline:true});assert.throws(()=>new BranchRuntime({worldId:'offline',branchId:'live',mode:'LIVE',checkpoint:cleanExperiment.simulation.checkpoint(),offline:true}),/LIVE/);
  assert.doesNotThrow(()=>new BranchRuntime({worldId:'offline',branchId:'live',mode:'LIVE',checkpoint:new Simulation().checkpoint(),offline:true}));
});
test('concurrent fork reserves destination once and restore rejects in-flight/stale controls',async t=>{
  const directory=await temp(t),registry=new BranchRegistry({directory});try{const cp=await registry.checkpoint(registry.live.target);const outcomes=await Promise.allSettled([registry.fork(registry.live.target,cp.id,'same'),registry.fork(registry.live.target,cp.id,'same')]);assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(registry.branches.size,2);
    const experiment=registry.get({worldId:'lumi',branchId:'same'}),saved=await registry.checkpoint(experiment.target),restoring=registry.restore(experiment.target,saved.id);assert.throws(()=>registry.active(experiment.target),/progress/);await assert.rejects(registry.restore(experiment.target,saved.id),/progress/);const restored=await restoring;assert.notEqual(restored.target.runId,experiment.target.runId);assert.throws(()=>registry.active(experiment.target),/stale/);
  }finally{await registry.close();}
});
test('local HTTP/WS gates require exact target and reject foreign origins, traversal and stale runs',async t=>{
  const directory=await temp(t),app=createWorldServer({diagnosticsDirectory:directory,autoSchedule:false}),port=await app.listen(0),base=`http://127.0.0.1:${port}`;
  try{const live=app.registry.live.target;const post=(path:string,value:unknown,origin?:string)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(value)});
    assert.equal((await post('/api/checkpoint',live,'https://attacker.example')).status,403);assert.equal((await post('/api/control',{...live,action:{type:'pause'}})).status,400);assert.equal((await post('/api/checkpoint',{...live,branchId:'../live'})).status,400);
    const cp=(await (await post('/api/checkpoint',live)).json()).checkpoint;const experiment=await (await post('/api/fork',{...live,checkpointId:cp.id,newBranchId:'api'})).json();assert.equal(experiment.mode,'EXPERIMENT');
    const ws=new WebSocket(`ws://127.0.0.1:${port}/world?worldId=lumi&branchId=api`);await once(ws,'open');const before=app.registry.get(experiment).simulation.checkpoint();ws.send(JSON.stringify({type:'slam'}));await immediate();assert.equal(hashCheckpoint(app.registry.get(experiment).simulation.checkpoint()),hashCheckpoint(before));ws.close();await once(ws,'close');
    const denied=new WebSocket(`ws://127.0.0.1:${port}/world`,{origin:'https://attacker.example'});await assert.rejects(once(denied,'open'));
    assert.equal((await post('/api/control',{...experiment,runId:'stale',action:{type:'pause'}})).status,400);
    const data=JSON.parse(await readFile(join(directory,'lumi','live','checkpoints',cp.id+'.json'),'utf8'));assert.equal(data.mode,'LIVE');
  }finally{await app.close();}
});
