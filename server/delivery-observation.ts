import {createHash} from 'node:crypto';
import type {ActiveTarget} from '../shared/lab-protocol.js';
import type {CaptureMetadata,VisualObservation} from '../shared/capture-protocol.js';
import type {WorldState} from '../shared/protocol.js';
import {validateDeliveryCommand,type DeliveryObservationCommand} from '../shared/delivery-protocol.js';
import {DELIVERY_CUE,DELIVERY_CONTENT_CUE} from '../shared/delivery-geometry.js';
import {physicalSceneSnapshot} from '../shared/physical-scene.js';
import {eyePose} from '../shared/eye-pose.js';
import {recognizeSocialCues} from './vision/social-perception.js';
import {canonicalStringify} from './canonical.js';
export interface DeliveryObservationProof {readonly authority:'actual-delivery-capture-proof'}
const minted=new WeakMap<DeliveryObservationProof,{command:DeliveryObservationCommand;scope:ActiveTarget}>();
/** The full authored pattern is recognized in RGB before association to a
 * pixel-qualified opaque handle in this immutable captured scene. */
export function recognizeCapturedDelivery(input:{snapshot:WorldState;metadata:CaptureMetadata;observation:VisualObservation;png:Uint8Array;sensorSource:'actual_renderer'|'test_fixture';handles:ReadonlyMap<string,string>;attentionTick:number}):{command:DeliveryObservationCommand;proof:DeliveryObservationProof}|null {
 const {snapshot,metadata:m,observation:o}=input,s=snapshot.delivery;
 if(!s||!s.occupied||m.status!=='success'||!m.frameHash||m.worldId!==snapshot.worldId||m.runId!==snapshot.runId||m.tick!==snapshot.tick||o.frameHash!==m.frameHash||createHash('sha256').update(input.png).digest('hex')!==m.frameHash)return null;
 const recognized=recognizeSocialCues(input.png);if(!recognized.length)return null;const pose=eyePose(snapshot,m.width,m.height),right=[pose.direction[1]*pose.up[2]-pose.direction[2]*pose.up[1],pose.direction[2]*pose.up[0]-pose.direction[0]*pose.up[2],pose.direction[0]*pose.up[1]-pose.direction[1]*pose.up[0]],dot=(u:number[],v:number[])=>u.reduce((n,x,i)=>n+x*v[i],0),boxes=physicalSceneSnapshot(snapshot).boxes;
 const match=(id:string,kind:string):string|null=>{const handle=[...input.handles].find(([,key])=>key===id)?.[0];if(!handle||!o.shapes.some(shape=>shape.handle===handle&&shape.uncertainty==='geometry_candidates_pixel_checked'&&shape.sampleVisibilityBand!=='low'))return null;const b=boxes.find(b=>b.id===id);if(!b)return null;const d=b.position.map((v,i)=>v-pose.position[i]),depth=dot(d,pose.direction);if(depth<=0)return null;const x=m.width/2+dot(d,right)/depth*m.width/(2*Math.tan(pose.horizontalFovDegrees*Math.PI/360)),y=m.height/2-dot(d,pose.up)/depth*m.height/(2*Math.tan(pose.verticalFovDegrees*Math.PI/360));return recognized.some(r=>r.kind===kind&&x>=r.minX-3&&x<=r.maxX+3&&y>=r.minY-3&&y<=r.maxY+3)?handle:null;};
 const good=s.open?s.items.find(r=>r.status==='stored')?.good:null,content=good?(match(DELIVERY_CONTENT_CUE+'-left',good)??match(DELIVERY_CONTENT_CUE+'-right',good)):null,occupied=match(DELIVERY_CUE,'verified_seal');if(!content&&!occupied)return null;
 const command=validateDeliveryCommand({type:'delivery_observation',captureId:m.captureId,frameHash:m.frameHash,capturedTick:m.tick,attentionTick:input.attentionTick,sensorSource:input.sensorSource,revision:s.revision,handle:content??occupied,kind:content?good:'occupied'}) as DeliveryObservationCommand,proof:DeliveryObservationProof=Object.freeze({authority:'actual-delivery-capture-proof'});minted.set(proof,{command:structuredClone(command),scope:{worldId:m.worldId,branchId:m.branchId,runId:m.runId}});return {command,proof};
}
export function validateDeliveryObservationProof(command:DeliveryObservationCommand,proof:unknown,target:ActiveTarget):void {const record=proof&&typeof proof==='object'?minted.get(proof as DeliveryObservationProof):undefined;if(!record||canonicalStringify(record.scope)!==canonicalStringify(target)||canonicalStringify(record.command)!==canonicalStringify(validateDeliveryCommand(command)))throw new Error('Untrusted delivery RGB observation proof');}
