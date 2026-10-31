import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type {IncomingMessage} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import {SocialSimulation,validateCheckpoint} from '../server/simulation.js';
import {BranchRuntime} from '../server/branch-runtime.js';
import type {BranchRegistry} from '../server/branch-registry.js';
import {VisitHost} from '../server/visit-host.js';
import {OwnerAuth,setupOwnerCredential} from '../server/owner-auth.js';
import {LEGACY_SOCIAL_RULES} from '../shared/social-protocol.js';

/** In-memory transport adapter: executes the actual authenticated VisitHost
 * normalizer without opening a server, socket or canonical world. */
class Socket extends EventEmitter {readyState:number=WebSocket.OPEN;bufferedAmount=0;messages:Record<string,unknown>[]=[];send(data:string,callback?:()=>void){this.messages.push(JSON.parse(data));callback?.();}close(){this.readyState=WebSocket.CLOSED;this.emit('close');}}
function checkpoint(){const cp=new SocialSimulation({mode:'EXPERIMENT',runId:'expiry-run'}).checkpoint();cp.config.hz=cp.body.hz=1;cp.interoception.sampling.nextSampleTick=5;cp.character.x=-3.5;cp.character.z=2.5;cp.pauseUntilTick=10000;cp.home.controller.searchNextTick=10000;return cp;}

test('actual VisitHost 1 Hz expiry executes once at its exact deadline and stops next tick without a heartbeat',async()=>{const directory=await mkdtemp(join(tmpdir(),'lumi-visit-expiry-')),file=join(directory,'private','owner.json'),credential=await setupOwnerCredential(file),auth=new OwnerAuth(file);await auth.load();const session=auth.login(credential),runtime=new BranchRuntime({worldId:'expiry-test',branchId:'experiment',mode:'EXPERIMENT',checkpoint:checkpoint(),directory:join(directory,'runs')}),target=runtime.target,registry={active:()=>runtime} as unknown as BranchRegistry,host=new VisitHost(auth,registry,()=>target),socket=new Socket(),req={headers:{cookie:`lumi_owner=${session.id}`}} as IncomingMessage;
 try{runtime.applyControl({type:'pause'});const entered=host.post('/api/visit/enter',req,{...target,csrf:session.csrf}).value as {generation:number};runtime.applyControl({type:'step'});host.connect(socket as unknown as WebSocket,req);socket.emit('message',Buffer.from(JSON.stringify({type:'bind',...target,csrf:session.csrf,generation:entered.generation})));assert.equal(socket.messages.at(-1)!.type,'bound');const before=runtime.viewerState().visit!.actor!;socket.emit('message',Buffer.from(JSON.stringify({type:'control',...target,generation:entered.generation,sequence:1,forward:.1,strafe:0,yaw:before.heading,pitch:0})));assert.equal(socket.messages.at(-1)!.type,'ack');const input=runtime.simulation.checkpoint().pendingInputs.find(i=>i.command.type==='visit_control')!;assert.equal(input.command.type,'visit_control');if(input.command.type!=='visit_control')throw new Error('Expected normalized control');assert.equal(input.command.expiresTick,input.applyTick);assert.equal(input.command.expiresTick,input.receivedTick+Math.ceil(.75));runtime.applyControl({type:'step'});const moved=runtime.viewerState().visit!.actor!;assert.ok(Math.hypot(moved.x-before.x,moved.z-before.z)>.2,'the exact-deadline intention must execute');assert.equal(moved.moving,true);runtime.applyControl({type:'step'});const stopped=runtime.viewerState().visit!.actor!;assert.deepEqual([stopped.x,stopped.z],[moved.x,moved.z]);assert.equal(stopped.moving,false);assert.equal(runtime.viewerState().visit!.feedback!.reason,'timeout');runtime.applyControl({type:'step'});assert.deepEqual([runtime.viewerState().visit!.actor!.x,runtime.viewerState().visit!.actor!.z],[moved.x,moved.z]);validateCheckpoint(runtime.simulation.checkpoint());}
 finally{host.close();await runtime.close();await rm(directory,{recursive:true,force:true});}});

test('v2 still rejects truly expired and over-TTL controls while v1 keeps its historical equality rejection',()=>{for(const [legacy,offset] of [[false,0],[false,2],[true,1]] as const){const cp=checkpoint();if(legacy)cp.rulesVersion=cp.social.rulesVersion=LEGACY_SOCIAL_RULES;const s=new SocialSimulation({checkpoint:cp,mode:'EXPERIMENT',runId:'expiry-run',historical:legacy});s.enqueue({type:'visit_start',runId:'expiry-run',generation:1});s.step();const before={...s.visitState().actor!};s.enqueue({type:'visit_control',runId:'expiry-run',generation:1,sequence:1,forward:.1,strafe:0,yaw:before.heading,pitch:0,expiresTick:s.state.tick+offset});const events=s.step();assert.ok(events.some(e=>e.type==='VISIT_ACTION'&&e.data.reason==='stale_input'));assert.deepEqual([s.visitState().actor!.x,s.visitState().actor!.z],[before.x,before.z]);assert.equal(events.some(e=>e.type==='VISIT_CONTROL'&&e.outcome==='accepted'),false);validateCheckpoint(s.checkpoint());}});
