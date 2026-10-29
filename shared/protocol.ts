export const ROOM = { width: 9, depth: 7, walkX: 3.2, walkZ: 2.3 } as const;
export interface AcousticEvent { id: number; time: number; intensity: number; suddenness: number; x: number; z: number }
export interface WorldState {
  worldId: string; time: number; tick: number;
  character: { x: number; z: number; heading: number; moving: boolean; gait: number };
  reflex: { start: number; strength: number; duration: number };
  door: { lastSlam: number; slamCount: number };
}
export type ServerMessage = { type: 'state'; state: WorldState } | { type: 'sound'; event: AcousticEvent; state: WorldState };
export const REFLEX_DURATION = 0.8;
/** Shared presentation curve; only server-owned time and reflex state drive the flick. */
export function earFlick(time: number, reflex: WorldState['reflex']): number {
  const age = time - reflex.start;
  if (age < 0 || age >= reflex.duration) return 0;
  return Math.sin(Math.PI * Math.min(age / 0.12, 1)) * 0.1 + Math.sin(age * 21) * Math.exp(-age * 4.8) * reflex.strength;
}
