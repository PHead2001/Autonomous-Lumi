import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export interface CognitionConfig {
  main: { enabled: boolean; available: boolean; model: string; maxInputTokens: number; inputUsdPerMillion: number; outputUsdPerMillion: number };
  decisions: { enabled: boolean; available: boolean; model: string; reservationUsd: number | null };
  limits: { maxConcurrent: number; maxQueued: number; maxRequestBytes: number; maxResponseBytes: number; maxContextBytes: number; maxImageBytes: number; maxOutputTokens: number; deadlineMs: number; minRealIntervalMs: number; minWorldIntervalSeconds: number };
  budget: { directory: string; ceilingUsd: number };
  credential(provider: 'openrouter' | 'openai'): string | undefined;
}

/** Server entry points and explicit integration commands use the same loader. A key alone enables nothing. */
export function loadCognitionConfig(options: { env?: NodeJS.ProcessEnv; envFile?: string; loadEnv?: boolean } = {}): CognitionConfig {
  const supplied = options.env ?? process.env;
  let dotenv: NodeJS.ProcessEnv = {};
  if (options.loadEnv !== false) {
    try { dotenv = parseEnv(readFileSync(options.envFile ?? resolve('.env'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cognition environment file could not be loaded'); }
  }
  const env = { ...dotenv, ...supplied };
  const flag = (name: string) => { const value = env[name]; if (value !== undefined && value !== 'true' && value !== 'false') throw new Error(`Invalid boolean configuration: ${name}`); return value === 'true'; };
  const number = (name: string, fallback: number, min: number, max: number, integer = false) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`Invalid numeric configuration: ${name}`);
    return value;
  };
  const mainKey = env.OPENROUTER_API_KEY?.trim() || undefined;
  const decisionsKey = env.OPENAI_API_KEY?.trim() || undefined;
  const ceilingUsd = number('LUMI_COGNITION_BUDGET_USD', 1, 0, 1000);
  if (ceilingUsd > 1 && !flag('LUMI_COGNITION_ALLOW_HIGHER_BUDGET')) throw new Error('Budget above USD 1 requires explicit LUMI_COGNITION_ALLOW_HIGHER_BUDGET=true');
  const mainModel = env.LUMI_COGNITION_MODEL ?? 'qwen/qwen3.7-flash';
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:-]+$/.test(mainModel)) throw new Error('Invalid cognition model');
  if (mainModel !== 'qwen/qwen3.7-flash' && env.LUMI_COGNITION_ROUTE_CONTEXT_TOKENS === undefined) throw new Error('A changed model requires its documented full route context in LUMI_COGNITION_ROUTE_CONTEXT_TOKENS');
  // Full 1.05M context at buffered $.50/M exceeds long-context cache-write + regional premiums.
  const reservationUsd = number('LUMI_DECISIONS_RESERVATION_USD', 0.525, 0.525, 1000);
  const mainEnabled = flag('LUMI_COGNITION_ENABLED'), decisionsEnabled = flag('LUMI_DECISIONS_ENABLED');
  const config: CognitionConfig = {
    main: { enabled: mainEnabled, available: mainEnabled && !!mainKey, model: mainModel,
      maxInputTokens: number('LUMI_COGNITION_ROUTE_CONTEXT_TOKENS', 1_000_000, 1_000_000, 10_000_000, true),
      inputUsdPerMillion: number('LUMI_COGNITION_MAX_INPUT_USD_PER_MILLION', 0.1, 0.000001, 1000),
      outputUsdPerMillion: number('LUMI_COGNITION_MAX_OUTPUT_USD_PER_MILLION', 0.3, 0.000001, 1000) },
    decisions: { enabled: decisionsEnabled, available: decisionsEnabled && !!decisionsKey && reservationUsd !== null, model: 'gpt-6-luna', reservationUsd },
    limits: { maxConcurrent: number('LUMI_COGNITION_CONCURRENCY', 1, 1, 2, true), maxQueued: number('LUMI_COGNITION_QUEUE', 1, 0, 4, true),
      maxRequestBytes: 2_000_000, maxResponseBytes: 32_768, maxContextBytes: 24_576, maxImageBytes: 1_000_000,
      maxOutputTokens: number('LUMI_COGNITION_MAX_OUTPUT_TOKENS', 768, 128, 2048, true),
      deadlineMs: number('LUMI_COGNITION_DEADLINE_MS', 15_000, 100, 60_000, true),
      minRealIntervalMs: number('LUMI_COGNITION_MIN_REAL_INTERVAL_MS', 10_000, 100, 3_600_000, true),
      minWorldIntervalSeconds: number('LUMI_COGNITION_MIN_WORLD_INTERVAL_SECONDS', 10, 1, 3600) },
    budget: { directory: resolve(env.LUMI_COGNITION_BUDGET_DIRECTORY ?? join(env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'AutonomousLumi', 'cognition-budget')), ceilingUsd },
    credential: provider => provider === 'openrouter' ? mainKey : decisionsKey,
  };
  return config;
}

/** Deliberate projection; never spread server configuration into HTTP/recorder output. */
export function safeCognitionConfig(config: CognitionConfig) {
  return { main: { ...config.main }, decisions: { ...config.decisions }, limits: { ...config.limits }, budget: { ceilingUsd: config.budget.ceilingUsd }, retries: 0 };
}
