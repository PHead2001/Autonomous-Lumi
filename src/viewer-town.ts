import type { WorldState } from '../shared/protocol';
import type { HomeWorldView } from '../shared/home-protocol';
import type { TownWorldView } from '../shared/town-protocol';
import { homePresentation, recentHomeTimeline } from './viewer-home';
import type {VisitWorldView,VisitFeedback} from '../shared/visit-protocol';
import type {SocialWorldView} from '../shared/social-protocol';

/** An owner-facing projection of confirmed activity, never a source of cognition. */
export function worldActivity(state: Pick<WorldState,'home'|'town'|'capability'|'character'|'social'>) {
  const home=homePresentation(state.home,state.capability,state.character.moving),town=state.town;
  if(state.capability?.reason==='asleep'||state.capability?.reason==='incapacitated')return home;
  if(state.social?.giftUse&&state.social.giftUse.progressTicks>0&&state.social.giftUse.completedTick===null)return {title:'Eating accepted food',detail:'Consumption is in progress as a separate validated action. Completion has not been reported.'};
  if(!town)return home;
  const a=town.activity,homeBusy=state.home&&['eat','rest'].includes(state.home.activity.kind)&&['selected','started','interrupted'].includes(state.home.activity.status);
  if(a.status==='idle'||homeBusy)return home;
  const latestHome=state.home?.timeline.at(-1)?.tick??-1,latestTown=town.timeline.at(-1)?.tick??-1;
  if(['completed','failed'].includes(a.status)&&latestHome>latestTown)return home;
  if(a.status==='selected')return {title:'Considering a shop trip',detail:'A destination has been selected. No purchase or return is being reported yet.'};
  if(a.status==='interrupted')return {title:'Shop trip interrupted',detail:'The trip has paused. Its purchase and return remain separate outcomes.'};
  if(a.status==='failed')return {title:a.label||'Shop trip could not finish',detail:'The server reported an unsuccessful attempt. Home food and rest remain available.'};
  if(a.status==='completed')return {title:'Finished shop trip',detail:'The server confirmed the trip completed. Its individual outcomes appear below.'};
  const labels:Record<NonNullable<TownWorldView['activity']['stage']>,string>={explore:'Looking outside',observe:'Looking for a readable shop cue',outbound:'Walking to the shop',purchase:'At the shop checkout',return:'Returning home',consume:'Eating purchased food',done:'Finishing shop trip'};
  return {title:a.stage?labels[a.stage]:a.label||'Shop trip in progress',detail:`In progress. Completion is reported separately.${town.heldItem?` Carrying ${town.heldItem}; it has not been reported consumed.`:''}`};
}

function ownerActivityLabel(feedback:VisitFeedback):string {
  if(feedback.type==='control'){
    if(feedback.outcome==='stopped')return 'Owner movement stopped';
    if(feedback.outcome==='rejected')return feedback.reason==='movement_blocked'?'Owner movement blocked':'Owner Visit control rejected';
    return feedback.reason==='control_acquired'?'Owner Visit control started':'Owner Visit control confirmed';
  }
  if(feedback.type==='purchase')return feedback.outcome==='accepted'?'Owner purchase confirmed':'Owner purchase not completed';
  return feedback.outcome==='accepted'?'Owner used a door':'Owner door interaction not completed';
}

/** Merge bounded public histories, retaining their independent gap counts. */
export function recentWorldTimeline(home:HomeWorldView|undefined,town:TownWorldView|undefined,currentTick:number,secondsPerTick:number,limit=8,visit?:VisitWorldView,social?:SocialWorldView) {
  if(!town&&!visit&&!social)return recentHomeTimeline(home,currentTick,secondsPerTick,limit);
  const ownerEvents=(visit?.timeline??[]).map((f,i)=>({tick:f.tick,sequence:i,type:f.outcome,label:ownerActivityLabel(f),source:2}));
  const events=[...(home?.timeline??[]).map(e=>({...e,source:0})),...(town?.timeline??[]).map(e=>({...e,source:1})),...ownerEvents,...(social?.timeline??[]).map(e=>({...e,source:3}))];
  events.sort((a,b)=>b.tick-a.tick||b.source-a.source||b.sequence-a.sequence);
  const entries=events.slice(0,Math.min(12,Math.max(1,limit))).map(e=>{
    const age=Math.max(0,Math.floor((currentTick-e.tick)*secondsPerTick));
    return {label:e.label,type:e.type,age:age<2?'Just now':age<60?`${age}s ago`:age<3600?`${Math.floor(age/60)}m ago`:`${Math.floor(age/3600)}h ago`};
  });
  const gaps=[home?.droppedCount?`${home.droppedCount} earlier home events`:null,town?.droppedCount?`${town.droppedCount} earlier neighborhood events`:null,visit?.droppedCount?`${visit.droppedCount} earlier owner events`:null,social?.droppedCount?`${social.droppedCount} earlier offer/introduction events`:null].filter(Boolean);
  return {entries,note:events.length?`Showing ${entries.length} of ${events.length} retained events${gaps.length?` · ${gaps.join(' and ')} no longer retained`:''}`:'No home or neighborhood actions recorded yet'};
}
