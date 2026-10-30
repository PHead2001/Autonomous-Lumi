import {
  DEFAULT_PHYSIOLOGY_CONFIG, INTERNAL_KINDS, PHYSIOLOGY_RULES, internalDescription, validatePhysiologyEffect,
  type BodyState, type BodyMode, type BodyCapability, type BodyImpairment, type BodyStepContext, type PhysiologyEffect,
  type PhysiologyEvent, type InteroceptionState, type InteroceptionStepContext, type SensationBand, type InternalKind, type InternalSensation, type InternalSensationContext,
} from '../shared/physiology-protocol.js';

const clamp=(n:number)=>Math.max(0,Math.min(1,n));
function clock(tick:number,hz:number):void {if(!Number.isSafeInteger(tick)||tick<0||!Number.isSafeInteger(hz)||hz<1||hz>120)throw new Error('Invalid physiology clock');}
export function createBody(tick=0,hz=30,active=false):BodyState {
  clock(tick,hz);
  return {schemaVersion:1,rulesVersion:PHYSIOLOGY_RULES,config:{...DEFAULT_PHYSIOLOGY_CONFIG},hz,active,activationTick:tick,lastIntegratedTick:tick,circadianAnchorTick:tick,satiety:.85,reserves:.9,sleepPressure:.15,condition:1,fatigue:.05,mode:'awake',modeSinceTick:tick,lastEffectSequence:0,absorption:[]};
}
export function createInteroception(tick=0):InteroceptionState {
  clock(tick,1);
  return {schemaVersion:1,rulesVersion:PHYSIOLOGY_RULES,lastIntegratedTick:tick,nextObservationId:1,nextAttentionId:1,slots:INTERNAL_KINDS.map(kind=>({kind,band:null,lastSensedTick:null,candidate:null,urgent:null})),transient:[]};
}
export function bodyCapability(s:BodyState):BodyCapability {
  const reason=!s.active||s.mode==='awake'||s.mode==='resting'?'available':s.mode;
  return {awake:reason==='available',canAttend:reason==='available',canAct:reason==='available',reason};
}
/** Bounded deterministic slowing. Collision, emergency stop and reflex paths must not use these scales. */
export function bodyImpairment(s:BodyState):BodyImpairment {
  if(!s.active)return {movementScale:1,headScale:1,taskScale:1,ordinaryAttentionScale:1};
  const load=clamp(Math.max(s.fatigue,(s.sleepPressure-.4)/.6));
  return {movementScale:1-.3*load,headScale:1-.4*load,taskScale:1-.5*load,ordinaryAttentionScale:1-.6*load};
}
export function circadianPhase(s:BodyState):number {return ((s.lastIntegratedTick-s.circadianAnchorTick)/s.hz%s.config.circadianPeriodSeconds)/s.config.circadianPeriodSeconds;}
/** Apply ordered effects before motor execution. Integration may subsequently receive an empty effect list. */
export function applyAcceptedBodyEffect(previous:BodyState,raw:PhysiologyEffect,tick=previous.lastIntegratedTick):{state:BodyState;events:PhysiologyEvent[]} {
  clock(tick,previous.hz);
  if(tick<previous.lastIntegratedTick||tick>previous.lastIntegratedTick+1)throw new Error('Invalid body effect timing');
  const effect=validatePhysiologyEffect(raw),state:BodyState={...previous,absorption:previous.absorption.map(a=>({...a}))},events:PhysiologyEvent[]=[];
  const emit=(type:string,data:PhysiologyEvent['data'])=>events.push({type,tick,data});
  const transition=(mode:BodyMode,cause:string)=>{if(state.mode!==mode){emit('BODY_MODE_CHANGED',{from:state.mode,to:mode,cause});state.mode=mode;state.modeSinceTick=tick;}};
  if(effect.sequence<=state.lastEffectSequence){emit('BODY_EFFECT_DUPLICATE',{sequence:effect.sequence});return {state,events};}
  if(effect.sequence!==state.lastEffectSequence+1)throw new Error('Nonconsecutive physiology effect sequence');
  state.lastEffectSequence=effect.sequence;
  if(effect.type==='activate'||effect.type==='deactivate'){state.active=effect.type==='activate';emit('BODY_ACTIVATION_CHANGED',{active:state.active,sequence:effect.sequence});return {state,events};}
  if(!state.active){emit('BODY_EFFECT_REJECTED',{sequence:effect.sequence,cause:'physiology_inactive'});return {state,events};}
  if(effect.type==='intake') {
    if(effect.reserves>0&&state.absorption.length>=32)throw new Error('Physiology absorption capacity exceeded');
    state.satiety=clamp(state.satiety+effect.satiety);
    if(effect.reserves>0)state.absorption.push({sequence:effect.sequence,reservesRemaining:effect.reserves,secondsRemaining:effect.absorptionSeconds});
    emit('BODY_INTAKE_ACCEPTED',{sequence:effect.sequence,satiety:effect.satiety,reserves:effect.reserves,absorptionSeconds:effect.absorptionSeconds});
  }else if(effect.type==='sleep'&&state.mode!=='incapacitated')transition('asleep','accepted_sleep');
  else if(effect.type==='rest'&&state.mode==='awake')transition('resting','accepted_rest');
  else if(effect.type==='wake'&&state.mode==='resting')transition('awake','accepted_wake');
  else if(effect.type==='wake'&&state.mode==='asleep'&&state.sleepPressure<=state.config.wakePressure&&state.condition>state.config.incapacityCondition)transition('awake','accepted_wake');
  else emit('BODY_EFFECT_REJECTED',{sequence:effect.sequence,cause:'physical_limit'});
  return {state,events};
}
export function advanceBody(previous:BodyState,ctx:BodyStepContext,acceptedEffects:readonly PhysiologyEffect[]=[]):{state:BodyState;events:PhysiologyEvent[];capability:BodyCapability;impairment:BodyImpairment} {
  clock(ctx.tick,ctx.hz);
  if(ctx.hz!==previous.hz||ctx.tick!==previous.lastIntegratedTick+1)throw new Error('Body requires exactly one consecutive fixed tick');
  if(!ctx.executed||Object.keys(ctx.executed).sort().join(',')!=='distanceMetres,headRadians,taskProgress'||!Object.values(ctx.executed).every(n=>Number.isFinite(n)&&n>=0)||ctx.executed.distanceMetres>10||ctx.executed.taskProgress>10000||ctx.executed.headRadians>Math.PI*2||typeof ctx.safetyPreempted!=='boolean'||typeof ctx.capableAtIntervalStart!=='boolean'||acceptedEffects.length>32)throw new Error('Invalid executed body interval');
  let state:BodyState={...previous,absorption:previous.absorption.map(a=>({...a})),lastIntegratedTick:ctx.tick};const events:PhysiologyEvent[]=[];
  const emit=(type:string,data:PhysiologyEvent['data'])=>events.push({type,tick:ctx.tick,data});
  const transition=(mode:BodyMode,cause:string)=>{if(state.mode!==mode){emit('BODY_MODE_CHANGED',{from:state.mode,to:mode,cause});state.mode=mode;state.modeSinceTick=ctx.tick;}};
  const c=state.config,dt=1/ctx.hz;
  // Accepted effects -> absorption -> actual expenditure -> recovery -> physical transitions.
  // Duplicates are harmless even after absorption has completed; the sequence cursor never shrinks.
  for(const raw of acceptedEffects){const applied=applyAcceptedBodyEffect(state,raw);state=applied.state;events.push(...applied.events);}
  if(state.active) {
    for(const a of state.absorption) {
      const portion=a.reservesRemaining*Math.min(1,dt/a.secondsRemaining);
      state.reserves=clamp(state.reserves+portion);a.reservesRemaining=Math.max(0,a.reservesRemaining-portion);a.secondsRemaining=Math.max(0,a.secondsRemaining-dt);
      if(a.secondsRemaining===0||a.reservesRemaining===0)emit('BODY_ABSORPTION_COMPLETED',{sequence:a.sequence});
    }
    state.absorption=state.absorption.filter(a=>a.secondsRemaining>0&&a.reservesRemaining>0);
    const asleep=state.mode==='asleep'||state.mode==='incapacitated',resting=state.mode==='resting';
    state.satiety=clamp(state.satiety-c.satietyUsePerSecond*dt);
    // Actual execution is accounted even if a physical transition occurs later in this interval.
    const e=ctx.executed;
    state.reserves=clamp(state.reserves-c.reserveUsePerSecond*dt*(asleep?.7:resting?.85:1)-e.distanceMetres*c.reserveUsePerMetre-e.taskProgress*c.reserveUsePerTaskUnit-e.headRadians*c.reserveUsePerHeadRadian);
    state.sleepPressure=clamp(state.sleepPressure+dt*(asleep?-c.sleepPressureRecoveryPerSecond:resting?-c.restPressureRecoveryPerSecond:c.awakePressurePerSecond));
    // Exactly two cross-effects: low reserves and high sleep pressure increase recoverable fatigue.
    const reserveLoad=clamp((.25-state.reserves)/.25),sleepLoad=clamp((state.sleepPressure-.65)/.35);
    const fatigueRecovery=asleep?c.sleepFatigueRecoveryPerSecond:resting?c.restFatigueRecoveryPerSecond:c.fatigueRecoveryPerSecond;
    state.fatigue=clamp(state.fatigue+dt*(reserveLoad*c.lowReserveFatiguePerSecond+(!asleep?sleepLoad*c.sleepDebtFatiguePerSecond:0)-fatigueRecovery));
    if(state.reserves<.12)state.condition=clamp(Math.max(.1,state.condition-c.conditionLossPerSecond*dt*(.12-state.reserves)/.12));
    else if(asleep||resting)state.condition=clamp(state.condition+c.conditionRecoveryPerSecond*dt);
    if(state.condition<=c.incapacityCondition)transition('incapacitated','condition_limit');
    else if(state.mode==='incapacitated'&&state.condition>=c.recoveryCondition&&state.reserves>=.15&&state.sleepPressure<=.4)transition('awake','condition_recovered');
    else if(state.mode!=='incapacitated'&&state.mode!=='asleep'&&state.sleepPressure>=c.forcedSleepPressure)transition('asleep','sleep_pressure_limit');
    else if(state.mode==='asleep'&&state.sleepPressure<=c.wakePressure)transition('awake','sleep_recovered');
  }else state.circadianAnchorTick++;
  return {state,events,capability:bodyCapability(state),impairment:bodyImpairment(state)};
}

