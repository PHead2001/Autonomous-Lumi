import type {ActiveTarget} from '../shared/lab-protocol';

export type VisitInteraction={action:'door';door:'home'|'shop';good:null}|{action:'purchase';door:null;good:'fruit'|'bread'};
export interface VisitLook {yaw:number;pitch:number}
const wrap=(v:number)=>Math.atan2(Math.sin(v),Math.cos(v));
/** Browser intentions only: no coordinates, inventory claims, credentials or actor identity. */
export class VisitControls {
  private target:ActiveTarget|null=null;
  private generation=0;
  private sequence=0;
  private actionId=0;
  private keys=new Set<string>();
  private look:VisitLook={yaw:0,pitch:0};
  get active(){return this.target!==null;}
  get cameraLook():VisitLook{return {...this.look};}
  begin(target:ActiveTarget,generation:number,lastSequence:number,lastActionId:number,look:VisitLook){
    if(!Number.isSafeInteger(generation)||generation<1||![lastSequence,lastActionId].every(v=>Number.isSafeInteger(v)&&v>=0)||![look.yaw,look.pitch].every(Number.isFinite))throw new Error('Invalid Visit control grant.');
    this.target={...target};this.generation=generation;this.sequence=lastSequence;this.actionId=lastActionId;this.keys.clear();this.look={yaw:wrap(look.yaw),pitch:Math.max(-.9,Math.min(.9,look.pitch))};
  }
  matches(target:ActiveTarget,generation?:number){return !!this.target&&this.target.worldId===target.worldId&&this.target.branchId===target.branchId&&this.target.runId===target.runId&&(generation===undefined||generation===this.generation);}
  key(code:string,down:boolean){if(!this.active||!['KeyW','KeyA','KeyS','KeyD'].includes(code))return false;if(down)this.keys.add(code);else this.keys.delete(code);return true;}
  turn(dx:number,dy:number){if(!this.active||!Number.isFinite(dx)||!Number.isFinite(dy))return;this.look.yaw=wrap(this.look.yaw-dx*.004);this.look.pitch=Math.max(-.9,Math.min(.9,this.look.pitch-dy*.004));}
  movement(){
    if(!this.target)return null;
    let forward=Number(this.keys.has('KeyW'))-Number(this.keys.has('KeyS')),strafe=Number(this.keys.has('KeyD'))-Number(this.keys.has('KeyA'));
    const length=Math.hypot(forward,strafe);if(length>1){forward/=length;strafe/=length;}
    return {type:'control' as const,...this.target,generation:this.generation,sequence:++this.sequence,forward,strafe,...this.look};
  }
  private action(authoritativeLastActionId:number){if(!this.target)return null;this.actionId=Math.max(this.actionId,authoritativeLastActionId);return {...this.target,generation:this.generation,sequence:++this.sequence,actionId:++this.actionId};}
  interaction(action:VisitInteraction,authoritativeLastActionId=0){const envelope=this.action(authoritativeLastActionId);return envelope?{type:'interact' as const,...envelope,...action}:null;}
  offer(itemId:number,authoritativeLastActionId:number){const envelope=this.action(authoritativeLastActionId);return envelope?{type:'offer' as const,...envelope,itemId}:null;}
  cancelOffer(offerId:number,authoritativeLastActionId:number){const envelope=this.action(authoritativeLastActionId);return envelope?{type:'cancel_offer' as const,...envelope,offerId}:null;}
  badge(display:boolean,authoritativeLastActionId:number){const envelope=this.action(authoritativeLastActionId);return envelope?{type:'badge' as const,...envelope,display}:null;}
  deposit(itemId:number,authoritativeLastActionId:number){const envelope=this.action(authoritativeLastActionId);return envelope?{type:'deposit' as const,...envelope,itemId}:null;}
  clear(){this.keys.clear();return this.movement();}
  end(){const stopped=this.clear();this.target=null;return stopped;}
}
