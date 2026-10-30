import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createWorldServer } from '../world-server.js';
import { validateRuntimeCheckpoint } from '../branch-runtime.js';
import { atomicJson } from '../checkpoint-storage.js';
import type { NamedCheckpoint } from '../branch-registry.js';
import type { ActiveTarget } from '../../shared/lab-protocol.js';
import type { AttentionState } from '../../shared/attention-protocol.js';
import { createVisibilityFixture } from '../../shared/vision-fixture.js';
import { captureResultDeadlineMs } from '../../shared/capture-protocol.js';

interface DemoArguments { port: number; run: boolean }
export function parseDemoArguments(args: string[]): DemoArguments {
  let port = 0, run = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run' && !run) run = true;
    else if (args[i] === '--port' && /^\d+$/.test(args[i + 1] ?? '')) {
      port = Number(args[++i]);
      if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Demo port must be an integer from 0 through 65535');
    } else throw new Error('Usage: npx tsx server/vision/attention-demo.ts [--port 0] [--run]');
  }
  return { port, run };
}

/** Creates a fresh, preserved demo namespace. It never reads owner LIVE recovery data.
 * The only crafted state is an explicitly labelled experimental fixture checkpoint. */
export async function startAttentionDemo(port = 0) {
  const base = resolve('diagnostics/phase2b-demo');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'run-'));
  const world = createWorldServer({ seed: 2002, diagnosticsDirectory: directory });
  try {
    const listeningPort = await world.listen(port);
    const checkpoint = world.registry.live.checkpoint();
    if (checkpoint.simulation.schemaVersion !== 5 && checkpoint.simulation.schemaVersion !== 6 && checkpoint.simulation.schemaVersion !== 7) throw new Error('Attention demo requires the current cognition schema');
    const visual = createVisibilityFixture(), simulation = checkpoint.simulation;
    checkpoint.mode = 'EXPERIMENT'; checkpoint.control.paused = true; checkpoint.control.speed = 1; checkpoint.control.fastForwardRemaining = 0;
    if ((simulation.schemaVersion === 5 || simulation.schemaVersion === 6 || simulation.schemaVersion === 7)) simulation.cognition.identity.mode = 'EXPERIMENT';
    checkpoint.scheduler.backlogMs = 0; checkpoint.scheduler.config.maxStepsPerPump = 48; checkpoint.scheduler.config.maxBacklogSteps = 96;
    simulation.character = visual.character; simulation.head = visual.head!; simulation.scene = visual.scene!;
    simulation.pauseUntilTick = simulation.tick + 100000;
    const fixture: NamedCheckpoint = {
      schemaVersion: 1, kind: 'lumi-named-checkpoint', worldId: 'lumi', branchId: 'attention-seed',
      historyId: world.registry.historyId, mode: 'EXPERIMENT', createdAt: new Date().toISOString(), runtime: validateRuntimeCheckpoint(checkpoint),
    };
    await atomicJson(join(directory, 'lumi', 'attention-seed', 'checkpoints', 'attention-fixture.json'), fixture, true, directory);
    const experiment = await world.registry.reopen({ worldId: 'lumi', branchId: 'attention-seed' }, 'attention-fixture', 'attention-demo');
    experiment.applyControl({ type: 'activity-start', totalTicks: 600 });
    experiment.recorder?.record({ tick: simulation.tick, category: 'OPERATIONAL_REPLAY', eventType: 'DEMO_FIXTURE', component: 'attention_demo', outcome: 'isolated_test_setup', data: { provenance: 'TEST STUB', reason: 'stationary_experiment_body_for_reproducible_hearing', speed: 1, paused: true } });
    await world.registry.checkpoint(experiment.target);
    const origin = `http://127.0.0.1:${listeningPort}`;
    const manifest = { origin, directory, target: experiment.target, initialTick: experiment.simulation.state.tick, dashboard: `${origin}/?view=dashboard`, viewer: `${origin}/?worldId=lumi&branchId=attention-demo`, provenance: 'TEST STUB', shutdown: 'Type stop and Enter in this process, press Ctrl+C, or send IPC {type:lumi:shutdown}.' };
    await writeFile(join(directory, 'demo-session.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    return { world, directory, origin, experiment, manifest };
  } catch (error) { await world.close().catch(() => {}); throw error; }
}

/** Optional zero-viewer setup uses the same private HTTP controls as the dashboard.
 * Export remains a normal dashboard action, so this helper does not invent an artifact. */
export async function runAttentionScenario(demo: Awaited<ReturnType<typeof startAttentionDemo>>) {
  const { world, origin, experiment } = demo, target = experiment.target;
  if (world.sockets.clients.size) throw new Error('Start --run with zero spectator WebSockets; inspect the dashboard after the scenario is ready');
  const post = async <T>(path: string, data: Record<string, unknown>): Promise<T> => {
    const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, ...data }) });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error ?? `Demo operation failed (${response.status})`);
    return result;
  };
  const sound = { type: 'emit_sound', x: 1.2, y: 2.4, z: 0, intensity: 1, suddenness: 1 };
  // Identical perceptible features, different private IDs: the second cue demonstrates
  // bounded repeated-cue suppression without creating another investigation.
  await post('/api/sound', { action: { ...sound, sourceId: 'demo-source-A' } });
  await post('/api/sound', { action: { ...sound, sourceId: 'demo-source-B' } });
  await post('/api/control', { action: { type: 'resume' } });
  const deadline = performance.now() + captureResultDeadlineMs();
  let attention: AttentionState | null = null;
  while (performance.now() < deadline) {
    const response = await fetch(`${origin}/api/attention?${new URLSearchParams(target as ActiveTarget & Record<string, string>)}`);
    if (!response.ok) throw new Error(`Demo attention query failed (${response.status})`);
    attention = (await response.json() as { attention: AttentionState | null }).attention;
    if (attention?.lastCapture) break;
    await new Promise<void>(done => setTimeout(done, 250));
  }
  await post('/api/control', { action: { type: 'pause' } });
  await post('/api/checkpoint', {});
  const result = attention?.lastCapture;
  if (!result || result.outcome !== 'success' || result.freshness !== 'applicable' || !attention?.baseline || world.sockets.clients.size) throw new Error(`Actual zero-viewer scenario did not finish with applicable evidence: ${JSON.stringify(result ?? null)}`);
  const events = await world.registry.active(target).recorder!.snapshotForExport();
  const types = new Set(events.records.map(event => event.event_type));
  for (const required of ['ACOUSTIC_EVENT', 'SOUND_RECEIVED', 'REFLEX_STATE', 'ATTENTION_ACTION', 'HEAD_ACTION_COMPLETE', 'CAPTURE_COMPLETE', 'CAPTURE_FEEDBACK']) if (!types.has(required)) throw new Error(`Scenario is missing ${required} evidence`);
  const report = { ...target, zeroViewers: true, captureId: result.captureId, capturedTick: result.capturedTick, receivedTick: result.receivedTick, frameHash: attention.baseline.frameHash, freshness: result.freshness, reasons: result.reasons, finalTick: experiment.simulation.state.tick, worldTime: experiment.simulation.state.time, experienceCount: experiment.simulation.checkpoint().experiences.length, export: 'Select attention-demo in the dashboard, clear timeline filters, and press Export diagnostic ZIP.' };
  await writeFile(join(demo.directory, 'scenario-result.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  return report;
}

async function main() {
  const args = parseDemoArguments(process.argv.slice(2)), demo = await startAttentionDemo(args.port);
  const input = createInterface({ input: process.stdin, terminal: false });
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => { input.close(); await demo.world.close(); })();
  const shutdown = () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); };
  input.on('line', line => { if (line.trim() === 'stop') shutdown(); });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, shutdown);
  process.on('message', message => { if (message && typeof message === 'object' && 'type' in message && message.type === 'lumi:shutdown') shutdown(); });
  try {
    console.log('ATTENTION_DEMO_READY ' + JSON.stringify(demo.manifest));
    if (args.run) console.log('ATTENTION_SCENARIO_READY ' + JSON.stringify(await runAttentionScenario(demo)));
    console.log('Keep this process running for the dashboard/frame/export walkthrough. Type stop and Enter to close it; all demo evidence is preserved.');
  } catch (error) { await stop(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main().catch(error => { console.error(error); process.exitCode = 1; });
