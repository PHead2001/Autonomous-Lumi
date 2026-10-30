import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { BranchRuntime } from '../server/branch-runtime.js';
import { CaptureManager } from '../server/vision/capture-manager.js';
import { AutomaticCaptureCoordinator } from '../server/vision/auto-capture.js';
import { type FrameRenderer, type RenderedFrame } from '../server/vision/renderer.js';
import { createVisibilityFixture } from '../shared/vision-fixture.js';
import type { WorldMode } from '../shared/lab-protocol.js';
import type { CaptureIntent } from '../shared/attention-protocol.js';
import { eyePose } from '../shared/eye-pose.js';

const backend:RenderedFrame['backend']={configuration:'angle-d3d11',chromium:'fixture',webglVendor:'fixture',webglRenderer:'fixture',version:'fixture',flags:[]};
const png=new PNG({width:128,height:128});png.data.fill(255);
const frame:RenderedFrame={bytes:PNG.sync.write(png),backend};
const turn=()=>new Promise<void>(done=>setImmediate(done));
function fixture(branchId:string,mode:WorldMode='EXPERIMENT',submitted=false){
  const original=new BranchRuntime({worldId:'auto-test',branchId,mode,offline:true}),checkpoint=original.checkpoint();
  const c=checkpoint.simulation;if(c.schemaVersion!==5&&c.schemaVersion!==6&&c.schemaVersion!==7)throw new Error('Current sensory schema required');
  const visual=createVisibilityFixture();c.character=visual.character;c.scene=visual.scene!;c.head=visual.head!;c.pauseUntilTick=100000;
  c.attention.pending={id:1,createdTick:0,expiresTick:300,reasons:['salient_sound','head_milestone'],triggers:[{reason:'salient_sound',tick:0,parentSequence:null},{reason:'head_milestone',tick:0,parentSequence:null}],parentSequence:null,status:submitted?'submitted':'pending',captureId:submitted?'previous-process-capture':null,requestedTick:submitted?0:null};
  c.attention.nextIntentId=2;
  return new BranchRuntime({worldId:'auto-test',branchId,mode,offline:true,checkpoint});
}
const logical=(r:BranchRuntime)=>{const cp=r.simulation.checkpoint();if(cp.schemaVersion!==5&&cp.schemaVersion!==6&&cp.schemaVersion!==7)throw new Error('Current schema');return cp.attention;};
class DelayedRenderer implements FrameRenderer {
  calls=0;private releaseFrame:((value:RenderedFrame)=>void)|undefined;
  render(){this.calls++;return new Promise<RenderedFrame>(done=>{this.releaseFrame=done;});}
  release(){this.releaseFrame?.(frame);}
  async close(){this.release();}
}
test('automatic capture uses existing queue, coalesced reasons and ordered snapshot feedback without callback mutation',async()=>{
  const runtime=fixture('ordered'),renderer=new DelayedRenderer(),manager=new CaptureManager(()=>true,renderer),host=new AutomaticCaptureCoordinator(manager,()=>true,()=>0);
  try{
    host.pump([runtime]);host.pump([runtime]);assert.equal(renderer.calls,1);
    const request=manager.view(runtime.target).latest!;assert.deepEqual(request.automatic?.reasons,['salient_sound','head_milestone']);assert.equal(request.tick,0);
    assert.equal(logical(runtime).pending?.status,'pending','admission callback only queued an ordered input');
    runtime.simulation.step();assert.equal(logical(runtime).pending?.status,'submitted');
    for(let i=0;i<5;i++)runtime.simulation.step();
    renderer.release();await manager.wait(runtime.target,request.captureId);await turn();
    assert.equal(logical(runtime).baseline,null,'renderer completion cannot mutate authoritative state');
    runtime.simulation.step();const result=logical(runtime);
    assert.equal(result.lastCapture?.capturedTick,0);assert.equal(result.lastCapture?.receivedTick,7);assert.equal(result.lastCapture?.freshness,'applicable');
    assert.equal(result.baseline?.signature.length,48);assert.equal(runtime.simulation.checkpoint().experiences.length,0);assert.ok(manager.frame(runtime.target,request.captureId).length>100);
  }finally{host.close();await manager.close();await runtime.close();}
});

