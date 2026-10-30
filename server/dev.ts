import { spawn, type ChildProcess } from 'node:child_process';
import { watch, realpathSync, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
/** Local watcher asks the app to commit and exit over IPC before replacing it (including Windows). */
let child:ChildProcess|undefined,stopping=false,changed=false,restarting=false;const launchEnvironment={...process.env};
const watchers:FSWatcher[]=[];let debounce:ReturnType<typeof setTimeout>|undefined;
function start(){child=spawn(process.execPath,['--import','tsx','server/index.ts'],{stdio:['inherit','inherit','inherit','ipc'],env:launchEnvironment});child.on('message',value=>{if(value&&typeof value==='object'&&'type'in value&&value.type==='lumi:ready'){delete launchEnvironment.LUMI_NEW_WORLD;delete launchEnvironment.LUMI_CHECKPOINT;}process.send?.(value);});child.once('exit',()=>{child=undefined;if(stopping){process.exit();return;}if(changed){changed=false;start();}restarting=false;});}
async function stopChild(){const current=child;if(!current)return;await new Promise<void>(done=>{const timeout=setTimeout(()=>{console.error('Lumi did not finish its save within 5 seconds; terminating. Recovery will use the last committed checkpoint.');current.kill('SIGKILL');},5000);current.once('exit',()=>{clearTimeout(timeout);done();});if(current.connected)current.send({type:'lumi:shutdown'});else current.kill('SIGTERM');});}
function restart(){if(stopping)return;changed=true;if(restarting)return;restarting=true;void stopChild().then(()=>{if(!child&&changed){changed=false;start();}restarting=false;});}
// The first-person bundle is cached within each server process. These browser
// modules are also sensor dependencies, so HMR alone cannot refresh the eyes.
const sensorSourceFiles=new Set(['capture-renderer.ts','render-scene.ts','avatar.ts']);
const watched=process.env.LUMI_WATCH_PATH?[{directory:process.env.LUMI_WATCH_PATH,sensorOnly:false}]:[
 {directory:'server',sensorOnly:false},{directory:'shared',sensorOnly:false},{directory:'src',sensorOnly:true},
];
// Windows 8.3 short paths crash libuv's recursive watcher; use long-form paths.
for(const {directory,sensorOnly} of watched)watchers.push(watch(realpathSync.native(resolve(directory)),{recursive:true},(_event,filename)=>{
 if(sensorOnly&&filename!==null&&!sensorSourceFiles.has(filename.toString().replace(/\\/g,'/')))return;
 clearTimeout(debounce);debounce=setTimeout(restart,150);
}));
async function shutdown(){if(stopping)return;stopping=true;for(const watcher of watchers)watcher.close();clearTimeout(debounce);await stopChild();process.exit();}
for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>{void shutdown();});
process.on('message',message=>{if(message&&typeof message==='object'&&'type'in message){if(message.type==='lumi:shutdown')void shutdown();if(message.type==='lumi:restart')restart();}});
start();
