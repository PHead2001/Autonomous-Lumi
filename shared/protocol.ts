import type { HeadState } from './vision-protocol.js';
import { PHYSICAL_ROOM, type PhysicalSceneState } from './physical-scene.js';
export const ROOM = PHYSICAL_ROOM;
export interface AcousticEvent { kind?:'slam'|'doorbell'|'footstep'; id: number; time: number; intensity: number; suddenness: number; x: number; z: number }
export interface WorldState {
  worldId: string; runId: string; branchId?: string; mode?: 'LIVE' | 'EXPERIMENT'; time: number; tick: number;
  character: { x: number; z: number; heading: number; moving: boolean; gait: number };
  reflex: { start: number; strength: number; duration: number };
  door: { lastSlam: number; slamCount: number };
  /** Absent only in historical V1/V2 replay snapshots. Current authoritative worlds always provide these. */
  physiologyActive?:boolean;capability?:import('./physiology-protocol.js').BodyCapability;presentInternalSensations?:import('./physiology-protocol.js').InternalSensationContext[];
  head?: HeadState; scene?: PhysicalSceneState;
  home?:import('./home-protocol.js').HomeWorldView;
  town?:import('./town-protocol.js').TownWorldView;
  visit?:import('./visit-protocol.js').VisitWorldView;
  social?:import('./social-protocol.js').SocialWorldView;
}
export type ServerMessage = { type: 'state'; state: WorldState } | { type: 'sound'; event: AcousticEvent; state: WorldState };
export const REFLEX_DURATION = 0.8;
/** Shared presentation curve; only server-owned time and reflex state drive the flick. */
export function earFlick(time: number, reflex: WorldState['reflex']): number {
  const age = time - reflex.start;
  if (age < 0 || age >= reflex.duration) return 0;
  return Math.sin(Math.PI * Math.min(age / 0.12, 1)) * 0.1 + Math.sin(age * 21) * Math.exp(-age * 4.8) * reflex.strength;
}
