import test from 'node:test';
import assert from 'node:assert/strict';
import { ChromiumRenderer } from '../server/vision/renderer.js';
import { imageSignature } from '../server/vision/image-signature.js';
import { imageSignatureDifference, DEFAULT_ATTENTION_CONFIG } from '../shared/attention-protocol.js';
import { createVisibilityFixture } from '../shared/vision-fixture.js';
import { groundSnapshot } from '../server/vision/grounding.js';
import { BranchRuntime } from '../server/branch-runtime.js';
import { CaptureManager } from '../server/vision/capture-manager.js';
import { AutomaticCaptureCoordinator } from '../server/vision/auto-capture.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('actual RGB probes detect visible material change at identical pose and ignore an unseen material change',async()=>{
  const renderer=new ChromiumRenderer('angle-d3d11');
  try {
    const original=createVisibilityFixture(),changed=structuredClone(original);changed.scene!.fixtureColor='#21df68';changed.scene!.revision++;
    const signature=async(state:typeof original)=>imageSignature((await renderer.render(state,256,256)).bytes);
    const baseline=await signature(original),repeat=await signature(original),visible=await signature(changed);
    const hidden=structuredClone(original);hidden.character.heading=Math.PI;
    const hiddenChanged=structuredClone(hidden);hiddenChanged.scene!.fixtureColor='#21df68';hiddenChanged.scene!.revision++;
    const hiddenBefore=await signature(hidden),hiddenAfter=await signature(hiddenChanged);
    const behindWall=structuredClone(original);behindWall.character.z=6;behindWall.character.heading=Math.PI;
    const behindWallChanged=structuredClone(behindWall);behindWallChanged.scene!.fixtureColor='#21df68';behindWallChanged.scene!.revision++;
    assert.equal(groundSnapshot(behindWall).objects.find(o=>o.id==='fixture-ahead')?.status,'fully_occluded');
    const wallBefore=await signature(behindWall),wallAfter=await signature(behindWallChanged);
    const result={duplicate:imageSignatureDifference(baseline,repeat),visible:imageSignatureDifference(baseline,visible),hidden:imageSignatureDifference(hiddenBefore,hiddenAfter),behindWall:imageSignatureDifference(wallBefore,wallAfter)};
    console.log('RGB probe differences',JSON.stringify(result));
    assert.equal(result.duplicate,0);assert.ok(result.visible>DEFAULT_ATTENTION_CONFIG.visualChangeThreshold);assert.equal(result.hidden,0);assert.equal(result.behindWall,0);
  }finally{await renderer.close();}
});

test('zero-viewer received sound produces reflex, bounded attention action and automatic actual frame through ordered feedback',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'lumi-attention-actual-'));
  const source=new BranchRuntime({worldId:'actual-attention',branchId:'probe',mode:'EXPERIMENT',offline:true}),checkpoint=source.checkpoint();
  if(checkpoint.simulation.schemaVersion!==4)throw new Error('Current sensory schema');
  const c=checkpoint.simulation,visual=createVisibilityFixture();
  c.character=visual.character;c.scene=visual.scene!;c.head=visual.head!;c.pauseUntilTick=100000;
  const runtime=new BranchRuntime({worldId:'actual-attention',branchId:'probe',mode:'EXPERIMENT',checkpoint,directory});
  const renderer=new ChromiumRenderer('angle-d3d11'),manager=new CaptureManager(()=>true,renderer),host=new AutomaticCaptureCoordinator(manager,()=>true);
  let timer:ReturnType<typeof setInterval>|undefined;
  try{
    runtime.enqueue({type:'emit_sound',x:0,y:2.4,z:0,intensity:1,suddenness:1,sourceId:'controlled-actual-probe'});
    const events=[];
    for(let i=0;i<90;i++){
      events.push(...runtime.simulation.step());
      const cp=runtime.simulation.checkpoint();if(cp.schemaVersion===4&&cp.attention.pending)break;
    }
    assert.ok(events.some(e=>e.type==='SOUND_RECEIVED'));assert.ok(events.some(e=>e.type==='REFLEX_DECISION'&&e.outcome==='triggered'));assert.ok(events.some(e=>e.type==='ATTENTION_ACTION'));
    host.pump([runtime]);const requested=manager.view(runtime.target).latest;assert.ok(requested?.automatic);
    timer=setInterval(()=>runtime.pump(),1000/30);
    const completed=await manager.wait(runtime.target,requested.captureId);assert.equal(completed.status,'success');
    await new Promise<void>(done=>setImmediate(done));runtime.simulation.step();
    const final=runtime.simulation.checkpoint();if(final.schemaVersion!==4)throw new Error('Current schema');
    assert.equal(final.attention.lastCapture?.outcome,'success');assert.equal(final.attention.lastCapture?.freshness,'applicable');assert.equal(final.attention.lastCapture?.capturedTick,requested.tick);
    assert.ok(final.attention.baseline?.signature.length===48);assert.equal(final.experiences.length,0);assert.ok(manager.frame(runtime.target,requested.captureId).length>100);
    console.log('Automatic actual frame',JSON.stringify({captureTick:requested.tick,receiptTick:final.attention.lastCapture.receivedTick,frameHash:completed.frameHash,reasons:final.attention.lastCapture.reasons}));
  }finally{clearInterval(timer);host.close();await manager.close();await runtime.close();await source.close();await rm(directory,{recursive:true,force:true});}
});
