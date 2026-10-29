/** Right-handed room coordinates: +Y up, local +Z forward. Yaw positive turns toward +X;
 * pitch positive looks up. Angles are radians, FOV is explicitly degrees. */
export const HEAD_LIMITS = { minYaw: -75*Math.PI/180, maxYaw: 75*Math.PI/180, minPitch: -40*Math.PI/180, maxPitch: 45*Math.PI/180, radiansPerSecond: Math.PI/2 } as const;
export interface EyeCamera { horizontalFovDegrees: number; width: number; height: number; near: number; far: number }
export interface HeadState {
  yaw: number; pitch: number; targetYaw: number; targetPitch: number;
  status: 'idle'|'turning'|'scanning';
  scan: { points: {yaw:number;pitch:number}[]; cursor:number }|null;
  camera: EyeCamera; nextActionId:number; activeActionId:number|null;
}
/** Private normalized replay evidence. The public head API accepts opaque handles only. */
export interface TargetEvidence { observationId:string; frameHash:string; capturedTick:number; captureWidth:number; captureHeight:number; handle:string; engineTargetId:string }
export type HeadAction =
  | { type:'turn_head'; yawDelta:number; pitchDelta:number; sceneRevision:number }
  | { type:'look_at'; yaw:number; pitch:number; sceneRevision:number; evidence?:TargetEvidence }
  | { type:'scan_area'; minYaw:number; maxYaw:number; pitch:number; passes:number; sceneRevision:number }
  | { type:'cancel_head'; sceneRevision:number };
export function defaultHeadState():HeadState {return {yaw:0,pitch:0,targetYaw:0,targetPitch:0,status:'idle',scan:null,camera:{horizontalFovDegrees:80,width:512,height:512,near:.05,far:40},nextActionId:1,activeActionId:null};}
const exact=(v:unknown,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',');
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const integer=(v:unknown,min:number,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const yaw=(v:unknown)=>finite(v,HEAD_LIMITS.minYaw,HEAD_LIMITS.maxYaw);
const pitch=(v:unknown)=>finite(v,HEAD_LIMITS.minPitch,HEAD_LIMITS.maxPitch);
export function validateHeadAction(value:unknown):HeadAction {
  const a=value as HeadAction;
  if(!a||!integer(a.sceneRevision,0))throw new Error('Invalid head action scene revision');
  if(a.type==='cancel_head'&&exact(a,['type','sceneRevision']))return structuredClone(a);
  if(a.type==='turn_head'&&exact(a,['type','yawDelta','pitchDelta','sceneRevision'])&&finite(a.yawDelta,HEAD_LIMITS.minYaw-HEAD_LIMITS.maxYaw,HEAD_LIMITS.maxYaw-HEAD_LIMITS.minYaw)&&finite(a.pitchDelta,HEAD_LIMITS.minPitch-HEAD_LIMITS.maxPitch,HEAD_LIMITS.maxPitch-HEAD_LIMITS.minPitch))return structuredClone(a);
  if(a.type==='look_at'&&exact(a,a.evidence===undefined?['type','yaw','pitch','sceneRevision']:['type','yaw','pitch','sceneRevision','evidence'])&&yaw(a.yaw)&&pitch(a.pitch)) {
    const e=a.evidence;
    if(e!==undefined&&(!exact(e,['observationId','frameHash','capturedTick','captureWidth','captureHeight','handle','engineTargetId'])||![e.observationId,e.handle,e.engineTargetId].every(v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v))||typeof e.frameHash!=='string'||!/^[a-f0-9]{64}$/.test(e.frameHash)||!integer(e.capturedTick,0)||!integer(e.captureWidth,128,1024)||!integer(e.captureHeight,128,1024)))throw new Error('Invalid observation evidence');
    return structuredClone(a);
  }
  if(a.type==='scan_area'&&exact(a,['type','minYaw','maxYaw','pitch','passes','sceneRevision'])&&yaw(a.minYaw)&&yaw(a.maxYaw)&&a.minYaw<a.maxYaw&&pitch(a.pitch)&&integer(a.passes,1,4))return structuredClone(a);
  throw new Error('Invalid head action fields or angle bounds');
}
export function validateHeadState(value:unknown):HeadState {
  const h=value as HeadState;
  if(!exact(h,['yaw','pitch','targetYaw','targetPitch','status','scan','camera','nextActionId','activeActionId'])||!yaw(h.yaw)||!yaw(h.targetYaw)||!pitch(h.pitch)||!pitch(h.targetPitch)||!['idle','turning','scanning'].includes(h.status)||!integer(h.nextActionId,1)||!(h.activeActionId===null||integer(h.activeActionId,1,h.nextActionId-1)))throw new Error('Invalid head state');
  const c=h.camera;
  if(!exact(c,['horizontalFovDegrees','width','height','near','far'])||!finite(c.horizontalFovDegrees,30,120)||!integer(c.width,128,1024)||!integer(c.height,128,1024)||!finite(c.near,.01,1)||!finite(c.far,5,100)||c.near>=c.far)throw new Error('Invalid eye camera');
  if(h.status==='scanning') {
    const s=h.scan;
    if(!exact(s,['points','cursor'])||!s||!Array.isArray(s.points)||s.points.length<2||s.points.length>8||!integer(s.cursor,0,s.points.length-1)||s.points.some(p=>!exact(p,['yaw','pitch'])||!yaw(p.yaw)||!pitch(p.pitch))||h.activeActionId===null||h.targetYaw!==s.points[s.cursor].yaw||h.targetPitch!==s.points[s.cursor].pitch)throw new Error('Invalid head scan cursor');
  }else if(h.scan!==null)throw new Error('Non-scanning head retains a scan');
  if(h.status==='idle'&&(h.activeActionId!==null||h.yaw!==h.targetYaw||h.pitch!==h.targetPitch)||h.status!=='idle'&&h.activeActionId===null)throw new Error('Inconsistent head action state');
  return structuredClone(h);
}
