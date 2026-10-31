import {rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

/** Windows can transiently refuse replacing an open destination. Never remove
 * that destination: keep the last complete file and retry the same closed temp.
 * These asynchronous waits hold only the branch's diagnostic storage lock. */
export const DIAGNOSTIC_RENAME_DELAYS_MS=[10,25,50,100] as const;
export async function publishDiagnosticFile(temporary:string,target:string,options:{
  validate?:()=>Promise<void>;renameFile?:typeof rename;
  onRetry?:(error:NodeJS.ErrnoException,retry:number)=>void|Promise<void>;
}={}):Promise<number> {
  let retries=0;
  for(;;){
    await options.validate?.();
    try{await (options.renameFile??rename)(temporary,target);return retries;}
    catch(error){
      const failure=error as NodeJS.ErrnoException;
      if(!['EPERM','EBUSY'].includes(failure.code??'')||retries>=DIAGNOSTIC_RENAME_DELAYS_MS.length)throw error;
      await options.onRetry?.(failure,++retries);
      await delay(DIAGNOSTIC_RENAME_DELAYS_MS[retries-1]);
    }
  }
}
