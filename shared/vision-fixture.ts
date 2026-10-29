import type { WorldState } from './protocol.js';
import { defaultPhysicalSceneState } from './physical-scene.js';
import { defaultHeadState } from './vision-protocol.js';

/** Small fixed renderer/grounding fixture. It does not mutate or restore any running world. */
export function createVisibilityFixture(): WorldState {
  return {
    worldId: 'visual-fixture', branchId: 'fixture', runId: 'fixture-run', mode: 'EXPERIMENT', tick: 300, time: 10,
    character: { x: 0, z: -2, heading: 0, moving: false, gait: 0 },
    reflex: { start: -100, strength: 0, duration: 0.8 }, door: { lastSlam: -100, slamCount: 0 },
    head: defaultHeadState(), scene: { ...defaultPhysicalSceneState(), fixture: 'visibility' },
  };
}
