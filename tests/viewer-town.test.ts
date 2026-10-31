import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {WorldState} from '../shared/protocol.js';
import type {TownWorldView} from '../shared/town-protocol.js';
import {worldActivity,recentWorldTimeline} from '../src/viewer-town.js';
import {CREATOR_FOUNDATION,type VisitWorldView} from '../shared/visit-protocol.js';
import {VisitSimulation} from '../server/simulation.js';

const town=():TownWorldView=>({layoutVersion:'home-shop-v1',doors:{home:false,homeAngle:0,shop:false,shopAngle:0,slam:null},shop:{open:true,available:true,fruitVisible:true,breadVisible:true},heldItem:null,activity:{label:'Walking to shop',status:'started',stage:'outbound',progress:0},timeline:[],firstRetainedSequence:1,droppedCount:0});
const state=():Pick<WorldState,'home'|'town'|'character'|'capability'>=>({character:{x:0,z:0,heading:0,moving:true,gait:0},town:town()});
test('a selected or active trip does not announce a purchase or completed return',()=>{
  const s=state();s.town!.activity.status='selected';assert.match(worldActivity(s).title,/Considering/);assert.doesNotMatch(worldActivity(s).title,/Finished|Purchased/);
  s.town!.activity.status='started';s.town!.activity.stage='purchase';assert.equal(worldActivity(s).title,'At the shop checkout');assert.doesNotMatch(worldActivity(s).title,/Purchased|Finished/);
  s.town!.activity.stage='return';s.town!.heldItem='fruit';assert.equal(worldActivity(s).title,'Returning home');assert.match(worldActivity(s).detail,/not been reported consumed/);
  s.town!.activity.status='completed';s.town!.activity.stage='done';assert.equal(worldActivity(s).title,'Finished shop trip');
});
test('hard sleep and a newer home activity take priority over a past shop result',()=>{
  const s=state();s.capability={awake:false,canAttend:false,canAct:false,reason:'asleep'};assert.equal(worldActivity(s).title,'Sleeping');
  s.capability=undefined;s.town!.activity.status='completed';s.town!.timeline=[{sequence:1,tick:20,actionId:1,type:'completed',label:'Returned home'}];
  s.home={layout:null,posture:{kind:'upright',bedId:null,progress:0},heldItem:null,pantryFoodVisible:true,availability:'ready',activationPolicy:'home-default',activity:{actionId:2,kind:'rest',status:'started',stage:'route',progress:0,label:'Walking to bed'},timeline:[{sequence:1,tick:30,actionId:2,type:'started',label:'Started rest'}],firstRetainedSequence:1,droppedCount:0};
  assert.equal(worldActivity(s).title,'Walking to bed');s.home.activity.status='completed';s.home.activity.stage='done';assert.equal(worldActivity(s).title,'Finished resting');
  s.home.activity={actionId:null,kind:'search',status:'started',stage:null,progress:0,label:'Looking around'};s.town!.activity.status='started';s.town!.activity.stage='outbound';assert.equal(worldActivity(s).title,'Walking to the shop');
});
test('combined public timeline orders independent streams and discloses both retention gaps',()=>{
  const s=state(),t=s.town!;t.timeline=[{sequence:3,tick:30,actionId:10,type:'purchased',label:'Bought fruit'},{sequence:4,tick:40,actionId:10,type:'returned',label:'Returned home'}];t.droppedCount=2;
  const h={timeline:[{sequence:5,tick:35,actionId:99,type:'started' as const,label:'Home action'}],droppedCount:4} as NonNullable<WorldState['home']>;
  const before=structuredClone({h,t}),view=recentWorldTimeline(h,t,45,1,2);
  assert.deepEqual(view.entries.map(e=>e.label),['Returned home','Home action']);assert.match(view.note,/2 of 3/);assert.match(view.note,/4 earlier home events/);assert.match(view.note,/2 earlier neighborhood events/);
  assert.ok(view.entries.every(e=>Object.keys(e).sort().join(',')==='age,label,type'));assert.deepEqual({h,t},before);
});
test('owner timeline reports transactions and movement without inventing a sensed meeting or a parked timeout',()=>{
  const visit:VisitWorldView={actor:null,control:{generation:0,lastSequence:0,status:'parked',expiresTick:0},inventory:[],balance:20,lastActionId:2,feedback:null,foundation:CREATOR_FOUNDATION,droppedCount:3,timeline:[{actionId:1,type:'purchase',outcome:'rejected',reason:'out_of_reach',tick:10},{actionId:2,type:'purchase',outcome:'accepted',reason:'committed',tick:20},{actionId:2,type:'control',outcome:'stopped',reason:'timeout',tick:30}]};
  const view=recentWorldTimeline(undefined,undefined,30,1,8,visit);assert.deepEqual(view.entries.map(e=>e.label),['Owner movement stopped','Owner purchase confirmed','Owner purchase not completed']);assert.match(view.note,/3 earlier owner events/);assert.doesNotMatch(JSON.stringify(view),/creator|recognized|meeting|parked|out_of_reach/i);
});
test('actual repeated collision rejections remain blocked movement rather than fictitious Visit starts',()=>{
  const initial=new VisitSimulation({mode:'EXPERIMENT',runId:'timeline-run'});initial.enqueue({type:'visit_start',runId:'timeline-run',generation:1});initial.step();const cp=initial.checkpoint();cp.pauseUntilTick=100000;cp.home.controller.searchNextTick=100000;cp.visit.control.targetYaw=0;
  const sim=new VisitSimulation({checkpoint:cp,mode:'EXPERIMENT',runId:'timeline-run'});
  for(let sequence=1;sequence<=30&&sim.state.visit!.timeline.filter(f=>f.reason==='movement_blocked').length<3;sequence++){sim.enqueue({type:'visit_control',runId:'timeline-run',generation:1,sequence,forward:0,strafe:1,yaw:0,pitch:0,expiresTick:sim.state.tick+20});sim.step();}
  sim.enqueue({type:'visit_stop',runId:'timeline-run',generation:1,reason:'timeout'});sim.step();
  const snapshot=sim.state.visit!,view=recentWorldTimeline(undefined,undefined,sim.state.tick,1/30,12,snapshot);assert.equal(snapshot.control.generation,1);assert.equal(snapshot.timeline.filter(f=>f.reason==='movement_blocked').length,3);assert.equal(view.entries.filter(e=>e.label==='Owner Visit control started').length,1);assert.equal(view.entries.filter(e=>e.label==='Owner movement blocked').length,3);assert.equal(view.entries[0].label,'Owner movement stopped');
  const rejected=recentWorldTimeline(undefined,undefined,sim.state.tick,1/30,12,{...snapshot,timeline:[{actionId:0,type:'control',outcome:'rejected',reason:'stale_generation',tick:sim.state.tick}]});assert.equal(rejected.entries[0].label,'Owner Visit control rejected');
});
