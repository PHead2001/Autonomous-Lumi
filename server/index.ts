import { createWorldServer } from './world-server.js';
import { readBoundedJson } from './checkpoint-storage.js';
import { RecoveryStore } from './recovery-store.js';
import { acquireLocalLease } from './local-lease.js';
import { validateNamedCheckpoint } from './branch-registry.js';
import { loadCognitionConfig } from './cognition/config.js';
let world:ReturnType<typeof createWorldServer>|undefined;
let lease:Awaited<ReturnType<typeof acquireLocalLease>>|undefined;
let stopping:Promise<void>|undefined;
const stop=()=>stopping??=(async()=>{try{await world?.close();process.exitCode=0;}catch(error){console.error(error);process.exitCode=1;}await lease?.close();process.exit(process.exitCode);})();
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void stop();});
process.on('message',message=>{if(message&&typeof message==='object'&&'type'in message&&message.type==='lumi:shutdown')void stop();});
try{
  lease=await acquireLocalLease(process.env.LUMI_DATA_DIRECTORY??'diagnostics/runs');const directory=lease.directory;
  let checkpoint=process.env.LUMI_CHECKPOINT?await readBoundedJson(process.env.LUMI_CHECKPOINT):undefined;
  if(checkpoint&&typeof checkpoint==='object'&&'kind'in checkpoint&&checkpoint.kind==='lumi-named-checkpoint'){
    const named=validateNamedCheckpoint(checkpoint,{worldId:'lumi',branchId:'live'});if(named.mode!=='LIVE')throw new Error('Explicit named import requires LIVE');checkpoint=named.runtime;
  }
  if(process.env.LUMI_NEW_WORLD!==undefined&&process.env.LUMI_NEW_WORLD!=='1')throw new Error('LUMI_NEW_WORLD must be exactly 1 or unset');
  const selected=await RecoveryStore.open({directory,checkpoint,newWorld:process.env.LUMI_NEW_WORLD==='1',intervalMs:process.env.LUMI_RECOVERY_INTERVAL_MS?Number(process.env.LUMI_RECOVERY_INTERVAL_MS):undefined});
  world=createWorldServer({checkpoint:selected.checkpoint,seed:process.env.LUMI_SEED?Number(process.env.LUMI_SEED):undefined,diagnosticsDirectory:directory,recoveryStore:selected.store,cognition:{config:loadCognitionConfig()}});
  const port=await world.listen(Number(process.env.PORT??3001));console.log(`Lumi's world: http://127.0.0.1:${port} (simulation runs with zero viewers)`);console.log('LIVE recovery: '+JSON.stringify(selected.store.status()));process.send?.({type:'lumi:ready',port,historyId:selected.store.historyId,runId:world.registry.live.target.runId});
}catch(error){console.error(error);await world?.close().catch(()=>{});await lease?.close();process.exitCode=1;if(process.connected)process.disconnect();}
