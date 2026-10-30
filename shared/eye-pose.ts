import { homePoseTransform } from './home-geometry.js';
import type { WorldState } from './protocol.js';
import { physicalSceneSnapshot, type Vector3Tuple } from './physical-scene.js';
import { AVATAR_RIG, cameraNearRadius } from './avatar-rig.js';

export interface EyePose {
  position: Vector3Tuple; direction: Vector3Tuple; up: Vector3Tuple;
  bodyHeading: number; headYaw: number; headPitch: number;
  horizontalFovDegrees: number; verticalFovDegrees: number;
  width: number; height: number; near: number; far: number;
}
/** The same offset drives the avatar body and the head-mounted eye position. */
export function bodyBob(state: WorldState, time = state.time, gait = state.character.gait): number {
  if(state.home&&state.home.posture.kind!=='upright')return 0;
  return state.character.moving ? Math.abs(Math.sin(gait)) * 0.045 : Math.sin(time * 2) * 0.015;
}
/** +Z is forward, Y is up, positive yaw turns toward +X, positive pitch looks up. */
export function eyePose(state: WorldState, width = state.head?.camera.width ?? 512, height = state.head?.camera.height ?? 512): EyePose {
  const headYaw = state.head?.yaw ?? 0, headPitch = state.head?.pitch ?? 0;
  const bodyHeading = state.character.heading, heading = bodyHeading + headYaw;
  const horizontalFovDegrees = state.head?.camera.horizontalFovDegrees ?? 80;
  // Eye point local to the head pivot; rotation order is body-Y * head-Y * head-X(-pitch).
  const eyeY = AVATAR_RIG.eyeOffset[1] * Math.cos(headPitch) + AVATAR_RIG.eyeOffset[2] * Math.sin(headPitch);
  const eyeZ = -AVATAR_RIG.eyeOffset[1] * Math.sin(headPitch) + AVATAR_RIG.eyeOffset[2] * Math.cos(headPitch);
  const localX = eyeZ * Math.sin(headYaw), localZ = AVATAR_RIG.headPivot[2] + eyeZ * Math.cos(headYaw);
  const upright={
    position: [state.character.x + localX * Math.cos(bodyHeading) + localZ * Math.sin(bodyHeading), AVATAR_RIG.headPivot[1] + bodyBob(state) + eyeY, state.character.z - localX * Math.sin(bodyHeading) + localZ * Math.cos(bodyHeading)],
    direction: [Math.sin(heading) * Math.cos(headPitch), Math.sin(headPitch), Math.cos(heading) * Math.cos(headPitch)],
    up: [-Math.sin(heading) * Math.sin(headPitch), Math.cos(headPitch), -Math.cos(heading) * Math.sin(headPitch)],
    bodyHeading, headYaw, headPitch, horizontalFovDegrees,
    verticalFovDegrees: 2 * Math.atan(Math.tan(horizontalFovDegrees * Math.PI / 360) / (width / height)) * 180 / Math.PI,
    width, height, near: state.head?.camera.near ?? 0.05, far: state.head?.camera.far ?? 40,
  };
  if(!state.home||state.home.posture.kind==='upright')return upright as EyePose;
  const pose=homePoseTransform(state);
  const localEye:Vector3Tuple=[localX,AVATAR_RIG.headPivot[1]+eyeY,localZ];
  const direction:Vector3Tuple=[Math.sin(headYaw)*Math.cos(headPitch),Math.sin(headPitch),Math.cos(headYaw)*Math.cos(headPitch)],up:Vector3Tuple=[-Math.sin(headYaw)*Math.sin(headPitch),Math.cos(headPitch),-Math.cos(headYaw)*Math.sin(headPitch)];
  return {...upright,position:pose.transformPoint(localEye),direction:pose.transformVector(direction),up:pose.transformVector(up)} as EyePose;
}
/** Fail closed when an invalid external pose or unusual lens could clip through a wall.
 * The sphere conservatively encloses the eye-to-near-plane volume. Actual snapshot
 * transforms are used, including the door's current slam pose, never its rest pose. */
export function assertCameraClearance(state: WorldState, width?: number, height?: number): void {
  const camera = eyePose(state, width, height), radius = cameraNearRadius({ ...camera, near: camera.near });
  if (![...camera.position, ...camera.direction, ...camera.up, radius].every(Number.isFinite) || radius <= 0) throw new Error('Camera clipping volume is invalid');
  for (const box of physicalSceneSnapshot(state).boxes) {
    if (!box.occludes) continue;
    const dx = camera.position[0] - box.position[0], dz = camera.position[2] - box.position[2];
    const local = [dx * Math.cos(box.yaw) - dz * Math.sin(box.yaw), camera.position[1] - box.position[1], dx * Math.sin(box.yaw) + dz * Math.cos(box.yaw)];
    const distanceSquared = local.reduce((sum, coordinate, axis) => sum + Math.max(0, Math.abs(coordinate) - box.size[axis] / 2) ** 2, 0);
    if (distanceSquared <= radius ** 2) throw new Error('Camera clipping volume intersects opaque physical geometry');
  }
}
