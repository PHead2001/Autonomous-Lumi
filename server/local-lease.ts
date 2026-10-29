import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
/** OS-owned local lease: abrupt process death releases it without stale PID-file reclamation. */
export async function acquireLocalLease(directory:string):Promise<{directory:string;close():Promise<void>}>{await mkdir(resolve(directory),{recursive:true});const canonical=await realpath(resolve(directory)),key=createHash('sha256').update(process.platform==='win32'?canonical.toLowerCase():canonical).digest('hex');const server=createServer(socket=>socket.destroy());const address=process.platform==='win32'?{path:'\\\\.\\pipe\\lumi-history-'+key}:process.platform==='linux'?{path:'\0lumi-history-'+key}:{host:'127.0.0.1',port:18000+parseInt(key.slice(0,6),16)%40000,exclusive:true};
  await new Promise<void>((done,reject)=>{const fail=(error:Error)=>reject(new Error('Cannot acquire exclusive Lumi data ownership. Another local process owns this data directory (or the local lease endpoint is unavailable). Stop that process or choose a different LUMI_DATA_DIRECTORY. '+error.message));server.once('error',fail);server.listen(address,()=>{server.off('error',fail);done();});});let closed=false;return {directory:canonical,close:()=>new Promise<void>(done=>{if(closed){done();return;}closed=true;server.close(()=>done());})};}
