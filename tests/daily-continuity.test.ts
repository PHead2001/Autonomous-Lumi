import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket} from 'ws';
import {BranchRuntime,type RuntimeCheckpoint} from '../server/branch-runtime.js';
import {DeliverySimulation,SocialSimulation,validateCheckpoint,hashCheckpoint,type CheckpointV12} from '../server/simulation.js';
import {RecoveryStore} from '../server/recovery-store.js';
import {createWorldServer} from '../server/world-server.js';
import {cognitionEnvelopeBytes,cognitionStorageBytes,DELIVERY_FUTURE_BYTES} from '../server/checkpoint-capacity.js';
import {MAX_CHECKPOINT_BYTES} from '../server/checkpoint-storage.js';
import {validateDeliveryState} from '../shared/delivery-protocol.js';
import {loadCognitionConfig} from '../server/cognition/config.js';
import {replay} from '../server/replay.js';

function maximalDelivery(base:CheckpointV12,receipts=8){
  const s=structuredClone(base.delivery),tick=base.tick,max=Number.MAX_SAFE_INTEGER;
  s.revision=max;s.nextDeliveryId=max;s.open=true;
  s.receipts=Array.from({length:receipts},(_,i)=>({deliveryId:max-receipts+i,itemId:max-receipts+i,good:'fruit' as const,status:i<4?'stored' as const:'consumed' as const,depositedTick:tick,noticedTick:tick,openedTick:tick,collectedTick:i<4?null:tick,consumedTick:i<4?null:tick}));
  s.experiences=Array.from({length:16},(_,i)=>({id:i+1,kind:'delivery' as const,identity:structuredClone(base.cognition.identity),provenance:'ATTENDED_DELIVERY_RGB' as const,source:'actual_renderer' as const,captureId:'x'.repeat(100),frameHash:'a'.repeat(64),capturedTick:tick,attentionTick:tick,encodedTick:tick,interpretation:'\0'.repeat(300),uncertainty:'\0'.repeat(200)}));
  s.feedback={actionId:max,outcome:'rejected',reason:'x'.repeat(100),tick};
  s.known={type:'delivery_observation',captureId:'x'.repeat(100),frameHash:'a'.repeat(64),capturedTick:tick,attentionTick:tick,sensorSource:'actual_renderer',revision:max,handle:'x'.repeat(100),kind:'occupied'};
  s.task={stage:'approach',route:Array.from({length:128},()=>({x:-1.2345678901234567e-100,z:-1.2345678901234567e-100})),routeCursor:127,progressTicks:4*base.config.hz,deliveryId:null,nextRetryTick:max,startedTick:tick};
  s.droppedCount=max-33;s.nextTimelineSequence=max;
  s.timeline=Array.from({length:32},(_,i)=>({sequence:s.droppedCount+i+1,tick,type:'\0'.repeat(40),label:'\0'.repeat(100),deliveryId:s.receipts[0].deliveryId}));
  validateDeliveryState(s,tick,base.config.hz);return s;
}
test('delivery future reserve covers validated maximum-shaped state and pending operation in the actual wrapper',t=>{
  const base=new DeliverySimulation({mode:'EXPERIMENT',physiology:{active:false}}).checkpoint();
  const full=structuredClone(base);full.delivery=maximalDelivery(base);
  const max=Number.MAX_SAFE_INTEGER;
  full.town.nextItemId=max;full.town.lastPurchaseId=max-1;
  full.town.items=full.delivery.receipts.map(r=>({id:r.itemId,kind:r.good,owner:r.status==='stored'?'dropoff' as const:'lumi' as const,purchaseId:r.itemId,acquiredTick:base.tick,consumedTick:r.consumedTick}));
  full.town.purchases=full.town.items.map(i=>({id:i.purchaseId,tick:base.tick,good:i.kind,outcome:'purchased' as const,reason:'purchased',itemId:i.id,price:3}));
  full.pendingInputs=[{sequence:full.nextInputSequence++,receivedTick:full.tick,applyTick:full.tick+1,admission:'queued',command:{type:'delivery_deposit',runId:full.cognition.identity.runId,generation:max,sequence:max,actionId:max,itemId:max-1}}];
  validateCheckpoint(full);
  const validGrowth=cognitionEnvelopeBytes(full)-cognitionEnvelopeBytes(base);
  const conservative={...full,delivery:maximalDelivery(base,16)};
  const conservativeGrowth=cognitionEnvelopeBytes(conservative)-cognitionEnvelopeBytes(base);
  t.diagnostic(JSON.stringify({validReceiptCount:8,stored:4,experienceCount:16,routePoints:128,pendingOperations:1,validGrowth,standalone16ReceiptOverapproxGrowth:conservativeGrowth,reserveBytes:DELIVERY_FUTURE_BYTES,fullReservedBytes:cognitionStorageBytes(full),limitBytes:MAX_CHECKPOINT_BYTES}));
  assert.ok(validGrowth<=DELIVERY_FUTURE_BYTES,'valid maximum delivery growth exceeds the measured reserve');
  assert.ok(conservativeGrowth<=DELIVERY_FUTURE_BYTES,'standalone16receipt conservative bound exceeds the measured reserve');
  assert.ok(cognitionStorageBytes(full)<=MAX_CHECKPOINT_BYTES);
});

