import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visitorCamera} from '../src/visit-camera.js';
import type {WorldState} from '../shared/protocol.js';
const world:WorldState={worldId:'camera-test',runId:'camera-run',tick:0,time:0,character:{x:1,z:1,heading:0,moving:false,gait:0},reflex:{start:-100,strength:0,duration:.8},door:{lastSlam:-100,slamCount:0}};
test('third-person boom shortens before a shared solid wall rather than showing its outside',()=>{
  const a={x:0,z:-2.8,heading:0,pitch:0},view=visitorCamera(world,a,{yaw:0,pitch:0});
  assert.ok(view.position.z>-3.5);assert.ok(view.position.z<a.z);assert.ok(view.target.z>a.z);assert.ok(view.position.distanceTo(view.target)<3.4);
});
test('Visit camera remains finite and above the floor at extreme admitted look pitches',()=>{
  for(const pitch of [-.9,.9]){const view=visitorCamera(world,{x:0,z:0,heading:0,pitch},{yaw:Math.PI,pitch});assert.ok(view.position.y>=.3);assert.ok(view.position.toArray().every(Number.isFinite));assert.ok(view.target.toArray().every(Number.isFinite));}
});
