import { createHash } from 'node:crypto';
import type { ActiveTarget } from '../shared/lab-protocol.js';
import type { CaptureMetadata,VisualObservation } from '../shared/capture-protocol.js';
import type { WorldState } from '../shared/protocol.js';
import { validateTownCommand,type TownObservationCommand } from '../shared/town-protocol.js';
import { physicalSceneSnapshot } from '../shared/physical-scene.js';
import { TOWN_GEOMETRY } from '../shared/town-geometry.js';
import { eyePose } from '../shared/eye-pose.js';
import { recognizeTownCues } from './vision/town-perception.js';
import { canonicalStringify } from './canonical.js';
export interface TownObservationProof {readonly authority:'actual-town-capture-proof'}
const minted=new WeakMap<TownObservationProof,{command:TownObservationCommand;scope:ActiveTarget}>();
/** Full actual RGB pattern + captured pixel-qualified handle. Private scene tags only associate already recognized evidence. */
export function recognizeCapturedTown(input:{snapshot:WorldState;metadata:CaptureMetadata;observation:VisualObservation;png:Uint8Array;sensorSource:'actual_renderer'|'test_fixture';handles:ReadonlyMap<string,string>;attentionTick:number}):{command:TownObservationCommand;proof:TownObservationProof}|null {
 const {snapshot,metadata:m,observation:o}=input;if(!snapshot.town||m.status!=='success'||!m.frameHash||o.frameHash!==m.frameHash||m.tick!==snapshot.tick||createHash('sha256').update(input.png).digest('hex')!==m.frameHash)return null;
 const recognized=recognizeTownCues(input.png);if(!recognized.length)return null;
 const pose=eyePose(snapshot,m.width,m.height),right:[number,number,number]=[pose.direction[1]*pose.up[2]-pose.direction[2]*pose.up[1],pose.direction[2]*pose.up[0]-pose.direction[0]*pose.up[2],pose.direction[0]*pose.up[1]-pose.direction[1]*pose.up[0]],dot=(a:number[],b:number[])=>a.reduce((n,v,i)=>n+v*b[i],0),boxes=physicalSceneSnapshot(snapshot).boxes,observations:TownObservationCommand['observations']=[];
 for(const cue of [{id:'town-exit-cue',kind:'exit' as const,anchor:TOWN_GEOMETRY.exit},{id:'town-shop-cue',kind:'shop' as const,anchor:TOWN_GEOMETRY.checkout}]){
  const handle=[...input.handles].find(([,id])=>id===cue.id)?.[0];if(!handle||!o.shapes.some(s=>s.handle===handle&&s.uncertainty==='geometry_candidates_pixel_checked'))continue;
  const box=boxes.find(b=>b.id===cue.id);if(!box)continue;const delta=box.position.map((v,i)=>v-pose.position[i]),depth=dot(delta,pose.direction);if(depth<=0)continue;
  const x=m.width/2+dot(delta,right)/depth*m.width/(2*Math.tan(pose.horizontalFovDegrees*Math.PI/360)),y=m.height/2-dot(delta,pose.up)/depth*m.height/(2*Math.tan(pose.verticalFovDegrees*Math.PI/360));
  const found=recognized.find(r=>(cue.kind==='exit'?r.kind==='exit':r.kind==='shopOpen'||r.kind==='shopClosed')&&x>=r.minX-3&&x<=r.maxX+3&&y>=r.minY-3&&y<=r.maxY+3);if(found)observations.push({handle,resourceId:cue.id,kind:cue.kind,observedAnchor:{...cue.anchor},open:cue.kind==='exit'?null:found.kind==='shopOpen',recognition:'authored-town-rgb-v1'});
 }
 if(!observations.length)return null;const command=validateTownCommand({type:'town_observation',captureId:m.captureId,frameHash:m.frameHash,capturedTick:m.tick,attentionTick:input.attentionTick,sensorSource:input.sensorSource,observations}) as TownObservationCommand,proof:TownObservationProof=Object.freeze({authority:'actual-town-capture-proof'});minted.set(proof,{command:structuredClone(command),scope:{worldId:m.worldId,branchId:m.branchId,runId:m.runId}});return {command,proof};
}
export function validateTownObservationProof(command:TownObservationCommand,proof:unknown,target:ActiveTarget):void {const record=proof&&typeof proof==='object'?minted.get(proof as TownObservationProof):undefined;if(!record||canonicalStringify(record.scope)!==canonicalStringify(target)||canonicalStringify(record.command)!==canonicalStringify(validateTownCommand(command)))throw new Error('Untrusted town RGB observation proof');}
