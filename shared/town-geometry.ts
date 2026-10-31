import type { WorldState } from './protocol.js';

import type { PhysicalBox, Vector3Tuple } from './physical-scene.js';

import { physicalSceneSnapshot,segmentEntersRectangle,doorAngle } from './physical-scene.js';

import { CHARACTER_CLEARANCE_RADIUS } from './avatar-rig.js';

import { HOME_CUE_COLORS } from './home-geometry.js';

export const TOWN_GEOMETRY={exit:{x:2.97,z:-2.65},checkout:{x:2.97,z:-10.8},homeReturn:{x:.2,z:.2},shopDoor:{x:2.97,z:-9.3},bounds:{minX:-4.1,maxX:5.5,minZ:-14.7,maxZ:3.1}} as const;

export const TOWN_CUES={exit:['red','blue','green','white'],shopOpen:['green','red','blue','white'],shopClosed:['green','blue','red','white']} as const;

/** A visual authored cue is interpreted before its private captured association is used. */

export function townFixtureBoxes(world:WorldState):PhysicalBox[]{

 const t=world.town;if(!t)return [];const boxes:PhysicalBox[]=[];

 const box=(id:string,size:Vector3Tuple,position:Vector3Tuple,color:string,options:Partial<PhysicalBox>={})=>boxes.push({id,size,position,yaw:0,color,collides:true,occludes:true,observable:false,cutaway:false,...options});

 box('town-path',[2.7,.14,6.6],[2.97,-.1,-6.2],'#b7b9b7',{collides:false});

 box('town-grass-left',[9,.1,8],[-3,-.2,-7.7],'#889b73',{collides:false});

 box('town-grass-right',[5,.1,8],[7,-.2,-7.7],'#889b73',{collides:false});

 box('town-store-floor',[6.3,.22,6.1],[2.97,-.15,-12.2],'#b9bab4',{collides:false});

 box('wall-town-store-back',[6.3,3.65,.16],[2.97,1.7,-15.2],'#c3c8c5');

 box('wall-town-store-left',[.16,3.65,6],[-.18,1.7,-12.25],'#b4beb8');

 box('wall-town-store-right',[.16,3.65,6],[6.12,1.7,-12.25],'#b4beb8',{cutaway:true});

 box('wall-town-store-front-left',[2.15,3.65,.16],[.895,1.7,-9.3],'#c3c8c5',{cutaway:true});

 box('wall-town-store-front-right',[2.15,3.65,.16],[5.045,1.7,-9.3],'#c3c8c5',{cutaway:true});

 box('wall-town-store-lintel',[1.84,.3,.16],[2.97,3.6,-9.3],'#c3c8c5');

 // The open leaf rotates away from the clear doorway. Closing is validated against both actors.

 const yaw=t.doors.shopAngle,hinge:[number,number,number]=[2.05,0,-9.3];

 box('town-shop-door',[1.84,2.8,.12],[hinge[0]+.92*Math.cos(yaw),1.4,hinge[2]-.92*Math.sin(yaw)],'#4d786f',{yaw,observable:true});

 box('town-counter',[1.1,1.2,.75],[4.65,.6,-11.15],'#c79c74');

 box('town-shelf',[1,1.8,1.8],[.65,.9,-13.2],'#927659');

 if(t.shop.fruitVisible)box('town-stock-fruit',[.35,.25,.35],[.65,1.9,-12.8],'#d8683f',{collides:false,observable:true});

 if(t.shop.breadVisible)box('town-stock-bread',[.45,.2,.3],[.65,1.9,-13.6],'#e3ba73',{collides:false,observable:true});

 const cue=(id:string,p:Vector3Tuple,colors:readonly (keyof typeof HOME_CUE_COLORS)[],scale=1)=>{box(id,[.82*scale,.82*scale,.05],p,HOME_CUE_COLORS.border,{collides:false,observable:true});for(let i=0;i<4;i++)box(id+'-tile-'+i,[.32*scale,.32*scale,.025],[p[0]+(i%2?1:-1)*.18*scale,p[1]+(i<2?1:-1)*.18*scale,p[2]+.04],HOME_CUE_COLORS[colors[i]],{collides:false});};

 // This inside-facing sign grants a visible EXIT exploration target only, not a hidden map.

 cue('town-exit-cue',[2.97,2.9,-3.37],TOWN_CUES.exit,.8);

 // Wall-mounted storefront cue can be read through the open home doorway. It
 // conveys currently open/closed, not stock/hours. Keep its entire panel on the
 // solid front-right wall so neither the panel nor a post occupies the doorway.

 cue('town-shop-cue',[5.045,2.4,-9.12],t.shop.open&&t.shop.available?TOWN_CUES.shopOpen:TOWN_CUES.shopClosed,1.3);

 if(t.heldItem){const c=world.character,x=c.x+.42*Math.cos(c.heading)+.38*Math.sin(c.heading),z=c.z-.42*Math.sin(c.heading)+.38*Math.cos(c.heading);box('town-lumi-held-item',[.27,.25,.27],[x,1.28,z],t.heldItem==='fruit'?'#d8683f':'#e3ba73',{collides:false,observable:true});}

 return boxes;

}