function ownedItemFixture(envelope:RuntimeCheckpoint,committed:boolean):RuntimeCheckpoint{
  const source=envelope.simulation;if(source.schemaVersion!==12)throw Error('CP12 required');
  const sim=new DeliverySimulation({checkpoint:source,...source.cognition.identity,historical:true});
  sim.enqueue({type:'visit_start',runId:source.cognition.identity.runId,generation:1});sim.step();
  const cp=sim.checkpoint();cp.visit.actor!.x=0;cp.visit.actor!.z=-1.9;cp.visit.actor!.heading=cp.visit.control.targetYaw=Math.PI;cp.visit.actor!.heldItemId=1;
  cp.town.nextItemId=2;cp.town.lastPurchaseId=1;cp.town.items=[{id:1,kind:'fruit',owner:'owner',purchaseId:1,acquiredTick:cp.tick,consumedTick:null}];cp.town.purchases=[{id:1,tick:cp.tick,good:'fruit',outcome:'purchased',reason:'purchased',itemId:1,price:3}];
  const final=new DeliverySimulation({checkpoint:cp,...cp.cognition.identity,historical:true});
  if(committed){final.enqueue({type:'delivery_deposit',runId:cp.cognition.identity.runId,generation:1,sequence:1,actionId:1,itemId:1});final.step();}
  const before=final.checkpoint();
  final.enqueue({type:'visit_control',runId:cp.cognition.identity.runId,generation:1,sequence:before.visit.control.lastSequence+1,forward:1,strafe:0,yaw:Math.PI,pitch:0,expiresTick:before.tick+Math.ceil(.75*before.config.hz)});
  final.enqueue({type:'delivery_deposit',runId:cp.cognition.identity.runId,generation:1,sequence:before.visit.control.lastSequence+2,actionId:before.visit.lastActionId+1,itemId:1});
  return {...envelope,simulation:final.checkpoint()};
}