test('automatic delayed duplicate frame survives an unseen revision change without changing backoff or probe schedule',async()=>{
  const original=fixture('hidden-revision'),checkpoint=original.checkpoint();
  if(checkpoint.simulation.schemaVersion!==5&&checkpoint.simulation.schemaVersion!==6&&checkpoint.simulation.schemaVersion!==7)throw new Error('Current schema');
  const c=checkpoint.simulation,p=eyePose(original.viewerState());
  c.attention.baseline={capturedTick:0,sceneRevision:0,pose:{x:p.position[0],y:p.position[1],z:p.position[2],bodyHeading:p.bodyHeading,headYaw:p.headYaw,headPitch:p.headPitch},signature:Array(48).fill(255),frameHash:'a'.repeat(64),captureId:'baseline'};
  c.attention.lastAcceptedCaptureTick=0;
  const runtime=new BranchRuntime({worldId:'auto-test',branchId:'hidden-revision',mode:'EXPERIMENT',offline:true,checkpoint});
  const renderer=new DelayedRenderer(),manager=new CaptureManager(()=>true,renderer),host=new AutomaticCaptureCoordinator(manager,()=>true,()=>0);
  try{
    runtime.simulation.step();host.pump([runtime]);const request=manager.view(runtime.target).latest!;
    runtime.simulation.step();
    runtime.enqueue({type:'configure_scene',illumination:1,fixture:'visibility',fixtureColor:'#21df68',doorOpenRadians:null});
    runtime.simulation.step();assert.equal(runtime.simulation.snapshot().scene!.revision,1);
    renderer.release();await manager.wait(runtime.target,request.captureId);await turn();
    runtime.simulation.step();const state=logical(runtime);
    assert.equal(state.lastCapture?.freshness,'applicable');assert.equal(state.lastCapture?.difference,0);
    assert.equal(state.failureCount,0);assert.equal(state.retryAfterTick,0);
    assert.equal(state.nextProbeTick,runtime.simulation.state.tick+state.config.probeIntervalTicks);
    assert.equal(state.baseline?.sceneRevision,request.dynamicRevision);assert.equal(state.baseline?.capturedTick,request.tick);
  }finally{host.close();await manager.close();await runtime.close();await original.close();}
});
test('paused, fast-forward and repeated host pumps cannot dispatch accumulated work; resumed quota rejection is recorded once',async()=>{
  let now=0;const runtime=fixture('pause'),renderer=new DelayedRenderer(),manager=new CaptureManager(()=>true,renderer),host=new AutomaticCaptureCoordinator(manager,()=>true,()=>now);
  try{
    runtime.applyControl({type:'pause'});for(let i=0;i<10;i++)host.pump([runtime]);assert.equal(renderer.calls,0);
    runtime.applyControl({type:'fast-forward',ticks:1});host.pump([runtime]);assert.equal(renderer.calls,0);
    runtime.applyControl({type:'cancel-fast-forward'});runtime.applyControl({type:'resume'});host.pump([runtime]);assert.equal(renderer.calls,1);
    runtime.simulation.step();renderer.release();await turn();await turn();runtime.simulation.step();
    // A fresh logical intention before the host budget recovers is an explicit input outcome.
    const cp=runtime.checkpoint();if(cp.simulation.schemaVersion!==5&&cp.simulation.schemaVersion!==6&&cp.simulation.schemaVersion!==7)throw new Error('Current schema');
    const intent:CaptureIntent={id:2,createdTick:cp.simulation.tick,expiresTick:cp.simulation.tick+300,reasons:['uncertainty_probe'],triggers:[{reason:'uncertainty_probe',tick:cp.simulation.tick,parentSequence:null}],parentSequence:null,status:'pending',captureId:null,requestedTick:null};
    cp.simulation.attention.pending=intent;cp.simulation.attention.nextIntentId=3;
    const second=new BranchRuntime({worldId:'auto-test',branchId:'pause',mode:'EXPERIMENT',offline:true,checkpoint:cp});
    try{
      // The new run receives its own host budget; the shared global2s limit still applies.
      for(let i=0;i<10;i++)host.pump([second]);assert.equal(renderer.calls,1);
      const feedback=second.simulation.checkpoint().pendingInputs.filter(i=>i.command.type==='sensor_feedback');assert.equal(feedback.length,1);assert.equal(feedback[0].command.type,'sensor_feedback');
      second.simulation.step();assert.equal(logical(second).lastCapture?.outcome,'quota');
      now=10000;host.pump([second]);assert.equal(renderer.calls,1,'a handled intention never retries through a busy host loop');
    }finally{await second.close();}
  }finally{host.close();await manager.close();await runtime.close();}
});
test('one automatic job shares capacity fairly and favors LIVE when experiment work is pending',async()=>{
  let now=0;const live=fixture('live','LIVE'),a=fixture('a'),b=fixture('b'),renderer=new DelayedRenderer(),manager=new CaptureManager(()=>true,renderer),host=new AutomaticCaptureCoordinator(manager,()=>true,()=>now);
  try{
    host.pump([a,b,live]);assert.ok(manager.view(live.target).latest);assert.equal(manager.queued,1);host.pump([a,b,live]);assert.equal(renderer.calls,1);
    renderer.release();await turn();await turn();now=5000;host.pump([a,b,live]);assert.ok(manager.view(a.target).latest);assert.equal(renderer.calls,2);
    renderer.release();await turn();await turn();now=10000;host.pump([a,b,live]);assert.ok(manager.view(b.target).latest);assert.equal(renderer.calls,3);
  }finally{host.close();await manager.close();for(const r of [live,a,b])await r.close();}
});
test('restart reconciles submitted work once, and a retired result never writes into another run',async()=>{
  const restored=fixture('restored','EXPERIMENT',true),runtime=fixture('retired'),renderer=new DelayedRenderer();let current=true;
  const manager=new CaptureManager(()=>current,renderer),host=new AutomaticCaptureCoordinator(manager,()=>current,()=>0);
  try{
    host.pump([restored]);host.pump([restored]);assert.equal(renderer.calls,0);assert.equal(restored.simulation.checkpoint().pendingInputs.length,1);
    restored.simulation.step();assert.equal(logical(restored).lastCapture?.outcome,'interrupted');
    host.pump([runtime]);const requested=manager.view(runtime.target).latest!;runtime.simulation.step();current=false;renderer.release();await manager.wait(runtime.target,requested.captureId);await turn();
    assert.equal(runtime.simulation.checkpoint().pendingInputs.length,0);assert.equal(logical(runtime).baseline,null);
  }finally{host.close();await manager.close();await restored.close();await runtime.close();}
});
test('restart reconciles a saved queued admission before dispatching and accepts a bounded fresh probe',async()=>{
  const original=fixture('queued-admission'),oldRenderer=new DelayedRenderer(),oldManager=new CaptureManager(()=>true,oldRenderer),oldHost=new AutomaticCaptureCoordinator(oldManager,()=>true,()=>0);
  let restored:BranchRuntime|undefined;
  const renderer=new DelayedRenderer(),manager=new CaptureManager(()=>true,renderer),host=new AutomaticCaptureCoordinator(manager,()=>true,()=>0);
  try{
    oldHost.pump([original]);const oldCapture=oldManager.view(original.target).latest!;
    const saved=JSON.parse(JSON.stringify(original.checkpoint())) as ReturnType<BranchRuntime['checkpoint']>;
    if(saved.simulation.schemaVersion!==5&&saved.simulation.schemaVersion!==6&&saved.simulation.schemaVersion!==7)throw new Error('Current schema');
    assert.equal(saved.simulation.attention.pending?.status,'pending');
    assert.equal(saved.simulation.pendingInputs[0].command.type,'sensor_feedback');
    // A short logical probe interval proves recovery before the old intention expires.
    saved.simulation.attention.config.probeIntervalTicks=160;
    restored=new BranchRuntime({worldId:'auto-test',branchId:'queued-admission',mode:'EXPERIMENT',offline:true,checkpoint:saved});
    const before=restored.simulation.checkpoint();
    for(let i=0;i<10;i++)host.pump([restored]);
    assert.equal(renderer.calls,0,'saved ordered admission must apply before a new host can dispatch');
    assert.deepEqual(restored.simulation.checkpoint(),before,'host reconciliation cannot mutate canonical state');
    restored.simulation.step();assert.equal(logical(restored).pending?.captureId,oldCapture.captureId);
    for(let i=0;i<10;i++)host.pump([restored]);
    const recovery=restored.simulation.checkpoint().pendingInputs;
    assert.equal(recovery.length,1);assert.equal(recovery[0].command.type,'sensor_feedback');
    assert.ok(recovery[0].command.type==='sensor_feedback'&&recovery[0].command.stage==='recovered');
    assert.equal(logical(restored).pending?.status,'submitted','recovery remains an ordered input');
    restored.simulation.step();assert.equal(logical(restored).lastCapture?.outcome,'interrupted');assert.equal(logical(restored).pending,null);
    while(!logical(restored).pending&&restored.simulation.state.tick<200)restored.simulation.step();
    const fresh=logical(restored).pending!;assert.ok(fresh);assert.equal(fresh.id,2);assert.ok(restored.simulation.state.tick<300);
    host.pump([restored]);host.pump([restored]);assert.equal(renderer.calls,1);
    const requested=manager.view(restored.target).latest!;assert.notEqual(requested.captureId,oldCapture.captureId);assert.equal(requested.automatic?.intentId,fresh.id);
    restored.simulation.step();renderer.release();await manager.wait(restored.target,requested.captureId);await turn();
    assert.equal(logical(restored).baseline,null);restored.simulation.step();
    assert.equal(logical(restored).lastCapture?.captureId,requested.captureId);assert.equal(logical(restored).lastCapture?.freshness,'applicable');assert.equal(logical(restored).pending,null);
    assert.equal(logical(restored).baseline?.captureId,requested.captureId);
  }finally{oldHost.close();host.close();await oldManager.close();await manager.close();await original.close();await restored?.close();}
});
test('restart lets saved ordered admission and result finish without orphan recovery or redispatch',async()=>{
  const original=fixture('queued-result'),renderer=new DelayedRenderer(),manager=new CaptureManager(()=>true,renderer),oldHost=new AutomaticCaptureCoordinator(manager,()=>true,()=>0);
  let restored:BranchRuntime|undefined;
  const freshRenderer=new DelayedRenderer(),freshManager=new CaptureManager(()=>true,freshRenderer),host=new AutomaticCaptureCoordinator(freshManager,()=>true,()=>0);
  try{
    oldHost.pump([original]);const requested=manager.view(original.target).latest!;
    renderer.release();await manager.wait(original.target,requested.captureId);await turn();
    const saved=JSON.parse(JSON.stringify(original.checkpoint())) as ReturnType<BranchRuntime['checkpoint']>;
    assert.equal(saved.simulation.pendingInputs.length,2);
    restored=new BranchRuntime({worldId:'auto-test',branchId:'queued-result',mode:'EXPERIMENT',offline:true,checkpoint:saved});
    host.pump([restored]);assert.equal(freshRenderer.calls,0);assert.equal(restored.simulation.checkpoint().pendingInputs.length,2);
    restored.simulation.step();host.pump([restored]);
    assert.equal(logical(restored).lastCapture?.freshness,'applicable');assert.equal(logical(restored).baseline?.captureId,requested.captureId);
    assert.equal(restored.simulation.checkpoint().pendingInputs.length,0);assert.equal(freshRenderer.calls,0);
  }finally{oldHost.close();host.close();await manager.close();await freshManager.close();await original.close();await restored?.close();}
});
test('full ordered input queue cannot stick a capture forever or cause per-pump retries',async()=>{
  const runtime=fixture('saturated'),manager=new CaptureManager(()=>true,{render:async()=>frame,close:async()=>{}}),host=new AutomaticCaptureCoordinator(manager,()=>true,()=>0);
  try{
    for(let i=0;i<256;i++)runtime.enqueue({type:'invalid',reason:'unknown_command'});
    runtime.drainEvents();host.pump([runtime]);await turn();await turn();
    for(let i=0;i<10;i++)host.pump([runtime]);
    assert.equal(manager.queued,0);assert.ok(runtime.drainEvents().some(e=>e.type==='INPUT_ADMITTED'&&e.outcome==='queue_full'));
    for(let i=0;i<302;i++)runtime.simulation.step();assert.equal(logical(runtime).pending,null);
    assert.equal(logical(runtime).baseline,null,'lost evidence is never fabricated');
  }finally{host.close();await manager.close();await runtime.close();}
});
