import { defaultHeadState, type EyeCamera } from './vision-protocol.js';

/** Shared by the articulated mesh, deterministic camera and navigation clearance. */
export const AVATAR_RIG = {
  headPivot: [0, 2.34, 0.015],
  eyeOffset: [0, 0.015, 0.39],
} as const;

/** Encloses the near clipping plane for this camera, including non-square frames. */
export function cameraNearRadius(camera: Pick<EyeCamera, 'horizontalFovDegrees' | 'width' | 'height' | 'near'>): number {
  const horizontal = Math.tan(camera.horizontalFovDegrees * Math.PI / 360);
  const vertical = horizontal * camera.height / camera.width;
  return camera.near * Math.hypot(1, horizontal, vertical);
}

// Reserve every possible head rotation rather than only the current eye direction.
// The baseline near-plane corner radius and a small skin leave the default camera
// clear as well as its origin. Unusual restored camera settings are checked again
// against their actual clipping volume before a visual observation is admitted.
export const CHARACTER_CLEARANCE_RADIUS = Math.hypot(AVATAR_RIG.headPivot[0], AVATAR_RIG.headPivot[2])
  + Math.hypot(...AVATAR_RIG.eyeOffset) + cameraNearRadius(defaultHeadState().camera) + 0.015;
