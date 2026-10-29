import type { WorldState } from '../../shared/protocol.js';
import type { SampleVisibilityBand } from '../../shared/capture-protocol.js';
import { assertCameraClearance, eyePose, type EyePose } from '../../shared/eye-pose.js';
import { physicalSceneSnapshot, type PhysicalBox, type Vector3Tuple } from '../../shared/physical-scene.js';

export type VisibilityStatus = 'visible' | 'partially_occluded' | 'fully_occluded' | 'outside_frustum' | 'poor_observability';
export interface GroundingObject {
  id: string; status: VisibilityStatus; eligible: boolean;
  totalSamples: number; inFrustumSamples: number; visibleSamples: number;
  /** Fraction of the declared sample rays, not a visible-pixel or recognition probability. */
  sampleVisibilityFraction: number; projectedPixels: number; qualityFlags: string[];
  bearingRadians: number; elevationRadians: number; distance: number;
}
export interface GroundingResult {
  sceneRevision: string; dynamicRevision: number; camera: EyePose; objects: GroundingObject[];
}
export interface VisibleGrounding {
  handle: string; identity: 'unknown'; bearingDegrees: number; elevationDegrees: number;
  distanceBand: 'near' | 'room' | 'far'; sampleVisibilityBand: SampleVisibilityBand;
  qualityFlags: string[]; uncertainty: 'geometric_samples_only';
}
const dot = (a: Vector3Tuple, b: Vector3Tuple) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
function samples(box: PhysicalBox): Vector3Tuple[] {
  const points: Vector3Tuple[] = [];
  // 27 box samples include the center and all faces/corners. Center-only occlusion is insufficient.
  for (const x of [-0.49, 0, 0.49]) for (const y of [-0.49, 0, 0.49]) for (const z of [-0.49, 0, 0.49]) {
    const dx = x * box.size[0], dz = z * box.size[2];
    points.push([box.position[0] + dx * Math.cos(box.yaw) + dz * Math.sin(box.yaw), box.position[1] + y * box.size[1], box.position[2] - dx * Math.sin(box.yaw) + dz * Math.cos(box.yaw)]);
  }
  return points;
}
/** Distance to an opaque oriented box along a finite segment, or null if there is no hit. */
export function rayBoxDistance(origin: Vector3Tuple, direction: Vector3Tuple, box: PhysicalBox, maximum: number): number | null {
  const p = subtract(origin, box.position), c = Math.cos(box.yaw), s = Math.sin(box.yaw);
  const localOrigin = [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
  const localDirection = [direction[0] * c - direction[2] * s, direction[1], direction[0] * s + direction[2] * c];
  let enter = 0, exit = maximum;
  for (let axis = 0; axis < 3; axis++) {
    const half = box.size[axis] / 2;
    if (Math.abs(localDirection[axis]) < 1e-10) { if (Math.abs(localOrigin[axis]) > half) return null; continue; }
    const a = (-half - localOrigin[axis]) / localDirection[axis], b = (half - localOrigin[axis]) / localDirection[axis];
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return null;
  }
  return enter <= maximum ? enter : null;
}
function inFrustum(point: Vector3Tuple, camera: EyePose): boolean {
  const v = subtract(point, camera.position), depth = dot(v, camera.direction);
  if (depth < camera.near || depth > camera.far) return false;
  const heading = camera.bodyHeading + camera.headYaw;
  const right: Vector3Tuple = [-Math.cos(heading), 0, Math.sin(heading)];
  return Math.abs(dot(v, right)) <= depth * Math.tan(camera.horizontalFovDegrees * Math.PI / 360) && Math.abs(dot(v, camera.up)) <= depth * Math.tan(camera.verticalFovDegrees * Math.PI / 360);
}
/** Private measurement from exactly the snapshot used by the image renderer. No attention or semantics. */
export function groundSnapshot(state: WorldState, width?: number, height?: number): GroundingResult {
  assertCameraClearance(state, width, height);
  const scene = physicalSceneSnapshot(state), camera = eyePose(state, width, height);
  const objects = scene.boxes.filter(b => b.observable).map((box): GroundingObject => {
    const points = samples(box), view = points.filter(p => inFrustum(p, camera));
    let visibleSamples = 0;
    for (const p of view) {
      const delta = subtract(p, camera.position), distance = Math.hypot(...delta);
      const direction = delta.map(v => v / distance) as Vector3Tuple;
      if (!scene.boxes.some(obstacle => obstacle.occludes && obstacle.id !== box.id && rayBoxDistance(camera.position, direction, obstacle, distance - 1e-5) !== null)) visibleSamples++;
    }
    const delta = subtract(box.position, camera.position), distance = Math.hypot(...delta);
    const projectedPixels = Math.max(box.size[0], box.size[1], box.size[2]) / Math.max(distance, camera.near) * heightOrDefault(camera) / (2 * Math.tan(camera.verticalFovDegrees * Math.PI / 360));
    const qualityFlags: string[] = [];
    // This is a deliberately conservative illumination proxy tied to actual rendered light intensity.
    // It makes no semantic recognition claim and is not a calibrated retinal model or luminance meter.
    if (scene.illumination < 0.08) qualityFlags.push('low_light');
    if (projectedPixels < 8) qualityFlags.push('small_projected_size');
    if (view.length < points.length) qualityFlags.push('frustum_clipped');
    if (visibleSamples && visibleSamples < view.length) qualityFlags.push('partial_sample_visibility');
    const status: VisibilityStatus = !view.length ? 'outside_frustum' : !visibleSamples ? 'fully_occluded' : qualityFlags.includes('low_light') || qualityFlags.includes('small_projected_size') ? 'poor_observability' : visibleSamples < view.length ? 'partially_occluded' : 'visible';
    return { id: box.id, status, eligible: status === 'visible' || status === 'partially_occluded', totalSamples: points.length, inFrustumSamples: view.length, visibleSamples, sampleVisibilityFraction: visibleSamples / points.length, projectedPixels, qualityFlags,
      bearingRadians: wrap(Math.atan2(delta[0], delta[2]) - camera.bodyHeading - camera.headYaw), elevationRadians: Math.atan2(delta[1], Math.hypot(delta[0], delta[2])) - camera.headPitch, distance };
  });
  return { sceneRevision: scene.revision, dynamicRevision: scene.dynamicRevision, camera, objects };
}
const heightOrDefault = (camera: EyePose) => camera.height;
/** The sole filtered spatial payload: no private IDs, names, types, positions or fully hidden entries. */
export function filterVisibleGrounding(result: GroundingResult, handleFor: (privateId: string) => string): VisibleGrounding[] {
  return result.objects.filter(o => o.eligible).map(o => ({ handle: handleFor(o.id), identity: 'unknown', bearingDegrees: Math.round(o.bearingRadians * 180 / Math.PI / 15) * 15, elevationDegrees: Math.round(o.elevationRadians * 180 / Math.PI / 15) * 15, distanceBand: o.distance < 2 ? 'near' : o.distance < 6 ? 'room' : 'far', sampleVisibilityBand: o.sampleVisibilityFraction <= 1/3 ? 'low' : o.sampleVisibilityFraction <= 2/3 ? 'medium' : 'high', qualityFlags: [...o.qualityFlags], uncertainty: 'geometric_samples_only' }));
}
export function isTargetEligible(state: WorldState, privateId: string, width?:number, height?:number): boolean {
  try { return groundSnapshot(state,width,height).objects.some(o => o.id === privateId && o.eligible); }
  catch { return false; }
}
