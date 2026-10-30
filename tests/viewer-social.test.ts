import {test} from 'node:test';
import assert from 'node:assert/strict';
import {offerPresentation,socialControls,socialRequestResult} from '../src/viewer-social.js';
import {VisitControls} from '../src/visit-controls.js';
import {recentWorldTimeline,worldActivity} from '../src/viewer-town.js';
import {CREATOR_FOUNDATION,type VisitWorldView} from '../shared/visit-protocol.js';
import {validateSocialCommand,type SocialWorldView,type SocialOffer} from '../shared/social-protocol.js';
import {SocialSimulation} from '../server/simulation.js';
import {purchaseTownItem} from '../server/town.js';

const social=():SocialWorldView=>({offer:null,feedback:null,badge:{display:false,kind:'verified_seal',revision:0},giftUse:null,timeline:[],droppedCount:0});
const offer=():SocialOffer=>({id:1,revision:1,itemId:7,good:'fruit',generation:1,runId:'social-ui-run',createdTick:10,deadlineTick:30,status:'pending',noticedTick:null,response:null,reason:'pending',transferTick:null});
const visit=():VisitWorldView=>({actor:{id:'owner-avatar-v1',appearance:'visitor-neutral-v1',x:.5,z:0,heading:0,pitch:0,moving:false,gait:0,heldItemId:7,heldItem:'fruit'},control:{generation:1,lastSequence:0,status:'active',expiresTick:20},inventory:[{id:7,kind:'fruit'}],balance:17,lastActionId:4,feedback:null,foundation:CREATOR_FOUNDATION,timeline:[],droppedCount:0});
const character={x:0,z:0,heading:0,moving:false,gait:0};
function appliedSocialFixture(){
  const s=new SocialSimulation({mode:'EXPERIMENT',worldId:'lumi',branchId:'social-ui',historyId:'social-ui-history',runId:'social-ui-run'});s.enqueue({type:'visit_start',runId:'social-ui-run',generation:1});s.step();const cp=s.checkpoint();cp.pauseUntilTick=100000;cp.home.controller.searchNextTick=100000;cp.home.controller.nextDecisionTick=100000;cp.character={...cp.character,x:0,z:0,heading:Math.PI,moving:false};cp.visit.actor={...cp.visit.actor!,x:0,z:-1.4,heading:0,moving:false};cp.visit.control.targetYaw=0;const purchase=purchaseTownItem(cp.town,{purchaseId:1,good:'fruit'},cp.tick,false,true,{owner:'owner',funds:cp.visit.balance});cp.visit.balance=purchase.balance;cp.visit.actor!.heldItemId=purchase.itemId;return new SocialSimulation({checkpoint:cp,mode:'EXPERIMENT',runId:'social-ui-run'});
}
test('offer controls require applied control, the actual held owned item and current reach',()=>{
  const s=social(),v=visit();assert.equal(socialControls(s,v,character,false).canOffer,false);assert.equal(socialControls(s,v,character,true).canOffer,true);
  v.actor!.x=3;assert.equal(socialControls(s,v,character,true).canOffer,false);v.actor!.x=.5;v.inventory=[];assert.equal(socialControls(s,v,character,true).canOffer,false);v.inventory=[{id:8,kind:'fruit'}];assert.equal(socialControls(s,v,character,true).canOffer,false);
  v.inventory=[{id:7,kind:'fruit'}];s.offer=offer();const pending=socialControls(s,v,character,true);assert.equal(pending.canOffer,false);assert.equal(pending.canCancel,true);s.offer.status='accepted';v.actor!.heldItemId=null;v.actor!.heldItem=null;v.inventory=[];assert.equal(socialControls(s,v,character,true).canOffer,false);assert.equal(socialControls(s,v,character,true).canCancel,false);
});
test('pending notice, deliberate responses and unnoticed expiry remain distinct from a committed transfer',()=>{
  const s=social();s.offer=offer();assert.match(offerPresentation(s).title,/Not yet noticed/);assert.doesNotMatch(offerPresentation(s).title,/accepted|declined/i);
  s.offer.noticedTick=12;assert.match(offerPresentation(s).title,/noticed.*Awaiting/);s.offer.response='ignore';assert.match(offerPresentation(s).title,/noticed.*No response/);assert.doesNotMatch(offerPresentation(s).title,/Not yet noticed/);s.offer.response='defer';s.offer.status='deferred';assert.match(offerPresentation(s).title,/deferred/);assert.match(offerPresentation(s).detail,/No transfer/);
  s.offer.status='declined';assert.match(offerPresentation(s).title,/declined/);s.offer.status='expired';s.offer.noticedTick=null;assert.match(offerPresentation(s).title,/without notice/);assert.match(offerPresentation(s).detail,/No notice, deliberate decline or transfer/);
  s.offer.status='accepted';s.offer.transferTick=15;const accepted=offerPresentation(s);assert.match(accepted.detail,/transfer is confirmed/);assert.match(accepted.detail,/Eating.*separate/);assert.doesNotMatch(JSON.stringify(accepted),/affection|gratitude|friend|memory|meeting/i);
});
test('social requests share the scoped action cursor but cannot choose a response or assert recognition',()=>{
  const c=new VisitControls(),scope={worldId:'lumi',branchId:'social-ui',runId:'social-ui-run'};assert.equal(c.offer(7,0),null);c.begin(scope,2,4,7,{yaw:0,pitch:0});
  const p=c.offer(7,9)!,cancel=c.cancelOffer(1,9)!,badge=c.badge(true,9)!;assert.equal(p.actionId,10);assert.equal(cancel.actionId,11);assert.equal(badge.actionId,12);assert.equal(badge.sequence,p.sequence+2);assert.equal(badge.runId,scope.runId);
  assert.doesNotThrow(()=>validateSocialCommand({type:'social_offer',runId:p.runId,generation:p.generation,sequence:p.sequence,actionId:p.actionId,itemId:p.itemId}));assert.doesNotThrow(()=>validateSocialCommand({type:'social_cancel',runId:cancel.runId,generation:cancel.generation,sequence:cancel.sequence,actionId:cancel.actionId,offerId:cancel.offerId}));assert.doesNotThrow(()=>validateSocialCommand({type:'social_badge',runId:badge.runId,generation:badge.generation,sequence:badge.sequence,actionId:badge.actionId,display:badge.display}));
  assert.ok([p,cancel,badge].every(packet=>!Object.keys(packet).some(k=>['response','accepted','verified','creator','nutrition'].includes(k))));
});
test('public social history is bounded presentation, separate from later gift consumption',()=>{
  const s=social();s.timeline=[{sequence:3,tick:12,offerId:1,type:'noticed',label:'Offer noticed'},{sequence:4,tick:14,offerId:1,type:'transfer',label:'Offered food accepted'}];s.droppedCount=2;const before=structuredClone(s),history=recentWorldTimeline(undefined,undefined,15,1,8,undefined,s);assert.deepEqual(history.entries.map(e=>e.label),['Offered food accepted','Offer noticed']);assert.match(history.note,/2 earlier offer\/introduction events/);assert.ok(history.entries.every(e=>Object.keys(e).sort().join(',')==='age,label,type'));assert.deepEqual(s,before);
  const state={character,social:s};assert.doesNotMatch(worldActivity(state).title,/Eating/);s.giftUse={itemId:7,startedTick:20,progressTicks:1,effectSequence:null,completedTick:null};assert.equal(worldActivity(state).title,'Eating accepted food');s.giftUse.completedTick=24;assert.doesNotMatch(worldActivity(state).title,/Eating accepted/);
});
test('actual apply-time offer rejections resolve the correlated request with useful feedback',()=>{
  for(const reason of ['owner_moving','out_of_reach','offer_pending']){
    let s=appliedSocialFixture();if(reason==='owner_moving'){s.enqueue({type:'visit_control',runId:'social-ui-run',generation:1,sequence:1,forward:1,strafe:0,yaw:0,pitch:0,expiresTick:s.state.tick+20});s.step();}else if(reason==='out_of_reach'){const cp=s.checkpoint();cp.visit.actor!.z=-2.3;s=new SocialSimulation({checkpoint:cp,mode:'EXPERIMENT',runId:'social-ui-run'});}else{s.enqueue({type:'social_offer',runId:'social-ui-run',generation:1,sequence:1,actionId:1,itemId:1});s.step();}
    const v=s.visitState(),command={type:'social_offer' as const,runId:'social-ui-run',generation:1,sequence:v.control.lastSequence+1,actionId:v.lastActionId+1,itemId:1};s.enqueue(command);s.step();const feedback=s.state.social!.feedback;assert.equal(feedback?.outcome,'rejected');assert.equal(feedback?.reason,reason);assert.equal(s.visitState().lastActionId,command.actionId,'cursor advancement alone is not success');
    const result=socialRequestResult({actionId:command.actionId,sequence:command.sequence,kind:'offer'},feedback);assert.equal(result?.outcome,'rejected');assert.match(result!.message,/Offer was not created/);assert.doesNotMatch(result!.message,/waiting|accepted|affection/i);
    assert.equal(socialRequestResult({actionId:command.actionId+1,sequence:command.sequence,kind:'offer'},feedback),null);assert.equal(socialRequestResult({actionId:command.actionId,sequence:command.sequence,kind:'badge'},feedback),null);
  }
});
test('confirmed offer/cancel/badge request results are not confused with Lumi accepting food',()=>{
  const s=appliedSocialFixture(),send=(action:Parameters<SocialSimulation['enqueue']>[0])=>{s.enqueue(action);s.step();return s.state.social!.feedback;};
  const created=send({type:'social_offer',runId:'social-ui-run',generation:1,sequence:1,actionId:1,itemId:1});const result=socialRequestResult({actionId:1,sequence:1,kind:'offer'},created)!;assert.equal(result.outcome,'accepted');assert.match(result.message,/Offer request confirmed/);assert.doesNotMatch(result.message,/transfer.*confirmed|food accepted/i);assert.equal(s.socialState().offer!.status,'pending');
  const cancelled=send({type:'social_cancel',runId:'social-ui-run',generation:1,sequence:2,actionId:2,offerId:1});assert.match(socialRequestResult({actionId:2,sequence:2,kind:'cancel'},cancelled)!.message,/cancellation confirmed/);
  const rejected=send({type:'social_cancel',runId:'social-ui-run',generation:1,sequence:3,actionId:3,offerId:1});assert.match(socialRequestResult({actionId:3,sequence:3,kind:'cancel'},rejected)!.message,/not completed.*already ended/);
  const badge=send({type:'social_badge',runId:'social-ui-run',generation:1,sequence:4,actionId:4,display:true});assert.match(socialRequestResult({actionId:4,sequence:4,kind:'badge'},badge)!.message,/display change confirmed.*encoding remain separate/);
});
