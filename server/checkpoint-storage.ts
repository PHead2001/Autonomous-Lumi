import { open, mkdir, rename, unlink, link, stat, readFile, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, sep, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_CHECKPOINT_BYTES = 2 * 1024 * 1024;
/** Flush a complete sibling file before publishing it. Exclusive publication never replaces a named save. */
export async function assertOwnedPath(root:string,path:string):Promise<void>{const base=resolve(root),target=resolve(path),suffix=relative(base,target);if(suffix.startsWith('..'+sep)||suffix==='..'||isAbsolute(suffix))throw new Error('Storage path escapes owned data directory');const canonicalBase=await realpath(base);let current=base;for(const component of suffix.split(sep).filter(Boolean)){current=join(current,component);try{if((await lstat(current)).isSymbolicLink())throw new Error('Linked storage path components are not accepted');const canonical=await realpath(current),inside=relative(canonicalBase,canonical);if(inside==='..'||inside.startsWith('..'+sep)||isAbsolute(inside))throw new Error('Storage path escapes canonical data directory');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')break;throw error;}}}
export async function atomicJson(path:string,value:unknown,exclusive=false,ownedRoot?:string):Promise<void>{
  const data=JSON.stringify(value,null,2);if(Buffer.byteLength(data)>MAX_CHECKPOINT_BYTES)throw new Error('Checkpoint exceeds 2 MiB bound');
  if(ownedRoot){await mkdir(ownedRoot,{recursive:true});await assertOwnedPath(ownedRoot,path);}await mkdir(dirname(path),{recursive:true});if(ownedRoot)await assertOwnedPath(ownedRoot,path);const temporary=path+'.'+randomUUID()+'.tmp';
  try{const file=await open(temporary,'wx');try{await file.writeFile(data,'utf8');await file.sync();}finally{await file.close();}
    if(exclusive){await link(temporary,path);await unlink(temporary);}else await rename(temporary,path);
  }finally{await unlink(temporary).catch(()=>{});}
}
export async function readBoundedJson(path:string,ownedRoot?:string):Promise<unknown>{if(ownedRoot)await assertOwnedPath(ownedRoot,path);const info=await stat(path);if(!info.isFile()||info.size<2||info.size>MAX_CHECKPOINT_BYTES)throw new Error('Checkpoint size/type is invalid (maximum 2 MiB)');return JSON.parse(await readFile(path,'utf8'));}
