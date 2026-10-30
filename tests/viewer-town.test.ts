import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {WorldState} from '../shared/protocol.js';
import type {TownWorldView} from '../shared/town-protocol.js';
import {worldActivity,recentWorldTimeline} from '../src/viewer-town.js';

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
