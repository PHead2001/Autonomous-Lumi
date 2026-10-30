import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { CREATOR_FOUNDATION_CONTEXT, SOCIAL_PROMPT_REVISION, PHYSIOLOGY_PROMPT_REVISION, currentCognitionProfile, validateCognitionCommand, validateCognitionContext, type CognitionContext, type CognitionRequestCommand } from '../shared/cognition-protocol.js';
import { CognitionProviders } from '../server/cognition/providers.js';
import { loadCognitionConfig } from '../server/cognition/config.js';
import { DurableBudget } from '../server/cognition/budget.js';
import { verificationOptions } from '../server/cognition/verify.js';
import { runSocialProviderVerification } from '../server/cognition/social-verify.js';

const png = PNG.sync.write(new PNG({ width: 512, height: 512, fill: true }));
const context = (): CognitionContext => ({ creatorFoundation: { ...CREATOR_FOUNDATION_CONTEXT }, observationId: 'public-observation', frameHash: createHash('sha256').update(png).digest('hex'), shapes: [], sound: null, activity: { status: 'idle' }, experiences: [{ interpretation: 'I noticed a visitor presenting food, though I was unsure of their identity.', uncertainty: .5 }] });

test('social provider context is a separate foundational premise and semantic memories, with explicit v6 profile', () => {
  const c = context(); assert.deepEqual(validateCognitionContext(c), c);
  for (const premise of [{ ...c.creatorFoundation, actorId: 'hidden' }, { ...c.creatorFoundation, familiarity: 'trusted' }, { ...c.creatorFoundation, creatorExists: false }]) assert.throws(() => validateCognitionContext({ ...c, creatorFoundation: premise }), /foundation/);
  assert.throws(() => validateCognitionContext({ ...c, experiences: [{ ...c.experiences[0], offerId: 9 }] }), /context/);
  const request: CognitionRequestCommand = { type: 'cognition_request', requestId: 'social-request', purpose: 'interpretation', provider: 'fixture', model: 'offline', promptRevision: SOCIAL_PROMPT_REVISION, schemaRevision: 'lumi-interpretation-v2', selection: { identity: { worldId: 'world', branchId: 'experiment', historyId: 'history', runId: 'run', mode: 'EXPERIMENT' }, captureId: 'capture', observationId: c.observationId, frameHash: c.frameHash, intentId: 1, capturedTick: 0, attentionTick: 1, pose: { x: 0, y: 2.355, z: 0, bodyHeading: 0, headYaw: 0, headPitch: 0 }, source: 'actual_renderer', context: c } };
  assert.deepEqual(validateCognitionCommand(request), request); assert.equal(currentCognitionProfile(request), true);
  assert.throws(() => validateCognitionCommand({ ...request, promptRevision: PHYSIOLOGY_PROMPT_REVISION }), /profile mismatch/);
  const old = structuredClone(request); delete old.selection.context.creatorFoundation; old.selection.context.internalSensations = []; old.promptRevision = PHYSIOLOGY_PROMPT_REVISION;
  assert.doesNotThrow(() => validateCognitionCommand(old)); assert.throws(() => validateCognitionCommand({ ...old, promptRevision: SOCIAL_PROMPT_REVISION }), /profile mismatch/);
});

test('mock provider wire carries only permitted semantic premise/memories and explains their sensory limits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lumi-social-provider-')); let calls = 0;
  const config = loadCognitionConfig({ loadEnv: false, env: { OPENROUTER_API_KEY: 'fixture-no-paid-provider', LUMI_COGNITION_ENABLED: 'true', LUMI_COGNITION_BUDGET_DIRECTORY: join(directory, 'budget') } });
  const providers = new CognitionProviders(config, new DurableBudget(config.budget.directory), async (_url, init) => {
    calls++; const body = JSON.parse(String(init.body)), system = body.messages[0].content, wire = JSON.parse(body.messages[1].content[0].text);
    assert.deepEqual(wire.creatorFoundation, CREATOR_FOUNDATION_CONTEXT); assert.deepEqual(wire.experiences, context().experiences);
    for (const key of ['actorId', 'offerId', 'accountId', 'generation', 'encodedTick', 'capturedTick', 'worldTimeSeconds', 'worldScope', 'observationId', 'frameHash']) assert.ok(!String(init.body).includes('"' + key + '"'), 'private/binding fields omitted: ' + key);
    assert.match(system, /separate from autobiographical experience/); assert.match(system, /Authentication and hidden world state are unavailable/);
    return new Response(JSON.stringify({ model: config.main.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ interpretation: 'A visitor appears ahead, but I cannot establish their identity.', uncertainty: .6, evidenceHandles: [], action: { type: 'continue' } }) } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: .000001 } }), { status: 200 });
  });
  try { assert.equal((await providers.interpret({ requestId: 'mock-social', worldTimeSeconds: 9123, worldScope: 'private-world/branch', context: context(), png })).status, 'ok'); assert.equal(calls, 1); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test('single social provider mode requires explicit paid opt-in and stops without an available existing main provider', async () => {
  assert.equal(verificationOptions(['--paid','--social']).social,true);
  for(const options of [['--mock','--social'],['--paid','--social','--decisions'],['--paid','--social','--physiology']])assert.throws(()=>verificationOptions(options),/social requires/);
  const directory=await mkdtemp(join(tmpdir(),'lumi-social-provider-unavailable-'));
  try{const config=loadCognitionConfig({loadEnv:false,env:{}}),report=await runSocialProviderVerification({paid:true,out:directory},config);assert.equal(report.status,'unavailable');assert.equal(report.mainCalls,0);assert.equal(report.decisionsCalls,0);assert.equal(report.maximumMainCalls,1);assert.equal(report.maximumDecisionsCalls,0);assert.equal(report.ceilingUsd,config.budget.ceilingUsd);}
  finally{await rm(directory,{recursive:true,force:true});}
});
