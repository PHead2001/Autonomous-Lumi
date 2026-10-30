import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { VisitSimulation, hashCheckpoint } from '../server/simulation.js';
import { BranchRuntime } from '../server/branch-runtime.js';
import { ChromiumRenderer } from '../server/vision/renderer.js';
import { CaptureManager } from '../server/vision/capture-manager.js';
import { groundSnapshot } from '../server/vision/grounding.js';
import type { PixelGroundingResult } from '../server/vision/pixel-qualification.js';
import { VISITOR_HELD_PHYSICAL_ID, VISITOR_PHYSICAL_PREFIX } from '../shared/visit-protocol.js';

test('actual visitor and owned held item require visible RGB, remain occluded behind a closed home geometry, and use the captured pose', async () => {
  const directory = resolve('diagnostics/visit-perception'); await mkdir(directory, { recursive: true });
  const fixture = new VisitSimulation({ mode: 'EXPERIMENT', runId: 'perception-fixture', physiology: { active: false } });
  fixture.enqueue({ type: 'visit_start', runId: 'perception-fixture', generation: 1 }); fixture.step();
  const purchaseFixture = fixture.checkpoint(); purchaseFixture.visit.actor!.x = 2.97; purchaseFixture.visit.actor!.z = -10.8;
  const purchaser = new VisitSimulation({ checkpoint: purchaseFixture, mode: 'EXPERIMENT', historical: true });
  purchaser.enqueue({ type: 'visit_interact', runId: 'perception-fixture', generation: 1, sequence: 1, actionId: 1, action: 'purchase', door: null, good: 'fruit' }); purchaser.step();
  assert.equal(purchaser.visitState().actor!.heldItemId, 1);
  // Explicit disposable pose fixtures isolate perception; these are not a walk or an encounter claim.
  const seed = purchaser.checkpoint(); seed.visit.actor!.x = 2.97; seed.visit.actor!.z = -6.5; seed.visit.actor!.moving = false;
  seed.character = { ...seed.character, x: 2.97, z: -4.6, heading: Math.PI, moving: false };
  seed.head.yaw = seed.head.targetYaw = 0; seed.head.pitch = seed.head.targetPitch = -.3; seed.head.status = 'idle';
  seed.pauseUntilTick = 100000; seed.home.controller.searchNextTick = 100000;
  const runtime = new BranchRuntime({ worldId: 'visit-eye', branchId: 'visible', mode: 'EXPERIMENT', checkpoint: seed, directory: join(directory, 'runs') });
  const renderer = new ChromiumRenderer(), manager = new CaptureManager(() => true, renderer);
  let blocked: BranchRuntime | undefined;
  try {
    runtime.applyControl({ type: 'pause' }); runtime.applyControl({ type: 'step' });
    runtime.enqueueVisit({ type: 'visit_start', runId: runtime.target.runId, generation: 2 }); runtime.applyControl({ type: 'step' });
    const captured = structuredClone(runtime.viewerState()), before = runtime.checkpoint().simulation;
    const request = manager.request(runtime, { reason: 'diagnostic', width: 512, height: 512 });
    // Advance the live motor while the real renderer owns the earlier copied snapshot.
    runtime.enqueueVisit({ type: 'visit_control', runId: runtime.target.runId, generation: 2, sequence: 1, forward: -1, strafe: 0, yaw: 0, pitch: 0, expiresTick: runtime.simulation.state.tick + 20 });
    for (let i = 0; i < 6; i++) runtime.applyControl({ type: 'step' });
    assert.ok(runtime.viewerState().visit!.actor!.z < captured.visit!.actor!.z - .4);
    const metadata = await manager.wait(runtime.target, request.captureId); assert.equal(metadata.status, 'success', metadata.error ?? undefined);
    const visible = manager.view(runtime.target), grounding = visible.privateGrounding as PixelGroundingResult;
    assert.equal(metadata.tick, captured.tick); assert.equal(metadata.dynamicRevision, captured.scene!.revision); assert.equal(metadata.stateHash, hashCheckpoint(before));
    assert.equal(metadata.frameHash, createHash('sha256').update(manager.frame(runtime.target, request.captureId)).digest('hex'));
    const headId = VISITOR_PHYSICAL_PREFIX + 'head', head = grounding.objects.find(object => object.id === headId)!;
    const expectedHead = groundSnapshot(captured, 512, 512, { ignoreLegacyIlluminationGate: true, pixelEvidenceCandidates: true }).objects.find(object => object.id === headId)!;
    const latestHead = groundSnapshot(runtime.viewerState(), 512, 512, { ignoreLegacyIlluminationGate: true, pixelEvidenceCandidates: true }).objects.find(object => object.id === headId)!;
    assert.equal(head.distance, expectedHead.distance); assert.ok(Math.abs(head.distance - latestHead.distance) > .3);
    assert.ok(grounding.pixelQualification.objects.some(object => object.privateId.startsWith(VISITOR_PHYSICAL_PREFIX) && object.qualified), 'paired actual RGB qualifies visitor geometry');
    assert.ok(grounding.pixelQualification.objects.some(object => object.privateId === VISITOR_HELD_PHYSICAL_ID && object.qualified), 'paired actual RGB qualifies the owned held fruit');
    await writeFile(join(directory, 'visible.png'), manager.frame(runtime.target, request.captureId));
    const blockedSeed = structuredClone(before); if (blockedSeed.schemaVersion !== 10) throw new Error('Visit schema required');
    blockedSeed.character.x = 0; blockedSeed.character.z = 0; blockedSeed.character.heading = Math.atan2(2.97, -6.5);
    blockedSeed.head.pitch = blockedSeed.head.targetPitch = 0;
    blocked = new BranchRuntime({ worldId: 'visit-eye', branchId: 'blocked', mode: 'EXPERIMENT', checkpoint: blockedSeed, directory: join(directory, 'runs') });
    blocked.applyControl({ type: 'pause' }); blocked.applyControl({ type: 'step' });
    const hiddenRequest = manager.request(blocked, { reason: 'diagnostic', width: 512, height: 512 }), hiddenMetadata = await manager.wait(blocked.target, hiddenRequest.captureId);
    assert.equal(hiddenMetadata.status, 'success', hiddenMetadata.error ?? undefined);
    const hidden = manager.view(blocked.target).privateGrounding as PixelGroundingResult;
    assert.ok(!hidden.pixelQualification.objects.some(object => (object.privateId.startsWith(VISITOR_PHYSICAL_PREFIX) || object.privateId === VISITOR_HELD_PHYSICAL_ID) && object.qualified), 'closed home geometry blocks both visitor and held item');
    assert.equal(hidden.objects.find(object => object.id === headId)!.status, 'fully_occluded');
    await writeFile(join(directory, 'blocked.png'), manager.frame(blocked.target, hiddenRequest.captureId));
    const report = { fixture: 'isolated EXPERIMENT spatial staging; item acquired by production purchase', visible: metadata, blocked: hiddenMetadata, visitorQualified: grounding.pixelQualification.objects.filter(object => object.privateId.startsWith(VISITOR_PHYSICAL_PREFIX) || object.privateId === VISITOR_HELD_PHYSICAL_ID), blockedVisitorQualified: hidden.pixelQualification.objects.filter(object => object.privateId.startsWith(VISITOR_PHYSICAL_PREFIX) || object.privateId === VISITOR_HELD_PHYSICAL_ID), capturedActor: captured.visit!.actor, latestActor: runtime.viewerState().visit!.actor, capturedHeadDistance: head.distance, latestHeadDistance: latestHead.distance, personalExperience: false, paidCalls: 0 };
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
    const after = runtime.checkpoint().simulation; if (after.schemaVersion !== 10) throw new Error('Visit schema required');
    assert.deepEqual(after.realExperiences, before.schemaVersion === 10 ? before.realExperiences : []);
  } finally { await manager.close(); await runtime.close(); await blocked?.close(); }
});
