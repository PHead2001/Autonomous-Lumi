import { REFLEX_DURATION, ROOM, type AcousticEvent, type WorldState } from '../shared/protocol.js';
import { hashCanonical, canonicalStringify } from './canonical.js';
import { SeededRandom } from './prng.js';
import type { ActivityState, ControlAction, SubjectiveClock, WorldMode } from '../shared/lab-protocol.js';
import { defaultHeadState, HEAD_LIMITS, validateHeadAction, validateHeadState, type HeadAction, type HeadState } from '../shared/vision-protocol.js';
import { defaultPhysicalSceneState, validatePhysicalSceneState, validateSceneConfiguration, canOccupyCharacter, type PhysicalSceneState } from '../shared/physical-scene.js';
import { isTargetEligible } from './vision/grounding.js';

export const RULES_VERSION = 'lumi-waypoints-v1';
export const DEFAULT_CONFIG = { hz: 30, speed: 0.75, pauseTicks: 36, cooldownTicks: 27, maxPendingInputs: 256 };
export type SimulationConfig = typeof DEFAULT_CONFIG;
export type InvalidReason = 'malformed_json' | 'invalid_shape' | 'unknown_command';
export type SceneCommand = {type:'configure_scene';illumination:number;fixture:'none'|'visibility';fixtureColor:string;doorOpenRadians:number|null};
export type NormalizedCommand = { type: 'slam' } | { type: 'invalid'; reason: InvalidReason } | HeadAction | SceneCommand;
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
export function validateCommand(value: unknown, vision=false): NormalizedCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid normalized command');
  const c = value as Record<string, unknown>;
  if (c.type === 'slam' && Object.keys(c).length === 1) return { type: 'slam' };
  if (c.type === 'invalid' && Object.keys(c).length === 2 && ['malformed_json', 'invalid_shape', 'unknown_command'].includes(c.reason as string)) return { type: 'invalid', reason: c.reason as InvalidReason };
  if(vision&&c.type==='configure_scene') {const raw=structuredClone(c);delete raw.type;const config=validateSceneConfiguration(raw);return {type:'configure_scene',...config};}
  if(vision)return validateHeadAction(value);
  throw new Error('Invalid normalized command');
}
/** Deliberately discards all raw visitor fields before recording. */
export function normalizeCommand(raw: string): NormalizedCommand {
  let c: unknown; try { c = JSON.parse(raw); } catch { return { type: 'invalid', reason: 'malformed_json' }; }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { type: 'invalid', reason: 'invalid_shape' };
  const v = c as Record<string, unknown>;
  return v.type === 'slam' && Object.keys(v).length === 1 ? { type: 'slam' } : { type: 'invalid', reason: 'unknown_command' };
}
export function validateCheckpointV1(value: unknown): CheckpointV1 {
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
export function hashCheckpoint(checkpoint: Checkpoint): string { return hashCanonical(validateCheckpoint(checkpoint)); }
export function reflexStrength(sound: Pick<AcousticEvent, 'intensity' | 'suddenness'>): number {
  return sound.intensity >= 0.55 && sound.suddenness >= 0.65 ? Math.min(1, sound.intensity * sound.suddenness) : 0;
}
export class Simulation {
  protected data: CheckpointV1;
  readonly random: SeededRandom;
  readonly worldId: string; readonly runId: string;
  protected supportsVisionInputs():boolean{return false;}
  protected applyExtendedInput(input:OrderedInput,events:DeterministicEvent[]):boolean{void input;void events;return false;}
  protected onDoorChanged():void{}
  protected canMove(x:number,z:number):boolean{void x;void z;return true;}
  constructor(options: { seed?: number; checkpoint?: unknown; worldId?: string; runId?: string } = {}) {
    this.worldId = options.worldId ?? 'offline-world'; this.runId = options.runId ?? 'offline-run';
    const seed = options.seed ?? 1;
    this.data = options.checkpoint !== undefined ? validateCheckpointV1(options.checkpoint) : {
      schemaVersion: 1, rulesVersion: RULES_VERSION, config: { ...DEFAULT_CONFIG }, tick: 0,
      character: { x: -1.6, z: 1.8, heading: 0, moving: true, gait: 0 },
      reflex: { startTick: -3000, strength: 0 }, door: { lastSlamTick: -3000, slamCount: 0 },
      waypoint: 0, pauseUntilTick: 0, cooldownUntilTick: 0, seed,
      prng: { algorithm: 'xorshift32-v1', state: seed }, nextInputSequence: 1, nextEventSequence: 1, nextSoundId: 1,
      pendingInputs: [], eventHash: EMPTY_HASH,
    };
    this.random = new SeededRandom(this.data.seed, this.data.prng.state);
  }
  protected emit(events: DeterministicEvent[], type: string, component: string, outcome: string, data: DeterministicEvent['data'] = {}, inputSequence?: number, parentSequence?: number): DeterministicEvent {
    const event: DeterministicEvent = { sequence: this.data.nextEventSequence++, tick: this.data.tick, type, component, outcome, data };
    if (inputSequence !== undefined) event.inputSequence = inputSequence;
    if (parentSequence !== undefined) event.parentSequence = parentSequence;
    this.data.eventHash = hashCanonical({ previous: this.data.eventHash, event }); events.push(event); return event;
  }
  enqueue(command: NormalizedCommand): { input: OrderedInput; events: DeterministicEvent[] } {
    const normalized = validateCommand(command,this.supportsVisionInputs()), events: DeterministicEvent[] = [];
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
      if(this.applyExtendedInput(input,events))continue;
      if (d.tick < d.cooldownUntilTick) { this.emit(events, 'INPUT_VALIDATED', 'input', 'rejected', { reason: 'door_cooldown', cooldownUntilTick: d.cooldownUntilTick }, input.sequence); continue; }
      const accepted = this.emit(events, 'INPUT_VALIDATED', 'input', 'accepted', {}, input.sequence);
      d.door.lastSlamTick = d.tick; d.door.slamCount++; d.cooldownUntilTick = d.tick + d.config.cooldownTicks;
      this.onDoorChanged();
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
      c.heading = Math.atan2(dx,dz);const nextX=Math.max(-ROOM.walkX,Math.min(ROOM.walkX,c.x+dx/distance*step)),nextZ=Math.max(-ROOM.walkZ,Math.min(ROOM.walkZ,c.z+dz/distance*step));
      if(!this.canMove(nextX,nextZ)){d.waypoint=(d.waypoint+1)%waypoints.length;d.pauseUntilTick=d.tick+d.config.pauseTicks;c.moving=false;this.emit(events,'MOVEMENT_BLOCKED','movement','idle',{nextWaypoint:d.waypoint,pauseUntilTick:d.pauseUntilTick});return events;}
      c.x=nextX;c.z=nextZ;c.gait+=step*8;
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
  checkpoint(): Checkpoint { return structuredClone({ ...this.data, prng: { algorithm: 'xorshift32-v1' as const, state: this.random.state } }); }
  snapshot(): WorldState {
    const d = this.data;
    return { worldId: this.worldId, runId: this.runId, tick: d.tick, time: d.tick / d.config.hz,
      character: structuredClone(d.character), reflex: { start: d.reflex.startTick / d.config.hz, strength: d.reflex.strength, duration: REFLEX_DURATION },
      door: { lastSlam: d.door.lastSlamTick / d.config.hz, slamCount: d.door.slamCount } };
  }
  get state(): WorldState { return this.snapshot(); }
}

export interface SyntheticExperience {
  id: number; tick: number; kind: 'cue' | 'clock'; provenance: 'TEST STUB';
  observedSeconds: number | null; uncertaintySeconds: number | null;
}
export interface CheckpointV2 extends Omit<CheckpointV1, 'schemaVersion' | 'rulesVersion'> {
  schemaVersion: 2; rulesVersion: 'lumi-lab-v1'; subjective: SubjectiveClock; activity: ActivityState;
  experiences: SyntheticExperience[]; nextExperienceId: number;
}
export interface CheckpointV3 extends Omit<CheckpointV2,'schemaVersion'|'rulesVersion'> {schemaVersion:3;rulesVersion:'lumi-eyes-v1';head:HeadState;scene:PhysicalSceneState}
export type Checkpoint = CheckpointV1 | CheckpointV2 | CheckpointV3;
function legacyPart(c: CheckpointV2): CheckpointV1 {
  const result = structuredClone(c) as unknown as Record<string, unknown>;
  for (const key of ['subjective','activity','experiences','nextExperienceId']) delete result[key];
  result.schemaVersion = 1; result.rulesVersion = RULES_VERSION;
  return validateCheckpointV1(result);
}
/** Explicit migration: V1 replay remains V1; a new lab run initializes named new systems. */
export function upgradeCheckpoint(value: unknown): CheckpointV2 {
  const cp = validateCheckpoint(value);
  if(cp.schemaVersion===3)throw new Error('Vision state cannot be downgraded into historical lab semantics');
  if (cp.schemaVersion === 2) return cp;
  return { ...cp, schemaVersion: 2, rulesVersion: 'lumi-lab-v1',
    subjective: { estimateSeconds: 0, uncertaintySeconds: cp.tick / cp.config.hz + 5, lastCalibrationTick: null, driftPpm: 1200, uncertaintyGrowthPerSecond: 0.02 },
    activity: { status:'idle',cursor:0,totalTicks:0,appliedMilestones:[],completionCount:0,activityId:0 }, experiences:[], nextExperienceId:1 };
}
export function validateCheckpoint(value: unknown): Checkpoint {
  if(value&&typeof value==='object'&&(value as {schemaVersion?:unknown}).schemaVersion===3)return validateVisionCheckpoint(value);
  if (!value || typeof value !== 'object' || (value as {schemaVersion?:unknown}).schemaVersion !== 2) return validateCheckpointV1(value);
  const keys = ['schemaVersion','rulesVersion','config','tick','character','reflex','door','waypoint','pauseUntilTick','cooldownUntilTick','seed','prng','nextInputSequence','nextEventSequence','nextSoundId','pendingInputs','eventHash','subjective','activity','experiences','nextExperienceId'];
  const raw = object(value, keys, 'lab root');
  if (raw.rulesVersion !== 'lumi-lab-v1') fail('incompatible lab rules');
  const cp = value as CheckpointV2; legacyPart(cp);
  const clock = object(cp.subjective,['estimateSeconds','uncertaintySeconds','lastCalibrationTick','driftPpm','uncertaintyGrowthPerSecond'],'subjective clock');
  if (!finite(clock.estimateSeconds,0,Number.MAX_SAFE_INTEGER) || !finite(clock.uncertaintySeconds,0,Number.MAX_SAFE_INTEGER) || !(clock.lastCalibrationTick === null || integer(clock.lastCalibrationTick,0,cp.tick)) || !finite(clock.driftPpm,-100000,100000) || !finite(clock.uncertaintyGrowthPerSecond,0,1)) fail('subjective clock');
  const a = object(cp.activity,['status','cursor','totalTicks','appliedMilestones','completionCount','activityId'],'activity');
  if (!['idle','running','paused','complete'].includes(a.status as string) || !integer(a.totalTicks,0,100000) || !integer(a.cursor,0,a.totalTicks as number) || !integer(a.completionCount,0,1) || !integer(a.activityId)) fail('activity state');
  const expectedMilestones = Array.from({length:Math.floor((a.cursor as number)/10)},(_,i)=>(i+1)*10);
  if (canonicalStringify(a.appliedMilestones) !== canonicalStringify(expectedMilestones) || (a.status === 'complete') !== (a.completionCount === 1) || (a.status === 'complete' && a.cursor !== a.totalTicks) || (a.status === 'idle' && (a.cursor !== 0 || a.totalTicks !== 0 || a.activityId !== 0))) fail('activity effects');
  if (!integer(cp.nextExperienceId,1,257) || !Array.isArray(cp.experiences) || cp.experiences.length !== cp.nextExperienceId-1) fail('experience cursor');
  for (let i=0;i<cp.experiences.length;i++) {
    const e = object(cp.experiences[i],['id','tick','kind','provenance','observedSeconds','uncertaintySeconds'],'experience');
    if (e.id!==i+1 || !integer(e.tick,0,cp.tick) || !['cue','clock'].includes(e.kind as string) || e.provenance!=='TEST STUB' || (e.kind === 'cue' ? e.observedSeconds!==null || e.uncertaintySeconds!==null : !finite(e.observedSeconds,0,1e12) || !finite(e.uncertaintySeconds,0,1e9))) fail('synthetic experience');
  }
  return structuredClone(cp);
}
/** New deterministic systems extend the existing fixed-step mechanics. */
export class LabSimulation extends Simulation {
  private subjective: SubjectiveClock; private activity: ActivityState; private experiences: SyntheticExperience[]; private nextExperienceId: number;
  constructor(options: { checkpoint?: unknown; seed?: number; worldId?: string; runId?: string; mode: WorldMode }) {
    const cp = upgradeCheckpoint(options.checkpoint ?? new Simulation({seed:options.seed}).checkpoint());
    super({...options,checkpoint:legacyPart(cp)});
    this.subjective=cp.subjective;this.activity=cp.activity;this.experiences=cp.experiences;this.nextExperienceId=cp.nextExperienceId;
    this.mode=options.mode;
    if(this.mode==='LIVE' && this.experiences.length) throw new Error('Experimental experience cannot enter LIVE');
  }
  readonly mode: WorldMode;
  override step(): DeterministicEvent[] {
    const events=super.step(), dt=1/this.data.config.hz;
    this.subjective.estimateSeconds+=dt*(1+this.subjective.driftPpm/1e6);this.subjective.uncertaintySeconds+=dt*this.subjective.uncertaintyGrowthPerSecond;
    const a=this.activity;
    if(a.status==='running') {
      a.cursor++;
      if(a.cursor%10===0){a.appliedMilestones.push(a.cursor);this.emit(events,'ACTIVITY_EFFECT','activity','applied',{activityId:a.activityId,cursor:a.cursor});}
      if(a.cursor===a.totalTicks){a.status='complete';a.completionCount=1;this.emit(events,'ACTIVITY_COMPLETE','activity','completed',{activityId:a.activityId,cursor:a.cursor,completionCount:1});}
    }
    return events;
  }
  applyAction(action:ControlAction):DeterministicEvent[] {
    const events:DeterministicEvent[]=[];
    if(action.type==='activity-start') {
      if(this.activity.status==='running'||this.activity.status==='paused') throw new Error('Activity already exists; pause/resume it');
      this.activity={status:'running',cursor:0,totalTicks:action.totalTicks,appliedMilestones:[],completionCount:0,activityId:this.activity.activityId+1};
      this.emit(events,'ACTIVITY_STARTED','activity','running',{activityId:this.activity.activityId,totalTicks:action.totalTicks});
    } else if(action.type==='activity-pause'||action.type==='activity-resume') {
      const expected=action.type==='activity-pause'?'running':'paused';if(this.activity.status!==expected) throw new Error('Activity state does not permit action');
      this.activity.status=action.type==='activity-pause'?'paused':'running';this.emit(events,'ACTIVITY_STATUS','activity',this.activity.status,{activityId:this.activity.activityId,cursor:this.activity.cursor});
    } else if(action.type==='synthetic-cue'||action.type==='synthetic-clock') {
      if(this.mode!=='EXPERIMENT') throw new Error('Synthetic observations are experiment-only');
      if(action.sensed&&action.attended&&action.encoded&&this.experiences.length>=256) throw new Error('Synthetic experience capacity reached');
      const factors={provenance:'TEST STUB',sensed:action.sensed,attended:action.attended,encoded:action.encoded,kind:action.type==='synthetic-clock'?'clock':'cue'};
      const source=this.emit(events,'SYNTHETIC_CUE','test-harness','injected',factors);
      this.emit(events,'SYNTHETIC_GATE','sensor',action.sensed&&action.attended&&action.encoded?'eligible':'not_encoded',factors,undefined,source.sequence);
      if(action.sensed&&action.attended&&action.encoded) {
        const experience:SyntheticExperience={id:this.nextExperienceId++,tick:this.data.tick,kind:action.type==='synthetic-clock'?'clock':'cue',provenance:'TEST STUB',observedSeconds:action.type==='synthetic-clock'?action.observedSeconds:null,uncertaintySeconds:action.type==='synthetic-clock'?action.uncertaintySeconds:null};
        this.experiences.push(experience);this.emit(events,'EXPERIENCE_ENCODED','experience','encoded',{...factors,experienceId:experience.id},undefined,source.sequence);
        if(action.type==='synthetic-clock') {
          this.subjective.estimateSeconds=action.observedSeconds;this.subjective.uncertaintySeconds=action.uncertaintySeconds;this.subjective.lastCalibrationTick=this.data.tick;
          this.emit(events,'CLOCK_CALIBRATED','clock','calibrated',{provenance:'TEST STUB',observedSeconds:action.observedSeconds,uncertaintySeconds:action.uncertaintySeconds},undefined,source.sequence);
        }
      }
    }
    return events;
  }
  protected labCheckpoint():CheckpointV2 {return {...super.checkpoint(),schemaVersion:2,rulesVersion:'lumi-lab-v1',subjective:structuredClone(this.subjective),activity:structuredClone(this.activity),experiences:structuredClone(this.experiences),nextExperienceId:this.nextExperienceId};}
  override checkpoint():CheckpointV2|CheckpointV3 {return this.labCheckpoint();}
}

/** Validate V3 through the unchanged V2 contract, substituting only its newly typed inputs.
 * This is validation, never a restore/downgrade path: actual pending commands are retained. */
function visionLabPart(cp:CheckpointV3):CheckpointV2 {
  const raw=structuredClone(cp) as unknown as Record<string,unknown>;
  delete raw.head;delete raw.scene;raw.schemaVersion=2;raw.rulesVersion='lumi-lab-v1';
  raw.pendingInputs=cp.pendingInputs.map(input=>({...input,command:input.command.type==='slam'||input.command.type==='invalid'?input.command:{type:'invalid',reason:'unknown_command'}}));
  const validated=validateCheckpoint(raw);if(validated.schemaVersion!==2)fail('vision base schema');return validated as CheckpointV2;
}
export function validateVisionCheckpoint(value:unknown):CheckpointV3 {
  const keys=['schemaVersion','rulesVersion','config','tick','character','reflex','door','waypoint','pauseUntilTick','cooldownUntilTick','seed','prng','nextInputSequence','nextEventSequence','nextSoundId','pendingInputs','eventHash','subjective','activity','experiences','nextExperienceId','head','scene'];
  const raw=object(value,keys,'vision root');if(raw.schemaVersion!==3||raw.rulesVersion!=='lumi-eyes-v1')fail('incompatible vision rules');
  const cp=value as CheckpointV3;if(!Array.isArray(cp.pendingInputs))fail('vision input queue');
  for(const input of cp.pendingInputs)validateCommand(input.command,true);
  visionLabPart(cp);validateHeadState(cp.head);validatePhysicalSceneState(cp.scene);
  if(!canOccupyCharacter(cp.scene,cp.character.x,cp.character.z))fail('character overlaps physical collider');
  return structuredClone(cp);
}
/** Deliberate active-world upgrade; offline V1/V2 replay never calls this. */
export function upgradeVisionCheckpoint(value:unknown):CheckpointV3 {
  const source=validateCheckpoint(value);if(source.schemaVersion===3)return source;
  const cp=upgradeCheckpoint(source);
  return {...cp,schemaVersion:3,rulesVersion:'lumi-eyes-v1',head:defaultHeadState(),scene:defaultPhysicalSceneState()};
}
export class VisionSimulation extends LabSimulation {
  private head:HeadState;private scene:PhysicalSceneState;
  constructor(options:{checkpoint?:unknown;seed?:number;worldId?:string;runId?:string;mode:WorldMode}) {
    const cp=upgradeVisionCheckpoint(options.checkpoint??new Simulation({seed:options.seed}).checkpoint());
    super({...options,checkpoint:visionLabPart(cp)});this.data.pendingInputs=structuredClone(cp.pendingInputs);this.head=cp.head;this.scene=cp.scene;
  }
  protected override supportsVisionInputs():boolean{return true;}
  protected override onDoorChanged():void{this.scene.revision++;}
  protected override canMove(x:number,z:number):boolean{return canOccupyCharacter(this.scene,x,z);}
  protected override applyExtendedInput(input:OrderedInput,events:DeterministicEvent[]):boolean {
    const command=input.command;if(command.type==='slam'||command.type==='invalid')return false;
    const reject=(reason:string)=>{this.emit(events,'INPUT_VALIDATED','head','rejected',{reason,command:command.type},input.sequence);return true;};
    if(command.type==='configure_scene') {
      if(this.mode!=='EXPERIMENT')return reject('scene_fixture_experiment_only');
      const configuration=validateSceneConfiguration({illumination:command.illumination,fixture:command.fixture,fixtureColor:command.fixtureColor,doorOpenRadians:command.doorOpenRadians}),scene={...configuration,revision:this.scene.revision+1};
      if(!canOccupyCharacter(scene,this.data.character.x,this.data.character.z))return reject('fixture_overlaps_character');
      this.scene=scene;this.emit(events,'SCENE_CONFIGURED','scene','applied',{sceneRevision:scene.revision,illumination:scene.illumination,fixture:scene.fixture,fixtureColor:scene.fixtureColor.slice(1),doorOpenRadians:scene.doorOpenRadians??'animated'},input.sequence);return true;
    }
    if(command.sceneRevision!==this.scene.revision)return reject('scene_revision_changed');
    if(command.type==='look_at'&&command.evidence) {
      if(command.evidence.capturedTick>this.data.tick||this.data.tick-command.evidence.capturedTick>300)return reject('observation_expired');
      if(!isTargetEligible(this.snapshot(),command.evidence.engineTargetId,command.evidence.captureWidth,command.evidence.captureHeight))return reject('target_no_longer_visible');
    }
    const h=this.head;
    if(h.status!=='idle')this.emit(events,'HEAD_INTERRUPTED','head','cancelled',{actionId:h.activeActionId!,command:command.type},input.sequence);
    const actionId=h.nextActionId++;
    if(command.type==='cancel_head'){h.status='idle';h.targetYaw=h.yaw;h.targetPitch=h.pitch;h.scan=null;h.activeActionId=null;this.emit(events,'HEAD_CANCELLED','head','idle',{actionId},input.sequence);return true;}
    h.activeActionId=actionId;
    if(command.type==='scan_area') {
      const points=Array.from({length:command.passes*2},(_,i)=>({yaw:i%2===0?command.minYaw:command.maxYaw,pitch:command.pitch}));
      h.status='scanning';h.scan={points,cursor:0};h.targetYaw=points[0].yaw;h.targetPitch=points[0].pitch;
    }else{h.status='turning';h.scan=null;
      // Relative turns use the pose at this ordered execution tick; saturating at
      // anatomical limits is deterministic and never snaps the current pose.
      h.targetYaw=command.type==='turn_head'?Math.max(HEAD_LIMITS.minYaw,Math.min(HEAD_LIMITS.maxYaw,h.yaw+command.yawDelta)):command.yaw;
      h.targetPitch=command.type==='turn_head'?Math.max(HEAD_LIMITS.minPitch,Math.min(HEAD_LIMITS.maxPitch,h.pitch+command.pitchDelta)):command.pitch;
    }
    this.emit(events,'HEAD_ACTION_STARTED','head',h.status,{actionId,command:command.type,targetYaw:h.targetYaw,targetPitch:h.targetPitch,sceneRevision:this.scene.revision,...(command.type==='look_at'&&command.evidence?{observationId:command.evidence.observationId,frameHash:command.evidence.frameHash,capturedTick:command.evidence.capturedTick}: {})},input.sequence);
    return true;
  }
  override step():DeterministicEvent[] {
    const events=super.step(),h=this.head;if(h.status==='idle')return events;
    const maximum=HEAD_LIMITS.radiansPerSecond/this.data.config.hz,dx=h.targetYaw-h.yaw,dy=h.targetPitch-h.pitch,distance=Math.hypot(dx,dy);
    if(distance<=maximum){h.yaw=h.targetYaw;h.pitch=h.targetPitch;
      if(h.status==='scanning'&&h.scan&&h.scan.cursor+1<h.scan.points.length){h.scan.cursor++;const p=h.scan.points[h.scan.cursor];h.targetYaw=p.yaw;h.targetPitch=p.pitch;this.emit(events,'HEAD_SCAN_POINT','head','next',{actionId:h.activeActionId!,cursor:h.scan.cursor,targetYaw:h.targetYaw,targetPitch:h.targetPitch});}
      else{const actionId=h.activeActionId!;h.status='idle';h.scan=null;h.activeActionId=null;this.emit(events,'HEAD_ACTION_COMPLETE','head','idle',{actionId,yaw:h.yaw,pitch:h.pitch});}
    }else{h.yaw+=dx/distance*maximum;h.pitch+=dy/distance*maximum;}
    return events;
  }
  override checkpoint():CheckpointV3{return {...this.labCheckpoint(),schemaVersion:3,rulesVersion:'lumi-eyes-v1',head:structuredClone(this.head),scene:structuredClone(this.scene)};}
  override snapshot():WorldState{return {...super.snapshot(),head:structuredClone(this.head),scene:structuredClone(this.scene)};}
}
