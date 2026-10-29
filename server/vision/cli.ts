import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { CaptureMetadata } from '../../shared/capture-protocol.js';
const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
async function main() {
  const url = new URL(arg('--url') ?? 'http://127.0.0.1:3001');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Vision CLI requires a local HTTP server');
  const scope = { worldId: arg('--world'), branchId: arg('--branch'), runId: arg('--run') };
  if (Object.values(scope).some(value => !value || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value))) throw new Error('Provide explicit --world, --branch and --run (GET /api/branches lists them)');
  const request = await fetch(new URL('/api/vision/capture', url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...scope, reason: 'diagnostic', width: Number(arg('--size') ?? 512), height: Number(arg('--size') ?? 512) }), signal: AbortSignal.timeout(25000) });
  const submitted = await request.json() as CaptureMetadata & { error?: string }; if (!request.ok) throw new Error(submitted.error ?? 'Capture request failed');
  const query = new URLSearchParams({ ...scope as Record<string, string>, captureId: submitted.captureId });
  const result = await fetch(new URL('/api/vision/result?' + query, url), { signal: AbortSignal.timeout(25000) });
  const metadata = await result.json() as CaptureMetadata & { error?: string };
  if (!result.ok || metadata.status !== 'success') throw new Error(metadata.error ?? 'Capture did not succeed');
  const frame = await fetch(new URL('/api/vision/frame?' + query, url), { signal: AbortSignal.timeout(5000) }); if (!frame.ok) throw new Error('Frame unavailable for current run');
  const out = resolve(arg('--out') ?? 'diagnostics/vision/capture.png'); await mkdir(dirname(out), { recursive: true });
  await writeFile(out, new Uint8Array(await frame.arrayBuffer())); await writeFile(out + '.json', JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify({ out, metadata }));
}
void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
