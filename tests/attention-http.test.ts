import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorldServer } from '../server/world-server.js';

test('hearing developer API is local, scoped and experiment-only without admitting arbitrary sensor feedback',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'lumi-attention-api-'));
  const world=createWorldServer({diagnosticsDirectory:directory,autoSchedule:false});
  try{
    const port=await world.listen(0),base=`http://127.0.0.1:${port}`,live=world.registry.live;
    const read=await fetch(base+'/api/attention?'+new URLSearchParams({...live.target}));assert.equal(read.status,200);
    const view=await read.json();assert.equal(view.runId,live.target.runId);assert.equal(view.attention.lastReceived,null);assert.equal(view.automatic.limits.maxAutomaticOutstanding,1);
    assert.equal((await fetch(base+'/api/attention?'+new URLSearchParams({...live.target}),{headers:{Origin:'https://untrusted.invalid'}})).status,403);
    assert.equal((await fetch(base+'/api/attention?'+new URLSearchParams({...live.target,runId:'retired'}))).status,400);
    const emission={type:'emit_sound',x:0,y:2.4,z:0,intensity:1,suddenness:1,sourceId:'test-source'};
    const post=(target:typeof live.target,action:unknown,origin?:string)=>fetch(base+'/api/sound',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify({...target,action})});
    assert.equal((await post(live.target,emission)).status,400);
    const saved=await world.registry.checkpoint(live.target),experiment=await world.registry.fork(live.target,saved.id,'sound-fixture');
    assert.equal((await post(experiment.target,emission,'https://untrusted.invalid')).status,403);
    assert.equal((await post(experiment.target,{type:'sensor_feedback'})).status,400);
    const accepted=await post(experiment.target,emission);assert.equal(accepted.status,200);assert.equal((await accepted.json()).queued,true);
    experiment.simulation.step();
    const state=await (await fetch(base+'/api/attention?'+new URLSearchParams({...experiment.target}))).json();
    assert.equal(state.attention.lastReceived.provenance,'SIMULATED_HEARING');assert.ok(!('sourceId' in state.attention.lastReceived));assert.ok(!('x' in state.attention.lastReceived));
    assert.equal(live.simulation.checkpoint().experiences.length,0);assert.equal(live.simulation.state.tick,0);
    // The manual API cannot forge an automatically scheduled capture's provenance.
    const forged=await fetch(base+'/api/vision/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...experiment.target,reason:'salient_sound'})});
    assert.equal(forged.status,400);
  }finally{await world.close();await rm(directory,{recursive:true,force:true});}
});
