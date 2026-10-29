import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ActiveTarget } from '../../shared/lab-protocol.js';
import { captureFromServer } from './client.js';
const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
async function main() {
  const url = new URL(arg('--url') ?? 'http://127.0.0.1:3001');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Vision CLI requires a local HTTP server');
  const scope = { worldId: arg('--world'), branchId: arg('--branch'), runId: arg('--run') };
  if (Object.values(scope).some(value => !value || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value))) throw new Error('Provide explicit --world, --branch and --run (GET /api/branches lists them)');
  const { metadata, bytes } = await captureFromServer(url, scope as ActiveTarget, Number(arg('--size') ?? 512));
  const out = resolve(arg('--out') ?? 'diagnostics/vision/capture.png'); await mkdir(dirname(out), { recursive: true });
  await writeFile(out, bytes); await writeFile(out + '.json', JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify({ out, metadata }));
}
void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
