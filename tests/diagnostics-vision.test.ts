import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8 } from 'fflate';
import { BranchRuntime } from '../server/branch-runtime.js';
import { CaptureManager } from '../server/vision/capture-manager.js';
import type { FrameRenderer } from '../server/vision/renderer.js';
import { exportIncident, inspectBundle, replayBundle } from '../server/diagnostics/bundle.js';

test('vision bundle preserves typed backend/format evidence and describes head replay without inventing an activity midpoint',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'lumi-vision-export-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const runtime=new BranchRuntime({directory,worldId:'lumi',branchId:'export-fixture',mode:'EXPERIMENT'});
  const renderer:FrameRenderer={render:async()=>({bytes:new Uint8Array([137,80,78,71]),backend:{configuration:'angle-d3d11',chromium:'142.test',webglVendor:'fixture vendor',webglRenderer:'fixture renderer',version:'WebGL 2.0',flags:[]}}),close:async()=>{}};
  const manager=new CaptureManager(()=>true,renderer);
  try{const requested=manager.request(runtime,{reason:'diagnostic'});await manager.wait(runtime.target,requested.captureId);}finally{await manager.close();await runtime.close();}
  const out=join(directory,'vision.zip');assert.equal((await exportIncident({runDirectory:runtime.recorder!.runDirectory,out})).manifest.evidence_status,'COMPLETE');assert.equal((await replayBundle(out)).status,'PASS');
  const files=await inspectBundle(out),records=strFromU8(files['events.jsonl']).trim().split('\n').map(line=>JSON.parse(line)),complete=records.find(record=>record.event_type==='CAPTURE_COMPLETE');
  assert.equal(complete.data.format,'image/png');assert.equal(complete.data.chromium,'142.test');assert.equal(complete.data.webglVendor,'fixture vendor');assert.equal(complete.data.webglVersion,'WebGL 2.0');assert.match(complete.data.frameHash,/^[a-f0-9]{64}$/);
  assert.ok(!Object.keys(files).some(name=>name.endsWith('.png')));assert.ok(!strFromU8(files['events.jsonl']).includes('base64'));
  const reproduction=strFromU8(files['REPRODUCTION.md']);assert.match(reproduction,/saved head\/eye pose, scene state and ordered actions/);assert.match(reproduction,/metadata and pixel hashes without raw pixels/);assert.match(reproduction,/does not launch a renderer or regenerate images/);assert.match(reproduction,/No saved activity midpoint is asserted/);assert.ok(!reproduction.includes('including a saved activity midpoint'));
});

test('generated instructions assert a saved activity midpoint only when the captured activity has one',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'lumi-midpoint-export-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const original=new BranchRuntime({worldId:'lumi',branchId:'template',mode:'EXPERIMENT',offline:true}),cp=original.checkpoint();cp.simulation.activity={activityId:1,status:'paused',cursor:5,totalTicks:10,appliedMilestones:[],completionCount:0};
  const runtime=new BranchRuntime({directory,worldId:'lumi',branchId:'midpoint',mode:'EXPERIMENT',checkpoint:cp});await runtime.close();
  const out=join(directory,'midpoint.zip');await exportIncident({runDirectory:runtime.recorder!.runDirectory,out});const reproduction=strFromU8((await inspectBundle(out))['REPRODUCTION.md']);assert.match(reproduction,/This case includes a saved activity midpoint/);assert.ok(!reproduction.includes('No saved activity midpoint is asserted'));
});
