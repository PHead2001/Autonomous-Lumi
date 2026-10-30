import type {ActiveTarget} from '../shared/lab-protocol';
import type {WorldState} from '../shared/protocol';
import type {VisitWorldView} from '../shared/visit-protocol';

type Actor=NonNullable<VisitWorldView['actor']>;
export type VisitGrantState={status:'waiting';message:string}|{status:'rejected';message:string}|{status:'active';actor:Actor;lastSequence:number;lastActionId:number};
/** A host channel reservation is not an applied simulation start. */
export class VisitGrant {
  private channel=false;
  private sawActive=false;
  constructor(readonly target:ActiveTarget,readonly generation:number,private requestedTick:number){}
  bind(generation:number){if(generation!==this.generation)throw new Error('Control grant changed. Re-enter Visit.');this.channel=true;}
  inspect(world:WorldState):VisitGrantState {
    if(world.worldId!==this.target.worldId||world.branchId!==this.target.branchId||world.runId!==this.target.runId)return {status:'rejected',message:'The selected world changed. Re-enter Visit for its current run.'};
    const v=world.visit;
    if(!v)return {status:'rejected',message:'Visit is unavailable in this world.'};
    if(v.control.generation>this.generation)return {status:'rejected',message:'Another control generation replaced this request. Re-enter Visit.'};
    if(v.actor&&v.control.generation===this.generation&&v.control.status==='active'){
      if(!this.channel)return {status:'waiting',message:'The avatar is ready; waiting for its authenticated control channel.'};
      this.sawActive=true;return {status:'active',actor:v.actor,lastSequence:v.control.lastSequence,lastActionId:v.lastActionId};
    }
    if(this.sawActive||v.control.generation===this.generation&&v.control.status==='parked')return {status:'rejected',message:'Visit control stopped. Re-enter to resume the same avatar.'};
    if(v.feedback?.type==='control'&&v.feedback.outcome==='rejected'&&v.feedback.reason==='entrance_blocked'&&v.feedback.tick>this.requestedTick)return {status:'rejected',message:'The entrance is blocked. No entry was confirmed. Retry after the entrance is clear.'};
    return {status:'waiting',message:this.channel?'Control channel reserved; waiting for the server to apply entry. A paused experiment must advance before entry can be confirmed.':'Entering Visit; waiting for the authenticated control channel.'};
  }
  timeout(world:WorldState):VisitGrantState {
    const current=this.inspect(world);if(current.status!=='waiting')return current;
    if(!this.channel)return {status:'rejected',message:'The control channel was not confirmed. Re-enter Visit to retry.'};
    return {status:'rejected',message:world.mode==='EXPERIMENT'&&world.tick<=this.requestedTick?'Entry is still unconfirmed; this experiment has not advanced and may be paused. Resume it in Advanced, then retry. Any cancelled queued entry may appear parked.':'Entry was not confirmed in time. Retry after checking the entrance. Any cancelled queued entry may appear parked.'};
  }
}