const floors=[{minX:-4.52,maxX:4.52,minZ:-3.52,maxZ:3.52},{minX:1.75,maxX:4.19,minZ:-10.3,maxZ:-2.4},{minX:-.1,maxX:6.04,minZ:-15.12,maxZ:-9.22}];

export function townWalkablePoint(x:number,z:number,radius=CHARACTER_CLEARANCE_RADIUS):boolean{return Number.isFinite(x)&&Number.isFinite(z)&&floors.some(f=>x>=f.minX+radius&&x<=f.maxX-radius&&z>=f.minZ+radius&&z<=f.maxZ-radius);}

const local=(p:{x:number;z:number},b:PhysicalBox):[number,number]=>{const dx=p.x-b.position[0],dz=p.z-b.position[2];return [dx*Math.cos(b.yaw)-dz*Math.sin(b.yaw),dx*Math.sin(b.yaw)+dz*Math.cos(b.yaw)];};

/** The first negative rebound reaches approximately -.1173 radians. These
 * bounds include the complete damped motion, including migrated negative slams. */
export const TOWN_SLAM_RANGE={min:-.12,max:.5} as const;
function sweptDoorBoxes(world:WorldState,door:'home'|'shop',from:number,to:number):PhysicalBox[]{
 const intervals=Math.max(1,Math.ceil(Math.abs(to-from)/.04)),boxes:PhysicalBox[]=[];
 // Leaf tips travel at most 1.85 * .02 < .0371 between a sample and its
 // interval midpoint. .04 inflation covers the continuous unsampled rotation.
 const hinge=door==='home'?{x:2.05,z:-3.53}:{x:2.05,z:-9.3};
 // The panel and knob protrude beyond the leaf. Derive every moving part from
 // the shared closed assembly rather than reserving only a thin leaf proxy.
 const closed:WorldState={...world,town:{...world.town!,doors:{...world.town!.doors,home:false,homeAngle:0,slam:null}}};
 const parts=door==='home'?physicalSceneSnapshot(closed).boxes.filter(b=>['door-leaf','door-panel','door-knob'].includes(b.id)):[{id:'town-shop-door',size:[1.84,2.8,.12] as Vector3Tuple,position:[2.97,1.4,-9.3] as Vector3Tuple}];
 for(let i=0;i<=intervals;i++){const yaw=from+(to-from)*i/intervals;for(const part of parts){const dx=part.position[0]-hinge.x,dz=part.position[2]-hinge.z;boxes.push({id:'navigation-town-door-sweep-'+i+'-'+part.id,size:[part.size[0]+.08,part.size[1],part.size[2]+.08],position:[hinge.x+dx*Math.cos(yaw)+dz*Math.sin(yaw),part.position[1],hinge.z-dx*Math.sin(yaw)+dz*Math.cos(yaw)],yaw,color:'#000000',collides:true,occludes:false,observable:false,cutaway:false});}}return boxes;
}
/** Navigation-only reserve: it never enters RGB/masks, acoustic occlusion or
 * novelty. Keep future leaf positions unavailable until the motion finishes. */
