import type { HomeWorldView } from '../shared/home-protocol';
import type { WorldState } from '../shared/protocol';

const stageLabels:Record<string,string> = {route:'Getting food',reach:'Reaching for food',holding:'Holding food',eat:'Eating',enter:'Getting into bed',rest:'Resting',sleep:'Sleeping',wake:'Waking',exit:'Getting up',done:'Activity finished'};
/** Read only the public projection; this is an owner-facing summary, never an episode encoder. */
export function homePresentation(home:HomeWorldView|undefined,capability:WorldState['capability'],moving:boolean) {
  if(capability?.reason==='asleep')return {title:'Sleeping',detail:home?.posture.kind==='reclined'?'Resting in bed.':'Asleep where she stopped; no move into bed is implied.'};
  if(capability?.reason==='incapacitated')return {title:'Resting with serious weakness',detail:'Physical limits have stopped voluntary movement.'};
  if(!home)return {title:moving?'Lumi is wandering':'Lumi is awake and still',detail:'No home-action history is available for this world.'};
  if(home.availability!=='ready')return {title:'Home layout unavailable',detail:'No safe home layout is active. Advanced diagnostics can explain why.'};
  const a=home.activity;
  if(a.status==='selected')return {title:a.kind==='eat'?'Planning to get food':'Planning to rest',detail:'An intention has been selected. No completed action is being reported.'};
  if((a.status==='failed'||a.status==='interrupted')&&home.posture.kind!=='upright')return {title:a.status==='failed'?'Bed transition blocked':'Bed transition paused',detail:'Holding the last safe pose. No walking or completed bed exit is being reported.'};
  if(a.status==='interrupted')return {title:'Activity interrupted',detail:'The current activity has paused. Completion has not been reported.'};
  if(a.status==='failed')return {title:a.stage==='route'?'Path blocked':'Activity could not finish',detail:a.label||'The server reported a failed attempt.'};
  if(a.status==='completed')return {title:a.kind==='eat'?'Finished eating':'Finished resting',detail:'The server confirmed this activity completed.'};
  if(a.status==='started')return {title:a.stage==='route'&&a.kind==='rest'?'Walking to bed':stageLabels[a.stage??'']??a.label,detail:`In progress${a.progress>0&&['reach','holding','eat','enter','rest','wake','exit'].includes(a.stage??'')?` · ${Math.round(Math.min(1,Math.max(0,a.progress))*100)}% of this stage`:''}. Completion is reported separately.`};
  return {title:a.kind==='search'?'Looking around':moving?'Lumi is wandering':'Lumi is awake and still',detail:home.activationPolicy==='owner-disabled'?'Home care is inactive by explicit owner setting.':home.heldItem?'Holding a serving; it has not been reported consumed.':'The local home controller is available.'};
}
export function recentHomeTimeline(home:HomeWorldView|undefined,currentTick:number,secondsPerTick:number,limit=8) {
  const entries=(home?.timeline??[]).slice(-Math.min(12,Math.max(1,limit))).reverse().map(entry=>{
    const age=Math.max(0,Math.floor((currentTick-entry.tick)*secondsPerTick));
    return {label:entry.label,type:entry.type,age:age<2?'Just now':age<60?`${age}s ago`:age<3600?`${Math.floor(age/60)}m ago`:`${Math.floor(age/3600)}h ago`};
  });
  const retained=home?.timeline.length??0,dropped=home?.droppedCount??0;
  const note=!home?'History unavailable':!retained?'No home actions recorded yet':`Showing ${entries.length} of ${retained} retained events${dropped?` · ${dropped} earlier events no longer retained`:''}`;
  return {entries,note};
}

/** Activation reasons are public policy; an inactive home is not automatically a staged rollout. */
export function physiologyStatus(active:boolean|undefined,home:Pick<HomeWorldView,'activationPolicy'|'availability'>|undefined,capability:WorldState['capability']) {
 if(active)return capability?.reason==='available'?'Active - awake':`Active - ${capability?.reason??'capability unavailable'}`;
 if(home?.activationPolicy==='owner-disabled')return 'Inactive - owner disabled';
 if(home?.availability==='layout-unavailable')return 'Inactive - no safe home layout';
 if(home)return 'Inactive - home engine';
 return active===false?'Inactive - legacy staged world':'Unavailable - no body state';
}
