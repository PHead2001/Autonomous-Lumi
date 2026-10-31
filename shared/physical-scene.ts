import { townFixtureBoxes } from './town-geometry.js';
import { homeFixtureBoxes } from './home-geometry.js';
import type { WorldState } from './protocol.js';
import { CHARACTER_CLEARANCE_RADIUS } from './avatar-rig.js';

/** Physical room coordinates: Y up, +Z forward. Cutaways are a renderer choice. */
export const PHYSICAL_SCENE_VERSION = 'lumi-room-v1';
export const RENDER_REVISION = 'three-room-pixel-evidence-v2';
export const PHYSICAL_ROOM = { width: 9, depth: 7, walkX: 3.2, walkZ: 2.3 } as const;
const DOOR_SWING_AMPLITUDE = 0.5;
const DOOR_HINGE: Vector3Tuple = [2.05, 0, -3.53];
const DOOR_PARTS: { id: string; size: Vector3Tuple; position: Vector3Tuple; color: string; observable?: boolean }[] = [
  { id: 'door-leaf', size: [1.84, 2.8, 0.12], position: [0.92, 1.4, 0], color: '#b86d4b', observable: true },
  { id: 'door-panel', size: [1.46, 1.8, 0.04], position: [0.92, 1.55, 0.09], color: '#c98660' },
  { id: 'door-knob', size: [0.13, 0.13, 0.18], position: [1.6, 1.25, 0.16], color: '#eac58a' },
];
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
  revision: typeof PHYSICAL_SCENE_VERSION | 'lumi-town-scene-v1';
  dynamicRevision: number;
  illumination: number;
  boxes: PhysicalBox[];
}
/** Deliberate acoustic surfaces: decorative panels, trim, cutaway flags and navigation
 * clearance volumes never create extra acoustic walls. Door pose is the shared real leaf. */
