import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { experienceHistoryAdmitted, type CheckpointV5, type CheckpointV6 } from '../simulation.js';
import type { BranchRuntime } from '../branch-runtime.js';
import { hashCanonical } from '../canonical.js';
import type { CaptureManager } from '../vision/capture-manager.js';
import { currentCognitionProfile, validateCognitionContext, type CognitionContext, type CognitionIdentity, type CognitionSelection } from '../../shared/cognition-protocol.js';

export interface ImmutableCognitionObservation {
  selection:CognitionSelection;
  png:Uint8Array;
  contextHash:string;
  evidence:Omit<ReturnType<CaptureManager['observation']>,'png'>;
}
/** Legacy geometry-aided prose remains on disk, but never becomes future provider context. */
export function providerExperiences(cp:CheckpointV5|CheckpointV6,identity:CognitionIdentity):CognitionContext['experiences'] {if(identity.historyId!==cp.cognition.identity.historyId)return [];return cp.realExperiences.filter(e=>cp.cognition.requests.some(r=>r.request.requestId===e.requestId&&r.request.purpose==='interpretation'&&currentCognitionProfile(r.request))&&e.identity.worldId===identity.worldId&&experienceHistoryAdmitted(cp,e.identity.historyId,e.encodedTick)&&e.provenance==='ATTENDED_RENDERER_INTERPRETATION'&&e.source==='actual_renderer'&&(identity.mode==='EXPERIMENT'||e.identity.mode==='LIVE')).slice(-8).map(e=>({interpretation:e.interpretation,uncertainty:e.uncertainty}));}
/** This allowlist is the only world-to-provider assembly path. Private pose and
 * correlation timing remain in selection, separately from the provider DTO. */
export function assembleCognitionObservation(runtime:BranchRuntime,manager:CaptureManager,captureId:string,identity:CognitionIdentity,maxImageBytes:number,maxContextBytes:number):ImmutableCognitionObservation {
  const retained=manager.observation(runtime.target,captureId),{metadata,observation}=retained;
  const cp=runtime.simulation.checkpoint();
  if(cp.schemaVersion!==5&&cp.schemaVersion!==6)throw new Error('Cognition schema unavailable');
  const capture=cp.attention.lastCapture;
  if(!capture||capture.captureId!==captureId||capture.outcome!=='success'||capture.freshness!=='applicable'||cp.attention.baseline?.captureId!==captureId||metadata.automatic?.intentId!==capture.intentId)throw new Error('Selected capture has no applicable automatic attention association');
  const png=retained.png;
  if(metadata.width!==512||metadata.height!==512||png.length>maxImageBytes||png.length<33||Buffer.from(png.subarray(0,8)).toString('hex')!=='89504e470d0a1a0a'||Buffer.from(png.subarray(12,16)).toString('ascii')!=='IHDR'||Buffer.from(png).readUInt32BE(16)!==512||Buffer.from(png).readUInt32BE(20)!==512)throw new Error('Selected capture is not a bounded 512 PNG');
  const decoded=PNG.sync.read(Buffer.from(png),{checkCRC:true});
  if(decoded.width!==512||decoded.height!==512||createHash('sha256').update(png).digest('hex')!==metadata.frameHash||observation.frameHash!==metadata.frameHash)throw new Error('Selected PNG hash or dimensions mismatch');
  const received=cp.attention.lastReceived,decision=cp.attention.lastDecision;
  const relatedSound=!!received&&!!decision&&decision.observationId===received.observationId&&decision.outcome!=='ignored'&&decision.tick<=metadata.tick&&received.tick<=metadata.tick&&capture.reasons.some(r=>r==='salient_sound'||r==='head_milestone');
  const context:CognitionContext={
    observationId:observation.observationId,frameHash:observation.frameHash,
    shapes:observation.shapes.slice(0,32).map(shape=>({handle:shape.handle,bearingDegrees:shape.bearingDegrees,elevationDegrees:shape.elevationDegrees,distanceBand:shape.distanceBand,sampleVisibilityBand:shape.sampleVisibilityBand,uncertainty:shape.uncertainty,qualityFlags:[...shape.qualityFlags]})),
    sound:relatedSound?{observationId:received.observationId,intensity:received.intensity,suddenness:received.suddenness,bearingDegrees:received.bearingDegrees,directionUncertaintyDegrees:received.directionUncertaintyDegrees,distanceBand:received.distanceBand,distanceUncertainty:received.distanceUncertainty,provenance:received.provenance,relation:received.tick===metadata.tick?'same_capture':'before_image',ageBand:metadata.tick-received.tick<=90?'recent':'earlier'}:null,
    activity:{status:cp.activity.status},
    experiences:providerExperiences(cp,identity),
    ...(cp.schemaVersion===6&&cp.body.active&&'providerInternalSensations' in runtime.simulation?{internalSensations:runtime.simulation.providerInternalSensations()}:{}),
  };
  validateCognitionContext(context);
  if(Buffer.byteLength(JSON.stringify(context))>maxContextBytes)throw new Error('Selected context exceeds bound');
  const camera=metadata.camera;
  return {selection:{identity:structuredClone(identity),captureId,observationId:observation.observationId,frameHash:observation.frameHash,intentId:capture.intentId,capturedTick:metadata.tick,attentionTick:capture.receivedTick,pose:{x:camera.position[0],y:camera.position[1],z:camera.position[2],bodyHeading:camera.bodyHeading,headYaw:camera.headYaw,headPitch:camera.headPitch},source:retained.sensorSource==='actual_renderer'?'actual_renderer':'test_fixture',context},png,contextHash:hashCanonical(context),evidence:{metadata,observation,sensorSource:retained.sensorSource}};
}
