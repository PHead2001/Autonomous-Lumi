import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FlightRecorder} from '../server/diagnostics/recorder.js';
test('writer failures retain only sanitized operation stage and errno and remain incomplete after recovery',async()=>{for(const code of ['ENOSPC','EACCES']){const directory=await mkdtemp(join(tmpdir(),'lumi-writer-stage-'));let failed=true;const recorder=new FlightRecorder({directory,worldId:'failure',runId:'run',append:async()=>{if(failed)throw Object.assign(new Error('secret credential and private path'),{code});},limits:{flushIntervalMs:60000}});try{recorder.record({tick:0,category:'WORLD_TRUTH',eventType:'FAULT',component:'test',outcome:'declared'});await recorder.flush();assert.deepEqual(recorder.health().lastFailure,{stage:'append',code});assert.equal(recorder.health().status,'INCOMPLETE');assert.ok(!JSON.stringify(recorder.health()).includes('secret'));failed=false;recorder.record({tick:1,category:'WORLD_TRUTH',eventType:'RECOVERED',component:'test',outcome:'declared'});await recorder.flush();assert.equal(recorder.health().writerFailures,1);assert.equal(recorder.health().status,'INCOMPLETE');}finally{await recorder.close();await rm(directory,{recursive:true,force:true});}}});
