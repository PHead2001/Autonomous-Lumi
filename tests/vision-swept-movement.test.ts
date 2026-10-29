import test from 'node:test';
import assert from 'node:assert/strict';
import { SensorySimulation, VisionSimulation } from '../server/simulation.js';
import { canMoveCharacter,canSweepCharacter,defaultPhysicalSceneState,physicalSceneSnapshot } from '../shared/physical-scene.js';
import { CHARACTER_CLEARANCE_RADIUS } from '../shared/avatar-rig.js';

test('reported hz1/speed5 fixture step cannot tunnel through fixture-partial under current rules',()=>{
  const old=new VisionSimulation({mode:'EXPERIMENT'}).checkpoint();old.config.hz=1;old.config.speed=5;old.scene.fixture='visibility';
  old.character={x:2.6,z:2.3,heading:0,moving:true,gait:0};old.waypoint=0;old.pauseUntilTick=0;
  const historical=new VisionSimulation({mode:'EXPERIMENT',checkpoint:old,historical:true});
  const active=new SensorySimulation({mode:'EXPERIMENT',checkpoint:old});
  assert.equal(historical.step().some(e=>e.type==='MOVEMENT_BLOCKED'),false);
  assert.ok(Math.abs(historical.snapshot().character.x-(-1.511))<.002);assert.ok(Math.abs(historical.snapshot().character.z-(-.546))<.002);
  assert.ok(active.step().some(e=>e.type==='MOVEMENT_BLOCKED'));assert.equal(active.snapshot().character.x,2.6);assert.equal(active.snapshot().character.z,2.3);
});

test('swept collision permits unobstructed long steps, exact tangency, and monotonic migrated escape',()=>{
  const scene=defaultPhysicalSceneState();
  assert.equal(canSweepCharacter(scene,-3,-1,2,-1),true);
  assert.equal(canSweepCharacter(scene,3.2,-2.3,3.2,-2.29),true);
  assert.equal(canSweepCharacter(scene,3.2,-2.3,3.2,-2.31),false);
  scene.fixture='visibility';
  const box=physicalSceneSnapshot({scene,time:0,door:{lastSlam:-100,slamCount:0}} as never).boxes.find(b=>b.id==='fixture-partial')!;
  const z=box.position[2]+box.size[2]/2+CHARACTER_CLEARANCE_RADIUS;
  assert.equal(canSweepCharacter(scene,.2,z,2.6,z),true,'touching boundary is not penetration');
  assert.equal(canMoveCharacter(scene,.2,z-.05,2.6,z-.05),true,'historical endpoints are free');
  assert.equal(canSweepCharacter(scene,.2,z-.05,2.6,z-.05),false,'interior segment crosses the expanded obstacle');
});
