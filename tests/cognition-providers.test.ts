import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, unlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { loadCognitionConfig, safeCognitionConfig } from '../server/cognition/config';
import { DurableBudget, BudgetError } from '../server/cognition/budget';
import { CognitionProviders, type ProviderTransport } from '../server/cognition/providers';
import type { CognitionContext } from '../shared/cognition-protocol';

const image = PNG.sync.write(new PNG({ width: 512, height: 512, fill: true }));
const context = (): CognitionContext => ({ observationId: 'obs1', frameHash: createHash('sha256').update(image).digest('hex'),
  shapes: [{ handle: 'shape1', bearingDegrees: 15, elevationDegrees: 0, distanceBand: 'near', sampleVisibilityBand: 'medium', uncertainty: 'geometric_samples_only' }],
  sound: null, activity: { status: 'running' }, experiences: [] });
const proposal = () => ({ observationId: 'obs1', frameHash: context().frameHash, interpretation: 'An uncertain shape is ahead.', uncertainty: 0.6, evidenceHandles: ['shape1'], action: { type: 'inspect', handle: 'shape1' } });
const envelope = (content: unknown = proposal()) => ({ model: 'qwen/qwen3.7-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 123, completion_tokens: 40, cost: 0.00001 } });
async function setup(transport: ProviderTransport, extra: NodeJS.ProcessEnv = {}) {
  const root = await mkdtemp(join(tmpdir(), 'lumi-provider-'));
  const config = loadCognitionConfig({ loadEnv: false, env: { OPENROUTER_API_KEY: 'fake-private-key', OPENAI_API_KEY: 'fake-openai-key', LUMI_COGNITION_ENABLED: 'true', LUMI_DECISIONS_ENABLED: 'true', LUMI_COGNITION_BUDGET_DIRECTORY: join(root, 'budget'), LUMI_COGNITION_MIN_REAL_INTERVAL_MS: '100', ...extra } });
  const budget = new DurableBudget(config.budget.directory, config.budget.ceilingUsd);
  return { root, config, budget, providers: new CognitionProviders(config, budget, transport), close: () => rm(root, { recursive: true, force: true }) };
}
const input = (id = 'request1', world = 10) => ({ requestId: id, worldTimeSeconds: world, context: context(), png: image });
const fails = (code: BudgetError['code']) => (error: unknown) => error instanceof BudgetError && error.code === code;

test('server dotenv loader is shared, explicit opt-in, validates limits, and safe config omits keys and paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lumi-config-'));
  try {
    const path = join(root, '.env');
    await writeFile(path, 'OPENROUTER_API_KEY=dotenv-secret\nLUMI_COGNITION_ENABLED=true\n');
    const loaded = loadCognitionConfig({ envFile: path, env: { OPENROUTER_API_KEY: 'process-secret' } });
    assert.equal(loaded.main.available, true); assert.equal(loaded.credential('openrouter'), 'process-secret');
    const safe = JSON.stringify(safeCognitionConfig(loaded));
    assert.equal(safe.includes('secret'), false); assert.equal(safe.includes(loaded.budget.directory), false);
    const keysOnly = loadCognitionConfig({ loadEnv: false, env: { OPENROUTER_API_KEY: 'fake', OPENAI_API_KEY: 'fake' } });
    assert.equal(keysOnly.main.available, false); assert.equal(keysOnly.decisions.available, false);
    assert.equal(loadCognitionConfig({ loadEnv: false, env: {} }).budget.ceilingUsd, 1);
    assert.throws(() => loadCognitionConfig({ loadEnv: false, env: { LUMI_COGNITION_BUDGET_USD: '2' } }), /explicit/);
    assert.equal(loadCognitionConfig({ loadEnv: false, env: { LUMI_COGNITION_BUDGET_USD: '2', LUMI_COGNITION_ALLOW_HIGHER_BUDGET: 'true' } }).budget.ceilingUsd, 2);
    assert.throws(() => loadCognitionConfig({ loadEnv: false, env: { LUMI_COGNITION_CONCURRENCY: 'NaN' } }), /Invalid/);
    assert.throws(() => loadCognitionConfig({ loadEnv: false, env: { LUMI_COGNITION_MODEL: 'vendor/larger-model' } }), /documented full route context/);
    assert.equal(loadCognitionConfig({ loadEnv: false, env: { LUMI_COGNITION_MODEL: 'vendor/larger-model', LUMI_COGNITION_ROUTE_CONTEXT_TOKENS: '2000000' } }).main.maxInputTokens, 2_000_000);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('durable budget reserves before spend, accounts outstanding/unknown, deduplicates and survives restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lumi-budget-')), directory = join(root, 'ledger');
  try {
    const budget = new DurableBudget(directory, 1);
    await budget.reserve('one', 0.6);
    await assert.rejects(budget.reserve('one', 0.1), fails('duplicate_request'));
    await assert.rejects(budget.reserve('two', 0.6), fails('concurrency_limited'));
    await budget.settle('one', null, 'unknown');
    const restarted = new DurableBudget(directory, 1);
    assert.equal((await restarted.snapshot()).accountedUsd, 0.6);
    await assert.rejects(restarted.reserve('two', 0.5), fails('budget_exhausted'));
    await restarted.reserve('two', 0.4);
    await restarted.settle('two', 0.05, 'reported');
    const state = await restarted.snapshot(); assert.equal(state.unknown, 1); assert.equal(state.reportedUsd, 0.05);
    assert.ok(Math.abs(state.accountedUsd - 0.65) < 1e-12);
    await assert.rejects(restarted.settle('two', 0, 'reported'), fails('duplicate_request'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('existing missing/corrupt ledger fails closed and cross-instance reservations cannot overdraw', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lumi-ledger-')), directory = join(root, 'ledger');
  try {
    const first = new DurableBudget(directory, 1); await first.snapshot();
    const second = new DurableBudget(directory, 1);
    const results = await Promise.allSettled([first.reserve('a', 0.7), second.reserve('b', 0.7)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await first.snapshot()).accountedUsd, 0.7);
    await unlink(join(directory, 'ledger.json'));
    await assert.rejects(new DurableBudget(directory, 1).snapshot(), fails('budget_unavailable'));
    await writeFile(join(directory, 'ledger.json'), '{"schema":1,"entries":[{"id":"bad"}]}');
    await assert.rejects(first.snapshot(), fails('budget_unavailable'));
    assert.equal((await readFile(join(directory, 'ledger.json'), 'utf8')).includes('bad'), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('budget enforces application-wide real cadence across a new controller', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lumi-frequency-')), directory = join(root, 'ledger');
  try {
    const one = new DurableBudget(directory, 1, () => 1000); await one.reserve('a', 0.1); await one.settle('a', 0, 'reported');
    await assert.rejects(new DurableBudget(directory, 1, () => 1010).reserve('b', 0.1, { minIntervalMs: 100 }), fails('frequency_limited'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('crashed pending requests expire into charged unknown usage without permanently occupying concurrency', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lumi-expiry-')), directory = join(root, 'ledger');
  try {
    await new DurableBudget(directory, 1, () => 1000).reserve('crashed', 0.4, { ttlMs: 1000 });
    await assert.rejects(new DurableBudget(directory, 1, () => 1999).reserve('early', 0.4), fails('concurrency_limited'));
    const restarted = new DurableBudget(directory, 1, () => 2000);
    await restarted.reserve('new', 0.4);
    assert.equal((await restarted.snapshot()).unknown, 1); assert.equal((await restarted.snapshot()).pending, 1);
    await restarted.settle('crashed', 0, 'reported'); // A late callback cannot refund the abandoned charge.
    assert.equal((await restarted.snapshot()).accountedUsd, 0.8);
    await restarted.settle('new', null, 'unknown');
    await assert.rejects(restarted.reserve('over', 0.3), fails('budget_exhausted'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('OpenRouter sends the bound private 512 PNG with strict schema and price/route controls, returning normalized output', async () => {
  let calls = 0;
  const fixture = await setup(async (url, init) => {
    calls++; assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions'); assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body as string);
    assert.equal(body.model, 'qwen/qwen3.7-flash'); assert.equal(body.stream, false); assert.equal(body.provider.allow_fallbacks, false); assert.equal(body.provider.require_parameters, true);
    assert.deepEqual(body.provider.max_price, { prompt: 0.1, completion: 0.3 }); assert.equal(body.response_format.json_schema.strict, true);
    const content = body.messages[1].content; assert.deepEqual(JSON.parse(content[0].text), context());
    assert.equal(content[1].image_url.url, 'data:image/png;base64,' + image.toString('base64'));
    for (const forbidden of ['worldId', 'runId', 'worldTimeSeconds', 'privateGrounding', 'bodyHeading']) assert.equal((init.body as string).includes(forbidden), false);
    return Response.json(envelope());
  });
  try {
    const result = await fixture.providers.interpret(input());
    assert.equal(result.status, 'ok'); assert.deepEqual(JSON.parse(result.content!), proposal()); assert.equal(result.costBasis, 'reported'); assert.equal(result.inputTokens, 123); assert.equal(calls, 1);
    assert.equal((await fixture.budget.snapshot()).reportedUsd, 0.00001);
    assert.equal(JSON.stringify(fixture.providers.status()).includes('fake-private-key'), false);
  } finally { await fixture.close(); }
});

test('strict parser rejects privileged fields, fabricated handles, refusal and partial envelopes', async () => {
  const variants = [
    { response: envelope({ ...proposal(), privateGrounding: 'injected' }), status: 'malformed' },
    { response: envelope({ ...proposal(), evidenceHandles: ['invented'] }), status: 'malformed' },
    { response: envelope({ ...proposal(), action: { type: 'inspect', handle: 'invented' } }), status: 'malformed' },
    { response: { ...envelope(), choices: [{ finish_reason: 'length', message: { content: JSON.stringify(proposal()) } }] }, status: 'malformed' },
    { response: { ...envelope(), choices: [{ finish_reason: 'stop', message: { refusal: 'no', content: '' } }] }, status: 'refused' },
    { response: { ...envelope(), model: 'silent-fallback' }, status: 'malformed' },
  ];
  for (const variant of variants) {
    const fixture = await setup(async () => Response.json(variant.response));
    try { const result = await fixture.providers.interpret(input()); assert.equal(result.status, variant.status); assert.equal(result.content, null); }
    finally { await fixture.close(); }
  }
});

test('invalid/missing/private sensory input never dispatches, and disabled keys alone do not run', async () => {
  let calls = 0; const fixture = await setup(async () => { calls++; return Response.json(envelope()); });
  try {
    assert.equal((await fixture.providers.interpret({ ...input(), context: { ...context(), hiddenPosition: [1,2,3] } as CognitionContext })).status, 'invalid_input');
    assert.equal((await fixture.providers.interpret({ ...input(), png: new Uint8Array(48) })).status, 'invalid_input');
    assert.equal((await fixture.providers.interpret({ ...input(), context: { ...context(), frameHash: '0'.repeat(64) } })).status, 'invalid_input');
    const disabled = loadCognitionConfig({ loadEnv: false, env: { OPENROUTER_API_KEY: 'fake' } });
    assert.equal((await new CognitionProviders(disabled, fixture.budget, async () => { calls++; throw new Error(); }).interpret(input())).status, 'unavailable');
    assert.equal(calls, 0);
  } finally { await fixture.close(); }
});

test('timeouts do not wait for ignored aborts, charge unknown usage and block later overspend', async () => {
  let calls = 0; const fixture = await setup(async () => { calls++; return await new Promise<Response>(() => {}); }, { LUMI_COGNITION_DEADLINE_MS: '100', LUMI_COGNITION_BUDGET_USD: '0.15' });
  try {
    const first = await fixture.providers.interpret(input()); assert.equal(first.status, 'timeout'); assert.equal(first.attempts, 1); assert.equal(first.costBasis, 'unknown');
    assert.equal((await fixture.budget.snapshot()).unknown, 1);
    const second = await new CognitionProviders(fixture.config, new DurableBudget(fixture.config.budget.directory, 0.15), async () => { calls++; return Response.json(envelope()); }).interpret(input('request2', 30));
    assert.equal(second.status, 'budget_exhausted'); assert.equal(calls, 1);
  } finally { await fixture.close(); }
});

test('one bounded queue holds immutable context/image and rejects excess work without transport', async () => {
  let release: (() => void) | undefined; let calls = 0; const contexts: CognitionContext[] = [];
  const fixture = await setup(async (_url, init) => {
    calls++; contexts.push(JSON.parse(JSON.parse(init.body as string).messages[1].content[0].text));
    if (calls === 1) await new Promise<void>(resolve => { release = resolve; });
    return Response.json(envelope());
  }, { LUMI_COGNITION_DEADLINE_MS: '1000' });
  try {
    const first = fixture.providers.interpret(input());
    const secondInput = { ...input('request2', 30), png: Buffer.from(image) };
    const second = fixture.providers.interpret(secondInput);
    secondInput.context.shapes[0].handle = 'changed_after_queue'; secondInput.png.fill(0);
    assert.equal((await fixture.providers.interpret(input('request3', 60))).status, 'queue_full');
    await new Promise(resolve => setTimeout(resolve, 130)); assert.ok(release); release();
    assert.equal((await first).status, 'ok'); assert.equal((await second).status, 'ok');
    assert.equal(calls, 2); assert.equal(contexts[1].shapes[0].handle, 'shape1');
  } finally { release?.(); await fixture.close(); }
});

test('HTTP errors and oversized responses keep unknown reservations and omit raw provider errors', async () => {
  for (const [response, status] of [[new Response('sensitive provider failure', { status: 429 }), 'rate_limit'], [new Response('private'.repeat(10000)), 'failed']] as const) {
    const fixture = await setup(async () => response);
    try { const result = await fixture.providers.interpret(input()); assert.equal(result.status, status); assert.equal(result.content, null); assert.equal(JSON.stringify(result).includes('sensitive'), false); assert.equal((await fixture.budget.snapshot()).unknown, 1); }
    finally { await fixture.close(); }
  }
});

test('world cadence partitions isolated runs without exposing accounting scope or relaxing real cadence', async () => {
  let calls = 0;
  const fixture = await setup(async (_url, init) => {
    calls++; assert.equal((init.body as string).includes('private_scope'), false);
    return Response.json(envelope());
  });
  try {
    assert.equal((await fixture.providers.interpret({ ...input('scope_a_first', 0), worldScope: 'private_scope_a' })).status, 'ok');
    assert.equal((await fixture.providers.interpret({ ...input('scope_a_repeat', 0), worldScope: 'private_scope_a' })).status, 'frequency_limited');
    assert.equal((await fixture.providers.interpret({ ...input('scope_b_too_soon', 0), worldScope: 'private_scope_b' })).status, 'frequency_limited');
    await new Promise(resolve => setTimeout(resolve, 110));
    assert.equal((await fixture.providers.interpret({ ...input('scope_b_first', 0), worldScope: 'private_scope_b' })).status, 'ok');
    assert.equal((await fixture.providers.interpret({ ...input('scope_b_repeat', 0), worldScope: 'private_scope_b' })).status, 'frequency_limited');
    assert.equal(calls, 2);
  } finally { await fixture.close(); }
});

test('separate Decisions contract uses fixed endpoint/model typed choices, conservative estimates and refusal handling', async () => {
  const fixture = await setup(async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/decisions'); const body = JSON.parse(init.body as string);
    assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.messages, undefined); assert.deepEqual(JSON.parse(body.input), context());
    assert.equal(body.questions[0].type, 'choice'); assert.equal(body.questions[0].name, 'attention'); assert.deepEqual(body.prompt_cache_options, { mode: 'explicit' });
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer fake-openai-key');
    return Response.json({ model: 'gpt-6-luna', answers: [{ type: 'choice', name: 'attention', choice: 'continue', confidence: 0.7, probabilities: [{ value: 'continue', probability: 0.8 }, { value: 'inspect', probability: 0.2 }] }], usage: { input_tokens: 100, output_tokens: 0 } });
  });
  try {
    const result = await fixture.providers.decide({ requestId: 'decision1', worldTimeSeconds: 10, context: context(), choices: [{ value: 'continue', description: 'Continue local activity' }, { value: 'inspect', description: 'Inspect the observed handle' }] });
    assert.equal(result.status, 'ok'); assert.equal(result.content, null); assert.equal(result.answer?.choice, 'continue'); assert.equal(result.reservedUsd, 0.525); assert.equal(result.costBasis, 'estimated'); assert.ok(Math.abs(result.costUsd! - 0.0000275) < 1e-12);
  } finally { await fixture.close(); }
  const refused = await setup(async () => Response.json({ model: 'gpt-6-luna', answers: [{ type: 'refusal', name: 'attention' }] }));
  try { assert.equal((await refused.providers.decide({ requestId: 'decision1', worldTimeSeconds: 10, context: context(), choices: [{ value: 'continue', description: 'Continue' }, { value: 'inspect', description: 'Inspect' }] })).status, 'refused'); }
  finally { await refused.close(); }
});
