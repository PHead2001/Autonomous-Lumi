import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {publishDiagnosticFile,DIAGNOSTIC_RENAME_DELAYS_MS} from '../server/diagnostics/publish-file.js';
import {FlightRecorder} from '../server/diagnostics/recorder.js';

async function directory(){return mkdtemp(join(tmpdir(),'lumi-diagnostic-publish-'));}
test('transient metadata replacement is retried without dropping evidence or inventing a gap',async()=>{
  const root=await directory();let transient=1;const recorder=new FlightRecorder({directory:root,worldId:'publish',runId:'run',limits:{flushIntervalMs:60000},renameFile:async(from,to)=>{if(String(to).endsWith('run.json')&&transient-->0)throw Object.assign(new Error('private payload must not persist'),{code:'EPERM',syscall:'rename'});await rename(from,to);}});
  try{recorder.record({tick:0,category:'WORLD_TRUTH',eventType:'VALIDATED_ACTION',component:'test',outcome:'completed'});await recorder.flush();const health=recorder.health();assert.equal(health.writerRetries,1);assert.equal(health.writerRetryRecoveries,1);assert.equal(health.writerFailures,0);assert.equal(health.droppedRecords,0);assert.equal(health.status,'HEALTHY');const metadata=JSON.parse(await readFile(join(recorder.runDirectory,'run.json'),'utf8'));assert.equal(metadata.health.writerFailures,0);assert.equal(metadata.health.writerRetries,1);assert.ok(!JSON.stringify(health).includes('private'));}finally{await recorder.close();await rm(root,{recursive:true,force:true});}
});
test('exhausted metadata replacement preserves the old destination and reports a truthful sanitized gap',async()=>{
  const root=await directory();let refuse=false;const recorder=new FlightRecorder({directory:root,worldId:'publish',runId:'run',limits:{flushIntervalMs:60000},renameFile:async(from,to)=>{if(String(to).endsWith('run.json')&&refuse)throw Object.assign(new Error('secret and private path'),{code:'EPERM',syscall:'rename'});await rename(from,to);}});
  try{recorder.record({tick:0,category:'WORLD_TRUTH',eventType:'BEFORE',component:'test',outcome:'completed'});await recorder.flush();const target=join(recorder.runDirectory,'run.json'),old=await readFile(target,'utf8');refuse=true;recorder.record({tick:1,category:'WORLD_TRUTH',eventType:'DURING',component:'test',outcome:'completed'});await recorder.flush();assert.equal(await readFile(target,'utf8'),old);assert.equal(recorder.health().writerRetries,DIAGNOSTIC_RENAME_DELAYS_MS.length);assert.equal(recorder.health().writerFailures,1);assert.equal(recorder.health().droppedRecords,0);assert.deepEqual(recorder.health().lastFailure,{stage:'metadata',code:'EPERM',syscall:'rename',fileRole:'metadata'});assert.ok(recorder.health().gaps.includes('writer_failure'));refuse=false;await recorder.flush();assert.equal(recorder.health().writerFailures,1);assert.equal(recorder.health().status,'INCOMPLETE');assert.ok(!JSON.stringify(recorder.health()).includes('secret'));}finally{refuse=false;await recorder.close();await rm(root,{recursive:true,force:true});}
});
test('nontransient rename errors are not retried or converted into success',async()=>{for(const code of ['EACCES','ENOSPC']){let attempts=0;await assert.rejects(publishDiagnosticFile('unused-source','unused-target',{renameFile:async()=>{attempts++;throw Object.assign(new Error('declared failure'),{code});}}),{code});assert.equal(attempts,1);}});

/** An external Windows reader with no delete-sharing reproduces the actual
 * failure class (EPERM/rename), not the unidentified holder in browser run A. */
async function windowsReadLock(target:string,root:string){
  const flag=join(root,'release-lock'),quote=(text:string)=>"'"+text.replace(/'/g,"''")+"'";
  const script=`$stream=[System.IO.File]::Open(${quote(target)},[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read);try{[Console]::WriteLine('LOCKED');while(-not(Test-Path -LiteralPath ${quote(flag)})){Start-Sleep -Milliseconds 10}}finally{$stream.Dispose()}`;
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe']}),ended=once(child,'exit');
  let output='';await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Windows lock fixture did not start')),10000);child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('LOCKED')){clearTimeout(timer);resolve();}});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{if(!output.includes('LOCKED')){clearTimeout(timer);reject(new Error('Windows lock fixture exited before locking'));}});}).catch(error=>{child.kill();throw error;});
  return async()=>{await writeFile(flag,'release','utf8');await ended;};
}
test('real Windows locked destination yields EPERM rename, recovers atomically after release, and preserves bytes on exhaustion',{skip:process.platform!=='win32'},async()=>{
  const root=await directory(),target=join(root,'run.json'),temporary=target+'.tmp';let release:(()=>Promise<void>)|undefined;
  try{await writeFile(target,'{"generation":1}','utf8');await writeFile(temporary,'{"generation":2}','utf8');release=await windowsReadLock(target,root);let failure:NodeJS.ErrnoException|undefined;const retries=await publishDiagnosticFile(temporary,target,{onRetry:async error=>{failure=error;assert.equal(await readFile(target,'utf8'),'{"generation":1}');await release!();release=undefined;}});assert.equal(failure?.code,'EPERM');assert.equal(failure?.syscall,'rename');assert.equal(retries,1);assert.equal(await readFile(target,'utf8'),'{"generation":2}');
    await rm(join(root,'release-lock'));await writeFile(temporary,'{"generation":3}','utf8');release=await windowsReadLock(target,root);let attempts=0;await assert.rejects(publishDiagnosticFile(temporary,target,{onRetry:()=>{attempts++;}}),{code:'EPERM',syscall:'rename'});assert.equal(attempts,DIAGNOSTIC_RENAME_DELAYS_MS.length);assert.equal(await readFile(target,'utf8'),'{"generation":2}');assert.equal(await readFile(temporary,'utf8'),'{"generation":3}');
  }finally{await release?.();await rm(root,{recursive:true,force:true});}
});
