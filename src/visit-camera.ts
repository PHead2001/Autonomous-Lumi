import * as THREE from 'three';
import {physicalSceneSnapshot} from '../shared/physical-scene';
import {VISITOR_PHYSICAL_PREFIX,VISITOR_HELD_PHYSICAL_ID} from '../shared/visit-protocol';
import type {WorldState} from '../shared/protocol';
import type {VisitLook} from './visit-controls';
import type {VisitorCameraPose} from './visit';

/** Third-person presentation uses the server pose; the boom respects shared solids. */
export function visitorCamera(world:WorldState,actor:VisitorCameraPose,look:VisitLook) {
  const origin=new THREE.Vector3(actor.x,1.75,actor.z),length=3.4;
  const direction=new THREE.Vector3(-Math.sin(look.yaw)*Math.cos(look.pitch),Math.sin(-look.pitch)+.28,-Math.cos(look.yaw)*Math.cos(look.pitch)).normalize();
  let distance=length;
  for(const b of physicalSceneSnapshot(world).boxes){
    if(!b.collides||b.id.startsWith(VISITOR_PHYSICAL_PREFIX)||b.id===VISITOR_HELD_PHYSICAL_ID||b.position[1]+b.size[1]/2<.1)continue;
    const inverse=new THREE.Matrix4().makeRotationY(-b.yaw),start=origin.clone().sub(new THREE.Vector3(...b.position)).applyMatrix4(inverse),ray=new THREE.Ray(start,direction.clone().transformDirection(inverse));
    const half=new THREE.Vector3(...b.size).multiplyScalar(.5).addScalar(.12),hit=ray.intersectBox(new THREE.Box3(half.clone().negate(),half),new THREE.Vector3());
    if(hit)distance=Math.min(distance,Math.max(.18,hit.distanceTo(start)-.12));
  }
  const position=origin.clone().addScaledVector(direction,distance);position.y=Math.max(.3,position.y);
  return {position,target:origin.clone().add(new THREE.Vector3(Math.sin(look.yaw),Math.sin(look.pitch),Math.cos(look.yaw)))};
}
