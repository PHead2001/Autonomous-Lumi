import { randomUUID } from 'node:crypto';
import { REFLEX_DURATION, ROOM, type AcousticEvent, type WorldState } from '../shared/protocol.js';

/** Deterministic, sound-generic reflex. Door controls never manipulate ear joints. */
export function reflexStrength(sound: Pick<AcousticEvent, 'intensity' | 'suddenness'>): number {
  return sound.intensity >= 0.55 && sound.suddenness >= 0.65 ? Math.min(1, sound.intensity * sound.suddenness) : 0;
}
const waypoints = [[-2.6, -1.3], [1.9, -1.6], [2.6, 1.4], [-1.6, 1.8], [0.2, 0.2]];
export class Simulation {
  readonly state: WorldState = {
    worldId: randomUUID(), time: 0, tick: 0,
    character: { x: -1.6, z: 1.8, heading: 0, moving: true, gait: 0 },
    reflex: { start: -100, strength: 0, duration: REFLEX_DURATION },
    door: { lastSlam: -100, slamCount: 0 },
  };
  private waypoint = 0;
  private pauseUntil = 0;
  private soundId = 0;
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.state.time += dt;
    this.state.tick++;
    const c = this.state.character;
    c.moving = this.state.time >= this.pauseUntil;
    if (!c.moving) return;
    const [x, z] = waypoints[this.waypoint];
    const dx = x - c.x, dz = z - c.z;
    const distance = Math.hypot(dx, dz);
    const step = Math.min(distance, dt * 0.75);
    if (distance > 0.001) {
      c.heading = Math.atan2(dx, dz);
      c.x = Math.max(-ROOM.walkX, Math.min(ROOM.walkX, c.x + dx / distance * step));
      c.z = Math.max(-ROOM.walkZ, Math.min(ROOM.walkZ, c.z + dz / distance * step));
      c.gait += step * 8;
    }
    if (distance <= step + 0.001) {
      this.waypoint = (this.waypoint + 1) % waypoints.length;
      this.pauseUntil = this.state.time + 1.2;
      c.moving = false;
    }
  }
  hear(sound: AcousticEvent): void {
    const strength = reflexStrength(sound);
    if (strength > 0) this.state.reflex = { start: this.state.time, strength, duration: REFLEX_DURATION };
  }
  slamDoor(): AcousticEvent | null {
    if (this.state.time - this.state.door.lastSlam < 0.9) return null;
    this.state.door.lastSlam = this.state.time;
    this.state.door.slamCount++;
    const sound = { id: ++this.soundId, time: this.state.time, intensity: 1, suddenness: 1, x: 3.1, z: -3.4 };
    this.hear(sound);
    return sound;
  }
  snapshot(): WorldState { return structuredClone(this.state); }
}
