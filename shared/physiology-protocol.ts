/** Experimental game model: normalized stores, rates per elapsed world second. */
export const PHYSIOLOGY_RULES = 'lumi-physiology-v1' as const;
export const PHYSIOLOGY_CONFIG_VERSION = 'experimental-body-v1' as const;
export const INTERNAL_KINDS = ['hunger','sleep','discomfort'] as const;
export type InternalKind = typeof INTERNAL_KINDS[number];
export type SensationBand = 'mild'|'moderate'|'severe';
export type BodyMode = 'awake'|'resting'|'asleep'|'incapacitated';
export const DEFAULT_PHYSIOLOGY_CONFIG = {
  version: PHYSIOLOGY_CONFIG_VERSION,
  satietyUsePerSecond: .055/3600, reserveUsePerSecond: .014/3600,
  reserveUsePerMetre: .000006, reserveUsePerTaskUnit: .00000004, reserveUsePerHeadRadian: .0000002,
  awakePressurePerSecond: .03/3600, restPressureRecoveryPerSecond: .008/3600, sleepPressureRecoveryPerSecond: .11/3600,
  fatigueRecoveryPerSecond: .005/3600, restFatigueRecoveryPerSecond: .055/3600, sleepFatigueRecoveryPerSecond: .10/3600,
  lowReserveFatiguePerSecond: .05/3600, sleepDebtFatiguePerSecond: .035/3600,
  conditionLossPerSecond: .018/3600, conditionRecoveryPerSecond: .035/3600,
  forcedSleepPressure: .97, wakePressure: .20, incapacityCondition: .20, recoveryCondition: .35,
  urgentAttentionSeconds: 30, cueCooldownSeconds: 300, transientSeconds: 120, circadianPeriodSeconds: 86400,
};
export type PhysiologyConfig = typeof DEFAULT_PHYSIOLOGY_CONFIG;
export interface AbsorptionProgress { sequence:number; reservesRemaining:number; secondsRemaining:number }
/** WORLD_TRUTH. Never hand this object to a provider or autobiographical recorder. */
export interface BodyState {
  schemaVersion:1; rulesVersion:typeof PHYSIOLOGY_RULES; config:PhysiologyConfig; hz:number; active:boolean;
  activationTick:number; lastIntegratedTick:number; /** Compensated by inactive intervals so phase freezes. */ circadianAnchorTick:number;
  satiety:number; reserves:number; sleepPressure:number; condition:number; fatigue:number;
  mode:BodyMode; modeSinceTick:number; lastEffectSequence:number; absorption:AbsorptionProgress[];
}
/** Accepted world effects only; no model/user command may construct this authority. */
export type PhysiologyEffect = { sequence:number; type:'intake'; satiety:number; reserves:number; absorptionSeconds:number }
  | { sequence:number; type:'rest'|'sleep'|'wake'|'activate'|'deactivate' };
export interface BodyCapability { awake:boolean; canAttend:boolean; canAct:boolean; reason:'available'|'asleep'|'incapacitated' }
export interface BodyImpairment { movementScale:number; headScale:number; taskScale:number; ordinaryAttentionScale:number }
export interface ExecutedBodyActivity { distanceMetres:number; taskProgress:number; headRadians:number }
export interface BodyStepContext { tick:number; hz:number; executed:ExecutedBodyActivity; safetyPreempted:boolean; capableAtIntervalStart:boolean }
export interface PhysiologyEvent { type:string; tick:number; data:Record<string,string|number|boolean|null> }
/** Explicit cognition allowlist. IDs correlate evidence; no operational clock or body numbers. */
export interface InternalSensation {
  observationId:string; attentionId:string; kind:InternalKind; band:SensationBand;
  description:string; uncertainty:'coarse_internal_signal'; provenance:'SIMULATED_INTEROCEPTION';
}
export type InternalSensationContext = Pick<InternalSensation,'kind'|'band'|'description'|'uncertainty'>;
export interface InternalCandidate { observationId:string; kind:InternalKind; band:SensationBand; sensedTick:number }
export interface UrgentNeed {
  crossingTick:number; firstAttendedTick:number|null; eligibleTicks:number; excludedSafetyTicks:number; excludedIncapacityTicks:number; excludedInactiveTicks:number;
  retries:number; lastAttemptTick:number|null; breachTick:number|null;
}
export interface InternalCueSlot { kind:InternalKind; band:SensationBand|null; lastSensedTick:number|null; candidate:InternalCandidate|null; urgent:UrgentNeed|null }
export interface AttendedInternalSensation { percept:InternalSensation; sensedTick:number; attendedTick:number; expiresTick:number }
export interface InteroceptionState {
  schemaVersion:1; rulesVersion:typeof PHYSIOLOGY_RULES; lastIntegratedTick:number; nextObservationId:number; nextAttentionId:number;
  slots:InternalCueSlot[]; transient:AttendedInternalSensation[];
}
export interface InteroceptionStepContext { tick:number; hz:number; safetyPreempted:boolean; capableAtIntervalStart:boolean; ordinaryAttentionAllowed:boolean }

