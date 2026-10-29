import { mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { createWorldServer } from '../world-server.js';
import { exportIncident, replayBundle } from './bundle.js';

function options(args: string[]) {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || !args[i+1] || args[i+1].startsWith('--')) throw new Error('Options require --name value pairs');
    values[args[i].slice(2)] = args[i+1];
  }
  return values;
}
function tick(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Tick/input selector must be a nonnegative integer');
  return Number(value);
}
async function selectRun(directory: string, run?: string) {
  if (run) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(run)) throw new Error('Invalid run selector');
    return join(directory,run);
  }
  const candidates = await Promise.all((await readdir(directory, { withFileTypes:true })).filter(e => e.isDirectory()).map(async entry => ({ path: join(directory,entry.name), time: (await stat(join(directory,entry.name))).mtimeMs })));
  candidates.sort((a,b) => b.time-a.time);
  if (!candidates[0]) throw new Error('No diagnostic runs found');
  return candidates[0].path;
}
async function main() {
  const [command, ...args] = process.argv.slice(2), values = options(args);
  const allowed = command === 'replay' ? ['bundle'] : command === 'incident' ? ['out','directory'] : ['out','directory','world','branch','run','from-tick','to-tick','incident','category','component','severity','causal-id','event-type','search'];
  if (Object.keys(values).some(key => !allowed.includes(key))) throw new Error('Unknown command option');
  if (command === 'replay') { if (!values.bundle) throw new Error('Use replay --bundle <incident.zip>'); console.log(JSON.stringify(await replayBundle(values.bundle),null,2)); return; }
  if (!['export','incident'].includes(command)) throw new Error('Use export, incident, or replay');
  const output = resolve(values.out ?? 'diagnostics/incident.zip'); await mkdir(dirname(output), {recursive:true});
  const directory = values.directory ?? 'diagnostics/runs';
  let runDirectory: string;
  if (command === 'incident') {
    const app = createWorldServer({ seed: 20261028, diagnosticsDirectory: directory });
    try {
      const port = await app.listen(0), socket = new WebSocket(`ws://127.0.0.1:${port}/world`);
      await once(socket,'open');
      const sound = new Promise<void>((resolveSound,reject) => {
        const timeout = setTimeout(() => reject(new Error('Slam sound event was not received')),3000);
        socket.on('message', data => { if (JSON.parse(data.toString()).type === 'sound') {clearTimeout(timeout); resolveSound();} });
      });
      socket.send(JSON.stringify({type:'slam'}));
      // Deliberately sensitive unknown fields prove they are discarded at admission, never exported.
      socket.send(JSON.stringify({type:'invalid-command',token:'sensitive-fixture-value',message:'private-fixture-text'}));
      await sound; await delay(100); socket.close(); await once(socket,'close');
    } finally { await app.close(); }
    runDirectory = app.recorder.runDirectory;
  } else {
    if(values.world!==undefined||values.branch!==undefined){if(!values.world||!values.branch||![values.world,values.branch].every(value=>/^[A-Za-z0-9_-]{1,100}$/.test(value)))throw new Error('Scoped export requires valid --world and --branch');runDirectory=await selectRun(join(directory,values.world,values.branch,'runs'),values.run);}
    else runDirectory = await selectRun(directory,values.run);
  }
  const result = await exportIncident({ runDirectory, out:output, fromTick:tick(values['from-tick']),toTick:tick(values['to-tick']),incident:tick(values.incident),
    ...(values.world&&values.branch?{expectedWorldId:values.world,expectedBranchId:values.branch,expectedRunId:values.run??runDirectory.split(/[\\/]/).at(-1)}:{}),category:values.category,component:values.component,severity:values.severity,causalId:values['causal-id'],eventType:values['event-type'],search:values.search });
  console.log(JSON.stringify({ out:result.out, status:result.manifest.evidence_status, run:result.manifest.run_id, hashes:result.manifest.hashes, assertions:result.assertions },null,2));
  if (result.manifest.evidence_status !== 'COMPLETE') process.exitCode=2;
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Diagnostic command failed'); process.exitCode=1; });
