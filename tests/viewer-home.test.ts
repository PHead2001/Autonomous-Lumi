import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homePresentation, recentHomeTimeline, physiologyStatus } from '../src/viewer-home.js';
import type { HomeWorldView } from '../shared/home-protocol.js';
const home=():HomeWorldView=>({layout:null,posture:{kind:'upright',bedId:null,progress:0},heldItem:null,pantryFoodVisible:false,activity:{actionId:1,kind:'eat',status:'selected',stage:'route',progress:0,label:'Getting food'},timeline:[],firstRetainedSequence:1,droppedCount:0,availability:'ready',activationPolicy:'home-default'});
test('public presentation distinguishes intention, execution, failure and confirmed meal completion',()=>{
  const h=home();assert.match(homePresentation(h,undefined,false).title,/Planning/);
  h.activity.status='started';h.activity.stage='eat';assert.equal(homePresentation(h,undefined,false).title,'Eating');assert.doesNotMatch(homePresentation(h,undefined,false).title,/Finished/);
  h.activity.status='failed';assert.doesNotMatch(homePresentation(h,undefined,false).title,/Finished/);
  h.activity.status='completed';h.activity.stage='done';assert.equal(homePresentation(h,undefined,false).title,'Finished eating');
});
test('hard sleep presentation never claims a bed transition that did not occur',()=>{
  const h=home(),capability={awake:false,canAttend:false,canAct:false,reason:'asleep' as const};assert.match(homePresentation(h,capability,false).detail,/where she stopped/);
  h.posture.kind='reclined';assert.equal(homePresentation(h,capability,false).detail,'Resting in bed.');
});
test('timeline replaces from public snapshot, bounds recent rows and discloses omitted history without exposing identities',()=>{
  const h=home();h.droppedCount=5;h.firstRetainedSequence=6;h.timeline=Array.from({length:12},(_,i)=>({sequence:i+6,tick:i+1,actionId:42,type:'started' as const,label:`Public activity ${i}`}));
  const before=structuredClone(h),view=recentHomeTimeline(h,20,1);assert.equal(view.entries.length,8);assert.equal(view.entries[0].label,'Public activity 11');assert.match(view.note,/5 earlier/);assert.deepEqual(h,before);assert.ok(view.entries.every(e=>Object.keys(e).sort().join(',')==='age,label,type'));
  assert.equal(recentHomeTimeline({...h,timeline:[],droppedCount:0},0,1).entries.length,0);
});

test('unbounded route and sleep stages do not invent a percentage-complete claim',()=>{
 const h=home();h.activity.status='started';h.activity.progress=1;assert.doesNotMatch(homePresentation(h,undefined,true).detail,/%/);h.activity.kind='rest';h.activity.stage='sleep';assert.doesNotMatch(homePresentation(h,undefined,false).detail,/%/);
});

test('a blocked nonupright bed transition reports a held pose rather than walking',()=>{
 const h=home();h.activity.kind='rest';h.activity.status='failed';h.activity.stage='exit';h.activity.label='Path blocked';h.posture={kind:'exiting',bedId:'bed',progress:.4};
 const view=homePresentation(h,{awake:true,canAttend:true,canAct:true,reason:'available'},true);assert.equal(view.title,'Bed transition blocked');assert.match(view.detail,/Holding the last safe pose/);assert.doesNotMatch(view.title,/Walking|wandering/);
 h.activity.status='interrupted';assert.equal(homePresentation(h,undefined,true).title,'Bed transition paused');
});

test('physiology badge distinguishes current disable/layout policy from historical staged inactivity',()=>{
 const h=home();h.activationPolicy='owner-disabled';assert.equal(physiologyStatus(false,h,undefined),'Inactive - owner disabled');
 h.activationPolicy='home-default';h.availability='layout-unavailable';assert.equal(physiologyStatus(false,h,undefined),'Inactive - no safe home layout');
 h.availability='ready';assert.equal(physiologyStatus(false,h,undefined),'Inactive - home engine');assert.equal(physiologyStatus(false,undefined,undefined),'Inactive - legacy staged world');assert.equal(physiologyStatus(undefined,undefined,undefined),'Unavailable - no body state');
 assert.equal(physiologyStatus(true,h,{awake:false,canAct:false,canAttend:false,reason:'asleep'}),'Active - asleep');
});
