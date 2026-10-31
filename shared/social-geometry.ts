import type {WorldState} from './protocol.js';
import {physicalSceneSnapshot,segmentEntersRectangle,type PhysicalBox,type Vector3Tuple} from './physical-scene.js';
import {HOME_CUE_COLORS} from './home-geometry.js';
import {SOCIAL_LIMITS} from './social-protocol.js';
export const SOCIAL_OFFER_CUE='social-offer-cue',SOCIAL_BADGE_CUE='social-badge-cue';
/** Distinct publicly rendered patterns, never identical pixels with a private role bit. */
export const SOCIAL_CUES={fruit:['red','green','blue','white'],bread:['blue','red','green','white'],verified_seal:['blue','green','red','white'],unverified_claim:['green','blue','red','white']} as const;
export function socialCueBoxes(world:WorldState):PhysicalBox[]{const a=world.visit?.actor,s=world.social;if(!a||!s)return [];const boxes:PhysicalBox[]=[],cs=Math.cos(a.heading),sn=Math.sin(a.heading);
 const box=(id:string,size:Vector3Tuple,p:Vector3Tuple,color:string,observable=false)=>boxes.push({id,size,position:[a.x+p[0]*cs+p[2]*sn,p[1],a.z-p[0]*sn+p[2]*cs],yaw:a.heading,color,collides:false,occludes:true,observable,cutaway:false});
 const cue=(id:string,p:Vector3Tuple,colors:readonly (keyof typeof HOME_CUE_COLORS)[],scale:number)=>{box(id,[.82*scale,.82*scale,.04],p,HOME_CUE_COLORS.border,true);for(let i=0;i<4;i++)box(id+'-tile-'+i,[.32*scale,.32*scale,.025],[p[0]+(i%2?1:-1)*.18*scale,p[1]+(i<2?1:-1)*.18*scale,p[2]+.035],HOME_CUE_COLORS[colors[i]]);};
 // A real offering placard beside the held food, rather than behind its front
 // surface. All four tiles remain physically exposed from the frontal view;
 // the placard and item still fit inside the unchanged visitor motor envelope.
 if(s.offer?.status==='pending'&&a.heldItemId===s.offer.itemId)cue(SOCIAL_OFFER_CUE,[-.28,1.37,.44],SOCIAL_CUES[s.offer.good],.52);
 if(s.badge.display)cue(SOCIAL_BADGE_CUE,[-.08,1.79,.24],SOCIAL_CUES[s.badge.kind],.46);
 return boxes;
}
/** Physical reach at the shared hand height, independent of authorization or image recognition. */
export function socialReach(world:WorldState):boolean {const a=world.visit?.actor;if(!a||Math.hypot(a.x-world.character.x,a.z-world.character.z)>SOCIAL_LIMITS.reach)return false;return !physicalSceneSnapshot(world).boxes.some(b=>b.collides&&!b.id.startsWith('visit-')&&b.position[1]-b.size[1]/2<1.35&&b.position[1]+b.size[1]/2>1.35&&(()=>{const cs=Math.cos(b.yaw),sn=Math.sin(b.yaw),ax=a.x-b.position[0],az=a.z-b.position[2],bx=world.character.x-b.position[0],bz=world.character.z-b.position[2];return segmentEntersRectangle(ax*cs-az*sn,ax*sn+az*cs,bx*cs-bz*sn,bx*sn+bz*cs,b.size[0]/2+.035,b.size[2]/2+.035);})());}
