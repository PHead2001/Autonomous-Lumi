import {HOME_RULES,HOME_LIMITS,validateHomeState,validateHomeObservation,type HomeState,type HomeObservationCommand,type HomeLayout} from '../shared/home-protocol.js';
import {createHomeState,homeTimeline,replenishHomeResources,chooseReactiveHomeGoal,beginHomeTask,homeTaskBusy,homePublicView,HOME_ACTION_SECONDS,BASIC_SERVING} from './home.js';
import {planHomeRoute} from './home-navigation.js';
import {chooseSafeHomeLayout,canOccupyHomeCharacter,canSweepHomeCharacter,canUseHomePosture,canSweepHomePosture} from '../shared/home-geometry.js';
import { CURRENT_PHYSIOLOGY_RULES, type InteroceptionStateV2, validateInteroceptionStateV2, interoceptionV1Projection } from '../shared/physiology-protocol.js';
import { advanceInteroceptionV2, upgradeInteroceptionV2 } from './physiology.js';
import { PHYSIOLOGY_RULES, validateBodyState, validateInteroceptionState, validatePhysiologyEffect, validateInternalSensation, type BodyState, type InteroceptionState, type PhysiologyEffect, type InternalSensation, type InternalSensationContext, type PhysiologyEvent } from '../shared/physiology-protocol.js';
import { createBody, createInteroception, advanceBody, advanceInteroception, bodyCapability, bodyImpairment, applyAcceptedBodyEffect, presentInternalSensations, providerInternalSensations } from './physiology.js';
import { currentCognitionProfile, COGNITION_SCHEMA_REVISION, cognitionValidationError, validateCognitionProposalReferences } from '../shared/cognition-protocol.js';
import { REFLEX_DURATION, ROOM, type AcousticEvent, type WorldState } from '../shared/protocol.js';
import { hashCanonical, canonicalStringify } from './canonical.js';
import { SeededRandom } from './prng.js';
import type { ActivityState, ControlAction, SubjectiveClock, WorldMode } from '../shared/lab-protocol.js';
import { defaultHeadState, HEAD_LIMITS, isCapturedBearingEvidence, observedHeadTarget, observedWorldDirection, relativeObservedAim, validateHeadAction, validateHeadState, type HeadAction, type HeadState } from '../shared/vision-protocol.js';
import { defaultPhysicalSceneState, validatePhysicalSceneState, validateSceneConfiguration, canOccupyCharacter, canRestoreCharacter, canMoveCharacter, canSweepCharacter, physicalSceneSnapshot, type PhysicalSceneState } from '../shared/physical-scene.js';
import { isTargetEligible } from './vision/grounding.js';
import { defaultAttentionState, deriveHearingEstimates, validateAttentionState, validateSensoryCommand, imageSignatureDifference, type AttentionState, type AutomaticCaptureReason, type CaptureIntent, type SensorFeedbackCommand, type SensorPose, type SensoryCommand } from '../shared/attention-protocol.js';
import { eyePose } from '../shared/eye-pose.js';
import { propagateSound } from './hearing.js';
import { fitsCognitionStorage } from './checkpoint-capacity.js';
import { COGNITION_RULES, COGNITION_LIMITS, validateCognitionCommand, validateCognitionIdentity, type CognitionCommand, type CognitionState, type CognitionIdentity, type CognitionRequestCommand, type CognitionResultCommand, type RealExperience, type InternalExperience, type CognitionActionOutcome, type CognitionObservationRequestCommand } from '../shared/cognition-protocol.js';