const exact=(v:unknown,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',');
const finite=(v:unknown,min=0,max=1):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const integer=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):v is number=>finite(v,min,max)&&Number.isSafeInteger(v);
const band=(v:unknown):v is SensationBand=>['mild','moderate','severe'].includes(v as string);
const identifier=(v:unknown,prefix:string)=>typeof v==='string'&&new RegExp(`^${prefix}[1-9][0-9]{0,15}$`).test(v);
export function validatePhysiologyConfig(value:unknown):PhysiologyConfig {
  const c=value as PhysiologyConfig;
  if(!exact(c,Object.keys(DEFAULT_PHYSIOLOGY_CONFIG))||c.version!==PHYSIOLOGY_CONFIG_VERSION)throw new Error('Invalid physiology configuration');
  for(const [key,v] of Object.entries(c))if(key!=='version'&&!finite(v,Number.EPSILON,key.endsWith('Seconds')?172800:1))throw new Error('Invalid physiology parameter');
  if(c.forcedSleepPressure<.9||c.wakePressure>=.5||c.wakePressure>=c.forcedSleepPressure||c.incapacityCondition>.25||c.incapacityCondition>=c.recoveryCondition||c.recoveryCondition>.8||c.urgentAttentionSeconds>120||c.cueCooldownSeconds<1||c.transientSeconds<1||c.circadianPeriodSeconds<3600||c.awakePressurePerSecond*2*c.urgentAttentionSeconds>=c.forcedSleepPressure-.78||c.conditionLossPerSecond*2*c.urgentAttentionSeconds>=.3-c.incapacityCondition)throw new Error('Invalid physiology parameter relationship');
  return structuredClone(c);
}
export function validatePhysiologyEffect(value:unknown):PhysiologyEffect {
  const e=value as PhysiologyEffect;
  if(!integer(e?.sequence,1))throw new Error('Invalid physiology effect sequence');
  if(e.type==='intake'&&exact(e,['sequence','type','satiety','reserves','absorptionSeconds'])&&finite(e.satiety)&&finite(e.reserves)&&finite(e.absorptionSeconds,1,14400))return structuredClone(e);
  if(['rest','sleep','wake','activate','deactivate'].includes(e.type)&&exact(e,['sequence','type']))return structuredClone(e);
  throw new Error('Invalid physiology effect');
}
export function validateBodyState(value:unknown,tick:number,hz?:number):BodyState {
  const s=value as BodyState;
  if(!exact(s,['schemaVersion','rulesVersion','config','hz','active','activationTick','lastIntegratedTick','circadianAnchorTick','satiety','reserves','sleepPressure','condition','fatigue','mode','modeSinceTick','lastEffectSequence','absorption'])||s.schemaVersion!==1||s.rulesVersion!==PHYSIOLOGY_RULES||!integer(s.hz,1,120)||hz!==undefined&&s.hz!==hz||typeof s.active!=='boolean'||s.lastIntegratedTick!==tick)throw new Error('Invalid body checkpoint');
  validatePhysiologyConfig(s.config);
  if(!integer(tick)||![s.activationTick,s.circadianAnchorTick,s.modeSinceTick].every(v=>integer(v,0,tick))||s.circadianAnchorTick<s.activationTick||s.modeSinceTick<s.activationTick||![s.satiety,s.reserves,s.sleepPressure,s.condition,s.fatigue].every(v=>finite(v))||s.condition<.1||!['awake','resting','asleep','incapacitated'].includes(s.mode)||!integer(s.lastEffectSequence)||!Array.isArray(s.absorption)||s.absorption.length>32)throw new Error('Invalid body state');
  let previous=0;for(const a of s.absorption){if(!exact(a,['sequence','reservesRemaining','secondsRemaining'])||!integer(a.sequence,previous+1,s.lastEffectSequence)||!finite(a.reservesRemaining,Number.EPSILON,1)||!finite(a.secondsRemaining,Number.EPSILON,14400))throw new Error('Invalid absorption progress');previous=a.sequence;}
  return structuredClone(s);
}
export function validateInternalSensation(value:unknown):InternalSensation {
  const s=value as InternalSensation;
  if(!exact(s,['observationId','attentionId','kind','band','description','uncertainty','provenance'])||!identifier(s.observationId,'internal-observation-')||!identifier(s.attentionId,'internal-attention-')||!INTERNAL_KINDS.includes(s.kind)||!band(s.band)||typeof s.description!=='string'||s.description!==internalDescription(s.kind,s.band)||s.uncertainty!=='coarse_internal_signal'||s.provenance!=='SIMULATED_INTEROCEPTION')throw new Error('Invalid internal sensation');
  return structuredClone(s);
}
export function internalDescription(kind:InternalKind,level:SensationBand):string {
  return {hunger:{mild:'My stomach feels a little empty.',moderate:'My stomach feels empty and distracting.',severe:'My stomach feels insistently empty.'},sleep:{mild:'My eyelids feel a little heavy.',moderate:'My eyelids feel heavy and I feel drowsy.',severe:'It feels very difficult to stay alert.'},discomfort:{mild:'My body feels a little worn.',moderate:'My body feels weak and uncomfortable.',severe:'My body feels seriously weak and uncomfortable.'}}[kind][level];
}
export function validateInteroceptionState(value:unknown,tick:number,hz:number,config:PhysiologyConfig=DEFAULT_PHYSIOLOGY_CONFIG):InteroceptionState {
  const s=value as InteroceptionState;
  if(!exact(s,['schemaVersion','rulesVersion','lastIntegratedTick','nextObservationId','nextAttentionId','slots','transient'])||s.schemaVersion!==1||s.rulesVersion!==PHYSIOLOGY_RULES||s.lastIntegratedTick!==tick||!integer(tick)||!integer(hz,1,120)||!integer(s.nextObservationId,1)||!integer(s.nextAttentionId,1)||!Array.isArray(s.slots)||s.slots.length!==3||!Array.isArray(s.transient)||s.transient.length>3)throw new Error('Invalid interoception state');
  const observations=new Set<string>();
  for(const [i,slot] of s.slots.entries()) {
    if(!exact(slot,['kind','band','lastSensedTick','candidate','urgent'])||slot.kind!==INTERNAL_KINDS[i]||slot.band!==null&&!band(slot.band)||slot.lastSensedTick!==null&&!integer(slot.lastSensedTick,0,tick))throw new Error('Invalid internal cue slot');
    if(slot.candidate!==null){const c=slot.candidate;if(!exact(c,['observationId','kind','band','sensedTick'])||!identifier(c.observationId,'internal-observation-')||Number(c.observationId.slice(21))>=s.nextObservationId||c.kind!==slot.kind||c.band!==slot.band||!band(c.band)||!integer(c.sensedTick,0,tick)||c.sensedTick!==slot.lastSensedTick||observations.has(c.observationId))throw new Error('Invalid internal candidate');observations.add(c.observationId);}
    if(slot.urgent!==null){const u=slot.urgent;if(!exact(u,['crossingTick','firstAttendedTick','eligibleTicks','excludedSafetyTicks','excludedIncapacityTicks','excludedInactiveTicks','retries','lastAttemptTick','breachTick'])||slot.band!=='severe'||!integer(u.crossingTick,0,tick)||![u.eligibleTicks,u.excludedSafetyTicks,u.excludedIncapacityTicks,u.excludedInactiveTicks,u.retries].every(v=>integer(v,0,tick-u.crossingTick+1))||u.eligibleTicks+u.excludedSafetyTicks+u.excludedIncapacityTicks+u.excludedInactiveTicks!==(u.firstAttendedTick??tick)-u.crossingTick||u.firstAttendedTick!==null&&!integer(u.firstAttendedTick,u.crossingTick,tick)||u.lastAttemptTick!==null&&!integer(u.lastAttemptTick,u.crossingTick,tick)||(u.lastAttemptTick===null)!==(u.retries===0)||u.breachTick!==null&&(!integer(u.breachTick,u.crossingTick,tick)||u.breachTick!==u.firstAttendedTick)||u.breachTick!==null&&u.eligibleTicks<=Math.ceil(config.urgentAttentionSeconds*hz))throw new Error('Invalid urgent need');}
  }
  const kinds=new Set<InternalKind>();
  for(const t of s.transient){if(!exact(t,['percept','sensedTick','attendedTick','expiresTick'])||!integer(t.sensedTick,0,tick)||!integer(t.attendedTick,t.sensedTick,tick)||!integer(t.expiresTick,tick+1,tick+Math.ceil(config.transientSeconds*hz))||t.expiresTick!==t.attendedTick+Math.ceil(config.transientSeconds*hz)||kinds.has(t.percept?.kind))throw new Error('Invalid internal transient');validateInternalSensation(t.percept);if(Number(t.percept.observationId.slice(21))>=s.nextObservationId||Number(t.percept.attentionId.slice(19))>=s.nextAttentionId)throw new Error('Invalid internal evidence cursor');kinds.add(t.percept.kind);}
  return structuredClone(s);
}
