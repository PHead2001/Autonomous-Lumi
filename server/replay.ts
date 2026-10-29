import { canonicalStringify } from './canonical.js';
import { Simulation, LabSimulation, VisionSimulation, SensorySimulation, CognitionSimulation, hashCheckpoint, validateCheckpoint, type OrderedInput, type DeterministicEvent } from './simulation.js';

/** Inputs enter at their recorded receipt tick, including no-ops and rejections. */
export function replay(checkpoint: unknown, inputs: OrderedInput[], endTick: number) {
  const start = validateCheckpoint(checkpoint), simulation = start.schemaVersion===5?new CognitionSimulation({checkpoint:start,mode:start.cognition.identity.mode,historical:true}):start.schemaVersion===4?new SensorySimulation({checkpoint:start,mode:'EXPERIMENT',historical:true}):start.schemaVersion===3?new VisionSimulation({checkpoint:start,mode:'EXPERIMENT',historical:true}):start.schemaVersion === 2 ? new LabSimulation({ checkpoint:start,mode:'EXPERIMENT' }) : new Simulation({ checkpoint: start });
  if (!Number.isSafeInteger(endTick) || endTick < start.tick || endTick - start.tick > 10_000_000) throw new Error('Invalid replay end tick');
  let cursor = 0, sequence = start.nextInputSequence, lastTick = start.tick;
  for (const input of inputs) {
    if (input.sequence !== sequence++ || !Number.isSafeInteger(input.receivedTick) || input.receivedTick < lastTick || input.receivedTick > endTick || input.applyTick !== input.receivedTick + 1) throw new Error('Invalid replay input order or missing input');
    lastTick = input.receivedTick;
  }
  const events: DeterministicEvent[] = [];
  while (true) {
    while (cursor < inputs.length && inputs[cursor].receivedTick === simulation.state.tick) {
      const expected = inputs[cursor++], actual = simulation.enqueue(expected.command);
      if (canonicalStringify(actual.input) !== canonicalStringify(expected)) throw new Error('Replay input admission mismatch');
      events.push(...actual.events);
    }
    if (simulation.state.tick === endTick) break;
    events.push(...simulation.step());
  }
  const end = simulation.checkpoint();
  return { checkpoint: end, stateHash: hashCheckpoint(end), eventHash: end.eventHash, events };
}
