import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import { Simulation, hashCheckpoint, normalizeCommand, validateCheckpoint, type OrderedInput } from '../server/simulation.js';
import { SeededRandom } from '../server/prng.js';
import { canonicalStringify, hashCanonical } from '../server/canonical.js';
import { replay } from '../server/replay.js';
import { FixedScheduler } from '../server/scheduler.js';

test('seeded PRNG repeats and restored state continues; lint restricts simulation randomness only', async () => {
  const a = new SeededRandom(42), b = new SeededRandom(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const restored = new SeededRandom(a.seed, a.state); assert.equal(restored.next(), a.next());
  const lint = new ESLint();
  const forbidden = await lint.lintText('export const sample = Math.random();', { filePath: 'server/simulation.ts' });
  assert.ok(forbidden[0].messages.some(m => m.ruleId === 'no-restricted-properties'));
  const presentation = await lint.lintText('export const sample = Math.random();', { filePath: 'src/audio.ts' });
  assert.equal(presentation[0].errorCount, 0);
});
test('canonical hashes sort object keys and reject nonfinite values', () => {
  assert.equal(hashCanonical({b:2,a:[1,3]}),hashCanonical({a:[1,3],b:2}));
  assert.throws(() => canonicalStringify({bad:Infinity}));
});
test('restored mid-walk, mid-pause, post-slam and pending inputs preserve future state/events/IDs', () => {
  const scenarios = ['walk','pause','slam','pending'];
  for (const scenario of scenarios) {
    const a = new Simulation({seed:732}); for (let i = 0; i < 20; i++) a.step();
    a.random.next();
    if (scenario === 'pause') while (a.state.character.moving) a.step();
    if (scenario === 'slam' || scenario === 'pending') { a.enqueue({type:'slam'}); if (scenario === 'slam') a.step(); }
    const cp = a.checkpoint(), b = new Simulation({checkpoint:cp});
    assert.equal(b.random.next(),a.random.next());
    for (let i = 0; i < 150; i++) {
      if (i === 40 || i === 80) assert.deepEqual(a.enqueue({type:'slam'}),b.enqueue({type:'slam'}));
      assert.deepEqual(a.step(),b.step());
      assert.equal(hashCheckpoint(a.checkpoint()),hashCheckpoint(b.checkpoint()));
    }
  }
});
test('checkpoint validation rejects incompatible/corrupt data without silent reset', () => {
  const cp = new Simulation().checkpoint();
  for (const bad of [null,{}, {...cp,schemaVersion:2}, {...cp,tick:1.5}, {...cp,waypoint:8}, {...cp,prng:{algorithm:'unknown',state:1}}, {...cp,character:{...cp.character,x:Infinity}}, {...cp,unknown:'private'}, {...cp,nextSoundId:8}]) assert.throws(() => new Simulation({checkpoint:bad}));
  const pending = new Simulation(); pending.enqueue({type:'slam'}); const p = pending.checkpoint();
  assert.throws(() => validateCheckpoint({...p,pendingInputs:[{...p.pendingInputs[0],applyTick:0}]}));
});
test('replay receipt timing preserves queues, rejected inputs, counters and full hashes', () => {
  const world = new Simulation({seed:42}), cp = world.checkpoint(), inputs: OrderedInput[] = [];
  for (let tick = 0; tick < 100; tick++) {
    if ([0,1,30,40,85].includes(tick)) inputs.push(world.enqueue(tick === 40 ? normalizeCommand('{"type":"bad","token":"secret"}') : {type:'slam'}).input);
    world.step();
  }
  inputs.push(world.enqueue({type:'invalid',reason:'malformed_json'}).input);
  const result = replay(cp,inputs,100);
  assert.equal(result.stateHash,hashCheckpoint(world.checkpoint())); assert.equal(result.eventHash,world.checkpoint().eventHash);
  assert.equal(JSON.stringify(inputs).includes('secret'),false);
  assert.throws(() => replay(cp,inputs.filter((_,i)=>i!==2),100));
  assert.throws(() => replay(cp,[inputs[1],inputs[0]],100));
});
test('queue admission overflow is bounded and replayable', () => {
  const world = new Simulation(), cp = world.checkpoint(), inputs: OrderedInput[]=[];
  for(let i=0;i<270;i++) inputs.push(world.enqueue({type:'invalid',reason:'invalid_shape'}).input);
  assert.equal(world.checkpoint().pendingInputs.length,256); assert.equal(inputs[269].admission,'queue_full');
  world.step(); assert.equal(replay(cp,inputs,1).stateHash,hashCheckpoint(world.checkpoint()));
});
test('different scheduler chunking and viewer polling preserve deterministic results', () => {
  function run(chunks:number[]) {
    const world = new Simulation({seed:99}); let now=0;
    const clock = {monotonicMs:()=>now,utcMs:()=>100000+now}, scheduler = new FixedScheduler(()=>{
      if ([0,1,30,42,75].includes(world.state.tick)) world.enqueue(world.state.tick === 42 ? {type:'invalid',reason:'unknown_command'} : {type:'slam'});
      world.step();
    },()=>{},clock);
    for (const elapsed of chunks) { now+=elapsed; scheduler.pump(); world.snapshot(); }
    return world.checkpoint();
  }
  const fine=run(Array(300).fill(10)), jitter=run(Array(30).fill(100)); assert.equal(fine.tick,90); assert.equal(hashCheckpoint(fine),hashCheckpoint(jitter));
});
