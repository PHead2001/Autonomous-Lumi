import type { WorldState } from './protocol.js';

/** Physical room coordinates: Y up, +Z forward. Cutaways are a renderer choice. */
export const PHYSICAL_SCENE_VERSION = 'lumi-room-v1';
export const RENDER_REVISION = 'three-room-v1';
export const PHYSICAL_ROOM = { width: 9, depth: 7, walkX: 3.2, walkZ: 2.3 } as const;
export type Vector3Tuple = [number, number, number];
export interface PhysicalSceneState {
  revision: number;
  illumination: number;
  fixture: 'none' | 'visibility';
  fixtureColor: string;
  doorOpenRadians: number | null;
}
export type SceneConfiguration = Omit<PhysicalSceneState, 'revision'>;
export interface PhysicalBox {
  /** Engine identities are private measurement keys, never perceived identities. */
  id: string;
  size: Vector3Tuple;
  position: Vector3Tuple;
  yaw: number;
  color: string;
  occludes: boolean;
  collides: boolean;
  observable: boolean;
  cutaway: boolean;
}
export interface PhysicalSceneSnapshot {
  revision: typeof PHYSICAL_SCENE_VERSION;
  dynamicRevision: number;
  illumination: number;
  boxes: PhysicalBox[];
}
export function defaultPhysicalSceneState(): PhysicalSceneState {
  return { revision: 0, illumination: 1, fixture: 'none', fixtureColor: '#ed6050', doorOpenRadians: null };
}
const exact = (raw: unknown, keys: string[]) => !!raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).sort().join(',') === keys.sort().join(',');
export function validateSceneConfiguration(raw: unknown): SceneConfiguration {
  if (!exact(raw, ['illumination', 'fixture', 'fixtureColor', 'doorOpenRadians'])) throw new Error('Invalid physical scene configuration fields');
  const s = raw as SceneConfiguration;
  if (typeof s.illumination !== 'number' || !Number.isFinite(s.illumination) || s.illumination < 0 || s.illumination > 1 || !['none', 'visibility'].includes(s.fixture) || typeof s.fixtureColor !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(s.fixtureColor) || (s.doorOpenRadians !== null && (typeof s.doorOpenRadians !== 'number' || !Number.isFinite(s.doorOpenRadians) || Math.abs(s.doorOpenRadians) > Math.PI / 2))) throw new Error('Invalid physical scene configuration');
  return structuredClone(s);
}
export function validatePhysicalSceneState(raw: unknown): PhysicalSceneState {
  if (!exact(raw, ['revision', 'illumination', 'fixture', 'fixtureColor', 'doorOpenRadians'])) throw new Error('Invalid physical scene state fields');
  const { revision, ...configuration } = raw as PhysicalSceneState;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid physical scene revision');
  return { revision, ...validateSceneConfiguration(configuration) };
}
export function doorAngle(state: WorldState, time = state.time): number {
  const override = state.scene?.doorOpenRadians;
  if (override !== undefined && override !== null) return override;
  const age = time - state.door.lastSlam;
  return age >= 0 && age < 0.4 ? -0.5 * Math.exp(-age * 10) * Math.cos(age * 20) : 0;
}
/** Every visible environment mesh and every visibility/collision box comes from here. */
export function physicalSceneSnapshot(state: WorldState, time = state.time): PhysicalSceneSnapshot {
  const s = state.scene ?? defaultPhysicalSceneState();
  const boxes: PhysicalBox[] = [];
  const box = (id: string, size: Vector3Tuple, position: Vector3Tuple, color: string, options: Partial<Pick<PhysicalBox, 'yaw' | 'occludes' | 'collides' | 'observable' | 'cutaway'>> = {}) => boxes.push({ id, size, position, color, yaw: 0, occludes: true, collides: true, observable: false, cutaway: false, ...options });
  box('floor', [9.4, 0.25, 7.4], [0, -0.18, 0], '#b18c68');
  for (let i = 0; i < 17; i++) {
    const x = -4.3 + i * 0.55;
    box(`floorboard-${i}`, [0.52, 0.035, 7], [x, -0.035, 0], Math.round(x * 10) % 2 ? '#d7b795' : '#cfae8a', { collides: false });
  }
  // The doorway is an actual opening. There is no decorative opaque backing plate.
  box('wall-back-left', [6.65, 3.65, 0.16], [-1.275, 1.7, -3.6], '#aac0af');
  box('wall-back-right', [0.71, 3.65, 0.16], [4.245, 1.7, -3.6], '#aac0af');
  box('wall-back-lintel', [1.84, 0.725, 0.16], [2.97, 3.1625, -3.6], '#aac0af');
  box('wall-left', [0.16, 3.65, 7.2], [-4.6, 1.7, 0], '#c3cdb7');
  box('wall-right', [0.16, 3.65, 7.2], [4.6, 1.7, 0], '#c3cdb7', { cutaway: true });
  box('wall-front', [9.2, 3.65, 0.16], [0, 1.7, 3.6], '#aac0af', { cutaway: true });
  box('skirting-back', [9.2, 0.13, 0.18], [0, 0.05, -3.47], '#e7dfc8');
  box('skirting-left', [0.18, 0.13, 7.1], [-4.47, 0.05, 0], '#e7dfc8');
  box('rug-border', [4.1, 0.025, 3.3], [-0.3, 0, 0.3], '#729a92', { collides: false });
  box('rug', [3.8, 0.03, 3], [-0.3, 0.005, 0.3], '#83aaa0', { collides: false });
  for (const [i, x] of [-2.15, 1.55].entries()) box(`rug-stripe-${i}`, [0.035, 0.035, 3], [x, 0.012, 0.3], '#e4d7b6', { collides: false });
  box('door-frame-left', [0.11, 2.9, 0.21], [1.995, 1.45, -3.48], '#42645e');
  box('door-frame-right', [0.11, 2.9, 0.21], [3.945, 1.45, -3.48], '#42645e');
  box('door-frame-top', [2.06, 0.11, 0.21], [2.97, 2.85, -3.48], '#42645e');
  const yaw = doorAngle(state, time), hinge: Vector3Tuple = [2.05, 0, -3.53];
  const doorPart = (id: string, size: Vector3Tuple, p: Vector3Tuple, color: string, observable = false) => {
    const x = p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw), z = -p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw);
    box(id, size, [hinge[0] + x, p[1], hinge[2] + z], color, { yaw, observable });
  };
  doorPart('door-leaf', [1.84, 2.8, 0.12], [0.92, 1.4, 0], '#b86d4b', true);
  doorPart('door-panel', [1.46, 1.8, 0.04], [0.92, 1.55, 0.09], '#c98660');
  doorPart('door-knob', [0.13, 0.13, 0.18], [1.6, 1.25, 0.16], '#eac58a');
  // The Phase 1 window is painted opaque decoration on a solid wall, not an opening.
  box('painted-window-frame', [0.06, 1.9, 2.4], [-4.47, 2.1, -0.7], '#efe5cf');
  box('painted-window-pane', [0.07, 1.65, 2.15], [-4.42, 2.1, -0.7], '#a8d6d2', { observable: true });
  box('painted-window-cross-a', [0.09, 0.07, 2.15], [-4.36, 2.1, -0.7], '#efe5cf');
  box('painted-window-cross-b', [0.09, 1.65, 0.07], [-4.36, 2.1, -0.7], '#efe5cf');
  if (s.fixture === 'visibility') {
    box('fixture-ahead', [0.65, 0.75, 0.5], [-1.1, 2.4, 1.2], s.fixtureColor, { observable: true });
    box('fixture-partial', [1.0, 0.85, 0.5], [1.35, 2.4, 1.4], '#e0af3f', { observable: true });
    box('fixture-screen', [0.32, 1.4, 0.16], [0.83, 2.2, 0.2], '#536d83');
    box('fixture-behind-wall', [0.7, 0.8, 0.5], [0, 2.4, 4.4], '#d53fca', { observable: true });
    box('fixture-outside-fov', [0.5, 0.7, 0.5], [3.8, 2.4, -1.5], '#416de3', { observable: true });
    box('fixture-small', [0.025, 0.025, 0.025], [0.1, 2.4, 2.8], '#e4ebeb', { observable: true });
    // A second target beyond the actual doorway establishes open/shut door geometry.
    box('fixture-beyond-door', [0.6, 0.65, 0.5], [2.97, 1.9, -4.3], '#b23bce', { observable: true });
  }
  return { revision: PHYSICAL_SCENE_VERSION, dynamicRevision: s.revision, illumination: s.illumination, boxes };
}
/** Server navigation uses these same colliders; decorations below the feet are ignored. */
export function canOccupyCharacter(scene: PhysicalSceneState, x: number, z: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > PHYSICAL_ROOM.walkX || Math.abs(z) > PHYSICAL_ROOM.walkZ) return false;
  const state = { scene, time: 0, door: { lastSlam: -100, slamCount: 0 } } as WorldState;
  const radius = 0.22;
  return !physicalSceneSnapshot(state).boxes.some(b => {
    if (!b.collides || b.position[1] + b.size[1] / 2 <= 0.06 || b.position[1] - b.size[1] / 2 >= 3.45) return false;
    const dx = x - b.position[0], dz = z - b.position[2];
    const localX = dx * Math.cos(b.yaw) - dz * Math.sin(b.yaw), localZ = dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw);
    return Math.abs(localX) < b.size[0] / 2 + radius && Math.abs(localZ) < b.size[2] / 2 + radius;
  });
}