export const RULES_VERSION = 'lumi-waypoints-v1';
export const DEFAULT_CONFIG = { hz: 30, speed: 0.75, pauseTicks: 36, cooldownTicks: 27, maxPendingInputs: 256 };
export type SimulationConfig = typeof DEFAULT_CONFIG;
export type InvalidReason = 'malformed_json' | 'invalid_shape' | 'unknown_command';
export type SceneCommand = {type:'configure_scene';illumination:number;fixture:'none'|'visibility';fixtureColor:string;doorOpenRadians:number|null};
export type PhysiologyCommand = {type:'physiology_fixture';effect:PhysiologyEffect}|{type:'physiology_safety_fixture';ticks:number}|{type:'physiology_encoding';enabled:boolean};
export type HomeCommand=HomeObservationCommand|{type:'doorbell'}|{type:'home_layout_fixture';layout:HomeLayout};
export type NormalizedCommand = HomeCommand | PhysiologyCommand | { type: 'slam' } | { type: 'invalid'; reason: InvalidReason } | HeadAction | SceneCommand | SensoryCommand | CognitionCommand;
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
export function validateCommand(value: unknown, vision=false, sensory=false, cognition=false, physiology=false, home=false): NormalizedCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid normalized command');
  const c = value as Record<string, unknown>;
  if(home&&c.type==='home_observation')return validateHomeObservation(value);
  if(home&&c.type==='doorbell'&&Object.keys(c).length===1)return {type:'doorbell'};
  if(home&&c.type==='home_layout_fixture'&&Object.keys(c).length===2){const layout=c.layout as HomeLayout;const probe=createHomeState(0,30,layout);validateHomeState(probe,0,30);return {type:'home_layout_fixture',layout:structuredClone(layout)};}
  if(physiology&&c.type==='physiology_fixture'&&Object.keys(c).length===2)return {type:'physiology_fixture',effect:validatePhysiologyEffect(c.effect)};
  if(physiology&&c.type==='physiology_safety_fixture'&&Object.keys(c).length===2&&integer(c.ticks,1,36000))return {type:'physiology_safety_fixture',ticks:c.ticks};
  if(physiology&&c.type==='physiology_encoding'&&Object.keys(c).length===2&&typeof c.enabled==='boolean')return {type:'physiology_encoding',enabled:c.enabled};
  if (c.type === 'slam' && Object.keys(c).length === 1) return { type: 'slam' };
  if (c.type === 'invalid' && Object.keys(c).length === 2 && ['malformed_json', 'invalid_shape', 'unknown_command'].includes(c.reason as string)) return { type: 'invalid', reason: c.reason as InvalidReason };
  if(cognition&&(c.type==='cognition_request'||c.type==='cognition_result'||c.type==='cognition_observation_request'))return validateCognitionCommand(value);
  if(sensory&&(c.type==='emit_sound'||c.type==='sensor_feedback'))return validateSensoryCommand(value);
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
  protected supportsPhysiologyInputs():boolean{return false;}
  protected supportsHomeInputs():boolean{return false;}
  protected cognitionActionAllowed():boolean{return true;}
  protected movementPermitted():boolean{return true;}
  protected movementPauseActive():boolean{return this.data.tick<this.data.pauseUntilTick;}
  protected movementDestination():[number,number]{return waypoints[this.data.waypoint] as [number,number];}
  protected movementArrived(events:DeterministicEvent[]):void{const d=this.data;d.waypoint=(d.waypoint+1)%waypoints.length;d.pauseUntilTick=d.tick+d.config.pauseTicks;d.character.moving=false;this.emit(events,'WAYPOINT_REACHED','movement','idle',{nextWaypoint:d.waypoint,pauseUntilTick:d.pauseUntilTick});}
  protected movementBlocked(events:DeterministicEvent[]):void{const d=this.data;d.waypoint=(d.waypoint+1)%waypoints.length;d.pauseUntilTick=d.tick+d.config.pauseTicks;d.character.moving=false;this.emit(events,'MOVEMENT_BLOCKED','movement','idle',{nextWaypoint:d.waypoint,pauseUntilTick:d.pauseUntilTick});}
  protected capableOfAction():boolean{return true;}
  protected capableOfAttention():boolean{return true;}
  protected movementScale():number{return 1;}
  protected motorScale():number{return 1;}
  protected ordinaryAttentionScale():number{return 1;}
  protected beforeInputs(events:DeterministicEvent[]):void{void events;}
  protected beforeMotorExecution(events:DeterministicEvent[]):void{void events;}
  protected afterMotors(events:DeterministicEvent[]):void{void events;}
  protected supportsVisionInputs():boolean{return false;}
  protected supportsSensoryInputs():boolean{return false;}
  protected supportsCognitionInputs():boolean{return false;}
  protected additionalInputCapacityReason(input:OrderedInput):string|null{void input;return null;}
  protected applyExtendedInput(input:OrderedInput,events:DeterministicEvent[]):boolean{void input;void events;return false;}
  protected onDoorChanged():void{}
  protected createDoorSound():AcousticEvent {const d=this.data;return {id:d.nextSoundId++,time:d.tick/d.config.hz,intensity:1,suddenness:1,x:3.1,z:-3.4};}
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
    const normalized = validateCommand(command,this.supportsVisionInputs(),this.supportsSensoryInputs(),this.supportsCognitionInputs(),this.supportsPhysiologyInputs(),this.supportsHomeInputs()), events: DeterministicEvent[] = [];
    const input: OrderedInput = { sequence: this.data.nextInputSequence++, receivedTick: this.data.tick, applyTick: this.data.tick + 1, command: normalized, admission: this.data.pendingInputs.length < this.data.config.maxPendingInputs ? 'queued' : 'queue_full' };
    const capacityReason=input.admission==='queued'?this.additionalInputCapacityReason(input):null;
    if(capacityReason!==null)input.admission='queue_full';
    const received = this.emit(events, 'INPUT_RECEIVED', 'input', 'received', { command: normalized.type }, input.sequence);
    this.emit(events, 'INPUT_ADMITTED', 'input', input.admission, capacityReason===null?{}:{reason:capacityReason}, input.sequence, received.sequence);
    if (input.admission === 'queued') this.data.pendingInputs.push(structuredClone(input));
    return { input: structuredClone(input), events };
  }
  /** Exactly one integer fixed step. Inputs execute before movement in sequence order. */
  step(): DeterministicEvent[] {
    const d = this.data, events: DeterministicEvent[] = [];
    if (d.tick >= Number.MAX_SAFE_INTEGER - 36001) throw new Error('Simulation tick limit reached');
    d.tick++;
    this.beforeInputs(events);
    const due = d.pendingInputs; d.pendingInputs = [];
    for (const input of due) {
      if (input.command.type === 'invalid') { this.emit(events, 'INPUT_VALIDATED', 'input', 'rejected', { reason: input.command.reason }, input.sequence); continue; }
      if(this.applyExtendedInput(input,events))continue;
      if (d.tick < d.cooldownUntilTick) { this.emit(events, 'INPUT_VALIDATED', 'input', 'rejected', { reason: 'door_cooldown', cooldownUntilTick: d.cooldownUntilTick }, input.sequence); continue; }
      const accepted = this.emit(events, 'INPUT_VALIDATED', 'input', 'accepted', {}, input.sequence);
      d.door.lastSlamTick = d.tick; d.door.slamCount++; d.cooldownUntilTick = d.tick + d.config.cooldownTicks;
      this.onDoorChanged();
      const action = this.emit(events, 'DOOR_SLAM', 'door', 'applied', { slamCount: d.door.slamCount }, input.sequence, accepted.sequence);
      const sound = this.createDoorSound();
      const acoustic = this.emit(events, 'ACOUSTIC_EVENT', 'sound', 'emitted', {...sound}, input.sequence, action.sequence);
      this.hear(sound, events, input.sequence, acoustic.sequence);
    }
    this.beforeMotorExecution(events);
    const c = d.character, wasMoving = c.moving; c.moving = !this.movementPauseActive()&&this.movementPermitted();
    if (!this.capableOfAction())c.moving=false;
    if (!c.moving) return events;
    if (!wasMoving) this.emit(events, 'WALK_RESUMED', 'movement', 'walking', { waypoint: d.waypoint });
    const [x,z] = this.movementDestination(), dx = x - c.x, dz = z - c.z, distance = Math.hypot(dx,dz);
    const step = Math.min(distance, d.config.speed*this.movementScale() / d.config.hz);
    if (distance > 0.001) {
      c.heading = Math.atan2(dx,dz);const nextX=Math.max(-ROOM.walkX,Math.min(ROOM.walkX,c.x+dx/distance*step)),nextZ=Math.max(-ROOM.walkZ,Math.min(ROOM.walkZ,c.z+dz/distance*step));
      if(!this.canMove(nextX,nextZ)){this.movementBlocked(events);return events;}
      c.x=nextX;c.z=nextZ;c.gait+=step*8;
    }
    if (distance <= step + 0.001) {
      this.movementArrived(events);
    }
    return events;
  }
  hear(sound: AcousticEvent, events: DeterministicEvent[] = [], inputSequence?: number, parentSequence?: number): DeterministicEvent[] {
    // Historical V1/V2/V3 source-intensity semantics remain exact for offline replay.
    // Current SensorySimulation overrides this with listener-relative propagation.
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
export type Experience = SyntheticExperience | RealExperience | InternalExperience;
export interface CheckpointV2 extends Omit<CheckpointV1, 'schemaVersion' | 'rulesVersion'> {
  schemaVersion: 2; rulesVersion: 'lumi-lab-v1'; subjective: SubjectiveClock; activity: ActivityState;
  experiences: SyntheticExperience[]; nextExperienceId: number;
}
export const CURRENT_VISION_RULES='lumi-eyes-v2' as const;
export interface CheckpointV3 extends Omit<CheckpointV2,'schemaVersion'|'rulesVersion'> {schemaVersion:3;rulesVersion:'lumi-eyes-v1'|typeof CURRENT_VISION_RULES;head:HeadState;scene:PhysicalSceneState}
export const CURRENT_ATTENTION_RULES='lumi-attention-v2' as const;
export interface CheckpointV4 extends Omit<CheckpointV3,'schemaVersion'|'rulesVersion'> {schemaVersion:4;rulesVersion:'lumi-attention-v1'|typeof CURRENT_ATTENTION_RULES;attention:AttentionState;genericSoundCount:number}
export interface CheckpointV5 extends Omit<CheckpointV4,'schemaVersion'|'rulesVersion'> {schemaVersion:5;rulesVersion:typeof COGNITION_RULES;cognition:CognitionState;realExperiences:RealExperience[]}
export interface PhysiologyOptions {active?:boolean;genesisPreset?:'production-v1'|'acceptance-fast-v1';encodingEnabled?:boolean}
export interface PhysiologyRuntimeState {
 origin:{historyId:string;genesisPreset:'production-v1'|'acceptance-fast-v1';rulesVersion:typeof PHYSIOLOGY_RULES;evidenceEligibility:'eligible'|'debug-tainted';taintedAtTick:number|null};
 verifiedCheckpointImports:{kind:'explicit-live-checkpoint-import-v1';sourceHistoryId:string;destinationHistoryId:string;importTick:number}[];
 legacyImport:null|{kind:'explicit-unverified-import-v1';sourceHistoryId:string;destinationHistoryId:string;importTick:number};
 encodingEnabled:boolean; encodedNeedCrossings:{kind:InternalSensation['kind'];crossingTick:number;experienceId:number;source:'actual_internal_sensor';observationId:string;attentionId:string;sensedTick:number;attentionTick:number;encodingTick:number;sensationHash:string;identityHash:string}[];
 interruptedActivity:boolean;safetyUntilTick:number;
 unconsciousWindows:{startTick:number;endTick:number|null}[];
}
export interface CheckpointV6 extends Omit<CheckpointV5,'schemaVersion'|'rulesVersion'> {schemaVersion:6;rulesVersion:typeof PHYSIOLOGY_RULES;body:BodyState;interoception:InteroceptionState;physiology:PhysiologyRuntimeState;internalExperiences:InternalExperience[]}
export interface CheckpointV7 extends Omit<CheckpointV6,'schemaVersion'|'rulesVersion'|'interoception'|'physiology'> {schemaVersion:7;rulesVersion:typeof CURRENT_PHYSIOLOGY_RULES;interoception:InteroceptionStateV2;physiology:PhysiologyRuntimeState&{taskCredit:number;taskCreditActivityId:number}}
export interface CheckpointV8 extends Omit<CheckpointV7,'schemaVersion'|'rulesVersion'> {schemaVersion:8;rulesVersion:typeof HOME_RULES;home:HomeState}
export type Checkpoint = CheckpointV1 | CheckpointV2 | CheckpointV3 | CheckpointV4 | CheckpointV5 | CheckpointV6 | CheckpointV7 | CheckpointV8;
function legacyPart(c: CheckpointV2): CheckpointV1 {
  const result = structuredClone(c) as unknown as Record<string, unknown>;
  for (const key of ['subjective','activity','experiences','nextExperienceId']) delete result[key];
  result.schemaVersion = 1; result.rulesVersion = RULES_VERSION;
  return validateCheckpointV1(result);
}
/** Explicit migration: V1 replay remains V1; a new lab run initializes named new systems. */
export function upgradeCheckpoint(value: unknown): CheckpointV2 {
  const cp = validateCheckpoint(value);
  if(cp.schemaVersion>=3)throw new Error('Vision state cannot be downgraded into historical lab semantics');
  if (cp.schemaVersion === 2) return cp;
  return { ...cp, schemaVersion: 2, rulesVersion: 'lumi-lab-v1',
    subjective: { estimateSeconds: 0, uncertaintySeconds: cp.tick / cp.config.hz + 5, lastCalibrationTick: null, driftPpm: 1200, uncertaintyGrowthPerSecond: 0.02 },
    activity: { status:'idle',cursor:0,totalTicks:0,appliedMilestones:[],completionCount:0,activityId:0 }, experiences:[], nextExperienceId:1 };
}
export function validateCheckpoint(value: unknown): Checkpoint {
  if(value&&typeof value==='object'&&(value as {schemaVersion?:unknown}).schemaVersion===8)return validateHomeCheckpoint(value);
  if(value&&typeof value==='object'&&(value as {schemaVersion?:unknown}).schemaVersion===7)return validatePhysiologyCheckpointV2(value);
  if(value&&typeof value==='object'&&(value as {schemaVersion?:unknown}).schemaVersion===6)return validatePhysiologyCheckpoint(value);
  if(value&&typeof value==='object'&&(value as {schemaVersion?:unknown}).schemaVersion===5)return validateCognitionCheckpoint(value);
  if(value&&typeof value==='object'&&(value as {schemaVersion?:unknown}).schemaVersion===4)return validateSensoryCheckpoint(value);
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
  private subjective: SubjectiveClock; protected activity: ActivityState; private experiences: SyntheticExperience[]; private nextExperienceId: number;
  constructor(options: { checkpoint?: unknown; seed?: number; worldId?: string; runId?: string; mode: WorldMode }) {
    const cp = upgradeCheckpoint(options.checkpoint ?? new Simulation({seed:options.seed}).checkpoint());
    super({...options,checkpoint:legacyPart(cp)});
    this.subjective=cp.subjective;this.activity=cp.activity;this.experiences=cp.experiences;this.nextExperienceId=cp.nextExperienceId;
    this.mode=options.mode;
    if(this.mode==='LIVE' && this.experiences.length) throw new Error('Experimental experience cannot enter LIVE');
  }
  readonly mode: WorldMode;
  protected shouldAdvanceActivity():boolean{return true;}
  override step(): DeterministicEvent[] {
    const events=super.step(), dt=1/this.data.config.hz;
    this.subjective.estimateSeconds+=dt*(1+this.subjective.driftPpm/1e6);this.subjective.uncertaintySeconds+=dt*this.subjective.uncertaintyGrowthPerSecond;
    const a=this.activity;
    if(a.status==='running'&&this.shouldAdvanceActivity()) {
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
  override checkpoint():CheckpointV2|CheckpointV3|CheckpointV4|CheckpointV5|CheckpointV6|CheckpointV7|CheckpointV8 {return this.labCheckpoint();}
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
  const raw=object(value,keys,'vision root');if(raw.schemaVersion!==3||!['lumi-eyes-v1',CURRENT_VISION_RULES].includes(raw.rulesVersion as string))fail('incompatible vision rules');
  const cp=value as CheckpointV3;if(!Array.isArray(cp.pendingInputs))fail('vision input queue');
  for(const input of cp.pendingInputs){validateCommand(input.command,true);if(cp.rulesVersion==='lumi-eyes-v1'&&input.command.type==='look_at'&&input.command.evidence&&isCapturedBearingEvidence(input.command.evidence))fail('captured bearing evidence requires current vision rules');}
  visionLabPart(cp);validateHeadState(cp.head,cp.rulesVersion==='lumi-eyes-v1');validatePhysicalSceneState(cp.scene);
  if(cp.head.observedAim&&cp.head.targetYaw!==relativeObservedAim(cp.head.observedAim,cp.character.heading).yaw)fail('observed aim and body orientation disagree');
  if(!canRestoreCharacter(cp.scene,cp.character.x,cp.character.z))fail('character overlaps physical collider');
  return structuredClone(cp);
}
/** Deliberate active-world upgrade; offline V1/V2 replay never calls this. */
export function upgradeVisionCheckpoint(value:unknown):CheckpointV3 {
  const source=validateCheckpoint(value);if(source.schemaVersion>=4)throw new Error('Attention state cannot be downgraded into historical vision semantics');if(source.schemaVersion===3)return {...source,rulesVersion:CURRENT_VISION_RULES,head:source.rulesVersion===CURRENT_VISION_RULES?source.head:{...source.head,observedAim:null}};
  const cp=upgradeCheckpoint(source);
  return {...cp,schemaVersion:3,rulesVersion:CURRENT_VISION_RULES,head:defaultHeadState(),scene:defaultPhysicalSceneState()};
}
export class VisionSimulation extends LabSimulation {
  protected head:HeadState;protected scene:PhysicalSceneState;private readonly visionRules:CheckpointV3['rulesVersion'];
  constructor(options:{checkpoint?:unknown;seed?:number;worldId?:string;runId?:string;mode:WorldMode;historical?:boolean}) {
    const source=validateCheckpoint(options.checkpoint??new Simulation({seed:options.seed}).checkpoint());
    const cp=options.historical&&source.schemaVersion===3?source:upgradeVisionCheckpoint(source);
    super({...options,checkpoint:visionLabPart(cp)});this.data.pendingInputs=structuredClone(cp.pendingInputs);this.head=cp.head;this.scene=cp.scene;this.visionRules=cp.rulesVersion;
  }
  override enqueue(command:NormalizedCommand):{input:OrderedInput;events:DeterministicEvent[]} {
    const normalized=validateCommand(command,true,this.supportsSensoryInputs(),this.supportsCognitionInputs(),this.supportsPhysiologyInputs(),this.supportsHomeInputs());
    if(normalized.type==='look_at'&&normalized.evidence) {
      if(this.visionRules==='lumi-eyes-v1'&&isCapturedBearingEvidence(normalized.evidence))throw new Error('Captured bearing evidence requires current vision rules');
      if(this.visionRules!== 'lumi-eyes-v1'&&!isCapturedBearingEvidence(normalized.evidence))throw new Error('Legacy observation evidence cannot be admitted; capture again');
    }
    return super.enqueue(normalized);
  }
  protected override supportsVisionInputs():boolean{return true;}
  protected override onDoorChanged():void{this.scene.revision++;}
  protected override canMove(x:number,z:number):boolean{return canMoveCharacter(this.scene,this.data.character.x,this.data.character.z,x,z);}
  protected override applyExtendedInput(input:OrderedInput,events:DeterministicEvent[]):boolean {
    const command=input.command;if(command.type==='home_observation'||command.type==='home_layout_fixture'||command.type==='doorbell')return false;if(command.type==='slam'||command.type==='invalid'||command.type==='emit_sound'||command.type==='sensor_feedback'||command.type==='cognition_request'||command.type==='cognition_result'||command.type==='cognition_observation_request'||command.type==='physiology_fixture'||command.type==='physiology_safety_fixture'||command.type==='physiology_encoding')return false;
    const reject=(reason:string)=>{this.emit(events,'INPUT_VALIDATED','head','rejected',{reason,command:command.type},input.sequence);return true;};
    if(command.type==='configure_scene') {
      if(this.mode!=='EXPERIMENT')return reject('scene_fixture_experiment_only');
      const configuration=validateSceneConfiguration({illumination:command.illumination,fixture:command.fixture,fixtureColor:command.fixtureColor,doorOpenRadians:command.doorOpenRadians}),scene={...configuration,revision:this.scene.revision+1};
      if(!canOccupyCharacter(scene,this.data.character.x,this.data.character.z))return reject('fixture_overlaps_character');
      this.scene=scene;this.emit(events,'SCENE_CONFIGURED','scene','applied',{sceneRevision:scene.revision,illumination:scene.illumination,fixture:scene.fixture,fixtureColor:scene.fixtureColor.slice(1),doorOpenRadians:scene.doorOpenRadians??'animated'},input.sequence);return true;
    }
    if(!this.capableOfAction())return reject('physiological_incapacity');
    if(command.sceneRevision!==this.scene.revision)return reject('scene_revision_changed');
    if(command.type==='look_at'&&command.evidence) {
      if(command.evidence.capturedTick>this.data.tick||this.data.tick-command.evidence.capturedTick>300)return reject('observation_expired');
      if(this.visionRules==='lumi-eyes-v1') {
        if(isCapturedBearingEvidence(command.evidence))return reject('incompatible_observation_evidence');
        if(!isTargetEligible(this.snapshot(),command.evidence.engineTargetId,command.evidence.captureWidth,command.evidence.captureHeight))return reject('target_no_longer_visible');
      } else {
        if(!isCapturedBearingEvidence(command.evidence))return reject('legacy_observation_evidence');
        const target=observedHeadTarget(command.evidence,this.data.character.heading);
        if(target.yaw<HEAD_LIMITS.minYaw||target.yaw>HEAD_LIMITS.maxYaw||target.pitch<HEAD_LIMITS.minPitch||target.pitch>HEAD_LIMITS.maxPitch)return reject('observed_bearing_exceeds_head_limits');
      }
    }
    const h=this.head;
    if(h.status!=='idle')this.emit(events,'HEAD_INTERRUPTED','head','cancelled',{actionId:h.activeActionId!,command:command.type},input.sequence);
    if(this.visionRules!== 'lumi-eyes-v1')h.observedAim=null;
    const actionId=h.nextActionId++;
    if(command.type==='cancel_head'){h.status='idle';h.targetYaw=h.yaw;h.targetPitch=h.pitch;h.scan=null;h.activeActionId=null;this.emit(events,'HEAD_CANCELLED','head','idle',{actionId},input.sequence);return true;}
    h.activeActionId=actionId;
    if(command.type==='scan_area') {
      const points=Array.from({length:command.passes*2},(_,i)=>({yaw:i%2===0?command.minYaw:command.maxYaw,pitch:command.pitch}));
      h.status='scanning';h.scan={points,cursor:0};h.targetYaw=points[0].yaw;h.targetPitch=points[0].pitch;
    }else{h.status='turning';h.scan=null;
      // Relative turns use the pose at this ordered execution tick; saturating at
      // anatomical limits is deterministic and never snaps the current pose.
      const observed=command.type==='look_at'&&command.evidence&&isCapturedBearingEvidence(command.evidence)?observedHeadTarget(command.evidence,this.data.character.heading):null;
      if(command.type==='look_at'&&command.evidence&&isCapturedBearingEvidence(command.evidence))h.observedAim=observedWorldDirection(command.evidence);
      h.targetYaw=command.type==='turn_head'?Math.max(HEAD_LIMITS.minYaw,Math.min(HEAD_LIMITS.maxYaw,h.yaw+command.yawDelta)):observed?.yaw??command.yaw;
      h.targetPitch=command.type==='turn_head'?Math.max(HEAD_LIMITS.minPitch,Math.min(HEAD_LIMITS.maxPitch,h.pitch+command.pitchDelta)):observed?.pitch??command.pitch;
    }
    this.emit(events,'HEAD_ACTION_STARTED','head',h.status,{actionId,command:command.type,targetYaw:h.targetYaw,targetPitch:h.targetPitch,sceneRevision:this.scene.revision,...(command.type==='look_at'&&command.evidence?{observationId:command.evidence.observationId,frameHash:command.evidence.frameHash,capturedTick:command.evidence.capturedTick}: {})},input.sequence);
    return true;
  }
  override step():DeterministicEvent[] {
    const events=super.step();this.advanceHead(events);this.afterMotors(events);return events;
  }
  private advanceHead(events:DeterministicEvent[]):void {
    const h=this.head;if(h.status==='idle'||!this.capableOfAction())return;
    if(h.observedAim) {
      // Base movement can turn the body on this same tick. Rebase the perceived
      // ray after that movement, without consulting a target or world geometry.
      const target=relativeObservedAim(h.observedAim,this.data.character.heading);
      if(target.yaw<HEAD_LIMITS.minYaw||target.yaw>HEAD_LIMITS.maxYaw||target.pitch<HEAD_LIMITS.minPitch||target.pitch>HEAD_LIMITS.maxPitch) {
        const actionId=h.activeActionId!;h.status='idle';h.targetYaw=h.yaw;h.targetPitch=h.pitch;h.scan=null;h.activeActionId=null;h.observedAim=null;
        this.emit(events,'HEAD_INTERRUPTED','head','cancelled',{actionId,reason:'observed_direction_out_of_head_range'});return;
      }
      h.targetYaw=target.yaw;h.targetPitch=target.pitch;
    }
    const maximum=HEAD_LIMITS.radiansPerSecond*this.motorScale()/this.data.config.hz,dx=h.targetYaw-h.yaw,dy=h.targetPitch-h.pitch,distance=Math.hypot(dx,dy);
    if(distance<=maximum){h.yaw=h.targetYaw;h.pitch=h.targetPitch;
      if(h.status==='scanning'&&h.scan&&h.scan.cursor+1<h.scan.points.length){h.scan.cursor++;const p=h.scan.points[h.scan.cursor];h.targetYaw=p.yaw;h.targetPitch=p.pitch;this.emit(events,'HEAD_SCAN_POINT','head','next',{actionId:h.activeActionId!,cursor:h.scan.cursor,targetYaw:h.targetYaw,targetPitch:h.targetPitch});}
      else{const actionId=h.activeActionId!;h.status='idle';h.scan=null;h.activeActionId=null;if(this.visionRules!== 'lumi-eyes-v1')h.observedAim=null;this.emit(events,'HEAD_ACTION_COMPLETE','head','idle',{actionId,yaw:h.yaw,pitch:h.pitch});}
    }else{h.yaw+=dx/distance*maximum;h.pitch+=dy/distance*maximum;}
    return;
  }
  override checkpoint():CheckpointV3|CheckpointV4|CheckpointV5|CheckpointV6|CheckpointV7|CheckpointV8{return {...this.labCheckpoint(),schemaVersion:3,rulesVersion:this.visionRules,head:structuredClone(this.head),scene:structuredClone(this.scene)};}
  override snapshot():WorldState{return {...super.snapshot(),head:structuredClone(this.head),scene:structuredClone(this.scene)};}
}

/** V4 validates its new counters/inputs explicitly; the historical V3 projection is
 * used only for common-field validation and construction, never for saved replay. */
function sensoryVisionPart(cp:CheckpointV4):CheckpointV3 {
  const raw=structuredClone(cp) as unknown as Record<string,unknown>;
  delete raw.attention;delete raw.genericSoundCount;raw.schemaVersion=3;raw.rulesVersion=CURRENT_VISION_RULES;
  raw.nextSoundId=cp.door.slamCount+1;
  raw.pendingInputs=cp.pendingInputs.map(input=>({...input,command:input.command.type==='emit_sound'||input.command.type==='sensor_feedback'?{type:'invalid',reason:'unknown_command'}:input.command}));
  return validateVisionCheckpoint(raw);
}
export function validateSensoryCheckpoint(value:unknown):CheckpointV4 {
  const keys=['schemaVersion','rulesVersion','config','tick','character','reflex','door','waypoint','pauseUntilTick','cooldownUntilTick','seed','prng','nextInputSequence','nextEventSequence','nextSoundId','pendingInputs','eventHash','subjective','activity','experiences','nextExperienceId','head','scene','attention','genericSoundCount'];
  const raw=object(value,keys,'sensory root');if(raw.schemaVersion!==4||!['lumi-attention-v1',CURRENT_ATTENTION_RULES].includes(raw.rulesVersion as string))fail('incompatible attention rules');
  const cp=value as CheckpointV4;
  if(!integer(cp.genericSoundCount)||!integer(cp.nextSoundId,1)||cp.nextSoundId!==cp.door.slamCount+cp.genericSoundCount+1||!Array.isArray(cp.pendingInputs))fail('sensory sound counter');
  for(const input of cp.pendingInputs)validateCommand(input.command,true,true);
  sensoryVisionPart(cp);validateAttentionState(cp.attention,cp.tick);
  if(cp.attention.automaticActionId!==null&&cp.head.activeActionId!==cp.attention.automaticActionId)fail('automatic action ownership');
  return structuredClone(cp);
}
export function upgradeSensoryCheckpoint(value:unknown):CheckpointV4 {
  const source=validateCheckpoint(value);
  if(source.schemaVersion===4) {
    if(source.rulesVersion===CURRENT_ATTENTION_RULES)return source;
    const attention=source.attention;
    if(attention.lastReceived)attention.lastReceived={...attention.lastReceived,...deriveHearingEstimates(attention.lastReceived,attention.config.hearingFloor)};
    return {...source,rulesVersion:CURRENT_ATTENTION_RULES,attention};
  }
  const cp=upgradeVisionCheckpoint(source);
  return {...cp,schemaVersion:4,rulesVersion:CURRENT_ATTENTION_RULES,genericSoundCount:0,attention:defaultAttentionState(cp.tick)};
}
const sensorPose=(state:WorldState):SensorPose=>{const p=eyePose(state);return {x:p.position[0],y:p.position[1],z:p.position[2],bodyHeading:p.bodyHeading,headYaw:p.headYaw,headPitch:p.headPitch};};
const angleDifference=(a:number,b:number)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const poseDifference=(a:SensorPose,b:SensorPose)=>({distance:Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z),angle:Math.hypot(angleDifference(a.bodyHeading+a.headYaw,b.bodyHeading+b.headYaw),a.headPitch-b.headPitch)});

/** Local sensing never encodes experiences. All future-affecting sensor feedback is an ordered input. */
export class SensorySimulation extends VisionSimulation {
  private attention:AttentionState;protected genericSoundCount:number;private readonly attentionRules:CheckpointV4['rulesVersion'];
  constructor(options:{checkpoint?:unknown;seed?:number;worldId?:string;runId?:string;mode:WorldMode;historical?:boolean}) {
    const source=options.checkpoint??new Simulation({seed:options.seed}).checkpoint();
    const cp=options.historical&&(source as {schemaVersion?:number}).schemaVersion===4?validateSensoryCheckpoint(source):upgradeSensoryCheckpoint(source);
    super({...options,checkpoint:sensoryVisionPart(cp),historical:true});
    this.data.pendingInputs=structuredClone(cp.pendingInputs);this.data.nextSoundId=cp.nextSoundId;
    this.attention=cp.attention;this.genericSoundCount=cp.genericSoundCount;this.attentionRules=cp.rulesVersion;
  }
  protected override supportsSensoryInputs():boolean{return true;}
  protected override createDoorSound():AcousticEvent&{y:number;sourceId:string} {
    const leaf=physicalSceneSnapshot(this.snapshot()).boxes.find(box=>box.id==='door-leaf')!;
    // The impact emits on its actual posed surface, not at the old fixed coordinate
    // behind the animated leaf. Generic surface-emission propagation handles self-loss.
    return {id:this.data.nextSoundId++,time:this.data.tick/this.data.config.hz,intensity:1,suddenness:1,x:leaf.position[0],y:leaf.position[1],z:leaf.position[2],sourceId:'door-leaf-impact'};
  }
  protected override canMove(x:number,z:number):boolean{return canSweepCharacter(this.scene,this.data.character.x,this.data.character.z,x,z);}
  protected override shouldAdvanceActivity():boolean {return this.data.tick>=this.attention.commitmentUntilTick;}
  override applyAction(action:ControlAction):DeterministicEvent[] {
    const events=super.applyAction(action);
    if(['activity-start','activity-pause','activity-resume'].includes(action.type)&&(this.attention.resumeActivity||this.data.tick<this.attention.commitmentUntilTick)){this.attention.resumeActivity=false;this.attention.commitmentUntilTick=this.data.tick;this.emit(events,'ACTIVITY_ATTENTION_RELEASED','activity','developer_control',{activityId:this.activity.activityId,cursor:this.activity.cursor,reason:action.type});}
    return events;
  }
  override hear(sound:AcousticEvent,events:DeterministicEvent[]=[],inputSequence?:number,parentSequence?:number):DeterministicEvent[] {
    const a=this.attention,c=a.config;
    let propagation;
    try {propagation=propagateSound({x:sound.x,y:'y' in sound?Number(sound.y):1.5,z:sound.z,intensity:sound.intensity,suddenness:sound.suddenness,sourceId:'sourceId' in sound?String(sound.sourceId):`sound-${sound.id}`},this.snapshot(),`heard-${a.nextObservationId}`,c,this.attentionRules==='lumi-attention-v1');}
    catch {this.emit(events,'ACOUSTIC_REJECTED','hearing','invalid_source',{reason:'invalid_or_unknown_source'},inputSequence,parentSequence);return events;}
    a.nextObservationId++;const r=propagation.received;a.lastReceived=structuredClone(r);
    const trace=this.emit(events,'ACOUSTIC_PROPAGATION','hearing','computed',{observationId:r.observationId,sourceX:propagation.source.x,sourceY:propagation.source.y,sourceZ:propagation.source.z,sourceId:propagation.source.sourceId,listenerX:propagation.listener[0],listenerY:propagation.listener[1],listenerZ:propagation.listener[2],distance:propagation.distance,transmission:propagation.transmission,barriers:propagation.barriers.join(' '),barrierGroups:propagation.barrierGroups.join(' '),sceneRevision:this.scene.revision,distanceFalloff:c.distanceFalloff,wallTransmission:c.wallTransmission,doorTransmission:c.doorTransmission,objectTransmission:c.objectTransmission},inputSequence,parentSequence);
    const sensed=this.emit(events,'SOUND_RECEIVED','hearing',r.intensity>=c.hearingFloor?'sensed':'below_floor',{observationId:r.observationId,intensity:r.intensity,suddenness:r.suddenness,bearingDegrees:r.bearingDegrees??'undefined',directionUncertaintyDegrees:r.directionUncertaintyDegrees,distanceBand:r.distanceBand,distanceUncertainty:r.distanceUncertainty,bodyHeading:r.bodyHeading,headYaw:r.headYaw,provenance:r.provenance},inputSequence,trace.sequence);
    const strength=r.intensity>=c.reflexIntensity&&r.suddenness>=c.reflexSuddenness?Math.min(1,r.intensity*r.suddenness):0;
    const reflex=this.emit(events,'REFLEX_DECISION','reflex',strength>0?'triggered':'ignored',{observationId:r.observationId,intensity:r.intensity,suddenness:r.suddenness,intensityThreshold:c.reflexIntensity,suddennessThreshold:c.reflexSuddenness,strength},inputSequence,sensed.sequence);
    if(strength>0){this.data.reflex={startTick:this.data.tick,strength};this.emit(events,'REFLEX_STATE','reflex','changed',{observationId:r.observationId,startTick:this.data.tick,strength,durationSeconds:REFLEX_DURATION},inputSequence,reflex.sequence);}
    const key=`b${r.bearingDegrees===null?'null':Math.round(r.bearingDegrees/45)}-i${Math.floor(r.intensity*5)}-s${Math.floor(r.suddenness*3)}`;
    const audible=r.intensity>=c.hearingFloor&&this.capableOfAttention();
    // Diagnostics retain below-floor receptions, but only perceived cues can
    // decay, evict or add habituation history.
    if(audible)a.exposures=a.exposures.filter(e=>this.data.tick-e.lastTick<c.exposureRecoveryTicks);
    let exposure=audible?a.exposures.find(e=>e.key===key):undefined;
    const previous=exposure?Math.max(0,exposure.count-Math.floor((this.data.tick-exposure.lastTick)/(c.exposureRecoveryTicks/4))):0;
    const novelty=1/(1+previous),commitment=this.activity.status==='running'?.18:0,switchingCost=this.data.tick<a.commitmentUntilTick?.3:0;
    const score=this.ordinaryAttentionScale()*(.65*r.intensity+.3*r.suddenness+.3*novelty+.1*(r.directionUncertaintyDegrees/180)-Math.min(.9,previous*c.habituationPenalty)-commitment-switchingCost);
    if(audible) {
      if(!exposure){exposure={key,count:0,lastTick:this.data.tick,intensity:r.intensity,suddenness:r.suddenness};a.exposures.push(exposure);if(a.exposures.length>8)a.exposures.shift();}
      exposure.count=Math.min(32,previous+1);exposure.lastTick=this.data.tick;exposure.intensity=r.intensity;exposure.suddenness=r.suddenness;
    }
    let reason='below_salience',outcome:'ignored'|'glance'|'investigate'|'unreachable'='ignored';
    if(!this.capableOfAttention())reason='physiological_incapacity';
    else if(r.intensity<c.hearingFloor)reason='below_hearing_floor';
    else if(this.data.tick<a.developerUntilTick)reason='developer_priority';
    else if(this.data.tick<a.cooldownUntilTick)reason='attention_cooldown';
    else if(this.head.status!=='idle')reason='motor_committed';
    else if(score>=c.glanceThreshold){outcome=score>=c.investigateThreshold?'investigate':'glance';reason='salient_received_cue';}
    if(outcome!=='ignored'&&r.bearingDegrees===null){outcome='unreachable';reason='direction_undefined';}
    const decision=this.emit(events,'ATTENTION_DECISION','attention',outcome,{observationId:r.observationId,score,novelty,exposure:previous,commitment,switchingCost,reason,attended:outcome!=='ignored',encoded:false},inputSequence,sensed.sequence);
    a.lastDecision={tick:this.data.tick,observationId:r.observationId,outcome,score,novelty,exposure:previous,commitment,switchingCost,reason};
    if(outcome==='ignored')return events;
    a.cooldownUntilTick=this.data.tick+c.attentionCooldownTicks;a.commitmentUntilTick=this.data.tick+c.commitmentTicks;
    if(this.activity.status==='running'&&!a.resumeActivity){a.resumeActivity=true;this.emit(events,'ACTIVITY_ATTENTION_PAUSED','activity','interrupted',{activityId:this.activity.activityId,cursor:this.activity.cursor,untilTick:a.commitmentUntilTick},inputSequence,decision.sequence);}
    if(r.bearingDegrees===null){this.requestCapture('salient_sound',events,decision.sequence);return events;}
    const worldYaw=Math.atan2(Math.sin(r.bodyHeading+r.headYaw+r.bearingDegrees*Math.PI/180),Math.cos(r.bodyHeading+r.headYaw+r.bearingDegrees*Math.PI/180));
    const target=angleDifference(worldYaw,this.data.character.heading),reachable=target>=HEAD_LIMITS.minYaw&&target<=HEAD_LIMITS.maxYaw;
    const command:HeadAction={type:'look_at',yaw:Math.max(HEAD_LIMITS.minYaw,Math.min(HEAD_LIMITS.maxYaw,target)),pitch:this.head.pitch,sceneRevision:this.scene.revision};
    const actionId=this.head.nextActionId;
    super.applyExtendedInput({sequence:inputSequence??Math.max(1,this.data.nextInputSequence-1),receivedTick:this.data.tick,applyTick:this.data.tick,command,admission:'queued'},events);
    if(reachable)this.head.observedAim={worldYaw,pitch:this.head.targetPitch};
    else {a.lastDecision.outcome='unreachable';a.lastDecision.reason='direction_outside_head_range';}
    a.automaticActionId=actionId;a.automaticObservationId=r.observationId;
    this.emit(events,'ATTENTION_ACTION','attention',reachable?'started':'bounded_unreachable',{observationId:r.observationId,actionId,bearingDegrees:r.bearingDegrees,targetYaw:this.head.targetYaw,targetPitch:this.head.targetPitch,reason:reachable?'perceived_direction':'direction_outside_head_range'},inputSequence,decision.sequence);
    return events;
  }
  protected override applyExtendedInput(input:OrderedInput,events:DeterministicEvent[]):boolean {
    const command=input.command;
    if(command.type==='emit_sound') {
      if(this.mode!=='EXPERIMENT'){this.emit(events,'INPUT_VALIDATED','hearing','rejected',{reason:'sound_fixture_experiment_only'},input.sequence);return true;}
      const accepted=this.emit(events,'INPUT_VALIDATED','hearing','accepted',{provenance:'TEST STUB'},input.sequence);
      const sound={...command,id:this.data.nextSoundId++,time:this.data.tick/this.data.config.hz};this.genericSoundCount++;
      const emission=this.emit(events,'ACOUSTIC_EVENT','sound','emitted',{id:sound.id,time:sound.time,x:sound.x,y:sound.y,z:sound.z,intensity:sound.intensity,suddenness:sound.suddenness,sourceId:sound.sourceId,provenance:'TEST STUB'},input.sequence,accepted.sequence);
      this.hear(sound,events,input.sequence,emission.sequence);return true;
    }
    if(command.type==='sensor_feedback'){this.applySensorFeedback(command,events,input.sequence);return true;}
    return this.applyHeadInput(input,events,'developer');
  }
  /** Both sources use the same local head validation. Only a developer command
   * acquires developer priority over subsequent local sensory attention. */
  protected applyHeadInput(input:OrderedInput,events:DeterministicEvent[],source:'developer'|'cognition'):boolean {
    const command=input.command,a=this.attention;
    // Accepted head commands, including cancel, consume an action ID. Arbitrate
    // only after that acceptance boundary and before the next ordered input.
    const nextActionId=this.head.nextActionId,handled=super.applyExtendedInput(input,events);
    if(source==='developer'&&['turn_head','look_at','scan_area','cancel_head'].includes(command.type)&&this.head.nextActionId!==nextActionId) {
      a.developerUntilTick=this.data.tick+a.config.developerPriorityTicks;
      if(a.automaticActionId!==null)this.emit(events,'ATTENTION_ACTION','attention','interrupted',{actionId:a.automaticActionId,observationId:a.automaticObservationId!,reason:'developer_override'},input.sequence);
      a.automaticActionId=null;a.automaticObservationId=null;
    }
    return handled;
  }
  private noteCaptureTrigger(intent:CaptureIntent,reason:AutomaticCaptureReason,tick:number,parentSequence:number|null):void {
    const matching=intent.triggers.map((trigger,index)=>({trigger,index})).filter(({trigger})=>trigger.reason===reason),next={reason,tick,parentSequence};
    if(matching.length<2){if(!matching.length||matching[0].trigger.tick!==tick)intent.triggers.push(next);}
    else if(tick>=matching[1].trigger.tick)intent.triggers[matching[1].index]=next;
  }
  protected sensoryCaptureAllowed(capturedTick:number):boolean{void capturedTick;return this.capableOfAttention();}
  protected requestCapture(reason:AutomaticCaptureReason,events:DeterministicEvent[],parentSequence:number|null=null,triggerTick=this.data.tick):void {
    if(!this.capableOfAttention())return;
    const a=this.attention,tick=this.data.tick,c=a.config;
    if(a.pending?.status==='pending'){this.noteCaptureTrigger(a.pending,reason,triggerTick,parentSequence);if(!a.pending.reasons.includes(reason)){a.pending.reasons.push(reason);this.emit(events,'CAPTURE_INTENTION','attention','coalesced',{intentId:a.pending.id,reasons:a.pending.reasons.join(' '),reason},undefined,parentSequence??undefined);}return;}
    // A submitted image is immutable history. Later causes require a later image;
    // one bounded deferred intention coalesces them without relabeling the old frame.
    if(a.pending?.status==='submitted'||a.deferred) {
      if(!a.deferred){a.deferred={id:a.nextIntentId++,createdTick:triggerTick,expiresTick:triggerTick+c.intentionLifetimeTicks,reasons:[reason],triggers:[{reason,tick:triggerTick,parentSequence}],parentSequence,status:'pending',captureId:null,requestedTick:null};this.emit(events,'CAPTURE_INTENTION','attention','deferred',{intentId:a.deferred.id,reasons:reason,createdTick:triggerTick,expiresTick:a.deferred.expiresTick,reason:'new_cause_after_snapshot'},undefined,parentSequence??undefined);}
      else {this.noteCaptureTrigger(a.deferred,reason,triggerTick,parentSequence);if(!a.deferred.reasons.includes(reason)){a.deferred.reasons.push(reason);this.emit(events,'CAPTURE_INTENTION','attention','coalesced_deferred',{intentId:a.deferred.id,reasons:a.deferred.reasons.join(' '),reason},undefined,parentSequence??undefined);}}
      return;
    }
    if(tick-a.captureWindowStartTick>=c.captureWindowTicks){a.captureWindowStartTick=tick;a.capturesInWindow=0;}
    const suppressed=tick<a.retryAfterTick?'logical_backoff':tick<a.captureCooldownUntilTick?'logical_cooldown':a.capturesInWindow>=c.maxCapturesPerWindow?'world_time_quota':null;
    if(suppressed) {
      if(!a.lastSuppression||a.lastSuppression.cause!==suppressed||a.lastSuppression.reason!==reason||tick-a.lastSuppression.tick>=c.captureCooldownTicks){a.lastSuppression={tick,reason,cause:suppressed};this.emit(events,'CAPTURE_POLICY','attention','suppressed',{reason,reasons:reason,cause:suppressed},undefined,parentSequence??undefined);}
      return;
    }
    a.pending={id:a.nextIntentId++,createdTick:tick,expiresTick:tick+c.intentionLifetimeTicks,reasons:[reason],triggers:[{reason,tick:triggerTick,parentSequence}],parentSequence,status:'pending',captureId:null,requestedTick:null};
    a.captureCooldownUntilTick=tick+c.captureCooldownTicks;a.capturesInWindow++;
    this.emit(events,'CAPTURE_INTENTION','attention','requested',{intentId:a.pending.id,reasons:reason,expiresTick:a.pending.expiresTick},undefined,parentSequence??undefined);
  }
  private applySensorFeedback(command:SensorFeedbackCommand,events:DeterministicEvent[],inputSequence:number):void {
    const a=this.attention,p=a.pending,c=a.config,tick=this.data.tick;
    const reject=(reason:string)=>this.emit(events,'CAPTURE_FEEDBACK','attention','rejected',{intentId:command.intentId,captureId:command.captureId??'none',capturedTick:command.capturedTick,reason},inputSequence);
    if(!p||p.id!==command.intentId){reject('no_matching_intention');return;}
    if(!this.sensoryCaptureAllowed(command.capturedTick)){reject('unconscious_capture');return;}
    if(command.capturedTick>tick){reject('future_snapshot');return;}
    if(command.capturedTick<p.createdTick){reject('snapshot_predates_intention');return;}
    if(command.stage==='admitted') {
      if(p.status!=='pending'){reject('already_submitted');return;}
      const laterTriggers=p.triggers.filter(trigger=>trigger.tick>command.capturedTick);
      p.triggers=p.triggers.filter(trigger=>trigger.tick<=command.capturedTick);p.reasons=p.reasons.filter(reason=>p.triggers.some(trigger=>trigger.reason===reason));
      if(!p.reasons.length){reject('snapshot_predates_all_triggers');return;}
      p.status='submitted';p.captureId=command.captureId;p.requestedTick=command.capturedTick;
      for(const trigger of laterTriggers)this.requestCapture(trigger.reason,events,trigger.parentSequence,trigger.tick);
      this.emit(events,'CAPTURE_POLICY','attention','admitted',{intentId:p.id,captureId:command.captureId!,capturedTick:command.capturedTick,reasons:p.reasons.join(' ')},inputSequence,p.parentSequence??undefined);return;
    }
    if(command.stage==='result'&&(p.status!=='submitted'||p.captureId!==command.captureId||p.requestedTick!==command.capturedTick)){reject('capture_association_mismatch');return;}
    let freshness='missing',difference:number|null=null;
    if(command.stage==='result'&&command.outcome==='success') {
      // Captured-while-awake evidence is necessary but does not create attention
      // while unconscious. Already-attended cognition requests complete separately.
      if(!this.capableOfAttention()){reject('physiological_incapacity');return;}
      const delta=poseDifference(command.pose,sensorPose(this.snapshot()));
      // Scene revision is capture provenance, not perceived evidence. Keep the
      // old freshness rule only for exact v1 replay; v2 compares recorded pixels.
      freshness=command.capturedTick<=a.lastAcceptedCaptureTick?'superseded':tick-command.capturedTick>c.resultMaxAgeTicks?'age_expired':this.attentionRules==='lumi-attention-v1'&&command.sceneRevision!==this.scene.revision?'scene_changed':delta.distance>2||delta.angle>Math.PI/3?'pose_changed':'applicable';
      if(freshness==='applicable') {
        const baseline=a.baseline,expected=baseline?poseDifference(command.pose,baseline.pose):null;
        difference=baseline?imageSignatureDifference(command.signature!,baseline.signature):null;
        const stable=expected!==null&&expected.distance<.15&&expected.angle<.08;
        const changed=stable&&difference!==null&&difference>=c.visualChangeThreshold;
        if(changed){if(!p.reasons.includes('visible_change'))p.reasons.push('visible_change');this.emit(events,'VISUAL_CHANGE','attention','attended',{intentId:p.id,captureId:command.captureId!,capturedTick:command.capturedTick,difference:difference!,reason:'measured_image_change',reasons:p.reasons.join(' '),encoded:false},inputSequence,p.parentSequence??undefined);}
        else this.emit(events,'VISUAL_COMPARISON','attention',baseline&&difference!==null&&difference<c.visualChangeThreshold?'duplicate_suppressed':stable?'unchanged':'viewpoint_baseline',{intentId:p.id,captureId:command.captureId!,capturedTick:command.capturedTick,difference:difference??0,reason:stable?'image_evidence':'expected_viewpoint_motion'},inputSequence,p.parentSequence??undefined);
        a.baseline={capturedTick:command.capturedTick,sceneRevision:command.sceneRevision,pose:structuredClone(command.pose),signature:structuredClone(command.signature!),frameHash:command.frameHash!,captureId:command.captureId!};a.lastAcceptedCaptureTick=command.capturedTick;a.failureCount=0;
      }
    }
    if(command.outcome!=='success'||freshness!=='applicable') {
      a.failureCount=Math.min(32,a.failureCount+1);a.retryAfterTick=tick+Math.min(c.maxRetryBackoffTicks,c.retryBackoffTicks*2**Math.min(8,a.failureCount-1));
    }
    a.lastCapture={intentId:p.id,captureId:command.captureId,capturedTick:command.capturedTick,receivedTick:tick,outcome:command.outcome,freshness,difference,reasons:[...p.reasons]};
    this.emit(events,'CAPTURE_FEEDBACK','attention',command.outcome,{intentId:p.id,captureId:command.captureId??'none',capturedTick:command.capturedTick,receivedTick:tick,freshness,difference:difference??0,reasons:p.reasons.join(' '),frameHash:command.frameHash??'none',stage:command.stage},inputSequence,p.parentSequence??undefined);
    a.pending=null;a.nextProbeTick=tick+c.probeIntervalTicks;
  }
  override step():DeterministicEvent[] {
    const a=this.attention,events=super.step(),tick=this.data.tick;
    if(a.resumeActivity&&tick>=a.commitmentUntilTick){a.resumeActivity=false;this.emit(events,'ACTIVITY_ATTENTION_RESUMED','activity','resumed',{activityId:this.activity.activityId,cursor:this.activity.cursor});}
    const automatic=a.automaticActionId;
    if(automatic!==null&&this.head.activeActionId!==automatic) {
      const completion=events.find(e=>(e.type==='HEAD_ACTION_COMPLETE'||e.type==='HEAD_INTERRUPTED')&&e.data.actionId===automatic);
      const action=this.emit(events,'ATTENTION_ACTION','attention',completion?.type==='HEAD_ACTION_COMPLETE'?'completed':'interrupted',{actionId:automatic,observationId:a.automaticObservationId!,reason:completion?.type==='HEAD_ACTION_COMPLETE'?'motor_complete':'motor_cancelled'},undefined,completion?.sequence);
      a.automaticActionId=null;a.automaticObservationId=null;this.requestCapture('salient_sound',events,action.sequence);this.requestCapture('head_milestone',events,action.sequence);
    }
    for(const event of events) {
      if(event.type==='HEAD_ACTION_COMPLETE'&&event.data.actionId!==automatic)this.requestCapture('head_milestone',events,event.sequence);
      if(event.type==='ACTIVITY_COMPLETE')this.requestCapture('activity_outcome',events,event.sequence);
    }
    if(a.pending&&tick>a.pending.expiresTick) {this.emit(events,'CAPTURE_POLICY','attention','expired',{intentId:a.pending.id,reasons:a.pending.reasons.join(' '),reason:'logical_opportunity_expired'},undefined,a.pending.parentSequence??undefined);a.pending=null;a.retryAfterTick=Math.max(a.retryAfterTick,tick+a.config.retryBackoffTicks);}
    if(a.deferred&&tick>a.deferred.expiresTick){this.emit(events,'CAPTURE_POLICY','attention','expired',{intentId:a.deferred.id,reasons:a.deferred.reasons.join(' '),reason:'deferred_opportunity_expired'},undefined,a.deferred.parentSequence??undefined);a.deferred=null;}
    if(!a.pending&&a.deferred&&tick>=a.captureCooldownUntilTick&&tick>=a.retryAfterTick) {
      if(tick-a.captureWindowStartTick>=a.config.captureWindowTicks){a.captureWindowStartTick=tick;a.capturesInWindow=0;}
      if(a.capturesInWindow<a.config.maxCapturesPerWindow){a.pending=a.deferred;a.deferred=null;a.capturesInWindow++;a.captureCooldownUntilTick=tick+a.config.captureCooldownTicks;this.emit(events,'CAPTURE_INTENTION','attention','promoted',{intentId:a.pending.id,reasons:a.pending.reasons.join(' '),createdTick:a.pending.createdTick,expiresTick:a.pending.expiresTick},undefined,a.pending.parentSequence??undefined);}
    }
    if(this.head.status==='idle') {
      if(tick>=a.nextProbeTick){this.requestCapture('uncertainty_probe',events);a.nextProbeTick=tick+a.config.probeIntervalTicks;}
      if(a.baseline) {const delta=poseDifference(sensorPose(this.snapshot()),a.baseline.pose);if(delta.distance>=a.config.viewpointDistance||delta.angle>=a.config.viewpointRadians)this.requestCapture('viewpoint_change',events);}
    }
    return events;
  }
  override checkpoint():CheckpointV4|CheckpointV5|CheckpointV6|CheckpointV7|CheckpointV8 {return {...super.checkpoint(),schemaVersion:4,rulesVersion:this.attentionRules,attention:structuredClone(this.attention),genericSoundCount:this.genericSoundCount};}
  attentionState():AttentionState{return structuredClone(this.attention);}
}
function cognitionSensoryPart(cp:CheckpointV5):CheckpointV4 {
 const raw=structuredClone(cp) as unknown as Record<string,unknown>;delete raw.cognition;delete raw.realExperiences;raw.schemaVersion=4;raw.rulesVersion=CURRENT_ATTENTION_RULES;
 raw.pendingInputs=cp.pendingInputs.map(input=>({...input,command:input.command.type==='cognition_request'||input.command.type==='cognition_result'||input.command.type==='cognition_observation_request'?{type:'invalid',reason:'unknown_command'}:input.command}));
 return validateSensoryCheckpoint(raw);
}
const sameIdentity=(a:CognitionIdentity,b:CognitionIdentity)=>canonicalStringify(a)===canonicalStringify(b);
export function validateCognitionCheckpoint(value:unknown):CheckpointV5 {
 const cp=value as CheckpointV5;
 object(cp,[...Object.keys(new SensorySimulation({mode:'EXPERIMENT'}).checkpoint()),'cognition','realExperiences'],'cognition root');
 if(cp.schemaVersion!==5||cp.rulesVersion!==COGNITION_RULES)fail('cognition schema/rules');cognitionSensoryPart(cp);
 for(const input of cp.pendingInputs)validateCommand(input.command,true,true,true);
 const c=cp.cognition;object(c,['identity','requests','nextRequestTick','actionCooldownUntilTick','responses','firstRequestTick','lastResponseTick','observationRequestedTick','captureUpgrade'],'cognition state');validateCognitionIdentity(c.identity);
 if(!integer(c.nextRequestTick)||!integer(c.actionCooldownUntilTick)||!integer(c.responses)||!(c.firstRequestTick===null||integer(c.firstRequestTick,0,cp.tick))||!(c.lastResponseTick===null||integer(c.lastResponseTick,0,cp.tick))||!(c.observationRequestedTick===null||integer(c.observationRequestedTick,0,cp.tick))||!Array.isArray(c.requests)||c.requests.length>COGNITION_LIMITS.requests||!Array.isArray(cp.realExperiences)||cp.realExperiences.length>COGNITION_LIMITS.experiences)fail('cognition bounds');
 if(c.captureUpgrade!==null){const u=c.captureUpgrade;object(u,['requestId','captureId','requestedTick','status'],'capture upgrade');if(typeof u.requestId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(u.requestId)||typeof u.captureId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(u.captureId)||!integer(u.requestedTick,0,cp.tick)||!['pending','requested','expired'].includes(u.status))fail('capture upgrade');}
 const ids=new Set<string>();for(const r of c.requests){object(r,['request','requestedTick','status','resultTick','result','action','encoding'],'cognition request');validateCognitionCommand(r.request);if(r.request.type!=='cognition_request'||ids.has(r.request.requestId)||!integer(r.requestedTick,0,cp.tick)||!['pending','completed'].includes(r.status)||!(r.resultTick===null||integer(r.resultTick,r.requestedTick,cp.tick))||(r.status==='pending')!==(r.result===null)||(r.result===null)!==(r.resultTick===null))fail('cognition request status');ids.add(r.request.requestId);if(r.result){validateCognitionCommand(r.result);if(r.result.requestId!==r.request.requestId||!sameIdentity(r.result.identity,r.request.selection.identity))fail('cognition result association');}if(r.action)validateActionOutcome(r.action,cp.tick);if(r.encoding){object(r.encoding,['status','reason','experienceId'],'encoding outcome');if(!['admitted','rejected','failed'].includes(r.encoding.status)||typeof r.encoding.reason!=='string'||r.encoding.reason.length>100||!(r.encoding.experienceId===null||integer(r.encoding.experienceId,1,cp.realExperiences.length)))fail('encoding outcome');}}
 if(c.requests.filter(r=>r.status==='pending').length>COGNITION_LIMITS.pending)fail('pending cognition capacity');
 const encodingIds=new Set<string>();for(const [index,e] of cp.realExperiences.entries()){
  object(e,['id','tick','kind','provenance','encodingId','identity','requestId','captureId','observationId','frameHash','source','capturedTick','attentionTick','interpretationTick','encodedTick','interpretation','uncertainty','evidenceHandles','actionOutcome'],'real experience');validateCognitionIdentity(e.identity);
  const r=c.requests.find(r=>r.request.requestId===e.requestId),s=r?.request.selection,p=r?.result?.proposal;
  if(e.id!==index+1||e.kind!=='perception'||e.provenance!=='ATTENDED_RENDERER_INTERPRETATION'||e.source!=='actual_renderer'||!s||s.source!=='actual_renderer'||r?.request.purpose!=='interpretation'||!p||r?.encoding?.status!=='admitted'||r.encoding.experienceId!==e.id||e.encodingId!==`${s.identity.historyId}_${r.request.requestId}`||encodingIds.has(e.encodingId)||!sameIdentity(e.identity,s.identity)||e.captureId!==s.captureId||e.observationId!==s.observationId||e.frameHash!==s.frameHash||e.capturedTick!==s.capturedTick||e.attentionTick!==s.attentionTick||e.interpretationTick!==r.resultTick||e.encodedTick!==e.tick||!integer(e.encodedTick,e.interpretationTick,cp.tick)||e.interpretation!==p.interpretation||e.uncertainty!==p.uncertainty||canonicalStringify(e.evidenceHandles)!==canonicalStringify(p.evidenceHandles)||canonicalStringify(e.actionOutcome)!==canonicalStringify(r.action?.status==='executed'?r.action:null))fail('real experience provenance');encodingIds.add(e.encodingId);
 }
 return structuredClone(cp);
}
function validateActionOutcome(a:CognitionActionOutcome,tick:number){object(a,['status','reason','actionId','tick'],'cognition action outcome');if(!['executed','rejected'].includes(a.status)||typeof a.reason!=='string'||a.reason.length>100||!(a.actionId===null||integer(a.actionId,1))||!integer(a.tick,0,tick))fail('cognition action outcome');}
/** External callbacks supply only complete ordered commands; this class owns all consequences. */
export class CognitionSimulation<C extends CheckpointV5|CheckpointV6|CheckpointV7|CheckpointV8 = CheckpointV5> extends SensorySimulation {
 protected cognition:CognitionState;private realExperiences:RealExperience[];private experienceAncestry:{historyId:string;afterTick:number;throughTick:number}[]|null=null;
 constructor(options:{checkpoint?:unknown;seed?:number;worldId?:string;runId?:string;branchId?:string;historyId?:string;mode:WorldMode;historical?:boolean;physiologyAncestry?:CheckpointV6|CheckpointV7|CheckpointV8}){
  const source=validateCheckpoint(options.checkpoint??new Simulation({seed:options.seed}).checkpoint());
  const cp=source.schemaVersion===5?source:null;
  super({...options,checkpoint:cp?cognitionSensoryPart(cp):source,historical:false});
  const identity:CognitionIdentity={worldId:options.worldId??'offline-world',runId:options.runId??'offline-run',branchId:options.branchId??'offline-branch',historyId:options.historyId??cp?.cognition.identity.historyId??'offline-history',mode:options.mode};validateCognitionIdentity(identity);
  this.cognition=cp?structuredClone(cp.cognition):{identity,requests:[],nextRequestTick:0,actionCooldownUntilTick:0,responses:0,firstRequestTick:null,lastResponseTick:null,observationRequestedTick:null,captureUpgrade:null};
  this.realExperiences=structuredClone(cp?.realExperiences??[]);
  if(cp){this.data.pendingInputs=structuredClone(cp.pendingInputs);if(!options.historical)this.cognition.identity=identity;}
  if(options.physiologyAncestry){const ancestry=validateCheckpoint(options.physiologyAncestry) as CheckpointV6|CheckpointV7|CheckpointV8;if(!cp||hashCanonical(cp)!==hashCanonical(physiologyCognitionPart(ancestry))||this.cognition.identity.historyId!==ancestry.cognition.identity.historyId)throw new Error('Cognition ancestry requires the matching validated physiology checkpoint');this.experienceAncestry=experienceEpochs(ancestry);}
  if(this.mode==='LIVE'&&(this.realExperiences.some(e=>e.identity.mode!=='LIVE'||!this.admitsExperienceHistory(e.identity.historyId,e.encodedTick))||cp&&cp.cognition.identity.mode!=='LIVE'))throw new Error('Experimental experience cannot enter LIVE');
 }
 protected admitsExperienceHistory(historyId:string,encodedTick:number):boolean{return this.experienceAncestry?this.experienceAncestry.some(e=>e.historyId===historyId&&encodedTick>e.afterTick&&encodedTick<=e.throughTick):historyId===this.cognition.identity.historyId;}
 protected override supportsCognitionInputs():boolean{return true;}
 protected override additionalInputCapacityReason(input:OrderedInput):string|null {
  return fitsCognitionStorage({...this.checkpoint(),pendingInputs:[...this.data.pendingInputs,input]})?null:'checkpoint_capacity';
 }
 override applyAction(action:ControlAction):DeterministicEvent[]{
  if((action.type==='activity-start'||action.type==='synthetic-cue'||action.type==='synthetic-clock')&&!fitsCognitionStorage(this.checkpoint()))throw new Error('Checkpoint capacity prevents additional activity or synthetic experience');
  return super.applyAction(action);
 }
 cognitionState():CognitionState{return structuredClone(this.cognition);}
 admittedExperiences():RealExperience[]{return structuredClone(this.realExperiences);}
 experienceRecords():Experience[]{return structuredClone([...super.checkpoint().experiences,...this.realExperiences]);}
 private applyObservationRequest(command:CognitionObservationRequestCommand,events:DeterministicEvent[],sequence:number){
  const c=this.cognition,a=this.attentionState(),b=a.baseline,last=a.lastCapture;
  const reason=!this.capableOfAttention()?'physiological_incapacity':!sameIdentity(command.identity,c.identity)?'foreign_identity':c.captureUpgrade?.captureId===command.captureId?'duplicate_upgrade':!b||!last||b.captureId!==command.captureId||b.frameHash!==command.frameHash||last.intentId!==command.intentId||last.captureId!==command.captureId||last.outcome!=='success'||last.freshness!=='applicable'||!last.reasons.includes('visible_change')?'unselected_visual_change':this.data.tick-b.capturedTick>COGNITION_LIMITS.resultMaxAgeTicks?'stale_selection':null;
  if(reason){this.emit(events,'COGNITION_OBSERVATION','cognition','rejected',{requestId:command.requestId,captureId:command.captureId,reason},sequence);return;}
  c.captureUpgrade={requestId:command.requestId,captureId:command.captureId,requestedTick:this.data.tick,status:'pending'};c.observationRequestedTick=this.data.tick;
  this.emit(events,'COGNITION_OBSERVATION','cognition','upgrade_pending',{requestId:command.requestId,captureId:command.captureId,frameHash:command.frameHash,intentId:command.intentId,reason:'selected_visual_change_requires_richer_image'},sequence);
 }
 protected cognitionInternalContextAllowed(context:CognitionRequestCommand['selection']['context']):boolean{return context.internalSensations===undefined;}
 private applyRequest(command:CognitionRequestCommand,events:DeterministicEvent[],sequence:number){
  const c=this.cognition,s=command.selection,a=this.attentionState(),b=a.baseline,last=a.lastCapture,tick=this.data.tick;
  let reason:string|null=null;
  if(!this.capableOfAttention())reason='physiological_incapacity';else if(!this.sensoryCaptureAllowed(s.capturedTick))reason='unconscious_capture';else if(!sameIdentity(s.identity,c.identity))reason='foreign_identity';else if(c.requests.some(r=>r.request.requestId===command.requestId))reason='duplicate_request';else if(c.requests.length>=COGNITION_LIMITS.requests)reason='request_history_capacity';else if(c.requests.filter(r=>r.status==='pending').length>=COGNITION_LIMITS.pending)reason='pending_capacity';else if(tick<c.nextRequestTick)reason='request_cooldown';
  else if(!b||!last||last.outcome!=='success'||last.freshness!=='applicable'||last.captureId!==s.captureId||last.intentId!==s.intentId||b.captureId!==s.captureId||b.frameHash!==s.frameHash||b.capturedTick!==s.capturedTick||last.receivedTick!==s.attentionTick||canonicalStringify(b.pose)!==canonicalStringify(s.pose))reason='unselected_sensor_evidence';
  else if(!last.reasons.some(r=>['salient_sound','head_milestone','visible_change','activity_outcome'].includes(r))&&!(c.observationRequestedTick!==null&&s.capturedTick>=c.observationRequestedTick))reason='observation_not_attended';
  else if(s.attentionTick>tick||tick-s.capturedTick>COGNITION_LIMITS.resultMaxAgeTicks)reason='stale_selection';else if(s.source!=='actual_renderer'&&this.mode==='LIVE')reason='test_source_not_live';
  else if(!this.cognitionInternalContextAllowed(s.context))reason='unattended_internal_context';
  else if(currentCognitionProfile(command)&&s.context.shapes.some(shape=>shape.uncertainty!=='geometry_candidates_pixel_checked'))reason='unqualified_shape_context';
  else if(s.context.activity.status!==this.activity.status||s.context.experiences.some(e=>!this.realExperiences.some(old=>this.admitsExperienceHistory(old.identity.historyId,old.encodedTick)&&old.interpretation===e.interpretation&&old.uncertainty===e.uncertainty&&(!currentCognitionProfile(command)||c.requests.some(r=>r.request.requestId===old.requestId&&r.request.purpose==='interpretation'&&currentCognitionProfile(r.request))))))reason='unadmitted_context';
  else if(s.context.sound!==null){const received=a.lastReceived;if(!received)reason='unreceived_sound';else{const {tick:ignoreTick,bodyHeading:ignoreBody,headYaw:ignoreHead,...sound}=received;void ignoreTick;void ignoreBody;void ignoreHead;if(received.tick>s.capturedTick||a.lastDecision?.observationId!==received.observationId||a.lastDecision.outcome==='ignored'||canonicalStringify({...sound,relation:received.tick===s.capturedTick?'same_capture':'before_image',ageBand:s.capturedTick-received.tick<=90?'recent':'earlier'})!==canonicalStringify(s.context.sound))reason='unreceived_sound';}}
  if(reason){this.emit(events,'COGNITION_REQUEST','cognition','rejected',{requestId:command.requestId,reason},sequence);return;}
  const candidate={request:structuredClone(command),requestedTick:tick,status:'pending' as const,resultTick:null,result:null,action:null,encoding:null};
  if(!fitsCognitionStorage({...this.checkpoint(),cognition:{...c,requests:[...c.requests,candidate]}})){this.emit(events,'COGNITION_REQUEST','cognition','rejected',{requestId:command.requestId,reason:'checkpoint_capacity'},sequence);return;}
  c.requests.push(candidate);c.nextRequestTick=tick+COGNITION_LIMITS.requestIntervalTicks;if(command.purpose==='interpretation')c.firstRequestTick??=tick;c.observationRequestedTick=null;
  this.emit(events,'COGNITION_ATTENTION','attention','selected',{requestId:command.requestId,observationId:s.observationId,captureId:s.captureId,frameHash:s.frameHash,capturedTick:s.capturedTick,attentionTick:s.attentionTick,intentId:s.intentId,source:s.source,attended:true,encoded:false},sequence);
  this.emit(events,'COGNITION_REQUEST','cognition','pending',{requestId:command.requestId,provider:command.provider,model:command.model,observationId:s.observationId,frameHash:s.frameHash,promptRevision:command.promptRevision,schemaRevision:command.schemaRevision},sequence);
 }
 private executeProposal(command:CognitionResultCommand,request:CognitionRequestCommand,events:DeterministicEvent[],sequence:number):CognitionActionOutcome {
  const tick=this.data.tick,c=this.cognition,s=request.selection,p=command.proposal!,a=p.action;
  const reject=(reason:string):CognitionActionOutcome=>({status:'rejected',reason,actionId:null,tick});
  if(!this.capableOfAction())return reject('physiological_incapacity');
  if(!this.cognitionActionAllowed())return reject('home_action_committed');
  if(tick-s.capturedTick>COGNITION_LIMITS.resultMaxAgeTicks)return reject('stale_action');
  if(c.requests.some(r=>r.requestedTick>(c.requests.find(r=>r.request.requestId===request.requestId)?.requestedTick??tick)))return reject('superseded_action');
  if(tick<c.actionCooldownUntilTick)return reject('action_cooldown');
  const attention=this.attentionState();if(tick<attention.developerUntilTick||tick<attention.commitmentUntilTick)return reject('attention_committed');
  if(a.type==='continue')return {status:'executed',reason:'continued',actionId:null,tick};
  if(a.type==='request_observation'){this.requestCapture('uncertainty_probe',events);const capture=this.attentionState();if(!capture.pending&&!capture.deferred)return reject('capture_policy_limited');c.observationRequestedTick=tick;c.actionCooldownUntilTick=tick+COGNITION_LIMITS.actionCooldownTicks;return {status:'executed',reason:'capture_requested',actionId:null,tick};}
  if(this.head.status!=='idle')return reject('motor_committed');
  let bearing:number,elevation:number;
  if(a.type==='inspect') {const shape=s.context.shapes.find(shape=>shape.handle===a.handle);if(!shape||!p.evidenceHandles.includes(a.handle))return reject('ineligible_shape');const delta=poseDifference(s.pose,sensorPose(this.snapshot()));if(delta.distance>.75)return reject('inspect_pose_changed');bearing=shape.bearingDegrees;elevation=shape.elevationDegrees;}
  else {bearing=a.bearingDegrees;elevation=a.elevationDegrees;}
  const aim={worldYaw:Math.atan2(Math.sin(s.pose.bodyHeading+s.pose.headYaw+bearing*Math.PI/180),Math.cos(s.pose.bodyHeading+s.pose.headYaw+bearing*Math.PI/180)),pitch:s.pose.headPitch+elevation*Math.PI/180};
  const target=relativeObservedAim(aim,this.data.character.heading);if(target.yaw<HEAD_LIMITS.minYaw||target.yaw>HEAD_LIMITS.maxYaw||target.pitch<HEAD_LIMITS.minPitch||target.pitch>HEAD_LIMITS.maxPitch)return reject('observed_bearing_exceeds_head_limits');
  const actionId=this.head.nextActionId;
  this.applyHeadInput({sequence,receivedTick:tick,applyTick:tick,admission:'queued',command:{type:'look_at',yaw:target.yaw,pitch:target.pitch,sceneRevision:this.scene.revision}},events,'cognition');
  if(this.head.nextActionId===actionId)return reject('local_head_validation');this.head.observedAim=aim;c.actionCooldownUntilTick=tick+COGNITION_LIMITS.actionCooldownTicks;
  if(a.type==='inspect'){c.observationRequestedTick=tick;/* head completion requests a fresh normal capture */}
  return {status:'executed',reason:a.type==='inspect'?'inspection_orient_started':'look_started',actionId,tick};
 }
 private applyResult(command:CognitionResultCommand,events:DeterministicEvent[],sequence:number){
  const c=this.cognition,r=c.requests.find(r=>r.request.requestId===command.requestId),tick=this.data.tick;
  if(!r||!sameIdentity(command.identity,r.request.selection.identity)||command.outcome!=='interrupted'&&!sameIdentity(command.identity,c.identity)){this.emit(events,'COGNITION_RESULT','cognition','rejected',{requestId:command.requestId,reason:'foreign_or_unknown_request'},sequence);return;}
  if(r.status!=='pending'){this.emit(events,'COGNITION_RESULT','cognition','duplicate',{requestId:command.requestId,reason:'already_completed'},sequence);return;}
  r.status='completed';r.result=structuredClone(command);r.resultTick=tick;if(r.request.purpose==='interpretation'&&command.outcome==='success'){c.responses++;c.lastResponseTick=tick;}
  this.emit(events,'COGNITION_RESULT','cognition',command.outcome,{requestId:command.requestId,latencyMs:command.metrics.latencyMs,attempts:command.metrics.attempts,costUsd:command.metrics.costUsd??'unknown',costBasis:command.metrics.costBasis,...(command.validationError?{reason:command.validationError}:{}),inputTokens:command.metrics.inputTokens??'unknown',outputTokens:command.metrics.outputTokens??'unknown'},sequence);
  const s=r.request.selection,p=command.proposal;
  if(command.outcome!=='success'||!p){r.encoding={status:'rejected',reason:command.validationError??command.outcome,experienceId:null};this.emit(events,'EXPERIENCE_ENCODING','experience','rejected',{requestId:command.requestId,reason:command.validationError??command.outcome,encoded:false},sequence);return;}
  try{validateCognitionProposalReferences(p,s.context);}catch(error){
   // Keep historical event/state hashes for old normalized commands. New wire
   // generations persist the same bounded category used by the adapter.
   const reason=r.request.schemaRevision===COGNITION_SCHEMA_REVISION?cognitionValidationError(error):'fabricated_evidence';
   r.action={status:'rejected',reason,actionId:null,tick};r.encoding={status:'rejected',reason,experienceId:null};this.emit(events,'COGNITION_VALIDATION','cognition','rejected',{requestId:command.requestId,reason},sequence);return;
  }
  this.emit(events,'COGNITION_INTERPRETATION','cognition','normalized',{requestId:command.requestId,observationId:p.observationId,frameHash:p.frameHash,interpretation:p.interpretation,uncertainty:p.uncertainty,action:p.action.type},sequence);
  this.emit(events,'COGNITION_ACTION_PROPOSED','cognition','advisory',{requestId:command.requestId,action:p.action.type},sequence);
  r.action=this.executeProposal(command,r.request,events,sequence);
  this.emit(events,'COGNITION_VALIDATION','cognition',r.action.status==='executed'?'accepted':'rejected',{requestId:command.requestId,action:p.action.type,reason:r.action.reason,validationTick:tick},sequence);
  this.emit(events,'COGNITION_ACTION','cognition',r.action.status,{requestId:command.requestId,action:p.action.type,reason:r.action.reason,actionId:r.action.actionId??'none',validationTick:tick},sequence);
  if(r.request.purpose==='decisions_evaluation'){r.encoding={status:'rejected',reason:'decision_not_experience',experienceId:null};}
  else if(s.source!=='actual_renderer'){r.encoding={status:'rejected',reason:'test_source',experienceId:null};}
  else if(this.realExperiences.length>=COGNITION_LIMITS.experiences){r.encoding={status:'failed',reason:'experience_capacity',experienceId:null};}
  else {
   const e:RealExperience={id:this.realExperiences.length+1,tick,kind:'perception',provenance:'ATTENDED_RENDERER_INTERPRETATION',encodingId:`${s.identity.historyId}_${command.requestId}`,identity:structuredClone(s.identity),requestId:command.requestId,captureId:s.captureId,observationId:s.observationId,frameHash:s.frameHash,source:'actual_renderer',capturedTick:s.capturedTick,attentionTick:s.attentionTick,interpretationTick:tick,encodedTick:tick,interpretation:p.interpretation,uncertainty:p.uncertainty,evidenceHandles:structuredClone(p.evidenceHandles),actionOutcome:r.action.status==='executed'?structuredClone(r.action):null};
   const encoded={status:'admitted' as const,reason:'trusted_attended_interpretation',experienceId:e.id};
   const projected=this.checkpoint();projected.realExperiences.push(e);projected.cognition.requests.find(request=>request.request.requestId===command.requestId)!.encoding=encoded;
   if(!fitsCognitionStorage(projected))r.encoding={status:'failed',reason:'checkpoint_capacity',experienceId:null};else{this.realExperiences.push(e);r.encoding=encoded;}
  }
  this.emit(events,r.encoding.status==='admitted'?'EXPERIENCE_ENCODED':'EXPERIENCE_ENCODING','experience',r.encoding.status,{requestId:command.requestId,experienceId:r.encoding.experienceId??'none',provenance:'ATTENDED_RENDERER_INTERPRETATION',source:s.source,reason:r.encoding.reason,sensed:true,attended:true,encoded:r.encoding.status==='admitted',capturedTick:s.capturedTick,attentionTick:s.attentionTick,interpretationTick:tick,encodedTick:tick,observationId:s.observationId,frameHash:s.frameHash},sequence);
 }
 protected override applyExtendedInput(input:OrderedInput,events:DeterministicEvent[]):boolean{if(input.command.type==='cognition_observation_request'){this.applyObservationRequest(input.command,events,input.sequence);return true;}if(input.command.type==='cognition_request'){this.applyRequest(input.command,events,input.sequence);return true;}if(input.command.type==='cognition_result'){this.applyResult(input.command,events,input.sequence);return true;}return super.applyExtendedInput(input,events);}
 override step():DeterministicEvent[]{
  const events=super.step(),c=this.cognition,u=c.captureUpgrade,tick=this.data.tick;
  if(u&&c.observationRequestedTick!==null&&u.status!=='expired'){
   const a=this.attentionState();
   if(tick-u.requestedTick>COGNITION_LIMITS.resultMaxAgeTicks){u.status='expired';c.observationRequestedTick=null;this.emit(events,'COGNITION_OBSERVATION','cognition','expired',{requestId:u.requestId,captureId:u.captureId,reason:'capture_upgrade_expired'});}
   else {
    if(u.status==='requested'&&!a.pending&&!a.deferred&&a.lastCapture&&a.lastCapture.receivedTick>=u.requestedTick&&a.lastCapture.outcome!=='success')u.status='pending';
    if(u.status==='pending'&&!a.pending&&!a.deferred&&tick>=a.captureCooldownUntilTick&&tick>=a.retryAfterTick){this.requestCapture('visible_change',events);const next=this.attentionState();if(next.pending||next.deferred){u.status='requested';this.emit(events,'COGNITION_OBSERVATION','cognition','capture_requested',{requestId:u.requestId,captureId:u.captureId,reason:'bounded_richer_observation'});}}
   }
  }
  return events;
 }
 override checkpoint():C{return {...super.checkpoint(),schemaVersion:5,rulesVersion:COGNITION_RULES,cognition:structuredClone(this.cognition),realExperiences:structuredClone(this.realExperiences)} as C;}
}

/** Schema 6 is an active-world migration only. V1–V5 offline execution keeps its original class. */
function physiologyCognitionPart(cp:CheckpointV6|CheckpointV7|CheckpointV8):CheckpointV5 {
 const raw=structuredClone(cp) as unknown as Record<string,unknown>;
 for(const key of ['body','interoception','physiology','internalExperiences'])delete raw[key];
 raw.schemaVersion=5;raw.rulesVersion=COGNITION_RULES;
 raw.pendingInputs=cp.pendingInputs.map(input=>({...input,command:input.command.type.startsWith('physiology_')?{type:'invalid',reason:'unknown_command'}:input.command}));
 return validateCognitionCheckpoint(raw);
}
export function validatePhysiologyCheckpoint(value:unknown):CheckpointV6 {
 const cp=value as CheckpointV6;
 const keys=['schemaVersion','rulesVersion','config','tick','character','reflex','door','waypoint','pauseUntilTick','cooldownUntilTick','seed','prng','nextInputSequence','nextEventSequence','nextSoundId','pendingInputs','eventHash','subjective','activity','experiences','nextExperienceId','head','scene','attention','genericSoundCount','cognition','realExperiences','body','interoception','physiology','internalExperiences'];
 object(cp,keys,'physiology root');if(cp.schemaVersion!==6||cp.rulesVersion!==PHYSIOLOGY_RULES)fail('physiology schema/rules');
 physiologyCognitionPart(cp);validateBodyState(cp.body,cp.tick,cp.config.hz);validateInteroceptionState(cp.interoception,cp.tick,cp.config.hz,cp.body.config);
 for(const i of cp.pendingInputs)validateCommand(i.command,true,true,true,true);
 const p=cp.physiology;object(p,['origin','verifiedCheckpointImports','legacyImport','encodingEnabled','encodedNeedCrossings','interruptedActivity','safetyUntilTick','unconsciousWindows'],'physiology runtime');
 const o=p.origin;object(o,['historyId','genesisPreset','rulesVersion','evidenceEligibility','taintedAtTick'],'physiology origin');
 if(!Array.isArray(p.verifiedCheckpointImports)||p.verifiedCheckpointImports.length>8)fail('verified LIVE import capacity');
 let tip=o.historyId,importTick=cp.body.activationTick;const histories=new Set([tip]);
 for(const edge of p.verifiedCheckpointImports){object(edge,['kind','sourceHistoryId','destinationHistoryId','importTick'],'verified LIVE import');if(edge.kind!=='explicit-live-checkpoint-import-v1'||edge.sourceHistoryId!==tip||typeof edge.destinationHistoryId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(edge.destinationHistoryId)||histories.has(edge.destinationHistoryId)||!integer(edge.importTick,importTick,cp.tick))fail('verified LIVE import ancestry');tip=edge.destinationHistoryId;importTick=edge.importTick;histories.add(tip);}
 const imported=p.legacyImport;if(imported!==null){object(imported,['kind','sourceHistoryId','destinationHistoryId','importTick'],'legacy physiology import');if(cp.cognition.identity.mode!=='EXPERIMENT'||imported.kind!=='explicit-unverified-import-v1'||imported.sourceHistoryId!==tip||imported.destinationHistoryId!==cp.cognition.identity.historyId||histories.has(imported.destinationHistoryId)||!integer(imported.importTick,importTick,cp.tick))fail('legacy physiology import ancestry');}
 if(typeof o.historyId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(o.historyId)||tip!==cp.cognition.identity.historyId&&imported===null||!['production-v1','acceptance-fast-v1'].includes(o.genesisPreset)||o.rulesVersion!==PHYSIOLOGY_RULES||!['eligible','debug-tainted'].includes(o.evidenceEligibility)||(o.evidenceEligibility==='eligible'?o.taintedAtTick!==null:!integer(o.taintedAtTick,cp.body.activationTick,cp.tick))||typeof p.encodingEnabled!=='boolean'||typeof p.interruptedActivity!=='boolean'||!integer(p.safetyUntilTick)||!Array.isArray(p.encodedNeedCrossings)||p.encodedNeedCrossings.length>128||!Array.isArray(p.unconsciousWindows)||p.unconsciousWindows.length>128||!Array.isArray(cp.internalExperiences)||cp.internalExperiences.length>128)fail('physiology runtime bounds');
 let previousEnd=-1;for(const [i,w]of p.unconsciousWindows.entries()){object(w,['startTick','endTick'],'unconscious interval');if(!integer(w.startTick,Math.max(0,previousEnd),cp.tick)||!(w.endTick===null&&i===p.unconsciousWindows.length-1||integer(w.endTick,w.startTick,cp.tick)))fail('unconscious interval');previousEnd=w.endTick??cp.tick;}
 const last=p.unconsciousWindows.at(-1);if(cp.body.active&&(last?.endTick===null)!==!bodyCapability(cp.body).canAttend)fail('unconscious state association');
 const ids=new Set<string>(),needIds=new Set<string>();
 for(const [i,e]of cp.internalExperiences.entries()){
  object(e,['id','kind','provenance','encodingId','identity','sensation','subjectiveTime','audit','encodingPolicy'],'internal experience');validateCognitionIdentity(e.identity);validateInternalSensation(e.sensation);
  object(e.subjectiveTime,['estimateSeconds','uncertaintySeconds'],'internal subjective time');if(!finite(e.subjectiveTime.estimateSeconds,0,Number.MAX_VALUE)||!finite(e.subjectiveTime.uncertaintySeconds,0,Number.MAX_VALUE))fail('internal subjective time');
  const a=e.audit;object(a,['sensedTick','attentionTick','encodedTick','needCrossingTick'],'internal audit');
  const needId=`${e.sensation.kind}_${a.needCrossingTick}`;if(needIds.has(needId))fail('duplicate internal need episode');needIds.add(needId);
  const expected=`${e.identity.historyId}_${e.identity.branchId}_${e.sensation.observationId}_${e.sensation.attentionId}`;
  if(Number(e.sensation.observationId.slice(21))>=cp.interoception.nextObservationId||Number(e.sensation.attentionId.slice(19))>=cp.interoception.nextAttentionId||e.id!==i+1||e.kind!=='internal'||e.provenance!=='ATTENDED_INTERNAL_SENSOR'||e.encodingPolicy!=='first-severe-per-need-v1'||e.sensation.band!=='severe'||e.encodingId!==expected||ids.has(e.encodingId)||!experienceHistoryAdmitted(cp,e.identity.historyId,e.audit.encodedTick)||cp.cognition.identity.mode==='LIVE'&&e.identity.mode!=='LIVE'||!integer(a.needCrossingTick,cp.body.activationTick,cp.tick)||!integer(a.sensedTick,a.needCrossingTick,cp.tick)||!integer(a.attentionTick,a.sensedTick,cp.tick)||!integer(a.encodedTick,a.attentionTick,cp.tick)||o.taintedAtTick!==null&&a.encodedTick>=o.taintedAtTick||imported!==null&&a.encodedTick>imported.importTick||!p.encodedNeedCrossings.some(c=>c.kind===e.sensation.kind&&c.crossingTick===a.needCrossingTick&&c.experienceId===e.id&&c.source==='actual_internal_sensor'&&c.observationId===e.sensation.observationId&&c.attentionId===e.sensation.attentionId&&c.sensedTick===a.sensedTick&&c.attentionTick===a.attentionTick&&c.encodingTick===a.encodedTick&&c.sensationHash===hashCanonical(e.sensation)&&c.identityHash===hashCanonical(e.identity)))fail('internal provenance');ids.add(e.encodingId);
 }
 if(p.encodedNeedCrossings.length!==cp.internalExperiences.length)fail('internal encoding associations');
 for(const c of p.encodedNeedCrossings){object(c,['kind','crossingTick','experienceId','source','observationId','attentionId','sensedTick','attentionTick','encodingTick','sensationHash','identityHash'],'internal encoding');if(!['hunger','sleep','discomfort'].includes(c.kind)||!integer(c.crossingTick,cp.body.activationTick,cp.tick)||!integer(c.experienceId,1,cp.internalExperiences.length)||cp.internalExperiences[c.experienceId-1].sensation.kind!==c.kind||cp.internalExperiences[c.experienceId-1].audit.needCrossingTick!==c.crossingTick)fail('internal encoding association');}
 for(const e of cp.realExperiences)if(!experienceHistoryAdmitted(cp,e.identity.historyId,e.encodedTick))fail('visual LIVE import epoch');
 return structuredClone(cp);
}
/** Derived solely from the persisted, validated ancestry; no history wildcard. */
function experienceEpochs(cp:CheckpointV6|CheckpointV7|CheckpointV8):{historyId:string;afterTick:number;throughTick:number}[]{
 const epochs:{historyId:string;afterTick:number;throughTick:number}[]=[];let historyId=cp.physiology.origin.historyId,afterTick=-1;
 for(const edge of cp.physiology.verifiedCheckpointImports){epochs.push({historyId,afterTick,throughTick:edge.importTick});historyId=edge.destinationHistoryId;afterTick=edge.importTick;}
 epochs.push({historyId,afterTick,throughTick:cp.physiology.legacyImport?.importTick??Number.MAX_SAFE_INTEGER});if(cp.physiology.legacyImport)epochs.push({historyId:cp.physiology.legacyImport.destinationHistoryId,afterTick:cp.physiology.legacyImport.importTick,throughTick:Number.MAX_SAFE_INTEGER});return epochs;
}
export function experienceHistoryAdmitted(cp:CheckpointV5|CheckpointV6|CheckpointV7|CheckpointV8,historyId:string,encodedTick:number):boolean{return cp.schemaVersion===5?historyId===cp.cognition.identity.historyId:experienceEpochs(cp).some(e=>e.historyId===historyId&&encodedTick>e.afterTick&&encodedTick<=e.throughTick);}
export class PhysiologySimulation<C extends CheckpointV6|CheckpointV7|CheckpointV8=CheckpointV7> extends CognitionSimulation<C> {
 protected body:BodyState;private interoception:InteroceptionState|InteroceptionStateV2;private physiology:PhysiologyRuntimeState&{taskCredit?:number;taskCreditActivityId?:number};private physiologyVersion:6|7;private internalExperiences:InternalExperience[];
 private intervalStart={x:0,z:0,cursor:0,yaw:0,pitch:0,capable:true};
 constructor(options:{checkpoint?:unknown;seed?:number;worldId?:string;runId?:string;branchId?:string;historyId?:string;mode:WorldMode;historical?:boolean;physiology?:PhysiologyOptions}){
  const source=options.checkpoint===undefined?null:validateCheckpoint(options.checkpoint),cp=source&&(source.schemaVersion===6||source.schemaVersion===7)?source:null;
  if(options.physiology?.genesisPreset==='acceptance-fast-v1'&&source)throw new Error('Acceptance genesis requires a new disposable history');
  super({...options,checkpoint:cp?physiologyCognitionPart(cp):source??undefined,...(cp?{physiologyAncestry:cp}:{})});
  this.physiologyVersion=cp?.schemaVersion===6&&options.historical?6:7;
  const tick=this.data.tick,hz=this.data.config.hz,preset=options.physiology?.genesisPreset??'production-v1';
  this.body=cp?structuredClone(cp.body):createBody(tick,hz,options.physiology?.active??false);
  this.interoception=cp?structuredClone(cp.interoception):createInteroception(tick);
  this.physiology=cp?structuredClone(cp.physiology):{origin:{historyId:this.cognition.identity.historyId,genesisPreset:preset,rulesVersion:PHYSIOLOGY_RULES,evidenceEligibility:'eligible',taintedAtTick:null},verifiedCheckpointImports:[],legacyImport:null,encodingEnabled:options.physiology?.encodingEnabled??true,encodedNeedCrossings:[],interruptedActivity:false,safetyUntilTick:0,unconsciousWindows:[]};
  this.internalExperiences=structuredClone(cp?.internalExperiences??[]);
  if(this.physiologyVersion===7){if(this.interoception.schemaVersion===1)this.interoception=upgradeInteroceptionV2(this.interoception,this.data.seed,hz);this.physiology.taskCredit=cp?.schemaVersion===7?cp.physiology.taskCredit:0;this.physiology.taskCreditActivityId=cp?.schemaVersion===7?cp.physiology.taskCreditActivityId:this.activity.activityId;}
  if(!cp&&preset==='acceptance-fast-v1'){this.body.active=true;this.body.satiety=.081;this.body.config.satietyUsePerSecond=.001;}
  if(cp)this.data.pendingInputs=structuredClone(cp.pendingInputs);
  const explicitlyActivating=options.physiology?.active===true&&(!cp||!cp.body.active);
  if((explicitlyActivating||!cp&&this.body.active)&&!fitsCognitionStorage({...this.checkpoint(),body:{...this.body,active:true}}))throw new Error('Checkpoint capacity prevents physiology activation; existing state preserved');
  if(cp&&options.physiology?.active!==undefined)this.configurePhysiologyActivation(options.physiology.active);
 }
 /** Constructor configuration changes capability evidence without executing motors,
  * cancelling actions, or inventing a retrospective unconscious interval. Call only
  * after the caller's complete projected activation capacity preflight. */
 protected configurePhysiologyActivation(active:boolean):void {
  if(active===this.body.active)return;
  const capable=bodyCapability({...this.body,active}).canAttend,last=this.physiology.unconsciousWindows.at(-1);
  const openInterval=!capable&&last?.endTick!==null;
  if(openInterval&&this.physiology.unconsciousWindows.length>=128)throw new Error('Unconscious interval evidence capacity exceeded');
  this.body.active=active;
  if(capable&&last?.endTick===null)last.endTick=this.data.tick;
  else if(openInterval)this.physiology.unconsciousWindows.push({startTick:this.data.tick,endTick:null});
 }
 protected applyValidatedHomeEffect(effect:Omit<Extract<PhysiologyEffect,{type:'intake'}>,'sequence'>|{type:'rest'|'sleep'|'wake'},events:DeterministicEvent[]):number{const sequence=this.body.lastEffectSequence+1,result=applyAcceptedBodyEffect(this.body,{...effect,sequence},this.data.tick);this.body=result.state;this.physiologyEvents(events,result.events);return sequence;}
 protected override supportsPhysiologyInputs():boolean{return true;}
 protected override capableOfAction():boolean{return !this.body||bodyCapability(this.body).canAct;}
 protected override capableOfAttention():boolean{return !this.body||bodyCapability(this.body).canAttend;}
 protected override movementScale():number{return this.physiologyVersion===7&&this.body?bodyImpairment(this.body).movementScale:1;}
 protected override motorScale():number{return this.body?bodyImpairment(this.body).headScale:1;}
 protected override ordinaryAttentionScale():number{return this.body?bodyImpairment(this.body).ordinaryAttentionScale:1;}
 protected override cognitionInternalContextAllowed(context:CognitionRequestCommand['selection']['context']):boolean{return context.internalSensations===undefined||context.internalSensations.every(percept=>this.providerInternalSensations().some(actual=>canonicalStringify(percept)===canonicalStringify(actual)));}
 protected override sensoryCaptureAllowed(tick:number):boolean{return !this.physiology||!this.physiology.unconsciousWindows.some(w=>tick>=w.startTick&&(w.endTick===null||tick<w.endTick));}
 protected override shouldAdvanceActivity():boolean{
  if(!this.capableOfAction()||!super.shouldAdvanceActivity())return false;
  if(this.physiologyVersion===6)return true;
  if(this.physiology.taskCreditActivityId!==this.activity.activityId){this.physiology.taskCredit=0;this.physiology.taskCreditActivityId=this.activity.activityId;}
  const credit=(this.physiology.taskCredit??0)+bodyImpairment(this.body).taskScale;if(credit<1){this.physiology.taskCredit=credit;return false;}this.physiology.taskCredit=credit-1;return true;
 }
 protected override beforeMotorExecution(events:DeterministicEvent[]):void{void events;this.intervalStart.capable=this.capableOfAttention();}
 protected override beforeInputs(events:DeterministicEvent[]):void{
  this.physiology.unconsciousWindows=this.physiology.unconsciousWindows.filter(w=>w.endTick===null||w.endTick>=this.data.tick-COGNITION_LIMITS.resultMaxAgeTicks);
  const c=this.data.character;this.intervalStart={x:c.x,z:c.z,cursor:this.activity.cursor,yaw:this.head.yaw,pitch:this.head.pitch,capable:this.capableOfAttention()};
  this.enforceCapability(events);
 }
 protected physiologyEvents(events:DeterministicEvent[],changes:PhysiologyEvent[]):void {
  for(const e of changes){const data=Object.fromEntries(Object.entries(e.data).map(([k,v])=>[k,v===null?'none':v]));this.emit(events,e.type,e.type.startsWith('INTERNAL_')?'interoception':'physiology','observed',data);}
 }
 private enforceCapability(events:DeterministicEvent[]):void{
  const p=this.physiology,capable=this.capableOfAction(),last=p.unconsciousWindows.at(-1);
  if(!capable){
   if(last?.endTick!==null){if(p.unconsciousWindows.length>=128)throw new Error('Unconscious interval evidence capacity exceeded');p.unconsciousWindows.push({startTick:this.data.tick,endTick:null});}
   this.data.character.moving=false;
   if(this.head.status!=='idle'){this.emit(events,'HEAD_INTERRUPTED','head','cancelled',{actionId:this.head.activeActionId!,reason:'physiological_incapacity'});this.head.status='idle';this.head.targetYaw=this.head.yaw;this.head.targetPitch=this.head.pitch;this.head.scan=null;this.head.activeActionId=null;this.head.observedAim=null;}
   if(this.activity.status==='running'&&!p.interruptedActivity){p.interruptedActivity=true;this.emit(events,'ACTIVITY_PHYSIOLOGY_SUSPENDED','activity','suspended',{activityId:this.activity.activityId,cursor:this.activity.cursor});}
  }else{
   if(last?.endTick===null)last.endTick=this.data.tick;
   if(p.interruptedActivity){p.interruptedActivity=false;this.emit(events,'ACTIVITY_PHYSIOLOGY_RESUMED','activity',this.activity.status==='running'?'resumed':'user_paused',{activityId:this.activity.activityId,cursor:this.activity.cursor});}
  }
 }
 protected override afterMotors(events:DeterministicEvent[]):void{
  const tick=this.data.tick,hz=this.data.config.hz,start=this.intervalStart,safetyPreempted=tick<this.physiology.safetyUntilTick;
  const advanced=advanceBody(this.body,{tick,hz,executed:{distanceMetres:Math.hypot(this.data.character.x-start.x,this.data.character.z-start.z),taskProgress:this.activity.cursor-start.cursor,headRadians:Math.hypot(this.head.yaw-start.yaw,this.head.pitch-start.pitch)},safetyPreempted,capableAtIntervalStart:start.capable});
  this.body=advanced.state;this.physiologyEvents(events,advanced.events);this.enforceCapability(events);
  const a=this.attentionState(),ordinaryAttentionAllowed=this.capableOfAttention()&&this.activity.status!=='running'&&tick>=a.commitmentUntilTick&&tick>=a.developerUntilTick;const ctx={tick,hz,safetyPreempted,capableAtIntervalStart:start.capable,ordinaryAttentionAllowed};const sensed=this.physiologyVersion===7?advanceInteroceptionV2(this.interoception as InteroceptionStateV2,this.body,{...ctx,ordinaryAttentionScale:advanced.impairment.ordinaryAttentionScale}):advanceInteroception(this.interoception as InteroceptionState,this.body,{...ctx,ordinaryAttentionAllowed:ordinaryAttentionAllowed&&advanced.impairment.ordinaryAttentionScale>=.7});
  this.interoception=sensed.state;this.physiologyEvents(events,sensed.events);
  // Present awareness already exists before this independent, fallible local encoding operation.
  for(const sensation of sensed.attended)this.encodeInternal(sensation,events);
 }
 private encodeInternal(sensation:InternalSensation,events:DeterministicEvent[]):void{
  const p=this.physiology,tick=this.data.tick,slot=this.interoception.slots.find(s=>s.kind===sensation.kind)!,transient=this.interoception.transient.find(t=>t.percept.attentionId===sensation.attentionId)!;
  const crossing=slot.urgent?.crossingTick;
  let reason=sensation.band!=='severe'||crossing===undefined?'selection_policy':p.encodedNeedCrossings.some(e=>e.kind===sensation.kind&&e.crossingTick===crossing)?'duplicate_need_episode':!p.encodingEnabled?'encoding_disabled':p.legacyImport!==null?'legacy_unverified':p.origin.evidenceEligibility!=='eligible'?'debug_tainted':this.internalExperiences.length>=128?'experience_capacity':null;
  if(reason===null){
   const identity=structuredClone(this.cognition.identity),e:InternalExperience={id:this.internalExperiences.length+1,kind:'internal',provenance:'ATTENDED_INTERNAL_SENSOR',encodingId:`${identity.historyId}_${identity.branchId}_${sensation.observationId}_${sensation.attentionId}`,identity,sensation:structuredClone(sensation),subjectiveTime:{estimateSeconds:super.checkpoint().subjective.estimateSeconds,uncertaintySeconds:super.checkpoint().subjective.uncertaintySeconds},audit:{sensedTick:transient.sensedTick,attentionTick:transient.attendedTick,encodedTick:tick,needCrossingTick:crossing!},encodingPolicy:'first-severe-per-need-v1'};
   const evidence={kind:sensation.kind,crossingTick:crossing!,experienceId:e.id,source:'actual_internal_sensor' as const,observationId:sensation.observationId,attentionId:sensation.attentionId,sensedTick:transient.sensedTick,attentionTick:transient.attendedTick,encodingTick:tick,sensationHash:hashCanonical(sensation),identityHash:hashCanonical(identity)};
   const projected=this.checkpoint();projected.internalExperiences.push(e);projected.physiology.encodedNeedCrossings.push(evidence);
   if(!fitsCognitionStorage(projected))reason='checkpoint_capacity';else{this.internalExperiences.push(e);p.encodedNeedCrossings.push(evidence);}
  }
  this.emit(events,reason===null?'INTERNAL_EXPERIENCE_ENCODED':'INTERNAL_ENCODING','experience',reason===null?'admitted':'not_encoded',{observationId:sensation.observationId,attentionId:sensation.attentionId,kind:sensation.kind,band:sensation.band,reason:reason??'first_severe_per_need',encoded:reason===null,sensed:true,attended:true,source:'actual_internal_sensor',provenance:'ATTENDED_INTERNAL_SENSOR'});
 }
 protected override applyExtendedInput(input:OrderedInput,events:DeterministicEvent[]):boolean{
  const c=input.command;
  if(c.type==='physiology_fixture'){
   if(c.effect.type==='activate'&&!fitsCognitionStorage({...this.checkpoint(),body:{...this.body,active:true}})){this.emit(events,'BODY_EFFECT_REJECTED','physiology','rejected',{reason:'checkpoint_capacity'},input.sequence);return true;}
   const applied=applyAcceptedBodyEffect(this.body,c.effect,this.data.tick);this.body=applied.state;this.physiology.origin.evidenceEligibility='debug-tainted';this.physiology.origin.taintedAtTick??=this.data.tick;this.physiologyEvents(events,applied.events);this.enforceCapability(events);return true;
  }
  if(c.type==='physiology_safety_fixture'){this.physiology.safetyUntilTick=this.data.tick+c.ticks;this.emit(events,'PHYSIOLOGY_SAFETY_FIXTURE','physiology','controlled_hazard',{untilTick:this.physiology.safetyUntilTick},input.sequence);return true;}
  if(c.type==='physiology_encoding'){this.physiology.encodingEnabled=c.enabled;this.emit(events,'INTERNAL_ENCODING_POLICY','experience','configured',{enabled:c.enabled},input.sequence);return true;}
  return super.applyExtendedInput(input,events);
 }
 override applyAction(action:ControlAction):DeterministicEvent[]{if(action.type==='activity-start'&&!this.capableOfAction())throw new Error('Physiological incapacity prevents starting activity');const events=super.applyAction(action);if(this.physiologyVersion===7&&action.type==='activity-start'){this.physiology.taskCredit=0;this.physiology.taskCreditActivityId=this.activity.activityId;}return events;}
 bodyState():BodyState{return structuredClone(this.body);}
 interoceptionState():InteroceptionState|InteroceptionStateV2{return structuredClone(this.interoception);}
 presentInternalSensations():InternalSensation[]{return presentInternalSensations(this.interoception,this.body.active);}
 providerInternalSensations():InternalSensationContext[]{return providerInternalSensations(this.interoception,this.body.active);}
 admittedInternalExperiences():InternalExperience[]{return structuredClone(this.internalExperiences);}
 override experienceRecords():Experience[]{return [...super.experienceRecords(),...this.admittedInternalExperiences()];}
 override snapshot():WorldState{return {...super.snapshot(),physiologyActive:this.body?.active??false,capability:this.body?bodyCapability(this.body):{awake:true,canAttend:true,canAct:true,reason:'available'},presentInternalSensations:this.interoception?providerInternalSensations(this.interoception,this.body.active):[]};}
 override checkpoint():C{return {...super.checkpoint(),schemaVersion:this.physiologyVersion,rulesVersion:this.physiologyVersion===7?CURRENT_PHYSIOLOGY_RULES:PHYSIOLOGY_RULES,body:structuredClone(this.body),interoception:structuredClone(this.interoception),physiology:structuredClone(this.physiology),internalExperiences:structuredClone(this.internalExperiences)} as C;}
}

/** Read-only projection for validation/construction; never used to replay CP7 under CP6 rules. */
function physiologyV1Projection(cp:CheckpointV7):CheckpointV6 {
 const p=structuredClone(cp.physiology) as PhysiologyRuntimeState&{taskCredit?:number;taskCreditActivityId?:number};delete p.taskCredit;delete p.taskCreditActivityId;
 return {...structuredClone(cp),schemaVersion:6,rulesVersion:PHYSIOLOGY_RULES,interoception:interoceptionV1Projection(cp.interoception),physiology:p};
}
export function validatePhysiologyCheckpointV2(value:unknown):CheckpointV7 {
 const cp=value as CheckpointV7;if(cp?.schemaVersion!==7||cp.rulesVersion!==CURRENT_PHYSIOLOGY_RULES)fail('V2 physiology schema/rules');
 const p=cp.physiology;if(!p||!finite(p.taskCredit,0,1)||p.taskCredit===1||!integer(p.taskCreditActivityId)||p.taskCreditActivityId!==cp.activity.activityId)fail('V2 task credit association');
 object(p,[...Object.keys(physiologyV1Projection(cp).physiology),'taskCredit','taskCreditActivityId'],'V2 physiology runtime');
 validatePhysiologyCheckpoint(physiologyV1Projection(cp));validateInteroceptionStateV2(cp.interoception,cp.tick,cp.config.hz,cp.body.config);return structuredClone(cp);
}
export class HistoricalPhysiologySimulation extends PhysiologySimulation<CheckpointV6>{
 constructor(options:ConstructorParameters<typeof PhysiologySimulation>[0]){if(validateCheckpoint(options.checkpoint).schemaVersion!==6)throw new Error('Historical physiology requires schema 6');super({...options,historical:true});}
}
/** CP8 installs home state only after shared physical clearance accepts a layout. */
export function homePhysiologyPart(cp:CheckpointV8):CheckpointV7 {
 const raw=structuredClone(cp) as unknown as Record<string,unknown>;delete raw.home;raw.schemaVersion=7;raw.rulesVersion=CURRENT_PHYSIOLOGY_RULES;
 raw.pendingInputs=cp.pendingInputs.map(input=>({...input,command:input.command.type==='home_observation'||input.command.type==='home_layout_fixture'||input.command.type==='doorbell'?{type:'invalid',reason:'unknown_command'}:input.command}));
 return validatePhysiologyCheckpointV2(raw);
}
export function validateHomeCheckpoint(value:unknown):CheckpointV8 {
 const cp=value as CheckpointV8;if(cp?.schemaVersion!==8||cp.rulesVersion!==HOME_RULES)fail('home schema/rules');
 const base=homePhysiologyPart(cp);object(cp,[...Object.keys(base).filter(k=>k!=='schemaVersion'&&k!=='rulesVersion'),'schemaVersion','rulesVersion','home'],'home root');
 validateHomeState(cp.home,cp.tick,cp.config.hz);if(cp.home.controller.searchActionId!==null&&cp.home.controller.searchActionId>=cp.head.nextActionId)fail('home search head action association');for(const input of cp.pendingInputs)validateCommand(input.command,true,true,true,true,true);
 const view={worldId:cp.cognition.identity.worldId,runId:cp.cognition.identity.runId,time:cp.tick/cp.config.hz,tick:cp.tick,character:cp.character,head:cp.head,scene:cp.scene,door:{lastSlam:cp.door.lastSlamTick/cp.config.hz,slamCount:cp.door.slamCount},reflex:{start:cp.reflex.startTick/cp.config.hz,strength:cp.reflex.strength,duration:REFLEX_DURATION},home:homePublicView(cp.home,cp.config.hz)};
 if(cp.home.layout&&(cp.home.posture.kind==='upright'?!canOccupyHomeCharacter(view,cp.character.x,cp.character.z):!canUseHomePosture(view)))fail('home character clearance/posture');
 if(cp.home.task?.committedEffectSequence!==null&&cp.home.task?.committedEffectSequence!==undefined&&cp.home.task.committedEffectSequence>cp.body.lastEffectSequence)fail('home committed effect cursor');
 return structuredClone(cp);
}
export class HomeSimulation extends PhysiologySimulation<CheckpointV8> {
 private home!:HomeState;
 constructor(options:ConstructorParameters<typeof PhysiologySimulation>[0]) {
  const source=options.checkpoint===undefined?null:validateCheckpoint(options.checkpoint),saved=source?.schemaVersion===8?source:null;
  super({...options,checkpoint:saved?homePhysiologyPart(saved):source??undefined,physiology:options.physiology?{...options.physiology,active:undefined}:undefined});
  this.home=saved?structuredClone(saved.home):createHomeState(this.data.tick,this.data.config.hz,chooseSafeHomeLayout(super.snapshot()),options.physiology?.active===false);
  if(saved)this.data.pendingInputs=structuredClone(saved.pendingInputs);
  const active=options.physiology?.active??(saved?saved.body.active:this.home.availability==='ready');
  if(options.physiology?.active!==undefined)this.home.activationPolicy=options.physiology.active?'home-default':'owner-disabled';
  const nextActive=this.home.availability==='ready'&&active&&this.home.activationPolicy!=='owner-disabled';
  if(nextActive&&!fitsCognitionStorage({...this.checkpoint(),body:{...this.body,active:true}}))throw new Error('Checkpoint capacity prevents home activation; existing state preserved');
  this.configurePhysiologyActivation(nextActive);if(!nextActive&&homeTaskBusy(this.home)&&this.home.task!.status!=='failed'){this.home.task!.status='interrupted';this.home.task!.interruption='owner_disabled';}
 }
 protected override supportsHomeInputs():boolean{return true;}
 protected override motorScale():number{return this.home&&!this.body.active&&this.home.controller.searchActionId===this.head.activeActionId&&this.head.activeActionId!==null?0:super.motorScale();}
 protected override cognitionActionAllowed():boolean{return !this.home||!homeTaskBusy(this.home);}
 protected override shouldAdvanceActivity():boolean{return (!this.home||!homeTaskBusy(this.home))&&super.shouldAdvanceActivity();}
 protected override canMove(x:number,z:number):boolean{return !this.home?.layout?super.canMove(x,z):canSweepHomeCharacter(this.snapshot(),this.data.character.x,this.data.character.z,x,z);}
 protected override movementPauseActive():boolean {const t=this.home?.task;return t?.status==='started'&&t.stage==='route'?false:super.movementPauseActive();}
 protected override movementPermitted():boolean {if(!this.home||!homeTaskBusy(this.home))return !this.home||this.home.posture.kind==='upright'&&(!this.body.active||this.home.controller.searchPhase==='idle'&&this.home.controller.searchOriginHeading===null);if(!this.body.active)return false;const t=this.home.task!;return t.status==='started'&&t.stage==='route'&&t.routeCursor<t.route.length;}
 protected override movementDestination():[number,number]{const t=this.home?.task;if(t&&homeTaskBusy(this.home)&&t.stage==='route'&&t.routeCursor<t.route.length){const p=t.route[t.routeCursor];return [p.x,p.z];}return super.movementDestination();}
 protected override movementArrived(events:DeterministicEvent[]):void {const t=this.home?.task;if(t&&homeTaskBusy(this.home)&&t.stage==='route'){t.routeCursor++;this.emit(events,'HOME_ROUTE_POINT','home_navigation','reached',{actionId:t.id,routeCursor:t.routeCursor});if(t.routeCursor===t.route.length)this.data.character.moving=false;return;}super.movementArrived(events);}
 protected override movementBlocked(events:DeterministicEvent[]):void {const t=this.home?.task;if(t&&homeTaskBusy(this.home)&&t.stage==='route'){this.data.character.moving=false;t.route=[];t.routeCursor=0;t.status='interrupted';t.interruption='route_blocked';t.nextReplanTick=this.data.tick+this.data.config.hz;homeTimeline(this.home,this.data.tick,'blocked','Path blocked; replanning');this.emit(events,'HOME_ROUTE_BLOCKED','home_navigation','blocked',{actionId:t.id,replans:t.replans});return;}super.movementBlocked(events);}
 protected override beforeInputs(events:DeterministicEvent[]):void {super.beforeInputs(events);if(this.home?.availability==='ready')replenishHomeResources(this.home,this.data.tick,this.data.config.hz);}
 private homeFail(reason:string,events:DeterministicEvent[]):void {const t=this.home.task!;t.status='failed';t.interruption=reason;this.home.controller.nextDecisionTick=this.data.tick+30*this.data.config.hz;homeTimeline(this.home,this.data.tick,'failed',reason==='target_moved'?'Target moved':reason==='food_unavailable'?'No food available':'Path blocked');this.emit(events,'HOME_ACTION_FAILED','home_action','failed',{actionId:t.id,reason,stage:t.stage});}
 private homeInterrupt(reason:string,events:DeterministicEvent[]):void {const t=this.home.task!;if(t.status!=='interrupted'||t.interruption!==reason){t.status='interrupted';t.interruption=reason;if(reason==='bed_clearance')t.nextReplanTick=this.data.tick+5*this.data.config.hz;homeTimeline(this.home,this.data.tick,'interrupted',reason==='physiological_incapacity'?'Action interrupted by sleep':'Action interrupted');this.emit(events,'HOME_ACTION_INTERRUPTED','home_action','interrupted',{actionId:t.id,reason,stage:t.stage});}}
 private currentHomeTarget():HomeLayout['bed']|null {const t=this.home.task!,l=this.home.layout;if(!l)return null;const f=t.target.kind==='bed'?l.bed:l.pantry;return f.id===t.target.resourceId?f:null;}
 private targetReachReason():string|null {const t=this.home.task!,f=this.currentHomeTarget();if(!f)return 'target_unavailable';if(Math.hypot(f.anchor.x-t.target.anchor.x,f.anchor.z-t.target.anchor.z)>.15)return 'target_moved';if(Math.hypot(this.data.character.x-f.anchor.x,this.data.character.z-f.anchor.z)>.2)return 'out_of_reach';return null;}
 private planHome(events:DeterministicEvent[]):boolean {const t=this.home.task!,world=this.snapshot(),plan=planHomeRoute(this.data.character,t.target.anchor,{canOccupy:p=>canOccupyHomeCharacter(world,p.x,p.z),canSweep:(a,b)=>canSweepHomeCharacter(world,a.x,a.z,b.x,b.z)});t.replans++;t.nextReplanTick=this.data.tick+this.data.config.hz;if(plan.status==='blocked'){if(t.replans>=HOME_LIMITS.replans)this.homeFail('route_unreachable',events);else this.homeInterrupt('route_blocked',events);return false;}t.route=plan.points;t.routeCursor=0;t.status='started';t.interruption=null;homeTimeline(this.home,this.data.tick,'started',t.kind==='eat'?'Getting food':'Walking to bed');this.emit(events,'HOME_ROUTE_PLANNED','home_navigation','reachable',{actionId:t.id,points:t.route.length,expanded:plan.expanded,distance:plan.distance,replans:t.replans});return true;}
 private stageHome(stage:HomeState['task'] extends infer T?T extends {stage:infer S}?S:never:never):void {const t=this.home.task!;t.stage=stage;t.stageTicks=0;t.stageStartedTick=this.data.tick;}
 private advanceBedTransition(events:DeterministicEvent[]):void {const t=this.home.task!,bed=this.currentHomeTarget();if(!bed||!t.entryOrigin){this.homeFail('target_unavailable',events);return;}const duration=HOME_ACTION_SECONDS[t.stage==='enter'?'enter':'exit']*this.data.config.hz;const progress=t.stage==='enter'?Math.min(1,(t.stageTicks+1)/duration):Math.max(0,this.home.posture.progress-1/duration<1e-10?0:this.home.posture.progress-1/duration);const candidate=this.snapshot();candidate.character={...candidate.character,x:t.entryOrigin.x+(bed.position.x-t.entryOrigin.x)*progress,z:t.entryOrigin.z+(bed.position.z-t.entryOrigin.z)*progress,heading:bed.yaw,moving:false};candidate.home={...candidate.home!,posture:{kind:t.stage==='enter'?'entering':'exiting',bedId:bed.id,progress}};
  if(!canSweepHomePosture(this.snapshot(),candidate)){t.transitionFailures++;t.nextReplanTick=this.data.tick+5*this.data.config.hz;if(t.transitionFailures>=3){if(t.stage==='enter'&&this.home.posture.kind!=='upright'&&this.home.posture.progress>0){t.abortReason='bed_entry_blocked';t.transitionFailures=0;this.stageHome('exit');this.homeInterrupt('bed_clearance',events);}else this.homeFail(t.abortReason??(t.stage==='exit'?'bed_exit_blocked':'bed_entry_blocked'),events);}else this.homeInterrupt('bed_clearance',events);return;}this.data.character={...candidate.character};this.home.posture=candidate.home.posture;if(t.status==='interrupted'){t.status='started';t.interruption=null;homeTimeline(this.home,this.data.tick,'started','Action resumed');}t.stageTicks++;
  if(t.stage==='enter'&&progress===1){this.home.posture.kind='reclined';t.committedEffectSequence=this.applyValidatedHomeEffect({type:'rest'},events);this.stageHome('rest');homeTimeline(this.home,this.data.tick,'resting','Resting in bed');this.emit(events,'HOME_BED_ENTERED','home_action','resting',{actionId:t.id});}
  else if(t.stage==='exit'&&progress===0){this.home.posture={kind:'upright',bedId:null,progress:0};if(t.abortReason){this.homeFail(t.abortReason,events);return;}t.status='completed';this.data.pauseUntilTick=this.data.tick+this.data.config.pauseTicks;this.stageHome('done');homeTimeline(this.home,this.data.tick,'completed','Finished resting');this.emit(events,'HOME_ACTION_COMPLETE','home_action','completed',{actionId:t.id,kind:t.kind});}
 }
 private advanceHomeAction(events:DeterministicEvent[]):void {
  const t=this.home.task!,tick=this.data.tick,hz=this.data.config.hz,capable=this.capableOfAction();if(t.status==='failed')return;
  if(t.stage==='sleep'){if(this.body.mode==='asleep'||this.body.mode==='incapacitated')return;t.status='started';this.stageHome('wake');homeTimeline(this.home,tick,'waking','Waking');return;}
  if(!capable){this.homeInterrupt('physiological_incapacity',events);return;}
  const attention=this.attentionState();if(tick<attention.commitmentUntilTick||tick<attention.developerUntilTick){this.homeInterrupt('attention_committed',events);return;}
  if(t.status==='interrupted'&&tick<t.nextReplanTick)return;
  if(t.stage==='route'&&!t.route.length){if(t.replans>=HOME_LIMITS.replans){this.homeFail('route_unreachable',events);return;}if(!this.planHome(events))return;}
  if(t.status==='interrupted'&&t.interruption!=='bed_clearance'){t.status='started';t.interruption=null;homeTimeline(this.home,tick,'started','Action resumed');}
  if(t.stage==='route'){if(t.routeCursor<t.route.length)return;const reason=this.targetReachReason();if(reason){this.homeFail(reason,events);return;}if(t.kind==='eat')this.stageHome(this.home.resources.held?'eat':'reach');else{t.entryOrigin={x:this.data.character.x,z:this.data.character.z};this.stageHome('enter');}return;}
  if(t.stage==='enter'||t.stage==='exit'){this.advanceBedTransition(events);return;}
  t.stageTicks++;
  if(t.stage==='reach'&&t.stageTicks>=HOME_ACTION_SECONDS.reach*hz){const reason=this.targetReachReason();if(reason){this.homeFail(reason,events);return;}if(!this.home.resources.stock){this.homeFail('food_unavailable',events);return;}if(this.home.resources.held){this.homeFail('already_holding_food',events);return;}this.home.resources.stock--;this.home.resources.held={id:this.home.resources.nextServingId++,kind:'basic-serving',acquiredByAction:t.id};this.stageHome('holding');homeTimeline(this.home,tick,'acquired','Acquired food');this.emit(events,'HOME_FOOD_ACQUIRED','home_action','acquired',{actionId:t.id,servingId:this.home.resources.held.id});}
  else if(t.stage==='holding'&&t.stageTicks>=HOME_ACTION_SECONDS.holding*hz)this.stageHome('eat');
  else if(t.stage==='eat'&&t.stageTicks>=HOME_ACTION_SECONDS.eat*hz){const held=this.home.resources.held;if(!held){this.homeFail('held_item_missing',events);return;}if(this.body.absorption.length>=32){this.homeFail('absorption_capacity',events);return;}const sequence=this.applyValidatedHomeEffect({type:'intake',...BASIC_SERVING},events);t.committedEffectSequence=sequence;this.home.resources.held=null;this.home.controller.mealCooldownUntilTick=tick+HOME_LIMITS.mealCooldownSeconds*hz;t.status='completed';this.data.pauseUntilTick=this.data.tick+this.data.config.pauseTicks;this.stageHome('done');homeTimeline(this.home,tick,'consumed','Consumed food');homeTimeline(this.home,tick,'completed','Finished eating');this.emit(events,'HOME_FOOD_CONSUMED','home_action','committed',{actionId:t.id,servingId:held.id,effectSequence:sequence});}
  else if(t.stage==='rest'&&t.need==='sleep'&&t.stageTicks>=2*hz){t.committedEffectSequence=this.applyValidatedHomeEffect({type:'sleep'},events);this.stageHome('sleep');homeTimeline(this.home,tick,'sleeping','Sleeping in bed');this.emit(events,'HOME_SLEEP_STARTED','home_action','sleeping',{actionId:t.id});}
  else if(t.stage==='rest'&&t.stageTicks>=HOME_ACTION_SECONDS.rest*hz){t.committedEffectSequence=this.applyValidatedHomeEffect({type:'wake'},events);this.stageHome('wake');homeTimeline(this.home,tick,'waking','Getting up');}
  else if(t.stage==='wake'&&t.stageTicks>=HOME_ACTION_SECONDS.wake*hz)this.stageHome('exit');
 }
 private cancelHomeSearch(events:DeterministicEvent[],resetSession=false):void {const c=this.home.controller;if(c.searchActionId!==null&&this.head.activeActionId===c.searchActionId){this.emit(events,'HEAD_INTERRUPTED','head','cancelled',{actionId:c.searchActionId,reason:'home_goal_selected'});this.head.status='idle';this.head.scan=null;this.head.activeActionId=null;this.head.observedAim=null;this.head.targetYaw=this.head.yaw;this.head.targetPitch=this.head.pitch;}c.searchPhase='idle';c.searchBodyTarget=null;c.searchActionId=null;if(resetSession){c.searchOriginHeading=null;c.searchOrientation=0;c.searchPose=0;}}
 private advanceHomeSearch(events:DeterministicEvent[]):void {const c=this.home.controller,tick=this.data.tick,hz=this.data.config.hz,a=this.attentionState();if(!this.capableOfAttention()||tick<a.developerUntilTick||tick<a.commitmentUntilTick){this.cancelHomeSearch(events);c.searchNextTick=tick+5*hz;return;}
  const needSearch=!this.home.known.some(k=>k.kind==='bed')||!this.home.known.some(k=>k.kind==='pantry')||this.home.task?.status==='failed';if(!needSearch){this.cancelHomeSearch(events,true);return;}
  if(c.searchPhase==='idle'){if(tick<c.searchNextTick||this.head.status!=='idle')return;if(c.searchOriginHeading===null){c.searchOriginHeading=this.data.character.heading;c.searchOrientation=0;c.searchPose=0;}const required=Math.atan2(Math.sin(c.searchOriginHeading+c.searchOrientation*Math.PI/2),Math.cos(c.searchOriginHeading+c.searchOrientation*Math.PI/2));if(Math.abs(angleDifference(required,this.data.character.heading))>.001){c.searchBodyTarget=required;c.searchPhase='body-turn';return;}const angles=[-.75,0,.75,-1.25,1.25],yaw=angles[c.searchPose],actionId=this.head.nextActionId;this.applyHeadInput({sequence:Math.max(1,this.data.nextInputSequence-1),receivedTick:tick,applyTick:tick,admission:'queued',command:{type:'look_at',yaw,pitch:-.12,sceneRevision:this.scene.revision}},events,'cognition');if(this.head.nextActionId===actionId)return;c.searchActionId=actionId;c.searchPhase='turning';c.searchTurns++;c.searchDeadlineTick=tick+45*hz;return;}
  if(c.searchPhase==='body-turn'){const delta=angleDifference(c.searchBodyTarget!,this.data.character.heading),step=Math.min(Math.abs(delta),Math.PI/2/hz),candidate=this.snapshot();candidate.character.heading=Math.atan2(Math.sin(this.data.character.heading+Math.sign(delta)*step),Math.cos(this.data.character.heading+Math.sign(delta)*step));if(!canUseHomePosture(candidate)){this.cancelHomeSearch(events);c.searchNextTick=tick+5*hz;return;}this.data.character.heading=candidate.character.heading;if(Math.abs(delta)<=step+1e-10){c.searchPhase='idle';c.searchBodyTarget=null;c.searchNextTick=tick;}return;}
  if(c.searchActionId!==null&&(this.head.status!=='idle'&&this.head.activeActionId!==c.searchActionId||this.head.nextActionId>c.searchActionId+1)){this.cancelHomeSearch(events);c.searchNextTick=tick+5*hz;return;}
  if(c.searchPhase==='turning'&&this.head.status==='idle'){c.searchPhase='holding';c.searchCaptureAfterTick=tick-1;c.searchDeadlineTick=tick+45*hz;c.searchNextTick=tick;}
  if(c.searchPhase==='holding'){
   const last=a.lastCapture;
   // Ordered success at the boundary is actual evidence, not a timeout.
   if(last?.outcome==='success'&&last.freshness==='applicable'&&last.capturedTick>=c.searchCaptureAfterTick){c.searchPhase='idle';c.searchActionId=null;c.searchPose++;c.searchNextTick=tick+hz;if(c.searchPose>=5){c.searchPose=0;if(c.searchOrientation<3)c.searchOrientation++;else{c.searchOriginHeading=null;c.searchOrientation=0;c.searchNextTick=tick+5*hz;}}return;}
   if(last?.outcome==='quota'&&last.receivedTick>=c.searchCaptureAfterTick)c.searchDeadlineTick=Math.max(c.searchDeadlineTick,Math.min(c.searchCaptureAfterTick+120*hz,a.retryAfterTick+5*hz));
   const pending=a.pending;
   if(pending&&(pending.status==='pending'||pending.requestedTick!==null&&pending.requestedTick>=c.searchCaptureAfterTick))c.searchDeadlineTick=Math.max(c.searchDeadlineTick,Math.min(c.searchCaptureAfterTick+120*hz,pending.expiresTick+1));
   if(tick>=c.searchDeadlineTick||last&&last.receivedTick>=c.searchCaptureAfterTick&&['unavailable','failed','timeout','interrupted'].includes(last.outcome)){this.cancelHomeSearch(events,true);c.searchNextTick=tick+30*hz;return;}
   if(tick>=c.searchNextTick){this.requestCapture('uncertainty_probe',events);c.searchNextTick=tick+5*hz;}
  }
 }
 protected override beforeMotorExecution(events:DeterministicEvent[]):void {
  if(this.home?.availability==='ready'&&this.body.active){const tick=this.data.tick,hz=this.data.config.hz;
   if(homeTaskBusy(this.home))this.advanceHomeAction(events);
   else if(this.home.posture.kind==='upright'&&this.capableOfAction()&&tick>=this.home.controller.nextDecisionTick){this.home.controller.nextDecisionTick=tick+HOME_LIMITS.reconsiderSeconds*hz;const choice=chooseReactiveHomeGoal({sensations:this.presentInternalSensations(),known:this.home.known,handledAttentionIds:this.home.controller.handledAttentionIds,tick,mealCooldownUntilTick:this.home.controller.mealCooldownUntilTick,genericActivityRunning:this.activity.status==='running'});if(choice){beginHomeTask(this.home,choice,tick,hz);this.emit(events,'HOME_GOAL_SELECTED','home_controller','selected',{actionId:this.home.task!.id,kind:choice.kind,attentionId:choice.attentionId,recognition:choice.target.recognition});} }
   if(!homeTaskBusy(this.home))this.advanceHomeSearch(events);else this.cancelHomeSearch(events,true);
   if(this.home.posture.kind!=='upright'){this.head.status='idle';this.head.scan=null;this.head.activeActionId=null;this.head.observedAim=null;this.head.targetYaw=this.head.yaw=0;this.head.targetPitch=this.head.pitch=0;}
  }
  super.beforeMotorExecution(events);
 }
 protected override applyExtendedInput(input:OrderedInput,events:DeterministicEvent[]):boolean {
  const c=input.command,tick=this.data.tick;
  if(c.type==='physiology_fixture'&&(c.effect.type==='activate'||c.effect.type==='deactivate')){if(c.effect.type==='activate'&&this.home.availability!=='ready'){this.emit(events,'BODY_EFFECT_REJECTED','physiology','rejected',{reason:'home_layout_unavailable'},input.sequence);return true;}const handled=super.applyExtendedInput(input,events);this.home.activationPolicy=this.body.active?'home-default':'owner-disabled';if(!this.body.active&&homeTaskBusy(this.home)&&this.home.task!.status!=='failed')this.homeInterrupt('owner_disabled',events);return handled;}
  if(c.type==='home_observation'){const a=this.attentionState(),last=a.lastCapture,reason=!this.capableOfAttention()?'physiological_incapacity':this.mode==='LIVE'&&c.sensorSource!=='actual_renderer'?'untrusted_sensor_source':!last||last.outcome!=='success'||last.freshness!=='applicable'||last.captureId!==c.captureId||last.capturedTick!==c.capturedTick||last.receivedTick!==c.attentionTick||a.baseline?.frameHash!==c.frameHash?'unattended_capture':!this.sensoryCaptureAllowed(c.capturedTick)?'unconscious_capture':null;if(reason){this.emit(events,'HOME_OBSERVATION','home_sensor','rejected',{reason,captureId:c.captureId},input.sequence);return true;}
   for(const o of c.observations){const known={resourceId:o.resourceId,kind:o.kind,anchor:structuredClone(o.observedAnchor),handle:o.handle,captureId:c.captureId,frameHash:c.frameHash,capturedTick:c.capturedTick,attentionTick:c.attentionTick,recognition:o.recognition};const prior=this.home.known.findIndex(k=>k.resourceId===o.resourceId);if(prior>=0)this.home.known[prior]=known;else if(this.home.known.length<HOME_LIMITS.known)this.home.known.push(known);else continue;this.emit(events,'HOME_AFFORDANCE_ATTENDED','home_sensor','known',{resourceId:o.resourceId,kind:o.kind,captureId:c.captureId,frameHash:c.frameHash,capturedTick:c.capturedTick,attentionTick:c.attentionTick,handle:o.handle,recognition:o.recognition,x:o.observedAnchor.x,z:o.observedAnchor.z},input.sequence);}return true;
  }
  if(c.type==='home_layout_fixture'){if(this.mode!=='EXPERIMENT'){this.emit(events,'HOME_LAYOUT','home','rejected',{reason:'experiment_only'},input.sequence);return true;}const candidate=this.snapshot();candidate.home={...candidate.home!,layout:c.layout};if(!canOccupyHomeCharacter(candidate,this.data.character.x,this.data.character.z)||this.home.posture.kind!=='upright'){this.emit(events,'HOME_LAYOUT','home','rejected',{reason:'occupied_clearance'},input.sequence);return true;}this.home.layout=structuredClone(c.layout);this.home.availability='ready';this.scene.revision++;this.emit(events,'HOME_LAYOUT','home','changed',{layoutRevision:c.layout.revision},input.sequence);return true;}
  if(c.type==='doorbell'){if(tick<this.home.doorbellCooldownUntilTick){this.emit(events,'HOME_DOORBELL','home','rejected',{reason:'shared_cooldown'},input.sequence);return true;}this.home.doorbellCooldownUntilTick=tick+10*this.data.config.hz;this.home.doorbellCount++;const sound={kind:'doorbell' as const,id:this.data.nextSoundId++,time:tick/this.data.config.hz,x:2.97,z:-3.25,intensity:.7,suddenness:.85};this.genericSoundCount++;const emitted=this.emit(events,'ACOUSTIC_EVENT','sound','emitted',{...sound,y:1.4,sourceId:'home-doorbell',provenance:'WORLD_ACTION'},input.sequence);this.hear(sound,events,input.sequence,emitted.sequence);return true;}
  return super.applyExtendedInput(input,events);
 }
 homeState():HomeState{return structuredClone(this.home);}
 override snapshot():WorldState{return {...super.snapshot(),...(this.home?{home:homePublicView(this.home,this.data.config.hz)}:{})};}
 override checkpoint():CheckpointV8 {const base=super.checkpoint();return this.home?{...base,schemaVersion:8,rulesVersion:HOME_RULES,home:structuredClone(this.home)}:base;}
}
