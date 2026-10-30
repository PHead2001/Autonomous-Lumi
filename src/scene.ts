import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPhysicalRenderScene } from './render-scene';
import type { WorldState } from '../shared/protocol';
import { homePoseTransform } from '../shared/home-geometry';

export type ObserveMode = 'orbit'|'free'|'follow'|'fixed';
export const OBSERVE_HELP:Record<ObserveMode,string> = {
  orbit:'Drag to orbit · Scroll to zoom · R to recenter',
  free:'Focus the view · Drag to look · W/A/S/D or arrows to fly · Q/E down/up · Shift faster · R to recenter',
  follow:'Drag to orbit Lumi · Scroll to zoom · R to recenter',
  fixed:'A steady view · Show neighborhood for the whole route · R to recenter · 1–4 to switch cameras',
};
export function createScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
  controls.minDistance = 4; controls.maxDistance = 22; controls.maxPolarAngle = Math.PI / 2.05;
  controls.minPolarAngle = 0.2; controls.enablePan = false;
  let mode:ObserveMode='orbit',state:WorldState|null=null,world:ReturnType<typeof createPhysicalRenderScene>|null=null,overview=false;
  let received=performance.now(),lastFrame=performance.now(),initialized=false,disposed=false;
  const held=new Set<string>();let drag:number|null=null,mouseX=0,mouseY=0;
  const aim=()=>state?new THREE.Vector3(...homePoseTransform(state).transformPoint([0,1.25,0])):new THREE.Vector3(0,1.25,0);
  const reset=()=>{
    const neighborhood=overview&&!!state&&'town' in state&&!!state.town&&mode!=='follow';
    held.clear();controls.maxDistance=neighborhood?40:22;
    controls.target.copy(mode==='follow'?aim():neighborhood?new THREE.Vector3(1.5,1,-5.5):new THREE.Vector3(0,1,0));
    camera.position.copy(controls.target).add(neighborhood?new THREE.Vector3(18,19,23):mode==='fixed'?new THREE.Vector3(8,6,9):mode==='free'?new THREE.Vector3(0,2,7):new THREE.Vector3(10,7,12));
    camera.lookAt(controls.target);controls.update();
  };
  const setMode=(next:ObserveMode)=>{mode=next;controls.enabled=next==='orbit'||next==='follow';reset();};reset();
  const keydown=(event:KeyboardEvent)=>{if(mode!=='free')return;if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'].includes(event.code)){held.add(event.code);event.preventDefault();}};
  const keyup=(event:KeyboardEvent)=>{held.delete(event.code);};
  const blur=()=>{held.clear();drag=null;};
  const pointerdown=(event:PointerEvent)=>{if(mode!=='free'||event.button!==0)return;canvas.focus();drag=event.pointerId;mouseX=event.clientX;mouseY=event.clientY;canvas.setPointerCapture(event.pointerId);};
  const pointermove=(event:PointerEvent)=>{if(mode!=='free'||drag!==event.pointerId)return;const rotation=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');rotation.y-=(event.clientX-mouseX)*.004;rotation.x=THREE.MathUtils.clamp(rotation.x-(event.clientY-mouseY)*.004,-1.5,1.5);camera.quaternion.setFromEuler(rotation);mouseX=event.clientX;mouseY=event.clientY;};
  const pointerup=(event:PointerEvent)=>{if(drag===event.pointerId)drag=null;};
  canvas.addEventListener('keydown',keydown);canvas.addEventListener('keyup',keyup);canvas.addEventListener('blur',blur);canvas.addEventListener('pointerdown',pointerdown);canvas.addEventListener('pointermove',pointermove);canvas.addEventListener('pointerup',pointerup);canvas.addEventListener('pointercancel',pointerup);
  function frame(now:number){
    if(disposed)return;
    const dt=Math.min((now-lastFrame)/1000,.1);lastFrame=now;
    const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight);
    if(canvas.width!==Math.round(width*renderer.getPixelRatio())||canvas.height!==Math.round(height*renderer.getPixelRatio())){renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
    if(state&&world){
      const time=state.time+Math.min((now-received)/1000,1/30),c=state.character,alpha=initialized?1-Math.exp(-dt*18):1;
      if (state.home) {
        // Same authoritative transform as the actual eye/collision source: no spectator-only lying offset.
        const pose=homePoseTransform(state);world.avatar.root.position.set(...pose.position);world.avatar.root.quaternion.set(...pose.quaternion);
      } else {
        world.avatar.root.position.lerp(new THREE.Vector3(c.x,0,c.z),alpha);
        const angle=Math.atan2(Math.sin(c.heading-world.avatar.root.rotation.y),Math.cos(c.heading-world.avatar.root.rotation.y));world.avatar.root.rotation.y+=angle*alpha;
      }
      world.applySnapshot(state,time,false);initialized=true;
    }
    if(mode==='follow'){const next=aim(),delta=next.clone().sub(controls.target);camera.position.add(delta);controls.target.copy(next);}
    if(mode==='free'){
      const velocity=new THREE.Vector3(Number(held.has('KeyD')||held.has('ArrowRight'))-Number(held.has('KeyA')||held.has('ArrowLeft')),0,Number(held.has('KeyS')||held.has('ArrowDown'))-Number(held.has('KeyW')||held.has('ArrowUp')));
      if(velocity.lengthSq())velocity.normalize().applyQuaternion(camera.quaternion);velocity.y+=Number(held.has('KeyE'))-Number(held.has('KeyQ'));
      camera.position.addScaledVector(velocity,dt*(held.has('ShiftLeft')||held.has('ShiftRight')?7:3));camera.position.clamp(new THREE.Vector3(-18,.25,-18),new THREE.Vector3(18,15,18));
    }else if(controls.enabled)controls.update();
    if(world)renderer.render(world.scene,camera);requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return {reset,setMode,getMode:()=>mode,setOverview(next:boolean){overview=next;reset();},setState(next:WorldState){if(next.worldId!==state?.worldId||next.runId!==state?.runId)initialized=false;state=next;received=performance.now();world??=createPhysicalRenderScene(next,{firstPerson:false});},dispose(){disposed=true;controls.dispose();world?.dispose();renderer.dispose();canvas.removeEventListener('keydown',keydown);canvas.removeEventListener('keyup',keyup);canvas.removeEventListener('blur',blur);canvas.removeEventListener('pointerdown',pointerdown);canvas.removeEventListener('pointermove',pointermove);canvas.removeEventListener('pointerup',pointerup);canvas.removeEventListener('pointercancel',pointerup);}};
}
