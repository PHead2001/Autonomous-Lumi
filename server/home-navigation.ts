/** Geometry may execute a chosen known goal; it never discovers a semantic destination. */
export interface NavigationPoint {x:number;z:number}
export interface NavigationGeometry {canOccupy:(point:NavigationPoint)=>boolean;canSweep:(from:NavigationPoint,to:NavigationPoint)=>boolean}
export interface HomeRoutePlan {status:'reachable'|'blocked';points:NavigationPoint[];expanded:number;reason:'route_found'|'invalid_destination'|'no_route'|'planning_bound';distance:number}
export const HOME_NAVIGATION={cell:.25,maxExpansions:768,maxPoints:128,walkX:3.2,walkZ:2.3} as const;
const distance=(a:NavigationPoint,b:NavigationPoint)=>Math.hypot(a.x-b.x,a.z-b.z);
/** Fixed bounded grid, Euclidean A*, stable node-index tie breaks, swept edge validation. */
export function planHomeRoute(start:NavigationPoint,goal:NavigationPoint,geometry:NavigationGeometry,bounds?:{minX:number;maxX:number;minZ:number;maxZ:number;maxExpansions:number}):HomeRoutePlan {
 const failed=(reason:HomeRoutePlan['reason'],expanded=0):HomeRoutePlan=>({status:'blocked',points:[],expanded,reason,distance:0});
 if(![start.x,start.z,goal.x,goal.z].every(Number.isFinite)||!geometry.canOccupy(goal))return failed('invalid_destination');
 if(geometry.canSweep(start,goal))return {status:'reachable',points:[{...goal}],expanded:0,reason:'route_found',distance:distance(start,goal)};
 const {cell,walkX,walkZ,maxPoints}=HOME_NAVIGATION,maxExpansions=bounds?.maxExpansions??HOME_NAVIGATION.maxExpansions,minX=bounds?.minX??-walkX,minZ=bounds?.minZ??-walkZ,maxX=bounds?.maxX??walkX,maxZ=bounds?.maxZ??walkZ,nx=Math.floor((maxX-minX)/cell)+1,nz=Math.floor((maxZ-minZ)/cell)+1;
 const point=(id:number):NavigationPoint=>({x:minX+(id%nx)*cell,z:minZ+Math.floor(id/nx)*cell});
 const valid=new Set<number>();for(let id=0;id<nx*nz;id++)if(geometry.canOccupy(point(id)))valid.add(id);
 const connectors=(p:NavigationPoint)=>[...valid].filter(id=>distance(p,point(id))<=cell*2.1&&geometry.canSweep(p,point(id))).sort((a,b)=>distance(p,point(a))-distance(p,point(b))||a-b).slice(0,8);
 const from=connectors(start),to=new Set(connectors(goal));if(!from.length||!to.size)return failed('no_route');
 const costs=new Map<number,number>(),parents=new Map<number,number>(),open=new Set<number>(),closed=new Set<number>();
 for(const id of from){costs.set(id,distance(start,point(id)));open.add(id);}
 let expanded=0,found:number|undefined;
 while(open.size){if(expanded>=maxExpansions)return failed('planning_bound',expanded);const id=[...open].sort((a,b)=>(costs.get(a)!+distance(point(a),goal))-(costs.get(b)!+distance(point(b),goal))||distance(point(a),goal)-distance(point(b),goal)||a-b)[0];open.delete(id);closed.add(id);expanded++;if(to.has(id)){found=id;break;}
  const ix=id%nx,iz=Math.floor(id/nx);for(const [dx,dz] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]){const x=ix+dx,z=iz+dz;if(x<0||x>=nx||z<0||z>=nz)continue;const next=z*nx+x;if(!valid.has(next)||closed.has(next)||!geometry.canSweep(point(id),point(next)))continue;const cost=costs.get(id)!+distance(point(id),point(next));if(cost<(costs.get(next)??Infinity)){costs.set(next,cost);parents.set(next,id);open.add(next);}}
 }
 if(found===undefined)return failed('no_route',expanded);
 const reversed:NavigationPoint[]=[{...goal}];let node:number|undefined=found;while(node!==undefined){reversed.push(point(node));node=parents.get(node);}reversed.reverse();
 const points:NavigationPoint[]=[];let current=start,index=0;while(index<reversed.length){let last=index;for(let next=index;next<reversed.length;next++){if(!geometry.canSweep(current,reversed[next]))break;last=next;}points.push(reversed[last]);current=reversed[last];index=last+1;if(points.length>maxPoints)return failed('planning_bound',expanded);}
 let total=0,previous=start;for(const p of points){total+=distance(previous,p);previous=p;}return {status:'reachable',points,expanded,reason:'route_found',distance:total};
}

/** Same bounded deterministic planner with the versioned town's finite surface extent. */
export const planTownRoute=(start:NavigationPoint,goal:NavigationPoint,geometry:NavigationGeometry):HomeRoutePlan=>planHomeRoute(start,goal,geometry,{minX:-4.1,maxX:5.5,minZ:-14.7,maxZ:3.1,maxExpansions:3000});
