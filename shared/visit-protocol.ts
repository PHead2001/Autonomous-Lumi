import type {ShopGood} from './town-protocol.js';
export const VISIT_RULES='lumi-visit-v1' as const;
export const VISITOR_PHYSICAL_PREFIX='visit-owner-';
export const VISITOR_HELD_PHYSICAL_ID='visit-held-item';
export const VISIT_LIMITS={speed:2.4,turnRadiansPerSecond:3,pitchRadiansPerSecond:2,radius:.7,inputLifetimeSeconds:.75,initialFunds:20,footstepDistance:.8,timeline:32} as const;
export const CREATOR_FOUNDATION={version:'creator-origin-v1',creatorExists:true,createdSoftwareAndWorld:true,familiarity:'unestablished'} as const;
export interface VisitActor {id:'owner-avatar-v1';appearance:'visitor-neutral-v1';x:number;z:number;heading:number;pitch:number;moving:boolean;gait:number;heldItemId:number|null;spawnedTick:number;distanceSinceFootstep:number}
export type VisitStopReason='disconnect'|'observe'|'revoked'|'timeout'|'restart';
export interface VisitStartCommand {type:'visit_start';runId:string;generation:number}
export interface VisitControlCommand {type:'visit_control';runId:string;generation:number;sequence:number;forward:number;strafe:number;yaw:number;pitch:number;expiresTick:number}
export interface VisitInteractionCommand {type:'visit_interact';runId:string;generation:number;sequence:number;actionId:number;action:'door'|'purchase';door:'home'|'shop'|null;good:ShopGood|null}
export interface VisitStopCommand {type:'visit_stop';runId:string;generation:number;reason:VisitStopReason}
export type VisitCommand=VisitStartCommand|VisitControlCommand|VisitInteractionCommand|VisitStopCommand;
export interface VisitFeedback {actionId:number;type:'door'|'purchase'|'control';outcome:'accepted'|'rejected'|'stopped';reason:string;tick:number}
export interface VisitState {schemaVersion:1;rulesVersion:typeof VISIT_RULES;installedTick:number;foundation:typeof CREATOR_FOUNDATION;actor:VisitActor|null;balance:number;lastActionId:number;feedback:VisitFeedback|null;control:{generation:number;lastSequence:number;status:'parked'|'active';runId:string|null;expiresTick:number;forward:number;strafe:number;targetYaw:number;targetPitch:number};timeline:VisitFeedback[];droppedCount:number}
export interface VisitWorldView {actor:null|Omit<VisitActor,'spawnedTick'|'distanceSinceFootstep'>&{heldItem:ShopGood|null};control:Pick<VisitState['control'],'generation'|'lastSequence'|'status'|'expiresTick'>;inventory:{id:number;kind:ShopGood}[];balance:number;lastActionId:number;feedback:VisitFeedback|null;foundation:typeof CREATOR_FOUNDATION;timeline:VisitFeedback[];droppedCount:number}
const exact=(v:unknown,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',');
const integer=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
export function validateVisitCommand(value:unknown):VisitCommand {
 const c=value as VisitCommand;if(!c||!id(c.runId)||!integer(c.generation,1))throw new Error('Invalid visit scope');
 if(c.type==='visit_start'&&exact(c,['type','runId','generation']))return structuredClone(c);
 if(c.type==='visit_stop'&&exact(c,['type','runId','generation','reason'])&&['disconnect','observe','revoked','timeout','restart'].includes(c.reason))return structuredClone(c);
 if(c.type==='visit_control'&&exact(c,['type','runId','generation','sequence','forward','strafe','yaw','pitch','expiresTick'])&&integer(c.sequence,1)&&finite(c.forward,-1,1)&&finite(c.strafe,-1,1)&&finite(c.yaw,-Math.PI,Math.PI)&&finite(c.pitch,-.9,.9)&&integer(c.expiresTick))return structuredClone(c);
 if(c.type==='visit_interact'&&exact(c,['type','runId','generation','sequence','actionId','action','door','good'])&&integer(c.sequence,1)&&integer(c.actionId,1)&&(c.action==='door'&&['home','shop'].includes(c.door as string)&&c.good===null||c.action==='purchase'&&c.door===null&&['fruit','bread'].includes(c.good as string)))return structuredClone(c);
 throw new Error('Invalid visit command');
}
function feedback(value:unknown,tick:number,lastActionId:number):value is VisitFeedback{const f=value as VisitFeedback;return exact(f,['actionId','type','outcome','reason','tick'])&&integer(f.actionId,0,lastActionId)&&['door','purchase','control'].includes(f.type)&&['accepted','rejected','stopped'].includes(f.outcome)&&id(f.reason)&&integer(f.tick,0,tick);}
export function validateVisitState(value:unknown,tick:number,hz:number):VisitState {
 const s=value as VisitState;if(!exact(s,['schemaVersion','rulesVersion','installedTick','foundation','actor','balance','lastActionId','feedback','control','timeline','droppedCount'])||s.schemaVersion!==1||s.rulesVersion!==VISIT_RULES||!integer(s.installedTick,0,tick)||(!exact(s.foundation,['version','creatorExists','createdSoftwareAndWorld','familiarity'])||s.foundation.version!=='creator-origin-v1'||s.foundation.creatorExists!==true||s.foundation.createdSoftwareAndWorld!==true||s.foundation.familiarity!=='unestablished')||!integer(s.balance,0,1000000)||!integer(s.lastActionId)||!(s.feedback===null||feedback(s.feedback,tick,s.lastActionId))||!integer(s.droppedCount))throw new Error('Invalid visit state');
 const c=s.control;if(!exact(c,['generation','lastSequence','status','runId','expiresTick','forward','strafe','targetYaw','targetPitch'])||!integer(c.generation)||!integer(c.lastSequence)||!['parked','active'].includes(c.status)||!(c.runId===null||id(c.runId))||!integer(c.expiresTick,0,tick+Math.ceil(VISIT_LIMITS.inputLifetimeSeconds*hz))||!finite(c.forward,-1,1)||!finite(c.strafe,-1,1)||!finite(c.targetYaw,-Math.PI,Math.PI)||!finite(c.targetPitch,-.9,.9)||c.status==='parked'&&(c.forward!==0||c.strafe!==0)||c.status==='active'&&(c.generation===0||c.runId===null||s.actor===null))throw new Error('Invalid visit control');
 if(s.actor!==null){const a=s.actor;if(!exact(a,['id','appearance','x','z','heading','pitch','moving','gait','heldItemId','spawnedTick','distanceSinceFootstep'])||a.id!=='owner-avatar-v1'||a.appearance!=='visitor-neutral-v1'||!finite(a.x,-5,7)||!finite(a.z,-16,4)||!finite(a.heading,-Math.PI,Math.PI)||!finite(a.pitch,-.9,.9)||typeof a.moving!=='boolean'||!finite(a.gait,0,Number.MAX_SAFE_INTEGER)||!(a.heldItemId===null||integer(a.heldItemId,1))||!integer(a.spawnedTick,s.installedTick,tick)||!finite(a.distanceSinceFootstep,0,VISIT_LIMITS.footstepDistance)||c.status==='parked'&&a.moving)throw new Error('Invalid visitor actor');}else if(c.status!=='parked'||s.lastActionId!==0)throw new Error('Invalid absent visitor state');
 if(!Array.isArray(s.timeline)||s.timeline.length>32||s.timeline.some(f=>!feedback(f,tick,s.lastActionId)))throw new Error('Invalid visit timeline');return structuredClone(s);
}