export function sensationBand(body:BodyState,kind:InternalKind):SensationBand|null {
  if(!body.active)return null;
  const need=kind==='hunger'?1-body.satiety:kind==='sleep'?body.sleepPressure:Math.max(1-body.condition,body.fatigue*.8);
  const thresholds=kind==='hunger'?[.45,.7,.9]:kind==='sleep'?[.45,.65,.78]:[.3,.5,.7];
  return need>=thresholds[2]?'severe':need>=thresholds[1]?'moderate':need>=thresholds[0]?'mild':null;
}
/** Local sensor/attention path. No provider, encoding, commitment, or memory dependency. */
export function advanceInteroception(previous:InteroceptionState,body:BodyState,ctx:InteroceptionStepContext):{state:InteroceptionState;events:PhysiologyEvent[];attended:InternalSensation[]} {
  clock(ctx.tick,ctx.hz);
  if(ctx.tick!==previous.lastIntegratedTick+1||ctx.tick!==body.lastIntegratedTick||ctx.hz!==body.hz||![ctx.safetyPreempted,ctx.capableAtIntervalStart,ctx.ordinaryAttentionAllowed].every(v=>typeof v==='boolean'))throw new Error('Interoception requires the current consecutive body tick');
  const state:InteroceptionState={...previous,lastIntegratedTick:ctx.tick,slots:previous.slots.map(s=>({...s,candidate:s.candidate?{...s.candidate}:null,urgent:s.urgent?{...s.urgent}:null})),transient:previous.transient.filter(t=>t.expiresTick>ctx.tick)},events:PhysiologyEvent[]=[],attended:InternalSensation[]=[];
  if(!body.active){for(const slot of state.slots)if(slot.urgent&&slot.urgent.firstAttendedTick===null)slot.urgent.excludedInactiveTicks++;return {state,events,attended};}
  const emit=(type:string,data:PhysiologyEvent['data'])=>events.push({type,tick:ctx.tick,data});
  // Interval accounting uses its start capability; sensation admission uses the present endpoint.
  // Thus the last awake interval is never hidden, and a wake endpoint can attend immediately.
  const capable=bodyCapability(body).canAttend;
  const deadline=Math.ceil(body.config.urgentAttentionSeconds*ctx.hz),forceAt=Math.max(0,deadline-1),cooldown=Math.ceil(body.config.cueCooldownSeconds*ctx.hz);
  for(const slot of state.slots) {
    const band=sensationBand(body,slot.kind),changed=slot.band!==band;
    if(changed)slot.candidate=null;
    if(band!== 'severe'&&slot.urgent){emit('INTERNAL_URGENT_RESOLVED',{kind:slot.kind,crossingTick:slot.urgent.crossingTick,firstAttendedTick:slot.urgent.firstAttendedTick,eligibleTicks:slot.urgent.eligibleTicks,excludedSafetyTicks:slot.urgent.excludedSafetyTicks,excludedIncapacityTicks:slot.urgent.excludedIncapacityTicks,excludedInactiveTicks:slot.urgent.excludedInactiveTicks});slot.urgent=null;}
    if(band==='severe'&&!slot.urgent){slot.urgent={crossingTick:ctx.tick,firstAttendedTick:null,eligibleTicks:0,excludedSafetyTicks:0,excludedIncapacityTicks:0,excludedInactiveTicks:0,retries:0,lastAttemptTick:null,breachTick:null};emit('INTERNAL_URGENT_CROSSED',{kind:slot.kind,crossingTick:ctx.tick,deadlineEligibleTicks:deadline});}
    slot.band=band;
    if(band===null){slot.candidate=null;continue;}
    const urgent=slot.urgent;
    if(urgent&&urgent.firstAttendedTick===null&&ctx.tick>urgent.crossingTick) {
      if(!ctx.capableAtIntervalStart)urgent.excludedIncapacityTicks++;
      else if(ctx.safetyPreempted)urgent.excludedSafetyTicks++;
      else urgent.eligibleTicks++;
    }
    // Unconscious changes do not become observations; a previously sensed urgent cue stays pending.
    if(capable&&(changed||slot.lastSensedTick===null||ctx.tick-slot.lastSensedTick>=cooldown||urgent&&urgent.firstAttendedTick===null&&slot.candidate===null)) {
      slot.candidate={observationId:`internal-observation-${state.nextObservationId++}`,kind:slot.kind,band,sensedTick:ctx.tick};slot.lastSensedTick=ctx.tick;
      emit('INTERNAL_SENSED',{observationId:slot.candidate.observationId,kind:slot.kind,band});
    }
    const candidate=slot.candidate;
    if(!candidate)continue;
    // One-step margin avoids a needless deadline tie with a later hard sleep transition.
    // The configured interval is a maximum eligible delay, not a promise to wait until it.
    const forced=!!urgent&&urgent.firstAttendedTick===null&&urgent.eligibleTicks>=forceAt;
    if(!capable||ctx.safetyPreempted||!forced&&!ctx.ordinaryAttentionAllowed) {
      // Count retries on a bounded cadence; never reset crossing/deadline on coalescing.
      if(urgent&&urgent.firstAttendedTick===null&&(urgent.lastAttemptTick===null||ctx.tick-urgent.lastAttemptTick>=ctx.hz)){urgent.retries++;urgent.lastAttemptTick=ctx.tick;}
      if(changed||ctx.tick===candidate.sensedTick)emit('INTERNAL_IGNORED',{observationId:candidate.observationId,kind:slot.kind,reason:!capable?'incapacity':ctx.safetyPreempted?'safety_preemption':'ordinary_suppression'});
      if(!urgent&&ctx.tick-candidate.sensedTick>=Math.ceil(body.config.transientSeconds*ctx.hz))slot.candidate=null;
      continue;
    }
    const percept:InternalSensation={observationId:candidate.observationId,attentionId:`internal-attention-${state.nextAttentionId++}`,kind:candidate.kind,band:candidate.band,description:internalDescription(candidate.kind,candidate.band),uncertainty:'coarse_internal_signal',provenance:'SIMULATED_INTEROCEPTION'};
    state.transient=state.transient.filter(t=>t.percept.kind!==slot.kind);
    state.transient.push({percept,sensedTick:candidate.sensedTick,attendedTick:ctx.tick,expiresTick:ctx.tick+Math.ceil(body.config.transientSeconds*ctx.hz)});
    slot.candidate=null;attended.push(percept);
    if(urgent&&urgent.firstAttendedTick===null){urgent.firstAttendedTick=ctx.tick;if(urgent.eligibleTicks>deadline){urgent.breachTick=ctx.tick;emit('INTERNAL_DEADLINE_BREACH',{kind:slot.kind,eligibleTicks:urgent.eligibleTicks});}}
    emit('INTERNAL_ATTENDED',{observationId:percept.observationId,attentionId:percept.attentionId,kind:slot.kind,band:percept.band,forced,crossingTick:urgent?.crossingTick??null,elapsedWorldSeconds:urgent?(ctx.tick-urgent.crossingTick)/ctx.hz:0,eligibleSeconds:urgent?urgent.eligibleTicks/ctx.hz:0,excludedSafetySeconds:urgent?urgent.excludedSafetyTicks/ctx.hz:0,excludedIncapacitySeconds:urgent?urgent.excludedIncapacityTicks/ctx.hz:0,excludedInactiveSeconds:urgent?urgent.excludedInactiveTicks/ctx.hz:0});
  }
  return {state,events,attended};
}
/** Construct a new allowlisted object even if private metadata was attached upstream. */
export function presentInternalSensations(state:InteroceptionState,active:boolean):InternalSensation[] {
  return active?state.transient.map(({percept:p})=>({observationId:p.observationId,attentionId:p.attentionId,kind:p.kind,band:p.band,description:p.description,uncertainty:p.uncertainty,provenance:p.provenance})):[];
}
/** Provider-facing sensation fields only. Correlation IDs and provenance stay in trusted evidence. */
export function providerInternalSensations(state:InteroceptionState,active:boolean):InternalSensationContext[] {
  return active?state.transient.map(({percept:p})=>({kind:p.kind,band:p.band,description:p.description,uncertainty:p.uncertainty})):[];
}
