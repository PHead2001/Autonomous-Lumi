import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer as reservePort} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import {createServer as createViteServer,type ProxyOptions,type ViteDevServer} from 'vite';
import {WebSocket} from 'ws';
import projectConfig from '../vite.config.js';
import {createWorldServer} from '../server/world-server.js';
import {setupOwnerCredential} from '../server/owner-auth.js';
import {VISIT_LIMITS} from '../shared/visit-protocol.js';

async function removeFixture(directory:string){const owned=resolve(directory),temporaryRoot=resolve(tmpdir());if(!owned.startsWith(temporaryRoot+sep)||!basename(owned).startsWith('lumi-vite-visit-'))throw new Error('Refusing cleanup outside the owned fixture directory');await rm(owned,{recursive:true,force:true});}

/** Exercise the actual project proxy shape, replacing only its fixed target/ports. */
test('normal Vite viewer pairs, enters and controls Visit through the real HTTP and WebSocket proxies',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'lumi-vite-visit-')),credentialFile=join(directory,'private','owner.json'),credential=await setupOwnerCredential(credentialFile);
  const app=createWorldServer({diagnosticsDirectory:join(directory,'runs'),ownerCredentialFile:credentialFile,autoSchedule:false,automaticCaptures:false});
  let viewer:ViteDevServer|undefined;const clients:WebSocket[]=[],forwarded:{host:string|undefined;origin:string|undefined}[]=[];
  try{
    const port=await app.listen(0),backend=`http://127.0.0.1:${port}`;
    app.server.on('request',req=>{if(req.url==='/api/visit/login')forwarded.push({host:req.headers.host,origin:req.headers.origin});});
    const proxy=Object.fromEntries(Object.entries(projectConfig.server!.proxy!).map(([path,value])=>[path,typeof value==='string'?backend:{...value,target:(value as ProxyOptions).ws?backend.replace('http:','ws:'):backend}]));
    const reservation=reservePort();await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));const reserved=reservation.address();assert.ok(reserved&&typeof reserved==='object');const viewerPort=reserved.port;await new Promise<void>((done,reject)=>reservation.close(error=>error?reject(error):done()));assert.ok(![3001,3030,5173].includes(viewerPort));
    viewer=await createViteServer({configFile:false,root:resolve('.'),envDir:directory,logLevel:'silent',server:{host:'127.0.0.1',port:viewerPort,strictPort:true,proxy,hmr:false,watch:null,preTransformRequests:false},optimizeDeps:{noDiscovery:true,include:[]}});await viewer.listen();
    const address=viewer.httpServer!.address();assert.ok(address&&typeof address==='object');assert.ok(![3001,3030,5173].includes(address.port));const origin=`http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(origin+'/')).status,200,'normal viewer entry is served by Vite');assert.equal((await fetch(origin+'/health')).status,200);
    const post=(path:string,value:unknown,cookie='',requestOrigin:string|null=origin,base=origin)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(requestOrigin===null?{}:{Origin:requestOrigin}),...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(value),signal:AbortSignal.timeout(5000)});
    const login=await post('/api/visit/login',{credential});assert.equal(login.status,200,'the normal Vite viewer must pair with strict same-origin protection');
    assert.deepEqual(forwarded[0],{host:new URL(origin).host,origin},'HTTP proxy preserves browser Host rather than rewriting it to the backend');
    const cookie=login.headers.get('set-cookie')!.split(';')[0],session=await login.json();assert.equal(session.authenticated,true);assert.equal((await (await fetch(origin+'/api/visit/session',{headers:{Cookie:cookie}})).json()).authenticated,true);
    const saved=await app.registry.checkpoint(app.registry.live.target),runtime=await app.registry.fork(app.registry.live.target,saved.id,'vite-visit');runtime.applyControl({type:'pause'});const scope=runtime.target;
    assert.equal((await post('/api/visit/enter',{...scope,csrf:'invalid'},cookie)).status,403,'proxy does not bypass session CSRF');
    assert.equal((await post('/api/visit/enter',{...scope,csrf:session.csrf})).status,403,'proxy does not grant anonymous Visit');
    const enter=await post('/api/visit/enter',{...scope,csrf:session.csrf},cookie);assert.equal(enter.status,200);const control=await enter.json();runtime.applyControl({type:'step'});
    const connect=async(token:string,requestOrigin:string|null=origin)=>{const ws=new WebSocket(origin.replace('http:','ws:')+'/visit',{headers:{...(requestOrigin===null?{}:{Origin:requestOrigin}),...(token?{Cookie:token}:{})}});clients.push(ws);ws.on('error',()=>{});await once(ws,'open');return ws;};
    const packet=async(ws:WebSocket,value:unknown)=>{const result=once(ws,'message');ws.send(JSON.stringify(value));return JSON.parse((await result)[0].toString());};
    await assert.rejects(connect(''),/403/);for(const badOrigin of [null,'null','http://evil.invalid',backend])await assert.rejects(connect(cookie,badOrigin),/403/);
    const ws=await connect(cookie);assert.equal((await packet(ws,{type:'bind',...scope,csrf:session.csrf,generation:control.generation})).type,'bound');
    const before={...runtime.viewerState().visit!.actor!},yaw=before.heading;
    assert.equal((await packet(ws,{type:'control',...scope,generation:control.generation,sequence:1,forward:1,strafe:0,yaw,pitch:0})).queued,true);runtime.applyControl({type:'step'});
    const after=runtime.viewerState().visit!.actor!,dx=after.x-before.x,dz=after.z-before.z,stepDistance=VISIT_LIMITS.speed/runtime.checkpoint().simulation.config.hz;
    assert.ok(Math.hypot(dx,dz)>0,'normalized Visit movement reaches the authoritative simulation');
    assert.ok(Math.abs(dx-Math.sin(yaw)*stepDistance)<1e-9&&Math.abs(dz-Math.cos(yaw)*stepDistance)<1e-9,'forward movement follows the authoritative heading by exactly one fixed-step speed bound');
    for(const badOrigin of [null,'null','http://evil.invalid',backend])assert.equal((await post('/api/visit/login',{credential},'',badOrigin)).status,403,'proxy preserves strict Origin checks');
    assert.equal((await post('/api/visit/login',{credential},'',origin,backend)).status,403,'a direct backend request cannot claim a mismatched viewer Origin');
    assert.equal((await post('/api/visit/observe',{...scope,csrf:session.csrf},cookie)).status,200);runtime.applyControl({type:'step'});assert.equal(runtime.viewerState().visit!.control.status,'parked');assert.equal(app.registry.live.viewerState().visit!.actor,null,'fixture Visit never enters its LIVE branch');
  }finally{
    for(const client of clients)client.terminate();await viewer?.close();await app.close();
    await removeFixture(directory);
  }
});
