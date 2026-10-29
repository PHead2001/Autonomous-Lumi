import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { LabSimulation, hashCheckpoint } from '../simulation.js';
import { FlightRecorder, type LoggingMode } from './recorder.js';

const MODES:LoggingMode[]=['off','default','verbose'];
const SCALES=[{name:'1x',scale:1},{name:'6x',scale:6},{name:'stress-30x',scale:30}];
function percentile(values:number[],p:number){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))]??0;}
async function diskBytes(path:string):Promise<number>{let bytes=0;for(const entry of await readdir(path,{withFileTypes:true})){if(entry.isFile())bytes+=(await stat(join(path,entry.name))).size;}return bytes;}
function argumentsFor(args:string[]){let durationMs=2000,out='diagnostics/benchmarks';for(let i=0;i<args.length;i+=2){if(args[i]==='--duration-ms')durationMs=Number(args[i+1]);else if(args[i]==='--out')out=args[i+1];else throw new Error('Use --duration-ms N and --out directory');}if(!Number.isInteger(durationMs)||durationMs<500||durationMs>5000||!out)throw new Error('Benchmark duration must be 500–5000 ms per cell');return{durationMs,out:resolve(out)};}
async function main(){
  const options=argumentsFor(process.argv.slice(2));await mkdir(options.out,{recursive:true});
  const stamp=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,17),directory=join(options.out,stamp);await mkdir(directory,{recursive:true});
  const cells=[];const comparisonTick=Math.max(5,Math.floor(options.durationMs/1000*30)-2);
  for(const pace of SCALES)for(const mode of MODES){
    const simulation=new LabSimulation({seed:20261028,mode:'EXPERIMENT'});
    const recorder=new FlightRecorder({directory:join(directory,'runs'),worldId:'benchmark-world',branchId:`${pace.name}-${mode}`,worldMode:'EXPERIMENT',runId:`run-${stamp}`,loggingMode:mode});
    recorder.captureCheckpoint(simulation.checkpoint());
    const latencies:number[]=[],memoryBefore=process.memoryUsage(),cpuBefore=process.cpuUsage(),start=performance.now();
    let maxSchedulerBacklog=0,maxWriterRecords=0,maxWriterBytes=0,comparisonHash='',comparisonEventHash='';
    const expectedTicks=Math.floor(options.durationMs/1000*30*pace.scale);
    while(simulation.state.tick<expectedTicks){
      const due=Math.min(expectedTicks,Math.floor((performance.now()-start)/1000*30*pace.scale));
      maxSchedulerBacklog=Math.max(maxSchedulerBacklog,due-simulation.state.tick);
      const count=Math.min(32,Math.max(0,due-simulation.state.tick));
      for(let i=0;i<count;i++){
        const tick=simulation.state.tick;
        // Identical tick-indexed fixture across every scale and logging mode.
        if(tick%90===0||tick===3){const received=simulation.enqueue(tick===3?{type:'invalid',reason:'unknown_command'}:{type:'slam'});recorder.recordInput(received.input);received.events.forEach(event=>recorder.recordEvent(event));}
        if(tick===0)simulation.applyAction({type:'activity-start',totalTicks:120}).forEach(event=>recorder.recordEvent(event));
        if(tick===2||tick===4)simulation.applyAction({type:'synthetic-cue',sensed:true,attended:tick===4,encoded:true}).forEach(event=>recorder.recordEvent(event));
        if(tick===5)simulation.applyAction({type:'synthetic-clock',sensed:true,attended:true,encoded:true,observedSeconds:10,uncertaintySeconds:1}).forEach(event=>recorder.recordEvent(event));
        if(tick===15)simulation.applyAction({type:'activity-pause'}).forEach(event=>recorder.recordEvent(event));
        if(tick===20)simulation.applyAction({type:'activity-resume'}).forEach(event=>recorder.recordEvent(event));
        const before=performance.now();simulation.step().forEach(event=>recorder.recordEvent(event));recorder.recordVerboseTick(simulation.state.tick,{count:simulation.state.tick});latencies.push(performance.now()-before);
        if(simulation.state.tick===comparisonTick){const checkpoint=simulation.checkpoint();comparisonHash=hashCheckpoint(checkpoint);comparisonEventHash=checkpoint.eventHash;}
      }
      const health=recorder.health();maxWriterRecords=Math.max(maxWriterRecords,health.queuedRecords+health.inFlightRecords);maxWriterBytes=Math.max(maxWriterBytes,health.queuedBytes+health.inFlightBytes);
      await delay(1);
    }
    const schedulingDurationMs=performance.now()-start;recorder.captureCheckpoint(simulation.checkpoint());await recorder.close();
    const totalDurationMs=performance.now()-start,cpu=process.cpuUsage(cpuBefore),memoryAfter=process.memoryUsage(),health=recorder.health();
    cells.push({pace:pace.name,requestedScale:pace.scale,loggingMode:mode,durationMs:totalDurationMs,schedulingDurationMs,tickSamples:latencies.length,
      achievedTicksPerSecond:latencies.length/(schedulingDurationMs/1000),achievedWorldSecondsPerRealSecond:latencies.length/30/(schedulingDurationMs/1000),
      tickLatencyMs:{p50:percentile(latencies,.5),p95:percentile(latencies,.95)},maxSchedulerBacklogTicks:maxSchedulerBacklog,maxWriterBacklogRecords:maxWriterRecords,maxWriterBacklogBytes:maxWriterBytes,
      cpuMs:{user:cpu.user/1000,system:cpu.system/1000,total:(cpu.user+cpu.system)/1000},memoryBytes:{rssBefore:memoryBefore.rss,rssAfter:memoryAfter.rss,heapUsedBefore:memoryBefore.heapUsed,heapUsedAfter:memoryAfter.heapUsed},
      diskBytes:await diskBytes(recorder.runDirectory),health,comparison:{tick:comparisonTick,stateHash:comparisonHash,eventHash:comparisonEventHash}});
  }
  const baseline=cells[0].comparison;const deterministic=cells.every(cell=>cell.comparison.stateHash===baseline.stateHash&&cell.comparison.eventHash===baseline.eventHash);
  const report={schemaVersion:1,createdUtc:new Date().toISOString(),fixture:{seed:20261028,fixedHz:30,comparisonTick,commands:'slam every90ticks; rejected unknown command at tick3; activity start tick0/pause15/resume20; ineligible cue2/eligiblecue4/eligible clock5',boundedStepsPerYield:32,durationMsPerCell:options.durationMs},
    environment:{node:process.version,platform:platform(),release:release(),cpu:cpus()[0]?.model,cpuCount:cpus().length,totalMemoryBytes:totalmem()},
    method:'Real-time bounded harness pacer executes existing whole fixed steps. Requested scale is pacing intent; achieved rates are measured. Host-suspend correctness is tested elsewhere, not inferred from this benchmark.',
    modeDefinitions:{off:'No semantic, ordered-input or deterministic-event records. Checkpoints/health remain available and evidence is INCOMPLETE.',default:'Semantic transition/input/event records with bounded async writer; no per-tick trace.',verbose:'Default records plus one optional debug TICK_TRACE per fixed step.'},
    deterministicOutcomesMatch:deterministic,limitations:['Short single-process sequential cells; no warm/cold randomization or isolated CPU.','Tick p95 at1x has a small sample; memory values are endpoints, not peaks.','CPU includes asynchronous writing and final flush; tick latency measures step plus semantic enqueue, not total host scheduling latency.','Logging-disabled evidence is explicitly INCOMPLETE; exporter cannot certify it.','Pacer uses measured real time and bounded32step yields; this is not a long soak, full production load or scheduler-suspend benchmark.'],cells};
  const rows=cells.map(c=>`| ${c.pace} | ${c.loggingMode} | ${c.durationMs.toFixed(0)} | ${c.tickSamples} | ${c.achievedTicksPerSecond.toFixed(1)} | ${c.tickLatencyMs.p50.toFixed(4)} / ${c.tickLatencyMs.p95.toFixed(4)} | ${c.maxSchedulerBacklogTicks} | ${c.maxWriterBacklogRecords} | ${c.cpuMs.total.toFixed(1)} | ${c.diskBytes} | ${c.health.droppedRecords} | ${c.health.status} |`).join('\n');
  const summary=`# Bounded logging benchmark\n\nDeterministic state/event hashes at tick ${comparisonTick}: **${deterministic?'MATCH':'MISMATCH'}** across all cells. Seed20261028, same tick-indexed fixture.\n\n| Pace | Logging | Actual ms | Ticks | Actual ticks/s | Tick p50 / p95 ms | Max scheduler backlog ticks | Max writer records | CPU ms | Disk bytes | Drops | Evidence |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|\n${rows}\n\n${report.limitations.map(value=>'- '+value).join('\n')}\n\nSee benchmark.json for memory endpoints, achieved world/real rates, complete health and environment metadata. Commands: npm.cmd run diagnostics:benchmark -- --duration-ms ${options.durationMs} --out diagnostics/benchmarks\n`;
  await writeFile(join(directory,'benchmark.json'),JSON.stringify(report,null,2));await writeFile(join(directory,'SUMMARY.md'),summary);console.log(summary);console.log(`Results: ${directory}`);
  if(!deterministic)process.exitCode=1;
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Benchmark failed');process.exitCode=1;});
