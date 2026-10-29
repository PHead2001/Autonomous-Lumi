import { readRun, type Category, type Severity } from './recorder.js';
import { cleanRecord } from './bundle.js';

export interface TimelineFilters {
  category?: Category; component?: string; severity?: Severity; causalId?: string;eventType?:string;
  fromTick?: number; toTick?: number; search?: string; limit?: number;
}
export interface TimelineOptions extends TimelineFilters { runDirectory:string;worldId:string;branchId:string;runId:string }
export function validateTimelineFilters(filters:TimelineFilters):void{
  if(filters.category!==undefined&&!['WORLD_TRUTH','FOX_EXPERIENCE','PRIVATE_SENSOR','OPERATIONAL_REPLAY'].includes(filters.category))throw new Error('Invalid category filter');
  if(filters.severity!==undefined&&!['debug','info','warn','error'].includes(filters.severity))throw new Error('Invalid severity filter');
  for(const v of [filters.fromTick,filters.toTick])if(v!==undefined&&(!Number.isSafeInteger(v)||v<0))throw new Error('Invalid timeline tick filter');
  if(filters.fromTick!==undefined&&filters.toTick!==undefined&&filters.toTick<filters.fromTick)throw new Error('Invalid timeline range');
  for(const v of [filters.component,filters.causalId,filters.search,filters.eventType])if(v!==undefined&&(typeof v!=='string'||v.length>160))throw new Error('Invalid timeline text filter');
  if(filters.limit!==undefined&&(!Number.isInteger(filters.limit)||filters.limit<1||filters.limit>500))throw new Error('Invalid timeline limit');
}
export async function queryTimeline(options:TimelineOptions){
  for(const id of [options.worldId,options.branchId,options.runId])if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new Error('Invalid timeline target');
  const run=await readRun(options.runDirectory);
  // Scope is checked before even interpreting secondary filters; no fallback or sibling search.
  if(run.metadata.worldId!==options.worldId||run.metadata.branchId!==options.branchId||run.metadata.runId!==options.runId)throw new Error('Timeline target does not match recorded namespace');
  validateTimelineFilters(options);
  const source=run.records.map(cleanRecord);
  if(source.some(r=>r.world_id!==options.worldId||r.branch_id!==options.branchId||r.run_id!==options.runId))throw new Error('Timeline contains a foreign namespace');
  const matched=source.filter(r=>(options.category===undefined||r.category===options.category)&&(options.component===undefined||r.component===options.component)&&(options.eventType===undefined||r.event_type===options.eventType)&&(options.severity===undefined||r.severity===options.severity)&&(options.causalId===undefined||r.causal_event_id===options.causalId||r.event_id===options.causalId||(r.deterministic_event_sequence!==undefined&&`simulation:${r.deterministic_event_sequence}`===options.causalId))&&(options.fromTick===undefined||r.world_tick>=options.fromTick)&&(options.toTick===undefined||r.world_tick<=options.toTick)&&(options.search===undefined||JSON.stringify(r).toLowerCase().includes(options.search.toLowerCase())));
  const limit=options.limit??200;
  return {scope:{worldId:options.worldId,branchId:options.branchId,runId:options.runId},records:matched.slice(-limit),health:run.metadata.health,
    coverage:{totalRecords:source.length,matchedRecords:matched.length,returnedRecords:Math.min(matched.length,limit),truncated:matched.length>limit,readGaps:run.readGaps}};
}
