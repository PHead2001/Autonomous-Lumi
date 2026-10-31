import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VisitGrant} from '../src/visit-grant.js';
import {VisitControls} from '../src/visit-controls.js';
import {VisitSimulation} from '../server/simulation.js';
import type {WorldState} from '../shared/protocol.js';

const target={worldId:'lumi',branchId:'visit-ui',runId:'visit-ui-run'};
const simulation=()=>new VisitSimulation({mode:'EXPERIMENT',...target,historyId:'visit-ui-history'});
const snapshot=(sim:VisitSimulation):WorldState=>({...sim.state,branchId:target.branchId,mode:'EXPERIMENT'});
test('a bound channel cannot enable movement until the matching simulation entry actually applies',()=>{
  const sim=simulation(),grant=new VisitGrant(target,1,sim.state.tick),controls=new VisitControls();grant.bind(1);
  assert.equal(grant.inspect(snapshot(sim)).status,'waiting');assert.equal(controls.key('KeyW',true),false);assert.equal(controls.movement(),null);
  sim.enqueue({type:'visit_start',runId:target.runId,generation:1});assert.equal(grant.inspect(snapshot(sim)).status,'waiting');sim.step();
  const confirmed=grant.inspect(snapshot(sim));assert.equal(confirmed.status,'active');if(confirmed.status!=='active')throw new Error('Entry not applied');controls.begin(target,1,confirmed.lastSequence,confirmed.lastActionId,{yaw:confirmed.actor.heading,pitch:confirmed.actor.pitch});assert.equal(controls.key('KeyW',true),true);assert.equal(controls.movement()!.forward,1);
});
test('a real blocked entrance rejects the pending grant instead of leaving a false active UI',()=>{
  const source=simulation().checkpoint();source.character.x=2.97;source.character.z=-6.5;source.pauseUntilTick=100000;source.home.controller.searchNextTick=100000;
  const sim=new VisitSimulation({checkpoint:source,mode:'EXPERIMENT',...target}),grant=new VisitGrant(target,1,sim.state.tick);grant.bind(1);sim.enqueue({type:'visit_start',runId:target.runId,generation:1});sim.step();
  assert.equal(sim.visitState().actor,null);assert.equal(sim.visitState().feedback?.reason,'entrance_blocked');const result=grant.inspect(snapshot(sim));assert.equal(result.status,'rejected');if(result.status==='rejected')assert.match(result.message,/entrance is blocked.*Retry/i);
});
test('an unapplied paused experiment stays unconfirmed and gives an honest bounded retry result',()=>{
  const sim=simulation(),grant=new VisitGrant(target,1,sim.state.tick);grant.bind(1);sim.enqueue({type:'visit_start',runId:target.runId,generation:1});
  assert.equal(grant.inspect(snapshot(sim)).status,'waiting');const expired=grant.timeout(snapshot(sim));assert.equal(expired.status,'rejected');if(expired.status==='rejected'){assert.match(expired.message,/unconfirmed.*has not advanced.*paused/i);assert.doesNotMatch(expired.message,/entrance is blocked/i);}
  assert.equal(sim.visitState().actor,null);
});
test('an applied avatar still waits for the right channel and rejects run or generation replacement',()=>{
  const sim=simulation(),grant=new VisitGrant(target,1,0);sim.enqueue({type:'visit_start',runId:target.runId,generation:1});sim.step();assert.equal(grant.inspect(snapshot(sim)).status,'waiting');assert.throws(()=>grant.bind(2));grant.bind(1);assert.equal(grant.inspect(snapshot(sim)).status,'active');
  assert.equal(grant.inspect({...snapshot(sim),runId:'different-run'}).status,'rejected');sim.enqueue({type:'visit_stop',runId:target.runId,generation:1,reason:'observe'});sim.step();assert.equal(grant.inspect(snapshot(sim)).status,'rejected');
});
