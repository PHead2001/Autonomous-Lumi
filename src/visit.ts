import type {WorldState} from '../shared/protocol';
import type {ActiveTarget} from '../shared/lab-protocol';
import {VisitControls,type VisitInteraction,type VisitLook} from './visit-controls';
import {VisitGrant} from './visit-grant';

export interface VisitorCameraPose {x:number;z:number;heading:number;pitch:number}
interface VisitViewCallbacks {camera(active:boolean,pose:VisitorCameraPose|null,look:VisitLook):void;mode(active:boolean):void;activateAudio():void}
const readable=(reason:string)=>({out_of_reach:'Move closer to the door or checkout.',shop_closed:'The shop is closed.',shop_unavailable:'The shop is unavailable.',out_of_stock:'That item is out of stock.',insufficient_funds:'Not enough credits.',hands_full:'Your hands are full.',inventory_capacity:'Your inventory is full.',door_occupied:'The doorway is occupied.',door_sweep_blocked:'The doorway is occupied.',control_active:'Another tab controls this avatar. Use the explicit takeover button if needed.'} as Record<string,string>)[reason]??reason.replaceAll('_',' ');

/** Host credentials stay in the cookie/this closure; only normalized intentions reach /visit. */
export function mountVisit(canvas:HTMLCanvasElement,callbacks:VisitViewCallbacks) {
  const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
  const panel=el('visit-panel'),status=el('visit-session-status'),feedback=el('visit-feedback'),login=el<HTMLFormElement>('visit-login'),ready=el('visit-ready'),play=el('visit-play'),enter=el<HTMLButtonElement>('visit-enter'),takeover=el<HTMLButtonElement>('visit-takeover'),observe=el<HTMLButtonElement>('enter-observe'),choose=el<HTMLButtonElement>('choose-visit'),credential=el<HTMLInputElement>('visit-credential'),good=el<HTMLSelectElement>('visit-good');
  const controls=new VisitControls();let world:WorldState|null=null,csrf:string|null=null,socket:WebSocket|null=null,timer:ReturnType<typeof setInterval>|undefined,bindingTimer:ReturnType<typeof setTimeout>|undefined,pending=false,entering=false,epoch=0,drag:number|null=null,px=0,py=0,lastFeedback='',grant:VisitGrant|null=null;
  const report=(message:string)=>{feedback.textContent=message;el('visit-hud-feedback').textContent=message;};
  function scope():ActiveTarget {if(!world?.branchId)throw new Error('Wait for the selected current world before entering.');return {worldId:world.worldId,branchId:world.branchId,runId:world.runId};}
  function camera(){callbacks.camera(controls.active,world?.visit?.actor??null,controls.cameraLook);}
  function send(value:unknown){if(value&&socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(value));}
  function stopHeld(){send(controls.clear());drag=null;}
  function setMode(active:boolean){observe.setAttribute('aria-pressed',String(!active));choose.setAttribute('aria-pressed',String(active));el('visit-hud').hidden=!active;callbacks.mode(active);camera();}
  function release(message?:string){clearInterval(timer);clearTimeout(bindingTimer);send(controls.end());grant=null;const prior=socket;socket=null;prior?.close();play.hidden=true;setMode(false);enter.disabled=!world?.visit||!csrf||pending;if(message)status.textContent=message;}
  function confirmEntry(){
    if(!grant||!world)return;const state=grant.inspect(world);
    if(state.status==='rejected'){release(state.message);return;}
    if(state.status==='waiting'){status.textContent=state.message;return;}
    if(controls.active)return;
    clearTimeout(bindingTimer);controls.begin(grant.target,grant.generation,state.lastSequence,state.lastActionId,{yaw:state.actor.heading,pitch:state.actor.pitch});play.hidden=false;takeover.hidden=true;setMode(true);status.textContent='Visit entry and control confirmed. Focus the view to walk.';report('Move with W/A/S/D, drag to look, and use E near a door or checkout.');canvas.scrollIntoView({block:'center'});canvas.focus({preventScroll:true});timer=setInterval(()=>send(controls.movement()),100);send(controls.movement());
  }
  async function request(path:string,payload?:unknown){const response=await fetch(path,payload===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw new Error(typeof result.error==='string'?result.error:'The local owner request failed.');return result;}
  async function session(){
    const token=epoch;status.textContent='Checking local owner access…';
    try{const result=await request('/api/visit/session');if(token!==epoch)return;csrf=result.authenticated&&typeof result.csrf==='string'?result.csrf:null;login.hidden=!!csrf;ready.hidden=!csrf;enter.disabled=!!socket||controls.active||!world?.visit||pending;
      status.textContent=csrf?'This browser is paired. Enter Visit when ready; no avatar has been placed by pairing.':result.configured?'Pair this browser with the private local owner credential.':'Owner access is not configured. Run npm run owner:pair, restart the server, then pair this browser.';
    }catch(error){status.textContent=error instanceof Error?error.message:'Could not check local owner access.';}
  }
  choose.onclick=()=>{panel.hidden=false;if(!controls.active&&!socket&&!entering)void session();};
  login.onsubmit=async event=>{
    event.preventDefault();if(pending)return;pending=true;const secret=credential.value;credential.value='';const button=login.querySelector<HTMLButtonElement>('button')!;button.disabled=true;status.textContent='Pairing this browser…';
    try{const result=await request('/api/visit/login',{credential:secret});if(!result.authenticated||typeof result.csrf!=='string')throw new Error('The server did not confirm owner access.');csrf=result.csrf;login.hidden=true;ready.hidden=false;enter.disabled=!world?.visit;status.textContent='Browser paired. Press Enter Visit to place or resume your avatar.';}catch(error){status.textContent=error instanceof Error?error.message:'Pairing failed.';}finally{pending=false;button.disabled=false;}
  };
  async function start(take=false){
    if(pending||!csrf||socket||controls.active)return;callbacks.activateAudio();pending=true;entering=true;enter.disabled=true;takeover.disabled=true;const token=++epoch;
    try{
      const target=scope(),requestedTick=world!.tick,result=await request('/api/visit/enter',{...target,csrf,...(take?{takeover:true}:{})});if(token!==epoch)return;
      if(!Number.isSafeInteger(result.generation)||result.generation<1||!Number.isSafeInteger(result.lastSequence)||!Number.isSafeInteger(result.lastActionId))throw new Error('The server returned an invalid control grant.');
      release();grant=new VisitGrant(target,result.generation,requestedTick);status.textContent='Entering Visit; waiting for control confirmation…';
      const current=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/visit`);socket=current;
      current.onopen=()=>{if(socket!==current)return;current.send(JSON.stringify({type:'bind',...target,csrf,generation:result.generation}));};
      current.onmessage=event=>{
        if(socket!==current)return;let message:{type?:string;generation?:number;queued?:boolean;error?:string};try{message=JSON.parse(event.data);}catch{release('Unreadable control response. Re-enter Visit to resume safely.');return;}
        if(message.type==='bound'){
          try{grant?.bind(message.generation!);confirmEntry();}catch(error){release(error instanceof Error?error.message:'Control grant changed. Re-enter Visit.');}
        }else if(message.type==='error'){report(message.error??'The server rejected that control.');}
        else if(message.type==='ack'&&message.queued===false)report('That intention was not admitted. Your last confirmed world state remains authoritative.');
      };
      current.onclose=()=>{if(socket===current)release('Visit control disconnected. Movement is stopped by the server; re-enter to resume the same avatar.');};current.onerror=()=>current.close();
      bindingTimer=setTimeout(()=>{if(socket===current&&grant&&world&&!controls.active){const state=grant.timeout(world);if(state.status==='active')confirmEntry();else release(state.message);}},8000);
    }catch(error){status.textContent=error instanceof Error?error.message:'Could not enter Visit.';takeover.hidden=false;}
    finally{pending=false;entering=false;enter.disabled=!!socket||controls.active||!world?.visit||!csrf;takeover.disabled=false;}
  }
  enter.onclick=()=>{void start();};takeover.onclick=()=>{void start(true);};
  observe.onclick=async()=>{
    const wasActive=controls.active||!!socket||entering;const target=world?scope():null;epoch++;release();panel.hidden=true;
    if(wasActive&&csrf&&target){try{await request('/api/visit/observe',{...target,csrf});status.textContent='Observe selected. Your existing avatar remains visibly parked.';}catch{status.textContent='Control closed. The server will stop and park the avatar; the Observe request was not confirmed.';}}
  };
  function interact(forcePurchase=false){
    if(!controls.active||!world?.visit?.actor)return;const actor=world.visit.actor;
    const nearby=[{door:'home' as const,x:2.97,z:-3.53},{door:'shop' as const,x:2.97,z:-9.3}].map(d=>({...d,distance:Math.hypot(actor.x-d.x,actor.z-d.z)})).sort((a,b)=>a.distance-b.distance);
    const action:VisitInteraction=!forcePurchase&&nearby[0].distance<2?{action:'door',door:nearby[0].door,good:null}:{action:'purchase',door:null,good:good.value==='bread'?'bread':'fruit'};
    send(controls.interaction(action,world.visit.lastActionId));report('Interaction requested; waiting for the server outcome.');
  }
  el('visit-interact').onclick=()=>interact();el('visit-purchase').onclick=()=>interact(true);
  const keydown=(event:KeyboardEvent)=>{if(!controls.active||event.target!==canvas)return;if(controls.key(event.code,true)){event.preventDefault();if(!event.repeat)send(controls.movement());}else if(event.code==='KeyE'&&!event.repeat){event.preventDefault();interact();}};
  const keyup=(event:KeyboardEvent)=>{if(controls.key(event.code,false)){event.preventDefault();send(controls.movement());}};
  const pointerdown=(event:PointerEvent)=>{if(!controls.active||event.button!==0)return;canvas.focus({preventScroll:true});drag=event.pointerId;px=event.clientX;py=event.clientY;canvas.setPointerCapture(event.pointerId);};
  const pointermove=(event:PointerEvent)=>{if(drag!==event.pointerId||!controls.active)return;controls.turn(event.clientX-px,event.clientY-py);px=event.clientX;py=event.clientY;camera();};
  const pointerup=(event:PointerEvent)=>{if(drag===event.pointerId)drag=null;};
  canvas.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);canvas.addEventListener('blur',stopHeld);window.addEventListener('blur',stopHeld);canvas.addEventListener('pointerdown',pointerdown);canvas.addEventListener('pointermove',pointermove);canvas.addEventListener('pointerup',pointerup);canvas.addEventListener('pointercancel',pointerup);
  const pagehide=()=>{epoch++;release();};window.addEventListener('pagehide',pagehide);
  return {
    get active(){return controls.active;},
    update(next:WorldState){
      world=next;choose.disabled=!next.visit;enter.disabled=!!socket||controls.active||!next.visit||!csrf||pending;
      confirmEntry();
      if(next.visit){const v=next.visit,inventory=v.inventory.reduce((a,i)=>{a[i.kind]=(a[i.kind]??0)+1;return a;},{} as Record<string,number>);el('visit-inventory').textContent=`${v.balance} credits · Holding ${v.actor?.heldItem??'nothing'} · Inventory: ${Object.entries(inventory).map(([kind,count])=>`${kind} × ${count}`).join(', ')||'empty'}`;el('visit-hud-inventory').textContent=`${v.balance} credits · Holding ${v.actor?.heldItem??'nothing'}`;
        const f=v.feedback,key=f?`${f.tick}/${f.actionId}/${f.type}/${f.outcome}`:'';if(f&&key!==lastFeedback){lastFeedback=key;report(`${f.type==='purchase'?'Purchase':f.type==='door'?'Door interaction':'Control'} ${f.outcome==='accepted'?'confirmed':f.outcome==='stopped'?'stopped':'not completed'}. ${readable(f.reason)}`);}
      }
      camera();
    },
    disconnect(){epoch++;release('Viewer disconnected. Visit control released; the server world continues.');},
    dispose(){epoch++;release();canvas.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);canvas.removeEventListener('blur',stopHeld);window.removeEventListener('blur',stopHeld);canvas.removeEventListener('pointerdown',pointerdown);canvas.removeEventListener('pointermove',pointermove);canvas.removeEventListener('pointerup',pointerup);canvas.removeEventListener('pointercancel',pointerup);window.removeEventListener('pagehide',pagehide);},
  };
}
