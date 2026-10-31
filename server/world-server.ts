import { HomeLab } from './home-lab.js';
import { TownLab } from './town-lab.js';
import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { extname, resolve, sep, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { normalizeCommand, type DeterministicEvent } from './simulation.js';
import { BranchRegistry } from './branch-registry.js';
import { validId, type BranchRuntime } from './branch-runtime.js';
import type { HostClock, SchedulerConfig } from './scheduler.js';
import { queryTimeline, type TimelineFilters } from './diagnostics/query.js';
import { exportIncident } from './diagnostics/bundle.js';
import type { AcousticEvent, ServerMessage } from '../shared/protocol.js';
import type { ActiveTarget, Target } from '../shared/lab-protocol.js';
import type { RecoveryStore } from './recovery-store.js';
import { createVisionApi } from './vision/http-api.js';
import { validateCommand } from './simulation.js';
import { validateSensoryCommand } from '../shared/attention-protocol.js';
import { AutomaticCaptureCoordinator } from './vision/auto-capture.js';
import type { FrameRenderer } from './vision/renderer.js';
import { CognitionCoordinator, type CognitionProviderClient } from './cognition/coordinator.js';
import { loadCognitionConfig, type CognitionConfig } from './cognition/config.js';
import { DurableBudget } from './cognition/budget.js';
import { CognitionProviders } from './cognition/providers.js';
export interface WorldServerOptions {physiology?:import('./branch-runtime.js').RuntimeOptions['physiology'];seed?:number;checkpoint?:unknown;diagnosticsDirectory?:string;historyId?:string;recoveryStore?:RecoveryStore;clock?:HostClock;schedulerConfig?:Partial<SchedulerConfig>;autoSchedule?:boolean;viewerOrigins?:string[];renderer?:FrameRenderer;automaticCaptures?:boolean;cognition?:{config:CognitionConfig;providers?:CognitionProviderClient;experimentsOnly?:boolean}}
const loopback=(name:string)=>['127.0.0.1','localhost','[::1]'].includes(name);
function localHost(host:string|undefined){try{if(!host)return false;const u=new URL('http://'+host);return loopback(u.hostname)&&!u.username&&!u.password&&u.pathname==='/';}catch{return false;}}
async function body(req:IncomingMessage):Promise<Record<string,unknown>>{if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw new Error('JSON content type required');let size=0;const chunks:Buffer[]=[];for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>8192)throw new Error('Request exceeds 8 KiB');chunks.push(b);}const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('JSON object required');return value;}
function target(value:Record<string,unknown>):Target {if(!validId(value.worldId)||!validId(value.branchId))throw new Error('Explicit world and branch required');return {worldId:value.worldId,branchId:value.branchId};}
function active(value:Record<string,unknown>):ActiveTarget {const t=target(value);if(!validId(value.runId))throw new Error('Explicit run required');return {...t,runId:value.runId};}
function filters(value:Record<string,unknown>):TimelineFilters {const f:Record<string,unknown>={};for(const k of ['category','component','severity','causalId','search','eventType'])if(value[k]!==undefined&&value[k]!=='')f[k]=value[k];for(const k of ['fromTick','toTick','limit'])if(value[k]!==undefined&&value[k]!=='')f[k]=Number(value[k]);return f as TimelineFilters;}
export function createWorldServer(options:WorldServerOptions={}) {
  const sockets=new WebSocketServer({noServer:true,maxPayload:8192});
  const subscriptions=new Map<WebSocket,{target:Target;legacy:boolean}>();
  const send=(socket:WebSocket,message:ServerMessage)=>{if(socket.readyState!==WebSocket.OPEN||socket.bufferedAmount>=64000)return false;try{socket.send(JSON.stringify(message),()=>{});return true;}catch{return false;}};
  const same=(a:Target,b:Target)=>a.worldId===b.worldId&&a.branchId===b.branchId;
  const observe=(events:DeterministicEvent[],runtime:BranchRuntime)=>{
    for(const e of events){if(e.type!=='ACOUSTIC_EVENT')continue;let queued=0,count=0;for(const [socket,sub]of subscriptions)if(same(sub.target,runtime.target)){count++;if(send(socket,{type:'sound',event:e.data as unknown as AcousticEvent,state:runtime.viewerState()}))queued++;}
      const reflex=events.find(candidate=>candidate.type==='REFLEX_STATE'&&candidate.inputSequence===e.inputSequence);
      runtime.recorder?.record({tick:runtime.simulation.state.tick,category:'OPERATIONAL_REPLAY',eventType:'VIEWER_NOTIFICATION',component:'transport',outcome:queued?'queued':'no_viewers_or_backpressure',parentSequence:reflex?.sequence??e.sequence,inputSequence:e.inputSequence,data:{queuedViewers:queued,connectedViewers:count,displayed:'unavailable',audioPlayed:'unavailable'}});
    }
  };
  let shuttingDown=false;
  const registry=new BranchRegistry({physiology:options.physiology,directory:options.diagnosticsDirectory,checkpoint:options.checkpoint,seed:options.seed,clock:options.clock,onEvents:observe,historyId:options.historyId??options.recoveryStore?.historyId,dormantLive:true,beforeRetireRuntime:runtime=>{automatic.retire(runtime.target);cognition.retire(runtime.target);vision.manager.retire(runtime.target);}});
  const vision=createVisionApi({registry,renderer:options.renderer});
  const current=(scope:ActiveTarget)=>{try{return registry.get(scope).target.runId===scope.runId;}catch{return false;}};
  const labBranches=new Set<string>();
  const cognitionConfig=options.cognition?.config??loadCognitionConfig({env:{},loadEnv:false});
  const cognitionProviders=options.cognition?.providers??new CognitionProviders(cognitionConfig,new DurableBudget(cognitionConfig.budget.directory,cognitionConfig.budget.ceilingUsd));
  const cognition=new CognitionCoordinator(cognitionConfig,cognitionProviders,vision.manager,current,registry.historyId,options.clock?()=>options.clock!.monotonicMs():undefined,runtime=>!labBranches.has(runtime.target.branchId)&&(options.cognition?.experimentsOnly!==true||runtime.mode==='EXPERIMENT'));
  const automatic=new AutomaticCaptureCoordinator(vision.manager,current,options.clock?()=>options.clock!.monotonicMs():undefined,(runtime,intent)=>cognition.selectedCapture(runtime,intent));
  if(options.schedulerConfig&&Object.keys(options.schedulerConfig).length)throw new Error('Scheduler configuration is restored through complete runtime checkpoints');
  const root=resolve('dist');const downloads=new Map<string,{target:ActiveTarget;file:string}>();
  const exportLabRun=async(prefix:'home'|'town',runtime:BranchRuntime)=>{if(downloads.size>=32)throw new Error('Local export limit reached (32)');runtime.capture();const snapshot=await runtime.recorder!.snapshotForExport();const exportId=prefix+'-'+randomUUID(),directory=join(registry.directory,runtime.target.worldId,runtime.target.branchId,'exports');await mkdir(directory,{recursive:true});const out=join(directory,exportId+'.zip');const result=await exportIncident({runDirectory:runtime.recorder!.runDirectory,out,snapshot,expectedWorldId:runtime.target.worldId,expectedBranchId:runtime.target.branchId,expectedRunId:runtime.target.runId});if(result.manifest.evidence_status!=='COMPLETE')throw new Error('Laboratory evidence incomplete');downloads.set(exportId,{target:runtime.target,file:out});return '/api/download?'+new URLSearchParams({...runtime.target,exportId});};
  const homeLab=new HomeLab(registry,branchId=>labBranches.add(branchId),runtime=>exportLabRun('home',runtime));
  const townLab=new TownLab(registry,branchId=>labBranches.add(branchId),runtime=>exportLabRun('town',runtime));
  const allowedOrigins=new Set(['http://127.0.0.1:5173','http://localhost:5173',...(options.viewerOrigins??[])]);
  function permitted(req:IncomingMessage){if(!localHost(req.headers.host)||req.headers['sec-fetch-site']==='cross-site')return false;const origin=req.headers.origin;if(origin===undefined)return true;if(origin==='null')return false;try{const u=new URL(origin);return u.protocol==='http:'&&loopback(u.hostname)&&(origin===`http://${req.headers.host}`||allowedOrigins.has(origin));}catch{return false;}}
  function scopedSummary(runtime:BranchRuntime){return {...runtime.summary(),state:runtime.viewerState()};}
  const server=createServer(async(req,res)=>{
    const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    if(!localHost(req.headers.host)){json(403,{error:'Loopback Host required'});return;}
    try{
      const url=new URL(req.url??'/','http://localhost'), pathname=url.pathname,query=Object.fromEntries(url.searchParams);
      if(pathname.startsWith('/api/vision')&&req.method==='GET'){
        if(!permitted(req)){json(403,{error:'Local same-origin request required'});return;}
        const result=await vision.get(pathname,query);if(result){if(result.bytes){res.writeHead(result.status,{'Content-Type':result.contentType??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(result.bytes);}else json(result.status,result.body);return;}
      }
      if(pathname==='/api/home-lab'&&req.method==='GET'){if(!permitted(req)){json(403,{error:'Local same-origin request required'});return;}json(200,homeLab.get(query.scenarioId));return;}
      if(pathname==='/api/town-lab'&&req.method==='GET'){if(!permitted(req)){json(403,{error:'Local same-origin request required'});return;}json(200,townLab.get(query.scenarioId));return;}
      if(pathname==='/health'){const live=registry.live;json(200,{worldId:live.target.worldId,historyId:registry.historyId,runId:live.target.runId,time:live.simulation.state.time,tick:live.simulation.state.tick,viewers:subscriptions.size,scheduler:live.scheduler.config,logging:live.recorder?.health(),recovery:options.recoveryStore?.status()??null});return;}
      if(pathname==='/api/attention'&&req.method==='GET'){
        if(!permitted(req)){json(403,{error:'Local same-origin request required'});return;}
        const scope=active(query),runtime=registry.active(scope),checkpoint=runtime.simulation.checkpoint();
        json(200,{...scope,attention:checkpoint.schemaVersion===4||checkpoint.schemaVersion===5||(checkpoint.schemaVersion===6||(checkpoint.schemaVersion===7||checkpoint.schemaVersion===8||checkpoint.schemaVersion===9))?checkpoint.attention:null,automatic:automatic.summary(scope)});return;
      }
      if(pathname==='/api/physiology'&&req.method==='GET'){
        if(!permitted(req)){json(403,{error:'Local same-origin request required'});return;}
        const runtime=registry.active(active(query)),cp=runtime.simulation.checkpoint();
        json(200,{...runtime.target,active:(cp.schemaVersion===6||(cp.schemaVersion===7||cp.schemaVersion===8||cp.schemaVersion===9))&&cp.body.active,mode:(cp.schemaVersion===6||(cp.schemaVersion===7||cp.schemaVersion===8||cp.schemaVersion===9))?cp.body.mode:'inactive',presentSensations:'presentInternalSensations' in runtime.simulation?runtime.simulation.presentInternalSensations():[],...(query.advanced==='true'&&(cp.schemaVersion===6||(cp.schemaVersion===7||cp.schemaVersion===8||cp.schemaVersion===9))?{privateDiagnostics:{body:cp.body,interoception:cp.interoception,physiology:cp.physiology,internalExperiences:cp.internalExperiences}}:{})});return;
      }
      if(pathname==='/api/cognition'&&req.method==='GET'){
        if(!permitted(req)){json(403,{error:'Local same-origin request required'});return;}
        json(200,await cognition.summary(registry.active(active(query))));return;
      }
      if(pathname==='/api/branches'&&req.method==='GET'){json(200,{branches:[...registry.branches.values()].map(scopedSummary),recovery:options.recoveryStore?.status()??null});return;}
      if(pathname==='/api/recovery'&&req.method==='GET'){json(200,options.recoveryStore?.status()??null);return;}
      if(pathname==='/api/checkpoints'&&req.method==='GET'){json(200,await registry.catalog());return;}
      if(pathname==='/api/branch'&&req.method==='GET'){json(200,scopedSummary(registry.get(target(query))));return;}
      if(pathname==='/api/timeline'&&req.method==='GET'){const scope=active(query),runtime=registry.get(scope),directory=registry.runDirectory(scope);if(runtime.target.runId===scope.runId)await runtime.recorder?.flush();json(200,await queryTimeline({runDirectory:directory,...scope,...filters(query)}));return;}
      if(pathname==='/api/download'&&req.method==='GET'){const scope=active(query);registry.runDirectory(scope);if(!validId(query.exportId))throw new Error('Invalid export ID');const file=downloads.get(query.exportId);if(!file||!same(file.target,scope)||file.target.runId!==scope.runId)throw new Error('Export does not belong to selected run');if((await stat(file.file)).size>8*1024*1024)throw new Error('Export exceeds download bound');res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${query.exportId}.zip"`,'Cache-Control':'no-store'});res.end(await readFile(file.file));return;}
      if(pathname.startsWith('/api/')&&req.method==='POST'){
        if(shuttingDown){json(503,{error:'Server is shutting down; no new mutations are accepted'});return;}
        if(!permitted(req)){json(403,{error:'Local same-origin request required'});return;}const input=await body(req);if(shuttingDown)throw new Error("Server is shutting down");if(pathname==='/api/home-lab/start'){json(200,await homeLab.start(input.scenario));return;}if(pathname==='/api/town-lab/start'){json(200,await townLab.start(input.scenario));return;}const scope=active(input),runtime=registry.active(scope);
        if(pathname==='/api/checkpoint'){json(200,{checkpoint:await registry.checkpoint(scope)});return;}
        if(pathname==='/api/fork'){json(200,scopedSummary(await registry.fork(scope,input.checkpointId,input.newBranchId)));return;}
        if(pathname==='/api/restore'){const restored=await registry.restore(scope,input.checkpointId);broadcast();json(200,scopedSummary(restored));return;}
        if(pathname==='/api/reopen'){if(typeof input.allowLegacy!=='boolean'&&input.allowLegacy!==undefined)throw new Error('allowLegacy must be boolean');const source=target({worldId:input.sourceWorldId,branchId:input.sourceBranchId});json(200,scopedSummary(await registry.reopen(source,input.checkpointId,input.newBranchId,input.allowLegacy===true)));return;}
        if(pathname==='/api/control'){runtime.applyControl(input.action);broadcast();json(200,scopedSummary(runtime));return;}
        if(pathname.startsWith('/api/vision')){const result=await vision.post(pathname,runtime,input);if(result!==null){json(200,result);return;}}
        if(pathname==='/api/scene'){const command=validateCommand(input.action,true);if(command.type!=='configure_scene')throw new Error('Scene configuration required');runtime.enqueue(command);json(200,{queued:true});return;}
        if(pathname==='/api/sound'){
          if(runtime.mode!=='EXPERIMENT')throw new Error('Controlled sound emitters are experiment-only');
          const command=validateSensoryCommand(input.action);if(command.type!=='emit_sound')throw new Error('Controlled sound emission required');
          const admitted=runtime.enqueue(command);json(200,{input:admitted.input,queued:admitted.input.admission==='queued'});return;
        }
        if(pathname==='/api/export'){
          const selectedRunId=input.selectedRunId??scope.runId;if(!validId(selectedRunId))throw new Error('Invalid export run');const selected={...scope,runId:selectedRunId},runDirectory=registry.runDirectory(selected);let snapshot;if(selectedRunId===runtime.target.runId){runtime.capture();snapshot=await runtime.recorder!.snapshotForExport();}
          if(downloads.size>=32)throw new Error('Local export limit reached (32)');const exportId='incident-'+randomUUID(),directory=join(registry.directory,scope.worldId,scope.branchId,'exports');await mkdir(directory,{recursive:true});const out=join(directory,exportId+'.zip');
          const result=await exportIncident({runDirectory,out,expectedWorldId:scope.worldId,expectedBranchId:scope.branchId,expectedRunId:selectedRunId,snapshot,...filters(input)});downloads.set(exportId,{target:selected,file:out});const params=new URLSearchParams({...selected,exportId});json(200,{downloadUrl:'/api/download?'+params,manifest:result.manifest,assertions:result.assertions});return;
        }
        json(404,{error:'Unknown developer operation'});return;
      }
      if(pathname.startsWith('/api/')){json(405,{error:'Unsupported developer request'});return;}
      const file=resolve(root,'.'+(pathname==='/'?'/index.html':decodeURIComponent(pathname)));if(!file.startsWith(root+sep)){json(403,{error:'Invalid path'});return;}const types:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};const data=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream'});res.end(data);
    }catch(error){json(400,{error:error instanceof Error?error.message:'Request failed'});}
  });
  server.on('upgrade',(req,socket,head)=>{
    try{if(!permitted(req))throw new Error('Denied origin');const url=new URL(req.url??'/','http://localhost');if(url.pathname!=='/world')throw new Error('Invalid socket path');const legacy=!url.search;const selected=legacy?registry.live.target:target(Object.fromEntries(url.searchParams));registry.get(selected);sockets.handleUpgrade(req,socket,head,ws=>{subscriptions.set(ws,{target:selected,legacy});sockets.emit('connection',ws,req);});}catch{socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();}
  });
  sockets.on('connection',(socket:WebSocket)=>{const sub=subscriptions.get(socket)!;const runtime=registry.get(sub.target);send(socket,{type:'state',state:runtime.viewerState()});runtime.recorder?.record({tick:runtime.simulation.state.tick,category:'OPERATIONAL_REPLAY',eventType:'VIEWER_CONNECTED',component:'transport',outcome:'state_queued',data:{viewers:subscriptions.size}});
    socket.on('error',()=>{});socket.on('close',()=>{subscriptions.delete(socket);registry.get(sub.target).recorder?.record({tick:registry.get(sub.target).simulation.state.tick,category:'OPERATIONAL_REPLAY',eventType:'VIEWER_DISCONNECTED',component:'transport',outcome:'closed',data:{viewers:subscriptions.size}});});
    socket.on('message',raw=>{if(shuttingDown)return;const branch=registry.get(sub.target);let command:unknown;try{command=JSON.parse(raw.toString());}catch{command=null;}
      if(command&&typeof command==='object'&&!Array.isArray(command)&&'worldId'in command){try{const scoped=active(command as Record<string,unknown>);if(!same(scoped,sub.target)||registry.active(scoped)!==branch)throw new Error('Wrong subscription');const c=command as Record<string,unknown>;branch.enqueue(c.type==='ring_doorbell'?{type:'doorbell'}:normalizeCommand(JSON.stringify({type:c.type})));}catch{branch.recorder?.record({tick:branch.simulation.state.tick,category:'OPERATIONAL_REPLAY',eventType:'INPUT_TARGET_REJECTED',component:'transport',severity:'warn',outcome:'rejected',data:{reason:'stale_or_wrong_target'}});}return;}
      if(sub.legacy&&branch.mode==='LIVE')branch.enqueue(command&&typeof command==='object'&&'type'in command&&command.type==='ring_doorbell'?{type:'doorbell'}:normalizeCommand(raw.toString()));else branch.recorder?.record({tick:branch.simulation.state.tick,category:'OPERATIONAL_REPLAY',eventType:'INPUT_TARGET_REJECTED',component:'transport',severity:'warn',outcome:'rejected',data:{reason:'explicit_target_required'}});
    });
  });
  function broadcast(){for(const [socket,sub]of subscriptions){const runtime=registry.get(sub.target);send(socket,{type:'state',state:runtime.viewerState()});}}
  let pumps=0,started=false;const timer=options.autoSchedule===false?undefined:setInterval(()=>{if(!started)return;for(const runtime of registry.branches.values())runtime.pump();if(options.automaticCaptures!==false)automatic.pump(registry.branches.values());cognition.pump(registry.branches.values());homeLab.pump();townLab.pump();broadcast();if(++pumps%900===0)for(const runtime of registry.branches.values())runtime.capture();},1000/30);
  const saveRecovery=async()=>{if(!options.recoveryStore)return;const cp=registry.live.capture();try{await options.recoveryStore.save(cp);registry.live.recorder?.record({tick:cp.simulation.tick,category:'OPERATIONAL_REPLAY',eventType:'RECOVERY_COMMITTED',component:'recovery',outcome:'committed',data:{checkpointTick:cp.simulation.tick,historyId:registry.historyId,generation:options.recoveryStore.status().lastCommitted?.generation??0}});}catch{registry.live.recorder?.record({tick:cp.simulation.tick,category:'OPERATIONAL_REPLAY',eventType:'RECOVERY_SAVE_FAILED',component:'recovery',severity:'error',outcome:'previous_checkpoint_retained',data:{checkpointTick:cp.simulation.tick}});throw new Error('LIVE recovery save failed; inspect /health recovery.saveError');}};
  let saving=false;const recoveryTimer=options.recoveryStore?setInterval(()=>{if(!started||saving)return;saving=true;void saveRecovery().catch(()=>{}).finally(()=>{saving=false;});},options.recoveryStore.status().intervalMs):undefined;recoveryTimer?.unref();
  let closing:Promise<void>|undefined;const ready=(async()=>{await registry.live.prepare();await registry.initializeLiveCheckpoints();const status=options.recoveryStore?.status();if(status)registry.live.recorder?.record({tick:registry.live.simulation.state.tick,category:'OPERATIONAL_REPLAY',eventType:status.status==='recovered'?'LIVE_RECOVERED':'LIVE_INITIALIZED',component:'recovery',outcome:status.fallback?'previous_generation_fallback':status.status,data:{historyId:registry.historyId,checkpointTick:status.recovered?.tick??registry.live.simulation.state.tick,fallback:status.fallback,checkpointAgeMs:status.checkpointAgeMs??0,classification:'checkpoint_age_upper_bound_no_catchup'}});await saveRecovery();if(!shuttingDown){registry.live.activate();started=true;}})();
  return {server,registry,sockets,vision,automatic,cognition,homeLab,townLab,get simulation(){return registry.live.simulation;},get scheduler(){return registry.live.scheduler;},get recorder(){return registry.live.recorder!;},
    listen:(port=3001)=>new Promise<number>((resolvePort,reject)=>{void ready.then(()=>{if(shuttingDown){reject(new Error("Server is shutting down"));return;}server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);const address=server.address();resolvePort(typeof address==='object'&&address?address.port:port);});},reject);}),
    close:()=>closing??=(async()=>{shuttingDown=true;started=false;automatic.close();clearInterval(timer);clearInterval(recoveryTimer);let failure:unknown;try{await ready;cognition.close(registry.branches.values());await saveRecovery();}catch(e){failure=e;}for(const client of sockets.clients)client.terminate();await new Promise<void>(done=>sockets.close(()=>done()));await new Promise<void>(done=>server.close(()=>done()));try{await vision.close();await registry.close();}catch(e){failure??=e;}if(failure)throw failure;})(),
  };
}