export function acousticBarriers(state:WorldState):{box:PhysicalBox;material:'wall'|'door'|'object';group:string}[] {
  return physicalSceneSnapshot(state).boxes.flatMap<{box:PhysicalBox;material:'wall'|'door'|'object';group:string}>(box=>box.id.startsWith('wall-')?[{box,material:'wall',group:box.id.startsWith('wall-back-')?'wall-back':box.id}]:(box.id==='door-leaf'||box.id==='town-shop-door')?[{box,material:'door',group:box.id==='door-leaf'?'door':box.id}]:box.id==='fixture-screen'?[{box,material:'object',group:'fixture-screen'}]:[]);
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
  if(state.town){const d=state.town.doors,age=d.slam?time-d.slam.startTime:-1;return d.homeAngle+(age>=0&&age<.4?d.slam!.sign*.5*Math.exp(-age*10)*Math.cos(age*20):0);}
  const override = state.scene?.doorOpenRadians;
  if (override !== undefined && override !== null) return override;
  const age = time - state.door.lastSlam;
  return age >= 0 && age < 0.4 ? -DOOR_SWING_AMPLITUDE * Math.exp(-age * 10) * Math.cos(age * 20) : 0;
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
  if(!state.town)box('skirting-back', [9.2, 0.13, 0.18], [0, 0.05, -3.47], '#e7dfc8');
  else {box('skirting-back-left',[6.5,.13,.18],[-1.3,.05,-3.47],'#e7dfc8');box('skirting-back-right',[.6,.13,.18],[4.25,.05,-3.47],'#e7dfc8');}
  box('skirting-left', [0.18, 0.13, 7.1], [-4.47, 0.05, 0], '#e7dfc8');
  box('rug-border', [4.1, 0.025, 3.3], [-0.3, 0, 0.3], '#729a92', { collides: false });
  box('rug', [3.8, 0.03, 3], [-0.3, 0.005, 0.3], '#83aaa0', { collides: false });
  for (const [i, x] of [-2.15, 1.55].entries()) box(`rug-stripe-${i}`, [0.035, 0.035, 3], [x, 0.012, 0.3], '#e4d7b6', { collides: false });
  box('door-frame-left', [0.11, 2.9, 0.21], [1.995, 1.45, -3.48], '#42645e');
  box('door-frame-right', [0.11, 2.9, 0.21], [3.945, 1.45, -3.48], '#42645e');
  box('door-frame-top', [2.06, 0.11, 0.21], [2.97, 2.85, -3.48], '#42645e');
  const yaw = doorAngle(state, time), hinge = DOOR_HINGE;
  const doorPart = (id: string, size: Vector3Tuple, p: Vector3Tuple, color: string, observable = false) => {
    const x = p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw), z = -p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw);
    box(id, size, [hinge[0] + x, p[1], hinge[2] + z], color, { yaw, observable });
  };
  for (const part of DOOR_PARTS) doorPart(part.id, part.size, part.position, part.color, part.observable);
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
  if(state.home?.layout)boxes.push(...homeFixtureBoxes(state.home.layout,state.home.pantryFoodVisible));
  if(state.town){
    // The original decorative prototype door was below the complete fox-ear
    // envelope. The town version has a genuine full-height traversable opening;
    // historical room snapshots retain their original lintel and frame.
    for(const b of boxes){if(b.id==='wall-back-lintel'){b.position[1]=3.6;b.size[1]=.3;}else if(b.id==='door-frame-top')b.position[1]=3.52;else if(b.id==='door-frame-left'||b.id==='door-frame-right'){b.position[1]=1.75;b.size[1]=3.5;}}
    boxes.push(...townFixtureBoxes(state));
  }
  return { revision: state.town?'lumi-town-scene-v1':PHYSICAL_SCENE_VERSION, dynamicRevision: s.revision+(state.home?.layout?.revision??0), illumination: s.illumination, boxes };
}
/** Conservative keepout for the entire ordinary slam sweep, not an invisible occluder. */
function animatedDoorKeepout(): PhysicalBox {
  const reach = Math.max(...DOOR_PARTS.map(p => p.position[0] + p.size[0] / 2));
  const thickness = Math.max(...DOOR_PARTS.map(p => Math.abs(p.position[2]) + p.size[2] / 2));
  const side = thickness * Math.sin(DOOR_SWING_AMPLITUDE), depth = reach * Math.sin(DOOR_SWING_AMPLITUDE) + thickness;
  return { id: 'navigation-door-sweep', position: [DOOR_HINGE[0] + reach / 2, 1.4, DOOR_HINGE[2]], size: [reach + side * 2, 2.8, depth * 2], yaw: 0, color: '#000000', collides: true, occludes: false, observable: false, cutaway: false };
}
/** Server navigation and V3 admission reserve the whole head/eye envelope.
 * Normal animated doors reserve their bounded sweep even before a slam starts.
 * Fixed experimental door poses use the real posed colliders. */
function characterCollisionDepths(scene: PhysicalSceneState, x: number, z: number, reserveDoorSweep: boolean): Map<string, number> | null {
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > PHYSICAL_ROOM.walkX || Math.abs(z) > PHYSICAL_ROOM.walkZ) return null;
  const state = { scene, time: 0, door: { lastSlam: -100, slamCount: 0 } } as WorldState;
  const radius = CHARACTER_CLEARANCE_RADIUS;
  const boxes = physicalSceneSnapshot(state).boxes;
  if (reserveDoorSweep && scene.doorOpenRadians === null) boxes.push(animatedDoorKeepout());
  const depths = new Map<string, number>();
  for (const b of boxes) {
    if (!b.collides || b.position[1] + b.size[1] / 2 <= 0.06 || b.position[1] - b.size[1] / 2 >= 3.45) continue;
    const dx = x - b.position[0], dz = z - b.position[2];
    const localX = dx * Math.cos(b.yaw) - dz * Math.sin(b.yaw), localZ = dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw);
    const depth = Math.min(b.size[0] / 2 + radius - Math.abs(localX), b.size[2] / 2 + radius - Math.abs(localZ));
    if (depth > 0) depths.set(b.id, depth);
  }
  return depths;
}
export function canOccupyCharacter(scene: PhysicalSceneState, x: number, z: number): boolean {
  return characterCollisionDepths(scene, x, z, true)?.size === 0;
}
/** Saved poses must satisfy solid/static clearance, but an anticipated future slam
 * must not invalidate a valid pre-vision position or rewrite its history. Transient
 * animated-door camera validity is checked against its actual tick on capture. */
