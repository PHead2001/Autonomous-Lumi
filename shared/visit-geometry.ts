import type {WorldState} from './protocol.js';
import type {PhysicalBox,Vector3Tuple} from './physical-scene.js';
import {canOccupyTownCharacter,canSweepTownCharacter} from './town-geometry.js';
import {homePoseTransform} from './home-geometry.js';
import {VISIT_LIMITS,VISITOR_PHYSICAL_PREFIX,VISITOR_HELD_PHYSICAL_ID} from './visit-protocol.js';
import {CHARACTER_CLEARANCE_RADIUS} from './avatar-rig.js';

/** Original neutral humanoid geometry shared by ordinary rendering, real eyes,
 * private instance masks and collision. No authenticated role is depicted. */
export function visitActorBoxes(world:WorldState):PhysicalBox[]{const a=world.visit?.actor;if(!a)return [];const boxes:PhysicalBox[]=[],cs=Math.cos(a.heading),sn=Math.sin(a.heading),stride=a.moving?Math.sin(a.gait)*.11:0;
 const box=(name:string,size:Vector3Tuple,local:Vector3Tuple,color:string,collides=true)=>boxes.push({id:VISITOR_PHYSICAL_PREFIX+name,size,position:[a.x+local[0]*cs+local[2]*sn,local[1],a.z-local[0]*sn+local[2]*cs],yaw:a.heading,color,collides,occludes:true,observable:true,cutaway:false});
 box('torso',[.55,.75,.34],[0,1.2,0],'#426b84');box('hips',[.48,.25,.32],[0,.75,0],'#394658');box('head',[.4,.43,.38],[0,1.86,.025],'#d9b394');box('hair',[.43,.14,.4],[0,2.08,.015],'#584b40');
 box('left-arm',[.17,.65,.2],[-.36,1.2,0],'#426b84');box('right-arm',[.17,.65,.2],[.36,1.2,a.heldItemId===null?0:.14],'#426b84');box('left-hand',[.16,.18,.17],[-.36,.8,0],'#d9b394');box('right-hand',[.16,.18,.17],[.36,.8,a.heldItemId===null?0:.27],'#d9b394');
 box('left-leg',[.2,.6,.22],[-.15,.34,stride],'#394658');box('right-leg',[.2,.6,.22],[.15,.34,-stride],'#394658');box('left-shoe',[.22,.14,.33],[-.15,.07,.04+stride],'#303238');box('right-shoe',[.22,.14,.33],[.15,.07,.04-stride],'#303238');
 box('left-eye',[.045,.045,.02],[-.085,1.9,.224],'#292b30',false);box('right-eye',[.045,.045,.02],[.085,1.9,.224],'#292b30',false);
 const offering=world.social?.offer?.status==='pending'&&world.social.offer.itemId===a.heldItemId;
 if(offering){const hand=boxes.find(b=>b.id===VISITOR_PHYSICAL_PREFIX+'right-hand')!;hand.position=[a.x+.14*cs+.43*sn,1.24,a.z-.14*sn+.43*cs];}
 if(a.heldItem){box('held-hand',[.16,.18,.17],[.32,1.1,.3],'#d9b394',false);boxes.push({id:VISITOR_HELD_PHYSICAL_ID,size:[.27,.24,.27],position:[a.x+.32*cs+.36*sn,1.21,a.z-.32*sn+.36*cs],yaw:a.heading,color:a.heldItem==='fruit'?'#d8683f':'#e3ba73',collides:false,occludes:true,observable:true,cutaway:false});}
 if(offering){const item=boxes.find(b=>b.id===VISITOR_HELD_PHYSICAL_ID);if(item)item.position=[a.x+.14*cs+.44*sn,1.27,a.z-.14*sn+.44*cs];}
 return boxes;
}
function withoutVisitor(world:WorldState):WorldState{return {...world,visit:world.visit?{...world.visit,actor:null}:undefined};}
/** The visitor cannot cross Lumi's actual shared posture; this private motor
 * envelope supplies collision, never a perceived identity or new sensor fact. */
export const LUMI_VISIT_LOCAL_CENTRES=[[0,.3,0],[0,1,0],[0,1.7,0],[0,2.34,.015]] as const;
/** One reciprocal motor envelope. Upright movement uses the same established
 * fox clearance radius from either actor's point of view. Reclined/transition
 * occupancy follows the shared posture along the body, rather than the old root. */
export function lumiVisitEnvelope(world:WorldState):{x:number;z:number;radius:number}[]{if(!world.home||world.home.posture.kind==='upright')return [{x:world.character.x,z:world.character.z,radius:CHARACTER_CLEARANCE_RADIUS}];const pose=homePoseTransform(world);return LUMI_VISIT_LOCAL_CENTRES.map(p=>{const point=pose.transformPoint(p);return {x:point[0],z:point[2],radius:CHARACTER_CLEARANCE_RADIUS};});}
export const pointSegmentDistanceSquared=(x:number,z:number,ax:number,az:number,bx:number,bz:number)=>{const dx=bx-ax,dz=bz-az,n=dx*dx+dz*dz,t=n?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/n)):0;return (x-ax-dx*t)**2+(z-az-dz*t)**2;};
export function canPlaceLumiAgainstVisitor(world:WorldState,x=world.character.x,z=world.character.z):boolean {const a=world.visit?.actor;if(!a)return true;const candidate={...world,character:{...world.character,x,z}};return lumiVisitEnvelope(candidate).every(s=>Math.hypot(a.x-s.x,a.z-s.z)>=VISIT_LIMITS.radius+s.radius);}
export function canSweepLumiAgainstVisitor(world:WorldState,fromX:number,fromZ:number,x:number,z:number):boolean {const a=world.visit?.actor;return !a||pointSegmentDistanceSquared(a.x,a.z,fromX,fromZ,x,z)>=(VISIT_LIMITS.radius+CHARACTER_CLEARANCE_RADIUS)**2;}
export function canOccupyVisitActor(world:WorldState,x:number,z:number):boolean {return canOccupyTownCharacter(withoutVisitor(world),x,z,VISIT_LIMITS.radius)&&lumiVisitEnvelope(world).every(s=>Math.hypot(x-s.x,z-s.z)>=VISIT_LIMITS.radius+s.radius);}
export function canSweepVisitActor(world:WorldState,fromX:number,fromZ:number,x:number,z:number):boolean {return canSweepTownCharacter(withoutVisitor(world),fromX,fromZ,x,z,VISIT_LIMITS.radius)&&lumiVisitEnvelope(world).every(s=>pointSegmentDistanceSquared(s.x,s.z,fromX,fromZ,x,z)>=(VISIT_LIMITS.radius+s.radius)**2);}
/** A single explicit entrance; alternate nearby points handle an occupied path
 * without moving an existing actor or inventing a departure/re-entry. */
export function visitEntrance(world:WorldState):{x:number;z:number}|null {for(const z of [-6.5,-7.2,-5.8])for(const x of [2.97,3.5,2.45])if(canOccupyVisitActor(world,x,z))return {x,z};return null;}
