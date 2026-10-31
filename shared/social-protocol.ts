import type {CognitionIdentity} from './cognition-protocol.js';
import type {ShopGood} from './town-protocol.js';
export const LEGACY_SOCIAL_RULES='lumi-social-v1' as const;
export const SOCIAL_RULES='lumi-social-v2' as const;
export type SocialRulesVersion=typeof SOCIAL_RULES|typeof LEGACY_SOCIAL_RULES;
export const SOCIAL_LIMITS={reach:1.8,offerSeconds:20,observationAgeSeconds:2,experiences:32,timeline:32} as const;
export type OfferStatus='pending'|'accepted'|'declined'|'deferred'|'cancelled'|'expired';
export interface SocialOffer {id:number;revision:number;itemId:number;good:ShopGood;generation:number;runId:string;createdTick:number;deadlineTick:number;status:OfferStatus;noticedTick:number|null;response:'accept'|'decline'|'defer'|'ignore'|null;reason:string;transferTick:number|null}
export interface SocialTimeline {sequence:number;tick:number;offerId:number|null;type:'offer'|'noticed'|'response'|'transfer'|'cancelled'|'expired'|'badge'|'encoding'|'consumed';label:string}
export interface SocialExperience {id:number;kind:'social';provenance:'ATTENDED_AUTHORED_SOCIAL_RGB';recognition:'authored-social-rgb-v1';source:'actual_renderer';identity:CognitionIdentity;encodingId:string;captureId:string;frameHash:string;handle:string;capturedTick:number;attentionTick:number;encodedTick:number;perceivedIdentity:'anonymous_visitor'|'creator_claim'|'recognized_creator';interpretation:string;uncertainty:string}
export interface SocialIntentFeedback {actionId:number;kind:'offer'|'cancel'|'badge';outcome:'accepted'|'rejected';reason:string;tick:number}
export interface SocialState {schemaVersion:1;rulesVersion:SocialRulesVersion;installedTick:number;nextOfferId:number;offer:SocialOffer|null;feedback:SocialIntentFeedback|null;badge:{display:boolean;kind:'verified_seal'|'unverified_claim';revision:number};experiences:SocialExperience[];firstRecognizedEncounter:{experienceId:number;encodingId:string}|null;seenEvidence:string[];giftUse:{itemId:number;startedTick:number;progressTicks:number;effectSequence:number|null;completedTick:number|null}|null;timeline:SocialTimeline[];nextTimelineSequence:number;droppedCount:number}
export interface SocialWorldView {offer:SocialOffer|null;feedback:SocialIntentFeedback|null;badge:SocialState['badge'];giftUse:SocialState['giftUse'];timeline:SocialTimeline[];droppedCount:number}
interface Scope {runId:string;generation:number;sequence:number;actionId:number}
export interface SocialOfferCommand extends Scope {type:'social_offer';itemId:number}
export interface SocialCancelCommand extends Scope {type:'social_cancel';offerId:number}
export interface SocialBadgeCommand extends Scope {type:'social_badge';display:boolean}
export interface SocialObservationCommand {type:'social_observation';captureId:string;frameHash:string;capturedTick:number;attentionTick:number;sensorSource:'actual_renderer'|'test_fixture';actor:{x:number;z:number;heading:number};offer:null|{offerId:number;revision:number;itemId:number;good:ShopGood;handle:string};badge:null|{revision:number;kind:'verified_seal'|'unverified_claim';handle:string}}
export type SocialIntentCommand=SocialOfferCommand|SocialCancelCommand|SocialBadgeCommand;
export type SocialCommand=SocialIntentCommand|SocialObservationCommand;
export const socialExact=(v:unknown,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.slice().sort().join(',');
export const socialInteger=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
export const socialId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
export function validateSocialCommand(value:unknown):SocialCommand {const c=value as SocialCommand,exact=socialExact,n=socialInteger,id=socialId;if(!c)throw new Error('Invalid social command');
 if(c.type==='social_observation'){if(!exact(c,['type','captureId','frameHash','capturedTick','attentionTick','sensorSource','actor','offer','badge'])||!id(c.captureId)||typeof c.frameHash!=='string'||! /^[a-f0-9]{64}$/.test(c.frameHash)||!n(c.capturedTick)||!n(c.attentionTick,c.capturedTick)||!['actual_renderer','test_fixture'].includes(c.sensorSource)||!exact(c.actor,['x','z','heading'])||![c.actor.x,c.actor.z,c.actor.heading].every(Number.isFinite)||Math.abs(c.actor.x)>7||c.actor.z< -16||c.actor.z>4||Math.abs(c.actor.heading)>Math.PI||c.offer===null&&c.badge===null)throw new Error('Invalid social observation');
  if(c.offer!==null&&(!exact(c.offer,['offerId','revision','itemId','good','handle'])||!n(c.offer.offerId,1)||!n(c.offer.revision,1)||!n(c.offer.itemId,1)||!['fruit','bread'].includes(c.offer.good)||!id(c.offer.handle)))throw new Error('Invalid social offer evidence');
  if(c.badge!==null&&(!exact(c.badge,['revision','kind','handle'])||!n(c.badge.revision,1)||!['verified_seal','unverified_claim'].includes(c.badge.kind)||!id(c.badge.handle)))throw new Error('Invalid social badge evidence');return structuredClone(c);}
 if(!id(c.runId)||!n(c.generation,1)||!n(c.sequence,1)||!n(c.actionId,1))throw new Error('Invalid social scope');
 if(c.type==='social_offer'&&exact(c,['type','runId','generation','sequence','actionId','itemId'])&&n(c.itemId,1)||c.type==='social_cancel'&&exact(c,['type','runId','generation','sequence','actionId','offerId'])&&n(c.offerId,1)||c.type==='social_badge'&&exact(c,['type','runId','generation','sequence','actionId','display'])&&typeof c.display==='boolean')return structuredClone(c);
 throw new Error('Invalid social command');
}
