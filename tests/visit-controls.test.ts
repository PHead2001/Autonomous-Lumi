import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VisitControls} from '../src/visit-controls.js';
import {validateVisitCommand} from '../shared/visit-protocol.js';
const target={worldId:'test-world',branchId:'test-visit',runId:'test-run'};
test('Observe has no movement authority; Visit sends bounded scoped intentions rather than world state',()=>{
  const c=new VisitControls();assert.equal(c.movement(),null);assert.equal(c.key('KeyW',true),false);
  c.begin(target,3,40,9,{yaw:0,pitch:0});c.key('KeyW',true);c.key('KeyD',true);const intent=c.movement()!;
  assert.equal(intent.sequence,41);assert.equal(intent.generation,3);assert.equal(intent.branchId,target.branchId);assert.equal(Math.hypot(intent.forward,intent.strafe),1);assert.deepEqual(Object.keys(intent).sort(),['branchId','forward','generation','pitch','runId','sequence','strafe','type','worldId','yaw'].sort());
  const action=c.interaction({action:'purchase',good:'fruit',door:null})!;assert.equal(action.sequence,42);assert.equal(action.actionId,10);
});
test('blur/end clears held movement and old run/generation cannot silently match a new scope',()=>{
  const c=new VisitControls();c.begin(target,2,0,0,{yaw:0,pitch:0});c.key('KeyW',true);assert.equal(c.clear()!.forward,0);c.key('KeyW',true);assert.equal(c.end()!.forward,0);assert.equal(c.movement(),null);assert.equal(c.interaction({action:'door',door:'home',good:null}),null);
  c.begin({...target,runId:'next-run'},4,0,0,{yaw:0,pitch:0});assert.equal(c.matches(target),false);assert.equal(c.matches({...target,runId:'next-run'},2),false);assert.equal(c.matches({...target,runId:'next-run'},4),true);assert.equal(c.movement()!.forward,0);
});
test('look remains finite and bounded, and reconnect begins with no retained keys',()=>{
  const c=new VisitControls();assert.throws(()=>c.begin(target,0,0,0,{yaw:0,pitch:0}));c.begin(target,1,0,0,{yaw:0,pitch:0});c.turn(100000,100000);const move=c.movement()!;assert.ok(Math.abs(move.yaw)<=Math.PI);assert.ok(Math.abs(move.pitch)<=.9);
  assert.doesNotThrow(()=>validateVisitCommand({type:'visit_control',runId:move.runId,generation:move.generation,sequence:move.sequence,forward:move.forward,strafe:move.strafe,yaw:move.yaw,pitch:move.pitch,expiresTick:30}));
  c.key('KeyW',true);c.begin(target,2,move.sequence,0,{yaw:1,pitch:.2});assert.equal(c.movement()!.forward,0);assert.equal(c.cameraLook.yaw,1);
});
test('takeover interactions advance beyond authoritative actions committed after the grant response',()=>{
  const c=new VisitControls();c.begin(target,2,0,4,{yaw:0,pitch:0});assert.equal(c.interaction({action:'purchase',door:null,good:'fruit'},7)!.actionId,8);assert.equal(c.interaction({action:'purchase',door:null,good:'bread'},7)!.actionId,9);
});
