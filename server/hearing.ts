import { acousticBarriers, type PhysicalBox, type Vector3Tuple } from '../shared/physical-scene.js';
import { eyePose } from '../shared/eye-pose.js';
import type { WorldState } from '../shared/protocol.js';
import { deriveHearingEstimates, type AttentionConfig, type ReceivedSound } from '../shared/attention-protocol.js';
import { rayBoxDistance } from './vision/grounding.js';

export interface AcousticSource {x:number;y:number;z:number;intensity:number;suddenness:number;sourceId:string}
export interface AcousticPropagation {received:ReceivedSound;distance:number;transmission:number;barriers:string[];barrierGroups:string[];listener:Vector3Tuple;source:AcousticSource}
const inside=(point:Vector3Tuple,b:PhysicalBox)=>{
  const dx=point[0]-b.position[0],dz=point[2]-b.position[2],x=dx*Math.cos(b.yaw)-dz*Math.sin(b.yaw),z=dx*Math.sin(b.yaw)+dz*Math.cos(b.yaw);
  return Math.abs(x)<=b.size[0]/2+1e-4&&Math.abs(point[1]-b.position[1])<=b.size[1]/2+1e-4&&Math.abs(z)<=b.size[2]/2+1e-4;
};
/** Finite straight-ray approximation, normalized game strength and room-distance units.
 * A barrier containing the emission point radiates out of that surface without self-loss. */
export function propagateSound(source:AcousticSource,snapshot:WorldState,observationId:string,config:AttentionConfig,historical=false):AcousticPropagation {
  if(![source.x,source.y,source.z].every(v=>Number.isFinite(v)&&Math.abs(v)<=20)||![source.intensity,source.suddenness].every(v=>Number.isFinite(v)&&v>=0&&v<=1)||!source.sourceId||!/^[A-Za-z0-9_-]{1,100}$/.test(source.sourceId))throw new Error('Invalid or unknown acoustic source');
  const listener=eyePose(snapshot).position,origin:Vector3Tuple=[source.x,source.y,source.z];
  const delta=listener.map((v,i)=>v-origin[i]) as Vector3Tuple,distance=Math.hypot(...delta);
  const direction=delta.map(v=>distance>1e-6?v/distance:0) as Vector3Tuple;
  const barriers:string[]=[],groups=new Set<string>();let transmission=1;
  const surfaces=acousticBarriers(snapshot),emittingGroups=new Set(surfaces.filter(({box})=>inside(origin,box)).map(({group})=>group));
  if(distance>1e-6)for(const {box,material,group} of surfaces) {
    if(emittingGroups.has(group))continue;
    if(rayBoxDistance(origin,direction,box,distance-1e-4)!==null){barriers.push(box.id);if(!groups.has(group)){groups.add(group);transmission*=material==='wall'?config.wallTransmission:material==='door'?config.doorTransmission:config.objectTransmission;}}
  }
  const intensity=Math.max(0,Math.min(1,source.intensity/(1+config.distanceFalloff*distance*distance)*transmission));
  const headYaw=snapshot.head?.yaw??0,bodyHeading=snapshot.character.heading;
  const horizontal=Math.hypot(source.x-listener[0],source.z-listener[2]);
  const relative=Math.atan2(Math.sin(Math.atan2(source.x-listener[0],source.z-listener[2])-bodyHeading-headYaw),Math.cos(Math.atan2(source.x-listener[0],source.z-listener[2])-bodyHeading-headYaw));
  const audible=intensity>=config.hearingFloor;
  const bearingDegrees=audible&&horizontal>.05?Math.max(-180,Math.min(180,Math.round(relative*180/Math.PI/15)*15)):null;
  // The v1 formula exists only to reproduce explicitly historical artifacts.
  const estimates:Pick<ReceivedSound,'directionUncertaintyDegrees'|'distanceBand'|'distanceUncertainty'>=historical?{directionUncertaintyDegrees:bearingDegrees===null?180:Math.min(90,15+distance*2+groups.size*15+(1-intensity)*15),distanceBand:!audible?'unknown':distance<2?'near':distance<6?'middle':'far',distanceUncertainty:Math.min(1,.25+groups.size*.2+(1-intensity)*.35)}:deriveHearingEstimates({intensity,bearingDegrees},config.hearingFloor);
  return {source:structuredClone(source),listener,distance,transmission,barriers,barrierGroups:[...groups],received:{observationId,tick:snapshot.tick,intensity,suddenness:source.suddenness*(.85+.15*transmission),bearingDegrees,...estimates,bodyHeading,headYaw,provenance:'SIMULATED_HEARING'}};
}