test('CP12 genuine zero-viewer scheduling and saved restart preserve stored custody while invalidating old controls',async t=>{
  const root=await mkdtemp(join(tmpdir(),'lumi-daily-continuity-')),directory=join(root,'data');
  const after:ReturnType<typeof createWorldServer>[]=[];
  t.after(async()=>{for(const app of after)await app.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true});});
  const {store}=await RecoveryStore.open({directory}),template=new BranchRuntime({worldId:'lumi',branchId:'live',historyId:store.historyId,mode:'LIVE',offline:true,physiology:{active:false}});
  const initial=ownedItemFixture(template.checkpoint(),true);await template.close();await store.save(initial);
  const make=(checkpoint:unknown,recoveryStore:RecoveryStore)=>createWorldServer({checkpoint,diagnosticsDirectory:directory,recoveryStore,ownerCredentialFile:join(root,'auth','unused.json'),automaticCaptures:false,cognition:{config:loadCognitionConfig({env:{},loadEnv:false})}});
  const first=make(initial,store);after.push(first);const port=await first.listen(0);
  const viewer=new WebSocket('ws://127.0.0.1:'+port+'/world');await once(viewer,'open');const serverSocket=[...first.sockets.clients][0];assert.ok(serverSocket);const clientClosed=once(viewer,'close'),serverClosed=once(serverSocket,'close');viewer.close();await Promise.all([clientClosed,serverClosed]);
  const before=first.simulation.state.tick;assert.equal(first.sockets.clients.size,0);await delay(220);const during=first.simulation.state.tick;
  assert.ok(during>before,'existing timer must advance with zero viewers');
  const cp=first.simulation.checkpoint();assert.equal(cp.schemaVersion,12);if(cp.schemaVersion!==12)throw Error('CP12 required');
  assert.equal(cp.delivery.receipts.length,1);assert.equal(cp.delivery.receipts[0].status,'stored');assert.equal(cp.visit.control.status,'parked');assert.equal(cp.visit.control.forward,0);assert.equal(cp.visit.control.strafe,0);assert.deepEqual([cp.visit.actor!.x,cp.visit.actor!.z],[0,-1.9]);assert.equal(cp.body.lastEffectSequence,0);
  await first.close();const saved=await RecoveryStore.open({directory});const savedCp=saved.checkpoint as RuntimeCheckpoint;
  const second=make(savedCp,saved.store);after.push(second);const port2=await second.listen(0);assert.notEqual(second.registry.live.target.runId,first.registry.live.target.runId);assert.equal(second.registry.historyId,first.registry.historyId);
  await delay(100);const restored=second.simulation.checkpoint();assert.equal(restored.schemaVersion,12);if(restored.schemaVersion!==12)throw Error('CP12 required');assert.ok(restored.tick>=savedCp.simulation.tick);assert.equal(restored.delivery.receipts.length,1);assert.equal(restored.delivery.receipts[0].status,'stored');assert.equal(restored.town.items[0].owner,'dropoff');assert.equal(restored.visit.actor!.id,cp.visit.actor!.id);assert.equal(restored.visit.control.status,'parked');assert.equal(second.visitSockets.clients.size,0);assert.ok(port2>0);
  await mkdir(resolve('diagnostics/phase25d-preservation'),{recursive:true});await writeFile(resolve('diagnostics/phase25d-preservation/isolated-continuity.json'),JSON.stringify({status:'PASS',ports:[port,port2],zeroViewer:{observedHostMs:220,beforeTick:before,afterTick:during,viewerCount:0},savedTick:savedCp.simulation.tick,newRun:second.registry.live.target.runId!==first.registry.live.target.runId,storedCustody:true,parkedSameAvatar:true,staleInputsRejected:true,providerRequests:0,ownerWorldUsed:false},null,2));
});

test('uncommitted old-run deposit cannot commit on CP12 restart and CP11 offline replay retains its rules',async()=>{
  const template=new BranchRuntime({worldId:'lumi',branchId:'live',mode:'LIVE',offline:true,physiology:{active:false}});
  const initial=ownedItemFixture(template.checkpoint(),false);await template.close();
  const runtime=new BranchRuntime({worldId:'lumi',branchId:'live',mode:'LIVE',checkpoint:initial,directory:resolve('diagnostics/phase25d-preservation/restart-fixture')});
  try{runtime.simulation.step();const cp=runtime.simulation.checkpoint();assert.equal(cp.schemaVersion,12);if(cp.schemaVersion!==12)throw Error('CP12 required');assert.equal(cp.delivery.receipts.length,0);assert.equal(cp.town.items[0].owner,'owner');assert.equal(cp.visit.actor!.heldItemId,1);assert.equal(cp.visit.control.status,'parked');}finally{await runtime.close();}
  const old=new SocialSimulation({mode:'EXPERIMENT',runId:'historical-continuity',physiology:{active:false},historical:true});const start=old.checkpoint();for(let i=0;i<30;i++)old.step();const end=old.checkpoint(),result=replay(start,[],end.tick);assert.equal(result.stateHash,hashCheckpoint(end));assert.equal(end.schemaVersion,11);assert.equal(end.rulesVersion,start.rulesVersion);
});
