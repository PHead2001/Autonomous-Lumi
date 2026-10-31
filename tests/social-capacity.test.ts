import test from 'node:test';
import assert from 'node:assert/strict';
import { SocialSimulation, validateSocialCheckpoint } from '../server/simulation.js';
import { cognitionEnvelopeBytes, cognitionStorageBytes, SOCIAL_FUTURE_BYTES } from '../server/checkpoint-capacity.js';
import { MAX_CHECKPOINT_BYTES } from '../server/checkpoint-storage.js';

test('CP11 social reserve covers the maximum valid encoded evidence and measures pending observations directly', t => {
  const empty = new SocialSimulation({ mode: 'EXPERIMENT', worldId: 'capacity-test', branchId: 'social-capacity', historyId: 'social-capacity', runId: 'capacity-run' }).checkpoint();
  const max = Number.MAX_SAFE_INTEGER;
  const largestEscaped = (length: number, char = '\u0000') => char.repeat(length);
  const grown = structuredClone(empty);
  const social = grown.social;
  social.feedback = { actionId: max, kind: 'badge', outcome: 'rejected', reason: 'x'.repeat(100), tick: grown.tick };
  social.badge = { display: true, kind: 'unverified_claim', revision: max };
  social.experiences = Array.from({ length: 32 }, (_, index) => {
    const captureId = `c${String(index).padStart(2, '0')}${'c'.repeat(97)}`;
    const perceivedIdentity = 'creator_claim' as const;
    return {
      id: index + 1,
      kind: 'social' as const,
      provenance: 'ATTENDED_AUTHORED_SOCIAL_RGB' as const,
      recognition: 'authored-social-rgb-v1' as const,
      source: 'actual_renderer' as const,
      identity: structuredClone(grown.cognition.identity),
      encodingId: `${grown.cognition.identity.historyId}_${captureId}_${perceivedIdentity}`,
      captureId,
      frameHash: 'f'.repeat(64),
      handle: 'h'.repeat(100),
      capturedTick: grown.tick,
      attentionTick: grown.tick,
      encodedTick: grown.tick,
      perceivedIdentity,
      interpretation: largestEscaped(300),
      uncertainty: largestEscaped(200, '\u0001'),
    };
  });
  social.seenEvidence = Array.from({ length: 64 }, (_, index) => `${largestEscaped(249)}${String.fromCharCode(33 + index)}`);
  social.timeline = Array.from({ length: 32 }, (_, index) => ({
    sequence: index + 1,
    tick: grown.tick,
    offerId: null,
    type: 'encoding' as const,
    label: largestEscaped(160),
  }));
  social.nextTimelineSequence = 33;
  const maxState = validateSocialCheckpoint(grown);

  const pending = structuredClone(maxState);
  pending.nextInputSequence = 2;
  pending.pendingInputs = [{
    sequence: 1,
    receivedTick: pending.tick,
    applyTick: pending.tick + 1,
    admission: 'queued',
    command: {
      type: 'social_observation',
      captureId: 'c'.repeat(100),
      frameHash: 'a'.repeat(64),
      capturedTick: pending.tick,
      attentionTick: pending.tick,
      sensorSource: 'actual_renderer',
      actor: { x: 6.999999999999999, z: -15.999999999999998, heading: Math.PI },
      offer: { offerId: max, revision: max, itemId: max, good: 'bread', handle: 'o'.repeat(100) },
      badge: { revision: max, kind: 'unverified_claim', handle: 'b'.repeat(100) },
    },
  }];
  const maxWithPending = validateSocialCheckpoint(pending);

  const stateGrowth = cognitionEnvelopeBytes(maxState) - cognitionEnvelopeBytes(empty);
  const pendingPayloadGrowth = cognitionEnvelopeBytes(maxWithPending) - cognitionEnvelopeBytes(maxState);
  const totalEnvelopeGrowth = cognitionEnvelopeBytes(maxWithPending) - cognitionEnvelopeBytes(empty);
  const stateStorage = cognitionStorageBytes(maxState);
  const pendingStorage = cognitionStorageBytes(maxWithPending);
  t.diagnostic(`Maximum valid social-state envelope growth: ${stateGrowth} bytes; pending observation payload: ${pendingPayloadGrowth} bytes; combined measured growth: ${totalEnvelopeGrowth} bytes; SOCIAL_FUTURE_BYTES: ${SOCIAL_FUTURE_BYTES} bytes; capacity with state and pending input: ${pendingStorage}/${MAX_CHECKPOINT_BYTES} bytes.`);

  assert.ok(stateGrowth > 0 && stateGrowth <= SOCIAL_FUTURE_BYTES,
    `actual maximum valid CP11 social state growth ${stateGrowth} exceeds SOCIAL_FUTURE_BYTES ${SOCIAL_FUTURE_BYTES}`);
  assert.ok(pendingPayloadGrowth > 0, 'maximum pending social observation must add measured envelope bytes');
  assert.equal(totalEnvelopeGrowth, stateGrowth + pendingPayloadGrowth);
  assert.equal(pendingStorage - stateStorage, pendingPayloadGrowth,
    'pending observation is already charged by the serialized checkpoint envelope and must not be charged again as social reserve');
  assert.ok(pendingStorage <= MAX_CHECKPOINT_BYTES,
    `maximum valid CP11 checkpoint storage ${pendingStorage} exceeds ${MAX_CHECKPOINT_BYTES} bytes`);
  assert.ok(pendingStorage > stateStorage);
  assert.ok(maxWithPending.social.experiences.length === 32 && maxWithPending.social.seenEvidence.length === 64 && maxWithPending.social.timeline.length === 32);
});
