import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visitorCamera} from '../src/visit-camera.js';
import {physicalPresentationVisible} from '../src/render-scene.js';
import type {WorldState} from '../shared/protocol.js';
const world:WorldState={worldId:'camera-test',runId:'camera-run',tick:0,time:0,character:{x:1,z:1,heading:0,moving:false,gait:0},reflex:{start:-100,strength:0,duration:.8},door:{lastSlam:-100,slamCount:0}};
test('Visit eye stays exactly at authoritative owner position even beside walls; look has normalized admitted yaw/pitch',()=>{
  for(const x of [-3.8,0,3.8])for(const z of [-3.2,0,3.2])for(const yaw of [-Math.PI,0,1.4])for(const pitch of [-.9,0,.9]){
    const actor={x,z,heading:yaw,pitch},view=visitorCamera(world,actor,{yaw,pitch}),direction=view.target.clone().sub(view.position);
    assert.deepEqual(view.position.toArray(),[x,1.9,z]);assert.ok(Math.abs(direction.length()-1)<1e-12);
    assert.ok(Math.abs(direction.x-Math.sin(yaw)*Math.cos(pitch))<1e-12);assert.ok(Math.abs(direction.y-Math.sin(pitch))<1e-12);assert.ok(Math.abs(direction.z-Math.cos(yaw)*Math.cos(pitch))<1e-12);
    assert.deepEqual(actor,{x,z,heading:yaw,pitch},'presentation cannot move the authoritative avatar');
  }
});
test('local controlled owner hides only self cues, restores Observe, and cannot affect sensor visibility',()=>{
  const self=['visit-owner-head','visit-owner-right-hand','visit-held-item','social-offer-cue','social-offer-cue-tile-0','social-badge-cue','social-badge-cue-tile-3'];
  for(const id of self){assert.equal(physicalPresentationVisible(id,false,false,true),false);assert.equal(physicalPresentationVisible(id,false,false),true);assert.equal(physicalPresentationVisible(id,false,true),true);assert.equal(physicalPresentationVisible(id,false,true,true),true,'sensor role wins even if local presentation is requested');}
  for(const id of ['room-wall','town-shop-wall','home-food-fruit']){
    assert.equal(physicalPresentationVisible(id,true,false,true),true,'Visit keeps solid spectator cutaways');
  }
  assert.equal(physicalPresentationVisible('room-wall',true,false),false,'Observe retains its normal cutaway');
  assert.equal(physicalPresentationVisible('room-wall',true,true),true);
});
