import { REFLEX_DURATION, ROOM, type AcousticEvent, type WorldState } from '../shared/protocol.js';
import { hashCanonical, canonicalStringify } from './canonical.js';
import { SeededRandom } from './prng.js';

export const RULES_VERSION = 'lumi-waypoints-v1';
export const DEFAULT_CONFIG = { hz: 30, speed: 0.75, pauseTicks: 36, cooldownTicks: 27, maxPendingInputs: 256 };
export type SimulationConfig = typeof DEFAULT_CONFIG;
export type InvalidReason = 'malformed_json' | 'invalid_shape' | 'unknown_command';
export type NormalizedCommand = { type: 'slam' } | { type: 'invalid'; reason: InvalidReason };
export interface OrderedInput { sequence: number; receivedTick: number; applyTick: number; command: NormalizedCommand; admission: 'queued' | 'queue_full' }
export interface DeterministicEvent {
  sequence: number; tick: number; type: string; component: string; outcome: string;
  inputSequence?: number; parentSequence?: number; data: Record<string, number | string | boolean>;
}
export interface CheckpointV1 {
  schemaVersion: 1; rulesVersion: typeof RULES_VERSION; config: SimulationConfig;
  tick: number; character: WorldState['character'];
  reflex: { startTick: number; strength: number }; door: { lastSlamTick: number; slamCount: number };
  waypoint: number; pauseUntilTick: number; cooldownUntilTick: number;
  seed: number; prng: { algorithm: 'xorshift32-v1'; state: number };
  nextInputSequence: number; nextEventSequence: number; nextSoundId: number;
  pendingInputs: OrderedInput[]; eventHash: string;
}
const waypoints = [[-2.6, -1.3], [1.9, -1.6], [2.6, 1.4], [-1.6, 1.8], [0.2, 0.2]];
const EMPTY_HASH = hashCanonical([]);
const fail = (message: string): never => { throw new Error('Invalid checkpoint: ' + message); };
function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || canonicalStringify(Object.keys(value).sort()) !== canonicalStringify(keys.sort())) fail(label + ' fields');
  return value as Record<string, unknown>;
}
function integer(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number { return typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max; }
function finite(v: unknown, min: number, max: number): v is number { return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max; }
export function validateCommand(value: unknown): NormalizedCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid normalized command');
  const c = value as Record<string, unknown>;
  if (c.type === 'slam' && Object.keys(c).length === 1) return { type: 'slam' };
  if (c.type === 'invalid' && Object.keys(c).length === 2 && ['malformed_json', 'invalid_shape', 'unknown_command'].includes(c.reason as string)) return { type: 'invalid', reason: c.reason as InvalidReason };
  throw new Error('Invalid normalized command');
}
/** Deliberately discards all raw visitor fields before recording. */
export function normalizeCommand(raw: string): NormalizedCommand {
  let c: unknown; try { c = JSON.parse(raw); } catch { return { type: 'invalid', reason: 'malformed_json' }; }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { type: 'invalid', reason: 'invalid_shape' };
  const v = c as Record<string, unknown>;
  return v.type === 'slam' && Object.keys(v).length === 1 ? { type: 'slam' } : { type: 'invalid', reason: 'unknown_command' };
}
export function validateCheckpoint(value: unknown): CheckpointV1 {
  const c = object(value, ['schemaVersion','rulesVersion','config','tick','character','reflex','door','waypoint','pauseUntilTick','cooldownUntilTick','seed','prng','nextInputSequence','nextEventSequence','nextSoundId','pendingInputs','eventHash'], 'root');
  if (c.schemaVersion !== 1 || c.rulesVersion !== RULES_VERSION) fail('incompatible schema/rules version');
  const config = object(c.config, Object.keys(DEFAULT_CONFIG), 'config');
  if (!integer(config.hz, 1, 120) || !finite(config.speed, 0.01, 5) || !integer(config.pauseTicks, 1, 36000) || !integer(config.cooldownTicks, 1, 36000) || !integer(config.maxPendingInputs, 1, 4096)) fail('configuration');
  if (!integer(c.tick) || !integer(c.waypoint, 0, waypoints.length - 1) || !integer(c.pauseUntilTick) || !integer(c.cooldownUntilTick)) fail('tick/deadline/waypoint');
  const char = object(c.character, ['x','z','heading','moving','gait'], 'character');
  if (!finite(char.x, -ROOM.walkX, ROOM.walkX) || !finite(char.z, -ROOM.walkZ, ROOM.walkZ) || !finite(char.heading, -Math.PI, Math.PI) || typeof char.moving !== 'boolean' || !finite(char.gait, 0, Number.MAX_SAFE_INTEGER)) fail('character');
  const reflex = object(c.reflex, ['startTick','strength'], 'reflex');
  const door = object(c.door, ['lastSlamTick','slamCount'], 'door');
  if (!integer(reflex.startTick, -3000, c.tick as number) || !finite(reflex.strength, 0, 1) || !integer(door.lastSlamTick, -3000, c.tick as number) || !integer(door.slamCount)) fail('reflex/door');
  const rng = object(c.prng, ['algorithm','state'], 'PRNG');
  if (rng.algorithm !== 'xorshift32-v1' || !integer(c.seed, 1, 0xffffffff) || !integer(rng.state, 1, 0xffffffff)) fail('PRNG');
  if (!integer(c.nextInputSequence, 1) || !integer(c.nextEventSequence, 1) || !integer(c.nextSoundId, 1) || typeof c.eventHash !== 'string' || !/^[a-f0-9]{64}$/.test(c.eventHash)) fail('cursors/hash');
  if (c.nextSoundId !== (door.slamCount as number) + 1 || (c.nextEventSequence === 1 && c.eventHash !== EMPTY_HASH)) fail('counter consistency');
  if (!Array.isArray(c.pendingInputs) || c.pendingInputs.length > (config.maxPendingInputs as number)) fail('input queue');
  let prev = 0;
  for (const raw of c.pendingInputs as unknown[]) {
    const i = object(raw, ['sequence','receivedTick','applyTick','command','admission'], 'input');
    if (!integer(i.sequence, prev + 1, (c.nextInputSequence as number) - 1) || !integer(i.receivedTick, c.tick as number, c.tick as number) || i.applyTick !== (c.tick as number) + 1 || i.admission !== 'queued') fail('pending input order');
    validateCommand(i.command); prev = i.sequence as number;
  }
  return structuredClone(value) as CheckpointV1;
}
export function hashCheckpoint(checkpoint: CheckpointV1): string { return hashCanonical(validateCheckpoint(checkpoint)); }
export function reflexStrength(sound: Pick<AcousticEvent, 'intensity' | 'suddenness'>): number {
  return sound.intensity >= 0.55 && sound.suddenness >= 0.65 ? Math.min(1, sound.intensity * sound.suddenness) : 0;
}
export class Simulation {
  private data: CheckpointV1;
  readonly random: SeededRandom;
  readonly worldId: string; readonly runId: string;
  constructor(options: { seed?: number; checkpoint?: unknown; worldId?: string; runId?: string } = {}) {
    this.worldId = options.worldId ?? 'offline-world'; this.runId = options.runId ?? 'offline-run';
    const seed = options.seed ?? 1;
    this.data = options.checkpoint !== undefined ? validateCheckpoint(options.checkpoint) : {
      schemaVersion: 1, rulesVersion: RULES_VERSION, config: { ...DEFAULT_CONFIG }, tick: 0,
      character: { x: -1.6, z: 1.8, heading: 0, moving: true, gait: 0 },
      reflex: { startTick: -3000, strength: 0 }, door: { lastSlamTick: -3000, slamCount: 0 },
      waypoint: 0, pauseUntilTick: 0, cooldownUntilTick: 0, seed,
      prng: { algorithm: 'xorshift32-v1', state: seed }, nextInputSequence: 1, nextEventSequence: 1, nextSoundId: 1,
      pendingInputs: [], eventHash: EMPTY_HASH,
    };
    this.random = new SeededRandom(this.data.seed, this.data.prng.state);
  }
  private emit(events: DeterministicEvent[], type: string, component: string, outcome: string, data: DeterministicEvent['data'] = {}, inputSequence?: number, parentSequence?: number): DeterministicEvent {
    const event: DeterministicEvent = { sequence: this.data.nextEventSequence++, tick: this.data.tick, type, component, outcome, data };
    if (inputSequence !== undefined) event.inputSequence = inputSequence;
    if (parentSequence !== undefined) event.parentSequence = parentSequence;
    this.data.eventHash = hashCanonical({ previous: this.data.eventHash, event }); events.push(event); return event;
  }
  enqueue(command: NormalizedCommand): { input: OrderedInput; events: DeterministicEvent[] } {
    const normalized = validateCommand(command), events: DeterministicEvent[] = [];
    const input: OrderedInput = { sequence: this.data.nextInputSequence++, receivedTick: this.data.tick, applyTick: this.data.tick + 1, command: normalized, admission: this.data.pendingInputs.length < this.data.config.maxPendingInputs ? 'queued' : 'queue_full' };
    const received = this.emit(events, 'INPUT_RECEIVED', 'input', 'received', { command: normalized.type }, input.sequence);
    this.emit(events, 'INPUT_ADMITTED', 'input', input.admission, {}, input.sequence, received.sequence);
    if (input.admission === 'queued') this.data.pendingInputs.push(structuredClone(input));
    return { input: structuredClone(input), events };
  }
  /** Exactly one integer fixed step. Inputs execute before movement in sequence order. */
  step(): DeterministicEvent[] {
    const d = this.data, events: DeterministicEvent[] = [];
    if (d.tick >= Number.MAX_SAFE_INTEGER - 36001) throw new Error('Simulation tick limit reached');
    d.tick++;
    const due = d.pendingInputs; d.pendingInputs = [];
    for (const input of due) {
      if (input.command.type === 'invalid') { this.emit(events, 'INPUT_VALIDATED', 'input', 'rejected', { reason: input.command.reason }, input.sequence); continue; }
      if (d.tick < d.cooldownUntilTick) { this.emit(events, 'INPUT_VALIDATED', 'input', 'rejected', { reason: 'door_cooldown', cooldownUntilTick: d.cooldownUntilTick }, input.sequence); continue; }
      const accepted = this.emit(events, 'INPUT_VALIDATED', 'input', 'accepted', {}, input.sequence);
      d.door.lastSlamTick = d.tick; d.door.slamCount++; d.cooldownUntilTick = d.tick + d.config.cooldownTicks;
      const action = this.emit(events, 'DOOR_SLAM', 'door', 'applied', { slamCount: d.door.slamCount }, input.sequence, accepted.sequence);
      const sound = { id: d.nextSoundId++, time: d.tick / d.config.hz, intensity: 1, suddenness: 1, x: 3.1, z: -3.4 };
      const acoustic = this.emit(events, 'ACOUSTIC_EVENT', 'sound', 'emitted', sound, input.sequence, action.sequence);
      this.hear(sound, events, input.sequence, acoustic.sequence);
    }
    const c = d.character, wasMoving = c.moving; c.moving = d.tick >= d.pauseUntilTick;
    if (!c.moving) return events;
    if (!wasMoving) this.emit(events, 'WALK_RESUMED', 'movement', 'walking', { waypoint: d.waypoint });
    const [x,z] = waypoints[d.waypoint], dx = x - c.x, dz = z - c.z, distance = Math.hypot(dx,dz);
    const step = Math.min(distance, d.config.speed / d.config.hz);
    if (distance > 0.001) {
      c.heading = Math.atan2(dx,dz); c.x = Math.max(-ROOM.walkX, Math.min(ROOM.walkX, c.x + dx / distance * step));
      c.z = Math.max(-ROOM.walkZ, Math.min(ROOM.walkZ, c.z + dz / distance * step)); c.gait += step * 8;
    }
    if (distance <= step + 0.001) {
      d.waypoint = (d.waypoint + 1) % waypoints.length; d.pauseUntilTick = d.tick + d.config.pauseTicks; c.moving = false;
      this.emit(events, 'WAYPOINT_REACHED', 'movement', 'idle', { nextWaypoint: d.waypoint, pauseUntilTick: d.pauseUntilTick });
    }
    return events;
  }
  hear(sound: AcousticEvent, events: DeterministicEvent[] = [], inputSequence?: number, parentSequence?: number): DeterministicEvent[] {
    // TODO Phase 2: apply source-to-listener distance and occlusion attenuation before the reflex receives sound intensity
    const strength = reflexStrength(sound);
    const decision = this.emit(events, 'REFLEX_DECISION', 'reflex', strength > 0 ? 'triggered' : 'ignored', { intensity: sound.intensity, suddenness: sound.suddenness, intensityThreshold: 0.55, suddennessThreshold: 0.65, strength }, inputSequence, parentSequence);
    if (strength > 0) {
      this.data.reflex = { startTick: this.data.tick, strength };
      this.emit(events, 'REFLEX_STATE', 'reflex', 'changed', { startTick: this.data.tick, strength, durationSeconds: REFLEX_DURATION }, inputSequence, decision.sequence);
    }
    return events;
  }
  checkpoint(): CheckpointV1 { return structuredClone({ ...this.data, prng: { algorithm: 'xorshift32-v1' as const, state: this.random.state } }); }
  snapshot(): WorldState {
    const d = this.data;
    return { worldId: this.worldId, runId: this.runId, tick: d.tick, time: d.tick / d.config.hz,
      character: structuredClone(d.character), reflex: { start: d.reflex.startTick / d.config.hz, strength: d.reflex.strength, duration: REFLEX_DURATION },
      door: { lastSlam: d.door.lastSlamTick / d.config.hz, slamCount: d.door.slamCount } };
  }
  get state(): WorldState { return this.snapshot(); }
}
