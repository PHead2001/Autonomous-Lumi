import type { WorldState } from './protocol.js';
import type { Vector3Tuple } from './physical-scene.js';

export interface EyePose {
  position: Vector3Tuple; direction: Vector3Tuple; up: Vector3Tuple;
  bodyHeading: number; headYaw: number; headPitch: number;
  horizontalFovDegrees: number; verticalFovDegrees: number;
  width: number; height: number; near: number; far: number;
}
/** The same offset drives the avatar body and the head-mounted eye position. */
export function bodyBob(state: WorldState, time = state.time, gait = state.character.gait): number {
  return state.character.moving ? Math.abs(Math.sin(gait)) * 0.045 : Math.sin(time * 2) * 0.015;
}
/** +Z is forward, Y is up, positive yaw turns toward +X, positive pitch looks up. */
export function eyePose(state: WorldState, width = state.head?.camera.width ?? 512, height = state.head?.camera.height ?? 512): EyePose {
  const headYaw = state.head?.yaw ?? 0, headPitch = state.head?.pitch ?? 0;
  const bodyHeading = state.character.heading, heading = bodyHeading + headYaw;
  const horizontalFovDegrees = state.head?.camera.horizontalFovDegrees ?? 80;
  // Eye point local to the head pivot; rotation order is body-Y * head-Y * head-X(-pitch).
  const eyeY = 0.015 * Math.cos(headPitch) + 0.39 * Math.sin(headPitch);
  const eyeZ = -0.015 * Math.sin(headPitch) + 0.39 * Math.cos(headPitch);
  const localX = eyeZ * Math.sin(headYaw), localZ = 0.015 + eyeZ * Math.cos(headYaw);
  return {
    position: [state.character.x + localX * Math.cos(bodyHeading) + localZ * Math.sin(bodyHeading), 2.34 + bodyBob(state) + eyeY, state.character.z - localX * Math.sin(bodyHeading) + localZ * Math.cos(bodyHeading)],
    direction: [Math.sin(heading) * Math.cos(headPitch), Math.sin(headPitch), Math.cos(heading) * Math.cos(headPitch)],
    up: [-Math.sin(heading) * Math.sin(headPitch), Math.cos(headPitch), -Math.cos(heading) * Math.sin(headPitch)],
    bodyHeading, headYaw, headPitch, horizontalFovDegrees,
    verticalFovDegrees: 2 * Math.atan(Math.tan(horizontalFovDegrees * Math.PI / 360) / (width / height)) * 180 / Math.PI,
    width, height, near: state.head?.camera.near ?? 0.05, far: state.head?.camera.far ?? 40,
  };
}
