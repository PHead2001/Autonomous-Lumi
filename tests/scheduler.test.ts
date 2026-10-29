import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FixedScheduler,type SchedulerDiagnostic} from '../server/scheduler.js';
import {Simulation} from '../server/simulation.js';
test('short jitter caps whole steps and bounded backlog reports discarded catchup',()=>{
  let now=0,count=0; const events:SchedulerDiagnostic[]=[];
  const scheduler=new FixedScheduler(()=>count++,e=>events.push(e),{monotonicMs:()=>now,utcMs:()=>now},{maxStepsPerPump:3,maxBacklogSteps:5});
  now=400; assert.equal(scheduler.pump(),3); assert.equal(count,3); assert.ok(scheduler.backlogMs<=2*1000/30+1e-6);
  assert.equal(events[0].type,'CATCHUP_SKIPPED'); assert.equal(scheduler.pump(),2); assert.equal(count,5);
});
test('multi-hour host suspend freezes world across gap, exposes downtime and resumes fixed ticks',()=>{
  let mono=0,utc=0; const events:SchedulerDiagnostic[]=[]; const world=new Simulation();
  const scheduler=new FixedScheduler(()=>world.step(),e=>events.push(e),{monotonicMs:()=>mono,utcMs:()=>utc});
  mono=utc=100; scheduler.pump(); const before=world.checkpoint();
  mono+=8*3600000; utc+=8*3600000; assert.equal(scheduler.pump(),0); assert.equal(world.state.tick,before.tick);
  assert.deepEqual(events.map(e=>e.type),['HOST_SUSPEND','HOST_RESUME']); assert.equal(events[0].data.wallDowntimeMs,8*3600000);
  mono+=100;utc+=100;scheduler.pump(); assert.equal(world.state.tick,before.tick+3); assert.equal(world.state.time,(before.tick+3)/30);
});
test('wall-only sleep gap is detected and observer errors do not change stepping',()=>{
  let mono=0,utc=0,count=0;const scheduler=new FixedScheduler(()=>count++,()=>{throw new Error('writer failed');},{monotonicMs:()=>mono,utcMs:()=>utc});
  utc=3600000;assert.equal(scheduler.pump(),0);mono+=100;utc+=100;assert.equal(scheduler.pump(),3);assert.equal(count,3);
});
