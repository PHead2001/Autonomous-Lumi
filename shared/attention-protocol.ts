/** Phase 2b local sensory evidence. Values are normalized game units, never calibrated dB. */
export const AUTOMATIC_CAPTURE_REASONS = ['salient_sound','head_milestone','visible_change','viewpoint_change','activity_outcome','uncertainty_probe'] as const;
export type AutomaticCaptureReason = typeof AUTOMATIC_CAPTURE_REASONS[number];
export interface ReceivedSound {
  observationId: string; tick: number; intensity: number; suddenness: number;
  bearingDegrees: number | null; directionUncertaintyDegrees: number;
  distanceBand: 'near'|'middle'|'far'|'unknown'; distanceUncertainty: number;
  /** Own pose at reception, retained to compensate only for her later rotation. */
  bodyHeading: number; headYaw: number;
  provenance: 'SIMULATED_HEARING';
}
export interface SensorPose { x:number;y:number;z:number;bodyHeading:number;headYaw:number;headPitch:number }
export interface CaptureIntent {
  id:number;createdTick:number;expiresTick:number;reasons:AutomaticCaptureReason[];
  /** At most the first and latest trigger per reason, so admission can split causes
   * that executed after the immutable capture tick even before its ack was applied. */
  triggers:{reason:AutomaticCaptureReason;tick:number;parentSequence:number|null}[];
  parentSequence:number|null;status:'pending'|'submitted';captureId:string|null;requestedTick:number|null;
}
/** A compact 4x4 RGB cell mean signature, quantized to integer channel values. No pixels/identities. */
export interface PerceptualBaseline { capturedTick:number;sceneRevision:number;pose:SensorPose;signature:number[];frameHash:string;captureId:string }
export interface AttentionDecision {
  tick:number;observationId:string;outcome:'ignored'|'glance'|'investigate'|'unreachable';
  score:number;novelty:number;exposure:number;commitment:number;switchingCost:number;reason:string;
}
export const DEFAULT_ATTENTION_CONFIG = {
  distanceFalloff:.035,wallTransmission:.22,doorTransmission:.42,objectTransmission:.65,
  hearingFloor:.015,reflexIntensity:.34,reflexSuddenness:.65,
  glanceThreshold:.52,investigateThreshold:.83,habituationPenalty:.24,exposureRecoveryTicks:900,
  attentionCooldownTicks:90,commitmentTicks:45,developerPriorityTicks:90,
  captureCooldownTicks:90,probeIntervalTicks:900,intentionLifetimeTicks:300,
  captureWindowTicks:1800,maxCapturesPerWindow:6,resultMaxAgeTicks:600,
  retryBackoffTicks:150,maxRetryBackoffTicks:1800,
  visualChangeThreshold:.01,viewpointDistance:1,viewpointRadians:Math.PI/4,
};
export type AttentionConfig = typeof DEFAULT_ATTENTION_CONFIG;
export interface AttentionState {
  config:AttentionConfig;nextObservationId:number;nextIntentId:number;
  exposures:{key:string;count:number;lastTick:number;intensity:number;suddenness:number}[];
  lastReceived:ReceivedSound|null;lastDecision:AttentionDecision|null;
  commitmentUntilTick:number;cooldownUntilTick:number;developerUntilTick:number;
  automaticActionId:number|null;automaticObservationId:string|null;resumeActivity:boolean;
  pending:CaptureIntent|null;deferred:CaptureIntent|null;baseline:PerceptualBaseline|null;
  nextProbeTick:number;captureCooldownUntilTick:number;captureWindowStartTick:number;capturesInWindow:number;
  failureCount:number;retryAfterTick:number;lastAcceptedCaptureTick:number;
  lastSuppression:{tick:number;reason:AutomaticCaptureReason;cause:string}|null;
  lastCapture:{intentId:number;captureId:string|null;capturedTick:number;receivedTick:number;outcome:string;freshness:string;difference:number|null;reasons:AutomaticCaptureReason[]}|null;
}
export interface EmitSoundCommand {type:'emit_sound';x:number;y:number;z:number;intensity:number;suddenness:number;sourceId:string}
/** Only private runtime/host code admits feedback. Public visitor normalization never does. */
export interface SensorFeedbackCommand {
  type:'sensor_feedback';intentId:number;stage:'admitted'|'result'|'rejected'|'recovered';
  captureId:string|null;capturedTick:number;sceneRevision:number;pose:SensorPose;
  outcome:'success'|'failed'|'timeout'|'unavailable'|'stale'|'quota'|'queue_full'|'retired'|'interrupted';
  signature:number[]|null;frameHash:string|null;
}
export type SensoryCommand = EmitSoundCommand|SensorFeedbackCommand;
const exact=(v:unknown,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',');
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const integer=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):v is number=>finite(v,min,max)&&Number.isSafeInteger(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
export function validateSensorPose(value:unknown):SensorPose {
  const p=value as SensorPose;
  if(!exact(p,['x','y','z','bodyHeading','headYaw','headPitch'])||![p.x,p.y,p.z].every(v=>finite(v,-100,100))||![p.bodyHeading,p.headYaw,p.headPitch].every(v=>finite(v,-Math.PI,Math.PI)))throw new Error('Invalid sensor pose');
  return structuredClone(p);
}
export function validateSensoryCommand(value:unknown):SensoryCommand {
  const c=value as SensoryCommand;
  if(c?.type==='emit_sound'&&exact(c,['type','x','y','z','intensity','suddenness','sourceId'])&&[c.x,c.y,c.z].every(v=>finite(v,-20,20))&&finite(c.intensity,0,1)&&finite(c.suddenness,0,1)&&id(c.sourceId))return structuredClone(c);
  if(c?.type==='sensor_feedback'&&exact(c,['type','intentId','stage','captureId','capturedTick','sceneRevision','pose','outcome','signature','frameHash'])&&integer(c.intentId,1)&&['admitted','result','rejected','recovered'].includes(c.stage)&&['success','failed','timeout','unavailable','stale','quota','queue_full','retired','interrupted'].includes(c.outcome)&&integer(c.capturedTick)&&integer(c.sceneRevision)&&(c.captureId===null||id(c.captureId))&&(c.frameHash===null||typeof c.frameHash==='string'&&/^[a-f0-9]{64}$/.test(c.frameHash))&&(c.signature===null||Array.isArray(c.signature)&&c.signature.length===48&&c.signature.every(v=>integer(v,0,255)))) {
    validateSensorPose(c.pose);
    if(c.stage==='admitted'&&(c.outcome!=='success'||c.captureId===null||c.signature!==null||c.frameHash!==null)||c.stage==='result'&&c.outcome==='success'&&(c.signature===null||c.frameHash===null||c.captureId===null)||c.stage!=='result'&&(c.signature!==null||c.frameHash!==null))throw new Error('Invalid sensor result payload');
    return structuredClone(c);
  }
  throw new Error('Invalid sensory command');
}
export function defaultAttentionState(tick=0):AttentionState {
  return {config:{...DEFAULT_ATTENTION_CONFIG},nextObservationId:1,nextIntentId:1,exposures:[],lastReceived:null,lastDecision:null,commitmentUntilTick:0,cooldownUntilTick:0,developerUntilTick:0,automaticActionId:null,automaticObservationId:null,resumeActivity:false,pending:null,deferred:null,baseline:null,nextProbeTick:tick+DEFAULT_ATTENTION_CONFIG.probeIntervalTicks,captureCooldownUntilTick:0,captureWindowStartTick:tick,capturesInWindow:0,failureCount:0,retryAfterTick:0,lastAcceptedCaptureTick:-1,lastSuppression:null,lastCapture:null};
}
export function imageSignatureDifference(a:number[],b:number[]):number {if(a.length!==48||b.length!==48)throw new Error('Invalid image signatures');return a.reduce((sum,value,i)=>sum+Math.abs(value-b[i]),0)/(48*255);}
export function validateAttentionState(value:unknown,tick:number):AttentionState {
  const a=value as AttentionState;
  if(!exact(a,Object.keys(defaultAttentionState())))throw new Error('Invalid attention state fields');
  const c=a.config;
  if(!exact(c,Object.keys(DEFAULT_ATTENTION_CONFIG)))throw new Error('Invalid attention configuration');
  for(const [key,v] of Object.entries(c)) {
    const expected=DEFAULT_ATTENTION_CONFIG[key as keyof AttentionConfig];
    if(!finite(v,0,100000)||expected>1&&key!=='viewpointRadians'&&!integer(v,1,100000))throw new Error('Invalid attention configuration value');
  }
  if(c.distanceFalloff<=0||c.hearingFloor<=0||c.reflexIntensity<=0||c.reflexIntensity>1||c.reflexSuddenness>1||c.glanceThreshold>=c.investigateThreshold||c.wallTransmission>1||c.doorTransmission>1||c.objectTransmission>1||c.visualChangeThreshold<=0||c.visualChangeThreshold>1||c.exposureRecoveryTicks<1||c.intentionLifetimeTicks<1||c.maxCapturesPerWindow<1||c.maxCapturesPerWindow>60)throw new Error('Invalid attention configuration range');
  for(const key of ['nextObservationId','nextIntentId'] as const)if(!integer(a[key],1))throw new Error('Invalid attention cursor');
  for(const key of ['commitmentUntilTick','cooldownUntilTick','developerUntilTick','nextProbeTick','captureCooldownUntilTick','captureWindowStartTick','capturesInWindow','failureCount','retryAfterTick'] as const)if(!integer(a[key],0))throw new Error('Invalid attention deadline');
  if(a.captureWindowStartTick>tick||a.capturesInWindow>c.maxCapturesPerWindow||a.failureCount>32||!integer(a.lastAcceptedCaptureTick,-1,tick)||typeof a.resumeActivity!=='boolean'||!(a.automaticActionId===null||integer(a.automaticActionId,1))||!(a.automaticObservationId===null||id(a.automaticObservationId))||(a.automaticActionId===null)!==(a.automaticObservationId===null))throw new Error('Invalid attention control state');
  if(!Array.isArray(a.exposures)||a.exposures.length>8)throw new Error('Invalid exposure state');
  const keys=new Set<string>();
  for(const e of a.exposures){if(!exact(e,['key','count','lastTick','intensity','suddenness'])||typeof e.key!=='string'||!/^b(?:null|-?\d+)-i\d+-s\d+$/.test(e.key)||keys.has(e.key)||!integer(e.count,1,32)||!integer(e.lastTick,0,tick)||!finite(e.intensity,0,1)||!finite(e.suddenness,0,1))throw new Error('Invalid exposure');keys.add(e.key);}
  if(a.lastReceived!==null) {
    const r=a.lastReceived;
    if(!exact(r,['observationId','tick','intensity','suddenness','bearingDegrees','directionUncertaintyDegrees','distanceBand','distanceUncertainty','bodyHeading','headYaw','provenance'])||!id(r.observationId)||!integer(r.tick,0,tick)||!finite(r.intensity,0,1)||!finite(r.suddenness,0,1)||!(r.bearingDegrees===null||integer(r.bearingDegrees,-180,180)&&r.bearingDegrees%15===0)||!finite(r.directionUncertaintyDegrees,0,180)||!finite(r.distanceUncertainty,0,1)||!['near','middle','far','unknown'].includes(r.distanceBand)||!finite(r.bodyHeading,-Math.PI,Math.PI)||!finite(r.headYaw,-Math.PI,Math.PI)||r.provenance!=='SIMULATED_HEARING')throw new Error('Invalid received evidence');
  }
  if(a.lastDecision!==null) {
    const d=a.lastDecision;
    if(!exact(d,['tick','observationId','outcome','score','novelty','exposure','commitment','switchingCost','reason'])||!integer(d.tick,0,tick)||!id(d.observationId)||!['ignored','glance','investigate','unreachable'].includes(d.outcome)||![d.score,d.novelty,d.exposure,d.commitment,d.switchingCost].every(v=>finite(v,-10,32))||typeof d.reason!=='string'||!id(d.reason))throw new Error('Invalid attention decision');
  }
  for(const p of [a.pending,a.deferred])if(p!==null) {
    if(!exact(p,['id','createdTick','expiresTick','reasons','triggers','parentSequence','status','captureId','requestedTick'])||!integer(p.id,1,a.nextIntentId-1)||!integer(p.createdTick,0,tick)||!integer(p.expiresTick,p.createdTick+1)||!Array.isArray(p.reasons)||p.reasons.length<1||p.reasons.length>AUTOMATIC_CAPTURE_REASONS.length||new Set(p.reasons).size!==p.reasons.length||p.reasons.some(r=>!AUTOMATIC_CAPTURE_REASONS.includes(r))||!(p.parentSequence===null||integer(p.parentSequence,1))||!['pending','submitted'].includes(p.status)||!(p.captureId===null||id(p.captureId))||!(p.requestedTick===null||integer(p.requestedTick,p.createdTick,tick))||(p.status==='pending'&&(p.captureId!==null||p.requestedTick!==null))||(p.status==='submitted'&&(p.captureId===null||p.requestedTick===null)))throw new Error('Invalid capture intention');
    if(!Array.isArray(p.triggers)||p.triggers.length<1||p.triggers.length>AUTOMATIC_CAPTURE_REASONS.length*2||p.triggers.some(t=>!exact(t,['reason','tick','parentSequence'])||!p.reasons.includes(t.reason)||!integer(t.tick,p.createdTick,tick)||!(t.parentSequence===null||integer(t.parentSequence,1)))||p.reasons.some(reason=>p.triggers.filter(t=>t.reason===reason).length<1||p.triggers.filter(t=>t.reason===reason).length>2)||p.status==='submitted'&&p.triggers.some(t=>t.tick>p.requestedTick!))throw new Error('Invalid capture trigger history');
  }
  if(a.deferred&&(a.deferred.status!=='pending'||a.pending&&a.pending.id===a.deferred.id))throw new Error('Invalid deferred intention');
  if(a.baseline!==null) {
    const b=a.baseline;
    if(!exact(b,['capturedTick','sceneRevision','pose','signature','frameHash','captureId'])||!integer(b.capturedTick,0,tick)||!integer(b.sceneRevision)||!id(b.captureId)||typeof b.frameHash!=='string'||!/^[a-f0-9]{64}$/.test(b.frameHash)||!Array.isArray(b.signature)||b.signature.length!==48||b.signature.some(v=>!integer(v,0,255)))throw new Error('Invalid perceptual baseline');validateSensorPose(b.pose);
    if(b.capturedTick!==a.lastAcceptedCaptureTick)throw new Error('Inconsistent perceptual cursor');
  }else if(a.lastAcceptedCaptureTick!==-1)throw new Error('Missing perceptual baseline');
  if(a.lastCapture!==null) {
    const r=a.lastCapture;
    if(!exact(r,['intentId','captureId','capturedTick','receivedTick','outcome','freshness','difference','reasons'])||!integer(r.intentId,1,a.nextIntentId-1)||!(r.captureId===null||id(r.captureId))||!integer(r.capturedTick,0,tick)||!integer(r.receivedTick,0,tick)||typeof r.outcome!=='string'||!id(r.outcome)||typeof r.freshness!=='string'||!id(r.freshness)||!(r.difference===null||finite(r.difference,0,1))||!Array.isArray(r.reasons)||r.reasons.some(reason=>!AUTOMATIC_CAPTURE_REASONS.includes(reason)))throw new Error('Invalid capture outcome');
  }
  if(a.lastSuppression!==null&&(!exact(a.lastSuppression,['tick','reason','cause'])||!integer(a.lastSuppression.tick,0,tick)||!AUTOMATIC_CAPTURE_REASONS.includes(a.lastSuppression.reason)||!['logical_cooldown','logical_backoff','world_time_quota'].includes(a.lastSuppression.cause)))throw new Error('Invalid suppression state');
  return structuredClone(a);
}
