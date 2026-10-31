import * as THREE from 'three';
import type {WorldState} from '../shared/protocol';
import type {VisitLook} from './visit-controls';
import type {VisitorCameraPose} from './visit';

/** Local owner-eye presentation; neither moves the avatar nor changes Lumi's sensor. */
export function visitorCamera(_world:WorldState,actor:VisitorCameraPose,look:VisitLook) {
  const position=new THREE.Vector3(actor.x,1.9,actor.z);
  const direction=new THREE.Vector3(Math.sin(look.yaw)*Math.cos(look.pitch),Math.sin(look.pitch),Math.cos(look.yaw)*Math.cos(look.pitch)).normalize();
  return {position,target:position.clone().add(direction)};
}
