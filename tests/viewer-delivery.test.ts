import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deliveryControls,deliveryPresentation,deliveryRequestResult} from '../src/viewer-delivery.js';
import {VisitControls} from '../src/visit-controls.js';
import {recentWorldTimeline} from '../src/viewer-town.js';
import type {DeliveryWorldView} from '../shared/delivery-protocol.js';
import {CREATOR_FOUNDATION,type VisitWorldView} from '../shared/visit-protocol.js';
import type {SocialWorldView} from '../shared/social-protocol.js';

const delivery=():DeliveryWorldView=>({containerId:'home-dropoff',position:{x:0,z:-3.25},capacity:4,occupied:1,open:false,revision:1,feedback:null,items:[{deliveryId:1,itemId:7,good:'fruit',status:'stored',depositedTick:10,noticedTick:null,openedTick:null,collectedTick:null,consumedTick:null}],activity:{stage:'idle',status:'idle',progress:0},timeline:[],droppedCount:0});
const visit=():VisitWorldView=>({actor:{id:'owner-avatar-v1',appearance:'visitor-neutral-v1',x:0,z:-1.9,heading:Math.PI,pitch:0,moving:false,gait:0,heldItemId:8,heldItem:'bread'},control:{generation:1,lastSequence:0,status:'active',expiresTick:30},inventory:[{id:8,kind:'bread'}],balance:15,lastActionId:2,feedback:null,foundation:CREATOR_FOUNDATION,timeline:[],droppedCount:0});
const social=():SocialWorldView=>({offer:null,feedback:null,badge:{display:false,kind:'verified_seal',revision:0},giftUse:null,timeline:[],droppedCount:0});

test('deposit controls require current Visit possession, free custody, space and proximity',()=>{
  const d=delivery(),v=visit(),s=social();assert.equal(deliveryControls(d,v,s,false).canDeposit,false);assert.equal(deliveryControls(d,v,s,true).canDeposit,true);
  v.actor!.x=4;assert.equal(deliveryControls(d,v,s,true).canDeposit,false);v.actor!.x=0;v.inventory=[];assert.equal(deliveryControls(d,v,s,true).canDeposit,false);v.inventory=[{id:8,kind:'bread'}];
  d.occupied=4;assert.equal(deliveryControls(d,v,s,true).canDeposit,false);assert.match(deliveryControls(d,v,s,true).hint,/full/);d.occupied=1;
  s.offer={id:1,revision:1,itemId:8,good:'bread',generation:1,runId:'delivery-ui',createdTick:10,deadlineTick:30,status:'pending',noticedTick:null,response:null,reason:'pending',transferTick:null};assert.equal(deliveryControls(d,v,s,true).canDeposit,false);assert.match(deliveryControls(d,v,s,true).hint,/pending in-person offer/);
  s.offer.status='cancelled';assert.equal(deliveryControls(d,v,s,true).canDeposit,true);
});

test('delivery presentation never upgrades deposit into notice, collection, consumption or meeting',()=>{
  const d=delivery(),before=structuredClone(d);let p=deliveryPresentation(d);assert.match(p.entries[0],/deposited and waiting.*No item notice/);assert.doesNotMatch(JSON.stringify(p),/creator|handed|grateful|recognized|memory/i);assert.deepEqual(d,before);
  const item=d.items[0];item.openedTick=15;assert.match(deliveryPresentation(d).entries[0],/container opened.*not yet.*noticed/);
  item.noticedTick=20;p=deliveryPresentation(d);assert.match(p.entries[0],/contents noticed.*still waiting/);
  item.status='collected';item.collectedTick=25;d.occupied=0;assert.match(deliveryPresentation(d).entries[0],/collected.*not yet consumed/);
  item.status='consumed';item.consumedTick=35;assert.match(deliveryPresentation(d).entries[0],/consumed through a separate eating action/);
});

test('a correlated applied result is required to confirm deposit, not a shared action cursor',()=>{
  const pending={actionId:4,sequence:8};assert.equal(deliveryRequestResult(pending,null),null);assert.equal(deliveryRequestResult(pending,{actionId:5,outcome:'accepted',reason:'stored',tick:10}),null);
  const success=deliveryRequestResult(pending,{actionId:4,outcome:'accepted',reason:'stored',tick:10});assert.match(success!.message,/Deposit completed/);assert.match(success!.message,/notice, collection and eating have not been implied/);
  const rejected=deliveryRequestResult(pending,{actionId:4,outcome:'rejected',reason:'storage_full',tick:10});assert.match(rejected!.message,/Deposit rejected.*Storage is full/);assert.doesNotMatch(rejected!.message,/completed|noticed/i);
});

test('deposit intentions use the shared scoped cursor and cannot assert delivery success or identity',()=>{
  const c=new VisitControls();assert.equal(c.deposit(8,0),null);c.begin({worldId:'lumi',branchId:'delivery-ui',runId:'delivery-run'},3,4,2,{yaw:0,pitch:0});
  const deposit=c.deposit(8,9)!,offer=c.offer(8,9)!;assert.equal(deposit.actionId,10);assert.equal(offer.actionId,11);assert.equal(offer.sequence,deposit.sequence+1);assert.equal(deposit.runId,'delivery-run');assert.equal(deposit.generation,3);
  assert.deepEqual(Object.keys(deposit).sort(),['actionId','branchId','generation','itemId','runId','sequence','type','worldId']);
});

test('delivery observer history merges in temporal order and declares bounded coverage',()=>{
  const d=delivery();d.timeline=[{sequence:1,tick:10,type:'deposited',label:'Item deposited',deliveryId:1},{sequence:2,tick:20,type:'opened',label:'Drop-off opened',deliveryId:1}];d.droppedCount=3;
  const before=structuredClone(d),history=recentWorldTimeline(undefined,undefined,21,1,8,undefined,undefined,d);assert.deepEqual(history.entries.map(e=>e.label),['Drop-off opened','Item deposited']);assert.match(history.note,/3 earlier delivery events/);assert.deepEqual(d,before);assert.ok(history.entries.every(e=>Object.keys(e).sort().join(',')==='age,label,type'));
});