export function canRestoreCharacter(scene: PhysicalSceneState, x: number, z: number): boolean {
  return characterCollisionDepths(scene, x, z, false)?.size === 0;
}
/** A migrated pose inside a new navigation reserve can leave it monotonically.
 * It cannot enter a new collider or move deeper into an existing overlap. No
 * migration flag, teleport or altered historical V1/V2 stepping is involved. */
export function canMoveCharacter(scene: PhysicalSceneState, fromX: number, fromZ: number, x: number, z: number): boolean {
  const next = characterCollisionDepths(scene, x, z, true);
  if (!next) return false;
  if (!next.size) return true;
  const previous = characterCollisionDepths(scene, fromX, fromZ, true);
  if (!previous?.size) return false;
  let improved = false;
  for (const [id, depth] of next) if (depth > (previous.get(id) ?? 0) + 1e-12) return false;
  for (const [id, depth] of previous) if ((next.get(id) ?? 0) < depth - 1e-12) improved = true;
  return improved;
}
/** Strict interior segment test. A tangent or endpoint merely touching the
 * expanded collider is allowed; crossing even a thin interior is not. */
export function segmentEntersRectangle(ax:number,az:number,bx:number,bz:number,hx:number,hz:number):boolean {
  if(hx<=0||hz<=0)return false;
  let enter=0,leave=1;
  for(const [start,end,half] of [[ax,bx,hx],[az,bz,hz]]) {
    const delta=end-start;
    if(Math.abs(delta)<1e-14){if(Math.abs(start)>=half)return false;continue;}
    const t1=(-half-start)/delta,t2=(half-start)/delta;
    enter=Math.max(enter,Math.min(t1,t2));leave=Math.min(leave,Math.max(t1,t2));
    if(enter>=leave-1e-14)return false;
  }
  return enter<leave-1e-14;
}
/** Current-rules swept movement. Preserve the historical endpoint-only helper
 * above for exact V3 replay. The whole segment must avoid new overlap or any
 * deeper part of a migrated overlap; its endpoint must still escape monotonically. */
export function canSweepCharacter(scene:PhysicalSceneState,fromX:number,fromZ:number,x:number,z:number):boolean {
  if(!canMoveCharacter(scene,fromX,fromZ,x,z))return false;
  const previous=characterCollisionDepths(scene,fromX,fromZ,true);if(!previous)return false;
  const state={scene,time:0,door:{lastSlam:-100,slamCount:0}} as WorldState;
  const boxes=physicalSceneSnapshot(state).boxes;if(scene.doorOpenRadians===null)boxes.push(animatedDoorKeepout());
  for(const b of boxes) {
    if(!b.collides||b.position[1]+b.size[1]/2<=.06||b.position[1]-b.size[1]/2>=3.45)continue;
    const local=(px:number,pz:number)=>{const dx=px-b.position[0],dz=pz-b.position[2];return [dx*Math.cos(b.yaw)-dz*Math.sin(b.yaw),dx*Math.sin(b.yaw)+dz*Math.cos(b.yaw)];};
    const [ax,az]=local(fromX,fromZ),[bx,bz]=local(x,z),depth=(previous.get(b.id)??0)+1e-12;
    if(segmentEntersRectangle(ax,az,bx,bz,b.size[0]/2+CHARACTER_CLEARANCE_RADIUS-depth,b.size[2]/2+CHARACTER_CLEARANCE_RADIUS-depth))return false;
  }
  return true;
}
