import { checkpointBytes, MAX_CHECKPOINT_BYTES, namedCheckpointPayload, recoveryCheckpointPayload } from './checkpoint-storage.js';
import type { CheckpointV5, CheckpointV6, CheckpointV7, CheckpointV8, CheckpointV9, CheckpointV10, SyntheticExperience } from './simulation.js';

/** Per pending request: 32 KiB for its largest normalized terminal record plus
 * real experience, and 32 KiB for delivery through the ordered input queue.
 * This includes JSON-escaped 1200-code-unit text, 16 evidence handles, maximum
 * identity fields and bounded metrics. Maximum-shape regressions verify it. */
export const COGNITION_TERMINAL_BYTES = 32 * 1024;
export const COGNITION_PENDING_BYTES = 2 * COGNITION_TERMINAL_BYTES;
/** Fixed-size motor (8 scan points), sensory (8 exposures, 2 intentions with
 * 12 triggers each, 48-channel baseline), scalar counters and scope migration.
 * Growing activity/synthetic arrays and input payloads are measured separately. */
export const COGNITION_MOTOR_SENSOR_BYTES = 64 * 1024;
/** Maximum-shape town serialized growth is measured against the actual envelope in town-integration.test.ts. */
export const TOWN_FUTURE_BYTES = 128 * 1024;
/** Public avatar, bounded control/result history and reserved stop slot. */
export const VISIT_FUTURE_BYTES = 64 * 1024;
const MAX_ID = 'x'.repeat(64); // Runtime/registry/recovery identifiers: validId max64.

/** Same builders and JSON indentation as actual storage. Runtime controls and
 * wrapper metadata use maximal widths allowed by their validators/writers. */
export function cognitionEnvelopeBytes(simulation:CheckpointV5|CheckpointV6|CheckpointV7|CheckpointV8|CheckpointV9|CheckpointV10):number {
  const runtime={schemaVersion:simulation.schemaVersion===10?9:simulation.schemaVersion===9?8:simulation.schemaVersion===8?7:simulation.schemaVersion===7?6:simulation.schemaVersion===6?5:4,kind:'lumi-branch-runtime',mode:'EXPERIMENT',simulation,
    control:{paused:false,speed:1.1234567890123457,fastForwardRemaining:100000,nextOperationSequence:Number.MAX_SAFE_INTEGER,loggingMode:'verbose',compressClosed:false},
    scheduler:{config:{hz:120,maxStepsPerPump:1000,maxBacklogSteps:10000,suspendThresholdMs:Number.MAX_VALUE},backlogMs:1.2345678901234567e-100}};
  return Math.max(checkpointBytes(recoveryCheckpointPayload(runtime,MAX_ID,Number.MAX_SAFE_INTEGER)),checkpointBytes(namedCheckpointPayload(runtime,{worldId:MAX_ID,branchId:MAX_ID,historyId:MAX_ID,mode:'EXPERIMENT',createdAt:'+275760-09-13T00:00:00.000Z'})));
}
const MAX_MILESTONES=Array.from({length:10000},(_,index)=>(index+1)*10);
const MAX_SYNTHETIC:SyntheticExperience[]=Array.from({length:256},(_,index)=>({id:index+1,tick:Number.MAX_SAFE_INTEGER,kind:'clock',provenance:'TEST STUB',observedSeconds:1.2345678901234567e-100,uncertaintySeconds:1.2345678901234567e-100}));

/** Required durable bytes, including future work already admitted. No records
 * are trimmed to make this fit. Replaying the same normalized inputs makes the
 * same capacity decision without the runtime, filesystem, provider or renderer. */
export function cognitionStorageBytes(checkpoint:CheckpointV5|CheckpointV6|CheckpointV7|CheckpointV8|CheckpointV9|CheckpointV10):number {
  const future:CheckpointV5|CheckpointV6|CheckpointV7|CheckpointV8|CheckpointV9|CheckpointV10={...checkpoint,activity:{...checkpoint.activity,status:'complete',cursor:100000,totalTicks:100000,appliedMilestones:MAX_MILESTONES,completionCount:1,activityId:Number.MAX_SAFE_INTEGER},
    // A LIVE history may fork into EXPERIMENT, where these slots become legal.
    experiences:MAX_SYNTHETIC,nextExperienceId:257};
  const pending=new Set(checkpoint.cognition.requests.filter(request=>request.status==='pending').map(request=>request.request.requestId));
  for(const input of checkpoint.pendingInputs)if(input.command.type==='cognition_request')pending.add(input.command.requestId);
  const delivered=new Set<string>();
  const withoutDelivery=future.pendingInputs.filter(input=>{
    if(input.command.type==='cognition_result'&&pending.has(input.command.requestId)){delivered.add(input.command.requestId);return false;}
    return true;
  });
  const bytes=cognitionEnvelopeBytes(future);
  // The reserved delivery allowance is replaced by its actual serialized bytes
  // once that result is queued. Do not double-count the same pending reply.
  const deliveryBytes=delivered.size?bytes-cognitionEnvelopeBytes({...future,pendingInputs:withoutDelivery}):0;
  const pendingBytes=pending.size*COGNITION_PENDING_BYTES-Math.min(delivered.size*COGNITION_TERMINAL_BYTES,deliveryBytes);
  // Maximum-shape actual-envelope regression measures 338421 bytes. Reserve 384 KiB
  // for all bounded physiology growth, including 128 maximum internal episodes,
  // their encoding keys, incapacity intervals, 32 pending absorption effects and 8 verified import edges.
  // Actual existing records remain measured in the envelope, never trimmed.
  // Home maximum-shape serialized growth: 48679 bytes; 64 KiB covers every bounded route/knowledge/timeline slot.
  const homeGrowth=checkpoint.schemaVersion===8||(checkpoint.schemaVersion===9||checkpoint.schemaVersion===10)?64*1024:0;
  const physiologyGrowth=(checkpoint.schemaVersion===6||checkpoint.schemaVersion===7||checkpoint.schemaVersion===8||(checkpoint.schemaVersion===9||checkpoint.schemaVersion===10))?(checkpoint.body.active?384*1024:8*1024):0;
  // Town owns bounded item/transaction/knowledge and route slots separately from home.
  const townGrowth=(checkpoint.schemaVersion===9||checkpoint.schemaVersion===10)?TOWN_FUTURE_BYTES:0;
  return bytes+COGNITION_MOTOR_SENSOR_BYTES+pendingBytes+physiologyGrowth+homeGrowth+townGrowth+(checkpoint.schemaVersion===10?VISIT_FUTURE_BYTES:0);
}
export const fitsCognitionStorage=(checkpoint:CheckpointV5|CheckpointV6|CheckpointV7|CheckpointV8|CheckpointV9|CheckpointV10):boolean=>cognitionStorageBytes(checkpoint)<=MAX_CHECKPOINT_BYTES;
