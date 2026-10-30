import {CREATOR_FOUNDATION,VISIT_RULES,type VisitState,type VisitWorldView,type VisitFeedback} from '../shared/visit-protocol.js';
import type {TownState} from '../shared/town-protocol.js';
export function createVisitState(tick:number):VisitState{return {schemaVersion:1,rulesVersion:VISIT_RULES,installedTick:tick,foundation:structuredClone(CREATOR_FOUNDATION),actor:null,balance:20,lastActionId:0,feedback:null,control:{generation:0,lastSequence:0,status:'parked',runId:null,expiresTick:tick,forward:0,strafe:0,targetYaw:0,targetPitch:0},timeline:[],droppedCount:0};}
export function visitFeedback(s:VisitState,event:VisitFeedback):void{s.feedback={...event};s.timeline.push({...event});if(s.timeline.length>32){s.timeline.shift();s.droppedCount++;}}
export function visitPublicView(s:VisitState,town:TownState):VisitWorldView {
 const inventory=town.items.filter(i=>i.owner==='owner'&&i.consumedTick===null).map(i=>({id:i.id,kind:i.kind})),a=s.actor;
 return {actor:a?{id:a.id,appearance:a.appearance,x:a.x,z:a.z,heading:a.heading,pitch:a.pitch,moving:a.moving,gait:a.gait,heldItemId:a.heldItemId,heldItem:inventory.find(i=>i.id===a.heldItemId)?.kind??null}:null,control:{generation:s.control.generation,lastSequence:s.control.lastSequence,status:s.control.status,expiresTick:s.control.expiresTick},inventory,balance:s.balance,lastActionId:s.lastActionId,feedback:s.feedback?{...s.feedback}:null,foundation:structuredClone(s.foundation),timeline:structuredClone(s.timeline),droppedCount:s.droppedCount};
}
