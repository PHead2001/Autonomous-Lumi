import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { FlightRecorder, readRun } from '../server/diagnostics/recorder.js';
import { Simulation } from '../server/simulation.js';

test('same-branch concurrent publication, retention scans, readers and compression preserve complete evidence',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'lumi-recorder-concurrency-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const recorders=Array.from({length:8},(_,index)=>new FlightRecorder({directory,worldId:'world',branchId:'branch',worldMode:'EXPERIMENT',runId:'run-'+index,compressClosed:true,limits:{flushIntervalMs:60000,retainedRuns:16}}));
  try{
    for(const recorder of recorders)recorder.captureCheckpoint(new Simulation().checkpoint());
    await Promise.all(recorders.map(recorder=>recorder.prepare()));
    await Promise.all(recorders.map(async(recorder,index)=>{
      for(let cursor=0;cursor<20;cursor++){
        await delay(index%3+1);
        recorder.record({tick:0,category:'OPERATIONAL_REPLAY',eventType:'CONCURRENT_STORAGE_FIXTURE',component:'fixture',outcome:'recorded',data:{count:cursor}});
        await recorder.flush();
        const current=await readRun(recorder.runDirectory);assert.equal(current.records.length,cursor+1);
      }
      // Fast writers retire/compress while their siblings are still publishing.
      await recorder.close();
    }));
    for(const recorder of recorders){const health=recorder.health();assert.equal(health.writerFailures,0);assert.equal(health.droppedRecords,0);assert.equal(health.globalAccountingComplete,true);assert.equal(health.status,'HEALTHY');
      const run=await readRun(recorder.runDirectory);assert.deepEqual(run.records.map(record=>record.data.count),Array.from({length:20},(_,i)=>i));assert.equal(run.metadata.lastRecorderSequence,20);assert.deepEqual(run.readGaps,[]);assert.ok((await readdir(recorder.runDirectory)).some(file=>file.endsWith('.jsonl.gz')));
    }
  }finally{await Promise.all(recorders.map(recorder=>recorder.close()));}
});