function townCharacterCollisionBoxes(world:WorldState):PhysicalBox[]{const boxes=physicalSceneSnapshot(world).boxes,slam=world.town?.doors.slam;if(slam&&world.time>=slam.startTime&&world.time-slam.startTime<.4){const from=slam.sign===1?TOWN_SLAM_RANGE.min:-TOWN_SLAM_RANGE.max,to=slam.sign===1?TOWN_SLAM_RANGE.max:-TOWN_SLAM_RANGE.min;boxes.push(...sweptDoorBoxes(world,'home',from,to));}return boxes;}

export function canOccupyTownCharacter(world:WorldState,x:number,z:number,radius=CHARACTER_CLEARANCE_RADIUS):boolean {if(!world.town||!townWalkablePoint(x,z,radius))return false;return !townCharacterCollisionBoxes(world).some(b=>{if(!b.collides||b.position[1]+b.size[1]/2<=.06||b.position[1]-b.size[1]/2>=3.45)return false;const [a,c]=local({x,z},b);return Math.abs(a)<b.size[0]/2+radius&&Math.abs(c)<b.size[2]/2+radius;});}

/** Exact swept solid test plus bounded surface coverage; no endpoint tunnelling. */

export function canSweepTownCharacter(world:WorldState,fromX:number,fromZ:number,x:number,z:number,radius=CHARACTER_CLEARANCE_RADIUS):boolean {

 if(!canOccupyTownCharacter(world,fromX,fromZ,radius)||!canOccupyTownCharacter(world,x,z,radius))return false;

 // Surfaces are a finite union of convex rectangles. All boundary crossing intervals must be covered.

 const cuts=[0,1],dx=x-fromX,dz=z-fromZ;for(const f of floors)for(const [a,d,lo,hi] of [[fromX,dx,f.minX+radius,f.maxX-radius],[fromZ,dz,f.minZ+radius,f.maxZ-radius]])if(Math.abs(d)>1e-14)for(const edge of [lo,hi]){const t=(edge-a)/d;if(t>0&&t<1)cuts.push(t);}cuts.sort((a,b)=>a-b);for(let i=1;i<cuts.length;i++){const t=(cuts[i-1]+cuts[i])/2;if(!townWalkablePoint(fromX+dx*t,fromZ+dz*t,radius))return false;}

 for(const b of townCharacterCollisionBoxes(world)){if(!b.collides||b.position[1]+b.size[1]/2<=.06||b.position[1]-b.size[1]/2>=3.45)continue;const [ax,az]=local({x:fromX,z:fromZ},b),[bx,bz]=local({x,z},b);if(segmentEntersRectangle(ax,az,bx,bz,b.size[0]/2+radius,b.size[2]/2+radius))return false;}return true;

}

/** A close cannot sweep through an actor; a closed shop never locks its exit. */

export function townDoorTarget(world:WorldState,door:'home'|'shop',open:boolean):number {const current=door==='home'?world.town?.doors.homeAngle:world.town?.doors.shopAngle;return open?(current&&current<0?-Math.PI/2:Math.PI/2):0;}
export function canChangeTownDoor(world:WorldState,door:'home'|'shop',open:boolean):boolean {const from=door==='home'?doorAngle(world):world.town?.doors.shopAngle??0;return canSweepTownDoor(world,door,from,townDoorTarget(world,door,open));}
export function canSweepTownDoor(world:WorldState,door:'home'|'shop',from:number,to:number):boolean {
 if(!world.town)return false;
 for(const b of sweptDoorBoxes(world,door,from,to)){const [x,z]=local(world.character,b);if(Math.abs(x)<b.size[0]/2+CHARACTER_CLEARANCE_RADIUS&&Math.abs(z)<b.size[2]/2+CHARACTER_CLEARANCE_RADIUS)return false;}return true;
}
